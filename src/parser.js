export function parse(tokens) {
  let pos = 0;
  const functionNames = new Set();
  const localScopes = [new Set()];
  const callableSignatures = new Map();
  const callableParamSlots = new Map();
  const isCallableType = t => t === 'Callable' || (typeof t === 'string' && t.includes('->'));

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const skipNewlines = () => { while (peek().type === 'NEWLINE') consume(); };
  const skipBlanks = () => { while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume(); };
  const currentScope = () => localScopes[localScopes.length - 1];
  const declareLocal = (name) => { if (name) currentScope().add(name); };
  const isKnownLocal = (name) => localScopes.some(scope => scope.has(name));
  const isTypeAnnotation = (offset = 0) =>
    tokens[pos + offset]?.type === 'COLON' &&
    tokens[pos + offset + 1]?.type === 'IDENT' &&
    /^[A-Z]/.test(tokens[pos + offset + 1]?.value ?? '');

  const makeNumLiteral = (tok) => {
    if (tok.numKind === 'Decimal') return { type: 'DecimalLiteral', value: tok.value };
    if (tok.numKind === 'Float')   return { type: 'FloatLiteral',   value: tok.value };
    return { type: 'IntLiteral', value: tok.value };
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
    ['Boolean','Booleans'],['List','Lists'],
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
    // | null suffix
    const after = offset + len;
    if (tokens[after]?.type === 'PIPE' &&
        tokens[after+1]?.type === 'KEYWORD' && tokens[after+1]?.value === 'null') {
      len += 2;
    }
    return len;
  }

  function parseType(inOf = false) {
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
    let result;
    if (typeName === 'List' && !(peek().type === 'KEYWORD' && peek().value === 'of')) {
      result = 'List of Anything'; // bare List = List of Anything (mixed elements)
    } else if (peek().type === 'KEYWORD' && peek().value === 'of') {
      consume(); // 'of'
      result = `${typeName} of ${parseType(true)}`;
    } else {
      result = typeName;
    }
    // | null suffix — only at top level (not inside 'of')
    if (!inOf && peek().type === 'PIPE' &&
        tokens[pos+1]?.type === 'KEYWORD' && tokens[pos+1]?.value === 'null') {
      consume(); // |
      consume(); // null
      return `${result} | null`;
    }
    return result;
  }

  function parseParenType() {
    // Either a callable signature type: (..)->(..)
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
      return callableTypeToString(parseCallableType());
    }
    return parseStructureType();
  }

  function parseStructureType() {
    expect('LPAREN');
    const fields = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const name = consume().value;
        consume(); // COLON
        const t = parseType();
        fields.push(`${name}: ${t}`);
      } else if (peek().type === 'IDENT') {
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
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ positional: true, expr: makeNumLiteral(numTok), type: typeName });
      } else if (peek().type === 'STRING') {
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ key, expr, type: typeName });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        args.push({ positional: true, expr: { type: 'Identifier', name }, type: null });
      } else {
        consume(); // skip unknown
      }
    }
    expect('RPAREN');
    return { type: 'StructureConstructor', args };
  }

  function parseCallableType() {
    expect('LPAREN');
    const inputs = [];
    while (peek().type !== 'RPAREN') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT') {
        const name = peek().value;
        if (tokens[pos + 1]?.type === 'COLON') {
          consume(); // name
          consume(); // :
          const type = parseType();
          inputs.push({ name, type });
        } else {
          const type = parseType();
          inputs.push({ type });
        }
      } else {
        throw new Error('Expected identifier or type in callable input');
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
          consume(); // name
          consume(); // :
          const type = parseType();
          outputs.push({ name, type });
        } else {
          const type = parseType();
          outputs.push({ type });
        }
      } else {
        throw new Error('Expected identifier or type in callable output');
      }
    }
    expect('RPAREN');
    return { type: 'CallableType', inputs, outputs };
  }

  function callableTypeToString(callableType) {
    const fmtSide = (items) => items.map(item => {
      if (item.name !== undefined) return `${item.name}: ${item.type}`;
      return `${item.type}`;
    }).join(', ');
    return `(${fmtSide(callableType.inputs)}) -> (${fmtSide(callableType.outputs)})`;
  }

  function getFunctionLiteralSignature(fnNode) {
    if (fnNode.type !== 'Function') return null;
    if (fnNode.returnType == null) {
      throw new Error('Callable signature requires explicit return annotation');
    }
    const inputs = fnNode.params.map(p => {
      if (p.type == null) throw new Error('Callable signature requires typed parameters');
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

  function checkCallableSignature(callableSig, rhsExpr) {
    if (rhsExpr.type === 'Function') {
      const rhsSig = getFunctionLiteralSignature(rhsExpr);
      if (rhsSig !== callableSig) {
        throw new Error(`Callable signature mismatch: expected ${callableSig}, got ${rhsSig}`);
      }
      return;
    }
    if (rhsExpr.type === 'Identifier') {
      const rhsSig = callableSignatures.get(rhsExpr.name) ?? null;
      if (rhsSig === null) {
        throw new Error(`Callable signature mismatch: '${rhsExpr.name}' is not a typed callable`);
      }
      if (rhsSig !== callableSig) {
        throw new Error(`Callable signature mismatch: expected ${callableSig}, got ${rhsSig}`);
      }
      return;
    }
    if (rhsExpr.type === 'FnRef') {
      const rhsSig = callableSignatures.get(rhsExpr.name) ?? null;
      if (rhsSig === null) return; // unknown — trust it
      if (rhsSig !== callableSig) {
        throw new Error(`Callable signature mismatch: expected ${callableSig}, got ${rhsSig}`);
      }
      return;
    }
    if (rhsExpr.type === 'ProcRef') return; // proc references not compile-time sig-checked
    throw new Error('Callable signature mismatch');
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
      if (tokens[lookPos]?.type !== 'LPAREN' || !isFunctionStart(lookPos)) break;
      if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
      blocks.push(parseFunction());
    }
    if (blocks.length === 0) return;
    const last = args[args.length - 1];
    if (last?.type === 'NamedArgsBag') {
      args.splice(args.length - 1, 0, ...blocks);
    } else {
      args.push(...blocks);
    }
  }

  function checkCallableArgs(args, calleeName) {
    const slots = callableParamSlots.get(calleeName);
    if (!slots) return;
    const positional = args.filter(a => a.type !== 'NamedArgsBag');
    const namedBag = args.find(a => a.type === 'NamedArgsBag');
    for (const slot of slots) {
      const arg = typeof slot === 'number' ? positional[slot] : namedBag?.fields[slot];
      if (arg?.type === 'Identifier') {
        throw new Error(`'${calleeName}' parameter '${slot}' is callable — use &${arg.name} to pass by reference`);
      }
    }
  }

  function parseProcCall(name) {
    const args = parseCallArgs();
    appendTrailingBlocks(args, true);
    checkCallableArgs(args, name);
    return { type: 'ProcCallExpr', name, args };
  }

  function parseCallArgs() {
    expect('LPAREN');
    const args = [];
    const namedArgs = {};
    let hasNamed = false;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume();
        namedArgs[key] = parseExpr();
        hasNamed = true;
      } else {
        args.push(parseExpr());
      }
    }
    expect('RPAREN');
    if (hasNamed) args.push({ type: 'NamedArgsBag', fields: namedArgs });
    return args;
  }

  function isFunctionStart(startPos) {
    // Checks if the LPAREN at startPos (default: current pos) is a function literal start
    const p = startPos !== undefined ? startPos : pos;
    let depth = 0;
    let i = p;
    while (i < tokens.length) {
      if (tokens[i].type === 'LPAREN') depth++;
      else if (tokens[i].type === 'RPAREN') { depth--; if (depth === 0) break; }
      i++;
    }
    const after = tokens[i + 1];
    return after && (
      after.type === 'LBRACE' ||
      after.type === 'IDENT' ||
      after.type === 'NUMBER' ||
      after.type === 'STRING'
    );
  }

  function parseFunctionParams() {
    expect('LPAREN');
    const params = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'SIGIL') {
        const name = consume().value;
        let type = null;
        if (peek().type === 'COLON') { consume(); type = parseType(); }
        params.push({ name, type, positional: false }); // named
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const first = consume().value;
        consume(); // COLON
        if ((peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) || peek().type === 'LPAREN') {
          // positional: a : Type  or  a : (X) -> (Y)
          params.push({ name: first, type: parseType(), positional: true });
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
          // key-mapped: outer: inner : Type
          const localName = consume().value;
          consume(); // COLON
          params.push({ key: first, name: localName, type: parseType() });
        } else if (peek().type === 'IDENT') {
          // key-mapped without type: outer: inner
          params.push({ key: first, name: consume().value, type: null });
        } else {
          break;
        }
      } else if (peek().type === 'IDENT') {
        params.push({ name: consume().value, type: null, positional: true });
      } else {
        break;
      }
    }
    expect('RPAREN');
    return params;
  }

  function parseFunctionBody() {
    const body = [];
    while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'RBRACE' || peek().type === 'EOF') break;
      if (peek().type === 'KEYWORD' && peek().value === 'return') {
        consume(); // 'return'
        body.push({ type: 'Return', fields: parseReplyFields(true) });
      } else if (isTypedAssignStart()) {
        parseTypedAssign(body);
      } else if (isBareTypeDeclStart()) {
        const name = consume().value;
        consume(); // COLON
        const typeName = parseType();
        declareLocal(name);
        body.push({ type: 'BareTypeDecl', name, typeName });
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
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') {
          functionNames.add(name);
          const slots = new Set();
          value.params.forEach((p, i) => {
            if (isCallableType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
          });
          if (slots.size > 0) callableParamSlots.set(name, slots);
        }
        declareLocal(name);
        if (value.type === 'TypedValue') {
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAnnotation()) {
          consume(); typeName = parseType();
        }
        body.push({ type: 'ImplicitReturn', expr, typeName });
      }
    }
    return body;
  }

  function parseFunction() {
    localScopes.push(new Set());
    const params = parseFunctionParams();
    for (const p of params) declareLocal(p.name);
    let returnType = null;
    if (peek().type === 'LBRACE') {
      consume(); // {
      const body = parseFunctionBody();
      expect('RBRACE');
      if (peek().type === 'COLON') {
        consume();
        returnType = parseType();
      }
      localScopes.pop();
      return { type: 'Function', params, body, returnType };
    }
    const expr = parseExpr(); // single-expr form, to EOL
    if (peek().type === 'COLON') {
      consume();
      returnType = parseType();
    }
    localScopes.pop();
    return { type: 'Function', params, expr, returnType };
  }

  function parseIfBranch() {
    if (peek().type === 'LBRACE') {
      consume(); // {
      skipNewlines();
      const body = parseFunctionBody();
      expect('RBRACE');
      return { type: 'IfBranch', body };
    }
    const expr = parseExpr();
    let typeName = null;
    if (isTypeAnnotation()) {
      consume(); typeName = parseType();
    }
    return { type: 'IfBranch', expr, typeName };
  }

  function parseIfExpr() {
    const cond = parseExpr();
    // Consume optional type annotation on the condition (e.g. `if 0 : Integer ...`)
    if (isTypeAnnotation()) {
      consume(); parseType();
    }
    const thenBranch = parseIfBranch();

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

    return { type: 'IfExpr', cond, then: thenBranch, else: elseBranch };
  }

  function requireCallableRef(fn, opName = 'over') {
    if (fn?.type === 'Identifier') {
      throw new Error(`'${opName}' requires a callable reference — use &${fn.name}`);
    }
  }

  function parseFoldExpr() {
    if (peek().type === 'LPAREN') {
      // Dense form: fold(args...) [trailing-block]
      const args = parseCallArgs();
      appendTrailingBlocks(args, false);
      // Disambiguate by arg count:
      //   3 args          → initial, collection, fn
      //   2 args+trailing → initial, collection, fn=trailing (already in args)
      //   2 args          → collection, fn (no initial)
      //   1 arg+trailing  → collection, fn=trailing (already in args)
      if (args.length === 3) {
        requireCallableRef(args[2], 'fold');
        return { type: 'FoldExpr', initial: args[0], collection: args[1], fn: args[2] };
      } else if (args.length === 2) {
        requireCallableRef(args[1], 'fold');
        return { type: 'FoldExpr', initial: null, collection: args[0], fn: args[1] };
      } else {
        throw new Error("'fold' requires at least a collection and a function");
      }
    } else {
      // Spacious form: fold [initial,] collection[,] fn
      // Parse first expression with IDENT+fn-start disambiguation
      let expr1;
      if (peek().type === 'IDENT' && tokens[pos+1]?.type === 'LPAREN' && isFunctionStart(pos+1)) {
        expr1 = { type: 'Identifier', name: consume().value };
      } else {
        expr1 = parseExpr();
      }
      if (peek().type !== 'COMMA') {
        // fold collection (fn) — trailing block only
        const trailingArgs = [];
        appendTrailingBlocks(trailingArgs, false);
        if (trailingArgs.length === 0) throw new Error("'fold' requires a function argument");
        requireCallableRef(trailingArgs[0], 'fold');
        return { type: 'FoldExpr', initial: null, collection: expr1, fn: trailingArgs[0] };
      }
      expect('COMMA');
      // Have a comma — check if there's a second comma (3-arg form with explicit fn ref)
      let expr2;
      if (peek().type === 'IDENT' && tokens[pos+1]?.type === 'LPAREN' && isFunctionStart(pos+1)) {
        expr2 = { type: 'Identifier', name: consume().value };
      } else {
        expr2 = parseExpr();
      }
      if (peek().type === 'COMMA') {
        // fold initial, collection, &fn
        expect('COMMA');
        const fn = parsePrimary();
        requireCallableRef(fn, 'fold');
        return { type: 'FoldExpr', initial: expr1, collection: expr2, fn };
      }
      // fold initial, collection (fn) OR fold collection, &fn
      const trailingArgs = [];
      appendTrailingBlocks(trailingArgs, false);
      if (trailingArgs.length > 0) {
        // fold initial, collection (fn)
        requireCallableRef(trailingArgs[0], 'fold');
        return { type: 'FoldExpr', initial: expr1, collection: expr2, fn: trailingArgs[0] };
      }
      // No trailing block after second expr — must be: fold collection, &fn
      // expr1 = collection, expr2 = fn (already consumed)
      requireCallableRef(expr2, 'fold');
      return { type: 'FoldExpr', initial: null, collection: expr1, fn: expr2 };
    }
  }

  function parseOverExpr() {
    if (peek().type === 'LPAREN') {
      // Dense form: over(collection, fn) or over(collection) trailing-block
      const args = parseCallArgs();
      appendTrailingBlocks(args, false);
      requireCallableRef(args[1]);
      return { type: 'OverExpr', collection: args[0], fn: args[1] };
    } else {
      // Spacious form: over collection, fn
      const collection = parseExpr();
      expect('COMMA');
      const fn = parsePrimary();
      requireCallableRef(fn);
      return { type: 'OverExpr', collection, fn };
    }
  }

  function parsePrimary() {
    // Function: (params) { body } or (params) expr
    if (peek().type === 'LPAREN' && isFunctionStart()) {
      return parseFunction();
    }

    if (peek().type === 'IDENT' && peek().value === 'Structure' && tokens[pos + 1]?.type === 'LPAREN') {
      const tok = consume();
      return parseStructureConstructor(tok.value);
    }

    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN' && !functionNames.has(tokens[pos].value) && !isKnownLocal(tokens[pos].value)) {
      const name = consume().value;
      return parseProcCall(name);
    }

    const tok = consume();
    let result;
    if (tok.type === 'LPAREN') {
      // Grouped expression
      const inner = parseExpr();
      expect('RPAREN');
      result = inner;
    } else if (tok.type === 'IDENT') {
      result = { type: 'Identifier', name: tok.value };
    } else if (tok.type === 'NUMBER') {
      result = makeNumLiteral(tok);
    } else if (tok.type === 'STRING') {
      result = { type: 'StringLiteral', value: tok.value };
    } else if (tok.type === 'LBRACKET') {
      const elements = [];
      while (peek().type !== 'RBRACKET' && peek().type !== 'EOF') {
        if (peek().type === 'COMMA') { consume(); continue; }
        elements.push(parseExpr());
      }
      expect('RBRACKET');
      result = { type: 'ListLiteral', elements };
    } else if (tok.type === 'KEYWORD' && tok.value === 'null') {
      result = { type: 'NullLiteral' };
    } else if (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false')) {
      result = { type: 'BoolLiteral', value: tok.value === 'true' };
    } else if (tok.type === 'KEYWORD' && tok.value === 'if') {
      result = parseIfExpr();
    } else if (tok.type === 'KEYWORD' && tok.value === 'over') {
      result = parseOverExpr();
    } else if (tok.type === 'KEYWORD' && tok.value === 'fold') {
      result = parseFoldExpr();
    } else if (tok.type === 'AMPERSAND_IDENT') {
      // &name: local function variable → FnRef; proc name → ProcRef wrapper
      result = (isKnownLocal(tok.value) || functionNames.has(tok.value))
        ? { type: 'FnRef', name: tok.value }
        : { type: 'ProcRef', name: tok.value };
    } else {
      throw new Error(`Unexpected token in expression: ${tok.type} '${tok.value}'`);
    }
    while (peek().type === 'LPAREN') {
      const args = parseCallArgs();
      appendTrailingBlocks(args, false);
      if (result.type === 'Identifier') checkCallableArgs(args, result.name);
      result = { type: 'FunctionCallExpr', callee: result, args };
    }
    // Subscript: expr[0] or expr["key"]
    while (peek().type === 'LBRACKET') {
      consume(); // [
      const keyTok = consume();
      expect('RBRACKET');
      if (keyTok.type === 'NUMBER') {
        result = { type: 'IndexExpr', object: result, index: keyTok.value, key: null };
      } else if (keyTok.type === 'STRING') {
        result = { type: 'IndexExpr', object: result, index: null, key: keyTok.value };
      }
    }
    return result;
  }

  const CMP_OPS = new Map([
    ['EQ','==='],['NEQ','!=='],['GT','>'],['LT','<'],['GTE','>='],['LTE','<='],
  ]);

  function parseMulExpr() {
    let left = parsePrimary();
    while (['STAR', 'SLASH'].includes(peek().type)) {
      const op = consume().value;
      left = { type: 'BinaryExpr', op, left, right: parsePrimary() };
    }
    return left;
  }

  function parseAddExpr() {
    let left = parseMulExpr();
    while (['PLUS', 'MINUS'].includes(peek().type)) {
      const op = consume().value;
      left = { type: 'BinaryExpr', op, left, right: parseMulExpr() };
    }
    return left;
  }

  function parseExpr() {
    let left = parseAddExpr();
    if (CMP_OPS.has(peek().type)) {
      const tok = consume();
      left = { type: 'BinaryExpr', op: CMP_OPS.get(tok.type), left, right: parseAddExpr() };
    }
    return left;
  }

  function parseSigilWithType() {
    const name = consume().value; // SIGIL
    let typeName = null;
    if (peek().type === 'COLON') {
      consume();
      typeName = parseType();
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
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        fields.push({ expr: makeNumLiteral(numTok), type: typeName, positional: true });
      } else if (peek().type === 'SIGIL') {
        const { name, type: fieldType } = parseSigilWithType();
        fields.push({ sigil: name, type: fieldType });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        if (peek().type === 'COLON') {
          consume();
          if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
            // positional: name : Type (uppercase type distinguishes from key-value)
            fields.push({ name, type: parseType(), positional: true });
          } else {
            // key-value: key: expr [: Type]
            const value = parseExpr();
            let fieldType = null;
            if (peek().type === 'COLON') { consume(); fieldType = parseType(); }
            fields.push({ key: name, value, type: fieldType });
          }
        } else {
          // bare positional: variable ref, function call, or binary expression with optional type
          let exprNode = { type: 'Identifier', name };
          while (peek().type === 'LPAREN') {
            const args = parseCallArgs();
            exprNode = { type: 'FunctionCallExpr', callee: exprNode, args };
          }
          while (['PLUS', 'MINUS', 'STAR', 'SLASH'].includes(peek().type)) {
            const op = consume().value;
            exprNode = { type: 'BinaryExpr', op, left: exprNode, right: parsePrimary() };
          }
          let typeName = null;
          if (isTypeAnnotation()) {
            consume(); typeName = parseType();
          }
          if (exprNode.type === 'Identifier' && typeName === null) {
            fields.push({ name, positional: true });
          } else {
            fields.push({ expr: exprNode, type: typeName, positional: true });
          }
        }
      } else if (peek().type === 'ELLIPSIS') {
        consume();
        const name = expect('IDENT').value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        fields.push({ spread: true, name, type: typeName });
      } else {
        break;
      }
    }
    // Open-style reply must be terminated by blank line, empty --, //, or EOF
    if (!sameLine && !hasParen) {
      const t = peek().type;
      if (t !== 'BLOCK_SEP' && t !== 'DIVIDER' && t !== 'EOF') {
        throw new Error(`Open-style reply must be terminated by blank line, empty -- or //, or EOF; got ${t} '${peek().value || ''}'`);
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
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        pattern.push({ named: true, name, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const first = consume().value;
        consume(); // COLON
        if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
          // typed positional: a : Type
          pattern.push({ positional: true, name: first, idx: positionalIdx++, type: parseType() });
        } else if (peek().type === 'IDENT') {
          // key-mapped: key: local [: Type]
          const localName = consume().value;
          let typeName = null;
          if (peek().type === 'COLON') { consume(); typeName = parseType(); }
          pattern.push({ key: first, name: localName, type: typeName });
        } else {
          break;
        }
      } else if (peek().type === 'DISCARD') {
        consume(); // _
        pattern.push({ discard: true, idx: positionalIdx++ });
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
    if (peek().type === 'NUMBER' || peek().type === 'STRING' ||
        (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON')) {
      source = parseInlineStructure();
    } else {
      source = parseExpr(); // identifier or proc call
    }

    return { type: 'DestructureAssign', pattern, source };
  }

  function parseInlineStructure() {
    // Parses `1 : Integer, 2 : Integer` or `key: "v" : Text, ...` into a StructureConstructor node
    const args = [];
    while (true) {
      if (peek().type === 'NUMBER') {
        const numTok = consume();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ positional: true, expr: makeNumLiteral(numTok), type: typeName });
      } else if (peek().type === 'STRING') {
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ key, expr, type: typeName });
      } else {
        break;
      }
      if (peek().type === 'COMMA') { consume(); } else { break; }
    }
    return { type: 'StructureConstructor', args };
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
          if (peek().type === 'COLON') { consume(); type = parseType(); }
          pattern.push({ rest: true, name, type });
        }
      } else if (peek().type === 'DISCARD') {
        consume(); pattern.push({ discard: true });
      } else {
        const name = consume().value;
        let type = null;
        if (peek().type === 'COLON') { consume(); type = parseType(); }
        pattern.push({ name, type });
      }
    }
    expect('RBRACKET');
    expect('EQUALS');
    return { type: 'ListDestructure', pattern, source: parseExpr() };
  }

  function isDestructureStart() {
    const t0 = peek().type;
    const t1 = tokens[pos + 1]?.type;
    const t2 = tokens[pos + 2]?.type;
    const t3 = tokens[pos + 3]?.type;
    if (t0 === 'LBRACKET') return true;
    if (t0 === 'SIGIL') return true;
    if (t0 === 'LPAREN') return !isFunctionStart(pos);
    if (t0 === 'DISCARD') return true;
    if (t0 === 'IDENT' && t1 === 'COMMA') return true;
    // key-mapped: `key: local = expr` — local must be lowercase (uppercase = typed assignment)
    if (t0 === 'IDENT' && t1 === 'COLON' && t2 === 'IDENT' && t3 === 'EQUALS')
      return /^[a-z]/.test(tokens[pos + 2]?.value ?? '');
    // key-mapped with type: `key: local : Type = ...`
    if (t0 === 'IDENT' && t1 === 'COLON' &&
        t2 === 'IDENT' && /^[a-z]/.test(tokens[pos + 2]?.value ?? '') &&
        t3 === 'COLON')
      return true;
    // typed positional as first of multi-item: `a : Type, ...`
    // (single `a : Type = expr` is caught first by isTypedAssignStart)
    if (t0 === 'IDENT' && isTypeAnnotation(1)) {
      if (tokens[pos + 2 + typeLength(pos+2)]?.type === 'COMMA') return true;
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
    // Check for type annotation (uppercase IDENT after COLON)
    let firstType = null;
    if (isTypeAnnotation()) {
      consume(); firstType = parseType();
    }
    // Check for key-value: IDENT was the key, COLON follows (non-type)
    if (peek().type === 'COLON' && value.type === 'Identifier' && firstType === null) {
      consume(); // COLON
      const kvExpr = parseExpr();
      let kvType = null;
      if (isTypeAnnotation()) {
        consume(); kvType = parseType();
      }
      const firstElem = { key: value.name, expr: kvExpr, type: kvType };
      if (peek().type === 'COMMA') {
        consume(); // COMMA
        return parseRHSStructureLiteral(firstElem);
      }
      // Single key-value → 1-element named structure
      return { type: 'StructureLiteral', args: [firstElem] };
    }
    // Check for COMMA → structure literal
    if (peek().type === 'COMMA') {
      const firstElem = { positional: true, expr: value, type: firstType };
      consume(); // COMMA
      return parseRHSStructureLiteral(firstElem);
    }
    // Single typed value with no comma: promote to TypedValue for caller to emit TypedAssign
    if (firstType !== null) {
      return { type: 'TypedValue', expr: value, typeName: firstType };
    }
    return value;
  }

  function parseRHSStructureElem() {
    if (peek().type === 'SIGIL') {
      const name = consume().value;
      // :name → named field, var name = key name
      return { key: name, expr: { type: 'Identifier', name }, type: null };
    }
    if (peek().type === 'NUMBER') {
      const numTok = consume();
      let typeName = null;
      if (isTypeAnnotation()) {
        consume(); typeName = parseType();
      }
      return { positional: true, expr: makeNumLiteral(numTok), type: typeName };
    }
    if (peek().type === 'STRING') {
      const val = consume().value;
      let typeName = null;
      if (isTypeAnnotation()) {
        consume(); typeName = parseType();
      }
      return { positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName };
    }
    // IDENT COLON uppercase → positional typed variable (a : Type)
    if (peek().type === 'IDENT' && isTypeAnnotation(1)) {
      const name = consume().value;
      consume(); // COLON
      return { positional: true, expr: { type: 'Identifier', name }, type: parseType() };
    }
    // IDENT COLON → key-value (k: expr [: Type])
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      const key = consume().value;
      consume(); // COLON
      const expr = parseExpr();
      let typeName = null;
      if (isTypeAnnotation()) {
        consume(); typeName = parseType();
      }
      return { key, expr, type: typeName };
    }
    // bare IDENT → positional untyped
    if (peek().type === 'IDENT') {
      const name = consume().value;
      return { positional: true, expr: { type: 'Identifier', name }, type: null };
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
    return { type: 'StructureLiteral', args };
  }

  function parseTypedAssign(body) {
    // name : Type = expr — typed assignment (uppercase Type distinguishes from key-mapped destructure)
    const name = consume().value;
    consume(); // COLON
    const typeName = parseType();
    consume(); // EQUALS
    declareLocal(name);
    let value;
    // For Structure type, check if RHS starts with sigil
    if (typeName === 'Structure' && peek().type === 'SIGIL') {
      value = parseRHSStructureLiteral(null);
    } else {
      value = parseExpr();
      if (typeName === 'Structure') {
        // Check for type annotation after value (wraps in single-element StructureLiteral)
        let firstType = null;
        if (isTypeAnnotation()) {
          consume(); firstType = consume().value;
        }
        if (peek().type === 'COMMA') {
          const firstElem = { positional: true, expr: value, type: firstType };
          consume(); // COMMA
          value = parseRHSStructureLiteral(firstElem);
        } else if (firstType !== null) {
          // Single typed value → 1-element StructureLiteral
          value = { type: 'StructureLiteral', args: [{ positional: true, expr: value, type: firstType }] };
        }
      } else {
        // Non-Structure: consume optional RHS type annotation and check for conflict
        if (isTypeAnnotation()) {
          consume(); // COLON
          const rhsType = parseType();
          // Allow: lhs 'T | null' with rhs 'T' (non-null value assigned to nullable var)
          const baseType = typeName.endsWith(' | null') ? typeName.slice(0, -7) : null;
          if (rhsType !== typeName && rhsType !== baseType) {
            throw new Error(`Conflicting type declarations for '${name}': '${typeName}' vs '${rhsType}'`);
          }
        }
      }
    }
    // Compile error: if without else assigned to non-nullable type
    if (value.type === 'IfExpr' && value.else === null) {
      if (!typeName.endsWith(' | null')) {
        throw new Error(
          `if without else can return null — use '${typeName} | null' or add an else branch`
        );
      }
    }
    if (typeof typeName === 'string' && typeName.includes('->')) {
      checkCallableSignature(typeName, value);
    }
    if (value.type === 'Function' && typeName !== 'Callable') {
      const sig = getFunctionLiteralSignature(value);
      callableSignatures.set(name, sig);
    }
    body.push({ type: 'TypedAssign', name, typeName, value });
  }

  function isTypedAssignStart() {
    if (peek().type !== 'IDENT') return false;
    if (tokens[pos+1]?.type !== 'COLON') return false;
    const ts = pos + 2;
    if (tokens[ts]?.type === 'LPAREN') {
      // Callable type: name : (..)->(..) = ...
      // Find the token after the callable type and ensure it's '='
      let i = ts;
      let depth = 0;
      while (i < tokens.length) {
        if (tokens[i].type === 'LPAREN') depth++;
        else if (tokens[i].type === 'RPAREN') {
          depth--;
          // Callable type has two paren groups separated by '->'
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
    if (tokens[ts]?.type !== 'IDENT' || !/^[A-Z]/.test(tokens[ts]?.value ?? '')) return false;
    return tokens[ts + typeLength(ts)]?.type === 'EQUALS';
  }

  function isBareTypeDeclStart() {
    if (peek().type !== 'IDENT') return false;
    if (tokens[pos+1]?.type !== 'COLON') return false;
    const ts = pos + 2;
    if (tokens[ts]?.type !== 'IDENT' || !/^[A-Z]/.test(tokens[ts]?.value ?? '')) return false;
    const after = tokens[ts + typeLength(ts)]?.type;
    return after !== 'EQUALS' && after !== 'COMMA';
  }

  function isParamStart() {
    const t = peek().type;
    if (t === 'SIGIL') return true;
    if (t === 'ELLIPSIS') return true;
    if (t === 'IDENT' && tokens[pos + 1]?.type === 'COLON') return true;
    return false;
  }

  function parseOneParam() {
    if (peek().type === 'SIGIL') {
      const { name, type: typeName } = parseSigilWithType();
      if (typeName === null) {
        throw new Error(`Handler param ':${name}' requires a type annotation (e.g. :${name} : SomeType)`);
      }
      return { name, type: typeName };
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      const first = consume().value;
      consume(); // COLON
      if ((peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) || peek().type === 'LPAREN') {
        return { name: first, type: parseType(), positional: true };
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const localName = consume().value;
        consume(); // COLON
        return { key: first, name: localName, type: parseType() };
      }
      return null;
    } else if (peek().type === 'ELLIPSIS') {
      consume();
      const name = expect('IDENT').value;
      let typeName = null;
      if (peek().type === 'COLON') { consume(); typeName = parseType(); }
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

    // ── Mode 3: open style (NEWLINE immediately after name) ───────────────
    if (peek().type === 'NEWLINE') {
      consume(); // consume the single newline
      if (peek().type === 'BLOCK_SEP') return []; // blank line → no params
      if (peek().type === 'EOF') return [];
      if (peek().type === 'DIVIDER') { consume(); return []; }
      if (!isParamStart()) {
        throw new Error(`Expected blank line or param after handler name, got ${peek().type} '${peek().value || ''}'`);
      }
      const params = [];
      while (true) {
        if (peek().type === 'BLOCK_SEP') break;
        if (peek().type === 'DIVIDER') { consume(); break; }
        if (peek().type === 'EOF') throw new Error('Unexpected EOF in open-style param list');
        if (peek().type === 'NEWLINE') { consume(); continue; }
        if (peek().type === 'COMMA') { consume(); continue; }
        if (isParamStart()) {
          const p = parseOneParam();
          if (p !== null) { params.push(p); continue; }
        }
        throw new Error(`Open-style param list must be terminated by blank line or empty -- or //; got ${peek().type} '${peek().value || ''}'`);
      }
      return params;
    }

    // ── Mode 4: BLOCK_SEP or anything else → no params ────────────────────
    return [];
  }

  function parseBody() {
    localScopes.push(new Set());
    skipNewlines();
    if (peek().type === 'BLOCK_SEP') consume();

    const body = [];
    while (peek().type !== 'BLOCK_SEP' && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'BLOCK_SEP' || peek().type === 'EOF') break;

      if (peek().type === 'KEYWORD' && peek().value === 'end') {
        consume();
        break;
      }

      if (peek().type === 'KEYWORD' && peek().value === 'reply') {
        consume();
        const openForm = peek().type === 'NEWLINE';
        if (openForm) skipNewlines();
        body.push({ type: 'Reply', fields: parseReplyFields(!openForm) });
        break;
      }

      if (isTypedAssignStart()) {
        parseTypedAssign(body);
      } else if (isBareTypeDeclStart()) {
        const name = consume().value;
        consume(); // COLON
        const typeName = parseType();
        declareLocal(name);
        body.push({ type: 'BareTypeDecl', name, typeName });
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
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') {
          functionNames.add(name);
          const slots = new Set();
          value.params.forEach((p, i) => {
            if (isCallableType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
          });
          if (slots.size > 0) callableParamSlots.set(name, slots);
        }
        declareLocal(name);
        if (value.type === 'TypedValue') {
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else if (peek().type === 'KEYWORD' && peek().value === 'fold') {
        throw new Error("'fold' must be assigned to a variable — use 'result : Type = fold ...'");
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator — visual separator, no semantic weight
      } else {
        throw new Error(`Unexpected token in handler body: ${peek().type} '${peek().value || ''}'`);
      }
    }
    localScopes.pop();
    return body;
  }

  function parseHandler() {
    consume(); // 'on'
    const opTok = consume();
    if (opTok.type !== 'IDENT' && opTok.type !== 'KEYWORD') {
      throw new Error(`Expected op name, got ${opTok.type} '${opTok.value}'`);
    }
    const op = opTok.value;
    const params = parseParams();
    const body = parseBody();
    return { type: 'Handler', op, params, body };
  }

  function parseProc() {
    consume(); // 'proc'
    const opTok = consume();
    if (opTok.type !== 'IDENT' && opTok.type !== 'KEYWORD') {
      throw new Error(`Expected proc name, got ${opTok.type} '${opTok.value}'`);
    }
    const op = opTok.value;
    const params = parseParams();
    const slots = new Set();
    params.forEach((p, i) => {
      if (isCallableType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
    });
    if (slots.size > 0) callableParamSlots.set(op, slots);
    localScopes.push(new Set());
    for (const p of params) if (p.name) declareLocal(p.name);
    const body = parseBody();
    localScopes.pop();
    return { type: 'Proc', op, params, body };
  }

  function parseActorBody(isEnd) {
    const handlers = [];
    const procs = [];
    while (peek().type !== 'EOF') {
      skipBlanks();
      if (peek().type === 'EOF' || isEnd()) break;
      if (peek().type === 'KEYWORD' && peek().value === 'on') {
        handlers.push(parseHandler());
      } else if (peek().type === 'KEYWORD' && peek().value === 'proc') {
        procs.push(parseProc());
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator between top-level declarations
      } else {
        throw new Error(`Unexpected token at top level: ${peek().type} '${peek().value || ''}'`);
      }
    }
    return { handlers, procs };
  }

  const actors = [];

  while (peek().type !== 'EOF') {
    skipBlanks();
    if (peek().type === 'EOF') break;

    if (peek().type === 'KEYWORD' && peek().value === 'actor') {
      consume(); // 'actor'
      const name = expect('IDENT').value;
      const { handlers, procs } = parseActorBody(
        () => peek().type === 'KEYWORD' && peek().value === 'end'
      );
      if (peek().type === 'KEYWORD' && peek().value === 'end') {
        consume(); // 'end'
        if (peek().type === 'HASH_IDENT') consume(); // end#Name
      }
      actors.push({ type: 'Actor', name, handlers, procs });
    } else if (peek().type === 'KEYWORD' && peek().value === 'on' ||
               peek().type === 'KEYWORD' && peek().value === 'proc') {
      // anonymous actor — collect all remaining handlers/procs
      const { handlers, procs } = parseActorBody(() => false);
      actors.push({ type: 'Actor', name: null, handlers, procs });
      break;
    } else {
      consume();
    }
  }

  return { type: 'Program', actors };
}
