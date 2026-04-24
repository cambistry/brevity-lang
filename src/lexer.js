const KEYWORDS = new Set(['returns', 'type', 'end', 'of', 'null', 'over', 'reduce', 'if', 'else', 'true', 'false', 'while', 'repeat', 'until', 'spawn', 'as', 'self', 'set', 'update', 'emit', 'on', 'subscribe', 'ingest']);

// Parse a lowercase DOM element `<tag>…</tag>` starting at `startIdx`
// (which must point at `<`). Returns `{ tag, children, nextIdx }` or null
// if the markup is malformed (no close, bad opener). Children may contain
// nested dom nodes — same-tag nesting handled correctly via recursion.
function parseDomElement(source, startIdx) {
  let j = startIdx + 1;
  let tag = '';
  while (j < source.length && /[a-z0-9]/.test(source[j])) tag += source[j++];
  if (!tag || source[j] !== '>') return null;
  const bodyStart = j + 1;
  const result = parseDomChildren(source, bodyStart, tag);
  if (result === null) return null;
  return { tag, children: result.children, nextIdx: result.nextIdx };
}

// Walk the body of a `<parentTag>…</parentTag>` element, building a children
// array of text runs, `{ expr }` interpolations, and nested dom elements.
// Returns `{ children, nextIdx }` where nextIdx points past the matching
// close tag, or null if no matching close tag is found.
//
// Children shapes:
//   { type: 'text', value }        — literal text run (whitespace-significant)
//   { type: 'interp', source }     — `{ expr }` source for the parser to re-parse
//   { type: 'dom', tag, children } — nested lowercase element (recursive)
function parseDomChildren(source, startIdx, parentTag) {
  const closeTag = `</${parentTag}>`;
  const children = [];
  let textBuf = '';
  let i = startIdx;
  const flushText = () => {
    if (textBuf) { children.push({ type: 'text', value: textBuf }); textBuf = ''; }
  };
  while (i < source.length) {
    if (source.startsWith(closeTag, i)) {
      flushText();
      return { children, nextIdx: i + closeTag.length };
    }
    if (source[i] === '<' && source[i + 1] && /[a-z]/.test(source[i + 1])) {
      const nested = parseDomElement(source, i);
      if (nested) {
        flushText();
        children.push({ type: 'dom', tag: nested.tag, children: nested.children });
        i = nested.nextIdx;
        continue;
      }
    }
    if (source[i] === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
        if (depth > 0) j++;
      }
      if (depth === 0) {
        flushText();
        children.push({ type: 'interp', source: source.slice(i + 1, j).trim() });
        i = j + 1;
        continue;
      }
    }
    textBuf += source[i];
    i++;
  }
  return null;
}

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

    // Double-quoted string literal — supports #{expr} interpolation and
    // backslash escapes (\#{, \\, \", \', \n, \t, \r, \u{…}, \xXX).
    // Bare backslash before an unrecognised character is a compile error.
    if (source[i] === '"') {
      i++; // opening "
      const parts = [];
      let textBuf = '';
      let hasInterp = false;
      const flushText = () => {
        if (textBuf !== '') { parts.push({ kind: 'text', value: textBuf }); textBuf = ''; }
      };
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          i++;
          if (i >= source.length) throw new Error('Unterminated string literal');
          const esc = source[i];
          if (esc === 'n') { textBuf += '\n'; i++; }
          else if (esc === 't') { textBuf += '\t'; i++; }
          else if (esc === 'r') { textBuf += '\r'; i++; }
          else if (esc === '"') { textBuf += '"'; i++; }
          else if (esc === "'") { textBuf += "'"; i++; }
          else if (esc === '\\') { textBuf += '\\'; i++; }
          else if (esc === '#') {
            // \# is valid only when immediately followed by { — it escapes
            // the interpolation marker. \# anywhere else is an error.
            if (source[i + 1] !== '{') {
              throw new Error('Invalid escape "\\#" in string literal: must be followed by "{" (use "\\#{" to suppress interpolation)');
            }
            textBuf += '#';
            i++;
            // Leave '{' to be consumed as a literal text char on the next pass.
          }
          else if (esc === 'u') {
            if (source[i + 1] !== '{') {
              throw new Error('Invalid escape "\\u": must be followed by "{XXXX}" hex code point');
            }
            let j = i + 2;
            let hex = '';
            while (j < source.length && /[0-9a-fA-F]/.test(source[j])) { hex += source[j]; j++; }
            if (hex.length === 0) throw new Error('Invalid escape "\\u{}": empty hex code point');
            if (source[j] !== '}') throw new Error('Invalid escape "\\u{…}": expected closing "}"');
            const code = parseInt(hex, 16);
            if (code > 0x10FFFF) throw new Error(`Invalid escape "\\u{${hex}}": code point out of range`);
            textBuf += String.fromCodePoint(code);
            i = j + 1;
          }
          else if (esc === 'x') {
            const h1 = source[i + 1];
            const h2 = source[i + 2];
            if (!h1 || !h2 || !/[0-9a-fA-F]/.test(h1) || !/[0-9a-fA-F]/.test(h2)) {
              throw new Error('Invalid escape "\\x": expected two hex digits');
            }
            textBuf += String.fromCharCode(parseInt(h1 + h2, 16));
            i += 3;
          }
          else {
            throw new Error(`Invalid escape sequence "\\${esc}" in string literal`);
          }
        } else if (source[i] === '#' && source[i + 1] === '{') {
          hasInterp = true;
          flushText();
          i += 2; // consume #{
          const exprStart = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            const ch = source[i];
            if (ch === '"') {
              // Skip a nested double-quoted string (respects \" escapes)
              i++;
              while (i < source.length && source[i] !== '"') {
                if (source[i] === '\\' && i + 1 < source.length) i += 2;
                else i++;
              }
              if (i < source.length) i++;
            } else if (ch === "'") {
              // Skip a nested single-quoted string (raw, '' = literal ')
              i++;
              while (i < source.length) {
                if (source[i] === "'" && source[i + 1] === "'") { i += 2; continue; }
                if (source[i] === "'") { i++; break; }
                i++;
              }
            } else if (ch === '{') {
              depth++; i++;
            } else if (ch === '}') {
              depth--;
              if (depth === 0) break;
              i++;
            } else {
              i++;
            }
          }
          if (depth !== 0) throw new Error('Unterminated interpolation #{…} in string literal');
          const exprSource = source.slice(exprStart, i);
          i++; // consume closing }
          parts.push({ kind: 'expr', source: exprSource });
        } else {
          textBuf += source[i++];
        }
      }
      if (i >= source.length) throw new Error('Unterminated string literal');
      i++; // closing "
      flushText();
      if (hasInterp) {
        tokens.push({ type: 'INTERP_STRING', parts });
      } else {
        tokens.push({ type: 'STRING', value: parts.length === 0 ? '' : parts[0].value });
      }
      continue;
    }

    // Single-quoted string literal — RAW. No interpolation, no backslash
    // escapes. A literal single quote is written by doubling: 'a''b' → a'b.
    if (source[i] === "'") {
      i++; // opening '
      let value = '';
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") { value += "'"; i += 2; continue; }
        if (source[i] === "'") { i++; break; }
        value += source[i++];
      }
      tokens.push({ type: 'STRING', value });
      continue;
    }

    // Comparison operators (must come before single =, >, <)
    if (source[i] === '=' && source[i+1] === '=') { tokens.push({ type: 'EQ' }); i += 2; continue; }
    if (source[i] === '!' && source[i+1] === '=') { tokens.push({ type: 'NEQ' }); i += 2; continue; }
    if (source[i] === '!') { tokens.push({ type: 'BANG' }); i++; continue; }
    if (source[i] === '>' && source[i+1] === '=') { tokens.push({ type: 'GTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '=') { tokens.push({ type: 'LTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '-') { tokens.push({ type: 'SET' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '|') { tokens.push({ type: 'UPDATE' }); i += 2; continue; }
    if (source[i] === '>') { tokens.push({ type: 'GT' }); i++; continue; }
    // DOM constructor (lowercase tag form): <tag>…</tag>, recursively
    // capturing nested lowercase elements. Same-tag nesting is handled
    // correctly (the old flat `indexOf('</tag>')` silently picked the
    // wrong close on `<div><div>…</div></div>`).
    if (source[i] === '<' && source[i+1] && /[a-z]/.test(source[i+1])) {
      const el = parseDomElement(source, i);
      if (el) {
        tokens.push({ type: 'DOM_CONSTRUCTOR', tag: el.tag, children: el.children });
        i = el.nextIdx;
        continue;
      }
    }
    if (source[i] === '<') { tokens.push({ type: 'LT' }); i++; continue; }

    // Arrow for function types
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
    if (source[i] === '*' && source[i + 1] === '*') { tokens.push({ type: 'POWER', value: '**' }); i += 2; continue; }
    if (source[i] === '*') { tokens.push({ type: 'STAR',  value: '*' }); i++; continue; }
    if (source[i] === '%') { tokens.push({ type: 'PERCENT', value: '%' }); i++; continue; }

    // Numeric literals (integer, decimal, or scientific/float)
    // Decimal/Integer retain exact digit strings so precision survives lex→codegen.
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
          tokens.push({ type: 'NUMBER', numKind: 'Decimal', value: num });
        }
      } else if ((source[i] === 'E' || source[i] === 'e') &&
                 (source[i + 1] === '+' || source[i + 1] === '-' || /[0-9]/.test(source[i + 1] ?? ''))) {
        num += source[i++]; // E/e
        if (source[i] === '+' || source[i] === '-') num += source[i++];
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        tokens.push({ type: 'NUMBER', numKind: 'Float', value: Number(num) });
      } else {
        tokens.push({ type: 'NUMBER', numKind: 'Integer', value: num });
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
      if (i < source.length && source[i] === '?') { value += source[i++]; }
      if (value === '_') {
        tokens.push({ type: 'DISCARD' });
      } else {
        tokens.push({ type: KEYWORDS.has(value) ? 'KEYWORD' : 'IDENT', value });
      }
      continue;
    }

    // @name — public function sigil
    if (source[i] === '@') { tokens.push({ type: 'AT' }); i++; continue; }

    // $name — deprecated state variable syntax
    if (source[i] === '$') {
      throw new Error(`'$' state variables are deprecated (line ${tokens.filter(t => t.type === 'NEWLINE').length + 1}). Use '*Type' declarations instead.`);
    }

    // &name — function reference
    if (source[i] === '&') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name) tokens.push({ type: 'AMPERSAND_IDENT', value: name });
      continue;
    }

    // #Name — end qualifier;  bare # — generic-constructor sigil
    if (source[i] === '#') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name) tokens.push({ type: 'HASH_IDENT', value: name });
      else tokens.push({ type: 'HASH' });
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
    if (source[i] === '/') {
      const prev = tokens[tokens.length - 1]?.type;
      const isValue = prev && ['NUMBER', 'STRING', 'IDENT', 'RPAREN', 'RBRACKET'].includes(prev);
      if (!isValue) {
        let j = i + 1, pattern = '', escaped = false, inCC = false;
        while (j < source.length) {
          if (escaped) { pattern += source[j]; escaped = false; j++; continue; }
          if (source[j] === '\\') { pattern += source[j]; escaped = true; j++; continue; }
          if (source[j] === '[') { inCC = true; pattern += source[j]; j++; continue; }
          if (source[j] === ']') { inCC = false; pattern += source[j]; j++; continue; }
          if (source[j] === '/' && !inCC) break;
          if (source[j] === '\n') break;
          pattern += source[j]; j++;
        }
        if (j < source.length && source[j] === '/' && pattern.length > 0) {
          j++;
          let flags = '';
          while (j < source.length && /[gimsu]/.test(source[j])) flags += source[j++];
          tokens.push({ type: 'REGEX', pattern, flags });
          i = j;
          continue;
        }
      }
      tokens.push({ type: 'SLASH', value: '/' }); i++; continue;
    }
    if (source[i] === '|') { tokens.push({ type: 'PIPE' }); i++; continue; }

    i++; // skip unknown characters
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}
