export function parse(tokens) {
  let pos = 0;

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
    while (peek().type !== 'RPAREN' && peek().type !== 'EOF') {
      if (peek().type === 'COMMA') { consume(); continue; }
      args.push(parseExpr());
    }
    expect('RPAREN');
    return { type: 'ProcCallExpr', name, args };
  }

  function parsePrimary() {
    const tok = consume();
    let result;
    if (tok.type === 'IDENT' && tok.value === 'Structure' && peek().type === 'LPAREN') {
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
    while (['PLUS', 'MINUS', 'STAR'].includes(peek().type)) {
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

  function parseReplyFields() {
    const fields = [];
    const hasParen = peek().type === 'LPAREN';
    if (hasParen) consume();
    while (true) {
      skipNewlines();
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
        expect('COLON');
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
        pattern.push({ named: true, name });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        // key-mapped: a: localName
        const key = consume().value;
        consume(); // COLON
        const localName = consume().value;
        pattern.push({ key, name: localName });
      } else if (peek().type === 'IDENT') {
        const name = consume().value;
        pattern.push({ positional: true, name, idx: positionalIdx++ });
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
    if (t0 === 'IDENT' && t1 === 'COMMA') return true;
    if (t0 === 'IDENT' && t1 === 'COLON' && t2 === 'IDENT' && t3 === 'EQUALS') return true;
    return false;
  }

  function parseParams() {
    // Optional opening paren for dense param syntax
    if (peek().type === 'LPAREN') consume();

    const params = [];
    while (true) {
      skipNewlines();
      if (peek().type === 'COMMA') { consume(); continue; }
      if (peek().type === 'RPAREN') break;
      if (peek().type === 'SIGIL') {
        const { name, type: typeName } = parseSigilWithType();
        if (typeName === null) {
          throw new Error(`Handler param ':${name}' requires a type annotation (e.g. :${name} : SomeType)`);
        }
        params.push({ name, type: typeName });
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
        const first = consume().value;
        consume(); // COLON
        if (/^[A-Z]/.test(peek().value)) {
          // positional: a : Type
          params.push({ name: first, type: consume().value, positional: true });
        } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'COLON') {
          // key-mapped: outer: inner : Type
          const localName = consume().value;
          consume(); // COLON
          params.push({ key: first, name: localName, type: expect('IDENT').value });
        } else {
          break;
        }
      } else if (peek().type === 'ELLIPSIS') {
        consume();
        const name = expect('IDENT').value;
        let typeName = null;
        if (peek().type === 'COLON') { consume(); typeName = expect('IDENT').value; }
        params.push({ rest: true, name, type: typeName });
      } else {
        break;
      }
    }

    // Optional closing paren for dense param syntax
    if (peek().type === 'RPAREN') consume();
    return params;
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
        skipNewlines();
        body.push({ type: 'Reply', fields: parseReplyFields() });
        break;
      }

      if (isDestructureStart()) {
        body.push(parseDestructureAssign());
      } else if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        body.push({ type: 'Assign', name, value: parseExpr() });
      } else {
        consume(); // skip unknown
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
      } else {
        consume();
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
