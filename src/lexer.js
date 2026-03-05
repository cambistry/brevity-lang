const KEYWORDS = new Set(['on', 'reply', 'returns', 'import', 'type', 'actor', 'end']);

export function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    // Double newline — block separator (spacious mode)
    if (source[i] === '\n' && source[i + 1] === '\n') {
      tokens.push({ type: 'BLOCK_SEP' });
      i += 2;
      while (i < source.length && source[i] === '\n') i++;
      continue;
    }

    // Single newline
    if (source[i] === '\n') {
      tokens.push({ type: 'NEWLINE' });
      i++;
      continue;
    }

    // Whitespace
    if (source[i] === ' ' || source[i] === '\t') {
      i++;
      continue;
    }

    // String literal
    if (source[i] === '"') {
      let value = '';
      i++;
      while (i < source.length && source[i] !== '"') {
        value += source[i++];
      }
      i++; // closing quote
      tokens.push({ type: 'STRING', value });
      continue;
    }

    // Equals
    if (source[i] === '=') {
      tokens.push({ type: 'EQUALS' });
      i++;
      continue;
    }

    // Arithmetic operators
    if (source[i] === '+') { tokens.push({ type: 'PLUS',  value: '+' }); i++; continue; }
    if (source[i] === '-') { tokens.push({ type: 'MINUS', value: '-' }); i++; continue; }
    if (source[i] === '*') { tokens.push({ type: 'STAR',  value: '*' }); i++; continue; }

    // Integer literals
    if (/[0-9]/.test(source[i])) {
      let num = '';
      while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
      tokens.push({ type: 'NUMBER', value: Number(num) });
      continue;
    }

    // Colon or sigil (:name — colon immediately followed by identifier)
    if (source[i] === ':') {
      if (i + 1 < source.length && /[a-zA-Z_]/.test(source[i + 1])) {
        i++; // skip ':'
        let name = '';
        while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
        tokens.push({ type: 'SIGIL', value: name });
      } else {
        tokens.push({ type: 'COLON' });
        i++;
      }
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(source[i])) {
      let value = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
        value += source[i++];
      }
      tokens.push({ type: KEYWORDS.has(value) ? 'KEYWORD' : 'IDENT', value });
      continue;
    }

    // #Name — end qualifier
    if (source[i] === '#') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name) tokens.push({ type: 'HASH_IDENT', value: name });
      continue;
    }

    i++; // skip unknown characters
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}
