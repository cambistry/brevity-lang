export function parse(tokens) {
  let pos = 0;
  const functionNames = new Set();

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const skipNewlines = () => { while (peek().type === 'NEWLINE') consume(); };
  const skipBlanks = () => { while (peek().type === 'NEWLINE' || peek().type === 'BLOCK_SEP') consume(); };

  function expect(type, value) {
    const tok = consume();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''}, got ${tok.type} '${tok.value}'`);
    }
    return tok;
  }

  function parseStructureConstructor() {
    expect('LPAREN');
    const args = [];
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'NUMBER') {
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        args.push({ positional: true, expr: { type: 'IntLiteral', value: val }, type: typeName });
      } else if (peek().type === 'STRING') {
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        args.push({ positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
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

  function parseProcCall(name) {
    expect('LPAREN');
    const args = [];
    const namedArgs = {};
    let hasNamed = false;
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        namedArgs[key] = parseExpr();
        hasNamed = true;
      } else {
        args.push(parseExpr());
      }
    }
    expect('RPAREN');
    if (hasNamed) args.push({ type: 'NamedArgsBag', fields: namedArgs });
    const nodeType = functionNames.has(name) ? 'FunctionCallExpr' : 'ProcCallExpr';
    return { type: nodeType, name, args };
  }

  function isFunctionStart() {
    // peek() is LPAREN — look for matching RPAREN and check what follows
    let depth = 0;
    let i = pos;
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
        if (peek().type === 'COLON') { consume(); type = expect('IDENT').value; }
        params.push({ name, type }); // no positional → named
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const first = consume().value;
        consume(); // COLON
        if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
          // positional: a : Type
          params.push({ name: first, type: consume().value, positional: true });
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
          // key-mapped: outer: inner : Type
          const localName = consume().value;
          consume(); // COLON
          params.push({ key: first, name: localName, type: expect('IDENT').value });
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
        const typeName = consume().value;
        body.push({ type: 'BareTypeDecl', name, typeName });
      } else if (isDestructureStart()) {
        body.push(parseDestructureAssign());
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') functionNames.add(name);
        if (value.type === 'TypedValue') {
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else {
        body.push({ type: 'ImplicitReturn', expr: parseExpr() });
      }
    }
    return body;
  }

  function parseFunction() {
    const params = parseFunctionParams();
    let returnType = null;
    if (peek().type === 'LBRACE') {
      consume(); // {
      const body = parseFunctionBody();
      expect('RBRACE');
      if (peek().type === 'COLON') { consume(); returnType = expect('IDENT').value; }
      return { type: 'Function', params, body, returnType };
    }
    const expr = parseExpr(); // single-expr form, to EOL
    if (peek().type === 'COLON') { consume(); returnType = expect('IDENT').value; }
    return { type: 'Function', params, expr, returnType };
  }

  function parsePrimary() {
    // Function: (params) { body } or (params) expr
    if (peek().type === 'LPAREN' && isFunctionStart()) {
      return parseFunction();
    }

    const tok = consume();
    let result;
    if (tok.type === 'LPAREN') {
      // Grouped expression
      const inner = parseExpr();
      expect('RPAREN');
      result = inner;
    } else if (tok.type === 'IDENT' && tok.value === 'Structure' && peek().type === 'LPAREN') {
      result = parseStructureConstructor();
    } else if (tok.type === 'IDENT' && peek().type === 'LPAREN') {
      result = parseProcCall(tok.value);
    } else if (tok.type === 'IDENT') {
      result = { type: 'Identifier', name: tok.value };
    } else if (tok.type === 'NUMBER') {
      result = { type: 'IntLiteral', value: tok.value };
    } else if (tok.type === 'STRING') {
      result = { type: 'StringLiteral', value: tok.value };
    } else {
      throw new Error(`Unexpected token in expression: ${tok.type} '${tok.value}'`);
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

  function parseExpr() {
    let left = parsePrimary();
    while (['PLUS', 'MINUS', 'STAR', 'SLASH'].includes(peek().type)) {
      const op = consume().value;
      left = { type: 'BinaryExpr', op, left, right: parsePrimary() };
    }
    return left;
  }

  function parseSigilWithType() {
    const name = consume().value; // SIGIL
    let typeName = null;
    if (peek().type === 'COLON') {
      consume();
      typeName = expect('IDENT').value;
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
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        fields.push({ expr: { type: 'IntLiteral', value: val }, type: typeName, positional: true });
      } else if (peek().type === 'SIGIL') {
        const { name, type: fieldType } = parseSigilWithType();
        fields.push({ sigil: name, type: fieldType });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        if (peek().type === 'COLON') {
          consume();
          if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
            // positional: name : Type (uppercase type distinguishes from key-value)
            fields.push({ name, type: consume().value, positional: true });
          } else {
            // key-value: key: expr [: Type]
            const value = parseExpr();
            let fieldType = null;
            if (peek().type === 'COLON') { consume(); fieldType = expect('IDENT').value; }
            fields.push({ key: name, value, type: fieldType });
          }
        } else {
          // bare positional: variable ref or binary expression with optional type
          let exprNode = { type: 'Identifier', name };
          while (['PLUS', 'MINUS', 'STAR', 'SLASH'].includes(peek().type)) {
            const op = consume().value;
            exprNode = { type: 'BinaryExpr', op, left: exprNode, right: parsePrimary() };
          }
          let typeName = null;
          if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
            consume(); typeName = consume().value;
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
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
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
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        pattern.push({ named: true, name, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const first = consume().value;
        consume(); // COLON
        if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
          // typed positional: a : Type
          pattern.push({ positional: true, name: first, idx: positionalIdx++, type: consume().value });
        } else if (peek().type === 'IDENT') {
          // key-mapped: key: local [: Type]
          const localName = consume().value;
          let typeName = null;
          if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
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
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        args.push({ positional: true, expr: { type: 'IntLiteral', value: val }, type: typeName });
      } else if (peek().type === 'STRING') {
        const val = consume().value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        args.push({ positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const key = consume().value;
        consume(); // COLON
        const expr = parseExpr();
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        args.push({ key, expr, type: typeName });
      } else {
        break;
      }
      if (peek().type === 'COMMA') { consume(); } else { break; }
    }
    return { type: 'StructureConstructor', args };
  }

  function isDestructureStart() {
    const t0 = peek().type;
    const t1 = tokens[pos + 1]?.type;
    const t2 = tokens[pos + 2]?.type;
    const t3 = tokens[pos + 3]?.type;
    if (t0 === 'SIGIL') return true;
    if (t0 === 'LPAREN') return true;
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
    if (t0 === 'IDENT' && t1 === 'COLON' &&
        t2 === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '') &&
        t3 === 'COMMA')
      return true;
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
    if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
      consume(); firstType = consume().value;
    }
    // Check for key-value: IDENT was the key, COLON follows (non-type)
    if (peek().type === 'COLON' && value.type === 'Identifier' && firstType === null) {
      consume(); // COLON
      const kvExpr = parseExpr();
      let kvType = null;
      if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
        consume(); kvType = consume().value;
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
      const val = consume().value;
      let typeName = null;
      if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
        consume(); typeName = consume().value;
      }
      return { positional: true, expr: { type: 'IntLiteral', value: val }, type: typeName };
    }
    if (peek().type === 'STRING') {
      const val = consume().value;
      let typeName = null;
      if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
        consume(); typeName = consume().value;
      }
      return { positional: true, expr: { type: 'StringLiteral', value: val }, type: typeName };
    }
    // IDENT COLON uppercase → positional typed variable (a : Type)
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON' &&
        tokens[pos + 2]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '')) {
      const name = consume().value;
      consume(); // COLON
      const typeName = consume().value;
      return { positional: true, expr: { type: 'Identifier', name }, type: typeName };
    }
    // IDENT COLON → key-value (k: expr [: Type])
    if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
      const key = consume().value;
      consume(); // COLON
      const expr = parseExpr();
      let typeName = null;
      if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
        consume(); typeName = consume().value;
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
    const typeName = consume().value;
    consume(); // EQUALS
    let value;
    // For Structure type, check if RHS starts with sigil
    if (typeName === 'Structure' && peek().type === 'SIGIL') {
      value = parseRHSStructureLiteral(null);
    } else {
      value = parseExpr();
      if (typeName === 'Structure') {
        // Check for type annotation after value (wraps in single-element StructureLiteral)
        let firstType = null;
        if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
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
        if (peek().type === 'COLON' && tokens[pos + 1]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 1]?.value ?? '')) {
          consume(); // COLON
          const rhsType = consume().value;
          if (rhsType !== typeName) {
            throw new Error(`Conflicting type declarations for '${name}': '${typeName}' vs '${rhsType}'`);
          }
        }
      }
    }
    body.push({ type: 'TypedAssign', name, typeName, value });
  }

  function isTypedAssignStart() {
    return peek().type === 'IDENT' &&
      tokens[pos + 1]?.type === 'COLON' &&
      tokens[pos + 2]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '') &&
      tokens[pos + 3]?.type === 'EQUALS';
  }

  function isBareTypeDeclStart() {
    return peek().type === 'IDENT' &&
      tokens[pos + 1]?.type === 'COLON' &&
      tokens[pos + 2]?.type === 'IDENT' && /^[A-Z]/.test(tokens[pos + 2]?.value ?? '') &&
      tokens[pos + 3]?.type !== 'EQUALS' && tokens[pos + 3]?.type !== 'COMMA';
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
      if (peek().type === 'IDENT' && /^[A-Z]/.test(peek().value)) {
        return { name: first, type: consume().value, positional: true };
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const localName = consume().value;
        consume(); // COLON
        return { key: first, name: localName, type: expect('IDENT').value };
      }
      return null;
    } else if (peek().type === 'ELLIPSIS') {
      consume();
      const name = expect('IDENT').value;
      let typeName = null;
      if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
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
        const typeName = consume().value;
        body.push({ type: 'BareTypeDecl', name, typeName });
      } else if (isDestructureStart()) {
        body.push(parseDestructureAssign());
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        const value = parseRHSValue();
        if (value.type === 'Function') functionNames.add(name);
        if (value.type === 'TypedValue') {
          body.push({ type: 'TypedAssign', name, typeName: value.typeName, value: value.expr });
        } else {
          body.push({ type: 'Assign', name, value });
        }
      } else if (peek().type === 'DIVIDER') {
        consume(); // stitch separator — visual separator, no semantic weight
      } else {
        throw new Error(`Unexpected token in handler body: ${peek().type} '${peek().value || ''}'`);
      }
    }
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
    const body = parseBody();
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
