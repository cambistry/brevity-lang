import { settleWriterBody } from './writer_body.js';
import * as AST from './ast.js';
import { isLiteralDefault } from './param_defaults.js';
import { checkChainReceivers, lowerSelfChains } from './chains.js';
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

// Functions declared at file level, found up front so that one named like a bare
// builtin (`take`, `first`) shadows it wherever it's called, before or after.
function fileLevelFunctionNames(tokens) {
  const names = new Set();
  let depth = 0;
  tokens.forEach((t, i) => {
    if (t.type === 'LBRACE' || t.type === 'LPAREN') depth++;
    else if (t.type === 'RBRACE' || t.type === 'RPAREN') depth--;
    else if (depth === 0 && t.type === 'IDENT' && tokens[i - 1]?.type !== 'AT' && tokens[i + 1]?.type === 'EQUALS' && ['LPAREN', 'LBRACE', '->'].includes(tokens[i + 2]?.type)) names.add(t.value);
  });
  return names;
}

// `@a <- v` writes this actor's published cell. It's one name to the statement forms.
function joinOwnCellWrites(tokensIn) {
  const written = new Set();
  const out = [];
  for (let i = 0; i < tokensIn.length; i++) {
    const [t, next, after] = [tokensIn[i], tokensIn[i + 1], tokensIn[i + 2]];
    if (t.type === 'AT' && next?.type === 'IDENT' && (after?.type === 'SET' || after?.type === 'UPDATE')) {
      written.add('@' + next.value);
      out.push({ ...next, value: '@' + next.value });
      i++;
    } else {
      out.push(t);
    }
  }
  return { tokens: out, written };
}

export function parse(tokensIn) {
  const { tokens: joined, written: ownCellWrites } = joinOwnCellWrites(tokensIn);
  let tokens = joined;
  let pos = 0;
  const functionNames = new Set();
  const fileFunctionNames = fileLevelFunctionNames(tokensIn);
  const localScopes = [new Set()];
  const refVarScopes = [new Map()];
  const readonlyParamScopes = [new Set()];
  const fnSignatures = new Map();
  const functionParamSlots = new Map();
  const refParamSlots = new Map();
  const labelStack = [];
  // Classes declared inside a class. Each goes on the program's flat list, with
  // `enclosing` naming the class it's declared in (src/outer_reads.js).
  const hoistedClasses = [];
  const hoistNested = (nested, op) => {
    for (const a of nested.nestedActors || []) { a.enclosing = op; hoistedClasses.push(a); }
    nested.nestedActors = [];
  };
  // Suppressed when parsing an expression whose trailing `->` belongs to an
  // outer construct (if-cond, while if-cond, handler-if cond), so that
  // `if x -> body` doesn't get eaten as a bare-form function literal.
  // Re-enabled inside fresh sub-expression contexts (parens, call args, etc.).
  let bareFuncAllowed = true;

  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && /[-=~]>/.test(t));

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
  // Effect arrows belong to signatures. A body's arrow is always `->`.
  let inSignature = 0;
  let ctorArrow = '->';
  const consume = () => {
    const tok = tokens[pos++];
    if (tok?.type === '->' && tok.value !== '->' && inSignature === 0) {
      throw new Error(`'${tok.value}' is only for signatures — a function body's arrow is '->'`);
    }
    return tok;
  };
  const skipNewlines = () => { while (peek().type === 'NEWLINE') consume(); };
  // `return` is the explicit value-return keyword. `->` is the lambda /
  // body-opener arrow; standing on its own where a statement is expected, it is
  // simply a misplaced arrow (syntax error).
  const isReturnKw = () => peek().type === 'KEYWORD' && peek().value === 'return';
  const MISPLACED_ARROW_MSG = "'->' is the lambda arrow and can't start a statement here";

  // Silence is in a declaration's name (`sfn. = …`), never a trailing `.` in its
  // body. `declCtx` is the named declaration whose body is being parsed (null
  // inside a lambda, whose trailing `.` still marks it silent). Inside one, a
  // source `.` / `return .` / `-> .` is an error; inside a silent one, a bare
  // `return` exits early and `return value` is an error.
  let declCtx = null;
  const declFor = (name) => ({ name, silent: name.endsWith('.') });
  const trailingDotError = () => {
    const { name, silent, builtin } = declCtx;
    if (builtin) return new Error(`'${name}' takes no trailing '.'`);
    if (silent) return new Error(`'${name}' is silent by its name — drop the trailing '.' ('return' exits early)`);
    return new Error(`A trailing '.' no longer makes a function silent — name it '${name}.' and drop the '.'`);
  };
  // `set = (params) -> stmt` is a one-line body: the end of its line ends it
  // (a trailing `.` used to), so the next declaration may follow directly.
  const endArrowStatementAtLine = () => {
    let i = pos;
    while (i < tokens.length && tokens[i].type !== 'NEWLINE' && tokens[i].type !== 'BLOCK_SEP' && tokens[i].type !== 'EOF') i++;
    if (tokens[i]?.type === 'NEWLINE') tokens[i] = { type: 'BLOCK_SEP' };
  };
  const atBareReturnEnd = () => {
    const t = peek().type;
    return t === 'NEWLINE' || t === 'RBRACE' || t === 'BLOCK_SEP' || t === 'EOF' || t === 'DIVIDER';
  };
  // After `return` in a silent declaration: a bare `return` is a silent early
  // exit (returns true — caller pushes the terminator); a value is an error.
  const silentReturn = () => {
    if (!declCtx?.silent) return false;
    if (peek().type === 'DOT') throw trailingDotError();
    if (atBareReturnEnd()) return true;
    throw new Error(`'${declCtx.name}' is silent — 'return' takes no value`);
  };
  const skipBlanks = () => { while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume(); };
  const currentScope = () => localScopes[localScopes.length - 1];
  const declareLocal = (name) => { if (name) currentScope().add(name); };
  const isKnownLocal = (name) => localScopes.some(scope => scope.has(name));
  const addRef = (name, typeName = null) => refVarScopes[refVarScopes.length - 1].set(name, typeName);
  const isRef = (name) => ownCellWrites.has(name) || refVarScopes.some(s => s.has(name));
  const addReadonlyParam = (name) => { if (name) readonlyParamScopes[readonlyParamScopes.length - 1].add(name); };
  const isReadonlyParam = (name) => readonlyParamScopes.some(s => s.has(name));
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

  // Detect the retired superclass prefix: T |, T* |, T *name |, T, U |
  const looksLikeRetiredSupertypePrefix = (startPos = pos) => {
    let look = startPos;
    while (tokens[look]?.type === 'NEWLINE') look++;
    while (true) {
      if (tokens[look]?.type === 'AT') look++;
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

  // The `++` rewrite of a retired `(T *sup, U | params)` prefix, for the error.
  const retiredSupertypeMessage = (op) => {
    const parents = [];
    let look = pos;
    while (tokens[look]?.type !== 'PIPE') {
      const t = tokens[look];
      if (t.type === 'AT') parents.push({ name: '@' });
      else if (t.type === 'IDENT' && tokens[look - 1]?.type === 'STAR') parents[parents.length - 1].wrap = t.value;
      else if (t.type === 'IDENT' && tokens[look - 1]?.type === 'AT') parents[parents.length - 1].name += t.value;
      else if (t.type === 'IDENT') parents.push({ name: t.value });
      else if (t.type === 'STAR') parents[parents.length - 1].wrap ??= 'name';
      look++;
    }
    const hasParams = tokens[look + 1] && tokens[look + 1].type !== 'RPAREN';
    const shown = parents.map(p => (p.wrap ? `${p.wrap} ` : '') + p.name).join(' ++ ');
    const tail = hasParams ? ' ++ params' : parents.at(-1).wrap ? ' ++' : parents.length === 1 ? '++' : '';
    return `In '${op}', the subclass bar '|' is retired — extend with '++': write '(${shown}${tail})'`;
  };

  // An extends parent at token `i`: `[@]B`, or `sup [@]B` (the parent wrapped as a
  // local). A wrapped parent has the shape of a positional param (`b Box`); the caller
  // decides between them by what follows.
  const parentSegmentAt = (i) => {
    const nameLen = (j) => tokens[j]?.type === 'AT' ? (tokens[j + 1]?.type === 'IDENT' ? 2 : 0) : (tokens[j]?.type === 'IDENT' ? 1 : 0);
    const n = nameLen(i);
    if (!n) return null;
    if (n === 1) { const m = nameLen(i + 1); if (m) return { len: 1 + m, wrapped: true }; }
    return { len: n, wrapped: false };
  };

  // Token types that end a bare `D = A ++ B` definition.
  const isDefinitionEnd = (i) => ['NEWLINE', 'BLOCK_SEP', 'EOF', 'RBRACE', 'DIVIDER'].includes(tokens[i]?.type);

  // A bare extends definition at `i`: `A ++ …` (no parens), as in `D = C++`,
  // `D = A ++ B`, `D = C ++ *{ … }`.
  const isBareExtendStart = (i = pos) => {
    const seg = parentSegmentAt(i);
    return !!seg && tokens[i + seg.len]?.type === 'PLUSPLUS';
  };

  // Parse the `++`-joined parents of a class (notes/class-extends-plusplus-2026-11-10.md).
  // Left to right, a segment is a parent while it is `B` / `sup B` followed by
  // `++`, or a bare `B` that ends the list (before `)` in parens, before the end
  // of the definition otherwise). The first segment that isn't starts the params.
  function parseExtendsParents(op, inParens) {
    const supertypes = [];
    const skipNl = (i) => { while (inParens && tokens[i]?.type === 'NEWLINE') i++; return i; };
    while (true) {
      const i = skipNl(pos);
      const seg = parentSegmentAt(i);
      if (!seg) break;
      const after = skipNl(i + seg.len);
      const joined = tokens[after]?.type === 'PLUSPLUS';
      const last = !seg.wrapped && supertypes.length > 0 && (inParens ? tokens[after]?.type === 'RPAREN' : isDefinitionEnd(after));
      if (!joined && !last) break;
      pos = i;
      const wrap = seg.wrapped ? consume().value : undefined;
      const sigil = peek().type === 'AT' ? (consume(), '@') : '';
      const name = sigil + expect('IDENT').value;
      if (wrap && wrap === name.replace(/^@/, '')) {
        throw new Error(`In '${op}', wrapped '${name}' needs a local name of its own — write '(sup ${name} ++ …)'`);
      }
      supertypes.push({ supertype: name, ...(wrap && { wrappedAs: wrap }) });
      pos = after;
      if (!joined) break;
      consume(); // ++
    }
    return supertypes;
  }

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
    if (tokens[offset]?.type === 'AT' && tokens[offset + 1]?.type === 'IDENT') return 1 + typeLength(offset + 1);
    if (tokens[offset]?.type !== 'IDENT') return 0;
    let len = 1;
    if (tokens[offset+1]?.type === 'DCOLON' && tokens[offset+2]?.type === 'IDENT') len = 3;
    if (tokens[offset+len]?.type === 'KEYWORD' && tokens[offset+len]?.value === 'of') {
      const inner = typeLength(offset + len + 1);
      if (inner > 0) len += 1 + inner;
    }
    // Union suffix: | Type or | null, repeatable
    while (true) {
      const after = offset + len;
      if (tokens[after]?.type !== 'PIPE') break;
      const nxt = tokens[after+1];
      if (nxt?.type === 'KEYWORD' && nxt.value === 'null') { len += 2; continue; }
      if (nxt?.type === 'IDENT' || nxt?.type === 'AT') {
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
    // A public class is `@Name` as a type too.
    if (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT') {
      consume();
      return '@' + consume().value;
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

  // Consume an `&Type` token at the current position and continue parsing
  // the rest of the type (`of <inner>`, member access, unions). The `&Type`
  // form arrives as a single AMPERSAND_IDENT token from the lexer; we
  // re-inject the captured name as an IDENT so parseType can handle the
  // remainder uniformly. The swap is undone afterwards: a parse that
  // backtracks must find the token stream as it was.
  function consumeAmpersandTypeForParam() {
    const at = pos;
    const ampTok = peek();
    if (ampTok.type !== 'AMPERSAND_IDENT') {
      throw new Error(`Expected &Type, got ${ampTok.type}`);
    }
    tokens[at] = { ...ampTok, type: 'IDENT' };
    try { return parseType(); } finally { tokens[at] = ampTok; }
  }

  function parseType(inOf = false) {
    if (peek().type === 'IDENT' && peek().value.endsWith('!')) {
      throw new Error(`'${peek().value}' — a type name takes no '!'; declare a write-capable ref as '*${peek().value.slice(0, -1)}'`);
    }
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
      if (nxt?.type === 'IDENT' || (nxt?.type === 'AT' && tokens[pos + 2]?.type === 'IDENT')) {
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
    // Or an object-shaped type: (output: Text) / (Text)
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
    return parseObjectType();
  }

  function parseObjectType() {
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
        throw new Error(`Expected type in object type, got ${peek().type} '${peek().value || ''}'`);
      }
    }
    expect('RPAREN');
    return `(${fields.join(', ')})`;
  }

  function parseObjectConstructor() {
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
    return AST.objectConstructor(args);
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
    inSignature++;
    const arrow = expect('->').value;
    inSignature--;
    // Silent output `=> .` — a fire-and-forget signature with no reply, distinct
    // from void `-> ()` (an empty reply). Mirrors the silent body terminator used
    // by function definitions. Nothing can be read from it, so it's always `=>`.
    if (peek().type === 'DOT') {
      if (arrow !== '=>') throw new Error(`'${arrow} .' has nothing to read — a silent function is '=> .'`);
      consume();
      return { ...AST.functionType(inputs, [], true), arrow };
    }
    // `=> self`: writes, and yields its own receiver. `-> self` is the identity
    // function. Like `.`, `self` stands alone.
    if (peek().type === 'KEYWORD' && peek().value === 'self') {
      if (arrow === '~>') throw new Error("'~> self' has nothing to read — write '=> self', or '-> self' if it's the identity function");
      consume();
      return { ...AST.functionType(inputs, []), returnsSelf: true, arrow };
    }
    const parseOutputs = () => {
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
      return outputs;
    };
    const outputs = parseOutputs();
    // `-> (Integer) | (Text)`: what comes back depends on the path.
    const alternatives = [outputs];
    while (peek().type === 'PIPE' && tokens[pos + 1]?.type === 'LPAREN') {
      consume();
      alternatives.push(parseOutputs());
    }
    const shapes = alternatives.length > 1 ? { alternatives } : {};
    // `=> (Integer) | self`: some paths yield a value and others the receiver.
    if (peek().type === 'PIPE' && tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1].value === 'self') {
      consume();
      consume();
      return { ...AST.functionType(inputs, outputs), ...shapes, orSelf: true, arrow };
    }
    return { ...AST.functionType(inputs, outputs), ...shapes, arrow };
  }

  function functionTypeToString(functionType) {
    const fmtSide = (items) => items.map(item => {
      if (item.name !== undefined) return `${item.name}: ${item.type}`;
      return `${item.type}`;
    }).join(', ');
    const arrow = functionType.arrow ?? '->';
    if (functionType.silent) return `(${fmtSide(functionType.inputs)}) => .`;
    if (functionType.returnsSelf) return `(${fmtSide(functionType.inputs)}) ${arrow} self`;
    const shapes = (functionType.alternatives ?? [functionType.outputs]).map(alt => `(${fmtSide(alt)})`).join(' | ');
    return `(${fmtSide(functionType.inputs)}) ${arrow} ${shapes}${functionType.orSelf ? ' | self' : ''}`;
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
    readonlyParamScopes.push(new Set());
    for (const p of params) {
      if (p.name) declareLocal(p.name);
      if (p.readonly) addReadonlyParam(p.name);
    }
    const body = parseBody();
    readonlyParamScopes.pop();
    readonlyParamScopes.pop();
    refVarScopes.pop();
    localScopes.pop();

    // Convert Reply nodes to ImplicitReturn (this is a lambda context, not a handler)
    // Single positional → ImplicitReturn of the expression
    // Multiple fields or named → Return with fields (object return)
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

    // Tail `repeat while/until …` → Void return (re: []). Mirrors the
    // braced-body normalizer in parseFunction. A loop yields no value.
    if (returnType === null && body.length > 0 &&
        body[body.length - 1].type === 'WhileStatement') {
      returnType = '()';
    }

    return AST.functionNode(params, body, { returnType });
  }

  // `take(s, 1)`: a builtin, unless a function of that name shadows it.
  function atBareBuiltinCall() {
    return (peek().type === 'IDENT' || peek().type === 'KEYWORD') && TEXT_METHODS.has(peek().value) && tokens[pos + 1]?.type === 'LPAREN'
      && !functionNames.has(peek().value) && !fileFunctionNames.has(peek().value);
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
        if (arg.type === 'RefArg') throw new Error(`Cannot pass *${arg.name} to non-ref parameter`);
      }
      if (namedBag) {
        for (const [key, val] of Object.entries(namedBag.fields)) {
          if (val.type === 'RefArg') throw new Error(`Cannot pass *${val.name} to non-ref parameter '${key}'`);
        }
      }
      return;
    }
    for (let i = 0; i < positional.length; i++) {
      if (slots.has(i) && positional[i].type !== 'RefArg') {
        throw new Error(`Parameter ${i} is ref — grant write capability using *`);
      }
      if (!slots.has(i) && positional[i].type === 'RefArg') {
        throw new Error(`Cannot pass *${positional[i].name} to non-ref parameter`);
      }
    }
    if (namedBag) {
      for (const [key, val] of Object.entries(namedBag.fields)) {
        if (slots.has(key) && val.type !== 'RefArg') {
          throw new Error(`Parameter '${key}' is ref — grant write capability using *`);
        }
        if (!slots.has(key) && val.type === 'RefArg') {
          throw new Error(`Cannot pass *${val.name} to non-ref parameter '${key}'`);
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

  // Constructor profile in a coercion or file-header dependency:
  //   (params) [->] *{ iface }
  // `ctorProfileAhead` checks (without consuming) that the LPAREN at `p` opens
  // one: its matching RPAREN is followed, across newlines, by an optional
  // `->` and then `*{`. `parseCtorProfileParams` consumes `(params) [->] *`
  // and leaves the parser at the `{`.
  function ctorProfileAhead(p) {
    if (tokens[p]?.type !== 'LPAREN') return false;
    let depth = 0;
    let i = p;
    for (; i < tokens.length; i++) {
      const t = tokens[i].type;
      if (t === 'LPAREN') depth++;
      else if (t === 'RPAREN') { depth--; if (depth === 0) break; }
      else if (t === 'EOF') return false;
    }
    i++;
    while (tokens[i]?.type === 'NEWLINE') i++;
    if (tokens[i]?.type === '->') { i++; while (tokens[i]?.type === 'NEWLINE') i++; }
    return tokens[i]?.type === 'STAR' && tokens[i + 1]?.type === 'LBRACE';
  }
  function parseCtorProfileParams(where) {
    expect('LPAREN');
    skipNewlines();
    const ctorParams = [];
    let separated = true;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); separated = true; continue; }
      if (!separated) throw new Error(`Expected ',' or a newline between params ${where}, got ${peek().type} '${peek().value || ''}'`);
      const p = parseOneParam();
      if (p === null) break;
      ctorParams.push(p);
      separated = false;
    }
    expect('RPAREN');
    skipNewlines();
    if (peek().type === '->') { inSignature++; ctorArrow = consume().value; inSignature--; skipNewlines(); }
    if (peek().type !== 'STAR' || tokens[pos + 1]?.type !== 'LBRACE') {
      throw new Error(`Expected '*{ ... }' service interface after constructor params ${where}`);
    }
    consume(); // *
    return ctorParams;
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
      return peek().type === 'IDENT' || (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT');
    };
    let separated = true;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); separated = true; continue; }
      if (!separated) {
        throw new Error(`Expected ',' between params, got ${peek().type} '${peek().value || ''}'`);
      }
      separated = false;
      if (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT') {
        throw new Error(`Cannot publish param '${tokens[pos + 1].value}' of a function — '@' marks class and file params only`);
      }
      if (peek().type === 'ELLIPSIS') {
        consume(); // ...
        const name = expect('IDENT').value;
        let type = null;
        if (!isParamDelim() && peekIsType()) { type = parseType(); }
        params.push({ name, type, rest: true, positional: true });
        continue;
      }
      // :name — prefix-colon param form retired 2026-05-10
      if (peek().type === 'SIGIL') {
        const name = peek().value;
        throw new Error(`Prefix-colon param form ':${name}' is no longer valid. Use '${name}:' for a named param (post-colon flip 2026-05-10).`);
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // name: ... — named param (external label = `name`).
        const name = consume().value;
        consume(); // COLON
        if (isRetiredParenAlias()) {
          throwRetiredParenAlias(name);
        } else if (startsRenamedParam()) {
          // name: local Type — the caller passes `name`, the body sees `local`
          params.push(parseRenamedParam(name));
        } else if (isLoneNameAfterColon()) {
          // name: X — X is a type if one is in scope, else a local (resolved
          // after parsing: see resolveLoneNames)
          params.push({ name, type: consume().value, positional: false, typeOrLocal: true });
        } else if (peek().type === 'SIGIL') {
          // name: :accessor Type — remap to a sigil-marked local alias
          const accessor = consume().value;
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          params.push({ key: name, name: accessor, type, accessor });
        } else if (peek().type === 'STAR' && tokens[pos + 1]?.type !== 'IDENT') {
          // name: * — named ref param (wildcard, no explicit type)
          consume();
          params.push({ name, type: 'Anything', positional: false, ref: true });
        } else if (peek().type === 'STAR') {
          // name: *Type — named ref param with explicit type
          consume();
          const type = parseType();
          params.push({ name, type, positional: false, ref: true });
        } else if (peek().type === 'AMPERSAND_IDENT') {
          // name: &Type — named read-only ref param
          const type = consumeAmpersandTypeForParam();
          params.push({ name, type, positional: false, readonly: true });
        } else {
          // name: Type | name: (no type) | name: literal (shorthand default)
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          if (!type && (peek().type === 'STRING' || peek().type === 'NUMBER' || (peek().type === 'MINUS' && tokens[pos + 1]?.type === 'NUMBER') ||
              (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false' || peek().value === 'null')))) {
            const dv = parseDefaultLiteral();
            const p = { name, type: inferDefaultType(dv), positional: false, defaultValue: dv };
            params.push(p);
            continue;
          }
          params.push({ name, type, positional: false });
        }
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        // *Type — positional ref param (prefix sigil)
        if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'IDENT') {
          consume(); // *
          const type = parseType();
          params.push({ name, type, positional: true, ref: true });
        } else if (peek().type === 'AMPERSAND_IDENT') {
          // name &Type — positional read-only ref param
          const type = consumeAmpersandTypeForParam();
          params.push({ name, type, positional: true, readonly: true });
        } else {
          let type = null;
          if (!isParamDelim() && peekIsType()) { type = parseType(); }
          params.push({ name, type, positional: true });
        }
      } else {
        break;
      }
      // Check for = default on the last-pushed param
      if (peek().type === 'EQUALS' && params.length > 0) {
        consume(); // =
        const dv = parseDefaultValue();
        const p = params[params.length - 1];
        if (!p.type) p.type = typeOfDefault(p, dv);
        p.defaultValue = dv;
      }
    }
    expect('RPAREN');
    return params;
  }

  // A param default: a literal, or any expression (see
  // notes/param-default-expressions-2026-11-10.md). A literal followed by
  // more of an expression (`1 + 2`) is an expression.
  function parseDefaultValue() {
    const saved = pos;
    try {
      const lit = parseDefaultLiteral();
      if (isDefaultEnd()) return lit;
    } catch { /* not a literal */ }
    pos = saved;
    return parseExpr();
  }
  function isDefaultEnd() {
    const t = peek().type;
    return t === 'COMMA' || t === 'RPAREN' || t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'EOF' ||
      t === 'DIVIDER' || t === 'EQUALS' || t === 'GT' || t === 'PIPE';
  }
  // An untyped param takes its default's type; only a literal gives one.
  function typeOfDefault(p, dv) {
    const t = inferDefaultType(dv);
    if (!t && !isLiteralDefault(dv)) {
      throw new Error(`Param '${p.name}': a default that isn't a literal needs a type — write '${p.name} Type = …'`);
    }
    return t;
  }

  // Shared default-value helpers for parseFunctionParams
  function parseDefaultLiteral() {
    if (peek().type === 'NUMBER') return makeNumLiteral(consume());
    if (peek().type === 'MINUS' && tokens[pos + 1]?.type === 'NUMBER') {
      consume(); // -
      const tok = consume();
      return makeNumLiteral({ ...tok, value: '-' + tok.value });
    }
    if (peek().type === 'STRING') return AST.stringLiteral(consume().value);
    if (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false')) return AST.boolLiteral(consume().value === 'true');
    if (peek().type === 'KEYWORD' && peek().value === 'null') { consume(); return AST.nullLiteral(); }
    if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') { consume(); consume(); return AST.objectLiteral([]); }
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
      if (atSelfValue()) {
        consume(); // self
        body.push({ ...AST.returnNode(selfReturnFields()), tailValue: true });
        continue;
      }
      if (isReturnKw()) {
        consume();
        if (silentReturn()) { skipNewlines(); body.push(AST.silentTerminator()); break; }
        if (peek().type === 'DOT') {
          if (declCtx) throw trailingDotError();
          consume(); body.push(AST.silentTerminator()); break;
        }
        body.push(AST.returnNode(parseReplyFields(true)));
        continue;
      }
      if (peek().type === '->') throw new Error(MISPLACED_ARROW_MSG);
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
        if (!isRef(name)) {
          if (isReadonlyParam(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
          throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '*Type' variables support '${isUpdate ? '<|' : '<-'}'`);
        }
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
      if (!isRef(name)) {
          if (isReadonlyParam(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
          throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '*Type' variables support '${isUpdate ? '<|' : '<-'}'`);
        }
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
        if (declCtx) throw trailingDotError();
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
      if (atSelfValue()) {
        consume(); // self
        body.push({ ...AST.returnNode(selfReturnFields()), tailValue: true });
      } else if (isReturnKw()) {
        consume(); // 'return'
        if (silentReturn()) { skipNewlines(); body.push(AST.silentTerminator()); break; }
        if (peek().type === 'DOT') {
          if (declCtx) throw trailingDotError();
          consume(); // '.'
          body.push(AST.silentTerminator());
          break;
        }
        body.push(AST.returnNode(parseReplyFields(true) ));
      } else if (peek().type === '->') {
        throw new Error(MISPLACED_ARROW_MSG);
      } else if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') {
        // Void marker `()` as tail expression — pushes empty Return that the
        // outer braced-body normalizer collapses to returnType = '()'.
        consume(); consume();
        body.push(AST.returnNode([]));
        break;
      } else if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        const isUpdate = tokens[pos + 1]?.type === 'UPDATE';
        const name = consume().value;
        if (!isRef(name)) {
          if (isReadonlyParam(name)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
          throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${name}' — only '*Type' variables support '${isUpdate ? '<|' : '<-'}'`);
        }
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
        // name = *TypeName(args) — ref constructor form (prefix `*` is the
        // cell sigil; what follows must be a scalar core type with a call).
        if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'IDENT') {
          consume(); // *
          const typeName = parseType();
          if (peek().type !== 'LPAREN') {
            throw new Error(`Expected '(' after '*${typeName}'`);
          }
          addRef(name);
          const value = parseForwardCall(typeName);
          body.push(AST.refDecl(name, null, value));
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
        // A statement the reply-field syntax can't read (`v.ref...`) is an
        // expression: fall through to parseExpr below.
        let fields = [];
        try { fields = parseReplyFields(true); } catch { pos = savedPos; }
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
    const outerDecl = declCtx;
    declCtx = null;
    try { return parseFunctionLiteral(); } finally { declCtx = outerDecl; }
  }

  function parseFunctionLiteral() {
    localScopes.push(new Set());
    refVarScopes.push(new Map());
    readonlyParamScopes.push(new Set());
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
      if (p.readonly) addReadonlyParam(p.name);
    }
    let returnType = null;
    function checkStateWrites(body, rt) {
      if (rt !== '.') {
        const stateWrite = body.find(s => s.type === 'StateAssign');
        if (stateWrite) {
          throw new Error(`Cannot write to state variable '$${stateWrite.name}' from inside a function — state vars are read-only in functions`);
        }
      }
    }
    // Braced body `{ ... }` — shared by the no-arrow form `(params) { ... }` and
    // the arrow form `(params) -> { ... }` / `e -> { ... }` / `-> { ... }`.
    // Assumes the current token is `LBRACE`. Owns its own returnType and pops
    // the three parse scopes this function pushed.
    const finishBracedBody = () => {
      consume(); // {
      let returnType = null;
      const body = parseFunctionBody('RBRACE', { implicitReplyFields: true });
      const isSilent = body.length > 0 && body[body.length - 1].type === 'SilentTerminator';
      if (isSilent) {
        body.pop();
        returnType = '.';
      }
      skipNewlines();
      expect('RBRACE');
      if (!isSilent && (isTypeAttestation() || peek().type === 'COLON')) {
        const sigil = peek().type === 'COLON' ? ':' : 'as';
        throw new Error(`Type annotation '${sigil} Type' after closing '}' is not valid — coerce inside the body: { ... value as Type }`);
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
      // Void return marker: trailing `Return([])` (from `-> ()` or `()` tail) →
      // collapse to returnType = '()'. Empty body (no statements) is also Void.
      // A trailing `repeat while/until …` similarly makes the function Void.
      if (!isSilent && returnType === null) {
        if (body.length === 0) {
          returnType = '()';
        } else {
          const last = body[body.length - 1];
          if (last.type === 'Return' && (!last.fields || last.fields.length === 0)) {
            body.pop();
            returnType = '()';
          } else if (last.type === 'WhileStatement') {
            returnType = '()';
          }
        }
      }
      checkStateWrites(body, returnType);
      readonlyParamScopes.pop();
      refVarScopes.pop();
      localScopes.pop();
      return AST.functionNode(params, body, { returnType });
    };
    // Explicit `->` body marker (everything except no-arg `{ ... }` lambdas).
    if (peek().type === '->') {
      consume(); // ->
      // Silent body: `-> .`
      if (peek().type === 'DOT') {
        consume();
        returnType = '.';
        readonlyParamScopes.pop();
        refVarScopes.pop();
        localScopes.pop();
        return AST.functionNode(params, [], { returnType });
      }
      // Void body: `-> ()` (empty reply, distinct from silent)
      if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') {
        consume(); consume();
        returnType = '()';
        readonlyParamScopes.pop();
        refVarScopes.pop();
        localScopes.pop();
        return AST.functionNode(params, [], { returnType });
      }
      // Arrow + block body: `(params) -> { ... }` / `e -> { ... }` / `-> { ... }`.
      // Semantically identical to the no-arrow `(params) { ... }` form below.
      if (peek().type === 'LBRACE') {
        return finishBracedBody();
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
          readonlyParamScopes.pop();
          refVarScopes.pop();
          localScopes.pop();
          return AST.functionNode(params, body, { returnType });
        }
        const body = [AST.setStatement(name, firstExpr, { updateOp: isUpdate ? '<|' : undefined })];
        skipNewlines();
        if (peek().type === 'DOT') { consume(); returnType = '.'; }
        readonlyParamScopes.pop();
        refVarScopes.pop();
        localScopes.pop();
        return AST.functionNode(params, body, { returnType });
      }
      const expr = parseExpr();
      skipNewlines();
      if (peek().type === 'DOT') { consume(); returnType = '.'; }
      else if (isTypeAttestation()) { returnType = consumeTypeAttestation(); }
      else if (peek().type === 'COLON') { consume(); returnType = parseType(); }
      readonlyParamScopes.pop();
      refVarScopes.pop();
      localScopes.pop();
      return AST.functionNode(params, null, { returnType, expr });
    }
    // Braced body: (params) { ... } or { ... } (no-arg)
    if (peek().type === 'LBRACE') {
      return finishBracedBody();
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
    if (peek().type === 'LT' && tokens[pos + 1]?.type === 'IDENT') {
      return parseXmlConstructor();
    }

    if (peek().type === 'IDENT' && peek().value === 'Object' && tokens[pos + 1]?.type === 'LPAREN') {
      const tok = consume();
      return parseObjectConstructor(tok.value);
    }

    let result;
    if (atBareBuiltinCall()) {
      const methodName = consume().value;
      consume(); // LPAREN
      const args = [parseExpr()];
      while (peek().type === 'COMMA') { consume(); args.push(parseExpr()); }
      expect('RPAREN');
      const [minArgs, maxArgs] = TEXT_METHODS.get(methodName).arity;
      if (args.length < minArgs || args.length > maxArgs) {
        throw new Error(`'${methodName}' takes ${minArgs === maxArgs ? minArgs : `${minArgs} to ${maxArgs}`} arguments, got ${args.length}`);
      }
      if (methodName === 'size') {
        result = AST.sizeExpr(args[0]);
      } else {
        result = AST.textMethodExpr(methodName, args);
      }
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN' && !functionNames.has(tokens[pos].value) && !isKnownLocal(tokens[pos].value)) {
      const name = consume().value;
      result = parseForwardCall(name);
    } else if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'IDENT') {
      // *name — call-site write-capability grant on a ref cell.
      // Mirrors the *Type sigil in param position. Caller must own the cell.
      // Per notes/capability-sigils-2026-05-06.md.
      consume(); // *
      const name = consume().value;
      if (!isRef(name)) {
        throw new Error(`Cannot grant write capability — '${name}' is not a ref cell`);
      }
      result = AST.refArg(name);
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
          throw new Error(`Cannot pass ref cell '${tok.value}' with '&${tok.value}' — use '*${tok.value}' to grant write capability`);
        }
        result = AST.fnRef(tok.value );
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
        // The subscription body is a callback: a lambda, not the enclosing
        // declaration's body.
        const outerDecl = declCtx;
        declCtx = null;
        if (peek().type === 'LBRACE') {
          consume();
          subBody = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          subBody = parseBody();
        }
        declCtx = outerDecl;
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
      // `&Type` parameters forbid bang-suffixed (mutating) methods.
      if (isBang && result.type === 'Identifier' && isReadonlyParam(result.name)) {
        throw new Error(`Cannot call mutating method '.${cleanMethod}!' on read-only parameter '${result.name}'`);
      }
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
      } else if (method.endsWith('!') || (result.type === 'DotCallExpr' && result.method?.endsWith('!'))) {
        // Parens are optional on a call with no args. A `!` member is always a
        // call, and a member of a `!` call's reply is a member of an actor.
        result = AST.dotCallExpr(result, method, []);
      } else {
        result = AST.dotAccessExpr(result, method);
      }
    }
    // `call...` — fire-and-forget. A call site never writes a silent name's dot:
    // the ellipsis stands for it. `sfn...` and `sfn(a)...` call `sfn.`,
    // `x.sfn...` and `x.sfn(a)...` call `x.sfn.`. A bang name keeps its `!`
    // (`x.m!...`). `elidedDot` lets validation drop the dot again for a
    // foreign function its doc makes silent under a plain name.
    if (peek().type === 'ELLIPSIS') {
      consume();
      const silent = (name) => name.endsWith('!') ? name : name + '.';
      if (result.type === 'Identifier' || result.type === 'RefRead') {
        result = AST.functionCallExpr(AST.identifier(silent(result.name)), []);
        if (!result.callee.name.endsWith('!')) result.elidedDot = true;
      } else if (result.type === 'DotAccessExpr') {
        result = AST.dotCallExpr(result.object, silent(result.property), []);
        if (!result.method.endsWith('!')) result.elidedDot = true;
      } else if (result.type === 'FunctionCallExpr' || result.type === 'DotCallExpr') {
        const name = result.type === 'DotCallExpr' ? result.method : result.callee?.type === 'Identifier' ? result.callee.name : null;
        if (name?.endsWith('.')) {
          const plain = name.slice(0, -1);
          throw new Error(result.args?.length
            ? `A call never writes the silent dot — write '${plain}(…)...'`
            : `A call never writes the silent dot — write '${plain}...'`);
        }
        if (name && !name.endsWith('!')) {
          if (result.type === 'DotCallExpr') result.method = name + '.';
          else result.callee = AST.identifier(name + '.');
          result.elidedDot = true;
        }
      } else {
        throw new Error(`'...' (fire-and-forget) follows a call or a silent name`);
      }
      result.faf = true;
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

  // `<-` and `<|` as expressions. A write's left side is a cell and its right side
  // a whole expression that stops at the next write, so chains stay on the target:
  // `a <- b <- c` is `(a <- b) <- c`. Right after a write operator a further write
  // continues the chain (SetChain); anywhere else it opens a SetExpr. Statement
  // forms parse their own target, then reach this through their right side.
  const atWriteOp = () => peek().type === 'SET' || peek().type === 'UPDATE';
  function parseExpr() {
    const inWriteRhs = tokens[pos - 1]?.type === 'SET' || tokens[pos - 1]?.type === 'UPDATE';
    if (!inWriteRhs && peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
      const name = consume().value;
      if (!isRef(name)) {
        if (isReadonlyParam(name)) throw new Error(`Cannot set '${name}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
        throw new Error(`Cannot set '${name}' — only '*Type' variables support '<-'`);
      }
      const updateOp = consume().type === 'UPDATE' ? '<|' : undefined;
      return { type: 'SetExpr', name, value: parseExpr(), updateOp };
    }
    const value = parseValueExpr();
    if (!atWriteOp()) return value;
    if (!inWriteRhs) throw new Error("The left side of '<-' must be a cell");
    const rest = [];
    while (atWriteOp()) {
      const updateOp = consume().type === 'UPDATE' ? '<|' : undefined;
      rest.push({ value: parseValueExpr(), updateOp });
    }
    return { type: 'SetChain', first: value, rest };
  }

  function parseValueExpr() {
    let left = parseAddExpr();
    // >> prepend operator. Right-associative; checked before CMP_OPS so the
    // GT GT pair isn't mis-parsed as comparison `>` followed by an unexpected
    // `>`. Statement-level only — pushExprOrBang desugars to SetStatement;
    // validate.js rejects any leftover BinaryExpr('>>') as a sub-expression.
    if (peekIsPrepend()) {
      consumeOverloadOp();
      return AST.binaryExpr('>>', left, parseValueExpr());
    }
    if (CMP_OPS.has(peek().type)) {
      const tok = consume();
      left = AST.binaryExpr(CMP_OPS.get(tok.type), left, parseAddExpr());
    }
    // Slice 11 of types-implementation-plan-2026-04-27: `??` fallback.
    // Right-associative — `a ?? b ?? c` is `a ?? (b ?? c)`.
    if (peek().type === 'NULL_COALESCE') {
      consume();
      left = AST.binaryExpr('??', left, parseValueExpr());
    }
    return left;
  }

  // Check for type attestation: `as Type` only
  function isTypeAttestation() {
    return peek().type === 'KEYWORD' && peek().value === 'as' &&
           (
             tokens[pos + 1]?.type === 'IDENT' ||
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

  // `self` as a return value: the whole reply (`return self`), or one slot of
  // several (`return (self, n)`, `return (me: self, n: n)`). A slot is a
  // `SelfValue` expression: `#<>` in `re`, a bare `@` in `ty`.
  const atSelfValue = () => peek().type === 'KEYWORD' && peek().value === 'self' &&
    !(tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1]?.value === 'as');
  const selfReturnFields = () => [{ selfReturn: true, positional: true, expr: AST.selfValue(), type: null }];
  const isSelfSlot = (f) => f.positional && f.expr?.type === 'SelfValue' && !f.selfReturn;

  function parseReplyFields(sameLine = false) {
    if (atSelfValue() && tokens[pos + 1]?.type !== 'COMMA') {
      consume(); // self
      return selfReturnFields();
    }
    const fields = parseReplyFieldList(sameLine);
    // `(self)` alone is the whole reply, as `self` is.
    if (fields.length === 1 && isSelfSlot(fields[0]) && !fields[0].type) return selfReturnFields();
    return fields;
  }

  function parseReplyFieldList(sameLine) {
    const fields = [];
    const hasParen = peek().type === 'LPAREN';
    if (hasParen) consume();
    while (true) {
      if (hasParen || !sameLine) skipNewlines();
      if (hasParen && peek().type === 'RPAREN') { consume(); break; }
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        fields.push({ expr: parseExpr(), type: null, positional: true });
      } else if (peek().type === 'AT' || peek().type === 'HASH_IDENT' || peek().type === 'AMPERSAND_IDENT' || atBareBuiltinCall()) {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        fields.push({ expr, type: typeName, positional: true });
      } else if (peek().type === 'NUMBER') {
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
          const value = atSelfValue() ? (consume(), AST.selfValue()) : parseExpr();
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
              } else if (method.endsWith('!') || (exprNode.type === 'DotCallExpr' && exprNode.method?.endsWith('!'))) {
                exprNode = AST.dotCallExpr(exprNode, method, []);
              } else {
                exprNode = AST.dotAccessExpr(exprNode, method);
              }
            } else {
              const args = parseCallArgs();
              if (exprNode.type === 'Identifier') checkFunctionArgs(args, exprNode.name);
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
        const value = atSelfValue() ? (consume(), AST.selfValue()) : parseExpr();
        let fieldType = null;
        if (isTypeAttestation()) fieldType = consumeTypeAttestation();
        fields.push({ key: name, value, type: fieldType });
      } else if (atSelfValue()) {
        consume(); // self
        fields.push({ expr: AST.selfValue(), type: null, positional: true });
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
        else if (peek().type === 'IDENT') typeName = parseType();
        pattern.push({ named: true, name, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // key-mapped: key: local [Type]  OR  named: key: Type  OR  key: _  (discard)
        const first = consume().value;
        consume(); // COLON
        if (isLoneNameAfterColon()) {
          // key: X — X is a type if one is in scope (named field, typed),
          // else the local the field binds to (resolved after parsing: see
          // resolveLoneNames)
          pattern.push({ named: true, name: first, type: consume().value, typeOrLocal: true });
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'IDENT') {
          // key: local Type
          const localName = consume().value;
          pattern.push({ key: first, name: localName, type: parseType() });
        } else if (peek().type === 'IDENT') {
          // key: Type — a qualified, union or `of` type
          pattern.push({ named: true, name: first, type: parseType() });
        } else if (peek().type === 'DISCARD') {
          // `key: _` — consumes the key so a trailing `...` skips it. Only
          // meaningful for DI-namespace destructuring; ignored by object
          // destructure since positional alignment doesn't apply.
          consume();
          pattern.push({ key: first, discard: true });
        } else {
          // key: (no local name, no type — just named)
          pattern.push({ named: true, name: first, type: null });
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'IDENT') {
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

    // Inline object literal: `1 : Integer, 2 : Integer` or `key: "v" : Text, ...`
    let source;
    if (peek().type === 'NUMBER' || peek().type === 'STRING' || peek().type === 'INTERP_STRING' ||
        (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON')) {
      source = parseInlineObject();
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

  function parseInlineObject() {
    // Parses `1 as Integer, 2 as Integer` or `key: "v" as Text, ...` into a ObjectConstructor node
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
    return AST.objectConstructor(args);
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
        if (t === 'SIGIL' || t === 'COMMA' || t === 'COLON' || t === 'DISCARD' || t === 'IDENT') { i++; continue; }
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
    // named: `key: X [, ...] = expr` — X is a type or a local, settled after
    // parsing (resolveLoneNames); `key: Type`; `key: local Type = expr`
    if (t0 === 'IDENT' && t1 === 'COLON' && t2 === 'IDENT') {
      if (t3 === 'IDENT') return true;
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
    // typed positional as first of multi-item: `a Type, ...`
    // (single `a Type = expr` is caught first by isTypedAssignStart)
    if (t0 === 'IDENT' && t1 === 'IDENT') {
      if (tokens[pos + 1 + typeLength(pos+1)]?.type === 'COMMA') return true;
    }
    return false;
  }

  function parseRHSValue() {
    // Parses the RHS of a plain assign (name = ...). Returns the value node.
    // Detects object literals: sigil-start, or expr followed by COMMA, or key-value pattern.
    if (peek().type === 'SIGIL') {
      return parseRHSObjectLiteral(null);
    }
    const value = parseExpr();
    let firstType = null;
    if (isTypeAttestation()) {
      firstType = consumeTypeAttestation();
      value.attestedAs = firstType;
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
        return parseRHSObjectLiteral(firstElem);
      }
      // Single key-value → 1-element named object
      return AST.objectLiteral([firstElem]);
    }
    // Check for COMMA → object literal
    if (peek().type === 'COMMA') {
      const firstElem = { positional: true, expr: value, type: firstType };
      consume(); // COMMA
      return parseRHSObjectLiteral(firstElem);
    }
    // Single typed value with no comma: promote to TypedValue for caller to emit TypedAssign
    if (firstType !== null) {
      return AST.typedValue(value, firstType);
    }
    return value;
  }

  function parseRHSObjectElem() {
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

  function isRHSObjectLiteralTerminator() {
    const t = peek().type;
    return t === 'NEWLINE' || t === 'BLOCK_SEP' || t === 'EOF' || t === 'DIVIDER' || t === 'RBRACE';
  }

  function parseRHSObjectLiteral(firstElem) {
    // firstElem: already-parsed first element (or null if starting fresh)
    const args = firstElem ? [firstElem] : [];
    while (true) {
      if (isRHSObjectLiteralTerminator()) break;
      if (peek().type === 'COMMA') { consume(); continue; }
      const elem = parseRHSObjectElem();
      if (elem === null) break;
      args.push(elem);
    }
    return AST.objectLiteral(args);
  }

  function parseTypedAssign(body) {
    // name Type = expr   — typed assignment (whitespace between name and type)
    // name *Type = expr  — ref declaration (prefix `*` is the cell sigil)
    const name = consume().value;
    const isRefDecl = peek().type === 'STAR';
    if (isRefDecl) consume(); // *
    const typeName = parseType();
    if (!isRefDecl && isRef(name)) {
      throw new Error(`Cannot re-bind ref '${name}' with typed assignment — use '${name} <- value' to set`);
    }
    consume(); // EQUALS
    declareLocal(name);
    if (isRefDecl) addRef(name, typeName);
    let value;
    // For Object type, check if RHS starts with sigil
    if (peek().type === 'KEYWORD' && peek().value === 'ingest') {
      consume(); // ingest
      let defaultValue = null;
      if (peek().type === 'LPAREN') {
        consume(); // (
        defaultValue = parseExpr();
        expect('RPAREN');
      }
      value = AST.ingestExpr(defaultValue);
    } else if (typeName === 'Object' && peek().type === 'SIGIL') {
      value = parseRHSObjectLiteral(null);
    } else {
      value = parseExpr();
      // Treat any user type (non-builtin) the same as
      // `Object` for the purposes of bare-comma RHS — `p Point = 1, 2`
      // becomes a ObjectLiteral that the post-parse pass coerces into
      // `Point(1, 2)`. Slice 9 of types-implementation-plan-2026-04-27.
      // Only kicks in when the next token is COMMA — typed RHS with a
      // single value still parses normally.
      const isBuiltinTypeName = typeof typeName === 'string' && (
        BUILT_IN_SINGULAR.has(typeName) || BUILT_IN_PLURAL.has(typeName) ||
        typeName === 'Anything' || typeName === 'Decimal' || typeName === 'Decimals' ||
        typeName === 'null' || typeName === 'Function' || typeName === 'Object'
      );
      const looksLikeUserType = typeof typeName === 'string' &&
        !typeName.includes(' ') &&
        !/[-=~]>/.test(typeName) &&
        !isBuiltinTypeName;
      if (typeName === 'Object' || looksLikeUserType) {
        // Check for type annotation after value (wraps in single-element ObjectLiteral)
        let firstType = null;
        if (isTypeAttestation()) {
          firstType = consumeTypeAttestation();
        }
        if (peek().type === 'COMMA') {
          const firstElem = { positional: true, expr: value, type: firstType };
          consume(); // COMMA
          value = parseRHSObjectLiteral(firstElem);
        } else if (firstType === typeName) {
          // `p Point = v as Point`: the value itself, checked at runtime.
          value.attestedAs = firstType;
        } else if (firstType !== null) {
          // Single typed value → 1-element ObjectLiteral
          value = AST.objectLiteral([{ positional: true, expr: value, type: firstType }]);
        }
      } else {
        // Non-Object: consume optional RHS type annotation and check for conflict
        if (isTypeAttestation()) {
          const rhsType = consumeTypeAttestation();
          // Allow: lhs 'T | null' with rhs 'T' (non-null value assigned to nullable var)
          // Allow: function types — RHS as-type may be the return type portion
          const baseType = typeName.endsWith(' | null') ? typeName.slice(0, -7) : null;
          const isFnType = typeof typeName === 'string' && /[-=~]>/.test(typeName);
          if (!isFnType && rhsType !== typeName && rhsType !== baseType) {
            throw new Error(`Conflicting type declarations for '${name}': '${typeName}' vs '${rhsType}'`);
          }
          value.attestedAs = rhsType;
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
    if (typeof typeName === 'string' && /[-=~]>/.test(typeName)) {
      // If the LHS declares the function type, the return-type is already
      // named there — let it flow into the literal so the signature check
      // doesn't demand a redundant in-body annotation.
      if (value.type === 'Function' && value.returnType == null) {
        const m = typeName.match(/[-=~]>\s*\((.*)\)\s*$/);
        if (m) value.returnType = m[1];
      }
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
    let ts = pos + 1;
    // Ref-decl annotation: name *Type [...] = expr
    if (tokens[ts]?.type === 'STAR' && typeLength(ts + 1) > 0) {
      const afterRefType = ts + 1 + typeLength(ts + 1);
      return tokens[afterRefType]?.type === 'EQUALS';
    }
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
            if (tokens[i]?.type === 'KEYWORD' && tokens[i].value === 'self') return tokens[i + 1]?.type === 'EQUALS';
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
    if (typeLength(ts) === 0) return false;
    const afterType = ts + typeLength(ts);
    return tokens[afterType]?.type === 'EQUALS';
  }

  function isBareTypeDeclStart() {
    if (peek().type !== 'IDENT') return false;
    const ts = pos + 1;
    if (typeLength(ts) === 0) return false;
    const after = tokens[ts + typeLength(ts)]?.type;
    return after !== 'EQUALS' && after !== 'COMMA';
  }

  // ── After a named param's colon (`key: …`) ────────────────────────────────
  // `key: local Type` renames; a lone `key: X` is a type or a local depending
  // on what is in scope (resolveLoneNames). A single name in parens is retired.
  function isRetiredParenAlias() {
    return peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' &&
      tokens[pos + 2]?.type === 'RPAREN' && tokens[pos + 3]?.type !== '->';
  }
  function throwRetiredParenAlias(key) {
    const alias = tokens[pos + 1].value;
    const after = tokens[pos + 3];
    if (after?.type === 'SIGIL') {
      throw new Error(`Accessor remap '${key}: (${alias}) :${after.value}' is retired. Publish the param with '@${key}: ${alias} Type', or write a handler: '@${after.value} = { ${alias} }'`);
    }
    const rest = after?.type === 'IDENT' ? ` ${after.value}`
      : after?.type === 'STAR' ? ' *'
      : after?.type === 'HASH' ? ' #'
      : after?.type === 'LBRACE' ? ' { … }'
      : after?.type === 'LPAREN' ? ' ( … ) -> *{ … }'
      : '';
    throw Object.assign(
      new Error(`'${key}: (${alias})' is retired — write '${key}: ${alias}${rest}' (no parens around a single name)`),
      { fatal: true },
    );
  }
  function startsRenamedParam() {
    if (peek().type !== 'IDENT') return false;
    const next = tokens[pos + 1];
    if (next?.type === 'IDENT' || next?.type === 'AMPERSAND_IDENT') return true;
    if (next?.type === 'STAR') {
      const after = tokens[pos + 2]?.type;
      return after === 'IDENT' || after === 'COMMA' || after === 'RPAREN' || after === 'NEWLINE' || after === 'BLOCK_SEP';
    }
    return false;
  }
  function parseRenamedParam(key) {
    const name = consume().value;
    if (peek().type === 'STAR') {
      consume(); // *
      if (peek().type === 'IDENT') return { key, name, type: parseType(), positional: false, ref: true };
      return { key, name, type: 'Anything', positional: false, ref: true };
    }
    if (peek().type === 'AMPERSAND_IDENT') {
      return { key, name, type: consumeAmpersandTypeForParam(), positional: false, readonly: true };
    }
    return { key, name, type: parseType(), positional: false };
  }
  function isLoneNameAfterColon() {
    if (peek().type !== 'IDENT') return false;
    const next = tokens[pos + 1]?.type;
    return next === 'COMMA' || next === 'RPAREN' || next === 'NEWLINE' || next === 'BLOCK_SEP' ||
      next === 'EOF' || next === 'EQUALS' || next === 'GT' || next === 'DIVIDER' || next === undefined;
  }

  function isParamStart() {
    const t = peek().type;
    if (t === 'ELLIPSIS') return true;
    if (t === 'IDENT') return true;
    // @name — published param (class / file header)
    if (t === 'AT' && tokens[pos + 1]?.type === 'IDENT') return true;
    // (name) — retired suppressed-accessor form; parsed to report it
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
      if (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT') return true; // public class: @Name
      return peek().type === 'IDENT' && !isOneParamDelim();
    };
    // ── Default value helpers ─────────────────────────────────────────────
    const tryParseDefault = () => {
      if (peek().type !== 'EQUALS') return null;
      consume(); // =
      return parseDefaultValue();
    };
    const withDefault = (param, defaultValue) => {
      if (!defaultValue) return param;
      if (!param.type) param.type = typeOfDefault(param, defaultValue);
      param.defaultValue = defaultValue;
      return param;
    };
    // ── Param forms ───────────────────────────────────────────────────────
    if (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT') {
      // @name … — published param: the class answers `@name` with its value.
      // Accessor name is the external one (the key for `@key: local Type`).
      consume(); // AT
      const next = tokens[pos + 1]?.type;
      const p = peek().type === 'IDENT' && (next === 'RPAREN' || next === 'COMMA' || next === 'NEWLINE' || next === 'BLOCK_SEP')
        ? { name: consume().value, type: 'Anything', positional: true }
        : parseOneParam();
      if (!p || p.rest) throw new Error(`Expected a param after '@'`);
      p.accessor = p.key || p.name;
      return p;
    } else if (peek().type === 'SIGIL') {
      // Prefix-colon param form retired 2026-05-10. Use post-colon `name:` instead.
      const name = peek().value;
      throw new Error(`Prefix-colon param form ':${name}' is no longer valid. Use '${name}:' for a named param (post-colon flip 2026-05-10).`);
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      // name: ... — named param (external label = `name`).
      const first = consume().value;
      consume(); // COLON
      if (isRetiredParenAlias()) throwRetiredParenAlias(first);
      if (startsRenamedParam()) {
        // name: local Type — the caller passes `name`, the body sees `local`
        return withDefault(parseRenamedParam(first), tryParseDefault());
      }
      if (isLoneNameAfterColon()) {
        // name: X — X is a type if one is in scope, else a local (resolved
        // after parsing: see resolveLoneNames)
        return withDefault({ name: first, type: consume().value, typeOrLocal: true }, tryParseDefault());
      }
      if (peek().type === 'SIGIL') {
        throw new Error(`Accessor remap '${first}: :${peek().value}' is retired. Publish the param with '@${first}: Type', or write a handler: '@${peek().value} = { ${first} }'`);
      }
      if (peek().type === 'STAR' && tokens[pos + 1]?.type !== 'IDENT') {
        // name: * — named ref param (wildcard, no explicit type)
        consume();
        return withDefault({ name: first, type: 'Anything', ref: true }, tryParseDefault());
      }
      if (peek().type === 'STAR') {
        // name: *Type — named ref param with explicit type
        consume();
        const type = parseType();
        return withDefault({ name: first, type, ref: true }, tryParseDefault());
      }
      if (peek().type === 'AMPERSAND_IDENT') {
        // name: &Type — named read-only ref param
        const type = consumeAmpersandTypeForParam();
        return withDefault({ name: first, type, readonly: true }, tryParseDefault());
      }
      // name: Type (simple typed) | name: (no type) | name: literal (shorthand default)
      let type = null;
      if (peekIsParamType()) { type = parseType(); }
      if (!type && (peek().type === 'STRING' || peek().type === 'NUMBER' || (peek().type === 'MINUS' && tokens[pos + 1]?.type === 'NUMBER') ||
          (peek().type === 'KEYWORD' && (peek().value === 'true' || peek().value === 'false' || peek().value === 'null')))) {
        const defaultValue = parseDefaultLiteral();
        return withDefault({ name: first, type }, defaultValue);
      }
      return withDefault({ name: first, type }, tryParseDefault());
    } else if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'RPAREN') {
      // (name) Type / (name) :accessor Type — retired: params are private
      // unless published with `@name`.
      consume(); // LPAREN
      const name = expect('IDENT').value;
      expect('RPAREN');
      if (peek().type === 'SIGIL') {
        throw new Error(`Accessor remap '(${name}) :${peek().value}' is retired. Write '${name} Type' and a handler: '@${peek().value} = { ${name} }'`);
      }
      throw new Error(`'(${name})' is retired: params are private unless published. Write '${name} Type' (private) or '@${name} Type' (published)`);
    } else if (peek().type === 'IDENT') {
      const name = consume().value;
      // *Type — positional ref param with explicit type
      if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'IDENT') {
        consume(); // *
        const type = parseType();
        return withDefault({ name, type, positional: true, ref: true }, tryParseDefault());
      }
      // &Type — positional read-only ref param
      if (peek().type === 'AMPERSAND_IDENT') {
        const type = consumeAmpersandTypeForParam();
        return withDefault({ name, type, positional: true, readonly: true }, tryParseDefault());
      }
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
      let separated = true;
      while (true) {
        if (peek().type === 'NEWLINE') { skipNewlines(); separated = true; }
        if (peek().type === 'COMMA') { consume(); separated = true; continue; }
        if (peek().type === 'RPAREN') break;
        if (!isParamStart()) break;
        if (!separated) throw new Error(`Expected ',' or a newline between params, got ${peek().type} '${peek().value || ''}'`);
        const p = parseOneParam();
        if (p === null) break;
        params.push(p);
        separated = false;
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
    readonlyParamScopes.push(new Set());
    skipNewlines();
    // A silent declaration's lineal body may be empty: a blank line right
    // after its `=` ends it (the old lone `.` used to fill this slot).
    if (!stopToken && declCtx?.silent && (peek().type === 'BLOCK_SEP' || peek().type === 'EOF')) {
      readonlyParamScopes.pop();
      refVarScopes.pop();
      localScopes.pop();
      return [];
    }
    if (peek().type === 'BLOCK_SEP') consume();

    const isStop = () => peek().type === 'BLOCK_SEP' || peek().type === 'EOF' || (stopToken && peek().type === stopToken);
    const body = [];
    while (!isStop()) {
      skipNewlines();
      if (isStop()) break;

      if (peek().type === 'DOT') {
        if (declCtx) throw trailingDotError();
        consume();
        body.push(AST.silentTerminator());
        break;
      }

      if (atSelfValue()) {
        consume(); // self
        body.push({ ...AST.reply(selfReturnFields()), tailValue: true });
        break;
      }

      // Explicit `return` statement — the value-return form.
      if (isReturnKw()) {
        consume();
        if (silentReturn()) { body.push(AST.silentTerminator()); break; }
        if (peek().type === 'DOT') {
          if (declCtx) throw trailingDotError();
          consume(); // `return .` — silent
          body.push(AST.silentTerminator());
          break;
        }
        const openForm = peek().type === 'NEWLINE';
        if (openForm) skipNewlines();
        body.push(AST.reply(parseReplyFields(!openForm) ));
        break;
      }

      if (peek().type === '->') {
        // A leading `->` in a *lineal* body (no stopToken, nothing parsed yet)
        // is the arrow one-liner / body-opener (`@get = -> x`): keep it and let
        // the single tail be the implicit return. Anywhere else — inside a
        // braced body, or after another statement — a bare `->` is just a
        // misplaced lambda arrow.
        if (stopToken || body.length > 0) throw new Error(MISPLACED_ARROW_MSG);
        consume();
        if (peek().type === 'DOT') {
          if (declCtx) throw trailingDotError();
          consume(); // `-> .` — silent one-liner
          body.push(AST.silentTerminator());
          break;
        }
        const openForm = peek().type === 'NEWLINE';
        if (openForm) skipNewlines();
        body.push({ ...AST.reply(parseReplyFields(!openForm)), tailValue: true });
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
        // name = *TypeName(args) — ref constructor form
        } else if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'IDENT') {
          consume(); // *
          const typeName = parseType();
          if (peek().type !== 'LPAREN') {
            throw new Error(`Expected '(' after '*${typeName}'`);
          }
          addRef(name);
          const value = parseForwardCall(typeName);
          body.push(AST.refDecl(name, null, value));
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
              if (!isRef(pName)) {
                if (isReadonlyParam(pName)) throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${pName}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
                throw new Error(`Cannot ${isUpdate ? 'update' : 'set'} '${pName}' — only '*Type' variables support '${isUpdate ? '<|' : '<-'}'`);
              }
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
        (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'LPAREN' || tokens[pos + 1]?.type === 'DOT' || tokens[pos + 1]?.type === 'ELLIPSIS')) ||
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
    readonlyParamScopes.pop();
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
    declCtx = declFor('@' + op);

    // ── Public ref cell: @name *Type = expr ─────────────────────────────
    // Desugars to a private refDecl (state slot) plus a synthesized getter
    // (and setter, for base types). Caller receives an array of FunctionDecls.
    const isPublicRef = tokens[pos]?.type === 'STAR' &&
      tokens[pos + 1]?.type === 'IDENT';
    if (isPublicRef) {
      consume(); // *
      const typeName = parseType();
      skipNewlines();
      expect('EQUALS');
      skipNewlines();
      const value = parseExpr();
      declareLocal('@' + op);
      addRef('@' + op, typeName);
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
    // Speculative: if after `=` we see a literal or a call, treat as a
    // constant. Otherwise fall through to handler parsing. The call must
    // construct a type in scope — checked after parsing (resolveLoneNames).
    if (peek().type === 'EQUALS') {
      const savedPos = pos;
      consume(); // EQUALS
      skipNewlines();
      const t = peek().type;
      // Exclude `Function(...)` — that's the empty-overload initializer form.
      const isCtorCall = t === 'IDENT' && peek().value !== 'Function' && tokens[pos + 1]?.type === 'LPAREN';
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
          if (v.type === 'FunctionCallExpr' && v.callee?.type === 'Identifier') {
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
        if (value.type === 'FunctionCallExpr') getter.constantCallee = typeName;
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
      // Plain `@op *...` (no `=` and no `<<`) is allowed only for the no-params
      // shorthand `@op *= body` / `@op * { body }`. With-params lineal `@op *\n params \n = \n body`
      // requires the leading `=`.
      let li = pos;
      while (li < tokens.length && tokens[li].type === 'NEWLINE') li++;
      if (tokens[li]?.type === 'STAR') {
        let after = li + 1;
        while (after < tokens.length && (tokens[after].type === 'NEWLINE' || tokens[after].type === 'BLOCK_SEP')) after++;
        const afterTok = tokens[after]?.type;
        const sawNewlineAfterStar = after > li + 1;
        if (sawNewlineAfterStar && afterTok !== 'EQUALS' && afterTok !== 'LBRACE' && afterTok !== 'LPAREN') {
          throw new Error(`Lineal constructor '@${op}' with params requires '=' before '*' — write '@${op} = *' or '@${op}\\n  =\\n  *'`);
        }
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
      // LPAREN (params), STAR (constructor), `->`/`{`/`.` (no-arg bodies),
      // NEWLINE/BLOCK_SEP (lineal-form continuation).
      const _t = peek().type;
      if (isReturnKw()) {
        // `@op = return expr` — `return` is not a value and no function body
        // has been opened here, so it cannot be the RHS of `=`.
        throw new Error(`'return' cannot be the right-hand side of '=' — no function body has been opened. Use '@${op} = -> expr' or '@${op} = { return expr }'.`);
      }
      if (_t !== 'STAR' && _t !== '->' && _t !== 'LBRACE' && _t !== 'DOT' && _t !== 'NEWLINE' && _t !== 'BLOCK_SEP' && _t !== 'LPAREN' && !isBareExtendStart()) {
        throw new Error(`'@${op}' is public — only functions can be public. Use '->', '{', or '(params)' to define a function body, or remove the '@' for a private value.`);
      }
      // Allow `= \n *...` — body-opener `=` may sit on its own line
      // before the constructor `*`.
      if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
        let _li = pos;
        while (_li < tokens.length && (tokens[_li].type === 'NEWLINE' || tokens[_li].type === 'BLOCK_SEP')) _li++;
        if (tokens[_li]?.type === 'STAR') {
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
      } else if (peek().type === 'STAR') {
        throw new Error(`Constructor '@${op}' requires '=' before '*' — write '@${op} =', then '*' alone on the next line`);
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

    if (isDelimitedClassStart() || isBareExtendStart()) {
      // Public constructor: @Name = (params) [->] *{ body } | @Name = [->] *{ body }
      //                     @Name = A ++ B | @Name = C++ | @Name = C ++ *{ body }
      const { params: cParams, supertypes, nested } = isBareExtendStart() ? parseBareExtendClass('@' + op) : parseDelimitedClass('@' + op);
      const actorNode = { params: cParams, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: cParams, constructorBody: nested.constructorBody, asClauses: nested.asClauses, supertypes };
      if (overloadMode !== 'create') {
        return AST.functionDecl('@' + op, cParams, [], { overloadMode, actorDef: actorNode });
      }
      return AST.actor('@' + op, { ...actorNode, overloadMode });
    } else if (peek().type === 'LPAREN') {
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
    } else if (peek().type === 'STAR') {
      // Public constructor: @Name = * { body } | @Name =\n*\n params\n*\n body
      consume(); // *
      const { params: cParams, supertypes, nested } = parseConstructorAfterStar('@' + op);
      const actorNode = { params: cParams, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: cParams, constructorBody: nested.constructorBody, asClauses: nested.asClauses, supertypes };
      if (overloadMode !== 'create') {
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
    skipArrowBeforeBrace();
    // Delimited braced body: @op = (params) [->] { body } [: Type]
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

  // Whether this body declares `name` further on (`name = …`, or `name` then `=` on
  // the next line). A bare `name(…)` above that can't be the same declaration, which
  // would be a duplicate, so it's a call.
  function declaredLaterInBody(name) {
    let depth = 0;
    for (let i = pos + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'LBRACE' || t.type === 'LPAREN' || t.type === 'LBRACKET') depth++;
      else if (t.type === 'RBRACE' || t.type === 'RPAREN' || t.type === 'RBRACKET') {
        if (--depth < 0) return false;
      } else if (depth === 0 && t.type === 'IDENT' && t.value === name && ['NEWLINE', 'BLOCK_SEP'].includes(tokens[i - 1]?.type)) {
        let j = i + 1;
        while (tokens[j]?.type === 'NEWLINE' || tokens[j]?.type === 'BLOCK_SEP') j++;
        if (tokens[j]?.type === 'EQUALS') return true;
      }
    }
    return false;
  }

  // Whether the parens opening at `open` are followed by a body opener, as in a
  // declaration missing its `=`: `@go(n: Integer) -> :n`. A call never is.
  function opensBodyAfterParens(open) {
    let depth = 0;
    for (let i = open; i < tokens.length; i++) {
      if (tokens[i].type === 'LPAREN') depth++;
      else if (tokens[i].type === 'RPAREN' && --depth === 0) {
        return ['->', 'LBRACE', 'EQUALS'].includes(tokens[i + 1]?.type);
      }
    }
    return false;
  }

  function isActorBodyStart() {
    // Detects whether the lineal-form body of a named `name = ... = body`
    // declaration is an actor body (becomes a class) vs. a regular function
    // body: the first non-blank body token is an actor-flavored marker
    // (@method / self / set / update). Ref-decls (`name *Type = ...`) at the
    // body opening are *not* discriminative — they appear in both body kinds —
    // so a body opening with a ref-decl is treated as a regular function.
    // A silent name (`fire.`) is never a class: an empty lineal body followed
    // by the next `@handler` stays a function.
    if (declCtx?.silent) return false;
    let i = pos;
    while (i < tokens.length && (tokens[i].type === 'NEWLINE' || tokens[i].type === 'BLOCK_SEP')) i++;
    const t = tokens[i];
    if (!t) return false;
    return t.type === 'AT' ||
           (t.type === 'KEYWORD' && (t.value === 'self' || t.value === 'set' || t.value === 'update'));
  }

  // ── Service constraint parser ──────────────────────────────────────────────
  // Parses `{ @method: (params) -> (returns), ... }`.
  // Returns { '@method': { params: [{name, type}], returns: [{name, type}] } }.
  // Lives at the top of the parse closure so constructor-param helpers below
  // can call it (used for inline `name { @method: ... }` constraints in params).
  function parseServiceConstraint() {
    expect('LBRACE');
    const constraint = {};
    while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); continue; }
      let methodName;
      if (peek().type === 'AT') {
        consume();
        const nameTok = consume();
        methodName = '@' + nameTok.value;
      } else {
        methodName = consume().value;
      }
      if (peek().type === 'COLON') {
        throw new Error(`Interface entry '${methodName}:' — the entry colon is retired; write '${methodName} (params) -> (returns)'`);
      }
      expect('LPAREN');
      const params = [];
      while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
        if (peek().type === 'COMMA') { consume(); continue; }
        if (peek().type === 'SIGIL') {
          throw new Error(`Prefix-colon param form ':${peek().value}' is no longer valid in service constraints. Use '${peek().value}: Type' (post-colon flip 2026-05-10).`);
        }
        const pName = expect('IDENT').value;
        let pType = null;
        if (peek().type === 'COLON') {
          consume();
          if (peek().type === 'IDENT') pType = consume().value;
        } else if (peek().type === 'IDENT') {
          // legacy positional form `name Type` — keep working
          pType = consume().value;
        }
        params.push({ name: pName, type: pType });
      }
      expect('RPAREN');
      let returns = null;
      // `[->] (returns)` or `[->] .` (silent); the arrow is optional.
      if (peek().type === 'ARROW' || peek().value === '->') consume();
      if (peek().type === 'DOT') {
        consume();
      } else if (peek().type === 'LPAREN') {
        expect('LPAREN');
        returns = [];
        while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
          if (peek().type === 'COMMA') { consume(); continue; }
          if (peek().type === 'SIGIL') {
            throw new Error(`Prefix-colon return form ':${peek().value}' is no longer valid in service constraints. Use '${peek().value}: Type' (post-colon flip 2026-05-10).`);
          }
          const rName = expect('IDENT').value;
          let rType = null;
          if (peek().type === 'COLON') {
            consume();
            if (peek().type === 'IDENT') rType = consume().value;
          } else if (peek().type === 'IDENT') {
            rType = consume().value;
          }
          returns.push({ name: rName, type: rType });
        }
        expect('RPAREN');
      }
      constraint[methodName] = { params, returns };
    }
    expect('RBRACE');
    return constraint;
  }

  // ── Constructor `(params) *{...}` form helpers ─────────────────────────────
  // Parse a constructor's `(params)`; caller has consumed `(`. Consumes through `)`.
  // Handles the `++` parent list (`T ++`, `sup T ++`, `A ++ B`) and ref-param shortcuts.
  function parseConstructorParenParams(op) {
    const cParams = [];
    skipNewlines();
    if (looksLikeRetiredSupertypePrefix()) throw new Error(retiredSupertypeMessage(op));
    const supertypes = parseExtendsParents(op, true);
    skipNewlines();
    let separated = true;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE' || peek().type === 'COMMA') { consume(); separated = true; continue; }
      if (!separated) {
        throw new Error(`Expected ',' or a newline between class params, got ${peek().type} '${peek().value || ''}'`);
      }
      separated = false;
      // Positional ref: name *Type or name * (wildcard)
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'STAR') {
        const next2 = tokens[pos + 2]?.type;
        if (next2 === 'RPAREN' || next2 === 'COMMA' || next2 === 'NEWLINE') {
          // Wildcard ref param: name *
          const name = consume().value;
          consume();
          cParams.push({ name, type: 'Anything', positional: true, ref: true });
          continue;
        }
        if (next2 === 'IDENT') {
          // Typed ref param: name *Type [of Type ...]
          const name = consume().value;
          consume(); // *
          const type = parseType();
          cParams.push({ name, type, positional: true, ref: true });
          continue;
        }
      }
      // Positional read-only ref: name &Type
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'AMPERSAND_IDENT') {
        const name = consume().value;
        const type = consumeAmpersandTypeForParam();
        cParams.push({ name, type, positional: true, readonly: true });
        continue;
      }
      // Sigil ref: :name *Type, :name * (wildcard), :name { constraint }
      if (peek().type === 'SIGIL' && (tokens[pos + 1]?.type === 'STAR' || tokens[pos + 1]?.type === 'LBRACE')) {
        const name = consume().value;
        if (peek().type === 'STAR') {
          consume();
          if (peek().type === 'IDENT') {
            // :name *Type — typed ref
            const type = parseType();
            cParams.push({ name, type, ref: true });
          } else {
            // :name * — wildcard ref
            cParams.push({ name, type: 'Anything', ref: true });
          }
          continue;
        }
        if (peek().type === 'LBRACE') {
          const constraint = parseServiceConstraint();
          cParams.push({ name, type: 'Anything', ref: true, constraint });
          continue;
        }
      }
      // Sigil read-only ref: :name &Type
      if (peek().type === 'SIGIL' && tokens[pos + 1]?.type === 'AMPERSAND_IDENT') {
        const name = consume().value;
        const type = consumeAmpersandTypeForParam();
        cParams.push({ name, type, readonly: true });
        continue;
      }
      // Inline service constraint: name { @method: ... }
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LBRACE') {
        const name = consume().value;
        const constraint = parseServiceConstraint();
        cParams.push({ name, type: 'Anything', positional: true, ref: true, constraint });
        continue;
      }
      // Bare identifier (no type annotation)
      const next1 = tokens[pos + 1]?.type;
      if (peek().type === 'IDENT' && (next1 === 'RPAREN' || next1 === 'COMMA' || next1 === 'NEWLINE')) {
        cParams.push({ name: consume().value, type: 'Anything', positional: true });
        continue;
      }
      const p = parseOneParam();
      if (p) { cParams.push(p); continue; }
      break;
    }
    skipNewlines();
    expect('RPAREN');
    return { params: cParams, supertypes };
  }

  // A star that closes a lineal constructor header: alone on its line, or
  // first on its line and followed only by `{` (delimited body).
  const isClosingStar = (t) => t?.type === 'STAR' && (t.alone || t.aloneBeforeBrace);

  // Try to parse the param run of a lineal header (`*\n params\n *`). Caller
  // has consumed the opening `*`. Returns the params with the closing `*`
  // consumed, or null (position restored) when the lines after the opening `*`
  // are not a param run closed by a lone `*` — i.e. the no-params form, where
  // the body follows the opening `*` directly.
  function tryParseLinealConstructorParams() {
    const saved = pos;
    const cParams = [];
    try {
      while (peek().type !== 'EOF') {
        if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') { consume(); continue; }
        if (isClosingStar(peek())) {
          consume();
          return cParams;
        }
        if (peek().type === 'IDENT' && !isParamStart()) {
          const n1 = tokens[pos + 1]?.type;
          if (n1 === 'NEWLINE' || n1 === 'BLOCK_SEP') {
            cParams.push({ name: consume().value, type: 'Anything', positional: true });
            continue;
          }
        }
        if (isParamStart()) {
          const p = parseOneParam();
          if (p) {
            cParams.push(p);
            if (peek().type !== 'NEWLINE' && peek().type !== 'BLOCK_SEP') break; // one param per line
            continue;
          }
        }
        break;
      }
    } catch {
      // not a param run — fall through to restore
    }
    // A typed param run closed by a lone `=` is the retired `*\n params\n =`
    // form (no valid body has a typed declaration followed by a lone `=`).
    const last = cParams[cParams.length - 1];
    if (last && last.type && last.type !== 'Anything' && peek().type === 'EQUALS' &&
        tokens[pos - 1]?.type === 'NEWLINE' && tokens[pos + 1]?.type === 'NEWLINE') {
      throw new Error(`a lineal constructor header is closed by '*' alone on its line, not '='`);
    }
    pos = saved;
    return null;
  }

  // Parse the body that follows constructor params. `linealHeader` is true when
  // the header was lineal (`*\n [params\n *]`): the body is then delimited
  // (`{`) or lineal (terminated by `.`/`end`). After a delimited header the
  // body must be opened by `{` or be the tail form (`->`/`return`). An empty
  // body is legal (e.g. `{}`).
  function parseConstructorBody(op, linealHeader) {
    if (!linealHeader && peek().type === 'EQUALS') {
      throw new Error(`'=' no longer opens a constructor body (in '${op}') — use a lineal header ('*' alone on a line, params one per line, closing '*' alone on a line) or a delimited body '{ ... }'`);
    }
    let nested;
    if (peek().type === 'LBRACE') {
      consume();
      nested = parseActorBody(() => peek().type === 'RBRACE');
      skipNewlines();
      expect('RBRACE');
    } else if (linealHeader || peek().type === '->' || isReturnKw()) {
      // Lineal body or tail form (`return`/`->` consumed by parseActorBody).
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
    } else {
      throw new Error(`class '${op}' requires a body — use '{ ... }', a lineal header, or '-> expr'`);
    }
    hoistNested(nested, op);
    return nested;
  }

  // Optional arrow before a delimited body: `(params) -> { body }` is the
  // same as `(params) { body }`.
  function skipArrowBeforeBrace() {
    if (peek().type === '->' && tokens[pos + 1]?.type === 'LBRACE') consume();
  }

  // `(params) [->] *{` or `[->] *{` at token index `i` — a delimited class
  // header. Spaces are allowed around `*`; `*` directly before `{` after a
  // param list is never multiplication.
  function isDelimitedClassStart(i = pos) {
    let j = i;
    if (tokens[j]?.type === 'LPAREN') {
      let depth = 0;
      for (; j < tokens.length; j++) {
        const t = tokens[j].type;
        if (t === 'LPAREN') depth++;
        else if (t === 'RPAREN' && --depth === 0) { j++; break; }
        else if (t === 'EOF') return false;
      }
    } else if (tokens[j]?.type !== '->') {
      return false;
    }
    if (tokens[j]?.type === '->') j++;
    return tokens[j]?.type === 'STAR' && tokens[j + 1]?.type === 'LBRACE';
  }

  // Parse `(params) [->] *{ body }` / `[->] *{ body }` (see isDelimitedClassStart).
  function parseDelimitedClass(op) {
    let params = [];
    let supertypes = [];
    if (peek().type === 'LPAREN') {
      consume();
      ({ params, supertypes } = parseConstructorParenParams(op));
    }
    if (peek().type === '->') consume();
    expect('STAR');
    const nested = parseConstructorBody(op, false);
    return { params, supertypes, nested };
  }

  // Parse a bare extends definition (see isBareExtendStart):
  //   A ++ B            parents only — a new class, no changes
  //   C++               one parent
  //   C ++ *{ body }    parents and a body, no params
  function parseBareExtendClass(op) {
    const supertypes = parseExtendsParents(op, false);
    let nested = null;
    if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'LBRACE') {
      consume(); // *
      nested = parseConstructorBody(op, false);
    } else if (!isDefinitionEnd(pos)) {
      const seg = parentSegmentAt(pos);
      if (seg?.wrapped) throw new Error(`In '${op}', a wrapped parent ('${peek().value} ${tokens[pos + 1].value}') needs a body to use it — write '${op} = ${peek().value} ${tokens[pos + 1].value} ++ *{ … }'`);
      throw new Error(`In '${op}', expected a parent class, '*{ … }' or the end of the definition after '++' — params go in parens: '(Parent ++ params) *{ … }'`);
    }
    nested ??= parseActorBody(() => true); // an empty body, same shape as `*{}`
    return { params: [], supertypes, nested };
  }

  const RETIRED_STAR_PAREN_MSG = (op) =>
    `'*(params) { ... }' is retired (in '${op}') — the '*' now marks the body: write '(params) *{ ... }'`;

  // Dispatch after a `*` that opens a constructor. Caller has consumed `*`.
  // (`(params) *{ body }` goes through parseDelimitedClass instead.)
  //   * { body }                                  — no params, delimited body
  //   *\n params\n *\n body                       — lineal header
  //   *\n body                                     — lineal, no params
  // In the lineal forms each `*` must be the only token on its line (the
  // closing `*` may be followed by `{`).
  function parseConstructorAfterStar(op) {
    const star = tokens[pos - 1];
    if (star?.alone) {
      const params = tryParseLinealConstructorParams() ?? [];
      skipNewlines();
      const nested = parseConstructorBody(op, true);
      return { params, supertypes: [], nested };
    }
    skipNewlines();
    if (peek().type === 'LPAREN') throw new Error(RETIRED_STAR_PAREN_MSG(op));
    if (peek().type !== 'LBRACE') {
      throw new Error(`In '${op}', a lineal constructor header's '*' must be alone on its line — write '${op} =', then '*' on its own line, params one per line, and a closing '*' on its own line`);
    }
    const nested = parseConstructorBody(op, false);
    return { params: [], supertypes: [], nested };
  }

  function parseActorBody(isEnd) {
    const functions = [];
    const nestedActors = [];
    const asClauses = [];
    const constructorBody = [];
    const outerDecl = declCtx;
    refVarScopes.push(new Map()); // actor-level ref scope
    const untrackedDecls = new Set();
    while (peek().type !== 'EOF') {
      declCtx = null;
      skipBlanks();
      if (peek().type === 'EOF' || isEnd()) break;
      // `untracked` marks the declaration that follows: its writes don't count.
      if (peek().type === 'KEYWORD' && peek().value === 'untracked') {
        consume();
        if (peek().type === 'HASH_IDENT') {
          untrackedDecls.add('#' + peek().value);
          continue;
        }
        const sigil = tokens[pos]?.type === 'AT' ? '@' : '';
        const nameTok = sigil ? tokens[pos + 1] : tokens[pos];
        if (nameTok?.type !== 'IDENT') throw new Error("'untracked' must come before a declaration");
        untrackedDecls.add(sigil + nameTok.value);
        continue;
      }
      // Constructor-block tail: `return self` / `-> self` terminates an actor
      // body (becomes-self); `return expr` / `-> expr` is a declaration return
      // (return-as); `return ()` / `-> ()` is a no-op. `->` persists here as the
      // becomes arrow; `return` is the value-return spelling.
      if (peek().type === '->' || isReturnKw()) {
        consume(); // -> or return
        if (peek().type === 'KEYWORD' && peek().value === 'self') {
          consume(); // self
        } else if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') {
          // `-> ()` is a literal of no value in a constructor block — ignored.
          // The class constructs an actor, not a value.
          consume(); consume();
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
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'STAR' && tokens[pos + 2]?.type === 'IDENT' && functions.length === 0) {
        // Service block: name *Type [= value] — ref declaration before any @ functions
        const name = consume().value;
        consume(); // *
        const typeName = parseType();
        // Register the class-level ref WITH its type so handler bodies parsed
        // later can dispatch methods correctly (e.g., news.append!(t) → list).
        addRef(name, typeName);
        if (peek().type === 'EQUALS') {
          consume();
          const value = parseExpr();
          if (isTypeAttestation()) { consumeTypeAttestation(); }
          constructorBody.push(AST.refDecl(name, typeName, value));
        } else {
          constructorBody.push(AST.refDecl(name, typeName, null));
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS' && tokens[pos + 2]?.type === 'STAR' && tokens[pos + 3]?.type === 'IDENT' && functions.length === 0) {
        // Service block: name = *TypeName(args) — ref constructor form
        const name = consume().value;
        consume(); // =
        consume(); // *
        const typeName = parseType();
        addRef(name);
        const value = peek().type === 'LPAREN' ? parseForwardCall(typeName) : parseRHSValue();
        constructorBody.push(AST.refDecl(name, null, value));
      } else if (peek().type === 'KEYWORD' && peek().value === 'set') {
        // set = (val) { ... } — syntactic sugar for the <- handler
        consume(); // 'set'
        declCtx = { name: 'set', builtin: true };
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
        skipArrowBeforeBrace();
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
            endArrowStatementAtLine();
          }
          body = parseBody();
        }
        functions.push(AST.functionDecl('set', params, body));
      } else if (peek().type === 'KEYWORD' && peek().value === 'update') {
        // update = (val) { ... } — syntactic sugar for the <| handler
        consume(); // 'update'
        declCtx = { name: 'update', builtin: true };
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
          endArrowStatementAtLine();
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
          inSignature++;
          const emitArrow = consume().value;
          inSignature--;
          if (peek().type === 'DOT' && emitArrow !== '=>') throw new Error(`'${emitArrow} .' has nothing to read — a silent emit is '=> .'`);
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
        skipArrowBeforeBrace();
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
      } else if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'SET' || tokens[pos + 1]?.type === 'UPDATE')) {
        // A write in the constructor block: `n <- n + 1`, `@a <- 1`, `log <| x`.
        const name = peek().value;
        if (!isRef(name)) {
          if (isReadonlyParam(name)) throw new Error(`Cannot set '${name}' — '&Type' parameters are read-only; declare as '*Type' for write capability`);
          throw new Error(`Cannot set '${name}' — only '*Type' variables support '<-'`);
        }
        const expr = parseExpr();
        constructorBody.push(AST.setStatement(expr.name, expr.value, { updateOp: expr.updateOp }));
      } else if (((peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT' && tokens[pos + 2]?.type === 'LPAREN')
                 || (peek().type === 'HASH_IDENT' && tokens[pos + 1]?.type === 'LPAREN')
                 || (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN'
                     && (functions.some(f => f.name === peek().value) || declaredLaterInBody(peek().value))))
                 && !opensBodyAfterParens(tokens.findIndex((t, i) => i > pos && t.type === 'LPAREN'))) {
        // A call to this actor's own function, run while constructing. After `@`
        // or `#`, a declaration needs `=` or a newline after the name. A bare name
        // declared above can't be declared again, so it's a call too.
        const expr = parseExpr();
        pushExprOrBang(constructorBody, expr);
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
        declCtx = declFor(op);

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
          if (peek().type === 'DOT') throw trailingDotError();
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
        readonlyParamScopes.push(new Set());
        for (const p of params) {
          if (p.name) declareLocal(p.name);
          if (p.readonly) addReadonlyParam(p.name);
        }
        skipNewlines();
        skipArrowBeforeBrace();
        let body;
        if (hashBareBody) {
          body = hashBareBody;
        } else if (peek().type === 'LBRACE') {
          consume(); // {
          body = parseBody('RBRACE');
          skipNewlines();
          expect('RBRACE');
        } else {
          body = parseBody();
        }
        readonlyParamScopes.pop();
        refVarScopes.pop();
        localScopes.pop();
        functions.push(AST.functionDecl(op, params, body));

      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'DOT' && tokens[pos + 2]?.type === 'IDENT' &&
                 (tokens[pos + 3]?.type === 'BANG' || tokens[pos + 3]?.type === 'LPAREN' || tokens[pos + 3]?.type === 'ELLIPSIS' ||
                  (tokens[pos + 2].value.endsWith('!') && ['NEWLINE', 'BLOCK_SEP', 'EOF', 'RBRACE', 'SEMICOLON', 'DOT'].includes(tokens[pos + 3]?.type)))) {
        // Standalone dot-call expression statement: obj.method!(args), obj.method(args),
        // obj.method..., or a bare obj.method! (zero-arity: parens optional).
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
        declCtx = declFor(op);
        let _identOverloadMode = 'create';

        // ── Overload operator: name << ─────────────────────────────────
        if (peekIsAppend()) {
          consumeOverloadOp();
          _identOverloadMode = 'append';
        }

        // ── Lineal/non-`=` constructor opener: Name (...newlines/=...)? * ──
        // Catches forms where `*` appears after `Name` separated by newlines,
        // an optional `=`, or both. The same-line `Name = *...` case is handled
        // by the delimited path below. A constructor always needs the leading
        // `=` (or an overload operator) — `Name *...` and `Name\n*` are errors.
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
          // Enter when we see `*` reachable from `Name` via the optional `=` and
          // newlines, AND either (a) there was a newline along the way, or
          // (b) we're entering the no-`=` shorthand `Name *...` directly.
          const canEnter = tokens[li]?.type === 'STAR' && (hasNewlineBeforeOpener || (!hasOpenEquals && li === pos));
          if (canEnter) {
            if (_identOverloadMode === 'create' && !hasOpenEquals) {
              throw new Error(`Constructor '${op}' requires '=' before '*' — write '${op} =', then '*' alone on the next line`);
            }
            while (pos < li) consume(); // skip newlines and optional `=`
            consume(); // *
            const { params, supertypes, nested } = parseConstructorAfterStar(op);
            const actorNode = { params, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: params, constructorBody: nested.constructorBody, asClauses: nested.asClauses, supertypes, declarationReturn: nested.declarationReturn };
            if (_identOverloadMode !== 'create') {
              functions.push(AST.functionDecl(op, params, [], { overloadMode: _identOverloadMode, actorDef: actorNode }));
            } else {
              nestedActors.push(AST.actor(op, { ...actorNode, overloadMode: _identOverloadMode }));
            }
            continue;
          }
        }

        // ── Delimited form: name = ... or name << (..) / name << *(..) ──
        // For overload operators, only enter delimited path if next token is NOT newline
        // (newline means lineal form, handled in the else branch below)
        if (peek().type === 'EQUALS' || (_identOverloadMode !== 'create' && peek().type !== 'NEWLINE' && peek().type !== 'BLOCK_SEP')) {
          if (peek().type === 'EQUALS') consume(); // eat the = (already consumed << or >> for overloads)
          // Allow `= \n *...` / `= \n (params) *{` — the constructor may
          // start on the line after the `=`.
          if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
            let _li = pos;
            while (_li < tokens.length && (tokens[_li].type === 'NEWLINE' || tokens[_li].type === 'BLOCK_SEP')) _li++;
            if (tokens[_li]?.type === 'STAR' || isDelimitedClassStart(_li)) {
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
          // Constructor: name = (params) [->] *{ body } | name = [->] *{ body }
          //              name =\n*\n params\n*\n body (lineal)
          // Subclass:    name = (T ++ params) *{ ... } | name = (sup T ++ params) *{ ... }
          //              name = A ++ B | name = C++ | name = C ++ *{ ... }
          const _isDelimitedClass = isDelimitedClassStart();
          const _isBareExtend = !_isDelimitedClass && isBareExtendStart();
          if (_isDelimitedClass || _isBareExtend || peek().type === 'STAR') {
            let cParams, supertypes, nested;
            if (_isBareExtend) {
              ({ params: cParams, supertypes, nested } = parseBareExtendClass(op));
            } else if (_isDelimitedClass) {
              ({ params: cParams, supertypes, nested } = parseDelimitedClass(op));
            } else {
              consume(); // *
              ({ params: cParams, supertypes, nested } = parseConstructorAfterStar(op));
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
            if (peek().type === 'KEYWORD' && peek().value === 'as' && tokens[pos + 1]?.type === 'STAR' && tokens[pos + 2]?.type === 'LPAREN') {
              throw new Error(`'as *( ... ) -> { ... }' is retired (in coercion of '${op}') — write 'as ( ... ) -> *{ ... }'`);
            }
            // Constructor coercion: name = ref as (p: Type, ...) [->] *{ method ... }
            if (peek().type === 'KEYWORD' && peek().value === 'as' && ctorProfileAhead(pos + 1)) {
              consume(); // as
              const ctorParams = parseCtorProfileParams(`in coercion of '${op}'`);
              const constraint = parseServiceConstraint();
              constructorBody.push(AST.serviceCoercion(op, value, constraint, ctorParams));
              continue;
            }
            let typeName = null;
            if (isTypeAttestation()) {
              typeName = consumeTypeAttestation();
              value.attestedAs = typeName;
            }
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
            if (peek().type === 'DOT') throw trailingDotError();
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
          readonlyParamScopes.push(new Set());
          for (const p of params) {
            if (p.name) declareLocal(p.name);
            if (p.readonly) addReadonlyParam(p.name);
          }
          skipNewlines();
          skipArrowBeforeBrace();
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
            body = parseBody();
          }
          readonlyParamScopes.pop();
          refVarScopes.pop();
          localScopes.pop();
          functions.push(AST.functionDecl(op, params, body, { overloadMode: _identOverloadMode }));

        // ── Lineal form: name params\n\nbody ────────────────────────────
        } else {
          const params = parseParams();

          // Check if this is a named actor definition (body opens with
          // @method / self / set / update).
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
            hoistNested(nested, op);
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
            readonlyParamScopes.push(new Set());
            for (const p of params) {
              if (p.name) declareLocal(p.name);
              if (p.readonly) addReadonlyParam(p.name);
            }
            const body = parseBody();
            readonlyParamScopes.pop();
            refVarScopes.pop();
            localScopes.pop();
            functions.push(AST.functionDecl(op, params, body, { overloadMode: _identOverloadMode }));
          }
        }
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator between top-level declarations
      } else if (peek().type === 'LPAREN' && tokens[pos + 1]?.type === 'RPAREN') {
        // Bare `()` in constructor block is a literal of no value — ignored.
        consume(); consume();
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
      // A call infers its callee's name; whether that is a type in scope is
      // settled after parsing (resolveLoneNames)
      if (value.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier') {
        return value.callee.name;
      }
      return null;
    }
    const isCall = (value) => value?.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier';
    // A TypedAssign that constructs against a declared dependency (or a
    // class coercion of one) is conceptually a ref decl: it produces
    // an actor reference. Mark such state vars as isRef so codegens
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
          if (inferred && isCall(stmt.expr)) stmt.typeFromCallee = true;
        }
        declarationReturn = stmt;
      } else if (stmt.type === 'ExprStatement' || stmt.type === 'SetStatement') {
        initBody.push(stmt);
      } else if (stmt.type === 'TypedAssign' || stmt.type === 'RefDecl') {
        const isIngest = stmt.value?.type === 'IngestExpr';
        const isRef = stmt.type === 'RefDecl' || isDepConstructorCall(stmt.value);
        const fromCallee = !stmt.typeName && !stmt.rhsType && isCall(stmt.value);
        stateVarDecls.push({
          name: stmt.name,
          typeName: stmt.typeName || stmt.rhsType || inferType(stmt.value) || 'Anything',
          ...(fromCallee && { typeFromCallee: true }),
          isRef,
          ...(isIngest && { ingest: true, ingestDefault: stmt.value.defaultValue }),
        });
        initBody.push(AST.stateAssign(stmt.name, stmt.value, { isRef }));
      }
    }
    refVarScopes.pop(); // end actor-level ref scope
    declCtx = outerDecl;
    for (const decl of [...functions, ...stateVarDecls]) {
      if (untrackedDecls.has(decl.name)) decl.untracked = true;
    }
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
  // A field holding a silent function is named with the silent `.`
  // (`press.: () -> .`); the stored name drops it — a type can't hold both
  // `press` and `press.`, and the dot is restored wherever the type is shown.
  //
  // A field's name matches its arrow, as a function's name matches its body: a
  // `=>` field that returns is `name!`, a `->` or `~>` field is bare, and a value
  // field takes no suffix. The `!` stays in the stored name.
  function silentFieldName(name, paramType) {
    const silentType = typeof paramType === 'string' && /=>\s*\.\s*$/.test(paramType);
    if (name.endsWith('.') && !silentType) {
      throw new Error(`Field '${name}' is silent by its name — its type is a silent function '(…) -> .'`);
    }
    if (silentType && !name.endsWith('.')) {
      throw new Error(`Field '${name}' holds a silent function — name it '${name.replace(/!$/, '')}.'${name.endsWith('!') ? ", without '!'" : ''}`);
    }
    if (silentType) return name.slice(0, -1);
    const arrow = typeArrow(paramType);
    const bang = name.endsWith('!');
    if (bang && !arrow) throw new Error(`Field '${name}' is a value — only a function field takes '!'`);
    if (bang && arrow !== '=>') throw new Error(`Field '${name}' holds a read-only function ('${arrow}'), so it takes no '!' — name it '${name.slice(0, -1)}'`);
    if (!bang && arrow === '=>') throw new Error(`Field '${name}' holds a writing function ('=>'), so it must be named '${name}!'`);
    return name;
  }

  // A function type's own arrow, skipping any inside its params or result.
  function typeArrow(type) {
    if (typeof type !== 'string') return null;
    let depth = 0;
    for (let i = 0; i < type.length; i++) {
      if ('({['.includes(type[i])) depth++;
      else if (')}]'.includes(type[i])) depth--;
      else if (depth === 0 && /^[-=~]>/.test(type.slice(i, i + 2))) return type.slice(i, i + 2);
    }
    return null;
  }

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
    return AST.typeField(silentFieldName(fieldName, paramType), paramType, { optional, named });
  }

  // Parse `::Name (fields)` (delimited form, single- or multi-line) or
  // `::Name <linebreak> <indented fields>` (lineal form). The lineal form
  // terminates at the first BLOCK_SEP (blank line) or EOF.
  function parseTypeDecl() {
    consume(); // DCOLON
    const name = expect('IDENT').value;
    if (peek().type === 'EQUALS') {
      throw new Error(`Type declaration '::${name} = …' — the '=' is retired; write '::${name} (fields)'`);
    }
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

  // ── File-level header entries ──────────────────────────────────────────
  // Shared by the delimited `( ... ) *{` header and the lineal `*\n ... \n*`
  // header. Parses entries until `isEnd()`, pushing service/constructor
  // dependencies and scalar file-params onto `dependencies`.
  const tokText = (tok) => {
    if (tok.type === 'SIGIL') return ':' + tok.value;
    if (tok.value != null) return String(tok.value);
    const map = {
      COLON: ':', LPAREN: '(', RPAREN: ')', LBRACE: '{', RBRACE: '}', DOT: '.', COMMA: ',', PIPE: '|',
      '->': '->', AT: '@', BANG: '!', STAR: '*', DCOLON: '::', QUESTION: '?', HASH: '#', ELLIPSIS: '...',
    };
    return map[tok.type] || tok.type;
  };
  // Re-renders an inline `{ iface }` as service-document text for
  // parseInterface: one entry per line, with newlines inside a bracket group
  // (a multi-line type declaration, a nested `*{ … }` body) preserved.
  const parseInlineIface = () => {
    inSignature++;
    try {
      return parseInlineIfaceBody();
    } finally {
      inSignature--;
    }
  };
  const parseInlineIfaceBody = () => {
    consume(); // {
    const lines = [];
    let line = '';
    let prev = null;
    let depth = 0;
    const flush = () => {
      const t = line.trim();
      if (t) lines.push(t);
      line = '';
      prev = null;
    };
    const glued = new Set(['STAR', 'DCOLON', 'ELLIPSIS', 'LPAREN']);
    const gluedBefore = new Set(['COLON', 'COMMA', 'RPAREN', 'BANG', 'DCOLON']);
    while (peek().type !== 'EOF' && !(peek().type === 'RBRACE' && depth === 0)) {
      const tok = consume();
      if (tok.type === 'NEWLINE' || tok.type === 'BLOCK_SEP') {
        if (depth === 0) flush();
        else { line += '\n'; prev = null; }
        continue;
      }
      if (tok.type === 'LPAREN' || tok.type === 'LBRACE') depth++;
      else if (tok.type === 'RPAREN' || tok.type === 'RBRACE') depth--;
      if (prev && !glued.has(prev.type) && !gluedBefore.has(tok.type) && !line.endsWith('\n')) line += ' ';
      line += tokText(tok);
      prev = tok;
    }
    flush();
    expect('RBRACE');
    return lines.length ? '{\n  ' + lines.join('\n  ') + '\n}' : '{\n}';
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
  function parenGroupFollowedByArrow(p) {
    let depth = 0;
    for (let i = p; i < tokens.length; i++) {
      const t = tokens[i].type;
      if (t === 'LPAREN') depth++;
      else if (t === 'RPAREN') { depth--; if (depth === 0) return tokens[i + 1]?.type === '->'; }
      else if (t === 'EOF') return false;
    }
    return false;
  }
  // After `Key:` in a header: a dependency binding rather than a named
  // param's type. A lone name (`HTML: Html`) stays a named param; it takes a
  // `#`, an interface, or a constructor profile after it to be a dependency.
  function isBareKeyDependency(p) {
    const t = tokens[p]?.type;
    if (t === 'SIGIL') return true;
    if (t === 'LPAREN') return !parenGroupFollowedByArrow(p);
    if (t === 'IDENT') {
      const after = tokens[p + 1]?.type;
      if (after === 'HASH' || after === 'LBRACE') return true;
      if (after === 'LPAREN') return parenGroupFollowedByArrow(p + 1);
    }
    return false;
  }
  function fileParamFrom(p, positional) {
    return AST.fileParam(p.name, {
      type: p.type, positional, defaultValue: p.defaultValue, accessor: p.accessor,
      key: p.key, typeOrLocal: p.typeOrLocal,
    });
  }
  function parseFileHeaderEntries(isEnd) {
    while (!isEnd() && peek().type !== 'EOF') {
      if (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP' || peek().type === 'COMMA') { consume(); continue; }
      let path, alias, destructures = null;
      if (peek().type === 'SIGIL') {
        // Two disambiguated cases:
        //   :name [#]  |  :name (end-of-entry)  → path-shorthand dependency
        //   :name Type                            → named scalar file-param
        const nextType = tokens[pos + 1]?.type;
        if (nextType === 'HASH' || nextType === 'RPAREN' || nextType === 'COMMA' || nextType === 'NEWLINE' || nextType === 'BLOCK_SEP') {
          const sigil = consume();
          path = sigil.value;
          alias = sigil.value;
          // Service dep with no destructures: commit before skipNewlines eats the terminator
          if (peek().type === 'RPAREN' || peek().type === 'COMMA' || peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
            dependencies.push(AST.dependency(alias, { path, destructures: null }));
            continue;
          }
        } else {
          const p = parseOneParam();
          if (p === null) throw new Error(`Expected scalar param after ':' in file-level header`);
          dependencies.push(fileParamFrom(p, false));
          continue;
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON' && isBareKeyDependency(pos + 2)) {
        // Bare-identifier dependency: `HTML: (:div)`, `HTML: :div`,
        // `Lib: L #`. (`HTML: Html` alone is a named param — see
        // isBareKeyDependency.)
        path = consume().value;
        consume(); // COLON
      } else if (peek().type === 'AT' && tokens[pos + 1]?.type === 'IDENT') {
        // Published file-param: `@name Type` / `@name: Type`
        const p = parseOneParam();
        dependencies.push(fileParamFrom(p, !!p.positional));
        continue;
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // Named scalar file-param: `name: Type`, `name: local Type`
        const p = parseOneParam();
        if (p === null) throw new Error(`Expected scalar param in file-level header`);
        dependencies.push(fileParamFrom(p, false));
        continue;
      } else if (peek().type === 'IDENT') {
        // Positional scalar file-param: `name Type`
        const p = parseOneParam();
        if (p === null) throw new Error(`Expected positional scalar param in file-level header`);
        dependencies.push(fileParamFrom(p, true));
        continue;
      } else {
        path = expect('STRING').value;
        expect('COLON');
      }
      skipNewlines();
      // The binding: a local name (`"thing.bv": Thing #`), one member
      // (`HTML: :div`), or a destructure group (`HTML: (:div, :span)`).
      if (isRetiredParenAlias()) throwRetiredParenAlias(/^\w+$/.test(path) ? path : `"${path}"`);
      if (peek().type === 'IDENT') {
        alias = consume().value;
      } else if (peek().type === 'SIGIL') {
        const name = consume().value;
        destructures = [{ local: name, remote: name }];
      } else if (peek().type === 'LPAREN' && !parenGroupFollowedByArrow(pos)) {
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
        } else {
          throw new Error(`Expected a destructure ('(:name, …)') after '${path}:', got ${peek().type}`);
        }
        expect('RPAREN');
      }
      if (!alias) alias = path;
      // end-of-entry — service reference, interface fetched via options.remotes
      // (check before skipNewlines so the NEWLINE terminator isn't consumed early)
      if (peek().type === 'RPAREN' || peek().type === 'COMMA' || peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') {
        dependencies.push(AST.dependency(alias, { path, destructures }));
        continue;
      }
      skipNewlines(); // # or { must be on the same line; skip remaining whitespace
      // Alias # — actor constructor, manifest fetched via options.remotes
      if (peek().type === 'HASH') {
        consume(); // #
        dependencies.push(AST.dependency(alias, { path, generic: true, destructures }));
        continue;
      }
      if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'LPAREN') {
        throw Object.assign(
          new Error(`'(Alias) *( ... ) -> { ... }' is retired (dependency '${alias}') — write '${alias} ( ... ) -> *{ ... }'`),
          { fatal: true },
        );
      }
      // Alias (p: Type, ...) [->] *{ iface } — explicit constructor + service
      if (peek().type === 'LPAREN') {
        ctorArrow = '->';
        const ctorParams = parseCtorProfileParams(`for dependency '${alias}'`);
        let iface = parseInlineIface();
        iface = parseAsTypeSuffix(iface);
        dependencies.push(AST.dependency(alias, { path, interface: iface, constructorArrow: ctorArrow, constructorParams: ctorParams, destructures }));
        continue;
      }
      // Alias { iface } — service reference with inline interface
      if (peek().type === 'LBRACE') {
        let iface = parseInlineIface();
        iface = parseAsTypeSuffix(iface);
        dependencies.push(AST.dependency(alias, { interface: iface, path, destructures }));
        continue;
      }
      throw new Error(`File-level dependency '${alias}' requires #, { iface }, or (ctor params) -> *{ iface }`);
    }
  }

  // Body after a file-level header. A lineal header (`*\n entries\n *`) may be
  // followed by a lineal body — the rest of the file, parsed by subsequent
  // iterations — or a delimited `{ ... }` body. Both header forms accept the
  // tail form (`return`/`->`). Returns true when the body was consumed here.
  function parseFileHeaderBody(linealHeader) {
    const fileOpenerTok = peek().type;
    if (fileOpenerTok === 'EQUALS') {
      throw new Error(`'=' no longer opens a file-level class body — use a lineal header ('*' alone on a line, entries one per line, closing '*' alone on a line) or a delimited body '{ ... }'`);
    }
    if (fileOpenerTok === 'LBRACE') {
      consume(); // {
      const nested = parseActorBody(() => peek().type === 'RBRACE');
      skipNewlines();
      expect('RBRACE');
      actors.push(AST.actor(null, {
        functions: nested.functions,
        stateVarDecls: nested.stateVarDecls,
        initBody: nested.initBody,
        initParams: nested.initParams,
        constructorBody: nested.constructorBody,
        asClauses: nested.asClauses,
        declarationReturn: nested.declarationReturn,
      }));
      actors.push(...nested.nestedActors);
      skipBlanks();
      if (peek().type !== 'EOF') {
        throw new Error(`unexpected content after file-level class body '{ ... }' — body must be the entire file`);
      }
      return;
    }
    if (fileOpenerTok === '->' || isReturnKw()) {
      // Leave `return`/`->` for parseActorBody to consume as a declaration return.
      const nested = parseActorBody(() => false);
      actors.push(AST.actor(null, {
        functions: nested.functions,
        stateVarDecls: nested.stateVarDecls,
        initBody: nested.initBody,
        initParams: nested.initParams,
        constructorBody: nested.constructorBody,
        asClauses: nested.asClauses,
        declarationReturn: nested.declarationReturn,
      }));
      actors.push(...nested.nestedActors);
      skipBlanks();
      if (peek().type !== 'EOF') {
        throw new Error(`unexpected content after file-level class body '-> expr' — body must be the entire file`);
      }
      return;
    }
    if (linealHeader) return; // lineal body: parsed by subsequent iterations
    throw new Error(`file-level class header requires a body — use '( ... ) *{ ... }' or a lineal header`);
  }

  while (peek().type !== 'EOF') {
    skipBlanks();
    if (peek().type === 'EOF') break;

    if (peek().type === 'DCOLON') {
      types.push(parseTypeDecl());
      continue;
    }

    // ── File-level constructor header — delimited ─────────────────────────
    //   ( "/path": Alias ) *{ body }                  — service ref, fetched externally
    //   ( "/path": Alias { iface } ) *{ body }        — service ref, inline interface
    //   ( "/path": Alias # ) *{ body }                — actor constructor, fetched externally
    //   ( "/path": Alias (p: Type) -> *{ iface } ) *{ body } — inline manifest
    //   ( name: Type ) -> *{ body }                     — optional arrow
    // Told apart from a body statement that starts with `(` by looking ahead
    // past the matching `)` for `[->] *{`.
    if (peek().type === 'LPAREN' && isDelimitedClassStart()) {
      if (headerSeen) {
        throw new Error(`Multiple constructor headers are not allowed — combine all dependencies into a single ( ... ) *{ ... } header`);
      }
      headerSeen = true;
      consume(); // (
      skipNewlines();
      parseFileHeaderEntries(() => peek().type === 'RPAREN');
      expect('RPAREN');
      if (peek().type === '->') consume();
      expect('STAR');
      parseFileHeaderBody(false);
      continue;
    }
    if (peek().type === 'STAR' && tokens[pos + 1]?.type === 'LPAREN') {
      throw new Error(`'*( ... )' file headers are retired — the '*' now marks the body: write '( ... ) *{ ... }' or a lineal header`);
    }

    // ── File-level class header — lineal form ──────────────────────────────
    //   *\n entries\n *\n body        — entries one per line (same entry
    //   *\n entries\n * { body }        grammar as `( ... ) *{`); body is the
    //   *\n body                        rest of the file, `{ ... }`, or the
    //   *\n { body }                    tail form. Each `*` alone on its line
    //                                   (closing `*` may be followed by `{`).
    if (peek().type === 'STAR' && peek().alone) {
      if (headerSeen) {
        throw new Error(`Multiple constructor headers are not allowed — combine all dependencies into a single header`);
      }
      headerSeen = true;
      consume(); // *
      const savedPos = pos;
      const savedDeps = dependencies.length;
      let closed = false;
      try {
        parseFileHeaderEntries(() => isClosingStar(peek()));
        if (isClosingStar(peek())) { consume(); closed = true; }
      } catch (e) {
        if (e.fatal) throw e; // a recognised entry in a retired form
        // not an entry run — no-params form
      }
      if (!closed) {
        pos = savedPos;
        dependencies.length = savedDeps;
      }
      skipBlanks();
      parseFileHeaderBody(true);
      continue;
    }

    // ── File-level class header — no-params delimited form ─────────────────
    //   * { body }
    // Any other non-lone `*` here (e.g. `* = body`) is rejected by
    // parseConstructorAfterStar.
    if (peek().type === 'STAR') {
      if (headerSeen) {
        throw new Error(`Multiple constructor headers are not allowed — combine all dependencies into a single header`);
      }
      headerSeen = true;
      consume(); // *
      const { params, nested } = parseConstructorAfterStar('<file-class>');
      actors.push(AST.actor(null, {
        functions: nested.functions,
        stateVarDecls: nested.stateVarDecls,
        initBody: nested.initBody,
        initParams: params,
        constructorBody: nested.constructorBody,
        asClauses: nested.asClauses,
        declarationReturn: nested.declarationReturn,
      }));
      actors.push(...nested.nestedActors);
      skipBlanks();
      if (peek().type !== 'EOF') {
        throw new Error(`unexpected content after file-level class body — body must be the entire file`);
      }
      continue;
    }

    if (peek().type === 'AT' || peek().type === 'IDENT' || peek().type === 'HASH_IDENT' ||
               peek().type === 'DIVIDER' ||
               peek().type === 'STRING' || peek().type === 'INTERP_STRING' || peek().type === 'NUMBER' ||
               peek().type === 'LPAREN' || peek().type === 'LBRACKET' ||
               (peek().type === 'KEYWORD' && (peek().value === 'untracked' || peek().value === 'self' || peek().value === 'true' || peek().value === 'false'))) {
      // anonymous actor — collect functions and nested actor definitions
      const { functions, nestedActors, stateVarDecls, initBody, initParams, constructorBody, asClauses, declarationReturn } = parseActorBody(
        () => false,
      );
      actors.push(AST.actor(null, { functions, stateVarDecls, initBody, initParams, constructorBody, asClauses, declarationReturn }));
      // Promote nested actor definitions to top-level actors
      actors.push(...nestedActors);
    } else if (!headerSeen && (peek().type === 'EQUALS' || peek().type === 'LBRACE' || peek().type === '->')) {
      // Headerless file-class begins its body directly — no opener token. A
      // leading `=`, `{`, or `->` here is a parse error (those are openers for
      // a header that doesn't exist).
      const tok = peek();
      const shown = tok.type === 'EQUALS' ? '=' : tok.type === 'LBRACE' ? '{' : '->';
      throw new Error(`file actor takes no body opener — remove the leading '${shown}'`);
    } else {
      consume();
    }
  }

  actors.push(...hoistedClasses);
  const result = AST.program(actors, dependencies, types);
  resolveLoneNames(result);
  settleSilentDecls(result);
  settleBangDecls(result);
  settleWrites(result);
  captureReturnedCells(result);
  settleFireAndForget(result);
  return result;

  // A statement `call...` is a fire-and-forget launch: the statement is marked
  // so validation can require a silent callee (and turn a call to one of the
  // actor's own functions into a `spawn`). Anywhere else a `...` call has no
  // value to give.
  function settleFireAndForget(program) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const s of node) {
          if ((s?.type === 'ExprStatement' || s?.type === 'ImplicitReturn') && s.expr?.faf) {
            delete s.expr.faf;
            s.ellipsis = true;
          }
        }
        node.forEach(visit);
        return;
      }
      if (node.faf) throw new Error(`A fire-and-forget call ('...') has no value — use it as a statement`);
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    visit(program.actors);
  }

  // A declaration named with a glued `.` (`sfn.`, `@go.`, `#log.`) is silent:
  // its tail value is discarded and it ends in the silent terminator every
  // backend keys on. `set` / `update` keep their reply-less shape too.
  function settleSilentDecls(program) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.type === 'FunctionDecl' && typeof node.name === 'string' && !node.actorDef && !node.emptyOverload &&
          (node.name.endsWith('.') || node.name === 'set' || node.name === 'update')) {
        silence(node);
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    // An early `return` inside a branch exits like any early return (an empty
    // `Return`, which every backend emits as a guard); the function's own
    // trailing terminator is what keeps it reply-less.
    const earlyExits = (node) => {
      if (!node || typeof node !== 'object' || node.type === 'Function') return;
      if (Array.isArray(node)) {
        node.forEach((s, i) => { if (s?.type === 'SilentTerminator') node[i] = AST.returnNode([]); });
        node.forEach(earlyExits);
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') earlyExits(v);
    };
    const silence = (fn) => {
      const body = fn.body || (fn.body = []);
      for (const s of body) earlyExits(s);
      const last = body[body.length - 1];
      if (last?.type === 'SilentTerminator') return;
      if (last?.type === 'ImplicitReturn') {
        body[body.length - 1] = AST.exprStatement(last.expr);
      } else if (last?.type === 'Reply' || last?.type === 'Return') {
        const f = last.fields || [];
        if (f.length === 1 && f[0].positional && f[0].expr && !f[0].type) {
          body[body.length - 1] = AST.exprStatement(f[0].expr);
        } else if (f.length > 0) {
          throw new Error(`'${fn.name}' is silent — it can't reply with a value`);
        } else {
          body.pop();
        }
      }
      body.push(AST.silentTerminator());
    };
    visit(program.actors);
  }

  // A `!` function writes, and what it yields is a property of each return path:
  // no tail return, falling off the end returns self, `return v` returns v. See
  // notes/mutation-suffix-2026-10-31.md.
  function settleBangDecls(program) {
    // A class named with `!` (`W!`) is constructed by that name, and its actors have the
    // type `W`. So the class's identifier is `W`, and `sourceName` keeps the `!` for docs
    // and effects.
    const bangClasses = new Set(program.actors.map(a => a.name).filter(n => n?.endsWith('!')));
    if (bangClasses.size > 0) {
      const plain = (name) => name.slice(0, -1);
      for (const a of program.actors) {
        if (a.name && bangClasses.has(`${a.name}!`)) throw new Error(`'${a.name}' and '${a.name}!' are both declared — different effects need different names`);
      }
      const rename = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(rename); return; }
        if (node.type === 'Actor' && bangClasses.has(node.name)) {
          node.sourceName = node.name;
          node.name = plain(node.name);
        }
        for (const st of node.type === 'Actor' ? node.supertypes || [] : []) {
          if (bangClasses.has(`${st.supertype}!`)) throw new Error(`'${st.supertype}' is named '${st.supertype}!'`);
          if (bangClasses.has(st.supertype)) {
            st.sourceName = st.supertype;
            st.supertype = plain(st.supertype);
          }
        }
        if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && bangClasses.has(`${node.callee.name}!`)) {
          throw new Error(`'${node.callee.name}' writes while constructing, so call it '${node.callee.name}!'`);
        }
        if (node.type === 'Identifier' && bangClasses.has(node.name)) node.name = plain(node.name);
        for (const v of Object.values(node)) if (v && typeof v === 'object') rename(v);
      };
      rename(program.actors);
    }
    const classNames = new Set(program.actors.map(a => a.name).filter(Boolean));
    const settle = (fn) => { settleWriterBody(fn); };
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      // A self-call mid-body (`@bump(1)`) is a statement: only the last one is a tail.
      if (node.type === 'FunctionDecl' && Array.isArray(node.body)) {
        node.body.forEach((st, i) => {
          if (i < node.body.length - 1 && st?.type === 'ImplicitReturn' && ['FunctionCallExpr', 'DotCallExpr', 'DotAccessExpr'].includes(st.expr?.type)) {
            node.body[i] = AST.exprStatement(st.expr);
          }
        });
      }
      if (node.type === 'FunctionDecl' && typeof node.name === 'string' && node.name.endsWith('!') && !node.actorDef && !node.emptyOverload) {
        settle(node);
      }
      // A `!` function declared in a body follows the same rules.
      if ((node.type === 'Assign' || node.type === 'TypedAssign') && node.name?.endsWith('!') && node.value?.type === 'Function') {
        settle({ name: node.name, body: node.value.body ?? (node.value.body = []) });
      }
      if (node.type === 'FunctionCallExpr' && node.callee?.name?.endsWith('!') && AST.BUILTIN_TYPE_NAMES.has(node.callee.name.slice(0, -1))) {
        throw new Error(`'${node.callee.name}' — a type name takes no '!'`);
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    visit(program.actors);
    lowerSelfChains(program);
    const checkSelfChains = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(checkSelfChains); return; }
      if ((node.type === 'DotCallExpr' || node.type === 'DotAccessExpr') && node.object?.type === 'FunctionCallExpr' && node.object.callee?.name?.endsWith('!')
          && !classNames.has(node.object.callee.name)) {
        throw new Error(`A chain can't start from '${node.object.callee.name}(…)' here: on a function of this actor, it has to be a whole statement or value — bind it first`);
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') checkSelfChains(v);
    };
    checkSelfChains(program.actors);
    checkChainReceivers(program);
  }

  // `return a` names its field, but on a local cell it reads the cell. Backends only
  // capture what a nested function's body reads, and only read what a field's expr says.
  function captureReturnedCells(program) {
    const visit = (node, cells) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, cells)); return; }
      if (node.type === 'FunctionDecl') { visit(node.body, new Set()); return; }
      if (node.type === 'Function') {
        const inner = new Set(cells);
        for (const p of node.params || []) inner.delete(p.name);
        visit(node.body, inner);
        return;
      }
      if (node.type === 'RefDecl') cells.add(node.name);
      else if (node.type === 'Assign' || node.type === 'TypedAssign') cells.delete(node.name);
      if (node.type === 'Return' || node.type === 'Reply') {
        for (const f of node.fields || []) {
          if (!f.expr && !f.spread && cells.has(f.name)) f.expr = { type: 'RefRead', name: f.name };
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, cells);
    };
    visit(program.actors, new Set());
  }

  // Spreads a write chain into one statement per link, in source order. A write
  // used as a value evaluates to its cell, which now holds the new value, so
  // `return a <- x` is `a <- x` then `return a`: the write moves to a statement
  // just before the one using it, and the value reads the cell
  // (notes/mutation-suffix-2026-10-31.md).
  function settleWrites(program) {
    const spread = (stmt) => {
      const chain = stmt.value;
      return [{ ...stmt, value: chain.first }, ...chain.rest.map(r => ({ ...stmt, value: r.value, updateOp: r.updateOp }))];
    };
    let statementIf = null;
    const hasWrite = (node) => !!node && typeof node === 'object' && node.type !== 'Function'
      && (node.type === 'SetExpr' || node.type === 'SetChain' || Object.values(node).some(hasWrite));
    // Replaces each write in a statement's expressions with a read of its cell,
    // collecting the writes in evaluation order. Statement lists inside it, such as
    // `if` branches, and nested functions, are visited on their own, so a write in a
    // branch stays on that branch.
    const hoist = (node, sets) => {
      if (!node || typeof node !== 'object' || node.type === 'Function') return node;
      if (Array.isArray(node)) return node.map(n => hoist(n, sets));
      if (node.type === 'SetChain') throw new Error("A chain of writes used as a value needs a target: write 'a <- b <- c'");
      if (node.type === 'SetExpr') {
        const links = node.value?.type === 'SetChain'
          ? [{ value: node.value.first, updateOp: node.updateOp }, ...node.value.rest]
          : [{ value: node.value, updateOp: node.updateOp }];
        for (const link of links) sets.push(AST.setStatement(node.name, hoist(link.value, sets), { updateOp: link.updateOp }));
        return AST.refRead(node.name);
      }
      // Moving a write out of a part that may not run would make it run.
      if (node.type === 'BinaryExpr' && node.op === '??' && hasWrite(node.right)) {
        throw new Error("'<-' can't be used as a value on the right of '??', which may not run");
      }
      // A one-line branch of an `if` used as a value (`if c -> a <- 1 else -> 0`)
      // holds its value as a lone `return`. With the write ahead of it, it takes
      // the braced form: the write, then the value.
      // Every one-line branch then takes that form, since an `if` gives a value when
      // its branches agree.
      if (node.type === 'IfExpr' && node !== statementIf) {
        const lone = (branch) => {
          const only = branch?.body?.length === 1 ? branch.body[0] : null;
          return only?.type === 'Return' && only.fields?.length === 1 ? only : null;
        };
        const branches = [];
        for (let b = node; b; b = b.else?.type === 'IfExpr' ? b.else : null) branches.push(b.then, ...(b.else?.type === 'IfExpr' ? [] : [b.else]));
        if (branches.some(b => lone(b) && hasWrite(lone(b).fields[0].expr))) {
          for (const branch of branches) {
            const only = lone(branch);
            if (!only) continue;
            const branchSets = [];
            const value = hoist(only.fields[0].expr, branchSets);
            branch.body = [...branchSets, AST.implicitReturn(value)];
          }
        }
      }
      const out = { ...node };
      for (const [k, v] of Object.entries(node)) {
        if (k === 'body' || k === 'then' || k === 'else' || !v || typeof v !== 'object') continue;
        out[k] = hoist(v, sets);
      }
      return out;
    };
    const settleList = (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.value?.type === 'SetChain') list.splice(i, 1, ...spread(list[i]));
      }
      for (let i = 0; i < list.length; i++) {
        if (!hasWrite(list[i])) continue;
        // An `if` that is the whole statement isn't a value: a one-line branch's
        // `return` there leaves the function.
        statementIf = (list[i].type === 'ExprStatement' || list[i].type === 'ImplicitReturn') && list[i].expr?.type === 'IfExpr' ? list[i].expr : null;
        const sets = [];
        const stmt = hoist(list[i], sets);
        // A tail write, `(i) -> a <- i`: a writer drops the read again.
        if (list[i].type === 'ImplicitReturn' && list[i].expr?.type === 'SetExpr') stmt.fromTailWrite = true;
        list.splice(i, 1, ...sets, stmt);
        i += sets.length;
      }
    };
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      for (const [k, v] of Object.entries(node)) {
        if ((k === 'body' || k === 'initBody') && Array.isArray(v)) settleList(v);
        if (v && typeof v === 'object') visit(v);
      }
    };
    visit(program.actors);
  }

  // A type name in scope is reserved: no param may share it. So a lone name
  // after a named param's colon (`key: X`) is the type X when one is in scope,
  // and otherwise the param's local name (untyped). In scope: built-ins, the
  // file's `::` types and classes (coercions included), and every name the
  // header binds.
  function resolveLoneNames(program) {
    const typeNames = new Set(AST.BUILTIN_TYPE_NAMES);
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (node.type === 'TypeDecl' && node.name) typeNames.add(node.name);
      if (node.type === 'Actor' && node.name) typeNames.add(node.name);
      if (node.type === 'ServiceCoercion' && node.name) typeNames.add(node.name);
      if (node.type === 'Dependency') {
        if (node.name) typeNames.add(node.name);
        for (const d of node.destructures || []) if (d.local) typeNames.add(d.local);
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') collect(v);
    };
    collect(program);

    const resolve = (p, owner) => {
      if (!p || typeof p !== 'object') return;
      const typeField = p.type === 'FileParam' ? 'paramType' : 'type';
      if (p.typeOrLocal) {
        delete p.typeOrLocal;
        const lone = p[typeField];
        if (!typeNames.has(lone)) {
          p.key = p.name;
          p.name = lone;
          p[typeField] = p.defaultValue ? inferDefaultType(p.defaultValue) : null;
          checkRenamedUse(p, owner);
          if (!p[typeField] && owner?.type === 'FunctionDecl' && owner.name?.startsWith('@')) {
            throw new Error(`Public function param '${p.key}: ${p.name}' requires a type annotation`);
          }
        }
      }
      if (p.name && typeNames.has(p.name)) {
        throw new Error(`Param '${p.name}' has the name of a type in scope — a type name is reserved; rename the param`);
      }
    };

    // `key: Intger` (a misspelt type) reads as a rename to the local `Intger`.
    // When the body uses `key` and never the local, say so.
    const checkRenamedUse = (p, owner) => {
      if (!owner) return;
      let keyUsed = false, localUsed = false;
      const scan = (node) => {
        if (!node || typeof node !== 'object' || (keyUsed && localUsed)) return;
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (node.type === 'Identifier' && node.name === p.key) keyUsed = true;
        for (const [k, v] of Object.entries(node)) {
          if (v === p.name && k !== 'type') localUsed = true;
          else if (v && typeof v === 'object') scan(v);
        }
      };
      for (const [k, v] of Object.entries(owner)) {
        if (k !== 'params' && k !== 'initParams') scan(v);
      }
      if (keyUsed && !localUsed) {
        throw new Error(`'${p.name}' is not declared or imported, so '${p.key}: ${p.name}' names the param's local '${p.name}' and leaves '${p.key}' unbound. Import the type, or rename the local`);
      }
    };

    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type !== 'EmitDecl') {
        for (const key of ['params', 'initParams']) {
          if (Array.isArray(node[key])) for (const p of node[key]) resolve(p, node);
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
    };
    // Every header key is a path. A keyed entry with no type is resolved by
    // its key — a dependency: `HTML: Html`, `"svc.bv": Svc`, `limit: n`,
    // `limit:`. A typed one is a value supplied at construction.
    const fileActor = program.actors.find(a => !a.name);
    program.dependencies = program.dependencies.map(d => {
      if (d.type !== 'FileParam') return d;
      resolve(d, fileActor);
      if (d.positional || d.paramType || d.accessor) return d;
      typeNames.add(d.name);
      return AST.dependency(d.name, { path: d.key || d.name });
    });
    walk(program.actors);
    walk(program.types);

    // Bodies: a destructure's `key: X`, and types inferred from a call's
    // callee (`c = Counter()`, `@origin = Point(0, 0)`).
    const settle = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(settle); return; }
      if (node.type === 'DestructureAssign') {
        for (const item of node.pattern) {
          if (item.typeOrLocal) {
            delete item.typeOrLocal;
            if (!typeNames.has(item.type)) {
              item.key = item.name;
              item.name = item.type;
              item.type = null;
              delete item.named;
            }
          }
          if (item.name && typeNames.has(item.name)) {
            throw new Error(`Local '${item.name}' has the name of a type in scope — a type name is reserved; rename the local`);
          }
        }
      }
      if (node.typeFromCallee) {
        delete node.typeFromCallee;
        if (!typeNames.has(node.typeName)) {
          if (node.type === 'ImplicitReturn') node.typeName = null;
          else node.typeName = 'Anything';
        }
      }
      if (node.constantCallee) {
        const callee = node.constantCallee;
        delete node.constantCallee;
        if (!typeNames.has(callee)) {
          throw new Error(`'${node.name}' is public — only functions can be public. Use '->', '{', or '(params)' to define a function body, or remove the '@' for a private value.`);
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') settle(v);
    };
    settle(program.actors);

    // Signatures with no body (a dependency's constructor profile, an emit
    // declaration) name no locals: a lone name there is the type.
    const clear = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(clear); return; }
      delete node.typeOrLocal;
      for (const v of Object.values(node)) if (v && typeof v === 'object') clear(v);
    };
    clear(program);
  }
}
