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

  function parsePrimary() {
    const tok = consume();
    if (tok.type === 'IDENT')   return { type: 'Identifier', name: tok.value };
    if (tok.type === 'NUMBER')  return { type: 'IntLiteral', value: tok.value };
    if (tok.type === 'STRING')  return { type: 'StringLiteral', value: tok.value };
    throw new Error(`Unexpected token in expression: ${tok.type} '${tok.value}'`);
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
    while (true) {
      skipNewlines();
      if (peek().type === 'SIGIL') {
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

  function parseHandler() {
    consume(); // 'on'
    const opTok = consume();
    if (opTok.type !== 'IDENT' && opTok.type !== 'KEYWORD') {
      throw new Error(`Expected op name, got ${opTok.type} '${opTok.value}'`);
    }
    const op = opTok.value;

    const params = [];
    while (true) {
      skipNewlines();
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

      if (peek().type === 'IDENT' && tokens[pos + 1]?.type === 'EQUALS') {
        const name = consume().value;
        consume(); // EQUALS
        body.push({ type: 'Assign', name, value: parseExpr() });
      } else {
        consume(); // skip unknown
      }
    }

    return { type: 'Handler', op, params, body };
  }

  function parseHandlers(isEnd) {
    const handlers = [];
    while (peek().type !== 'EOF') {
      skipBlanks();
      if (peek().type === 'EOF' || isEnd()) break;
      if (peek().type === 'KEYWORD' && peek().value === 'on') {
        handlers.push(parseHandler());
      } else {
        consume();
      }
    }
    return handlers;
  }

  const actors = [];

  while (peek().type !== 'EOF') {
    skipBlanks();
    if (peek().type === 'EOF') break;

    if (peek().type === 'KEYWORD' && peek().value === 'actor') {
      consume(); // 'actor'
      const name = expect('IDENT').value;
      const handlers = parseHandlers(
        () => peek().type === 'KEYWORD' && peek().value === 'end'
      );
      if (peek().type === 'KEYWORD' && peek().value === 'end') {
        consume(); // 'end'
        if (peek().type === 'HASH_IDENT') consume(); // end#Name
      }
      actors.push({ type: 'Actor', name, handlers });
    } else if (peek().type === 'KEYWORD' && peek().value === 'on') {
      // anonymous actor — collect all remaining handlers
      const handlers = parseHandlers(() => false);
      actors.push({ type: 'Actor', name: null, handlers });
      break;
    } else {
      consume();
    }
  }

  return { type: 'Program', actors };
}
