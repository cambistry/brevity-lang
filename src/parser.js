export function parse(tokens) {
  let pos = 0;
  const functionNames = new Set();
  const localScopes = [new Set()];
  const refVarScopes = [new Set()];
  const fnSignatures = new Map();
  const functionParamSlots = new Map();
  const refParamSlots = new Map();
  let functionLiteralDepth = 0;
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const skipNewlines = () => { while (peek().type === 'NEWLINE') consume(); };
  const skipBlanks = () => { while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume(); };
  const currentScope = () => localScopes[localScopes.length - 1];
  const declareLocal = (name) => { if (name) currentScope().add(name); };
  const isKnownLocal = (name) => localScopes.some(scope => scope.has(name));
  const addRef = (name) => refVarScopes[refVarScopes.length - 1].add(name);
  const isRef = (name) => refVarScopes.some(s => s.has(name));
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

  function parseFunctionType() {
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
          consume(); // name
          consume(); // :
          const type = parseType();
          outputs.push({ name, type });
        } else {
          const type = parseType();
          outputs.push({ type });
        }
      } else {
        throw new Error('Expected identifier or type in function type output');
      }
    }
    expect('RPAREN');
    return { type: 'FunctionType', inputs, outputs };
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
      if (tokens[lookPos]?.type === 'PIPE' && isFunctionStart(lookPos)) {
        // Dense trailing block: |params| body
        if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
        blocks.push(parseFunction());
      } else if (tokens[lookPos]?.type === 'EQUALS') {
        // Spacious trailing block: = params = body
        if (allowNewlines) { while (peek().type === 'NEWLINE') consume(); }
        blocks.push(parseSpaciousTrailingBlock());
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

  // Parse a spacious trailing block: = params = body
  // Used after over/reduce when the function is in spacious form
  function parseSpaciousTrailingBlock() {
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
    refVarScopes.push(new Set());
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
          body[i] = { type: 'ImplicitReturn', expr: f.expr || { type: 'Identifier', name: f.name }, typeName: returnType };
        } else {
          // Multi-field or named: keep as Return
          body[i] = { type: 'Return', fields };
          const f = fields[0];
          if (f && f.positional && f.type) returnType = f.type;
        }
      }
    }

    return { type: 'Function', params, body, returnType };
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
    return { type: 'FunctionCallExpr', callee: { type: 'Identifier', name }, args };
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

  function parseSendArgs() {
    expect('LPAREN');
    const args = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'SIGIL') {
        const name = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ name, typeName, positional: false });
      } else {
        const expr = parseExpr();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        args.push({ expr, typeName, positional: true });
      }
    }
    expect('RPAREN');
    return args;
  }

  function isFunctionStart(startPos) {
    // Checks if the PIPE at startPos (default: current pos) is a function literal start
    const p = startPos !== undefined ? startPos : pos;
    if (tokens[p].type !== 'PIPE') return false;
    let i = p + 1;
    while (i < tokens.length && tokens[i].type !== 'PIPE') i++;
    if (i >= tokens.length) return false;
    const after = tokens[i + 1];
    return after && (
      after.type === 'LBRACE' ||
      after.type === 'LPAREN' ||
      after.type === 'DOLLAR_IDENT' ||
      after.type === 'IDENT' ||
      after.type === 'NUMBER' ||
      after.type === 'STRING' ||
      after.type === '->'
    );
  }

  function parseFunctionParams() {
    expect('PIPE');
    const params = [];
    while (peek().type !== 'PIPE' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'KEYWORD' && peek().value === 'ref') {
        consume(); // 'ref'
        if (peek().type === 'SIGIL') {
          const name = consume().value;
          let type = null;
          if (peek().type === 'COLON') { consume(); type = parseType(); }
          params.push({ name, type, positional: false, ref: true });
        } else if (peek().type === 'IDENT') {
          const name = consume().value;
          let type = null;
          if (peek().type === 'COLON') { consume(); type = parseType(); }
          params.push({ name, type, positional: true, ref: true });
        }
        continue;
      }
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
    expect('PIPE');
    return params;
  }

  function parseWhileBody() {
    const body = [];
    while (peek().type !== 'RBRACE' && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'RBRACE' || peek().type === 'EOF') break;
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET') {
        const name = consume().value;
        if (!isRef(name)) throw new Error(`Cannot set '${name}' — only 'ref' variables support '<-'`);
        consume(); // SET (<-)
        const value = parseExpr();
        body.push({ type: 'SetStatement', name, value });
      } else if (isTypedAssignStart()) {
        parseTypedAssign(body);
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        declareLocal(name);
        const value = parseRHSValue();
        body.push(value.type === 'TypedValue'
          ? { type: 'TypedAssign', name, typeName: value.typeName, value: value.expr }
          : { type: 'Assign', name, value });
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push({ type: 'StateAssign', name, value });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN') {
        const expr = parseExpr();
        body.push({ type: 'ExprStatement', expr });
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
      return { type: 'WhileStatement', cond, body, negated };
    }
    // Single-line form: repeat while/until <cond> <stmt>
    const body = [];
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET') {
      const name = consume().value;
      if (!isRef(name)) throw new Error(`Cannot set '${name}' — only 'ref' variables support '<-'`);
      consume(); // SET (<-)
      const value = parseExpr();
      body.push({ type: 'SetStatement', name, value });
    } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
      const name = consume().value;
      consume(); // EQUALS
      const value = parseExpr();
      body.push({ type: 'StateAssign', name, value });
    } else if (isTypedAssignStart()) {
      parseTypedAssign(body);
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
      const name = consume().value;
      consume(); // EQUALS
      declareLocal(name);
      const value = parseRHSValue();
      body.push(value.type === 'TypedValue'
        ? { type: 'TypedAssign', name, typeName: value.typeName, value: value.expr }
        : { type: 'Assign', name, value });
    } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN') {
      const expr = parseExpr();
      body.push({ type: 'ExprStatement', expr });
    } else {
      throw new Error(`Unexpected token in while body: ${peek().type} '${peek().value || ''}'`);
    }
    return { type: 'WhileStatement', cond, body, negated };
  }

  function parseFunctionBody(stopToken = 'RBRACE') {
    const body = [];
    while (peek().type !== stopToken && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === stopToken || peek().type === 'EOF') break;
      if (peek().type === 'DOT') {
        consume();
        body.push({ type: 'SilentTerminator' });
        break;
      }
      if (peek().type === '->') {
        consume(); // '->'
        if (peek().type === 'DOT') {
          consume(); // '.'
          body.push({ type: 'SilentTerminator' });
          break;
        }
        body.push({ type: 'Return', fields: parseReplyFields(true) });
      } else if (peek().type === 'KEYWORD' && peek().value === 'ref') {
        consume(); // 'ref'
        const name = consume().value;
        declareLocal(name);
        addRef(name);
        if (peek().type === 'COLON') {
          consume();
          const typeName = parseType();
          if (peek().type === 'EQUALS') {
            consume();
            const value = parseExpr();
            if (isTypeAttestation()) { consumeTypeAttestation(); }
            body.push({ type: 'RefDecl', name, typeName, value });
          } else {
            body.push({ type: 'RefDecl', name, typeName, value: null });
          }
        } else if (peek().type === 'EQUALS') {
          consume();
          const value = parseRHSValue();
          if (value.type === 'TypedValue') {
            body.push({ type: 'RefDecl', name, typeName: value.typeName, value: value.expr });
          } else {
            body.push({ type: 'RefDecl', name, typeName: null, value });
          }
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET') {
        const name = consume().value;
        if (!isRef(name)) throw new Error(`Cannot set '${name}' — only 'ref' variables support '<-'`);
        consume(); // SET (<-)
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
          body.push({ type: 'ActorSetStatement', name, args });
        } else {
          body.push({ type: 'SetStatement', name, value: firstExpr });
        }
      } else if (isTypedAssignStart()) {
        if (isRef(peek().value)) {
          throw new Error(`Cannot re-bind ref '${peek().value}' with typed assignment — use '${peek().value} <- value' to set`);
        }
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
        if (isRef(name)) {
          throw new Error(`Cannot re-bind ref '${name}' with '=' — use '${name} <- value' to set`);
        }
        consume(); // EQUALS
        declareLocal(name);
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
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push({ type: 'StateAssign', name, value });
      } else if (peek().type === 'KEYWORD' && peek().value === 'repeat') {
        body.push(parseRepeatStatement());
      } else {
        const expr = parseExpr();
        let typeName = null;
        if (isTypeAttestation()) {
          typeName = consumeTypeAttestation();
        }
        body.push({ type: 'ImplicitReturn', expr, typeName });
      }
    }
    return body;
  }

  function parseFunction() {
    localScopes.push(new Set());
    refVarScopes.push(new Set());
    let params;
    if (peek().type === 'PIPE') {
      params = parseFunctionParams();
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
    // Path 1 — Braced body: |x| { ... }
    if (peek().type === 'LBRACE') {
      consume(); // {
      functionLiteralDepth++;
      const body = parseFunctionBody();
      functionLiteralDepth--;
      const isSilent = body.length > 0 && body[body.length - 1].type === 'SilentTerminator';
      if (isSilent) {
        body.pop();
        returnType = '.';
      }
      skipNewlines();
      expect('RBRACE');
      if (!isSilent && peek().type === 'COLON') {
        consume();
        returnType = parseType();
      }
      checkStateWrites(body);
      refVarScopes.pop();
      localScopes.pop();
      return { type: 'Function', params, body, returnType };
    }
    // Path 2a — State assignment (deprecated): |x| $state = expr .
    if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
      functionLiteralDepth++;
      const name = consume().value;
      consume(); // EQUALS
      const value = parseExpr();
      functionLiteralDepth--;
      const body = [{ type: 'StateAssign', name, value }];
      skipNewlines();
      if (peek().type === 'DOT') {
        consume();
        returnType = '.';
      }
      checkStateWrites(body);
      refVarScopes.pop();
      localScopes.pop();
      return { type: 'Function', params, body, returnType };
    }
    // Path 2b — Set statement: |x| name <- expr .
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET' && isRef(tokens[pos].value)) {
      functionLiteralDepth++;
      const name = consume().value;
      consume(); // SET (<-)
      const firstExpr = parseExpr();
      functionLiteralDepth--;
      // Check for multi-arg set: name <- val, key: val
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
        const body = [{ type: 'ActorSetStatement', name, args }];
        skipNewlines();
        if (peek().type === 'DOT') { consume(); returnType = '.'; }
        refVarScopes.pop();
        localScopes.pop();
        return { type: 'Function', params, body, returnType };
      }
      const body = [{ type: 'SetStatement', name, value: firstExpr }];
      skipNewlines();
      if (peek().type === 'DOT') { consume(); returnType = '.'; }
      refVarScopes.pop();
      localScopes.pop();
      return { type: 'Function', params, body, returnType };
    }
    // Path 2c — Silent: |x| -> .
    if (peek().type === '->' && tokens[pos + 1]?.type === 'DOT') {
      consume(); // ->
      consume(); // .
      returnType = '.';
      refVarScopes.pop();
      localScopes.pop();
      return { type: 'Function', params, body: [], returnType };
    }
    // Path 3 — Single expression: |x| expr or |x| expr .
    functionLiteralDepth++;
    const expr = parseExpr(); // single-expr form, to EOL
    functionLiteralDepth--;
    skipNewlines();
    if (peek().type === 'DOT') {
      consume();
      returnType = '.';
    } else if (peek().type === 'COLON') {
      consume();
      returnType = parseType();
    }
    refVarScopes.pop();
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
    if (isTypeAttestation()) {
      typeName = consumeTypeAttestation();
    }
    return { type: 'IfBranch', expr, typeName };
  }

  function parseIfExpr() {
    const cond = parseExpr();
    // Consume optional type annotation on the condition (e.g. `if 0 : Integer ...`)
    if (isTypeAttestation()) {
      consumeTypeAttestation();
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

  function requireFunctionRef(fn, opName = 'over') {
    if (fn?.type === 'Identifier') {
      throw new Error(`'${opName}' requires a function reference — use &${fn.name}`);
    }
  }

  function parseReduceExpr() {
    if (peek().type === 'LPAREN') {
      // Dense form: reduce(args...) [trailing-block]
      const args = parseCallArgs();
      appendTrailingBlocks(args, true);
      // Disambiguate by arg count:
      //   3 args          → initial, collection, fn
      //   2 args+trailing → initial, collection, fn=trailing (already in args)
      //   2 args          → collection, fn (no initial)
      //   1 arg+trailing  → collection, fn=trailing (already in args)
      if (args.length === 3) {
        requireFunctionRef(args[2], 'reduce');
        return { type: 'ReduceExpr', initial: args[0], collection: args[1], fn: args[2] };
      } else if (args.length === 2) {
        requireFunctionRef(args[1], 'reduce');
        return { type: 'ReduceExpr', initial: null, collection: args[0], fn: args[1] };
      } else {
        throw new Error("'reduce' requires at least a collection and a function");
      }
    } else {
      // Spacious form: reduce [initial,] collection[,] fn
      // Parse first expression with IDENT+fn-start disambiguation
      let expr1;
      if (peek().type === 'IDENT' && tokens[pos+1]?.type === 'LPAREN' && isFunctionStart(pos+1)) {
        expr1 = { type: 'Identifier', name: consume().value };
      } else {
        expr1 = parseExpr();
      }
      if (peek().type !== 'COMMA') {
        // reduce collection (fn) — trailing block only
        const trailingArgs = [];
        appendTrailingBlocks(trailingArgs, true);
        if (trailingArgs.length === 0) throw new Error("'reduce' requires a function argument");
        requireFunctionRef(trailingArgs[0], 'reduce');
        return { type: 'ReduceExpr', initial: null, collection: expr1, fn: trailingArgs[0] };
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
        // reduce initial, collection, &fn
        expect('COMMA');
        const fn = parsePrimary();
        requireFunctionRef(fn, 'reduce');
        return { type: 'ReduceExpr', initial: expr1, collection: expr2, fn };
      }
      // reduce initial, collection (fn) OR reduce collection, &fn
      const trailingArgs = [];
      appendTrailingBlocks(trailingArgs, true);
      if (trailingArgs.length > 0) {
        // reduce initial, collection (fn)
        requireFunctionRef(trailingArgs[0], 'reduce');
        return { type: 'ReduceExpr', initial: expr1, collection: expr2, fn: trailingArgs[0] };
      }
      // No trailing block after second expr — must be: reduce collection, &fn
      // expr1 = collection, expr2 = fn (already consumed)
      requireFunctionRef(expr2, 'reduce');
      return { type: 'ReduceExpr', initial: null, collection: expr1, fn: expr2 };
    }
  }

  function parseOverExpr() {
    if (peek().type === 'LPAREN') {
      // Dense form: over(collection, fn) or over(collection) trailing-block
      const args = parseCallArgs();
      appendTrailingBlocks(args, true);
      requireFunctionRef(args[1]);
      return { type: 'OverExpr', collection: args[0], fn: args[1] };
    } else {
      // No-paren form: over collection, fn  OR  over collection [trailing-block]
      const collection = parseExpr();
      if (peek().type === 'COMMA') {
        consume();
        const fn = parsePrimary();
        requireFunctionRef(fn);
        return { type: 'OverExpr', collection, fn };
      }
      // Trailing block (dense or spacious)
      const trailingArgs = [];
      appendTrailingBlocks(trailingArgs, true);
      if (trailingArgs.length === 0) throw new Error("'over' requires a function argument");
      requireFunctionRef(trailingArgs[0]);
      return { type: 'OverExpr', collection, fn: trailingArgs[0] };
    }
  }

  function parsePrimary() {
    // Function: |params| { body } or |params| expr or { body } (no-arg)
    if (peek().type === 'PIPE' && isFunctionStart()) {
      return parseFunction();
    }
    if (peek().type === 'LBRACE') {
      return parseFunction(); // no-arg function
    }

    if (peek().type === 'IDENT' && peek().value === 'Structure' && tokens[pos + 1]?.type === 'LPAREN') {
      const tok = consume();
      return parseStructureConstructor(tok.value);
    }

    let result;
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'LPAREN' && !functionNames.has(tokens[pos].value) && !isKnownLocal(tokens[pos].value)) {
      const name = consume().value;
      result = parseForwardCall(name);
    } else {
      const tok = consume();
      if (tok.type === 'LPAREN') {
        // Grouped expression
        const inner = parseExpr();
        expect('RPAREN');
        result = inner;
      } else if (tok.type === 'IDENT') {
        result = isRef(tok.value)
          ? { type: 'RefRead', name: tok.value }
          : { type: 'Identifier', name: tok.value };
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
      } else if (tok.type === 'KEYWORD' && tok.value === 'reduce') {
        result = parseReduceExpr();
      } else if (tok.type === 'AMPERSAND_IDENT') {
        if (isRef(tok.value)) {
          result = { type: 'RefArg', name: tok.value };
        } else if (isKnownLocal(tok.value) || functionNames.has(tok.value)) {
          result = { type: 'FnRef', name: tok.value };
        } else {
          result = { type: 'FnRef', name: tok.value };
        }
      } else if (tok.type === 'DOLLAR_IDENT') {
        result = { type: 'StateVar', name: tok.value };
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
    // Dot-call: expr.method(args) or dot-access: expr.property
    while (peek().type === 'DOT' && tokens[pos + 1]?.type === 'IDENT') {
      consume(); // DOT
      const method = expect('IDENT').value;
      if (peek().type === 'LPAREN') {
        const args = parseSendArgs();
        result = { type: 'DotCallExpr', object: result, method, args };
      } else {
        result = { type: 'DotAccessExpr', object: result, property: method };
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

  // Check for type attestation: either `: Type` (legacy) or `as Type`
  function isTypeAttestation() {
    if (isTypeAnnotation()) return true;
    return peek().type === 'KEYWORD' && peek().value === 'as' &&
           tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1].value);
  }

  // Consume type attestation (`: Type` or `as Type`) and return the type
  function consumeTypeAttestation() {
    if (peek().type === 'KEYWORD' && peek().value === 'as') {
      consume(); // 'as'
      return parseType();
    }
    consume(); // ':'
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
          if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
            // positional: name : Type (uppercase type distinguishes from key-value)
            fields.push({ name, type: parseType(), positional: true });
          } else {
            // key-value: key: expr [as Type] or [: Type]
            const value = parseExpr();
            let fieldType = null;
            if (isTypeAttestation()) fieldType = consumeTypeAttestation();
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
          if (isTypeAttestation()) {
            typeName = consumeTypeAttestation();
          }
          if (exprNode.type === 'Identifier' && typeName === null) {
            fields.push({ name, positional: true });
          } else {
            fields.push({ expr: exprNode, type: typeName, positional: true });
          }
        }
      } else if (peek().type === 'DOLLAR_IDENT') {
        const name = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = parseType(); }
        fields.push({ expr: { type: 'StateVar', name }, type: typeName, positional: true, name: '$' + name });
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
    // Post-paren type attestation: ->(expr) as Type
    if (hasParen && fields.length === 1 && isTypeAttestation()) {
      fields[0].type = consumeTypeAttestation();
    }
    // Open-style reply must be terminated by blank line, empty --, //, or EOF
    if (!sameLine && !hasParen) {
      const t = peek().type;
      if (t !== 'BLOCK_SEP' && t !== 'DIVIDER' && t !== 'EOF') {
        throw new Error(`Open-style -> must be terminated by blank line, empty -- or //, or EOF; got ${t} '${peek().value || ''}'`);
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
      source = parseExpr(); // identifier or function call
    }

    return { type: 'DestructureAssign', pattern, source };
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
      } else if (peek().type === 'STRING') {
        const val = consume().value;
        let typeName = null;
        if (isTypeAttestation()) typeName = consumeTypeAttestation();
        args.push({ positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName });
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
    // Check for type attestation (`: Type` or `as Type`)
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
      if (isTypeAttestation()) typeName = consumeTypeAttestation();
      return { positional: true, expr: makeNumLiteral(numTok), type: typeName };
    }
    if (peek().type === 'STRING') {
      const val = consume().value;
      let typeName = null;
      if (isTypeAttestation()) typeName = consumeTypeAttestation();
      return { positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName };
    }
    // IDENT as Type → positional typed variable
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'KEYWORD' && tokens[pos + 1]?.value === 'as') {
      const name = consume().value;
      const typeName = consumeTypeAttestation();
      return { positional: true, expr: { type: 'Identifier', name }, type: typeName };
    }
    // IDENT COLON uppercase → positional typed variable (a : Type)
    if (peek().type === 'IDENT' && isTypeAnnotation(1)) {
      const name = consume().value;
      consume(); // COLON
      return { positional: true, expr: { type: 'Identifier', name }, type: parseType() };
    }
    // IDENT COLON → key-value (k: expr [as Type] or [: Type])
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
    if (isRef(name)) {
      throw new Error(`Cannot re-bind ref '${name}' with typed assignment — use '${name} <- value' to set`);
    }
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
        if (isTypeAttestation()) {
          firstType = consumeTypeAttestation();
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
        if (isTypeAttestation()) {
          const rhsType = consumeTypeAttestation();
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
      checkFunctionSignature(typeName, value);
    }
    if (value.type === 'Function' && typeName !== 'Function') {
      const sig = getFunctionLiteralSignature(value);
      fnSignatures.set(name, sig);
    }
    body.push({ type: 'TypedAssign', name, typeName, value });
  }

  function isTypedAssignStart() {
    if (peek().type !== 'IDENT') return false;
    if (tokens[pos+1]?.type !== 'COLON') return false;
    const ts = pos + 2;
    if (tokens[ts]?.type === 'LPAREN') {
      // Function type: name : (..)->(..) = ...
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
        throw new Error(`Public function param ':${name}' requires a type annotation (e.g. :${name} : SomeType)`);
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

      // = as open-style section delimiter
      if (peek().type === 'EQUALS') {
        consume();           // eat the =
        skipNewlines();
        if (peek().type === 'EQUALS') { consume(); skipNewlines(); return []; }  // = = → explicit empty params
        if (!isParamStart()) return [];  // no params → body follows
        const params = [];
        while (true) {
          if (peek().type === 'EQUALS') { consume(); break; }  // second = ends params
          if (peek().type === 'EOF') throw new Error('Unexpected EOF in =-delimited param list');
          if (peek().type === 'NEWLINE') { consume(); continue; }
          if (peek().type === 'COMMA') { consume(); continue; }
          if (isParamStart()) { const p = parseOneParam(); if (p) { params.push(p); continue; } }
          throw new Error(`=-delimited param list: unexpected ${peek().type}`);
        }
        return params;
      }

      if (peek().type === 'BLOCK_SEP') return []; // blank line → no params
      if (peek().type === 'EOF') return [];
      if (peek().type === 'DIVIDER') { consume(); return []; }
      if (!isParamStart()) {
        return [];  // no params — body starts on this line
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
    refVarScopes.push(new Set());
    skipNewlines();
    if (peek().type === 'BLOCK_SEP') consume();

    const body = [];
    while (peek().type !== 'BLOCK_SEP' && peek().type !== 'EOF') {
      skipNewlines();
      if (peek().type === 'BLOCK_SEP' || peek().type === 'EOF') break;

      if (peek().type === 'DOT') {
        consume();
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
        body.push({ type: 'Reply', fields: parseReplyFields(!openForm) });
        break;
      }

      if (peek().type === 'KEYWORD' && peek().value === 'ref') {
        consume(); // 'ref'
        const name = consume().value;
        declareLocal(name);
        addRef(name);
        if (peek().type === 'COLON') {
          consume();
          const typeName = parseType();
          if (peek().type === 'EQUALS') {
            consume();
            const value = parseExpr();
            if (isTypeAttestation()) { consumeTypeAttestation(); }
            body.push({ type: 'RefDecl', name, typeName, value });
          } else {
            body.push({ type: 'RefDecl', name, typeName, value: null });
          }
        } else if (peek().type === 'EQUALS') {
          consume();
          const value = parseRHSValue();
          if (value.type === 'TypedValue') {
            body.push({ type: 'RefDecl', name, typeName: value.typeName, value: value.expr });
          } else {
            body.push({ type: 'RefDecl', name, typeName: null, value });
          }
        }
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET') {
        const name = consume().value;
        consume(); // SET (<-)
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
          body.push({ type: 'ActorSetStatement', name, args });
        } else {
          body.push({ type: 'SetStatement', name, value: firstExpr });
        }
      } else if (isTypedAssignStart()) {
        if (isRef(peek().value)) {
          throw new Error(`Cannot re-bind ref '${peek().value}' with typed assignment — use '${peek().value} <- value' to set`);
        }
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
        if (isRef(name)) {
          throw new Error(`Cannot re-bind ref '${name}' with '=' — use '${name} <- value' to set`);
        }
        consume(); // EQUALS
        declareLocal(name);
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
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else if (peek().type === 'DOLLAR_IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseExpr();
        body.push({ type: 'StateAssign', name, value });
      } else if (peek().type === 'KEYWORD' && peek().value === 'repeat') {
        body.push(parseRepeatStatement());
      } else if (peek().type === 'KEYWORD' && peek().value === 'if') {
        consume(); // 'if'
        const cond = parseExpr();
        skipNewlines();
        const ifBody = [];
        while (peek().type !== 'NEWLINE' && peek().type !== 'BLOCK_SEP' && peek().type !== 'EOF' &&
               peek().type !== 'DOT' &&
               !(peek().type === '->' || (peek().type === 'KEYWORD' && peek().value === 'else'))) {
          if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'SET') {
            const pName = consume().value;
            if (!isRef(pName)) throw new Error(`Cannot set '${pName}' — only 'ref' variables support '<-'`);
            consume(); // SET (<-)
            ifBody.push({ type: 'SetStatement', name: pName, value: parseExpr() });
          } else {
            break;
          }
        }
        body.push({ type: 'IfStatement', cond, body: ifBody });
      } else if (peek().type === 'KEYWORD' && peek().value === 'spawn') {
        consume(); // 'spawn'
        const expr = parseExpr();
        if (expr.type !== 'FunctionCallExpr' && expr.type !== 'DotCallExpr') {
          throw new Error("'spawn' requires a function call or external send");
        }
        body.push({ type: 'SpawnStatement', call: expr });
      } else if (peek().type === 'IDENT' && (tokens[pos + 1]?.type === 'LPAREN' || tokens[pos + 1]?.type === 'DOT')) {
        // Standalone function call or dot-call (side effects)
        const expr = parseExpr();
        body.push({ type: 'ExprStatement', expr });
      } else if (peek().type === 'KEYWORD' && peek().value === 'reduce') {
        throw new Error("'reduce' must be assigned to a variable — use 'result : Type = reduce ...'");
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator — visual separator, no semantic weight
      } else {
        throw new Error(`Unexpected token in function body: ${peek().type} '${peek().value || ''}'`);
      }
    }
    refVarScopes.pop();
    localScopes.pop();
    return body;
  }

  function parsePublicFunction() {
    consume(); // AT
    const opTok = consume();
    let op;
    if (opTok.type === 'SET') {
      op = '<-';
    } else if (opTok.type === 'IDENT' || opTok.type === 'KEYWORD') {
      op = opTok.value;
    } else {
      throw new Error(`Expected op name, got ${opTok.type} '${opTok.value}'`);
    }
    let params;
    if (peek().type === 'EQUALS') {
      // Dense inline: @op = body  or  @op = |params| body
      consume(); // eat the =
      if (peek().type === 'PIPE') {
        // Pipe-delimited params: |:a : Integer, :b : Integer|
        consume(); // opening PIPE
        params = [];
        while (peek().type !== 'PIPE' && peek().type !== 'EOF') {
          if (peek().type === 'COMMA') { consume(); continue; }
          const p = parseOneParam();
          if (p === null) break;
          params.push(p);
        }
        expect('PIPE');
      } else {
        params = []; // no params, body follows
      }
    } else if (peek().type === 'NEWLINE') {
      // Spacious form: @op\n =\n body  or  @op\n =\n params\n =\n body
      consume(); // eat NEWLINE
      if (peek().type === 'EQUALS') {
        consume(); // first =
        skipNewlines();
        if (peek().type === 'EQUALS') {
          // = = → explicit empty params
          consume();
          params = [];
        } else {
          // Try parsing params between two = delimiters, with backtracking.
          // A second = is only a delimiter if it appears after a NEWLINE (own line),
          // not inline (which would be an assignment operator in body content).
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
          } catch (e) {
            // parseOneParam threw (e.g. sigil without type annotation) — not params
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
    } else {
      throw new Error(`Unexpected token after '@${op}'. Use '@${op} = |params| body' (dense) or '@${op}\\n  =\\n  params\\n  =\\n  body' (spacious)`);
    }

    const body = parseBody();
    return { type: 'FunctionDecl', name: op, params, body, public: true };
  }

  // parseInitBlock removed — init/$var syntax deprecated

  function parseAsClause() {
    consume(); // 'as'
    let negated = false;
    if (peek().type === 'BANG') {
      consume(); // '!'
      negated = true;
    }
    const targetType = parseType();
    if (peek().type === '->') {
      consume(); // '->'
    } else if (peek().type === 'NEWLINE') {
      skipNewlines();
      if (peek().type !== '->') throw new Error(`Expected '->' in as clause, got ${peek().type}`);
      consume(); // '->'
    } else {
      throw new Error(`Expected '->' in as clause, got ${peek().type}`);
    }
    const expr = parseExpr();
    return { type: 'AsClause', targetType, negated, expr };
  }

  function isActorBodyStart() {
    // Look ahead past newlines and block separators to see if the body starts with actor-level constructs
    let i = pos;
    while (i < tokens.length && (tokens[i].type === 'NEWLINE' || tokens[i].type === 'BLOCK_SEP')) i++;
    const t = tokens[i];
    if (!t) return false;
    return t.type === 'AT' ||
           (t.type === 'KEYWORD' && (t.value === 'as' || t.value === 'ref'));
  }

  function parseActorBody(isEnd) {
    const functions = [];
    const nestedActors = [];
    const asClauses = [];
    const constructorBody = [];
    refVarScopes.push(new Set()); // actor-level ref scope
    while (peek().type !== 'EOF') {
      skipBlanks();
      if (peek().type === 'EOF' || isEnd()) break;
      // -> self terminates an actor body
      if (peek().type === '->') {
        consume(); // ->
        if (peek().type === 'KEYWORD' && peek().value === 'self') {
          consume(); // self
        }
        break;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'as') {
        asClauses.push(parseAsClause());
      } else if (peek().type === 'KEYWORD' && peek().value === 'ref' && functions.length === 0) {
        // Constructor body: ref declaration before any @ functions
        consume(); // 'ref'
        const name = consume().value;
        addRef(name);
        if (peek().type === 'COLON') {
          consume();
          const typeName = parseType();
          if (peek().type === 'EQUALS') {
            consume();
            const value = parseExpr();
            if (isTypeAttestation()) { consumeTypeAttestation(); }
            constructorBody.push({ type: 'RefDecl', name, typeName, value });
          } else {
            constructorBody.push({ type: 'RefDecl', name, typeName, value: null });
          }
        } else if (peek().type === 'EQUALS') {
          consume();
          const value = parseRHSValue();
          if (value.type === 'TypedValue') {
            constructorBody.push({ type: 'RefDecl', name, typeName: value.typeName, value: value.expr });
          } else {
            constructorBody.push({ type: 'RefDecl', name, typeName: null, value });
          }
        }
      } else if (peek().type === 'AT') {
        functions.push(parsePublicFunction());
      } else if (peek().type === 'IDENT') {
        const op = consume().value;
        const params = parseParams();

        // Check if this is a named actor definition (body contains @, or as)
        if (isActorBodyStart()) {
          const nested = parseActorBody(() => peek().type === 'KEYWORD' && peek().value === 'end');
          // Consume optional end#Name
          skipBlanks();
          if (peek().type === 'KEYWORD' && peek().value === 'end') {
            consume(); // 'end'
            if (peek().type === 'HASH_IDENT') consume(); // #Name
          }
          nestedActors.push({ type: 'Actor', name: op, params, functions: nested.functions, stateVarDecls: nested.stateVarDecls, initBody: nested.initBody, initParams: params, constructorBody: nested.constructorBody, asClauses: nested.asClauses });
        } else {
          // Regular private function definition
          const slots = new Set();
          params.forEach((p, i) => {
            if (isFunctionType(p.type)) slots.add(p.positional ? i : (p.key ?? p.name));
          });
          if (slots.size > 0) functionParamSlots.set(op, slots);
          localScopes.push(new Set());
          refVarScopes.push(new Set());
          for (const p of params) if (p.name) declareLocal(p.name);
          const body = parseBody();
          refVarScopes.pop();
          localScopes.pop();
          functions.push({ type: 'FunctionDecl', name: op, params, body });
        }
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator between top-level declarations
      } else {
        throw new Error(`Unexpected token at top level: ${peek().type} '${peek().value || ''}'`);
      }
    }
    // Back-compat: produce stateVarDecls/initBody/initParams from constructorBody for codegen
    const stateVarDecls = [];
    const initBody = [];
    for (const stmt of constructorBody) {
      if (stmt.type === 'TypedAssign' || stmt.type === 'RefDecl') {
        stateVarDecls.push({ name: stmt.name, typeName: stmt.typeName || stmt.rhsType || 'Anything', isRef: stmt.type === 'RefDecl' });
        initBody.push({ type: 'StateAssign', name: stmt.name, value: stmt.value, isRef: stmt.type === 'RefDecl' });
      }
    }
    refVarScopes.pop(); // end actor-level ref scope
    return { functions, nestedActors, stateVarDecls, initBody, initParams: [], constructorBody, asClauses };
  }

  const actors = [];
  const useDecls = [];

  while (peek().type !== 'EOF') {
    skipBlanks();
    if (peek().type === 'EOF') break;

    if (peek().type === 'KEYWORD' && peek().value === 'use') {
      consume(); // 'use'
      const name = expect('IDENT').value;
      useDecls.push({ type: 'UseDecl', name });
      continue;
    }

    if (peek().type === 'AT' || peek().type === 'IDENT' ||
               peek().type === 'DIVIDER' ||
               (peek().type === 'KEYWORD' && (peek().value === 'as' || peek().value === 'ref'))) {
      // anonymous actor — collect functions and nested actor definitions
      const { functions, nestedActors, stateVarDecls, initBody, initParams, constructorBody, asClauses } = parseActorBody(
        () => false
      );
      actors.push({ type: 'Actor', name: null, functions, stateVarDecls, initBody, initParams, constructorBody, asClauses });
      // Promote nested actor definitions to top-level actors
      actors.push(...nestedActors);
    } else {
      consume();
    }
  }

  return { type: 'Program', actors, useDecls };
}
