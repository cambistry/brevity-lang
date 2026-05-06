import * as AST from './ast.js';
import { tokenize } from './lexer.js';
import { TEXT_METHODS, BLOB_METHODS, GRAPHEME_TEXT_METHODS } from './text_methods.js';
import { LIST_METHODS } from './list_methods.js';
import { MATH_METHODS } from './math_methods.js';

// The bang form (`*x.method!(...)`) is a distinct method name from its pure
// counterpart, not a modifier. It exists only on the receiver-ref form, and
// only when the method's return type matches the receiver — i.e. there's a
// same-type result to write back into the ref. `size!`, `empty?!`, `split!`,
// etc. are not methods; calling them is "no such method", same as a typo.
function assertBangValidRef(recv, method, isBang, table) {
  if (!isBang) return;
  const meta = table.get(method);
  // size is parser-special-cased to SizeExpr; the registry lookup misses it.
  if (!meta || meta.returns !== recv) {
    throw new Error(`${recv} has no method \`${method}!\` — bang form exists only for methods that return ${recv}.`);
  }
}
function assertNoBangFunctional(recv, method, isBang) {
  if (!isBang) return;
  throw new Error(`${recv}.${method}!(...) is not a valid form — the bang form applies only to a receiver-ref method call (\`*ref.${method}!(...)\`).`);
}

export function parse(tokensIn) {
  let tokens = tokensIn;
  let pos = 0;
  const functionNames = new Set();
  const localScopes = [new Set()];
  const refVarScopes = [new Map()];
  const fnSignatures = new Map();
  const functionParamSlots = new Map();
  const refParamSlots = new Map();
  const labelStack = [];
  // Suppressed when parsing an expression whose trailing `->` belongs to an
  // outer construct (if-cond, while if-cond, handler-if cond), so that
  // `if x -> body` doesn't get eaten as a bare-form function literal.
  // Re-enabled inside fresh sub-expression contexts (parens, call args, etc.).
  let bareFuncAllowed = true;

  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));

  // Parse the children array of a HTML_CONSTRUCTOR token. The lexer produces
  // { type: 'text', value }, { type: 'interp', source } (reactive closure),
  // { type: 'strinterp', source } (snapshot splice), and { type: 'dom', ... }
  // segments. For interp/strinterp, the raw source is re-parsed into an AST
  // by swapping the token stream for the duration of the sub-parse.

  // Parse event handler body statements (for on* attrs like onclick={...}).
  // Handles: name <- expr (SetStatement), bare expression statements.
  // Multiple statements separated by newlines or '.' (lineal separator).
  function parseEventHandlerBody() {
    const body = [];
    while (peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE') { consume(); continue; }
      if (peek().type === 'DOT') { consume(); continue; }
      if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        consume(); // SET (<-) or UPDATE (<|)
        const firstExpr = parseExpr();
        if (peek().type === 'COMMA') {
          const args = [{ expr: firstExpr, positional: true }];
          while (peek().type === 'COMMA') {
            consume();
            args.push({ expr: parseExpr(), positional: true });
          }
          body.push(AST.actorSetStatement(name, args, { updateOp: isUpdate ? '<|' : undefined }));
        } else {
          body.push(AST.setStatement(name, firstExpr, { updateOp: isUpdate ? '<|' : undefined }));
        }
      } else {
        const expr = parseExpr();
        body.push(AST.exprStatement(expr));
      }
    }
    return body;
  }

  function parseAttrs(rawAttrs) {
    if (!rawAttrs || rawAttrs.length === 0) return [];
    return rawAttrs.map(a => {
      if (a.value.type === 'text') return { name: a.name, value: a.value };
      const savedTokens = tokens;
      const savedPos = pos;
      tokens = tokenize(a.value.source);
      pos = 0;
      try {
        // Event handler attrs (on*) contain statement bodies, not expressions.
        if (a.name.startsWith('on')) {
          const body = parseEventHandlerBody();
          return { name: a.name, value: { type: 'handler', body } };
        }
        const expr = parseExpr();
        return { name: a.name, value: { type: 'interp', expr } };
      } finally {
        tokens = savedTokens;
        pos = savedPos;
      }
    });
  }

  function parseDomChildren(rawChildren) {
    return rawChildren.map(c => {
      if (c.type === 'text') return c;
      if (c.type === 'dom') {
        return AST.domConstructor(c.tag, parseDomChildren(c.children), parseAttrs(c.attrs));
      }
      const savedTokens = tokens;
      const savedPos = pos;
      tokens = tokenize(c.source);
      pos = 0;
      try {
        const expr = parseExpr();
        return { type: c.type, expr };
      } finally {
        tokens = savedTokens;
        pos = savedPos;
      }
    });
  }

  // Build an InterpolatedString AST from an INTERP_STRING token's parts.
  // Each expr-part is re-parsed by swapping the token stream — same
  // sub-parse trick as parseDomChildren above.
  function buildInterpolatedString(rawParts) {
    const parts = rawParts.map(p => {
      if (p.kind === 'text') return p;
      const savedTokens = tokens;
      const savedPos = pos;
      tokens = tokenize(p.source);
      pos = 0;
      try {
        const expr = parseExpr();
        return { kind: 'expr', expr };
      } finally {
        tokens = savedTokens;
        pos = savedPos;
      }
    });
    return AST.interpolatedString(parts);
  }

  // Consume a STRING or INTERP_STRING token and return an AST expression node.
  // Use anywhere a string-valued primary expression is accepted.
  function consumeStringExpr() {
    const tok = consume();
    if (tok.type === 'INTERP_STRING') return buildInterpolatedString(tok.parts);
    return AST.stringLiteral(tok.value);
  }

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const skipNewlines = () => { while (peek().type === 'NEWLINE') consume(); };
  const skipBlanks = () => { while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume(); };
  const currentScope = () => localScopes[localScopes.length - 1];
  const declareLocal = (name) => { if (name) currentScope().add(name); };
  const isKnownLocal = (name) => localScopes.some(scope => scope.has(name));
  const addRef = (name, typeName = null) => refVarScopes[refVarScopes.length - 1].set(name, typeName);
  const isRef = (name) => refVarScopes.some(s => s.has(name));
  const refType = (name) => { for (let i = refVarScopes.length - 1; i >= 0; i--) { if (refVarScopes[i].has(name)) return refVarScopes[i].get(name); } return null; };
  // Detect << (append) and >> (prepend) as two consecutive LT or GT tokens
  const peekIsAppend = () => peek().type === 'LT' && tokens[pos + 1]?.type === 'LT';
  const peekIsPrepend = () => peek().type === 'GT' && tokens[pos + 1]?.type === 'GT';
  const consumeOverloadOp = () => { consume(); consume(); }; // eat both tokens
  // Scan from current pos to the next line/block boundary for a `>>` token pair.
  // Used to detect statement-level uses of the prepend operator (`a >> b >> *ns`)
  // so they can be parsed as expressions and desugared by pushExprOrBang.
  const lineHasPrependOp = () => {
    let i = pos;
    while (i < tokens.length) {
      const t = tokens[i].type;
      if (t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'EOF' || t === 'DOT' || t === 'SEMI') return false;
      if (t === 'GT' && tokens[i + 1]?.type === 'GT') return true;
      i++;
    }
    return false;
  };

  // Convert a bang TextMethodExpr/BlobMethodExpr/GraphemeTextMethodExpr/ListMethodExpr
  // to a SetStatement, or wrap in ExprStatement.
  // The bang's validity (same-type return) is enforced at the method-parse site by
  // assertBangValidRef; by the time we reach this rewrite the bang is known good.
  const pushExprOrBang = (body, expr) => {
    if (expr.bang && expr.args[0]?.type === 'RefRead') {
      if (expr.type === 'TextMethodExpr') {
        body.push(AST.setStatement(expr.args[0].name, AST.textMethodExpr(expr.method, expr.args)));
      } else if (expr.type === 'BlobMethodExpr') {
        body.push(AST.setStatement(expr.args[0].name, AST.blobMethodExpr(expr.method, expr.args)));
      } else if (expr.type === 'GraphemeTextMethodExpr') {
        body.push(AST.setStatement(expr.args[0].name, AST.graphemeTextMethodExpr(expr.method, expr.args)));
      } else if (expr.type === 'ListMethodExpr') {
        body.push(AST.setStatement(expr.args[0].name, AST.listMethodExpr(expr.method, expr.args)));
      } else {
        body.push(AST.exprStatement(expr));
      }
    } else if (expr.type === 'BinaryExpr' && expr.op === '>>') {
      // Statement-level >> prepend operator. Walk right-assoc chain to collect
      // the values being prepended, then desugar to a single SetStatement that
      // concats those values (in source order) onto the front of the target ref.
      //   1 >> *ns           → ns <- [1] ++ ns
      //   1 >> 2 >> *ns      → ns <- [1, 2] ++ ns      (final: [1, 2, ...orig])
      const values = [];
      let cur = expr;
      while (cur.type === 'BinaryExpr' && cur.op === '>>') {
        values.push(cur.left);
        cur = cur.right;
      }
      if (cur.type === 'RefRead') {
        body.push(AST.setStatement(cur.name,
          AST.listMethodExpr('concat', [AST.listLiteral(values), AST.refRead(cur.name)])));
      } else {
        // Not a ref target — let validation reject the leftover BinaryExpr.
        body.push(AST.exprStatement(expr));
      }
    } else {
      body.push(AST.exprStatement(expr));
    }
  };

  // Detect superclass prefix: T |, T* |, T *name |, T, U |
  const looksLikeSupertypePrefix = (startPos = pos) => {
    let look = startPos;
    while (tokens[look]?.type === 'NEWLINE') look++;
    while (true) {
      if (tokens[look]?.type !== 'IDENT') return false;
      look++;
      if (tokens[look]?.type === 'STAR') {
        look++;
        if (tokens[look]?.type === 'IDENT') look++;
      }
      while (tokens[look]?.type === 'NEWLINE') look++;
      if (tokens[look]?.type === 'PIPE') return true;
      if (tokens[look]?.type === 'COMMA') { look++; while (tokens[look]?.type === 'NEWLINE') look++; continue; }
      return false;
    }
  };

  const makeNumLiteral = (tok) => {
    if (tok.numKind === 'Decimal') return AST.decimalLiteral(tok.value);
    if (tok.numKind === 'Float')   return AST.floatLiteral(tok.value);
    return AST.intLiteral(tok.value );
  };

  function expect(type, value) {
    const tok = consume();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''}, got ${tok.type} '${tok.value}'`);
    }
    return tok;
  }

  // ── Type parsing ─────────────────────────────────────────────────────────────

  const BUILT_IN_SINGULAR = new Map([
    ['Integer','Integers'],['Text','Texts'],['Float','Floats'],
    ['Boolean','Booleans'],['List','Lists'],['Blob','Blobs'],
  ]);
  const PLURAL_TO_SINGULAR = new Map([...BUILT_IN_SINGULAR.entries()].map(([s,p])=>[p,s]));
  const BUILT_IN_PLURAL = new Set(PLURAL_TO_SINGULAR.keys());

  function typeLength(offset) {
    if (tokens[offset]?.type !== 'IDENT') return 0;
    let len = 1;
    if (tokens[offset+1]?.type === 'KEYWORD' && tokens[offset+1]?.value === 'of') {
      const inner = typeLength(offset + 2);
      if (inner > 0) len += 1 + inner;
    }
    // Union suffix: | Type or | null, repeatable
    while (true) {
      const after = offset + len;
      if (tokens[after]?.type !== 'PIPE') break;
      const nxt = tokens[after+1];
      if (nxt?.type === 'KEYWORD' && nxt.value === 'null') { len += 2; continue; }
      if (nxt?.type === 'IDENT' && /^[A-Z]/.test(nxt.value)) {
        const inner = typeLength(after + 1);
        if (inner > 0) { len += 1 + inner; continue; }
      }
      break;
    }
    return len;
  }

  // Parse a single non-union type: a base name with optional `of <type>` or `.Member`.
  // The atomic form excludes union pipes; parseType wraps this with union handling.
  function parseAtomicType(inOf = false) {
    if (peek().type === 'LPAREN') {
      return parseParenType();
    }
    const tok = consume();
    if (tok.type !== 'IDENT')
      throw new Error(`Expected type name, got ${tok.type} '${tok.value || ''}'`);
    const typeName = tok.value;
    if (!inOf && BUILT_IN_PLURAL.has(typeName)) {
      const s = PLURAL_TO_SINGULAR.get(typeName);
      throw new Error(`'${typeName}' is not a valid standalone type — use '${s}' or 'List of ${typeName}'`);
    }
    if (inOf && BUILT_IN_SINGULAR.has(typeName)) {
      throw new Error(`Use plural '${BUILT_IN_SINGULAR.get(typeName)}' not '${typeName}' after 'of'`);
    }
    if (typeName === 'Lists' && !(peek().type === 'KEYWORD' && peek().value === 'of')) {
      throw new Error(`'Lists' requires 'of <type>', e.g. 'Lists of Integers'`);
    }
    if (typeName === 'List' && !(peek().type === 'KEYWORD' && peek().value === 'of')) {
      return 'List of Anything'; // bare List = List of Anything (mixed elements)
    }
    if (peek().type === 'KEYWORD' && peek().value === 'of') {
      consume(); // 'of'
      return `${typeName} of ${parseAtomicType(true)}`;
    }
    if (peek().type === 'DOT' && tokens[pos+1]?.type === 'IDENT') {
      consume(); // .
      return `${typeName}.${consume().value}`;
    }
    // Cross-module type reference — `Service::Point`. The `::` separator
    // distinguishes a type identity from method-style member access (`.`).
    // See types-implementation-plan-2026-04-27 slice 6.
    if (peek().type === 'DCOLON' && tokens[pos+1]?.type === 'IDENT') {
      consume(); // ::
      return `${typeName}::${consume().value}`;
    }
    return typeName;
  }

  function parseType(inOf = false) {
    let result = parseAtomicType(inOf);
    // Union suffix — only at top level (not inside 'of').
    // Greedily consumes any number of `| Type` and `| null` segments.
    if (inOf) return result;
    while (peek().type === 'PIPE') {
      const nxt = tokens[pos + 1];
      if (nxt?.type === 'KEYWORD' && nxt.value === 'null') {
        consume(); // |
        consume(); // null
        result = `${result} | null`;
        continue;
      }
      if (nxt?.type === 'IDENT' && /^[A-Z]/.test(nxt.value)) {
        consume(); // |
        const member = parseAtomicType(false);
        result = `${result} | ${member}`;
        continue;
      }
      break;
    }
    return result;
  }

  function parseParenType() {
    // Either a function signature type: (..)->(..)
    // Or a structure-shaped type: (output: Text) / (Text)
    // We look ahead to see if the first paren group is followed by '->'.
    let i = pos;
    let depth = 0;
    while (i < tokens.length) {
      if (tokens[i].type === 'LPAREN') depth++;
      else if (tokens[i].type === 'RPAREN') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const after = tokens[i + 1];
    if (after?.type === '->') {
      return functionTypeToString(parseFunctionType());
    }
    return parseStructureType();
  }

  function parseStructureType() {
    expect('LPAREN');
    const fields = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // name: Type — named field (trailing colon)
        const name = consume().value;
        consume(); // COLON
        const t = parseType();
        fields.push(`${name}: ${t}`);
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'IDENT') {
        // name Type — named field (whitespace)
        const name = consume().value;
        const t = parseType();
        fields.push(`${name}: ${t}`);
      } else if (peek().type === 'IDENT') {
        // Unnamed type (single IDENT followed by comma/rparen)
        const t = parseType();
        fields.push(`${t}`);
      } else {
        throw new Error(`Expected type in structure type, got ${peek().type} '${peek().value || ''}'`);
      }
    }
    expect('RPAREN');
    return `(${fields.join(', ')})`;
  }

  function parseStructureConstructor() {
    expect('LPAREN');
    const args = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'NUMBER') {
        const numTok = consume();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ positional: true, expr: makeNumLiteral(numTok), type: typeName });
      } else if (peek().type === 'STRING' || peek().type === 'INTERP_STRING') {
        const expr = consumeStringExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ positional: true, expr, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ key, expr, type: typeName });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        args.push({ positional: true, expr: AST.identifier(name), type: null });
      } else {
        consume(); // skip unknown
      }
    }
    expect('RPAREN');
    return AST.structureConstructor(args);
  }

  function parseFunctionType() {
    expect('LPAREN');
    const inputs = [];
    while (peek().type !== 'RPAREN') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT') {
        const name = peek().value;
        if (tokens[pos + 1]?.type === 'COLON') {
          // name: Type — named field (trailing colon)
          consume(); // name
          consume(); // COLON
          const type = parseType();
          inputs.push({ name, type });
        } else if (tokens[pos + 1]?.type === 'IDENT') {
          // name Type — named field (whitespace)
          consume(); // name
          const type = parseType();
          inputs.push({ name, type });
        } else {
          // Unnamed type
          const type = parseType();
          inputs.push({ type });
        }
      } else {
        throw new Error('Expected identifier or type in function type input');
      }
    }
    expect('RPAREN');
    expect('->');
    expect('LPAREN');
    const outputs = [];
    while (peek().type !== 'RPAREN') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT') {
        const name = peek().value;
        if (tokens[pos + 1]?.type === 'COLON') {
          // name: Type — named field (trailing colon)
          consume(); // name
          consume(); // COLON
          const type = parseType();
          outputs.push({ name, type });
        } else if (tokens[pos + 1]?.type === 'IDENT') {
          // name Type — named field (whitespace)
          consume(); // name
          const type = parseType();
          outputs.push({ name, type });
        } else {
          // Unnamed type
          const type = parseType();
          outputs.push({ type });
        }
      } else {
        throw new Error('Expected identifier or type in function type output');
      }
    }
    expect('RPAREN');
    return AST.functionType(inputs, outputs);
  }

  function functionTypeToString(functionType) {
    const fmtSide = (items) => items.map(item => {
      if (item.name !== undefined) return `${item.name}: ${item.type}`;
      return `${item.type}`;
    }).join(', ');
    return `(${fmtSide(functionType.inputs)}) -> (${fmtSide(functionType.outputs)})`;
  }

  function getFunctionLiteralSignature(fnNode) {
    if (fnNode.type !== 'Function') return null;
    if (fnNode.returnType == null) {
      throw new Error('Function signature requires explicit return annotation');
    }
    const inputs = fnNode.params.map(p => {
      if (p.type == null) throw new Error('Function signature requires typed parameters');
      // Positional params ignore names
      if (p.positional === true) return `${p.type}`;
      // Named params require name + type
      return `${p.name}: ${p.type}`;
    }).join(', ');
    const out = (typeof fnNode.returnType === 'string' && fnNode.returnType.startsWith('(') && fnNode.returnType.endsWith(')'))
      ? fnNode.returnType.slice(1, -1)
      : fnNode.returnType;
    return `(${inputs}) -> (${out})`;
  }

  function checkFunctionSignature(fnSig, rhsExpr) {
    if (rhsExpr.type === 'Function') {
      const rhsSig = getFunctionLiteralSignature(rhsExpr);
      if (rhsSig !== fnSig) {
        throw new Error(`function signature mismatch: expected ${fnSig}, got ${rhsSig}`);
      }
      return;
    }
    if (rhsExpr.type === 'Identifier') {
      const rhsSig = fnSignatures.get(rhsExpr.name) ?? null;
      if (rhsSig === null) {
        throw new Error(`function signature mismatch: '${rhsExpr.name}' is not a typed function`);
      }
      if (rhsSig !== fnSig) {
        throw new Error(`function signature mismatch: expected ${fnSig}, got ${rhsSig}`);
      }
      return;
    }
    if (rhsExpr.type === 'FnRef') {
      const rhsSig = fnSignatures.get(rhsExpr.name) ?? null;
      if (rhsSig === null) return; // unknown — trust it
      if (rhsSig !== fnSig) {
        throw new Error(`function signature mismatch: expected ${fnSig}, got ${rhsSig}`);
      }
      return;
    }
    throw new Error('function signature mismatch');
  }

  function peekPastNewlines(from) {
    let i = from ?? pos;
    while (i < tokens.length && tokens[i].type === 'NEWLINE') i++;
    return i;
  }

  function appendTrailingBlocks(args, allowNewlines) {
    const blocks = [];
    while (true) {
      const lookPos = allowNewlines ? peekPastNewlines() : pos;
      if (tokens[lookPos]?.type === 'LPAREN' && isParenFunctionStart(lookPos)) {
        // Parens trailing block: (params) -> body  or  (params) { body }
        if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
        blocks.push(parseFunction());
      } else if (tokens[lookPos]?.type === 'IDENT' && tokens[lookPos + 1]?.type === '->') {
        // Bare-param trailing block: name -> body
        if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
        blocks.push(parseFunction());
      } else if (tokens[lookPos]?.type === 'EQUALS') {
        // Lineal trailing block: = params = body
        if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
        blocks.push(parseLinealTrailingBlock());
      } else {
        break;
      }
    }
    if (blocks.length === 0) return;
    const last = args[args.length - 1];
    if (last?.type === 'NamedArgsBag') {
      args.splice(args.length - 1, 0, ...blocks);
    } else {
      args.push(...blocks);
    }
  }

  // Parse a lineal trailing block: = params = body
  // Used after over/reduce when the function is in lineal form
  function parseLinealTrailingBlock() {
    consume(); // first =
    skipNewlines();

    // Parse params between the two = delimiters
    const params = [];
    let afterNewline = true;
    while (peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE') { consume(); afterNewline = true; continue; }
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'EQUALS' && afterNewline) {
        consume(); // second = delimiter
        break;
      }
      if (isParamStart()) {
        const p = parseOneParam();
        if (p) { params.push(p); afterNewline = false; continue; }
      }
      break;
    }

    // Parse the body
    localScopes.push(new Set());
    refVarScopes.push(new Map());
    for (const p of params) if (p.name) declareLocal(p.name);
    const body = parseBody();
    refVarScopes.pop();
    localScopes.pop();

    // Convert Reply nodes to ImplicitReturn (this is a lambda context, not a handler)
    // Single positional → ImplicitReturn of the expression
    // Multiple fields or named → Return with fields (structure return)
    let returnType = null;
    for (let i = 0; i < body.length; i++) {
      if (body[i].type === 'Reply') {
        const fields = body[i].fields;
        if (fields.length === 1 && fields[0].positional) {
          // Single positional: -> expr : Type  →  ImplicitReturn
          const f = fields[0];
          returnType = f.type || null;
          body[i] = AST.implicitReturn(f.expr || AST.identifier(f.name ), returnType );
        } else {
          // Multi-field or named: keep as Return
          body[i] = AST.returnNode(fields);
          const f = fields[0];
          if (f && f.positional && f.type) returnType = f.type;
        }
      }
    }

    return AST.functionNode(params, body, { returnType });
  }

  function checkFunctionArgs(args, calleeName) {
    const slots = functionParamSlots.get(calleeName);
    if (!slots) return;
    const positional = args.filter(a => a.type !== 'NamedArgsBag');
    const namedBag = args.find(a => a.type === 'NamedArgsBag');
    for (const slot of slots) {
      const arg = typeof slot === 'number' ? positional[slot] : namedBag?.fields[slot];
      if (arg?.type === 'Identifier') {
        throw new Error(`'${calleeName}' parameter '${slot}' is a function — use &${arg.name} to pass by reference`);
      }
    }
  }

  function checkRefArgs(args, calleeName) {
    const slots = refParamSlots.get(calleeName);
    const positional = args.filter(a => a.type !== 'NamedArgsBag');
    const namedBag = args.find(a => a.type === 'NamedArgsBag');
    if (!slots) {
      // No ref params — disallow RefArg
      for (const arg of positional) {
        if (arg.type === 'RefArg') throw new Error(`Cannot pass &${arg.name} to non-ref parameter`);
      }
      if (namedBag) {
        for (const [key, val] of Object.entries(namedBag.fields)) {
          if (val.type === 'RefArg') throw new Error(`Cannot pass &${val.name} to non-ref parameter '${key}'`);
        }
      }
      return;
    }
    for (let i = 0; i < positional.length; i++) {
      if (slots.has(i) && positional[i].type !== 'RefArg') {
        throw new Error(`Parameter ${i} is ref — pass by reference using &`);
      }
      if (!slots.has(i) && positional[i].type === 'RefArg') {
        throw new Error(`Cannot pass &${positional[i].name} to non-ref parameter`);
      }
    }
    if (namedBag) {
      for (const [key, val] of Object.entries(namedBag.fields)) {
        if (slots.has(key) && val.type !== 'RefArg') {
          throw new Error(`Parameter '${key}' is ref — pass by reference using &`);
        }
        if (!slots.has(key) && val.type === 'RefArg') {
          throw new Error(`Cannot pass &${val.name} to non-ref parameter '${key}'`);
        }
      }
    }
  }

  function parseForwardCall(name) {
    const args = parseCallArgs();
    appendTrailingBlocks(args, true);
    checkFunctionArgs(args, name);
    checkRefArgs(args, name);
    return AST.functionCallExpr(AST.identifier(name), args);
  }

  // A named-arg key is an IDENT or KEYWORD followed by COLON. Accepting
  // KEYWORDs as keys lets HTML manifest slots like `:type` (collides with
  // the `type` keyword) be reachable from call sites — `input(type: "text")`.
  // The COLON gate ensures this only fires in named-arg position, where
  // bare keywords have no other meaning.
  function isNamedArgKey() {
    const t = peek().type;
    return (t === 'IDENT' || t === 'KEYWORD') && tokens[pos + 1]?.type === 'COLON';
  }

  function parseCallArgs() {
    expect('LPAREN');
    const _prevBare = bareFuncAllowed;
    bareFuncAllowed = true;
    const args = [];
    const namedArgs = {};
    let hasNamed = false;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (isNamedArgKey()) {
        const key = consume().value;
        consume();
        namedArgs[key] = parseExpr();
        hasNamed = true;
      } else {
        args.push(parseExpr());
      }
    }
    expect('RPAREN');
    bareFuncAllowed = _prevBare;
    if (hasNamed) args.push(AST.namedArgsBag(namedArgs));
    return args;
  }

  function parseSendArgs() {
    expect('LPAREN');
    const _prevBare = bareFuncAllowed;
    bareFuncAllowed = true;
    const args = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'SIGIL') {
        const name = consume().value;
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ name, typeName, positional: false });
      } else if (isNamedArgKey()) {
        // Named arg: key: value
        const name = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        args.push({ name, expr, typeName: null, positional: false });
      } else {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ expr, typeName, positional: true });
      }
    }
    expect('RPAREN');
    bareFuncAllowed = _prevBare;
    return args;
  }

  // Checks whether an LPAREN at startPos opens a function-literal param list.
  // Heuristic: scan to the matching RPAREN at depth 0 and check whether the
  // next token is `->` or `{` — markers that unambiguously indicate a
  // function-literal body. A standalone `.` (silent terminator, not followed
  // by an IDENT — i.e. not a method call) also counts.
  // When allowNewlines is true, NEWLINEs between `)` and the body marker are
  // skipped (used in declaration contexts where a multi-line form is allowed).
  function isParenFunctionStart(startPos, allowNewlines = false) {
    const p = startPos !== undefined ? startPos : pos;
    if (tokens[p]?.type !== 'LPAREN') return false;
    let depth = 0;
    for (let i = p; i < tokens.length; i++) {
      const t = tokens[i].type;
      if (t === 'LPAREN') depth++;
      else if (t === 'RPAREN') {
        depth--;
        if (depth === 0) {
          let j = i + 1;
          if (allowNewlines) while (tokens[j]?.type === 'NEWLINE') j++;
          const next = tokens[j];
          if (!next) return false;
          if (next.type === '->' || next.type === 'LBRACE') return true;
          // Silent terminator: `.` with no following IDENT/KEYWORD (i.e. not
          // a method-call dot — those are followed by an identifier).
          if (next.type === 'DOT') {
            const after = tokens[j + 1]?.type;
            return after !== 'IDENT' && after !== 'KEYWORD';
          }
          return false;
        }
      } else if (t === 'EOF') return false;
    }
    return false;
  }

  function parseFunctionParamsParen() {
    expect('LPAREN');
    const params = [];
    const isParamDelim = () => {
      const t = peek().type;
      return t === 'COMMA' || t === 'RPAREN' || t === 'EOF';
    };
    const peekIsType = () => {
      if (peek().type === 'LPAREN') return true; // function type: (Integer) -> (Integer)
      if (peek().type !== 'IDENT') return false;
      const next = tokens[pos + 1]?.type;
      if (next === 'EQUALS') {
        // IDENT = ... — could be "Type = default" or "name = value"
        // If IDENT starts with uppercase, it's a type with default
        return /^[A-Z]/.test(peek().value);
      }
      return true;
    };
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'ELLIPSIS') {
        consume(); // ...
        const name = expect('IDENT').value;
        let type = null;
        if (!isParamDelim() && peekIsType()) { type = parseType(); }
        params.push({ name, type, rest: true, positional: true });
        continue;
      }
      // :name — named param (prefix sigil)
      if (peek().type === 'SIGIL') {
        const name = consume().value;
        if (peek().type === 'STAR') {
          // :name * — named ref param (wildcard, no explicit type)
          consume();
          params.push({ name, type: 'Anything', positional: false, ref: true });
        } else {
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          const isRef = type !== null && peek().type === 'BANG';
          if (isRef) consume(); // !
          params.push({ name, type, positional: false, ...(isRef && { ref: true }) });
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // key: (alias) — named arg with key remap (key ≠ local)
        const name = consume().value;
        consume(); // COLON
        if (peek().type === 'LPAREN') {
          // key: (alias) [Type]
          consume(); // LPAREN
          const alias = expect('IDENT').value;
          expect('RPAREN');
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          params.push({ key: name, name: alias, type });
        } else if (peek().type === 'SIGIL') {
          // key: :accessor Type — remap accessor name
          const accessor = consume().value;
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          params.push({ key: name, name: accessor, type, accessor });
        } else {
          throw new Error(`Named param '${name}:' is no longer valid. Use ':${name}' (prefix sigil) instead, or '${name}: (alias)' for key remapping`);
        }
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        let type = null;
        if (!isParamDelim() && peekIsType()) { type = parseType(); }
        // Type! — ref param
        if (type && peek().type === 'BANG') {
          consume(); // !
          params.push({ name, type, positional: true, ref: true });
        } else {
          params.push({ name, type, positional: true });
        }
      } else {
        break;
      }
      // Check for = default on the last-pushed param
      if (peek().type === 'EQUALS' && params.length > 0) {
        consume(); // =
        const dv = parseDefaultLiteral();
        const p = params[params.length - 1];
        if (!p.type) p.type = inferDefaultType(dv);
        p.defaultValue = dv;
      }
    }
    expect('RPAREN');
    return params;
  }

  // Shared default-value helpers for parseFunctionParams
  function parseDefaultLiteral() {
    if (peek().type === 'NUMBER') return makeNumLiteral(consume());
    if (peek().type === 'STRING') return AST.stringLiteral(consume().value);
    if (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false')) return AST.boolLiteral(consume().value === 'true');
    if (peek().type === 'KEYWORD' && peek().value === 'null') { consume(); return AST.nullLiteral(); }
    if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') { consume(); consume(); return AST.structureLiteral([]); }
    throw new Error(`Expected literal default value, got ${peek().type} '${peek().value || ''}'`);
  }
  function inferDefaultType(node) {
    if (node.type === 'IntLiteral') return 'Integer';
    if (node.type === 'DecimalLiteral') return 'Decimal';
    if (node.type === 'FloatLiteral') return 'Float';
    if (node.type === 'StringLiteral') return 'Text';
    if (node.type === 'BoolLiteral') return 'Boolean';
    return null;
  }

  function parseWhileBody() {
    const body = [];
    while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'RBRACE' || peek().type === 'EOF') break;
      if (peek().type === '->') {
        consume();
        body.push(AST.returnNode(parseReplyFields(true)));
        continue;
      }
      // Block-label syntax inside while body — same desugar as elsewhere.
      {
        const labeledNode = tryParseLabeledConstruct();
        if (labeledNode) {
          body.push(labeledNode.isVoid
            ? AST.exprStatement(labeledNode)
            : AST.implicitReturn(labeledNode));
          continue;
        }
      }
      if (peek().type === 'KEYWORD' && peek().value === 'repeat') {
        // Nested repeat — supported when inside an enclosing labeled scope so
        // `if cond #label` can break out of the nested loop. The recursion
        // shares the same labelStack so HASH_IDENT resolution still works.
        body.push(parseRepeatStatement());
        continue;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'catch') {
        consume(); // 'catch'
        body.push(AST.exprStatement(parseCatchExpr()));
        continue;
      }
      if (peek().type === 'HASH_IDENT' && labelStack.includes('#' + peek().value)) {
        // Label invocation as a statement (bare, empty parens, or value form).
        const tok = consume();
        const labelName = '#' + tok.value;
        let valueExpr = null;
        if (peek().type === 'LPAREN') {
          consume();
          if (peek().type !== 'RPAREN') valueExpr = parseExpr();
          expect('RPAREN');
        }
        body.push(AST.exprStatement(AST.labelInvoke(labelName, valueExpr)));
        continue;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'if') {
        consume(); // 'if'
        const _prevBare = bareFuncAllowed;
        bareFuncAllowed = false;
        const cond = parseExpr();
        bareFuncAllowed = _prevBare;
        skipNewlines();
        const isLabelExit = peek().type === 'HASH_IDENT' && labelStack.includes('#' + peek().value);
        if (peek().type !== 'LBRACE' && peek().type !== '->' && !isLabelExit) {
          throw new Error(`Expected '{', '->', or label exit after if condition in while body`);
        }
        const thenBranch = parseIfBranch();
        let elseBranch = null;
        skipNewlines();
        if (peek().type === 'KEYWORD' && peek().value === 'else') {
          consume(); // else
          skipNewlines();
          if (peek().type === 'KEYWORD' && peek().value === 'if') {
            consume(); // if
            elseBranch = parseIfExpr();
          } else {
            elseBranch = parseIfBranch();
          }
        }
        body.push(AST.implicitReturn(AST.ifExpr(cond, thenBranch, elseBranch)));
        continue;
      }
      if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        if (!isRef(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '!' variables support '${isUpdate ? '<|' : '<-'}'`);
        consume(); // SET (<-) or UPDATE (<|)
        const value = parseExpr();
        body.push(AST.setStatement(name, value, { updateOp: isUpdate ? '<|' : undefined }));
      } else if (isTypedAssignStart()) {
        parseTypedAssign(body);
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        declareLocal(name);
        const value = parseRHSValue();
        body.push(value.type === 'TypedValue'
          ? AST.typedAssign(name, value.typeName, value.expr)
          : AST.assign(name, value));
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push(AST.stateAssign(name, value));
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN') {
        const expr = parseExpr();
        pushExprOrBang(body, expr);
      } else {
        throw new Error(`Unexpected token in while body: ${peek().type} '${peek().value || ''}'`);
      }
    }
    return body;
  }

  function parseRepeatStatement() {
    consume(); // 'repeat'
    const next = peek();
    if (next.type !== 'KEYWORD' || (next.value !== 'while' && next.value !== 'until')) {
      throw new Error(`Expected 'while' or 'until' after 'repeat', got ${next.type} '${next.value || ''}'`);
    }
    const negated = next.value === 'until';
    consume(); // 'while' or 'until'
    // Optional parens around condition — detect by scanning for matching ) followed by { or stmt
    let hasParen = false;
    if (peek().type === 'LPAREN') {
      let depth = 0, i = pos;
      while (i < tokens.length) {
        if (tokens[i].type === 'LPAREN') depth++;
        else if (tokens[i].type === 'RPAREN') { depth--; if (depth === 0) break; }
        i++;
      }
      const after = tokens[i + 1];
      hasParen = after && (after.type === 'LBRACE' || after.type === 'DOLLAR_IDENT' || (after.type === 'IDENT' && tokens[i + 2]?.type === 'EQUALS'));
    }
    if (hasParen) consume();
    const cond = parseExpr();
    if (hasParen) expect('RPAREN');
    if (peek().type === 'LBRACE') {
      // Block form
      consume();
      const body = parseWhileBody();
      expect('RBRACE');
      return AST.whileStatement(cond, body, negated);
    }
    // Single-line form: repeat while/until <cond> <stmt>
    const body = [];
    if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
      const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
      const name = consume().value;
      if (!isRef(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '!' variables support '${isUpdate ? '<|' : '<-'}'`);
      consume(); // SET (<-) or UPDATE (<|)
      const value = parseExpr();
      body.push(AST.setStatement(name, value, { updateOp: isUpdate ? '<|' : undefined }));
    } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
      const name = consume().value;
      consume(); // EQUALS
      const value = parseExpr();
      body.push(AST.stateAssign(name, value));
    } else if (isTypedAssignStart()) {
      parseTypedAssign(body);
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
      const name = consume().value;
      consume(); // EQUALS
      declareLocal(name);
      const value = parseRHSValue();
      body.push(value.type === 'TypedValue'
        ? AST.typedAssign(name, value.typeName, value.expr)
        : AST.assign(name, value));
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN') {
      const expr = parseExpr();
      pushExprOrBang(body, expr);
    } else {
      throw new Error(`Unexpected token in while body: ${peek().type} '${peek().value || ''}'`);
    }
    return AST.whileStatement(cond, body, negated);
  }

  function parseFunctionBody(stopToken = 'RBRACE', { implicitReplyFields = false } = {}) {
    const body = [];
    while (peek().type !== stopToken && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === stopToken || peek().type === 'EOF') break;
      if (peek().type === 'DOT') {
        consume();
        body.push(AST.silentTerminator());
        break;
      }
      // Block-label syntax: `#label <if|repeat|over|{}>` desugars to
      // `catch #label { construct }`. See spec §5.
      {
        const labeledNode = tryParseLabeledConstruct();
        if (labeledNode) {
          body.push(labeledNode.isVoid
            ? AST.exprStatement(labeledNode)
            : AST.implicitReturn(labeledNode));
          continue;
        }
      }
      if (peek().type === '->') {
        consume(); // '->'
        if (peek().type === 'DOT') {
          consume(); // '.'
          body.push(AST.silentTerminator());
          break;
        }
        body.push(AST.returnNode(parseReplyFields(true) ));
      } else if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        if (!isRef(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '!' variables support '${isUpdate ? '<|' : '<-'}'`);
        consume(); // SET (<-) or UPDATE (<|)
        // Check if first arg is named (key: value)
        if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
          const args = [];
          const key = consume().value; consume(); // COLON
          args.push({ name: key, expr: parseExpr(), positional: false });
          while (peek().type === 'COMMA') {
            consume();
            if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
              const k = consume().value; consume(); // COLON
              args.push({ name: k, expr: parseExpr(), positional: false });
            } else {
              args.push({ expr: parseExpr(), positional: true });
            }
          }
          body.push(AST.actorSetStatement(name, args, { updateOp: isUpdate ? '<|' : undefined }));
        } else {
          const firstExpr = parseExpr();
          if (peek().type === 'COMMA') {
            const args = [{ expr: firstExpr, positional: true }];
            while (peek().type === 'COMMA') {
              consume();
              if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
                const key = consume().value; consume(); // COLON
                args.push({ name: key, expr: parseExpr(), positional: false });
              } else {
                args.push({ expr: parseExpr(), positional: true });
              }
            }
            body.push(AST.actorSetStatement(name, args, { updateOp: isUpdate ? '<|' : undefined }));
          } else {
            body.push(AST.setStatement(name, firstExpr, { updateOp: isUpdate ? '<|' : undefined }));
          }
        }
      } else if (isTypedAssignStart()) {
        if (isRef(peek().value)) {
          throw new Error(`Cannot re-bind ref '${peek().value}' with typed assignment — use '${peek().value} <- value' to set`);
        }
        parseTypedAssign(body);
      } else if (isBareTypeDeclStart()) {
        const name = consume().value;
        const typeName = parseType();
        declareLocal(name);
        body.push(AST.bareTypeDecl(name, typeName));
      } else if (implicitReplyFields && isDestructureStart()) {
        // Ambiguous: could be destructure OR implicit return — try reply fields, check for stop
        const savedPos2 = pos;
        const fields = parseReplyFields(true);
        if (fields.length > 0 && (peek().type === stopToken || peek().type === 'EOF')) {
          body.push(AST.reply(fields));
        } else {
          pos = savedPos2;
          if (peek().type === 'LBRACKET') {
            const stmt = parseListDestructureAssign();
            for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
            body.push(stmt);
          } else {
            const stmt = parseDestructureAssign();
            for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
            body.push(stmt);
          }
        }
      } else if (isDestructureStart()) {
        if (peek().type === 'LBRACKET') {
          const stmt = parseListDestructureAssign();
          for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
          body.push(stmt);
        } else {
          const stmt = parseDestructureAssign();
          for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
          body.push(stmt);
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        if (isRef(name)) {
          throw new Error(`Cannot re-bind ref '${name}' with '=' — use '${name} <- value' to set`);
        }
        consume(); // EQUALS
        declareLocal(name);
        // name = TypeName!(args) — ref constructor form
        if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value) && tokens[pos + typeLength(pos)]?.type === 'BANG') {
          const typeName = parseType();
          consume(); // !
          addRef(name);
          const value = peek().type === 'LPAREN' ? parseForwardCall(typeName) : parseRHSValue();
          body.push(AST.refDecl(name, null, value));
        // name = *expr — ref declaration without explicit type (literal form)
        } else if (peek().type === 'STAR') {
          consume(); // *
          addRef(name);
          const value = parseRHSValue();
          if (value.type === 'TypedValue') {
            body.push(AST.refDecl(name, value.typeName, value.expr));
          } else {
            body.push(AST.refDecl(name, null, value));
          }
        } else {
          const value = parseRHSValue();
          if (value.type === 'Function') {
            functionNames.add(name);
            const slots = new Set();
            value.params.forEach((p, i) => {
              if (isFunctionType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
            });
            if (slots.size > 0) functionParamSlots.set(name, slots);
            const rSlots = new Set();
            value.params.forEach((p, i) => {
              if (p.ref) rSlots.add(p.positional ? i : (p.key ?? p.name));
            });
            if (rSlots.size > 0) refParamSlots.set(name, rSlots);
          }
          if (value.type === 'TypedValue') {
            body.push(AST.typedAssign(name, value.typeName, value.expr));
          } else {
            body.push(AST.assign(name, value));
          }
        }
      } else if (peek().type === 'HASH_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = '#' + consume().value;
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') {
          functionNames.add(name);
        }
        if (value.type === 'TypedValue') {
          body.push(AST.typedAssign(name, value.typeName, value.expr));
        } else {
          body.push(AST.assign(name, value));
        }
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push(AST.stateAssign(name, value));
      } else if (peek().type === 'KEYWORD' && peek().value === 'repeat') {
        body.push(parseRepeatStatement());
      } else if (implicitReplyFields) {
        // Implicit return — try reply field syntax first, fall back to expression
        const savedPos = pos;
        const fields = parseReplyFields(true);
        const next = peek().type;
        const isMultiOrNamed = fields.length > 1 || (fields.length === 1 && !fields[0].positional);
        if (isMultiOrNamed && (next === stopToken || next === 'EOF' || next === 'NEWLINE' || next === 'SEMICOLON')) {
          // Multi-value or named implicit return — new forms only parseReplyFields handles
          body.push(AST.reply(fields));
        } else {
          // Single-value — fall back to parseExpr which correctly resolves refs, state vars, etc.
          pos = savedPos;
          const expr = parseExpr();
          let typeName = null;
          if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
          body.push(AST.implicitReturn(expr, typeName));
        }
      } else {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
        body.push(AST.implicitReturn(expr, typeName));
      }
    }
    return body;
  }

  function parseFunction() {
    localScopes.push(new Set());
    refVarScopes.push(new Map());
    let params;
    if (peek().type === 'LPAREN') {
      params = parseFunctionParamsParen();
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === '->') {
      // Bare-param form: name -> expr (single generic param, no type)
      const name = consume().value;
      params = [{ name, type: null, positional: true }];
    } else {
      params = []; // no-arg: { body }
    }
    for (const p of params) {
      declareLocal(p.name);
      if (p.ref) addRef(p.name);
    }
    let returnType = null;
    function checkStateWrites(body) {
      if (returnType !== '.') {
        const stateWrite = body.find(s => s.type === 'StateAssign');
        if (stateWrite) {
          throw new Error(`Cannot write to state variable '$${stateWrite.name}' from inside a function — state vars are read-only in functions`);
        }
      }
    }
    // Explicit `->` body marker (everything except no-arg `{ ... }` lambdas).
    if (peek().type === '->') {
      consume(); // ->
      // Silent body: `-> .`
      if (peek().type === 'DOT') {
        consume();
        returnType = '.';
        refVarScopes.pop();
        localScopes.pop();
        return AST.functionNode(params, [], { returnType });
      }
      // Reject `(params) -> { ... }` — mixing arrow + braces is malformed.
      // For a block body, drop the arrow: `(params) { ... }`.
      if (peek().type === 'LBRACE') {
        throw new Error("'->' followed by '{' is not valid — for a block body, use '(params) { body }' (no arrow)");
      }
      // Set/Update statement body: `(x) -> name <- expr .` (silent set).
      // Mirrors Path 2b of the PIPE-form below.
      if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE') && isRef(tokens[pos].value)) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        consume(); // SET or UPDATE
        const firstExpr = parseExpr();
        if (peek().type === 'COMMA') {
          const setArgs = [{ expr: firstExpr, positional: true }];
          while (peek().type === 'COMMA') {
            consume();
            if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
              const key = consume().value; consume();
              setArgs.push({ name: key, expr: parseExpr(), positional: false });
            } else {
              setArgs.push({ expr: parseExpr(), positional: true });
            }
          }
          const body = [AST.actorSetStatement(name, setArgs, { updateOp: isUpdate ? '<|' : undefined })];
          skipNewlines();
          if (peek().type === 'DOT') { consume(); returnType = '.'; }
          refVarScopes.pop();
          localScopes.pop();
          return AST.functionNode(params, body, { returnType });
        }
        const body = [AST.setStatement(name, firstExpr, { updateOp: isUpdate ? '<|' : undefined })];
        skipNewlines();
        if (peek().type === 'DOT') { consume(); returnType = '.'; }
        refVarScopes.pop();
        localScopes.pop();
        return AST.functionNode(params, body, { returnType });
      }
      const expr = parseExpr();
      skipNewlines();
      if (peek().type === 'DOT') { consume(); returnType = '.'; }
      else if (isTypeAttestation()) { returnType = consumeTypeAttestation(); }
      else if (peek().type === 'COLON') { consume(); returnType = parseType(); }
      refVarScopes.pop();
      localScopes.pop();
      return AST.functionNode(params, null, { returnType, expr });
    }
    // Braced body: (params) { ... } or { ... } (no-arg)
    if (peek().type === 'LBRACE') {
      consume(); // {
      const body = parseFunctionBody('RBRACE', { implicitReplyFields: true });
      const isSilent = body.length > 0 && body[body.length - 1].type === 'SilentTerminator';
      if (isSilent) {
        body.pop();
        returnType = '.';
      }
      skipNewlines();
      expect('RBRACE');
      if (!isSilent && isTypeAttestation()) {
        returnType = consumeTypeAttestation();
      } else if (!isSilent && peek().type === 'COLON') {
        consume(); // COLON
        returnType = parseType();
      }
      // Reject -> after closing brace — return goes INSIDE braces
      if (peek().type === '->') {
        throw new Error("'->' after closing '}' is not valid — the return statement belongs inside the braces");
      }
      // Convert Reply nodes in braced body — same as lineal lambda conversion
      for (let i = 0; i < body.length; i++) {
        if (body[i].type === 'Reply') {
          const fields = body[i].fields;
          if (fields.length === 1 && fields[0].positional) {
            const f = fields[0];
            if (!returnType) returnType = f.type || null;
            body[i] = AST.implicitReturn(f.expr || AST.identifier(f.name ), f.type || null );
          } else {
            body[i] = AST.returnNode(fields);
            const f = fields[0];
            if (!returnType && f && f.positional && f.type) returnType = f.type;
          }
        }
      }
      // Assignment as last statement → implicit return of assigned value
      if (!isSilent && body.length > 0) {
        const last = body[body.length - 1];
        if (last.type === 'Assign' || last.type === 'TypedAssign') {
          const typeName = last.typeName || null;
          body.push(AST.implicitReturn(AST.identifier(last.name), typeName));
        }
      }
      checkStateWrites(body);
      refVarScopes.pop();
      localScopes.pop();
      return AST.functionNode(params, body, { returnType });
    }
    // Reaching here means params parsed but no body marker (`->` consumed
    // above, or `{` handled by Path 1). The grammar requires one.
    throw new Error(`Expected '->' or '{' after function params, got ${peek().type} '${peek().value || ''}'`);
  }

  function parseIfBranch() {
    if (peek().type === 'LBRACE') {
      consume(); // {
      skipNewlines();
      const body = parseFunctionBody();
      expect('RBRACE');
      return AST.ifBranch({ body });
    }
    if (peek().type === '->') {
      consume(); // ->
      return AST.ifBranch({ body: [AST.returnNode(parseReplyFields(true))] });
    }
    const expr = parseExpr();
    // Label invocation is non-returning control flow, not a value-bearing expr.
    // Wrap as body-form so block codegen emits a real `break <label>;` rather
    // than threading it through the tmpVar path used for IfExpr branches.
    if (expr.type === 'LabelInvoke') {
      return AST.ifBranch({ body: [AST.exprStatement(expr)] });
    }
    let typeName = null;
    if (isTypeAttestation()) {
      typeName = consumeTypeAttestation();
    }
    return AST.ifBranch({ expr, typeName });
  }

  function parseIfExpr() {
    const _prevBare = bareFuncAllowed;
    bareFuncAllowed = false;
    const cond = parseExpr();
    bareFuncAllowed = _prevBare;
    // Consume optional type annotation on the condition (e.g. `if 0 : Integer ...`)
    if (isTypeAttestation()) {
      consumeTypeAttestation();
    }
    const thenBranch = parseIfBranch();
    skipNewlines();
    let elseBranch = null;
    if (peek().type === 'KEYWORD' && peek().value === 'else') {
      consume(); // else
      if (peek().type === 'KEYWORD' && peek().value === 'if') {
        consume(); // if — else-if chain
        elseBranch = parseIfExpr();
      } else {
        elseBranch = parseIfBranch();
      }
    }

    // Compile error: branch type mismatch (only when both have explicit annotations)
    const thenType = thenBranch.typeName ?? null;
    const elseType = (elseBranch?.type === 'IfBranch') ? (elseBranch.typeName ?? null) : null;
    if (thenType && elseType && thenType !== elseType) {
      throw new Error(`Branch type mismatch: '${thenType}' vs '${elseType}'`);
    }

    return AST.ifExpr(cond, thenBranch, elseBranch);
  }

  function requireFunctionRef(fn, opName = 'over') {
    if (fn?.type === 'Identifier') {
      throw new Error(`'${opName}' requires a function reference — use &${fn.name}`);
    }
  }

  function parseReduceExpr() {
    if (peek().type === 'LPAREN') {
      // Delimited form: reduce(args...) [trailing-block]
      const args = parseCallArgs();
      appendTrailingBlocks(args, true);
      // Disambiguate by arg count:
      //   3 args          → initial, collection, fn
      //   2 args+trailing → initial, collection, fn=trailing (already in args)
      //   2 args          → collection, fn (no initial)
      //   1 arg+trailing  → collection, fn=trailing (already in args)
      if (args.length === 3) {
        requireFunctionRef(args[2], 'reduce');
        return AST.reduceExpr(args[0], args[1], args[2]);
      } else if (args.length === 2) {
        requireFunctionRef(args[1], 'reduce');
        return AST.reduceExpr(null, args[0], args[1]);
      } else {
        throw new Error("'reduce' requires at least a collection and a function");
      }
    } else {
      // Lineal form: reduce [initial,] collection[,] fn
      // Parse first expression with IDENT+fn-start disambiguation
      let expr1;
      if (peek().type === 'IDENT' && tokens[pos+1]?.type === 'LPAREN' && isParenFunctionStart(pos+1)) {
        expr1 = AST.identifier(consume().value );
      } else {
        expr1 = parseExpr();
      }
      if (peek().type !== 'COMMA') {
        // reduce collection (fn) — trailing block only
        const trailingArgs = [];
        appendTrailingBlocks(trailingArgs, true);
        if (trailingArgs.length === 0) throw new Error("'reduce' requires a function argument");
        requireFunctionRef(trailingArgs[0], 'reduce');
        return AST.reduceExpr(null, expr1, trailingArgs[0]);
      }
      expect('COMMA');
      // Have a comma — check if there's a second comma (3-arg form with explicit fn ref)
      let expr2;
      if (peek().type === 'IDENT' && tokens[pos+1]?.type === 'LPAREN' && isParenFunctionStart(pos+1)) {
        expr2 = AST.identifier(consume().value );
      } else {
        expr2 = parseExpr();
      }
      if (peek().type === 'COMMA') {
        // reduce initial, collection, &fn
        expect('COMMA');
        const fn = parsePrimary();
        requireFunctionRef(fn, 'reduce');
        return AST.reduceExpr(expr1, expr2, fn);
      }
      // reduce initial, collection (fn) OR reduce collection, &fn
      const trailingArgs = [];
      appendTrailingBlocks(trailingArgs, true);
      if (trailingArgs.length > 0) {
        // reduce initial, collection (fn)
        requireFunctionRef(trailingArgs[0], 'reduce');
        return AST.reduceExpr(expr1, expr2, trailingArgs[0]);
      }
      // No trailing block after second expr — must be: reduce collection, &fn
      // expr1 = collection, expr2 = fn (already consumed)
      requireFunctionRef(expr2, 'reduce');
      return AST.reduceExpr(null, expr1, expr2);
    }
  }

  function parseOverExpr() {
    if (peek().type === 'LPAREN') {
      // Delimited form: over(collection, fn) or over(collection) trailing-block
      const args = parseCallArgs();
      appendTrailingBlocks(args, true);
      requireFunctionRef(args[1]);
      return AST.overExpr(args[0], args[1] );
    } else {
      // No-paren form: over collection, fn  OR  over collection [trailing-block]
      const collection = parseExpr();
      if (peek().type === 'COMMA') {
        consume();
        const fn = parsePrimary();
        requireFunctionRef(fn);
        return AST.overExpr(collection, fn);
      }
      // Trailing block (delimited or lineal)
      const trailingArgs = [];
      appendTrailingBlocks(trailingArgs, true);
      if (trailingArgs.length === 0) throw new Error("'over' requires a function argument");
      requireFunctionRef(trailingArgs[0]);
      return AST.overExpr(collection, trailingArgs[0]);
    }
  }

  function parseXmlConstructor() {
    consume(); // <
    const name = consume().value; // IDENT (constructor name)
    const attrs = {};
    // Parse attributes until /> or >
    while (peek().type !== 'EOF') {
      // Self-closing: />
      if (peek().type === 'SLASH' && tokens[pos + 1]?.type === 'GT') {
        consume(); consume(); // / >
        break;
      }
      if (peek().type === 'NEWLINE') { consume(); continue; }
      // Attribute: name="value" or name={expr}
      if (peek().type !== 'IDENT') {
        throw new Error(`Expected attribute name or '/>' in XML tag <${name}>, got ${peek().type} '${peek().value || ''}'`);
      }
      const attrName = consume().value;
      expect('EQUALS');
      let attrValue;
      if (peek().type === 'STRING') {
        attrValue = AST.stringLiteral(consume().value);
      } else if (peek().type === 'LBRACE') {
        consume(); // {
        attrValue = parseExpr();
        expect('RBRACE');
      } else {
        throw new Error(`Expected string or {expression} for attribute '${attrName}' in <${name}>, got ${peek().type}`);
      }
      attrs[attrName] = attrValue;
    }
    // Desugar to FunctionCallExpr with NamedArgsBag
    const callee = AST.identifier(name);
    const args = Object.keys(attrs).length > 0
      ? [AST.namedArgsBag(attrs)]
      : [];
    const node = AST.functionCallExpr(callee, args);
    node.xmlConstructor = true; // flag for validation
    return node;
  }

  // Block-label syntax: `#label <construct>` (and optionally `end#label`)
  // desugars to `catch #label { <construct> }`. Section 5 of CATCH.md.
  //
  // Returns an AST node (or array of nodes) wrapped in a CatchExpr if the
  // current position starts with HASH_IDENT followed by a block-bearing
  // construct. Returns null otherwise.
  //
  // The optional `end#label` suffix is consumed and validated against the
  // opening label name. Mismatch is a parse error.
  function tryParseLabeledConstruct() {
    if (peek().type !== 'HASH_IDENT') return null;
    const labelName = '#' + peek().value;
    // An already-active label is either a (possibly value-carrying) invocation
    // or a shadowing attempt — let the surrounding code handle it.
    if (labelStack.includes(labelName)) return null;
    const next = tokens[pos + 1];
    const isBlockKeyword = next?.type === 'KEYWORD' &&
      (next.value === 'over' || next.value === 'repeat' || next.value === 'if');
    const isBlockBrace = next?.type === 'LBRACE';
    if (!isBlockKeyword && !isBlockBrace) return null;
    consume(); // HASH_IDENT
    labelStack.push(labelName);
    let body;
    try {
      if (isBlockBrace) {
        // `#label { body }` — body is parsed exactly like a catch body.
        consume(); // LBRACE
        body = parseFunctionBody('RBRACE');
        skipNewlines();
        expect('RBRACE');
      } else {
        // `#label <if|repeat|over ...>` — parse the construct as a single
        // statement and place it inside the catch's body.
        body = [parseLabeledStatement(next.value)];
      }
    } finally {
      labelStack.pop();
    }
    // Optional `end#label` validation.
    skipNewlines();
    if (peek().type === 'KEYWORD' && peek().value === 'end' &&
        tokens[pos + 1]?.type === 'HASH_IDENT') {
      const closingName = '#' + tokens[pos + 1].value;
      if (closingName !== labelName) {
        throw new Error(`end${closingName} does not match opening ${labelName}`);
      }
      consume(); // 'end'
      consume(); // HASH_IDENT
    }
    // Determine isVoid by inspecting collected invocations (mirrors parseCatchExpr).
    const invokes = collectLabelInvokesForLabel(body, labelName);
    const hasValue = invokes.some(li => li.valueExpr);
    const hasVoid = invokes.some(li => !li.valueExpr);
    if (hasValue && hasVoid) {
      throw new Error(`Inconsistent ${labelName}: cannot mix void and value invocations`);
    }
    return AST.catchExpr(labelName, body, { isVoid: !hasValue });
  }

  // Parse a single statement for use as the body of a labeled construct.
  // Reuses existing parsers but wraps the result in the form parseFunctionBody
  // would produce (Implicit/ExprStatement) so codegen sees a uniform body.
  function parseLabeledStatement(kw) {
    if (kw === 'repeat') {
      return parseRepeatStatement();
    }
    if (kw === 'if' || kw === 'over') {
      const expr = parseExpr();
      return AST.implicitReturn(expr);
    }
    throw new Error(`Internal: unexpected labeled-construct keyword '${kw}'`);
  }

  function parseCatchExpr() {
    // 'catch' keyword has just been consumed by parsePrimary's tok-consume.
    if (peek().type !== 'HASH_IDENT') {
      throw new Error(`Expected #label after 'catch', got ${peek().type} '${peek().value ?? ''}'`);
    }
    const labelTok = consume();
    const labelName = '#' + labelTok.value;
    if (labelStack.includes(labelName)) {
      throw new Error(`${labelName} shadows outer ${labelName}`);
    }
    expect('LBRACE');
    labelStack.push(labelName);
    let body;
    try {
      body = parseFunctionBody('RBRACE');
    } finally {
      labelStack.pop();
    }
    skipNewlines();
    expect('RBRACE');
    // Determine void vs value mode by scanning LabelInvoke nodes that target
    // this catch. Mode consistency (§3.3): if any invocation carries a value,
    // all invocations and the fall-through must.
    const invokes = collectLabelInvokesForLabel(body, labelName);
    const hasValue = invokes.some(li => li.valueExpr);
    const hasVoid = invokes.some(li => !li.valueExpr);
    if (hasValue && hasVoid) {
      throw new Error(`Inconsistent ${labelName}: cannot mix void and value invocations`);
    }
    return AST.catchExpr(labelName, body, { isVoid: !hasValue });
  }

  // Walk a body subtree and return every LabelInvoke targeting `labelName`,
  // skipping over any nested `catch` block that *shadows* this label (would
  // be a parse-time error today, but the walk is shadow-safe so future
  // relaxations won't silently miss-match).
  function collectLabelInvokesForLabel(body, labelName) {
    const out = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'CatchExpr' && node.label === labelName) return; // shadowed
      if (node.type === 'LabelInvoke' && node.label === labelName) { out.push(node); return; }
      for (const k in node) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    }
    walk(body);
    return out;
  }

  function parsePrimary() {
    // Block-label expression: `#label <if|repeat|over|{}>` desugars to
    // `catch #label { construct }`. See spec §5/§7. Detected here so the form
    // works in expression contexts (RHS of assign, function arg, etc).
    if (peek().type === 'HASH_IDENT' && !labelStack.includes('#' + peek().value)) {
      const next = tokens[pos + 1];
      const isBlockKeyword = next?.type === 'KEYWORD' &&
        (next.value === 'over' || next.value === 'repeat' || next.value === 'if');
      const isBlockBrace = next?.type === 'LBRACE';
      if (isBlockKeyword || isBlockBrace) {
        return tryParseLabeledConstruct();
      }
    }
    // Label invocation — must be checked before the generic HASH_IDENT path
    // below, because a label invocation is a control-flow leaf, not a value
    // identifier, and never participates in postfix calls/subscripts.
    if (peek().type === 'HASH_IDENT' && labelStack.includes('#' + peek().value)) {
      const tok = consume();
      const labelName = '#' + tok.value;
      // Bare `#label`, empty `#label()`, or value-carrying `#label(expr)`.
      if (peek().type === 'LPAREN') {
        consume(); // LPAREN
        if (peek().type === 'RPAREN') {
          consume();
          return AST.labelInvoke(labelName);
        }
        const valueExpr = parseExpr();
        expect('RPAREN');
        return AST.labelInvoke(labelName, valueExpr);
      }
      return AST.labelInvoke(labelName);
    }
    // Function literal: (params) -> expr or (params) { body }. Gated by
    // bareFuncAllowed so `if (a) -> branch` still parses `(a)` as the cond.
    if (bareFuncAllowed && peek().type === 'LPAREN' && isParenFunctionStart()) {
      return parseFunction();
    }
    // Bare-param: name -> expr (single generic param). Suppressed in
    // contexts where a trailing `->` belongs to an outer construct.
    if (bareFuncAllowed && peek().type === 'IDENT' && tokens[pos + 1]?.type === '->') {
      return parseFunction();
    }
    if (peek().type === 'LBRACE') {
      return parseFunction(); // no-arg function
    }

    // ── HTML literal: <tag>content</tag> ───────────────────────────────
    if (peek().type === 'HTML_LITERAL') {
      return AST.htmlLiteral(consume().value);
    }

    // ── HTML constructor: <tag>text{expr}more</tag> → DomConstructor ───
    if (peek().type === 'HTML_CONSTRUCTOR') {
      const tok = consume();
      if (tok.bvBlock !== undefined) {
        // Element with @decl or other Brevity attrs — parse the attr block as
        // an actor body (token-stream swap) and return AnonymousHtmlActor.
        // liftReactiveElements will merge the inner refs/closures into the
        // parent actor and replace this node with a DomConstructor.
        const savedTokens = tokens;
        const savedPos = pos;
        tokens = tokenize(tok.bvBlock);
        pos = 0;
        let actorBody;
        try {
          actorBody = parseActorBody(() => peek().type === 'EOF');
        } finally {
          tokens = savedTokens;
          pos = savedPos;
        }
        return AST.anonymousHtmlActor(tok.tag, actorBody, parseDomChildren(tok.children));
      }
      return AST.domConstructor(tok.tag, parseDomChildren(tok.children), parseAttrs(tok.attrs));
    }

    // ── XML constructor: <Name attr="val" attr2={expr} /> ──────────────
    if (peek().type === 'LT' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1].value)) {
      return parseXmlConstructor();
    }

    if (peek().type === 'IDENT' && peek().value === 'Structure' && tokens[pos + 1]?.type === 'LPAREN') {
      const tok = consume();
      return parseStructureConstructor(tok.value);
    }

    let result;
    if ((peek().type === 'IDENT' || peek().type === 'KEYWORD') && TEXT_METHODS.has(peek().value) && tokens[pos + 1]?.type === 'LPAREN') {
      const methodName = consume().value;
      consume(); // LPAREN
      const args = [parseExpr()];
      while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
      expect('RPAREN');
      if (methodName === 'size') {
        result = AST.sizeExpr(args[0]);
      } else {
        result = AST.textMethodExpr(methodName, args);
      }
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN' && !functionNames.has(tokens[pos].value) && !isKnownLocal(tokens[pos].value)) {
      const name = consume().value;
      result = parseForwardCall(name);
    } else {
      const tok = consume();
      if (tok.type === 'LPAREN') {
        // Grouped expression. `(expr)?` is the presence-check operator —
        // returns Boolean. The required parens prevent collision with
        // `?`-suffixed predicate field names. Slice 11 of
        // types-implementation-plan-2026-04-27.
        const _prevBare = bareFuncAllowed;
        bareFuncAllowed = true;
        const inner = parseExpr();
        bareFuncAllowed = _prevBare;
        expect('RPAREN');
        if (peek().type === 'QUESTION') {
          consume();
          result = AST.presenceCheck(inner);
        } else {
          result = inner;
        }
      } else if (tok.type === 'IDENT') {
        result = isRef(tok.value)
          ? AST.refRead(tok.value )
          : AST.identifier(tok.value );
      } else if (tok.type === 'NUMBER') {
        result = makeNumLiteral(tok);
      } else if (tok.type === 'STRING') {
        result = AST.stringLiteral(tok.value );
      } else if (tok.type === 'INTERP_STRING') {
        result = buildInterpolatedString(tok.parts);
      } else if (tok.type === 'LBRACKET') {
        const elements = [];
        while (peek().type !== 'RBRACKET' && peek().type !== 'EOF') {
          if (peek().type === 'COMMA') { consume(); continue; }
          elements.push(parseExpr());
        }
        expect('RBRACKET');
        result = AST.listLiteral(elements);
      } else if (tok.type === 'REGEX') {
        result = AST.regexLiteral(tok.pattern, tok.flags);
      } else if (tok.type === 'KEYWORD' && tok.value === 'null') {
        result = AST.nullLiteral();
      } else if (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false')) {
        result = AST.boolLiteral(tok.value === 'true' );
      } else if (tok.type === 'KEYWORD' && tok.value === 'if') {
        result = parseIfExpr();
      } else if (tok.type === 'KEYWORD' && tok.value === 'over') {
        result = parseOverExpr();
      } else if (tok.type === 'KEYWORD' && tok.value === 'reduce') {
        result = parseReduceExpr();
      } else if (tok.type === 'KEYWORD' && tok.value === 'catch') {
        result = parseCatchExpr();
      } else if (tok.type === 'AMPERSAND_IDENT') {
        if (isRef(tok.value)) {
          result = AST.refArg(tok.value );
        } else if (isKnownLocal(tok.value) || functionNames.has(tok.value)) {
          result = AST.fnRef(tok.value );
        } else {
          result = AST.fnRef(tok.value );
        }
      } else if (tok.type === 'DOLLAR_IDENT') {
        result = AST.stateVar(tok.value );
      } else if (tok.type === 'HASH_IDENT') {
        result = AST.identifier('#' + tok.value);
      } else if (tok.type === 'AT' && peek().type === 'IDENT') {
        // @pub as a primary expression. If @name matches a public ref cell
        // (addRef('@name') was called), produce RefRead('@name') so template
        // interpolations and expressions react to the underlying cell.
        // Otherwise it's a reference to a public handler (Identifier).
        const name = '@' + consume().value;
        result = isRef(name) ? AST.refRead(name) : AST.identifier(name);
      } else {
        throw new Error(`Unexpected token in expression: ${tok.type} '${tok.value}'`);
      }
    }
    while (peek().type === 'LPAREN') {
      const args = parseCallArgs();
      appendTrailingBlocks(args, false);
      if (result.type === 'Identifier') {
        checkFunctionArgs(args, result.name);
        checkRefArgs(args, result.name);
      }
      result = AST.functionCallExpr(result, args);
    }
    // Subscript: expr[0] or expr["key"]
    while (peek().type === 'LBRACKET') {
      consume(); // [
      const keyTok = consume();
      expect('RBRACKET');
      if (keyTok.type === 'NUMBER') {
        result = AST.indexExpr(result, { index: keyTok.value });
      } else if (keyTok.type === 'STRING') {
        result = AST.indexExpr(result, { key: keyTok.value });
      }
    }
    // Dot-call: expr.method(args), expr.method!(args), or dot-access: expr.property
    const _isMethodKeyword = () => tokens[pos + 1]?.type === 'KEYWORD' && (TEXT_METHODS.has(tokens[pos + 1]?.value) || BLOB_METHODS.has(tokens[pos + 1]?.value) || GRAPHEME_TEXT_METHODS.has(tokens[pos + 1]?.value) || LIST_METHODS.has(tokens[pos + 1]?.value));
    const _isSubscribe = () => tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1]?.value === 'subscribe';
    while (peek().type === 'DOT' && (tokens[pos + 1]?.type === 'IDENT' || _isMethodKeyword() || _isSubscribe())) {
      // .subscribe(args) |params| { body } — subscription call-site; terminates the dot-chain.
      // `args` are forwarded to the publisher's fn body per subscription;
      // `params` bind the incoming re payload on the caller side.
      if (_isSubscribe()) {
        consume(); // DOT
        consume(); // subscribe
        let subArgs = [];
        let subParams = [];
        // (args) — only if next isn't a `(params) ->` / `(params) {` shape.
        if (peek().type === 'LPAREN' && !isParenFunctionStart()) {
          subArgs = parseSendArgs();
        }
        if (peek().type === 'LPAREN' && isParenFunctionStart()) {
          subParams = parseFunctionParamsParen();
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === '->') {
          // Bare-param form: .subscribe(args) name -> body
          const pName = consume().value;
          subParams.push({ name: pName, type: null, positional: true });
        }
        for (const p of subParams) if (p.name) declareLocal(p.name);
        skipNewlines();
        let subBody;
        if (peek().type === 'LBRACE') {
          consume();
          subBody = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          subBody = parseBody();
        }
        result = AST.subscribeCall(result, subParams, subBody, subArgs);
        break;
      }
      consume(); // DOT
      let method = (peek().type === 'KEYWORD' && (TEXT_METHODS.has(peek().value) || BLOB_METHODS.has(peek().value) || GRAPHEME_TEXT_METHODS.has(peek().value) || LIST_METHODS.has(peek().value) || MATH_METHODS.has(peek().value))) ? consume().value : expect('IDENT').value;
      if (peek().type === 'BANG') {
        consume(); // !
        method += '!';
      }
      const cleanMethod = method.endsWith('!') ? method.slice(0, -1) : method;
      const isBang = method.endsWith('!');
      if (result.type === 'Identifier' && result.name === 'Text' && TEXT_METHODS.has(cleanMethod) && peek().type === 'LPAREN') {
        assertNoBangFunctional('Text', cleanMethod, isBang);
        expect('LPAREN');
        const args = [parseExpr()];
        while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
        expect('RPAREN');
        result = cleanMethod === 'size' ? AST.sizeExpr(args[0]) : AST.textMethodExpr(cleanMethod, args);
      } else if (result.type === 'Identifier' && result.name === 'Blob' && BLOB_METHODS.has(cleanMethod) && peek().type === 'LPAREN') {
        assertNoBangFunctional('Blob', cleanMethod, isBang);
        expect('LPAREN');
        const args = [parseExpr()];
        while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
        expect('RPAREN');
        result = AST.blobMethodExpr(cleanMethod, args);
      } else if (result.type === 'Identifier' && result.name === 'List' && LIST_METHODS.has(cleanMethod) && peek().type === 'LPAREN') {
        assertNoBangFunctional('List', cleanMethod, isBang);
        expect('LPAREN');
        const args = [parseExpr()];
        while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
        expect('RPAREN');
        result = AST.listMethodExpr(cleanMethod, args);
      } else if (result.type === 'RefRead' && refType(result.name)?.startsWith('List') && LIST_METHODS.has(cleanMethod)) {
        assertBangValidRef('List', cleanMethod, isBang, LIST_METHODS);
        const info = LIST_METHODS.get(cleanMethod);
        const args = [result];
        if (info.arity[0] > 1 && peek().type === 'LPAREN') {
          consume(); // LPAREN
          args.push(parseExpr());
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
        }
        result = AST.listMethodExpr(cleanMethod, args, { bang: isBang });
      } else if (result.type === 'RefRead' && refType(result.name) === 'Blob' && BLOB_METHODS.has(cleanMethod)) {
        assertBangValidRef('Blob', cleanMethod, isBang, BLOB_METHODS);
        const info = BLOB_METHODS.get(cleanMethod);
        const args = [result];
        if (info.arity[0] > 1 && peek().type === 'LPAREN') {
          consume(); // LPAREN
          args.push(parseExpr());
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
        }
        result = AST.blobMethodExpr(cleanMethod, args, { bang: isBang });
      } else if (result.type === 'RefRead' && refType(result.name) === 'GraphemeText' && GRAPHEME_TEXT_METHODS.has(cleanMethod)) {
        assertBangValidRef('GraphemeText', cleanMethod, isBang, GRAPHEME_TEXT_METHODS);
        const info = GRAPHEME_TEXT_METHODS.get(cleanMethod);
        const args = [result];
        if (info.arity[0] > 1 && peek().type === 'LPAREN') {
          consume(); // LPAREN
          args.push(parseExpr());
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
        }
        result = cleanMethod === 'size' ? AST.sizeExpr(result) : AST.graphemeTextMethodExpr(cleanMethod, args, { bang: isBang });
      } else if (result.type === 'RefRead' && TEXT_METHODS.has(cleanMethod)) {
        assertBangValidRef('Text', cleanMethod, isBang, TEXT_METHODS);
        const info = TEXT_METHODS.get(cleanMethod);
        const args = [result];
        if (info.arity[0] > 1 && peek().type === 'LPAREN') {
          consume(); // LPAREN
          args.push(parseExpr());
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
        }
        result = cleanMethod === 'size' ? AST.sizeExpr(result) : AST.textMethodExpr(cleanMethod, args, { bang: isBang });
      } else if (result.type === 'Identifier' && (result.name === 'Math' || result.name === 'Integer' || result.name === 'Float' || result.name === 'Decimal') && MATH_METHODS.has(cleanMethod) && (peek().type === 'LPAREN' || MATH_METHODS.get(cleanMethod).arity[0] === 0)) {
        // Math.method(args), Integer/Float/Decimal.to_*() — functional syntax
        const info = MATH_METHODS.get(cleanMethod);
        if (info.arity[0] === 0 && peek().type !== 'LPAREN') {
          // 0-arity constant: Math.pi, Math.e
          result = AST.mathMethodExpr(cleanMethod, []);
        } else {
          expect('LPAREN');
          const args = [parseExpr()];
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
          result = AST.mathMethodExpr(cleanMethod, args);
        }
      } else if (result.type === 'RefRead' && MATH_METHODS.has(cleanMethod)) {
        // refvar.method() — dot-method on numeric ref cell
        const info = MATH_METHODS.get(cleanMethod);
        const args = [result];
        if (info.arity[0] > 1 && peek().type === 'LPAREN') {
          consume(); // LPAREN
          args.push(parseExpr());
          while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
          expect('RPAREN');
        }
        result = AST.mathMethodExpr(cleanMethod, args);
      } else if (peek().type === 'LPAREN') {
        const args = parseSendArgs();
        result = AST.dotCallExpr(result, method, args);
      } else {
        result = AST.dotAccessExpr(result, method);
      }
    }
    return result;
  }

  const CMP_OPS = new Map([
    ['EQ','==='],['NEQ','!=='],['GT','>'],['LT','<'],['GTE','>='],['LTE','<='],
  ]);

  function parseExpExpr() {
    let base = parsePrimary();
    if (peek().type === 'POWER') {
      consume();
      return AST.binaryExpr('**', base, parseExpExpr());
    }
    return base;
  }

  function parseMulExpr() {
    let left = parseExpExpr();
    while (['STAR', 'SLASH', 'PERCENT'].includes(peek().type)) {
      const op = consume().value;
      left = AST.binaryExpr(op, left, parseExpExpr());
    }
    return left;
  }

  function parseAddExpr() {
    let left = parseMulExpr();
    while (['PLUS', 'MINUS'].includes(peek().type)) {
      const op = consume().value;
      left = AST.binaryExpr(op, left, parseMulExpr());
    }
    return left;
  }

  function parseExpr() {
    let left = parseAddExpr();
    // >> prepend operator. Right-associative; checked before CMP_OPS so the
    // GT GT pair isn't mis-parsed as comparison `>` followed by an unexpected
    // `>`. Statement-level only — pushExprOrBang desugars to SetStatement;
    // validate.js rejects any leftover BinaryExpr('>>') as a sub-expression.
    if (peekIsPrepend()) {
      consumeOverloadOp();
      return AST.binaryExpr('>>', left, parseExpr());
    }
    if (CMP_OPS.has(peek().type)) {
      const tok = consume();
      left = AST.binaryExpr(CMP_OPS.get(tok.type), left, parseAddExpr());
    }
    // Slice 11 of types-implementation-plan-2026-04-27: `??` fallback.
    // Right-associative — `a ?? b ?? c` is `a ?? (b ?? c)`.
    if (peek().type === 'NULL_COALESCE') {
      consume();
      left = AST.binaryExpr('??', left, parseExpr());
    }
    return left;
  }

  // Check for type attestation: `as Type` only
  function isTypeAttestation() {
    return peek().type === 'KEYWORD' && peek().value === 'as' &&
           (
             (tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1].value)) ||
             tokens[pos + 1]?.type === 'LPAREN'
           );
  }

  // Consume type attestation (`as Type`) and return the type
  function consumeTypeAttestation() {
    consume(); // 'as'
    return parseType();
  }

  function parseSigilWithType() {
    const name = consume().value; // SIGIL
    let typeName = null;
    if (isTypeAttestation()) {
      typeName = consumeTypeAttestation();
    }
    return { name, type: typeName };
  }

  function parseReplyFields(sameLine = false) {
    const fields = [];
    const hasParen = peek().type === 'LPAREN';
    if (hasParen) consume();
    while (true) {
      if (hasParen || !sameLine) skipNewlines();
      if (hasParen && peek().type === 'RPAREN') { consume(); break; }
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'NUMBER') {
        const numTok = consume();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr: makeNumLiteral(numTok), type: typeName, positional: true });
      } else if (peek().type === 'SIGIL') {
        const { name, type: fieldType } = parseSigilWithType();
        fields.push({ sigil: name, type: fieldType, ref: isRef(name) });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        if (peek().type === 'KEYWORD' && peek().value === 'as') {
          // positional with as-attestation: name as Type
          const typeName = consumeTypeAttestation();
          fields.push({ name, type: typeName, positional: true });
        } else if (peek().type === 'COLON') {
          consume();
          // key-value: key: expr [as Type]
          const value = parseExpr();
          let fieldType = null;
          if (isTypeAttestation()) fieldType = consumeTypeAttestation();
          fields.push({ key: name, value, type: fieldType });
        } else {
          // bare positional: variable ref, function/dot-call, or binary expression with optional type
          let exprNode = AST.identifier(name);
          while (peek().type === 'LPAREN' || peek().type === 'DOT') {
            if (peek().type === 'DOT') {
              consume(); // DOT
              const method = (peek().type === 'KEYWORD' && (TEXT_METHODS.has(peek().value) || BLOB_METHODS.has(peek().value))) ? consume().value : expect('IDENT').value;
              if (exprNode.type === 'Identifier' && exprNode.name === 'Text' && TEXT_METHODS.has(method) && peek().type === 'LPAREN') {
                expect('LPAREN');
                const args = [parseExpr()];
                while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
                expect('RPAREN');
                exprNode = method === 'size' ? AST.sizeExpr(args[0]) : AST.textMethodExpr(method, args);
              } else if (exprNode.type === 'Identifier' && exprNode.name === 'Blob' && BLOB_METHODS.has(method) && peek().type === 'LPAREN') {
                expect('LPAREN');
                const args = [parseExpr()];
                while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
                expect('RPAREN');
                exprNode = AST.blobMethodExpr(method, args);
              } else if (exprNode.type === 'Identifier' && isRef(exprNode.name) && refType(exprNode.name) === 'Blob' && BLOB_METHODS.has(method)) {
                const info = BLOB_METHODS.get(method);
                const args = [AST.refRead(exprNode.name)];
                if (info.arity[0] > 1 && peek().type === 'LPAREN') {
                  consume(); // LPAREN
                  args.push(parseExpr());
                  while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
                  expect('RPAREN');
                }
                exprNode = AST.blobMethodExpr(method, args);
              } else if (exprNode.type === 'Identifier' && isRef(exprNode.name) && TEXT_METHODS.has(method)) {
                const info = TEXT_METHODS.get(method);
                const args = [AST.refRead(exprNode.name)];
                if (info.arity[0] > 1 && peek().type === 'LPAREN') {
                  consume(); // LPAREN
                  args.push(parseExpr());
                  while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
                  expect('RPAREN');
                }
                exprNode = method === 'size' ? AST.sizeExpr(AST.refRead(exprNode.name)) : AST.textMethodExpr(method, args);
              } else if (peek().type === 'LPAREN') {
                const args = parseSendArgs();
                exprNode = AST.dotCallExpr(exprNode, method, args);
              } else {
                exprNode = AST.dotAccess(exprNode, method);
              }
            } else {
              const args = parseCallArgs();
              exprNode = AST.functionCallExpr(exprNode, args);
            }
          }
          while (['PLUS', 'MINUS', 'STAR', 'SLASH', 'PERCENT', 'POWER'].includes(peek().type)) {
            const op = consume().value;
            exprNode = AST.binaryExpr(op, exprNode, parsePrimary());
          }
          let typeName = null;
          if (isTypeAttestation()) {
            typeName = consumeTypeAttestation();
          }
          if (exprNode.type === 'Identifier' && typeName === null) {
            fields.push({ name, positional: true });
          } else {
            fields.push({ expr: exprNode, type: typeName, positional: true });
          }
        }
      } else if (peek().type === 'STRING' || peek().type === 'INTERP_STRING') {
        const expr = consumeStringExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr, type: typeName, positional: true });
      } else if (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false')) {
        const boolTok = consume();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr: AST.boolLiteral(boolTok.value === 'true' ), type: typeName, positional: true });
      } else if (peek().type === 'KEYWORD' && peek().value === 'null') {
        consume();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr: AST.nullLiteral(), type: typeName, positional: true });
      } else if (peek().type === 'DOLLAR_IDENT') {
        const name = consume().value;
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr: AST.stateVar(name), type: typeName, positional: true, name: '$' + name });
      } else if (peek().type === 'LBRACKET') {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr, type: typeName, positional: true });
      } else if (peek().type === 'KEYWORD' && tokens[pos + 1]?.type === 'COLON') {
        // Keyword used as named field key: type: expr, set: expr, etc.
        const name = consume().value;
        consume(); // COLON
        const value = parseExpr();
        let fieldType = null;
        if (isTypeAttestation()) fieldType = consumeTypeAttestation();
        fields.push({ key: name, value, type: fieldType });
      } else if (peek().type === 'HTML_CONSTRUCTOR') {
        const tok = consume();
        let domExpr;
        if (tok.bvBlock !== undefined) {
          const savedTokens = tokens;
          const savedPos = pos;
          tokens = tokenize(tok.bvBlock);
          pos = 0;
          let actorBody;
          try {
            actorBody = parseActorBody(() => peek().type === 'EOF');
          } finally {
            tokens = savedTokens;
            pos = savedPos;
          }
          domExpr = AST.anonymousHtmlActor(tok.tag, actorBody, parseDomChildren(tok.children));
        } else {
          domExpr = AST.domConstructor(tok.tag, parseDomChildren(tok.children), parseAttrs(tok.attrs));
        }
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr: domExpr, type: typeName, positional: true });
      } else if (peek().type === 'ELLIPSIS') {
        consume();
        const name = expect('IDENT').value;
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ spread: true, name, type: typeName });
      } else {
        break;
      }
    }
    // Post-paren type attestation: ->(expr) as Type
    if (hasParen && fields.length === 1 && isTypeAttestation()) {
      fields[0].type = consumeTypeAttestation();
    }
    // Lineal reply must be terminated by blank line, empty --, //, or EOF
    if (!sameLine && !hasParen) {
      const t = peek().type;
      if (t !== 'BLOCK_SEP' && t !== 'DIVIDER' && t !== 'EOF') {
        throw new Error(`Lineal -> must be terminated by blank line, empty -- or //, or EOF; got ${t} '${peek().value || ''}'`);
      }
      if (t === 'DIVIDER') consume();
    }
    return fields;
  }

  function parseDestructureAssign() {
    const paren = peek().type === 'LPAREN';
    if (paren) consume(); // (

    const pattern = [];
    let positionalIdx = 0;

    while (true) {
      if (paren && peek().type === 'RPAREN') break;
      if (!paren && peek().type === 'EQUALS') break;

      if (peek().type === 'SIGIL') {
        const name = consume().value;
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        else if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) typeName = parseType();
        pattern.push({ named: true, name, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // key-mapped: key: local [Type]  OR  named: key: Type  OR  key: _  (discard)
        const first = consume().value;
        consume(); // COLON
        if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
          // key: Type — named field with type (uppercase = type, not local name)
          const typeName = parseType();
          pattern.push({ named: true, name: first, type: typeName });
        } else if (peek().type === 'IDENT') {
          const localName = consume().value;
          let typeName = null;
          // Whitespace type after local name (in destructure, EQUALS is always assignment, so type before = is valid)
          if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) { typeName = parseType(); }
          pattern.push({ key: first, name: localName, type: typeName });
        } else if (peek().type === 'DISCARD') {
          // `key: _` — consumes the key so a trailing `...` skips it. Only
          // meaningful for DI-namespace destructuring; ignored by structure
          // destructure since positional alignment doesn't apply.
          consume();
          pattern.push({ key: first, discard: true });
        } else {
          // key: (no local name, no type — just named)
          pattern.push({ named: true, name: first, type: null });
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value)) {
        // typed positional: a Type
        const name = consume().value;
        const type = parseType();
        pattern.push({ positional: true, name, idx: positionalIdx++, type });
      } else if (peek().type === 'DISCARD') {
        consume(); // _
        pattern.push({ discard: true, idx: positionalIdx++ });
      } else if (peek().type === 'ELLIPSIS') {
        // Spread marker for DI-namespace destructuring: `(...) = HTML`.
        // Valid only when the RHS is a DI dep; validator enforces that.
        consume();
        pattern.push({ spread: true });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        pattern.push({ positional: true, name, idx: positionalIdx++, type: null });
      } else {
        break;
      }

      if (peek().type === 'COMMA') {
        consume();
        // trailing comma — if next is terminator, we're done
        if (paren && peek().type === 'RPAREN') break;
        if (!paren && peek().type === 'EQUALS') break;
      } else {
        break;
      }
    }

    if (paren) expect('RPAREN');
    expect('EQUALS');

    // Inline structure literal: `1 : Integer, 2 : Integer` or `key: "v" : Text, ...`
    let source;
    if (peek().type === 'NUMBER' || peek().type === 'STRING' || peek().type === 'INTERP_STRING' ||
        (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON')) {
      source = parseInlineStructure();
    } else {
      // Disable bare-form here so `:a, :b = args -> result: a` keeps its
      // trailing `-> result: a` for the surrounding lineal reply, rather
      // than being eaten as `args -> result` (a function literal).
      const _prevBare = bareFuncAllowed;
      bareFuncAllowed = false;
      source = parseExpr(); // identifier or function call
      bareFuncAllowed = _prevBare;
    }

    return AST.destructureAssign(pattern, source);
  }

  function parseInlineStructure() {
    // Parses `1 as Integer, 2 as Integer` or `key: "v" as Text, ...` into a StructureConstructor node
    const args = [];
    while (true) {
      if (peek().type === 'NUMBER') {
        const numTok = consume();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ positional: true, expr: makeNumLiteral(numTok), type: typeName });
      } else if (peek().type === 'STRING' || peek().type === 'INTERP_STRING') {
        const expr = consumeStringExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ positional: true, expr, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ key, expr, type: typeName });
      } else {
        break;
      }
      if (peek().type === 'COMMA') { consume(); } else { break; }
    }
    return AST.structureConstructor(args);
  }

  function parseListDestructureAssign() {
    expect('LBRACKET');
    const pattern = [];
    while (peek().type !== 'RBRACKET' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'ELLIPSIS') {
        consume();
        if (peek().type === 'DISCARD') {
          consume(); pattern.push({ rest: true, discard: true });
        } else {
          const name = expect('IDENT').value;
          let type = null;
          if (peek().type === 'IDENT' && tokens[pos + 1]?.type !== 'EQUALS') { type = parseType(); }
          pattern.push({ rest: true, name, type });
        }
      } else if (peek().type === 'DISCARD') {
        consume(); pattern.push({ discard: true });
      } else {
        const name = consume().value;
        let type = null;
        if (peek().type === 'IDENT' && tokens[pos + 1]?.type !== 'EQUALS') { type = parseType(); }
        pattern.push({ name, type });
      }
    }
    expect('RBRACKET');
    expect('EQUALS');
    return AST.listDestructure(pattern, parseExpr());
  }

  function isDestructureStart() {
    const t0 = peek().type;
    const t1 = tokens[pos + 1]?.type;
    const t2 = tokens[pos + 2]?.type;
    const t3 = tokens[pos + 3]?.type;
    if (t0 === 'LBRACKET') {
      // Scan to matching ] — destructure only if followed by =
      let depth = 0, i = pos;
      while (i < tokens.length) {
        if (tokens[i].type === 'LBRACKET') depth++;
        else if (tokens[i].type === 'RBRACKET') { depth--; if (depth === 0) break; }
        i++;
      }
      return i < tokens.length && tokens[i + 1]?.type === 'EQUALS';
    }
    if (t0 === 'SIGIL') {
      // Scan forward past the destructure pattern to see if = follows
      let i = pos;
      while (i < tokens.length) {
        const t = tokens[i].type;
        if (t === 'SIGIL' || t === 'COMMA' || t === 'COLON' || t === 'DISCARD' ||
            (t === 'IDENT' && !/^[A-Z]/.test(tokens[i].value))) { i++; continue; }
        if (t === 'IDENT' && /^[A-Z]/.test(tokens[i].value)) { i++; continue; } // Type in typed destructure
        break;
      }
      return tokens[i]?.type === 'EQUALS';
    }
    if (t0 === 'LPAREN') {
      if (isParenFunctionStart(pos)) return false;
      // Scan to matching ) — destructure only if followed by =
      let depth = 0, i = pos;
      while (i < tokens.length) {
        if (tokens[i].type === 'LPAREN') depth++;
        else if (tokens[i].type === 'RPAREN') { depth--; if (depth === 0) break; }
        i++;
      }
      return i < tokens.length && tokens[i + 1]?.type === 'EQUALS';
    }
    if (t0 === 'DISCARD') return true;
    if (t0 === 'IDENT' && t1 === 'COMMA') {
      // Scan past comma-separated pattern to find =
      let i = pos;
      while (i < tokens.length) {
        const t = tokens[i].type;
        if (t === 'IDENT' || t === 'COMMA' || t === 'SIGIL' || t === 'COLON' || t === 'DISCARD') { i++; continue; }
        break;
      }
      return tokens[i]?.type === 'EQUALS';
    }
    // named with type: `key: Type [, ...] = expr` — Type is uppercase (key is both external and local name)
    if (t0 === 'IDENT' && t1 === 'COLON' && t2 === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '')) {
      const afterType = tokens[pos + 2 + typeLength(pos + 2)]?.type;
      if (afterType === 'EQUALS') return true;
      if (afterType === 'COMMA') {
        // Scan past multi-item pattern to find =
        let i = pos;
        while (i < tokens.length) {
          const t = tokens[i].type;
          if (t === 'IDENT' || t === 'COMMA' || t === 'SIGIL' || t === 'COLON' || t === 'DISCARD') { i++; continue; }
          break;
        }
        return tokens[i]?.type === 'EQUALS';
      }
    }
    // key-mapped: `key: local = expr` — local must be lowercase (uppercase = typed assignment)
    if (t0 === 'IDENT' && t1 === 'COLON' && t2 === 'IDENT' && t3 === 'EQUALS')
      return /^[a-z]/.test(tokens[pos + 2]?.value ?? '');
    // key-mapped with type: `key: local Type = ...`
    if (t0 === 'IDENT' && t1 === 'COLON' &&
        t2 === 'IDENT' && /^[a-z]/.test(tokens[pos + 2]?.value ?? '') &&
        t3 === 'IDENT')
      return true;
    // typed positional as first of multi-item: `a Type, ...`
    // (single `a Type = expr` is caught first by isTypedAssignStart)
    if (t0 === 'IDENT' && t1 === 'IDENT') {
      if (tokens[pos + 1 + typeLength(pos+1)]?.type === 'COMMA') return true;
    }
    return false;
  }

  function parseRHSValue() {
    // Parses the RHS of a plain assign (name = ...). Returns the value node.
    // Detects structure literals: sigil-start, or expr followed by COMMA, or key-value pattern.
    if (peek().type === 'SIGIL') {
      return parseRHSStructureLiteral(null);
    }
    const value = parseExpr();
    let firstType = null;
    if (isTypeAttestation()) {
      firstType = consumeTypeAttestation();
    }
    // Check for key-value: IDENT was the key, COLON follows (non-type)
    if (peek().type === 'COLON' && value.type === 'Identifier' && firstType === null) {
      consume(); // COLON
      const kvExpr = parseExpr();
      let kvType = null;
      if (isTypeAttestation()) {
        kvType = consumeTypeAttestation();
      }
      const firstElem = { key: value.name, expr: kvExpr, type: kvType };
      if (peek().type === 'COMMA') {
        consume(); // COMMA
        return parseRHSStructureLiteral(firstElem);
      }
      // Single key-value → 1-element named structure
      return AST.structureLiteral([firstElem]);
    }
    // Check for COMMA → structure literal
    if (peek().type === 'COMMA') {
      const firstElem = { positional: true, expr: value, type: firstType };
      consume(); // COMMA
      return parseRHSStructureLiteral(firstElem);
    }
    // Single typed value with no comma: promote to TypedValue for caller to emit TypedAssign
    if (firstType !== null) {
      return AST.typedValue(value, firstType);
    }
    return value;
  }

  function parseRHSStructureElem() {
    if (peek().type === 'SIGIL') {
      const name = consume().value;
      // :name → named field, var name = key name
      return { key: name, expr: AST.identifier(name), type: null };
    }
    if (peek().type === 'NUMBER') {
      const numTok = consume();
      let typeName = null;
      if (isTypeAttestation()) typeName = consumeTypeAttestation();
      return { positional: true, expr: makeNumLiteral(numTok), type: typeName };
    }
    if (peek().type === 'STRING' || peek().type === 'INTERP_STRING') {
      const expr = consumeStringExpr();
      let typeName = null;
      if (isTypeAttestation()) typeName = consumeTypeAttestation();
      return { positional: true, expr, type: typeName };
    }
    // IDENT as Type → positional typed variable
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1]?.value === 'as') {
      const name = consume().value;
      const typeName = consumeTypeAttestation();
      return { positional: true, expr: AST.identifier(name), type: typeName };
    }
    // IDENT COLON → key-value (k: expr [as Type])
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      const key = consume().value;
      consume(); // COLON
      const expr = parseExpr();
      let typeName = null;
      if (isTypeAttestation()) {
        typeName = consumeTypeAttestation();
      }
      return { key, expr, type: typeName };
    }
    // bare IDENT → positional untyped
    if (peek().type === 'IDENT') {
      const name = consume().value;
      return { positional: true, expr: AST.identifier(name), type: null };
    }
    return null;
  }

  function isRHSStructureLiteralTerminator() {
    const t = peek().type;
    return t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'EOF' || t === 'DIVIDER' || t === 'RBRACE';
  }

  function parseRHSStructureLiteral(firstElem) {
    // firstElem: already-parsed first element (or null if starting fresh)
    const args = firstElem ? [firstElem] : [];
    while (true) {
      if (isRHSStructureLiteralTerminator()) break;
      if (peek().type === 'COMMA') { consume(); continue; }
      const elem = parseRHSStructureElem();
      if (elem === null) break;
      args.push(elem);
    }
    return AST.structureLiteral(args);
  }

  function parseTypedAssign(body) {
    // name Type = expr — typed assignment (whitespace between name and type)
    // name Type! = expr — ref declaration
    const name = consume().value;
    const typeName = parseType();
    const isRefDecl = peek().type === 'BANG';
    if (isRefDecl) {
      consume(); // !
    } else if (isRef(name)) {
      throw new Error(`Cannot re-bind ref '${name}' with typed assignment — use '${name} <- value' to set`);
    }
    consume(); // EQUALS
    declareLocal(name);
    if (isRefDecl) addRef(name, typeName);
    let value;
    // For Structure type, check if RHS starts with sigil
    if (peek().type === 'KEYWORD' && peek().value === 'ingest') {
      consume(); // ingest
      let defaultValue = null;
      if (peek().type === 'LPAREN') {
        consume(); // (
        defaultValue = parseExpr();
        expect('RPAREN');
      }
      value = AST.ingestExpr(defaultValue);
    } else if (typeName === 'Structure' && peek().type === 'SIGIL') {
      value = parseRHSStructureLiteral(null);
    } else {
      value = parseExpr();
      // Treat any user-shape type (capitalized, non-builtin) the same as
      // `Structure` for the purposes of bare-comma RHS — `p Point = 1, 2`
      // becomes a StructureLiteral that the post-parse pass coerces into
      // `Point(1, 2)`. Slice 9 of types-implementation-plan-2026-04-27.
      // Only kicks in when the next token is COMMA — typed RHS with a
      // single value still parses normally.
      const isBuiltinTypeName = typeof typeName === 'string' && (
        BUILT_IN_SINGULAR.has(typeName) || BUILT_IN_PLURAL.has(typeName) ||
        typeName === 'Anything' || typeName === 'Decimal' || typeName === 'Decimals' ||
        typeName === 'null' || typeName === 'Function' || typeName === 'Structure'
      );
      const looksLikeShapeType = typeof typeName === 'string' &&
        /^[A-Z]/.test(typeName) &&
        !typeName.includes(' ') &&
        !typeName.includes('->') &&
        !isBuiltinTypeName;
      if (typeName === 'Structure' || looksLikeShapeType) {
        // Check for type annotation after value (wraps in single-element StructureLiteral)
        let firstType = null;
        if (isTypeAttestation()) {
          firstType = consumeTypeAttestation();
        }
        if (peek().type === 'COMMA') {
          const firstElem = { positional: true, expr: value, type: firstType };
          consume(); // COMMA
          value = parseRHSStructureLiteral(firstElem);
        } else if (firstType !== null) {
          // Single typed value → 1-element StructureLiteral
          value = AST.structureLiteral([{ positional: true, expr: value, type: firstType }]);
        }
      } else {
        // Non-Structure: consume optional RHS type annotation and check for conflict
        if (isTypeAttestation()) {
          const rhsType = consumeTypeAttestation();
          // Allow: lhs 'T | null' with rhs 'T' (non-null value assigned to nullable var)
          // Allow: function types — RHS as-type may be the return type portion
          const baseType = typeName.endsWith(' | null') ? typeName.slice(0, -7) : null;
          const isFnType = typeof typeName === 'string' && typeName.includes('->');
          if (!isFnType && rhsType !== typeName && rhsType !== baseType) {
            throw new Error(`Conflicting type declarations for '${name}': '${typeName}' vs '${rhsType}'`);
          }
        }
      }
    }
    // Compile error: if without else assigned to non-nullable type
    if (value.type === 'IfExpr' && value.else === null) {
      if (!typeName.endsWith(' | null')) {
        throw new Error(
          `if without else can return null — use '${typeName} | null' or add an else branch`,
        );
      }
    }
    if (typeof typeName === 'string' && typeName.includes('->')) {
      checkFunctionSignature(typeName, value);
    }
    if (value.type === 'Function' && typeName !== 'Function') {
      const sig = getFunctionLiteralSignature(value);
      fnSignatures.set(name, sig);
    }
    if (isRefDecl) {
      body.push(AST.refDecl(name, typeName, value));
    } else {
      body.push(AST.typedAssign(name, typeName, value));
    }
  }

  function isTypedAssignStart() {
    if (peek().type !== 'IDENT') return false;
    const ts = pos + 1;
    if (tokens[ts]?.type === 'LPAREN') {
      // Function type: name (..)->(..) = ...
      // Find the token after the function type and ensure it's '='
      let i = ts;
      let depth = 0;
      while (i < tokens.length) {
        if (tokens[i].type === 'LPAREN') depth++;
        else if (tokens[i].type === 'RPAREN') {
          depth--;
          // Function type has two paren groups separated by '->'
          if (depth === 0 && tokens[i+1]?.type === '->') {
            // skip '->' and parse second paren group
            i += 2;
            if (tokens[i]?.type !== 'LPAREN') return false;
            depth = 0;
            continue;
          }
          if (depth === 0) {
            return tokens[i+1]?.type === 'EQUALS';
          }
        }
        i++;
      }
      return false;
    }
    if (tokens[ts]?.type !== 'IDENT') return false;
    const afterType = ts + typeLength(ts);
    // Ref typed assign: name Type! = expr
    if (tokens[afterType]?.type === 'BANG') return tokens[afterType + 1]?.type === 'EQUALS';
    return tokens[afterType]?.type === 'EQUALS';
  }

  function isBareTypeDeclStart() {
    if (peek().type !== 'IDENT') return false;
    const ts = pos + 1;
    if (tokens[ts]?.type !== 'IDENT') return false;
    const after = tokens[ts + typeLength(ts)]?.type;
    return after !== 'EQUALS' && after !== 'COMMA' && after !== 'BANG';
  }

  function isParamStart() {
    const t = peek().type;
    if (t === 'SIGIL') return true;
    if (t === 'ELLIPSIS') return true;
    if (t === 'IDENT') return true;
    // (name) — positional param with suppressed accessor
    if (t === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'RPAREN') return true;
    return false;
  }

  function parseOneParam() {
    const isOneParamDelim = () => {
      const t = peek().type;
      return t === 'COMMA' || t === 'PIPE' || t === 'RPAREN' || t === 'GT' || t === 'EOF' || t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'DIVIDER' || t === 'EQUALS';
    };
    const peekIsParamType = () => {
      if (peek().type === 'LPAREN') return true; // function type: (Type) -> (Type)
      return peek().type === 'IDENT' && !isOneParamDelim();
    };
    // ── Default value helpers ─────────────────────────────────────────────
    const tryParseDefault = () => {
      if (peek().type !== 'EQUALS') return null;
      consume(); // =
      return parseDefaultLiteral();
    };
    const parseDefaultLiteral = () => {
      if (peek().type === 'NUMBER') return makeNumLiteral(consume());
      if (peek().type === 'STRING') return AST.stringLiteral(consume().value);
      if (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false')) return AST.boolLiteral(consume().value === 'true');
      if (peek().type === 'KEYWORD' && peek().value === 'null') { consume(); return AST.nullLiteral(); }
      if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') { consume(); consume(); return AST.structureLiteral([]); }
      throw new Error(`Expected literal default value, got ${peek().type} '${peek().value || ''}'`);
    };
    const inferDefaultType = (node) => {
      if (node.type === 'IntLiteral') return 'Integer';
      if (node.type === 'DecimalLiteral') return 'Decimal';
      if (node.type === 'FloatLiteral') return 'Float';
      if (node.type === 'StringLiteral') return 'Text';
      if (node.type === 'BoolLiteral') return 'Boolean';
      return null;
    };
    const withDefault = (param, defaultValue) => {
      if (!defaultValue) return param;
      if (!param.type) param.type = inferDefaultType(defaultValue);
      param.defaultValue = defaultValue;
      return param;
    };
    // ── Param forms ───────────────────────────────────────────────────────
    if (peek().type === 'SIGIL') {
      // :name — named param (prefix sigil, shorthand for name: name)
      const name = consume().value;
      if (peek().type === 'STAR') {
        // :name * — named ref param (wildcard, no explicit type)
        consume();
        return withDefault({ name, type: 'Anything', ref: true }, tryParseDefault());
      }
      let type = null;
      if (peekIsParamType()) { type = parseType(); }
      const isNamedRef = type !== null && peek().type === 'BANG';
      if (isNamedRef) consume(); // !
      if (isNamedRef) return withDefault({ name, type, ref: true }, tryParseDefault());
      // :name literal — shorthand default (no = sign)
      if (!type && (peek().type === 'STRING' || peek().type === 'NUMBER' ||
          (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false' || peek().value === 'null')))) {
        const defaultValue = parseDefaultLiteral();
        return withDefault({ name, type }, defaultValue);
      }
      return withDefault({ name, type }, tryParseDefault());
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      // key: (alias) — named arg with key remap (key ≠ local)
      const first = consume().value;
      consume(); // COLON
      if (peek().type === 'LPAREN') {
        // key: (alias) Type  OR  key: (alias) :accessor Type
        consume(); // LPAREN
        const alias = expect('IDENT').value;
        expect('RPAREN');
        let accessor = null;
        if (peek().type === 'SIGIL') { accessor = consume().value; }
        let type = null;
        if (peekIsParamType()) { type = parseType(); }
        return withDefault({ key: first, name: alias, type, ...(accessor ? { accessor } : {}) }, tryParseDefault());
      } else if (peek().type === 'SIGIL') {
        // key: :accessor Type — remap accessor name
        const accessor = consume().value;
        let type = null;
        if (peekIsParamType()) { type = parseType(); }
        return withDefault({ key: first, name: accessor, type, accessor }, tryParseDefault());
      }
      throw new Error(`Named param '${first}:' is no longer valid. Use ':${first}' (prefix sigil) instead, or '${first}: (alias)' for key remapping`);
    } else if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'RPAREN') {
      // (name) Type — positional param with suppressed accessor
      // (name) :accessor Type — positional with remapped accessor
      consume(); // LPAREN
      const name = expect('IDENT').value;
      expect('RPAREN');
      if (peek().type === 'SIGIL') {
        // (name) :accessor Type
        const accessor = consume().value;
        let type = null;
        if (peekIsParamType()) { type = parseType(); }
        return withDefault({ name, type, positional: true, accessor }, tryParseDefault());
      }
      let type = null;
      if (peekIsParamType()) { type = parseType(); }
      return withDefault({ name, type, positional: true, suppressAccessor: true }, tryParseDefault());
    } else if (peek().type === 'IDENT') {
      const name = consume().value;
      let type = null;
      if (peekIsParamType()) { type = parseType(); }
      return withDefault({ name, type, positional: true }, tryParseDefault());
    } else if (peek().type === 'ELLIPSIS') {
      consume();
      const name = expect('IDENT').value;
      let typeName = null;
      if (peekIsParamType()) { typeName = parseType(); }
      return { rest: true, name, type: typeName };
    }
    return null;
  }

  function parseParams() {
    // ── Mode 1: paren style ────────────────────────────────────────────────
    if (peek().type === 'LPAREN') {
      consume(); // opening paren
      const params = [];
      while (true) {
        skipNewlines();
        if (peek().type === 'COMMA') { consume(); continue; }
        if (peek().type === 'RPAREN') break;
        if (!isParamStart()) break;
        const p = parseOneParam();
        if (p === null) break;
        params.push(p);
      }
      expect('RPAREN');
      return params;
    }

    // ── Mode 2: same-line no-paren (sigil/ident immediately follows name) ──
    if (isParamStart()) {
      const params = [];
      while (true) {
        const t = peek().type;
        if (t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'DIVIDER' || t === 'EOF') break;
        if (t === 'COMMA') { consume(); continue; }
        if (!isParamStart()) break;
        const p = parseOneParam();
        if (p === null) break;
        params.push(p);
      }
      // Validate: body must start on the next line, not inline
      const t = peek().type;
      if (t !== 'NEWLINE' && t !== 'BLOCK_SEP' && t !== 'DIVIDER' && t !== 'EOF') {
        throw new Error(`Expected newline after no-paren param list, got ${t} '${peek().value || ''}'`);
      }
      return params;
    }

    // ── Mode 3: lineal form (NEWLINE immediately after name) ───────────────
    if (peek().type === 'NEWLINE') {
      consume(); // consume the single newline

      // = as lineal form section delimiter
      if (peek().type === 'EQUALS') {
        const savedPos = pos;
        consume();           // eat the =
        skipNewlines();
        if (peek().type === 'EQUALS') { consume(); skipNewlines(); return []; }  // = = → explicit empty params
        if (!isParamStart()) return [];  // no params → body follows
        const params = [];
        let foundDelimiter = false;
        try {
          while (true) {
            if (peek().type === 'EQUALS') { consume(); foundDelimiter = true; break; }  // second = ends params
            if (peek().type === 'EOF') break;
            if (peek().type === 'NEWLINE') { consume(); continue; }
            if (peek().type === 'COMMA') { consume(); continue; }
            if (isParamStart()) { const p = parseOneParam(); if (p) { params.push(p); continue; } }
            break;
          }
        } catch {
          foundDelimiter = false;
        }
        if (foundDelimiter) {
          return params;
        }
        // Backtrack: not a valid param list, treat as no params (body follows)
        pos = savedPos;
        consume(); // re-eat the =
        skipNewlines();
        return [];
      }

      if (peek().type === 'BLOCK_SEP') return []; // blank line → no params
      if (peek().type === 'EOF') return [];
      if (peek().type === 'DIVIDER') { consume(); return []; }
      if (!isParamStart()) {
        return [];  // no params — body starts on this line
      }
      // A param appears here without a preceding `=`. Per the lineal grammar,
      // params require the body-opener `=` between the name and the params.
      throw new Error(`Lineal param list must start with '=' on its own line; got ${peek().type} '${peek().value || ''}'`);
    }

    // ── Mode 4: BLOCK_SEP or anything else → no params ────────────────────
    return [];
  }

  function parseBody(stopToken = null) {
    localScopes.push(new Set());
    refVarScopes.push(new Map());
    skipNewlines();
    if (peek().type === 'BLOCK_SEP') consume();

    const isStop = () => peek().type === 'BLOCK_SEP' || peek().type === 'EOF' || (stopToken && peek().type === stopToken);
    const body = [];
    while (!isStop()) {
      skipNewlines();
      if (isStop()) break;

      if (peek().type === 'DOT') {
        consume();
        body.push(AST.silentTerminator());
        break;
      }

      if (peek().type === '->') {
        consume();
        if (peek().type === 'DOT') {
          consume(); // -> . synonym for .
          break;
        }
        const openForm = peek().type === 'NEWLINE';
        if (openForm) skipNewlines();
        body.push(AST.reply(parseReplyFields(!openForm) ));
        break;
      }

      // Block-label syntax: `#label <if|repeat|over|{}>` — desugars to
      // `catch #label { construct }`. Optional trailing `end#label` is
      // consumed and validated. See spec §5.
      {
        const labeledNode = tryParseLabeledConstruct();
        if (labeledNode) {
          body.push(labeledNode.isVoid
            ? AST.exprStatement(labeledNode)
            : AST.implicitReturn(labeledNode));
          continue;
        }
      }

      // c.field <- v — silent public-field set on a child actor
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'DOT' &&
          tokens[pos + 2]?.type === 'IDENT' &&
          (tokens[pos + 3]?.type === 'SET' || tokens[pos + 3]?.type === 'UPDATE')) {
        const objName = consume().value;
        consume(); // DOT
        const fieldName = consume().value;
        const isUpdate = peek().type === 'UPDATE';
        consume(); // SET (<-) or UPDATE (<|)
        const value = parseExpr();
        body.push(AST.actorFieldSet(objName, fieldName, value, { updateOp: isUpdate ? '<|' : undefined }));
      } else if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        consume(); // SET (<-) or UPDATE (<|)
        if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
          const args = [];
          const key = consume().value; consume();
          args.push({ name: key, expr: parseExpr(), positional: false });
          while (peek().type === 'COMMA') {
            consume();
            if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
              const k = consume().value; consume();
              args.push({ name: k, expr: parseExpr(), positional: false });
            } else {
              args.push({ expr: parseExpr(), positional: true });
            }
          }
          body.push(AST.actorSetStatement(name, args, { updateOp: isUpdate ? '<|' : undefined }));
        } else {
          const firstExpr = parseExpr();
          if (peek().type === 'COMMA') {
            const args = [{ expr: firstExpr, positional: true }];
            while (peek().type === 'COMMA') {
              consume();
              if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
                const key = consume().value; consume();
                args.push({ name: key, expr: parseExpr(), positional: false });
              } else {
                args.push({ expr: parseExpr(), positional: true });
              }
            }
            body.push(AST.actorSetStatement(name, args, { updateOp: isUpdate ? '<|' : undefined }));
          } else {
            body.push(AST.setStatement(name, firstExpr, { updateOp: isUpdate ? '<|' : undefined }));
          }
        }
      } else if (isTypedAssignStart()) {
        if (isRef(peek().value)) {
          throw new Error(`Cannot re-bind ref '${peek().value}' with typed assignment — use '${peek().value} <- value' to set`);
        }
        parseTypedAssign(body);
      } else if (isBareTypeDeclStart()) {
        const name = consume().value;
        const typeName = parseType();
        declareLocal(name);
        body.push(AST.bareTypeDecl(name, typeName));
      } else if (isDestructureStart()) {
        if (peek().type === 'LBRACKET') {
          const stmt = parseListDestructureAssign();
          for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
          body.push(stmt);
        } else {
          const stmt = parseDestructureAssign();
          for (const item of stmt.pattern) if (!item.discard && item.name) declareLocal(item.name);
          body.push(stmt);
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LT' && tokens[pos + 2]?.type === 'LT') {
        // Lambda overload append: fn << |params| { body }
        const name = consume().value;
        consumeOverloadOp(); // <<
        const value = parseRHSValue();
        if (value.type !== 'Function') throw new Error(`Expected function after '${name} <<', got ${value.type}`);
        body.push(AST.assign(name, Object.assign(value, { overloadMode: 'append' })));
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        if (isRef(name)) {
          throw new Error(`Cannot re-bind ref '${name}' with '=' — use '${name} <- value' to set`);
        }
        consume(); // EQUALS
        declareLocal(name);
        // name = Function() — empty overload initializer
        if (peek().type === 'IDENT' && peek().value === 'Function' && tokens[pos + 1]?.type === 'LPAREN' && tokens[pos + 2]?.type === 'RPAREN') {
          consume(); consume(); consume(); // Function ( )
          functionNames.add(name);
          body.push(AST.assign(name, Object.assign(AST.functionNode([], []), { emptyOverload: true })));
        // name = TypeName!(args) — ref constructor form
        } else if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value) && tokens[pos + typeLength(pos)]?.type === 'BANG') {
          const typeName = parseType();
          consume(); // !
          addRef(name);
          const value = peek().type === 'LPAREN' ? parseForwardCall(typeName) : parseRHSValue();
          body.push(AST.refDecl(name, null, value));
        // name = *expr — ref declaration without explicit type (literal form)
        } else if (peek().type === 'STAR') {
          consume(); // *
          addRef(name);
          const value = parseRHSValue();
          if (value.type === 'TypedValue') {
            body.push(AST.refDecl(name, value.typeName, value.expr));
          } else {
            body.push(AST.refDecl(name, null, value));
          }
        } else {
          const value = parseRHSValue();
          if (value.type === 'Function') {
            functionNames.add(name);
            const slots = new Set();
            value.params.forEach((p, i) => {
              if (isFunctionType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
            });
            if (slots.size > 0) functionParamSlots.set(name, slots);
            const rSlots = new Set();
            value.params.forEach((p, i) => {
              if (p.ref) rSlots.add(p.positional ? i : (p.key ?? p.name));
            });
            if (rSlots.size > 0) refParamSlots.set(name, rSlots);
          }
          if (value.type === 'TypedValue') {
            body.push(AST.typedAssign(name, value.typeName, value.expr));
          } else {
            body.push(AST.assign(name, value));
          }
        }
      } else if (peek().type === 'HASH_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = '#' + consume().value;
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') {
          functionNames.add(name);
        }
        if (value.type === 'TypedValue') {
          body.push(AST.typedAssign(name, value.typeName, value.expr));
        } else {
          body.push(AST.assign(name, value));
        }
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push(AST.stateAssign(name, value));
      } else if (peek().type === 'KEYWORD' && peek().value === 'repeat') {
        body.push(parseRepeatStatement());
      } else if (peek().type === 'KEYWORD' && peek().value === 'catch') {
        consume(); // 'catch'
        const c = parseCatchExpr();
        // Value-carrying catch wraps as ImplicitReturn so the handler reply
        // path picks up its value when the catch sits at the function tail.
        // Void catch is a pure side-effect statement.
        body.push(c.isVoid ? AST.exprStatement(c) : AST.implicitReturn(c));
      } else if (peek().type === 'HASH_IDENT' && labelStack.includes('#' + peek().value)) {
        // Label invocation as a statement (bare, empty parens, or value form).
        const tok = consume();
        const labelName = '#' + tok.value;
        let valueExpr = null;
        if (peek().type === 'LPAREN') {
          consume();
          if (peek().type !== 'RPAREN') valueExpr = parseExpr();
          expect('RPAREN');
        }
        body.push(AST.exprStatement(AST.labelInvoke(labelName, valueExpr)));
      } else if (peek().type === 'KEYWORD' && peek().value === 'if') {
        consume(); // 'if'
        const _prevBare = bareFuncAllowed;
        bareFuncAllowed = false;
        const cond = parseExpr();
        bareFuncAllowed = _prevBare;
        skipNewlines();
        const isLabelExit = peek().type === 'HASH_IDENT' && labelStack.includes('#' + peek().value);
        if (peek().type === 'LBRACE' || peek().type === '->' || isLabelExit) {
          // Block-body, single-line `-> val`, or single-line `#label` (label exit).
          const thenBranch = parseIfBranch();
          let elseBranch = null;
          skipNewlines();
          if (peek().type === 'KEYWORD' && peek().value === 'else') {
            consume(); // else
            skipNewlines();
            if (peek().type === 'KEYWORD' && peek().value === 'if') {
              consume(); // if
              elseBranch = parseIfExpr();
            } else {
              elseBranch = parseIfBranch();
            }
          }
          body.push(AST.implicitReturn(AST.ifExpr(cond, thenBranch, elseBranch)));
        } else {
          const ifBody = [];
          while (peek().type !== 'NEWLINE' && peek().type !== 'BLOCK_SEP' && peek().type !== 'EOF' &&
                 peek().type !== 'DOT' &&
                 !(peek().type === '->' || (peek().type === 'KEYWORD' && peek().value === 'else'))) {
            if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
              const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
              const pName = consume().value;
              if (!isRef(pName)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${pName}' — only '!' variables support '${isUpdate ? '<|' : '<-'}'`);
              consume(); // SET (<-) or UPDATE (<|)
              ifBody.push(AST.setStatement(pName, parseExpr(), { updateOp: isUpdate ? '<|' : undefined }));
            } else {
              break;
            }
          }
          body.push(AST.ifStatement(cond, ifBody));
        }
      } else if (peek().type === 'KEYWORD' && peek().value === 'spawn') {
        consume(); // 'spawn'
        const expr = parseExpr();
        if (expr.type !== 'FunctionCallExpr' && expr.type !== 'DotCallExpr') {
          throw new Error("'spawn' requires a function call or external send");
        }
        body.push(AST.spawnStatement(expr ));
      } else if (
        (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'LPAREN' || tokens[pos + 1]?.type === 'DOT')) ||
        (peek().type === 'HASH_IDENT' && tokens[pos + 1]?.type === 'DOT') ||
        (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'DOT')
      ) {
        // Standalone function call, dot-call, or self-handler dot-call (side effects)
        const expr = parseExpr();
        pushExprOrBang(body, expr);
      } else if (peek().type === 'KEYWORD' && peek().value === 'reduce') {
        throw new Error("'reduce' must be assigned to a variable — use 'result : Type = reduce ...'");
      } else if (lineHasPrependOp()) {
        // Statement-level >> prepend operator (e.g. `1 >> ns` or `1 >> 2 >> ns`).
        // Lambda overload prepend is handled above via the PIPE guard; everything
        // else is the operator. pushExprOrBang desugars the BinaryExpr('>>') chain
        // into a SetStatement that concats the prepended values onto the target.
        const expr = parseExpr();
        pushExprOrBang(body, expr);
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator — visual separator, no semantic weight
      } else {
        // In braced body, treat unrecognized tokens as implicit returns
        if (stopToken) {
          // Use parseReplyFields for sigils, paren-wrapped, and multi-field returns
          const t = peek().type;
          if (t === 'SIGIL' || t === 'ELLIPSIS' ||
              (t === 'LPAREN' && !isDestructureStart())) {
            body.push(AST.reply(parseReplyFields(true) ));
          } else {
            // Single expression or comma-separated fields starting with ident/literal
            const expr = parseExpr();
            let typeName = null;
            if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
            if (peek().type === 'COMMA') {
              // Multi-field: x, :y, alias: z
              const firstField = { positional: true, expr, type: typeName };
              consume(); // COMMA
              const rest = parseReplyFields(true);
              body.push(AST.reply([firstField, ...rest] ));
            } else {
              body.push(AST.implicitReturn(expr, typeName));
            }
          }
        } else {
          // Lineal form: treat sigils, paren-wrapped, and multi-field as implicit returns
          const t = peek().type;
          if (t === 'SIGIL' || t === 'ELLIPSIS' ||
              (t === 'LPAREN' && !isDestructureStart())) {
            body.push(AST.reply(parseReplyFields(true) ));
          } else if (t === 'IDENT' && tokens[pos + 1]?.type === 'COMMA') {
            // Multi-field implicit return starting with positional: x, :y, alias: z
            const expr = parseExpr();
            let typeName = null;
            if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
            const firstField = { positional: true, expr, type: typeName };
            consume(); // COMMA
            const rest = parseReplyFields(true);
            body.push(AST.reply([firstField, ...rest] ));
          } else {
            throw new Error(`Unexpected token in function body: ${t} '${peek().value || ''}'`);
          }
        }
      }
    }
    refVarScopes.pop();
    localScopes.pop();
    return body;
  }

  function parsePublicFunction(constructorBody) {
    consume(); // AT
    const opTok = consume();
    let op;
    if (opTok.type === 'IDENT' || opTok.type === 'KEYWORD') {
      op = opTok.value;
    } else {
      throw new Error(`Expected op name after '@', got ${opTok.type} '${opTok.value}'`);
    }

    // ── Public ref cell: @name Type! = expr ─────────────────────────────
    // Desugars to a private refDecl (state slot) plus a synthesized getter
    // (and setter, for base types). Caller receives an array of FunctionDecls.
    const isPublicRef = tokens[pos]?.type === 'IDENT' &&
      tokens[pos + typeLength(pos)]?.type === 'BANG';
    if (isPublicRef) {
      const typeName = parseType();
      consume(); // !
      skipNewlines();
      expect('EQUALS');
      skipNewlines();
      const value = parseExpr();
      declareLocal('@' + op);
      addRef('@' + op);
      if (constructorBody) constructorBody.push(AST.refDecl('@' + op, typeName, value));
      const getter = AST.functionDecl('@' + op, [], [
        AST.reply([{ type: typeName, positional: true, expr: AST.identifier('@' + op) }]),
      ]);
      const baseTypes = new Set(['Integer', 'Text', 'Boolean', 'List', 'Decimal']);
      // Synthesize a setter for value cells (base types) and for actor-reference
      // cells (any union member equal to `Self`). The address-not-value argument:
      // an actor-ref cell holds an address, and rebinding it has no compound-value
      // invariants to break — same as a primitive cell.
      const refsSelf = typeof typeName === 'string' &&
        typeName.split('|').some(m => m.trim() === 'Self');
      if (baseTypes.has(typeName) || refsSelf) {
        const setter = AST.functionDecl('set@' + op,
          [{ name: '_v', type: typeName, positional: true }],
          [AST.setStatement('@' + op, AST.identifier('_v')), AST.silentTerminator()],
        );
        // `subscribe@<cell>` is not a declared handler — it's an implicit
        // affordance on every non-silent public surface, dispatched generically
        // from the receive loop. Synthesizing it here would pollute the class
        // method set and the actor function list.
        return [getter, setter];
      }
      return [getter];
    }

    // ── Public constant: @name = <literal|ctor> ─────────────────────────
    // Speculative: if after `=` we see a literal or a capital-ident ctor
    // call, treat as a constant. Otherwise fall through to handler parsing.
    if (peek().type === 'EQUALS') {
      const savedPos = pos;
      consume(); // EQUALS
      skipNewlines();
      const t = peek().type;
      // Exclude `Function(...)` — that's the empty-overload initializer form.
      const isCtorCall = t === 'IDENT' && /^[A-Z]/.test(peek().value) && peek().value !== 'Function' && tokens[pos + 1]?.type === 'LPAREN';
      const isLiteral = t === 'NUMBER' || t === 'STRING' || t === 'LBRACKET' ||
        (t === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false'));
      if (isLiteral || isCtorCall) {
        const value = parseExpr();
        const inferLitType = (v) => {
          if (!v) return null;
          if (v.type === 'IntLiteral') return 'Integer';
          if (v.type === 'StringLiteral') return 'Text';
          if (v.type === 'InterpolatedString') return 'Text';
          if (v.type === 'BoolLiteral') return 'Boolean';
          if (v.type === 'ListLiteral') return 'List';
          if (v.type === 'DecimalLiteral') return 'Decimal';
          if (v.type === 'FunctionCallExpr' && v.callee?.type === 'Identifier' && /^[A-Z]/.test(v.callee.name)) {
            return v.callee.name;
          }
          return null;
        };
        const typeName = inferLitType(value);
        if (!typeName) {
          throw new Error(`Cannot infer type for public constant '@${op}'`);
        }
        declareLocal('@' + op);
        if (constructorBody) constructorBody.push(AST.typedAssign('@' + op, typeName, value));
        const getter = AST.functionDecl('@' + op, [], [
          AST.reply([{ type: typeName, positional: true, expr: AST.identifier('@' + op) }]),
        ]);
        return [getter];
      }
      pos = savedPos;
    }

    let params;
    let overloadMode = 'create';

    // ── Detect overload operator: = or << ──────────────────────────────
    // << can appear on the same line or after newline (lineal). >> is the
    // list prepend operator and no longer participates in function overloads.
    if (peekIsAppend()) {
      consumeOverloadOp();
      overloadMode = 'append';
    } else {
      // Plain `@op <...>` (no `=` and no `<<`) is rejected: lineal
      // constructors require `=` before `<...>` as the body opener.
      let li = pos;
      while (li < tokens.length && tokens[li].type === 'NEWLINE') li++;
      if (tokens[li]?.type === 'LT' && tokens[li + 1]?.type !== 'LT') {
        throw new Error(`Lineal constructor '@${op}' requires '=' before '<...>' — write '@${op} = <...>' or '@${op}\\n  =\\n  <...>'`);
      }
    }

    // ── Same-line operator: = (create), or already consumed <</>>/nothing ──
    if (overloadMode === 'create' && peek().type === 'EQUALS') {
      consume(); // eat the =

      // ── Function() — empty overload initializer ────────────────────
      if (peek().type === 'IDENT' && peek().value === 'Function' && tokens[pos + 1]?.type === 'LPAREN' && tokens[pos + 2]?.type === 'RPAREN') {
        consume(); consume(); consume(); // Function ( )
        return AST.functionDecl('@' + op, [], [], { emptyOverload: true });
      }
      // ── Reject non-function values: @x = "hello", @x = 42, etc. ───
      // Public handlers always expect a function body. Valid openers:
      // LPAREN (params), LT (constructor), `->`/`{`/`.` (no-arg bodies),
      // NEWLINE/BLOCK_SEP (lineal-form continuation).
      const _t = peek().type;
      if (_t !== 'LT' && _t !== '->' && _t !== 'LBRACE' && _t !== 'DOT' && _t !== 'NEWLINE' && _t !== 'BLOCK_SEP' && _t !== 'LPAREN') {
        throw new Error(`'@${op}' is public — only functions can be public. Use '->', '{', or '(params)' to define a function body, or remove the '@' for a private value.`);
      }
      // Allow `= \n <...>` — body-opener `=` may sit on its own line
      // before constructor params.
      if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
        let _li = pos;
        while (_li < tokens.length && (tokens[_li].type === 'NEWLINE' || tokens[_li].type === 'BLOCK_SEP')) _li++;
        if (tokens[_li]?.type === 'LT' && tokens[_li + 1]?.type !== 'LT') {
          while (pos < _li) consume();
        }
      }
    } else if (overloadMode === 'create' && peek().type === 'NEWLINE') {
      // Lineal form: @op\n =\n body  or @op\n <<\n =\n body
      consume(); // eat NEWLINE
      // Check for << on the next line (lineal overload-append form)
      if (peekIsAppend()) {
        consumeOverloadOp();
        overloadMode = 'append';
        skipNewlines();
      } else if (peek().type === 'LT' && tokens[pos + 1]?.type !== 'LT') {
        // Lineal constructor without leading `=`: reject.
        throw new Error(`Lineal constructor '@${op}' requires '=' before '<...>' — write '@${op} = <...>' or '@${op}\\n  =\\n  <...>'`);
      }
    } else if (overloadMode !== 'create') {
      // After consuming <<, allow optional newline before the definition
      // (already consumed the operator)
    } else {
      throw new Error(`Unexpected token after '@${op}'. Use '@${op} = |params| body' (delimited) or '@${op}\\n  =\\n  params\\n  =\\n  body' (lineal)`);
    }

    // ── Parse definition body (shared for all overload modes) ──────────
    // At this point we've consumed the operator (=, <<, >>).
    // Next could be: PIPE (delimited fn), LT (constructor), NEWLINE (lineal), ->, {, .

    if (peek().type === 'LPAREN') {
      // Parens-delimited params: (a: Integer, b: Integer) or (a Integer).
      // After `@name =`, LPAREN unambiguously opens the param list.
      params = parseFunctionParamsParen();
      // Public function params require type annotations (except rest/spread params)
      for (const p of params) {
        if (p.type == null && !p.rest) {
          const pName = p.key ? `${p.key}: ${p.name}` : (p.name || 'param');
          throw new Error(`Public function param '${pName}' requires a type annotation`);
        }
      }
    } else if (peek().type === 'LT') {
      // Public constructor: @Name = <params> { body } or @Name << <T | params> { body }
      consume(); // <
      const cParams = [];
      // ── Subclass detection: T |  or  T *name |  or  T* | ───────
      const supertypes = [];
      skipNewlines();
      if (looksLikeSupertypePrefix()) {
        while (peek().type === 'IDENT') {
          const stName = consume().value;
          const st = { supertype: stName };
          if (peek().type === 'STAR') {
            consume(); // *
            if (peek().type === 'IDENT') {
              st.wrappedAs = consume().value;
            } else {
              st.wrappedAs = stName;
            }
          }
          supertypes.push(st);
          skipNewlines();
          if (peek().type === 'COMMA') { consume(); skipNewlines(); continue; }
          break;
        }
        skipNewlines();
        expect('PIPE'); // separator between supertypes and params
      }
      while (peek().type !== 'GT' && peek().type !== 'EOF') {
        if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
        if (isParamStart()) {
          const p = parseOneParam();
          if (p) { cParams.push(p); continue; }
        }
        // Bare identifier param (no type)
        if (peek().type === 'IDENT') {
          const next1 = tokens[pos + 1]?.type;
          if (next1 === 'GT' || next1 === 'COMMA' || next1 === 'NEWLINE') {
            cParams.push({ name: consume().value, type: 'Anything', positional: true });
            continue;
          }
        }
        break;
      }
      expect('GT');
      skipNewlines();
      // Optional trailing `=` opens a lineal body; `= {` is illegal.
      if (peek().type === 'EQUALS') {
        consume();
        skipNewlines();
        if (peek().type === 'LBRACE') {
          throw new Error(`'=' is not valid before '{' — use a lineal body or remove the '=' (in '@${op}')`);
        }
      }
      let nested;
      if (peek().type === 'LBRACE') {
        consume(); // {
        nested = parseActorBody(() => peek().type === 'RBRACE');
        skipNewlines();
        expect('RBRACE');
      } else {
        // Lineal body after <params>
        nested = parseActorBody(() =>
          (peek().type === 'DOT') ||
          (peek().type === 'KEYWORD' && peek().value === 'end'),
        );
        skipBlanks();
        if (peek().type === 'DOT') consume();
        skipBlanks();
        if (peek().type === 'KEYWORD' && peek().value === 'end') {
          consume();
          if (peek().type === 'HASH_IDENT') consume();
        }
      }
      const actorNode = { params: cParams, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: cParams, constructorBody: nested.constructorBody, asClauses: nested.asClauses, supertypes };
      if (overloadMode !== 'create') {
        // Overload clause: emit as FunctionDecl with actorDef
        return AST.functionDecl('@' + op, cParams, [], { overloadMode, actorDef: actorNode });
      }
      return AST.actor('@' + op, { ...actorNode, overloadMode });
    } else if (peek().type === 'EQUALS' || peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
      // Lineal form: = params = body (or just = body for no params)
      if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
        // Skip to = on next line
        while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume();
      }
      if (peek().type === 'EQUALS') {
        consume(); // first =
        skipNewlines();
        if (peek().type === 'EQUALS') {
          // = = → explicit empty params
          consume();
          params = [];
        } else {
          // Try parsing params between two = delimiters, with backtracking.
          const savedPos = pos;
          params = [];
          let foundDelimiter = false;
          let afterNewline = true;
          try {
            while (peek().type !== 'EOF') {
              if (peek().type === 'NEWLINE') { consume(); afterNewline = true; continue; }
              if (peek().type === 'COMMA') { consume(); continue; }
              if (peek().type === 'EQUALS' && afterNewline) {
                consume(); // second = delimiter
                foundDelimiter = true;
                break;
              }
              if (isParamStart()) {
                const p = parseOneParam();
                if (p) { params.push(p); afterNewline = false; continue; }
              }
              break;
            }
          } catch {
            foundDelimiter = false;
          }
          if (!foundDelimiter) {
            pos = savedPos;
            params = [];
          }
        }
      } else {
        params = [];
      }
    } else if (peek().type === '->' || peek().type === 'LBRACE' || peek().type === 'DOT') {
      params = []; // no params — body follows directly
    } else {
      throw new Error(`Unexpected token after '@${op}'. Use '@${op} = |params| body' (delimited) or '@${op}\\n  =\\n  params\\n  =\\n  body' (lineal)`);
    }

    skipNewlines();
    // Delimited braced body: @op = |params| { body } [: Type]
    if (peek().type === 'LBRACE') {
      consume(); // {
      const body = parseBody('RBRACE');
      skipNewlines();
      expect('RBRACE');
      // Optional type annotation after closing brace: } : Type  or  } as Type
      if (isTypeAttestation()) {
        consumeTypeAttestation(); // consume but discard
      } else if (peek().type === 'COLON') {
        consume(); // COLON
        parseType(); // consume but discard — public functions infer return type from reply
      }
      return AST.functionDecl('@' + op, params, body, { overloadMode });
    }

    const body = parseBody();
    return AST.functionDecl('@' + op, params, body, { overloadMode });
  }

  // parseInitBlock removed — init/$var syntax deprecated

  function parseSelfAsClause() {
    consume(); // 'self'
    consume(); // 'as'
    let negated = false;
    if (peek().type === 'BANG') {
      consume(); // '!'
      negated = true;
    }
    const targetType = parseType();
    if (peek().type === 'EQUALS') {
      consume(); // '='
    } else if (peek().type === 'NEWLINE') {
      skipNewlines();
      if (peek().type !== 'EQUALS') throw new Error(`Expected '=' after 'self as ${negated ? '!' : ''}${targetType}'`);
      consume(); // '='
    } else {
      throw new Error(`Expected '=' after 'self as ${negated ? '!' : ''}${targetType}'`);
    }
    skipNewlines();
    if (peek().type !== '->') throw new Error(`Expected '->' in 'self as' clause body`);
    consume(); // '->'
    const expr = parseExpr();
    return AST.asClause(targetType, negated, expr);
  }

  function isActorBodyStart() {
    // Look ahead past newlines and block separators to see if the body starts with actor-level constructs
    let i = pos;
    while (i < tokens.length && (tokens[i].type === 'NEWLINE' || tokens[i].type === 'BLOCK_SEP')) i++;
    const t = tokens[i];
    if (!t) return false;
    // Check for name Type! (ref declaration) — IDENT followed by IDENT followed by BANG
    if (t.type === 'IDENT' && tokens[i + 1]?.type === 'IDENT' && tokens[i + 1 + typeLength(i + 1)]?.type === 'BANG') return true;
    return t.type === 'AT' ||
           (t.type === 'KEYWORD' && (t.value === 'self' || t.value === 'set' || t.value === 'update'));
  }

  function parseActorBody(isEnd) {
    const functions = [];
    const nestedActors = [];
    const asClauses = [];
    const constructorBody = [];
    refVarScopes.push(new Map()); // actor-level ref scope
    while (peek().type !== 'EOF') {
      skipBlanks();
      if (peek().type === 'EOF' || isEnd()) break;
      // -> self terminates an actor body; -> expr is a declaration return
      if (peek().type === '->') {
        consume(); // ->
        if (peek().type === 'KEYWORD' && peek().value === 'self') {
          consume(); // self
        } else if (peek().type !== 'EOF' && peek().type !== 'RBRACE' && peek().type !== 'DOT') {
          // Declaration return: -> expr (value for superclass ingest)
          const expr = parseExpr();
          let typeName = null;
          if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
          constructorBody.push(AST.implicitReturn(expr, typeName));
        }
        break;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'self' && tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1]?.value === 'as') {
        asClauses.push(parseSelfAsClause());
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 1 + typeLength(pos + 1)]?.type === 'BANG' && functions.length === 0) {
        // Service block: name Type! [= value] — ref declaration before any @ functions
        const name = consume().value;
        const typeName = parseType();
        // Register the class-level ref WITH its type so handler bodies parsed
        // later can dispatch methods correctly (e.g., news.append!(t) → list).
        addRef(name, typeName);
        consume(); // !
        if (peek().type === 'EQUALS') {
          consume();
          const value = parseExpr();
          if (isTypeAttestation()) { consumeTypeAttestation(); }
          constructorBody.push(AST.refDecl(name, typeName, value));
        } else {
          constructorBody.push(AST.refDecl(name, typeName, null));
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS' && tokens[pos + 2]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '') && tokens[pos + 2 + typeLength(pos + 2)]?.type === 'BANG' && functions.length === 0) {
        // Service block: name = TypeName!(args) — ref constructor form
        const name = consume().value;
        consume(); // =
        const typeName = parseType();
        consume(); // !
        addRef(name);
        const value = peek().type === 'LPAREN' ? parseForwardCall(typeName) : parseRHSValue();
        constructorBody.push(AST.refDecl(name, null, value));
      } else if (peek().type === 'KEYWORD' && peek().value === 'set') {
        // set = (val) { ... } — syntactic sugar for the <- handler
        consume(); // 'set'
        let params;
        if (peek().type === 'EQUALS') {
          consume(); // =
          if (peek().type === 'LPAREN' && isParenFunctionStart(undefined, true)) {
            params = parseFunctionParamsParen();
          } else {
            params = [];
          }
        } else if (peek().type === 'NEWLINE') {
          consume(); // NEWLINE
          if (peek().type === 'EQUALS') {
            consume(); // first =
            skipNewlines();
            if (peek().type === 'EQUALS') {
              consume(); // = = → explicit empty params
              params = [];
            } else {
              const savedPos = pos;
              params = [];
              let foundDelimiter = false;
              let afterNewline = true;
              try {
                while (peek().type !== 'EOF') {
                  if (peek().type === 'NEWLINE') { consume(); afterNewline = true; continue; }
                  if (peek().type === 'COMMA') { consume(); continue; }
                  if (peek().type === 'EQUALS' && afterNewline) { consume(); foundDelimiter = true; break; }
                  if (isParamStart()) { const p = parseOneParam(); if (p) { params.push(p); afterNewline = false; continue; } }
                  break;
                }
              } catch { foundDelimiter = false; }
              if (!foundDelimiter) { pos = savedPos; params = []; }
            }
          } else {
            params = [];
          }
        } else {
          throw new Error(`Unexpected token after 'set'. Use 'set = (params) body' (delimited) or 'set\\n  =\\n  params\\n  =\\n  body' (lineal)`);
        }
        skipNewlines();
        let body;
        if (peek().type === 'LBRACE') {
          consume();
          body = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          // New form `set = (params) -> stmt` — consume the arrow when it
          // precedes a non-reply statement, so parseBody sees the statement.
          if (peek().type === '->' && tokens[pos + 1]?.type === 'IDENT' &&
              (tokens[pos + 2]?.type === 'SET' || tokens[pos + 2]?.type === 'UPDATE')) {
            consume(); // ->
          }
          body = parseBody();
        }
        functions.push(AST.functionDecl('set', params, body));
      } else if (peek().type === 'KEYWORD' && peek().value === 'update') {
        // update = (val) { ... } — syntactic sugar for the <| handler
        consume(); // 'update'
        let params;
        if (peek().type === 'EQUALS') {
          consume(); // =
          if (peek().type === 'LPAREN' && isParenFunctionStart(undefined, true)) {
            params = parseFunctionParamsParen();
          } else {
            params = [];
          }
        } else if (peek().type === 'NEWLINE') {
          consume(); // NEWLINE
          if (peek().type === 'EQUALS') {
            consume(); // first =
            skipNewlines();
            if (peek().type === 'EQUALS') {
              consume(); // = = → explicit empty params
              params = [];
            } else {
              const savedPos = pos;
              params = [];
              let foundDelimiter = false;
              let afterNewline = true;
              try {
                while (peek().type !== 'EOF') {
                  if (peek().type === 'NEWLINE') { consume(); afterNewline = true; continue; }
                  if (peek().type === 'COMMA') { consume(); continue; }
                  if (peek().type === 'EQUALS' && afterNewline) { consume(); foundDelimiter = true; break; }
                  if (isParamStart()) { const p = parseOneParam(); if (p) { params.push(p); afterNewline = false; continue; } }
                  break;
                }
              } catch { foundDelimiter = false; }
              if (!foundDelimiter) { pos = savedPos; params = []; }
            }
          } else {
            params = [];
          }
        } else {
          throw new Error(`Unexpected token after 'update'. Use 'update = (params) body' (delimited) or 'update\\n  =\\n  params\\n  =\\n  body' (lineal)`);
        }
        // New form `update = (params) -> stmt` — consume the arrow when it
        // precedes a non-reply statement, so parseBody sees the statement.
        if (peek().type === '->' && tokens[pos + 1]?.type === 'IDENT' &&
            (tokens[pos + 2]?.type === 'SET' || tokens[pos + 2]?.type === 'UPDATE')) {
          consume(); // ->
        }
        const body = parseBody();
        functions.push(AST.functionDecl('update', params, body));
      } else if (peek().type === 'KEYWORD' && peek().value === 'emit') {
        // emit declaration: emit fire(args) -> (ReturnType) or emit fire(args) -> .
        consume(); // 'emit'
        const emitName = expect('IDENT').value;
        expect('LPAREN');
        const params = [];
        while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
          if (peek().type === 'COMMA') { consume(); continue; }
          const p = parseOneParam();
          if (p === null) break;
          params.push(p);
        }
        expect('RPAREN');
        // Parse return type: -> (Type) or -> .
        let returnType = null;
        let silent = false;
        if (peek().type === '->') {
          consume();
          if (peek().type === 'DOT') {
            consume();
            silent = true;
          } else if (peek().type === 'LPAREN') {
            consume();
            const retFields = [];
            while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
              if (peek().type === 'COMMA') { consume(); continue; }
              const p = parseOneParam();
              if (p) retFields.push(p);
            }
            expect('RPAREN');
            returnType = retFields;
          }
        }
        constructorBody.push(AST.emitDecl(emitName, params, { returnType, silent }));
      } else if (peek().type === 'KEYWORD' && peek().value === 'on') {
        // on handler: on firer.fire { body } or on firer.fire (params) { body }
        consume(); // 'on'
        const source = expect('IDENT').value;
        expect('DOT');
        const eventName = expect('IDENT').value;
        let params = [];
        if (peek().type === 'LPAREN' && isParenFunctionStart()) {
          params = parseFunctionParamsParen();
        }
        skipNewlines();
        let body;
        if (peek().type === 'LBRACE') {
          consume();
          body = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          body = parseBody();
        }
        functions.push(AST.onHandler(source, eventName, params, body));
      } else if (peek().type === 'AT') {
        const node = parsePublicFunction(constructorBody);
        if (Array.isArray(node)) {
          for (const fn of node) functions.push(fn);
        } else if (node.type === 'Actor') {
          nestedActors.push(node);
        } else {
          functions.push(node);
        }
      } else if (isTypedAssignStart()) {
        // Top-level typed assignment: name : Type = expr
        parseTypedAssign(constructorBody);
      } else if (isBareTypeDeclStart()) {
        // Top-level bare type declaration: name Type
        const name = consume().value;
        const typeName = parseType();
        constructorBody.push(AST.typedAssign(name, typeName, null));
      } else if (peek().type === 'HASH_IDENT') {
        const op = '#' + consume().value;

        // ── Private function — supports same-line, delimited, and lineal
        // forms (parallels @public functions; constructor form excluded).
        if (peek().type === 'EQUALS') {
          consume(); // =
          // Reject `<...>` — private fns aren't constructors.
          if (peek().type === 'LT') {
            throw new Error(`'${op}' is private — private functions cannot be constructors. Remove the '<...>'.`);
          }
        } else if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
          // Lineal form: '#op\n =\n body'. Skip newlines and require '='.
          while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume();
          if (peek().type !== 'EQUALS') {
            throw new Error(`Expected '=' after private function '${op}'`);
          }
          // Don't consume — fall through to the lineal-body branch below.
        } else {
          throw new Error(`Expected '=' after private function '${op}'`);
        }
        let params;
        let hashBareBody = null;
        if (peek().type === 'LPAREN' && isParenFunctionStart(undefined, true)) {
          params = parseFunctionParamsParen();
          for (const p of params) { if (p.type === null) p.type = 'Anything'; }
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === '->') {
          const pName = consume().value;
          params = [{ name: pName, type: 'Anything', positional: true }];
          consume(); // ->
          const expr = parseExpr();
          let exprType = null;
          if (peek().type === 'DOT') consume();
          else if (isTypeAttestation()) exprType = consumeTypeAttestation();
          hashBareBody = [AST.implicitReturn(expr, exprType)];
        } else if (peek().type === 'EQUALS' || peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
          // Lineal form: '= params = body' or just '= body' (parameterless)
          if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
            while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume();
          }
          if (peek().type === 'EQUALS') {
            consume(); // first =
            skipNewlines();
            if (peek().type === 'EQUALS') {
              consume(); // = = → explicit empty params
              params = [];
            } else {
              const savedPos = pos;
              params = [];
              let foundDelimiter = false;
              let afterNewline = true;
              try {
                while (peek().type !== 'EOF') {
                  if (peek().type === 'NEWLINE') { consume(); afterNewline = true; continue; }
                  if (peek().type === 'COMMA') { consume(); continue; }
                  if (peek().type === 'EQUALS' && afterNewline) { consume(); foundDelimiter = true; break; }
                  if (isParamStart()) { const p = parseOneParam(); if (p) { params.push(p); afterNewline = false; continue; } }
                  break;
                }
              } catch { foundDelimiter = false; }
              if (!foundDelimiter) { pos = savedPos; params = []; }
            }
          } else {
            params = [];
          }
        } else {
          params = [];
        }
        localScopes.push(new Set());
        refVarScopes.push(new Map());
        for (const p of params) if (p.name) declareLocal(p.name);
        skipNewlines();
        let body;
        if (hashBareBody) {
          body = hashBareBody;
        } else if (peek().type === 'LBRACE') {
          consume(); // {
          body = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          if (peek().type === '->' && tokens[pos + 1]?.type === 'LBRACE') {
            throw new Error("'->' followed by '{' is not valid — for a block body, use '(params) { body }' (no arrow)");
          }
          body = parseBody();
        }
        refVarScopes.pop();
        localScopes.pop();
        functions.push(AST.functionDecl(op, params, body));

      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'DOT' && tokens[pos + 2]?.type === 'IDENT' && (tokens[pos + 3]?.type === 'BANG' || tokens[pos + 3]?.type === 'LPAREN')) {
        // Standalone dot-call expression statement: obj.method!(args) or obj.method(args)
        const expr = parseExpr();
        pushExprOrBang(constructorBody, expr);
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'DOT' &&
                 tokens[pos + 2]?.type === 'KEYWORD' && tokens[pos + 2]?.value === 'subscribe') {
        // Class-body subscription: `<param>.subscribe |args| { body }` runs at
        // construction time. parsePrimary handles the trailing-block; we wrap
        // as ExprStatement so the back-compat conversion routes it to initBody.
        const expr = parseExpr();
        constructorBody.push(AST.exprStatement(expr));
      } else if (peek().type === 'IDENT') {
        const op = consume().value;
        let _identOverloadMode = 'create';

        // ── Overload operator: name << ─────────────────────────────────
        if (peekIsAppend()) {
          consumeOverloadOp();
          _identOverloadMode = 'append';
        }

        // ── Lineal constructor form: Name (=)? <params> body ─────────────
        // For create mode, an `=` (body-opener) on a line between `Name` and
        // `<...>` is required. Overload mode (`<<` already consumed) doesn't
        // need the `=`. Same-line `Name = <...>` is handled by the delimited
        // path below.
        {
          let li = pos;
          let hasNewlineBeforeOpener = false;
          while (li < tokens.length && (tokens[li].type === 'NEWLINE' || tokens[li].type === 'BLOCK_SEP')) {
            li++;
            hasNewlineBeforeOpener = true;
          }
          let hasOpenEquals = false;
          if (tokens[li]?.type === 'EQUALS') {
            hasOpenEquals = true;
            li++;
            while (li < tokens.length && (tokens[li].type === 'NEWLINE' || tokens[li].type === 'BLOCK_SEP')) li++;
          }
          if (hasNewlineBeforeOpener && tokens[li]?.type === 'LT' && tokens[li + 1]?.type !== 'LT' && !looksLikeSupertypePrefix(li + 1)) {
            if (_identOverloadMode === 'create' && !hasOpenEquals) {
              throw new Error(`Lineal constructor '${op}' requires '=' before '<...>' — write '${op} = <...>' or '${op}\\n  =\\n  <...>'`);
            }
            while (pos < li) consume(); // skip newlines and optional `=`
            consume(); // <
            const params = [];
            while (peek().type !== 'GT' && peek().type !== 'EOF') {
              if (peek().type === 'NEWLINE') { consume(); continue; }
              if (peek().type === 'COMMA') { consume(); continue; }
              // Bare identifier param (no type)
              if (peek().type === 'IDENT' && !isParamStart()) {
                const next1 = tokens[pos + 1]?.type;
                if (next1 === 'GT' || next1 === 'COMMA' || next1 === 'NEWLINE') {
                  params.push({ name: consume().value, type: 'Anything', positional: true });
                  continue;
                }
              }
              if (isParamStart()) {
                const p = parseOneParam();
                if (p) { params.push(p); continue; }
              }
              break;
            }
            skipNewlines();
            let nested;
            if (peek().type === 'GT') {
              // Explicit params-only: <params> followed by = body . or { body }
              consume(); // >
              skipNewlines();
              if (peek().type === 'EQUALS') {
                consume();
                skipNewlines();
                if (peek().type === 'LBRACE') {
                  throw new Error(`'=' is not valid before '{' — use a lineal body or remove the '=' (in '${op}')`);
                }
              }
              if (peek().type === 'LBRACE') {
                consume(); // {
                nested = parseActorBody(() => peek().type === 'RBRACE');
                skipNewlines();
                expect('RBRACE');
              } else {
                // Lineal body: Name <params> = body .
                nested = parseActorBody(() =>
                  (peek().type === 'DOT') ||
                  (peek().type === 'KEYWORD' && peek().value === 'end'),
                );
                skipBlanks();
                if (peek().type === 'DOT') consume();
                skipBlanks();
                if (peek().type === 'KEYWORD' && peek().value === 'end') {
                  consume();
                  if (peek().type === 'HASH_IDENT') consume();
                }
              }
            } else {
              // Sugared form: < params body > — body continues until >
              nested = parseActorBody(() => peek().type === 'GT');
              skipNewlines();
              expect('GT');
            }
            const actorNode = { params, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: params, constructorBody: nested.constructorBody, asClauses: nested.asClauses, declarationReturn: nested.declarationReturn };
            if (_identOverloadMode !== 'create') {
              // Overload clause: emit as FunctionDecl with actorDef, goes into functions[]
              functions.push(AST.functionDecl(op, params, [], { overloadMode: _identOverloadMode, actorDef: actorNode }));
            } else {
              nestedActors.push(AST.actor(op, { ...actorNode, overloadMode: _identOverloadMode }));
            }
            continue;
          }
        }

        // ── Service constraint parser ────────────────────────────────────
        // Parses { @method: (params) -> (returns), ... }
        // Returns a map: { '@method': { params: [{name, type}], returns: [{name, type}] } }
        function parseServiceConstraint() {
          expect('LBRACE');
          const constraint = {};
          while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
            if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
            // Parse method name: @name or bare name
            let methodName;
            if (peek().type === 'AT') {
              consume(); // @
              const nameTok = consume(); // IDENT or KEYWORD (e.g. 'set', 'get')
              methodName = '@' + nameTok.value;
            } else {
              methodName = consume().value;
            }
            expect('COLON');
            // Parse (params) -> (returns) or () -> (returns)
            expect('LPAREN');
            const params = [];
            while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
              if (peek().type === 'COMMA') { consume(); continue; }
              if (peek().type === 'SIGIL') {
                // :name Type — named param
                const pName = consume().value;
                let pType = null;
                if (peek().type === 'IDENT') { pType = consume().value; }
                params.push({ name: pName, type: pType });
              } else {
                const pName = expect('IDENT').value;
                let pType = null;
                if (peek().type === 'IDENT') {
                  // positional: Type (name is actually the type)
                  pType = pName;
                }
                params.push({ name: pName, type: pType });
              }
            }
            expect('RPAREN');
            let returns = null;
            if (peek().type === 'ARROW' || peek().value === '->') {
              consume(); // ->
              expect('LPAREN');
              returns = [];
              while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
                if (peek().type === 'COMMA') { consume(); continue; }
                if (peek().type === 'SIGIL') {
                  // :name Type — named return field
                  const rName = consume().value;
                  let rType = null;
                  if (peek().type === 'IDENT') { rType = consume().value; }
                  returns.push({ name: rName, type: rType });
                } else {
                  const rName = expect('IDENT').value;
                  let rType = null;
                  if (peek().type === 'IDENT') {
                    rType = rName;
                  }
                  returns.push({ name: rName, type: rType });
                }
              }
              expect('RPAREN');
            }
            constraint[methodName] = { params, returns };
          }
          expect('RBRACE');
          return constraint;
        }

        // ── Delimited form: name = ... or name << |...| / name << <...> ──
        // For overload operators, only enter delimited path if next token is NOT newline
        // (newline means lineal form, handled in the else branch below)
        if (peek().type === 'EQUALS' || (_identOverloadMode !== 'create' && peek().type !== 'NEWLINE' && peek().type !== 'BLOCK_SEP')) {
          if (peek().type === 'EQUALS') consume(); // eat the = (already consumed << or >> for overloads)
          // Allow `= \n <...>` — the body-opener `=` may sit on its own line
          // before the constructor params.
          if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
            let _li = pos;
            while (_li < tokens.length && (tokens[_li].type === 'NEWLINE' || tokens[_li].type === 'BLOCK_SEP')) _li++;
            if (tokens[_li]?.type === 'LT' && tokens[_li + 1]?.type !== 'LT') {
              while (pos < _li) consume();
            }
          }
          // ── Function() — empty overload initializer ──────────────────
          if (peek().type === 'IDENT' && peek().value === 'Function' && tokens[pos + 1]?.type === 'LPAREN' && tokens[pos + 2]?.type === 'RPAREN') {
            consume(); consume(); consume(); // Function ( )
            functionNames.add(op);
            functions.push(AST.functionDecl(op, [], [], { emptyOverload: true }));
            continue;
          }
          // Constructor: name = <params> { body } or name = < params body >
          // Subclass:     name = <T |> { body } or name = <T | params> { body }
          if (peek().type === 'LT') {
            consume(); // <
            // ── Subclass detection: T |  or  T *name |  or  T* | ───────
            const supertypes = [];
            skipNewlines();
            if (looksLikeSupertypePrefix()) {
              while (peek().type === 'IDENT') {
                const stName = consume().value;
                const st = { supertype: stName };
                if (peek().type === 'STAR') {
                  consume(); // *
                  if (peek().type === 'IDENT') {
                    st.wrappedAs = consume().value;
                  } else {
                    st.wrappedAs = stName;
                  }
                }
                supertypes.push(st);
                skipNewlines();
                if (peek().type === 'COMMA') { consume(); skipNewlines(); continue; }
                break;
              }
              skipNewlines();
              expect('PIPE'); // separator between supertypes and params
            }
            // Parse leading bare typed declarations as params
            // A bare typed decl: IDENT IDENT, NOT followed by EQUALS
            const isSugaredParam = () => {
              // (name) Type — positional with suppressed accessor
              if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'RPAREN') return true;
              if (peek().type !== 'IDENT' && peek().type !== 'SIGIL') return false;
              if (peek().type === 'SIGIL') {
                const next = tokens[pos + 1]?.type;
                // :name Type, :name = value, :name "literal", :name 42, :name *, :name (bare)
                return next === 'IDENT' || next === 'EQUALS' || next === 'STRING' || next === 'NUMBER'
                  || next === 'STAR' || next === 'GT' || next === 'COMMA' || next === 'NEWLINE'
                  || (next === 'KEYWORD' && (tokens[pos + 1]?.value === 'true' || tokens[pos + 1]?.value === 'false' || tokens[pos + 1]?.value === 'null'));
              }
              // Bare identifier (no type): inner, doubler, etc.
              const next1 = tokens[pos + 1]?.type;
              if (next1 === 'GT' || next1 === 'COMMA' || next1 === 'NEWLINE') return true;
              // Named param: name: Type
              if (next1 === 'COLON') return true;
              // Inferred default: name=literal (IDENT EQUALS NUMBER/STRING/etc.)
              if (next1 === 'EQUALS') {
                const afterEq = tokens[pos + 2]?.type;
                return afterEq === 'NUMBER' || afterEq === 'STRING' ||
                  (afterEq === 'KEYWORD' && (tokens[pos + 2]?.value === 'true' || tokens[pos + 2]?.value === 'false' || tokens[pos + 2]?.value === 'null'));
              }
              // Typed: name Type (not followed by =)
              if (next1 !== 'IDENT') return false;
              const ts = pos + 1;
              const afterType = ts + typeLength(ts);
              const next = tokens[afterType]?.type;
              // name Type! — ref cell declaration, not a param
              if (next === 'BANG') return false;
              if (next === 'EQUALS') {
                // name Type = ... — is this a default value or an assignment?
                // If followed by a literal, it's a default value (param)
                const afterEq = tokens[afterType + 1]?.type;
                return afterEq === 'NUMBER' || afterEq === 'STRING' ||
                  (afterEq === 'KEYWORD' && (tokens[afterType + 1]?.value === 'true' || tokens[afterType + 1]?.value === 'false' || tokens[afterType + 1]?.value === 'null'));
              }
              return true;
            };
            const cParams = [];
            while (peek().type !== 'GT' && peek().type !== 'EOF') {
              if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
              // ── Actor ref params with * syntax ──────────────────────────
              // Positional: name * or name*
              if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'STAR') {
                const next2 = tokens[pos + 2]?.type;
                if (next2 === 'GT' || next2 === 'COMMA' || next2 === 'NEWLINE') {
                  const name = consume().value;
                  consume(); // STAR
                  cParams.push({ name, type: 'Anything', positional: true, ref: true });
                  continue;
                }
              }
              // Sigil ref: :name * or :name *Type
              if (peek().type === 'SIGIL' && (tokens[pos + 1]?.type === 'STAR' || tokens[pos + 1]?.type === 'LBRACE')) {
                const name = consume().value;
                if (peek().type === 'STAR') {
                  consume();
                  cParams.push({ name, type: 'Anything', ref: true });
                  continue;
                }
                // :name { constraint } — sigil with service constraint
                if (peek().type === 'LBRACE') {
                  const constraint = parseServiceConstraint();
                  cParams.push({ name, type: 'Anything', ref: true, constraint });
                  continue;
                }
              }
              // Keyed ref: key: (alias) * | key: (alias)*
              if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
                const savedPos = pos;
                const keyName = consume().value;
                consume(); // COLON
                if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'RPAREN' && tokens[pos + 3]?.type === 'STAR') {
                  // key: (alias) *
                  consume(); // LPAREN
                  const alias = consume().value;
                  consume(); // RPAREN
                  consume(); // STAR
                  cParams.push({ key: keyName, name: alias, type: 'Anything', ref: true });
                  continue;
                }
                // Not a remap pattern, restore position
                pos = savedPos;
              }
              // ── Inline service constraint: name { @method: (params) -> (returns) } ──
              if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LBRACE') {
                const name = consume().value;
                const constraint = parseServiceConstraint();
                cParams.push({ name, type: 'Anything', positional: true, ref: true, constraint });
                continue;
              }
              // ── Existing param forms ────────────────────────────────────
              if (isSugaredParam()) {
                // Bare identifier param (no type annotation)
                const next1 = tokens[pos + 1]?.type;
                if (peek().type === 'IDENT' && (next1 === 'GT' || next1 === 'COMMA' || next1 === 'NEWLINE')) {
                  cParams.push({ name: consume().value, type: 'Anything', positional: true });
                  continue;
                }
                const p = parseOneParam();
                if (p) { cParams.push(p); continue; }
              }
              break;
            }
            skipNewlines();
            let nested;
            if (peek().type === 'GT') {
              // Explicit params-only: <params> followed by { body } or lineal body
              consume(); // >
              skipNewlines();
              // Optional trailing `=` opens a lineal body; `= {` is illegal.
              if (peek().type === 'EQUALS') {
                consume();
                skipNewlines();
                if (peek().type === 'LBRACE') {
                  throw new Error(`'=' is not valid before '{' — use a lineal body or remove the '=' (in '${op}')`);
                }
              }
              if (peek().type === 'LBRACE') {
                consume(); // {
                nested = parseActorBody(() => peek().type === 'RBRACE');
                skipNewlines();
                expect('RBRACE');
              } else {
                // Lineal body after = <params>
                nested = parseActorBody(() =>
                  (peek().type === 'DOT') ||
                  (peek().type === 'KEYWORD' && peek().value === 'end'),
                );
                skipBlanks();
                if (peek().type === 'DOT') consume();
                skipBlanks();
                if (peek().type === 'KEYWORD' && peek().value === 'end') {
                  consume();
                  if (peek().type === 'HASH_IDENT') consume();
                }
              }
            } else {
              // Sugared form: < params body > — body continues until >
              nested = parseActorBody(() => peek().type === 'GT');
              skipNewlines();
              expect('GT');
            }
            const actorNode2 = { params: cParams, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: cParams, constructorBody: nested.constructorBody, asClauses: nested.asClauses, supertypes, declarationReturn: nested.declarationReturn };
            if (_identOverloadMode !== 'create') {
              functions.push(AST.functionDecl(op, cParams, [], { overloadMode: _identOverloadMode, actorDef: actorNode2 }));
            } else {
              nestedActors.push(AST.actor(op, { ...actorNode2, overloadMode: _identOverloadMode }));
            }
            continue;
          }
          // Value assignment: name = expr (not a function body)
          const _valueTok = peek().type;
          const _isParensFnStart = _valueTok === 'LPAREN' && isParenFunctionStart(undefined, true);
          const _isBareFnStart = _valueTok === 'IDENT' && tokens[pos + 1]?.type === '->';
          const _isFnStart = _valueTok === '->' || _valueTok === 'LBRACE' || _valueTok === 'NEWLINE' || _valueTok === 'BLOCK_SEP' || _isParensFnStart || _isBareFnStart;
          if (!_isFnStart) {
            // ingest or ingest(default) — superclass receives subclass declaration return
            if (peek().type === 'KEYWORD' && peek().value === 'ingest') {
              consume(); // ingest
              let defaultValue = null;
              if (peek().type === 'LPAREN') {
                consume(); // (
                defaultValue = parseExpr();
                expect('RPAREN');
              }
              let typeName = null;
              if (isTypeAttestation()) typeName = consumeTypeAttestation();
              constructorBody.push(AST.typedAssign(op, typeName, AST.ingestExpr(defaultValue)));
              continue;
            }
            const value = parseExpr();
            // Service coercion: name = ref as { @method: ... }
            if (peek().type === 'KEYWORD' && peek().value === 'as' && tokens[pos + 1]?.type === 'LBRACE') {
              consume(); // as
              const constraint = parseServiceConstraint();
              constructorBody.push(AST.serviceCoercion(op, value, constraint));
              continue;
            }
            // Constructor coercion: name = ref as <:p Type, ...> -> { @method: ... }
            if (peek().type === 'KEYWORD' && peek().value === 'as' && tokens[pos + 1]?.type === 'LT') {
              consume(); // as
              consume(); // <
              skipNewlines();
              const ctorParams = [];
              while (peek().type !== 'GT' && peek().type !== 'EOF') {
                if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
                const p = parseOneParam();
                if (p === null) break;
                ctorParams.push(p);
              }
              expect('GT');
              skipNewlines();
              if (peek().type !== '->') {
                throw new Error(`Expected '->' after constructor params in coercion of '${op}'`);
              }
              consume(); // ->
              skipNewlines();
              if (peek().type !== 'LBRACE') {
                throw new Error(`Expected '{ ... }' service interface after '->' in coercion of '${op}'`);
              }
              const constraint = parseServiceConstraint();
              constructorBody.push(AST.serviceCoercion(op, value, constraint, ctorParams));
              continue;
            }
            let typeName = null;
            if (isTypeAttestation()) typeName = consumeTypeAttestation();
            constructorBody.push(AST.typedAssign(op, typeName, value));
            continue;
          }
          let params;
          let bareFormBody = null;
          if (peek().type === 'LPAREN' && isParenFunctionStart(undefined, true)) {
            // Parens-delimited params: (a, b) or (a Integer, :b)
            params = parseFunctionParamsParen();
            for (const p of params) { if (p.type === null) p.type = 'Anything'; }
          } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === '->') {
            // Bare-param form: name -> expr (single generic param)
            const pName = consume().value;
            params = [{ name: pName, type: 'Anything', positional: true }];
            consume(); // ->
            // Body is a single expression to EOL — wrap as implicit return.
            const expr = parseExpr();
            let exprType = null;
            if (peek().type === 'DOT') consume();
            else if (isTypeAttestation()) exprType = consumeTypeAttestation();
            bareFormBody = [AST.implicitReturn(expr, exprType)];
          } else {
            params = [];
          }
          const slots = new Set();
          params.forEach((p, i) => {
            if (isFunctionType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
          });
          if (slots.size > 0) functionParamSlots.set(op, slots);
          localScopes.push(new Set());
          refVarScopes.push(new Map());
          for (const p of params) if (p.name) declareLocal(p.name);
          skipNewlines();
          let body;
          if (bareFormBody) {
            body = bareFormBody;
          } else if (peek().type === 'LBRACE') {
            consume(); // {
            body = parseBody('RBRACE');
            skipNewlines();
            expect('RBRACE');
            // Optional return type after closing brace: } : Type or } as Type
            if (isTypeAttestation()) {
              consumeTypeAttestation(); // consume but discard for internal functions
            } else if (peek().type === 'COLON') {
              consume(); // COLON
              parseType(); // consume but discard
            }
          } else {
            if (peek().type === '->' && tokens[pos + 1]?.type === 'LBRACE') {
              throw new Error("'->' followed by '{' is not valid — for a block body, use '(params) { body }' (no arrow)");
            }
            body = parseBody();
          }
          refVarScopes.pop();
          localScopes.pop();
          functions.push(AST.functionDecl(op, params, body, { overloadMode: _identOverloadMode }));

        // ── Lineal form: name params\n\nbody ────────────────────────────
        } else {
          const params = parseParams();

          // Check if this is a named actor definition (body contains @, or as)
          if (isActorBodyStart()) {
            const nested = parseActorBody(() =>
              (peek().type === 'DOT') ||
              (peek().type === 'KEYWORD' && peek().value === 'end'),
            );
            // Consume . terminator or end#Name
            skipBlanks();
            if (peek().type === 'DOT') consume();
            skipBlanks();
            if (peek().type === 'KEYWORD' && peek().value === 'end') {
              consume(); // 'end'
              if (peek().type === 'HASH_IDENT') consume(); // #Name
            }
            const actorNode3 = { params, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: params, constructorBody: nested.constructorBody, asClauses: nested.asClauses, declarationReturn: nested.declarationReturn };
            if (_identOverloadMode !== 'create') {
              functions.push(AST.functionDecl(op, params, [], { overloadMode: _identOverloadMode, actorDef: actorNode3 }));
            } else {
              nestedActors.push(AST.actor(op, { ...actorNode3, overloadMode: _identOverloadMode }));
            }
          } else {
            // Regular private function definition
            const slots = new Set();
            params.forEach((p, i) => {
              if (isFunctionType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
            });
            if (slots.size > 0) functionParamSlots.set(op, slots);
            localScopes.push(new Set());
            refVarScopes.push(new Map());
            for (const p of params) if (p.name) declareLocal(p.name);
            const body = parseBody();
            refVarScopes.pop();
            localScopes.pop();
            functions.push(AST.functionDecl(op, params, body, { overloadMode: _identOverloadMode }));
          }
        }
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator between top-level declarations
      } else if (peek().type === 'STRING' || peek().type === 'INTERP_STRING' || peek().type === 'NUMBER' ||
                 peek().type === 'LPAREN' || peek().type === 'LBRACKET' ||
                 peek().type === 'HTML_CONSTRUCTOR' ||
                 (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false'))) {
        const expr = parseExpr();
        if (expr.type === 'Function' || expr.type === 'Lambda') {
          throw new Error('Service block return-as value must not be a function');
        }
        let typeName = null;
        if (isTypeAttestation()) { typeName = consumeTypeAttestation(); }
        constructorBody.push(AST.implicitReturn(expr, typeName));
      } else {
        throw new Error(`Unexpected token at top level: ${peek().type} '${peek().value || ''}'`);
      }
    }
    // Back-compat: produce stateVarDecls/initBody/initParams from constructorBody for codegen
    function inferType(value) {
      if (!value) return null;
      if (value.type === 'IntLiteral') return 'Integer';
      if (value.type === 'StringLiteral') return 'Text';
      if (value.type === 'BoolLiteral') return 'Boolean';
      if (value.type === 'ListLiteral') return 'List';
      if (value.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier' && /^[A-Z]/.test(value.callee.name)) {
        return value.callee.name;
      }
      return null;
    }
    // A TypedAssign that constructs against a declared dependency (or a
    // constructor coercion of one) is conceptually a ref decl: it produces
    // an actor-instance handle. Mark such state vars as isRef so codegens
    // that key on isRef (erlang/rust) emit `new` for them.
    const depRefNames = new Set(dependencies.map(d => d.name));
    for (const stmt of constructorBody) {
      if (stmt.type === 'ServiceCoercion' && stmt.constructorParams) {
        depRefNames.add(stmt.name);
      }
    }
    const isDepConstructorCall = (value) =>
      value?.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier' &&
      depRefNames.has(value.callee.name);
    const stateVarDecls = [];
    const initBody = [];
    let declarationReturn = null;
    for (const stmt of constructorBody) {
      if (stmt.type === 'ImplicitReturn') {
        if (!stmt.typeName) {
          const inferred = inferType(stmt.expr);
          if (inferred) stmt.typeName = inferred;
        }
        declarationReturn = stmt;
      } else if (stmt.type === 'ExprStatement') {
        initBody.push(stmt);
      } else if (stmt.type === 'TypedAssign' || stmt.type === 'RefDecl') {
        const isIngest = stmt.value?.type === 'IngestExpr';
        const isRef = stmt.type === 'RefDecl' || isDepConstructorCall(stmt.value);
        stateVarDecls.push({
          name: stmt.name,
          typeName: stmt.typeName || stmt.rhsType || inferType(stmt.value) || 'Anything',
          isRef,
          ...(isIngest && { ingest: true, ingestDefault: stmt.value.defaultValue }),
        });
        initBody.push(AST.stateAssign(stmt.name, stmt.value, { isRef }));
      }
    }
    refVarScopes.pop(); // end actor-level ref scope
    return { functions, nestedActors, stateVarDecls, initBody, initParams: [], constructorBody, asClauses, declarationReturn };
  }

  const actors = [];
  const dependencies = [];
  const types = [];
  let headerSeen = false;

  // Parse one type field declaration:
  //   `name Type`   — positional (no colon)
  //   `name: Type`  — named (postfix colon)
  //   `? name Type` — positional, optional
  //   `? name: Type` — named, optional
  // Slices 1, 7, 8, 11 of types-implementation-plan-2026-04-27.
  function parseTypeField() {
    let optional = false;
    if (peek().type === 'QUESTION') {
      consume();
      optional = true;
    }
    const fieldName = expect('IDENT').value;
    let named = false;
    if (peek().type === 'COLON') {
      consume();
      named = true;
    }
    const paramType = parseType();
    return AST.typeField(fieldName, paramType, { optional, named });
  }

  // Parse `::Name = (fields)` (delimited form, single- or multi-line) or
  // `::Name = <linebreak> <indented fields>` (lineal form). The lineal form
  // terminates at the first BLOCK_SEP (blank line) or EOF.
  function parseTypeDecl() {
    consume(); // DCOLON
    const name = expect('IDENT').value;
    expect('EQUALS');
    const fields = [];
    if (peek().type === 'LPAREN') {
      consume();
      while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
        if (peek().type === 'COMMA' || peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
          consume();
          continue;
        }
        fields.push(parseTypeField());
      }
      expect('RPAREN');
    } else {
      while (peek().type === 'NEWLINE') consume();
      while (peek().type !== 'EOF' && peek().type !== 'BLOCK_SEP' && peek().type !== 'DCOLON') {
        if (peek().type === 'COMMA' || peek().type === 'NEWLINE') { consume(); continue; }
        if (peek().type !== 'IDENT') break;
        fields.push(parseTypeField());
      }
    }
    return AST.typeDecl(name, fields);
  }

  while (peek().type !== 'EOF') {
    skipBlanks();
    if (peek().type === 'EOF') break;

    if (peek().type === 'DCOLON') {
      types.push(parseTypeDecl());
      continue;
    }

    // ── File-level constructor header ──────────────────────────────────────
    //   < "/path": (Alias) *  >                       — service ref, fetched externally
    //   < "/path": (Alias) { iface } >                — service ref, inline interface
    //   < "/path": (Alias) #  >                       — actor constructor, fetched externally
    //   < "/path": (Alias) <:p Type> -> { iface } >   — actor constructor, inline manifest
    //   <:name *>                                     — shorthand: path and alias both = "name"
    if (peek().type === 'LT') {
      if (headerSeen) {
        throw new Error(`Multiple constructor headers are not allowed — combine all dependencies into a single < ... > block`);
      }
      headerSeen = true;
      consume(); // <
      skipNewlines();
      const tokText = (tok) => {
        if (tok.type === 'SIGIL') return ':' + tok.value;
        if (tok.value != null) return String(tok.value);
        const map = { COLON: ':', LPAREN: '(', RPAREN: ')', DOT: '.', COMMA: ',', PIPE: '|', '->': '->', AT: '@', BANG: '!' };
        return map[tok.type] || tok.type;
      };
      const parseInlineIface = () => {
        consume(); // {
        const lines = [];
        while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
          if (peek().type === 'NEWLINE') { consume(); continue; }
          let line = '';
          while (peek().type !== 'NEWLINE' && peek().type !== 'RBRACE' && peek().type !== 'EOF') {
            const tok = consume();
            const text = tokText(tok);
            const noSpaceBefore = text === ':' || text === ',' || text === ')';
            const prevEndsOpen = line.endsWith('(');
            if (line && !noSpaceBefore && !prevEndsOpen) line += ' ';
            line += text;
          }
          line = line.trim();
          if (line) lines.push(line);
        }
        expect('RBRACE');
        return '{\n  ' + lines.join('\n  ') + '\n}';
      };
      const parseAsTypeSuffix = (iface) => {
        skipNewlines();
        const types = [];
        while (peek().type === 'PIPE') {
          consume(); // |
          skipNewlines();
          types.push(expect('IDENT').value);
          skipNewlines();
        }
        if (types.length === 0) return iface;
        return `${iface} | ${types.join(' | ')}`;
      };
      while (peek().type !== 'GT' && peek().type !== 'EOF') {
        if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
        let path, alias, destructures = null;
        if (peek().type === 'SIGIL') {
          // Two disambiguated cases:
          //   :name [#]  |  :name (end-of-entry)  → path-shorthand dependency
          //   :name Type                            → named scalar file-param
          const nextType = tokens[pos + 1]?.type;
          if (nextType === 'HASH' || nextType === 'GT' || nextType === 'COMMA' || nextType === 'NEWLINE') {
            const sigil = consume();
            path = sigil.value;
            alias = sigil.value;
            // Service dep with no destructures: commit before skipNewlines eats the terminator
            if (peek().type === 'GT' || peek().type === 'COMMA' || peek().type === 'NEWLINE') {
              dependencies.push(AST.dependency(alias, { path, destructures: null }));
              continue;
            }
          } else {
            const p = parseOneParam();
            if (p === null) throw new Error(`Expected scalar param after ':' in file-level header`);
            dependencies.push(AST.fileParam(p.name, { type: p.type, positional: false, defaultValue: p.defaultValue }));
            continue;
          }
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON' && tokens[pos + 2]?.type === 'LPAREN') {
          // Bare-identifier dependency: `HTML: (:div) *`
          alias = consume().value;
          path = alias;
          consume(); // COLON
        } else if (peek().type === 'IDENT') {
          // Positional scalar file-param: `name Type`
          const p = parseOneParam();
          if (p === null) throw new Error(`Expected positional scalar param in file-level header`);
          dependencies.push(AST.fileParam(p.name, { type: p.type, positional: true, defaultValue: p.defaultValue }));
          continue;
        } else {
          path = expect('STRING').value;
          expect('COLON');
        }
        skipNewlines();
        if (peek().type === 'LPAREN') {
          expect('LPAREN');
          const isDestructure = peek().type === 'SIGIL' ||
            peek().type === 'ELLIPSIS' ||
            (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON' &&
              (tokens[pos + 2]?.type === 'IDENT' || tokens[pos + 2]?.type === 'DISCARD'));
          if (isDestructure) {
            destructures = [];
            while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
              if (peek().type === 'COMMA' || peek().type === 'NEWLINE') { consume(); continue; }
              if (peek().type === 'ELLIPSIS') {
                consume();
                destructures.push({ spread: true });
              } else if (peek().type === 'SIGIL') {
                const name = consume().value;
                destructures.push({ local: name, remote: name });
              } else if (peek().type === 'IDENT') {
                const remote = consume().value;
                expect('COLON');
                if (peek().type === 'DISCARD') {
                  consume();
                  destructures.push({ remote, discard: true });
                } else {
                  const local = expect('IDENT').value;
                  let type = null;
                  if (peek().type === 'IDENT' && peek().value?.[0] === peek().value?.[0]?.toUpperCase()) {
                    type = consume().value;
                  }
                  destructures.push({ local, remote, ...(type && { type }) });
                }
              } else {
                throw new Error(`Expected ':name', 'Remote: local', 'Remote: _', or '...' in destructure list, got ${peek().type}`);
              }
            }
            if (!alias) alias = path;
          } else {
            alias = expect('IDENT').value;
          }
          expect('RPAREN');
        }
        // end-of-entry — service reference, interface fetched via options.remotes
        // (check before skipNewlines so the NEWLINE terminator isn't consumed early)
        if (peek().type === 'GT' || peek().type === 'COMMA' || peek().type === 'NEWLINE') {
          dependencies.push(AST.dependency(alias, { path, destructures }));
          continue;
        }
        skipNewlines(); // # or { must be on the same line; skip remaining whitespace
        // (Alias) # — actor constructor, manifest fetched via options.remotes
        if (peek().type === 'HASH') {
          consume(); // #
          dependencies.push(AST.dependency(alias, { path, generic: true, destructures }));
          continue;
        }
        // (Alias) <:p Type, ...> -> { iface } — explicit constructor + service
        if (peek().type === 'LT') {
          consume(); // <
          skipNewlines();
          const ctorParams = [];
          while (peek().type !== 'GT' && peek().type !== 'EOF') {
            if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
            const p = parseOneParam();
            if (p === null) break;
            ctorParams.push(p);
          }
          expect('GT');
          skipNewlines();
          if (peek().type !== '->') {
            throw new Error(`Expected '->' after constructor params for dependency '${alias}'`);
          }
          consume(); // ->
          skipNewlines();
          if (peek().type !== 'LBRACE') {
            throw new Error(`Expected '{ ... }' service interface after '->' for dependency '${alias}'`);
          }
          let iface = parseInlineIface();
          iface = parseAsTypeSuffix(iface);
          dependencies.push(AST.dependency(alias, { path, interface: iface, constructorParams: ctorParams, destructures }));
          continue;
        }
        // (Alias) { iface } — service reference with inline interface
        if (peek().type === 'LBRACE') {
          let iface = parseInlineIface();
          iface = parseAsTypeSuffix(iface);
          dependencies.push(AST.dependency(alias, { interface: iface, path, destructures }));
          continue;
        }
        throw new Error(`File-level dependency '${alias}' requires #, { iface }, or <ctor> -> { iface }`);
      }
      expect('GT');
      skipBlanks();
      if (peek().type !== 'EOF') {
        if (peek().type !== 'EQUALS') {
          throw new Error(`Expected '=' on its own line after constructor header < ... >, got '${peek().value ?? peek().type}'`);
        }
        consume(); // =
      }
      continue;
    }

    if (peek().type === 'AT' || peek().type === 'IDENT' || peek().type === 'HASH_IDENT' ||
               peek().type === 'DIVIDER' ||
               peek().type === 'STRING' || peek().type === 'INTERP_STRING' || peek().type === 'NUMBER' ||
               peek().type === 'LPAREN' || peek().type === 'LBRACKET' ||
               (peek().type === 'KEYWORD' && (peek().value === 'self' || peek().value === 'true' || peek().value === 'false'))) {
      // anonymous actor — collect functions and nested actor definitions
      const { functions, nestedActors, stateVarDecls, initBody, initParams, constructorBody, asClauses, declarationReturn } = parseActorBody(
        () => false,
      );
      actors.push(AST.actor(null, { functions, stateVarDecls, initBody, initParams, constructorBody, asClauses, declarationReturn }));
      // Promote nested actor definitions to top-level actors
      actors.push(...nestedActors);
    } else {
      consume();
    }
  }

  const result = AST.program(actors, dependencies, types);
  return result;
}
