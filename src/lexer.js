const KEYWORDS = new Set(['on', 'proc', 'reply', 'returns', 'return', 'type', 'actor', 'end', 'of', 'null', 'over', 'reduce', 'if', 'else', 'true', 'false', 'init', 'while', 'repeat', 'until', 'ref', 'use', 'spawn', 'as']);

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

    // ── // line comment — bare (empty) // emits DIVIDER; // with content skips ─
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '/') {
      let j = i + 2;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
      if (j >= source.length || source[j] === '\n') {
        // bare // — block divider / stitch
        tokens.push({ type: 'DIVIDER' });
        i = j;
        if (i < source.length && source[i] === '\n') i++;
        atLineStart = true;
      } else {
        // // with content — line comment, skip to end of line
        while (i < source.length && source[i] !== '\n') i++;
      }
      continue;
    }

    // ── Newline — whitespace-only lines are treated as blank lines ────────────
    if (source[i] === '\n') {
      let j = i + 1;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
      if (j < source.length && source[j] === '\n') {
        // blank or whitespace-only line → BLOCK_SEP; skip all further blank lines
        tokens.push({ type: 'BLOCK_SEP' });
        i = j + 1;
        while (i < source.length) {
          if (source[i] === '\n') { i++; continue; }
          let k = i;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
          if (k < source.length && source[k] === '\n') { i = k + 1; continue; }
          break;
        }
      } else {
        tokens.push({ type: 'NEWLINE' });
        i++;
      }
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
      } else if (dashCount >= 2 && atEOL) {
        // bare -- — block divider / stitch (leave '\n' for NEWLINE token)
        tokens.push({ type: 'DIVIDER' });
        i = k;
      } else {
        // dash comment with content: skip to end of line (leave '\n' for NEWLINE token)
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

    // Comparison operators (must come before single =, >, <)
    if (source[i] === '=' && source[i+1] === '=') { tokens.push({ type: 'EQ' }); i += 2; continue; }
    if (source[i] === '!' && source[i+1] === '=') { tokens.push({ type: 'NEQ' }); i += 2; continue; }
    if (source[i] === '!') { tokens.push({ type: 'BANG' }); i++; continue; }
    if (source[i] === '>' && source[i+1] === '=') { tokens.push({ type: 'GTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '=') { tokens.push({ type: 'LTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '-') { tokens.push({ type: 'PUT' }); i += 2; continue; }
    if (source[i] === '>') { tokens.push({ type: 'GT' }); i++; continue; }
    if (source[i] === '<') { tokens.push({ type: 'LT' }); i++; continue; }

    // Arrow for callable types
    if (source[i] === '-' && i + 1 < source.length && source[i + 1] === '>') {
      tokens.push({ type: '->', value: '->' });
      i += 2;
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

    // Dot (single, not ellipsis)
    if (source[i] === '.' && !(source[i + 1] === '.' && source[i + 2] === '.')) {
      tokens.push({ type: 'DOT' });
      i++;
      continue;
    }

    // Arithmetic operators
    if (source[i] === '+') { tokens.push({ type: 'PLUS',  value: '+' }); i++; continue; }
    if (source[i] === '-') { tokens.push({ type: 'MINUS', value: '-' }); i++; continue; }
    if (source[i] === '*') { tokens.push({ type: 'STAR',  value: '*' }); i++; continue; }

    // Numeric literals (integer, decimal, or scientific/float)
    if (/[0-9]/.test(source[i])) {
      let num = '';
      while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
        num += source[i++]; // decimal point
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        if ((source[i] === 'E' || source[i] === 'e') &&
            (source[i + 1] === '+' || source[i + 1] === '-' || /[0-9]/.test(source[i + 1] ?? ''))) {
          num += source[i++]; // E/e
          if (source[i] === '+' || source[i] === '-') num += source[i++];
          while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
          tokens.push({ type: 'NUMBER', numKind: 'Float', value: Number(num) });
        } else {
          tokens.push({ type: 'NUMBER', numKind: 'Decimal', value: Number(num) });
        }
      } else if ((source[i] === 'E' || source[i] === 'e') &&
                 (source[i + 1] === '+' || source[i + 1] === '-' || /[0-9]/.test(source[i + 1] ?? ''))) {
        num += source[i++]; // E/e
        if (source[i] === '+' || source[i] === '-') num += source[i++];
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        tokens.push({ type: 'NUMBER', numKind: 'Float', value: Number(num) });
      } else {
        tokens.push({ type: 'NUMBER', numKind: 'Integer', value: Number(num) });
      }
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
      if (value === '_') {
        tokens.push({ type: 'DISCARD' });
      } else {
        tokens.push({ type: KEYWORDS.has(value) ? 'KEYWORD' : 'IDENT', value });
      }
      continue;
    }

    // $name — state variable
    if (source[i] === '$') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name) tokens.push({ type: 'DOLLAR_IDENT', value: name });
      continue;
    }

    // &name — proc reference
    if (source[i] === '&') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name) tokens.push({ type: 'AMPERSAND_IDENT', value: name });
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

    if (source[i] === ';') { tokens.push({ type: 'NEWLINE' }); i++; continue; }
    if (source[i] === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }
    if (source[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (source[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (source[i] === '[') { tokens.push({ type: 'LBRACKET' }); i++; continue; }
    if (source[i] === ']') { tokens.push({ type: 'RBRACKET' }); i++; continue; }
    if (source[i] === '{') { tokens.push({ type: 'LBRACE' }); i++; continue; }
    if (source[i] === '}') { tokens.push({ type: 'RBRACE' }); i++; continue; }
    if (source[i] === '/') { tokens.push({ type: 'SLASH', value: '/' }); i++; continue; }
    if (source[i] === '|') { tokens.push({ type: 'PIPE' }); i++; continue; }

    i++; // skip unknown characters
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}
