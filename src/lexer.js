const KEYWORDS = new Set(['on', 'proc', 'reply', 'returns', 'return', 'import', 'type', 'actor', 'end']);

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let atLineStart = true;
  let inBlockComment = false;

  while (i < source.length) {
    // ── Block comment mode: skip everything, watch for closing toggle ────────
    if (inBlockComment) {
      if (source[i] === '\n') { atLineStart = true; i++; continue; }
      if (source[i] === ' ' || source[i] === '\t') { i++; continue; }
      if (atLineStart && source[i] === '-') {
        let j = i;
        while (j < source.length && source[j] === '-') j++;
        let k = j;
        while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
        if ((j - i) > 2 && (k >= source.length || source[k] === '\n')) {
          inBlockComment = false;
          i = k;
          if (i < source.length && source[i] === '\n') i++;
          atLineStart = true;
          continue;
        }
      }
      atLineStart = false;
      i++;
      continue;
    }

    // ── // line comment (anywhere on the line) ───────────────────────────────
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // ── Double newline → BLOCK_SEP ───────────────────────────────────────────
    if (source[i] === '\n' && source[i + 1] === '\n') {
      tokens.push({ type: 'BLOCK_SEP' });
      i += 2;
      while (i < source.length && source[i] === '\n') i++;
      atLineStart = true;
      continue;
    }

    // ── Single newline ───────────────────────────────────────────────────────
    if (source[i] === '\n') {
      tokens.push({ type: 'NEWLINE' });
      i++;
      atLineStart = true;
      continue;
    }

    // ── Whitespace (does not clear atLineStart) ──────────────────────────────
    if (source[i] === ' ' || source[i] === '\t') { i++; continue; }

    // ── Dash comment — must be first non-whitespace on the line ─────────────
    if (atLineStart && source[i] === '-' && i + 1 < source.length && source[i + 1] === '-') {
      let j = i;
      while (j < source.length && source[j] === '-') j++;
      const dashCount = j - i;
      let k = j;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
      const atEOL = k >= source.length || source[k] === '\n';
      if (dashCount > 2 && atEOL) {
        inBlockComment = true;
        i = k;
        if (i < source.length && source[i] === '\n') i++;
        atLineStart = true;
      } else {
        // single-line dash comment: skip to end of line (leave '\n' for NEWLINE token)
        while (i < source.length && source[i] !== '\n') i++;
      }
      continue;
    }

    // ── Everything below is a real token: clear line-start flag ─────────────
    atLineStart = false;

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

    // Ellipsis (rest / spread)
    if (source[i] === '.' && source[i + 1] === '.' && source[i + 2] === '.') {
      tokens.push({ type: 'ELLIPSIS' });
      i += 3;
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

    if (source[i] === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }
    if (source[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (source[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (source[i] === '[') { tokens.push({ type: 'LBRACKET' }); i++; continue; }
    if (source[i] === ']') { tokens.push({ type: 'RBRACKET' }); i++; continue; }
    if (source[i] === '{') { tokens.push({ type: 'LBRACE' }); i++; continue; }
    if (source[i] === '}') { tokens.push({ type: 'RBRACE' }); i++; continue; }
    if (source[i] === '/') { tokens.push({ type: 'SLASH', value: '/' }); i++; continue; }

    i++; // skip unknown characters
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}
