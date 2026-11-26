const KEYWORDS = new Set(['return', 'returns', 'type', 'end', 'of', 'null', 'over', 'reduce', 'if', 'else', 'true', 'false', 'while', 'repeat', 'until', 'as', 'self', 'set', 'update', 'sub', 'ingest', 'catch', 'untracked', 'new', 'class', 'base', 'super', 'use']);

// Parse a lowercase HTML element `<tag>…</tag>` starting at `startIdx`
// (which must point at `<`). Returns `{ tag, children, nextIdx }` or null
// if the markup is malformed (no close, bad opener). Children may contain
// nested dom nodes — same-tag nesting handled correctly via recursion.
function parseDomElement(source, startIdx) {
  let j = startIdx + 1;
  let tag = '';
  while (j < source.length && /[a-z0-9]/.test(source[j])) tag += source[j++];
  if (!tag) return null;

  const attrsStart = j; // position right after the tag name
  const attrs = [];
  while (j < source.length && source[j] !== '>') {
    while (j < source.length && /[ \t\n\r]/.test(source[j])) j++;
    if (source[j] === '>') break;
    let attrName = '';
    while (j < source.length && /[a-zA-Z0-9_\-:]/.test(source[j])) attrName += source[j++];
    if (!attrName) {
      // Non-standard content (e.g. `@decl`) — capture the entire attribute
      // block as raw Brevity source for parseActorBody.
      let depth = 0, k = attrsStart;
      while (k < source.length) {
        if (source[k] === '{') depth++;
        else if (source[k] === '}') { if (depth > 0) depth--; }
        else if (source[k] === '>' && depth === 0) break;
        k++;
      }
      if (source[k] !== '>') return null;
      const bvBlock = source.slice(attrsStart, k);
      const bodyStart = k + 1;
      const result = parseDomChildren(source, bodyStart, tag);
      if (result === null) return null;
      return { tag, bvBlock, children: result.children, nextIdx: result.nextIdx };
    }
    while (j < source.length && /[ \t]/.test(source[j])) j++;
    if (source[j] !== '=') return null;
    j++;
    while (j < source.length && /[ \t]/.test(source[j])) j++;
    if (source[j] === '"') {
      j++;
      let value = '';
      while (j < source.length && source[j] !== '"') value += source[j++];
      if (source[j] !== '"') return null;
      j++;
      attrs.push({ name: attrName, value: { type: 'text', value } });
    } else if (source[j] === '{') {
      let depth = 1;
      let k = j + 1;
      while (k < source.length && depth > 0) {
        if (source[k] === '{') depth++;
        else if (source[k] === '}') depth--;
        if (depth > 0) k++;
      }
      if (depth !== 0) return null;
      attrs.push({ name: attrName, value: { type: 'interp', source: source.slice(j + 1, k).trim() } });
      j = k + 1;
    } else {
      return null;
    }
    while (j < source.length && /[ \t\n\r]/.test(source[j])) j++;
  }

  if (source[j] !== '>') return null;
  const bodyStart = j + 1;
  const result = parseDomChildren(source, bodyStart, tag);
  if (result === null) return null;
  return { tag, attrs, children: result.children, nextIdx: result.nextIdx };
}

// Walk the body of a `<parentTag>…</parentTag>` element, building a children
// array of text runs, interpolations (reactive closure or static splice),
// and nested dom elements. Returns `{ children, nextIdx }` where nextIdx
// points past the matching close tag, or null if no matching close tag is
// found.
//
// Children shapes:
//   { type: 'text', value }        — literal text run (whitespace-significant)
//   { type: 'interp', source }     — `{{ expr }}` — reactive closure ref
//   { type: 'strinterp', source }  — `#{ expr }` — snapshot string splice
//   { type: 'dom', tag, children } — nested lowercase element (recursive)
//
// A lone `{` or `}` is literal text, so CSS and prose braces need no escape.
// `{{ expr }}` closes at the first `}}` with the expression's own braces
// balanced: `{{ f({a: 1}) }}`.
//
// Escapes in raw XML text: `\\` → `\`, `\{` → `{`, `\#{` → `#{`. Any other
// backslash escape is a compile error.
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
        children.push({ type: 'dom', tag: nested.tag, attrs: nested.attrs, children: nested.children });
        i = nested.nextIdx;
        continue;
      }
    }
    if (source[i] === '\\') {
      const n1 = source[i + 1];
      if (n1 === '\\') { textBuf += '\\'; i += 2; continue; }
      if (n1 === '{')  { textBuf += '{';  i += 2; continue; }
      if (n1 === '#' && source[i + 2] === '{') { textBuf += '#{'; i += 3; continue; }
      const shown = n1 === undefined ? '\\' : '\\' + n1;
      throw new Error(`Invalid escape in XML text: '${shown}' (valid: \\\\, \\{, \\#{)`);
    }
    if (source[i] === '#' && source[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
        if (depth > 0) j++;
      }
      if (depth === 0) {
        flushText();
        children.push({ type: 'strinterp', source: source.slice(i + 2, j).trim() });
        i = j + 1;
        continue;
      }
    }
    if (source[i] === '{' && source[i + 1] === '{') {
      let depth = 0;
      let j = i + 2;
      while (j < source.length && !(depth === 0 && source[j] === '}' && source[j + 1] === '}')) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
        j++;
      }
      if (j >= source.length) throw new Error(`Unterminated '{{' in <${parentTag}> content (write '\\{{' for a literal '{{')`);
      flushText();
      children.push({ type: 'interp', source: source.slice(i + 2, j).trim() });
      i = j + 2;
      continue;
    }
    textBuf += source[i];
    i++;
  }
  return null;
}

// A `.` glued to the end of a name marks a silent function (`sfn.`). Counts the
// run of dots at `i`, just past a name: one dot not starting a member name is
// the suffix; three are an ellipsis (`sfn...`, which absorbs the suffix); two or
// four-plus are errors. Returns the number of dots to absorb into the name.
function silentSuffixAt(source, i, name, line) {
  let n = 0;
  while (source[i + n] === '.') n++;
  if (n === 1) {
    const next = source[i + 1] ?? '';
    return /[a-zA-Z_]/.test(next) ? 0 : 1;
  }
  if (n === 2) throw new Error(`Unexpected '..' after '${name}' (line ${line})`);
  return 0;
}

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  // Every token carries the line it starts on, and where in the source it starts.
  let tokStart = 0, line = 1, scanned = 0;
  const lineAt = (k) => {
    if (k < scanned) { line = 1; scanned = 0; }
    for (; scanned < k; scanned++) if (source[scanned] === '\n') line++;
    return line;
  };
  const emit = (tok) => { tok.line = lineAt(tokStart); tok.start = tokStart; tokens.push(tok); };
  let atLineStart = true;
  let inBlockComment = false;

  while (i < source.length) {
    tokStart = i;
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
        emit({ type: 'DIVIDER' });
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
        emit({ type: 'BLOCK_SEP' });
        i = j + 1;
        while (i < source.length) {
          if (source[i] === '\n') { i++; continue; }
          let k = i;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
          if (k < source.length && source[k] === '\n') { i = k + 1; continue; }
          break;
        }
      } else {
        emit({ type: 'NEWLINE' });
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
        emit({ type: 'DIVIDER' });
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
        emit({ type: 'INTERP_STRING', parts });
      } else {
        emit({ type: 'STRING', value: parts.length === 0 ? '' : parts[0].value });
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
      emit({ type: 'STRING', value });
      continue;
    }

    // Comparison operators (must come before single =, >, <)
    // The effect arrows of a signature: `=>` writes, `~>` purports to read. They
    // lex as arrows; the parser only accepts them in signatures.
    if ((source[i] === '=' || source[i] === '~') && source[i+1] === '>') { emit({ type: '->', value: source[i] + '>' }); i += 2; continue; }
    // `~` is only ever part of `~>`. (On the wire it marks a protected name; in source a
    // protected name is bare.)
    if (source[i] === '~') throw new Error(`Unexpected '~' (line ${lineAt(i)})`);
    if (source[i] === '=' && source[i+1] === '=') { emit({ type: 'EQ' }); i += 2; continue; }
    if (source[i] === '!' && source[i+1] === '=') { emit({ type: 'NEQ' }); i += 2; continue; }
    if (source[i] === '!') { emit({ type: 'BANG' }); i++; continue; }
    if (source[i] === '>' && source[i+1] === '=') { emit({ type: 'GTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '=') { emit({ type: 'LTE' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '-') { emit({ type: 'SET' }); i += 2; continue; }
    if (source[i] === '<' && source[i+1] === '|') { emit({ type: 'UPDATE' }); i += 2; continue; }
    if (source[i] === '>') { emit({ type: 'GT' }); i++; continue; }
    // HTML constructor (lowercase tag form): <tag>…</tag>, recursively
    // capturing nested lowercase elements. Same-tag nesting is handled
    // correctly (the old flat `indexOf('</tag>')` silently picked the
    // wrong close on `<div><div>…</div></div>`).
    if (source[i] === '<' && source[i+1] && /[a-z]/.test(source[i+1])) {
      const el = parseDomElement(source, i);
      if (el) {
        emit({ type: 'HTML_CONSTRUCTOR', tag: el.tag, children: el.children,
          ...(el.bvBlock !== undefined ? { bvBlock: el.bvBlock } : { attrs: el.attrs }) });
        i = el.nextIdx;
        continue;
      }
    }
    if (source[i] === '<') { emit({ type: 'LT' }); i++; continue; }

    // Arrow for function types
    if (source[i] === '-' && i + 1 < source.length && source[i + 1] === '>') {
      emit({ type: '->', value: '->' });
      i += 2;
      continue;
    }

    // Equals
    if (source[i] === '=') {
      emit({ type: 'EQUALS' });
      i++;
      continue;
    }

    // Ellipsis (rest / spread)
    if (source[i] === '.' && source[i + 1] === '.' && source[i + 2] === '.') {
      emit({ type: 'ELLIPSIS' });
      i += 3;
      continue;
    }

    // Dot (single, not ellipsis)
    if (source[i] === '.' && !(source[i + 1] === '.' && source[i + 2] === '.')) {
      emit({ type: 'DOT' });
      i++;
      continue;
    }

    // Arithmetic operators
    if (source[i] === '+') { emit({ type: 'PLUS',  value: '+' }); i++; continue; }
    if (source[i] === '-') { emit({ type: 'MINUS', value: '-' }); i++; continue; }
    // `^` is the exponent. `**` is reserved for lineal singletons (the braced form
    // is `actor { }`); the parser rejects it as an operator.
    if (source[i] === '^') { emit({ type: 'POWER', value: '^' }); i++; continue; }
    if (source[i] === '*') {
      // Lineal headers require `*` (a constructor) or `**` (a lineal singleton)
      // to be the only token on its line. `alone`: nothing but whitespace on
      // either side. `aloneBeforeBrace`: first on its line and followed only by
      // `{` (closing star of a lineal header opening a delimited body).
      const width = source[i + 1] === '*' ? 2 : 1;
      const tok = width === 2 ? { type: 'STARSTAR', value: '**' } : { type: 'STAR', value: '*' };
      let b = i - 1;
      while (b >= 0 && (source[b] === ' ' || source[b] === '\t')) b--;
      if (b < 0 || source[b] === '\n') {
        let f = i + width;
        while (f < source.length && (source[f] === ' ' || source[f] === '\t')) f++;
        if (f >= source.length || source[f] === '\n') tok.alone = true;
        else if (source[f] === '{') tok.aloneBeforeBrace = true;
      }
      emit(tok); i += width; continue;
    }
    if (source[i] === '%') { emit({ type: 'PERCENT', value: '%' }); i++; continue; }

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
          emit({ type: 'NUMBER', numKind: 'Float', value: Number(num) });
        } else {
          emit({ type: 'NUMBER', numKind: 'Decimal', value: num });
        }
      } else if ((source[i] === 'E' || source[i] === 'e') &&
                 (source[i + 1] === '+' || source[i + 1] === '-' || /[0-9]/.test(source[i + 1] ?? ''))) {
        num += source[i++]; // E/e
        if (source[i] === '+' || source[i] === '-') num += source[i++];
        while (i < source.length && /[0-9]/.test(source[i])) num += source[i++];
        emit({ type: 'NUMBER', numKind: 'Float', value: Number(num) });
      } else {
        emit({ type: 'NUMBER', numKind: 'Integer', value: num });
      }
      continue;
    }

    // Double colon — reaches a type, or a protected member, through an actor:
    // `Svc::Point`, `C::total`. Distinct from the
    // `:name` named-param sigil and the bare `COLON` separator below.
    if (source[i] === ':' && source[i + 1] === ':') {
      emit({ type: 'DCOLON' });
      i += 2;
      continue;
    }

    // Colon or sigil (:name — colon immediately followed by identifier)
    if (source[i] === ':') {
      if (i + 1 < source.length && /[a-zA-Z_]/.test(source[i + 1])) {
        i++; // skip ':'
        let name = '';
        while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
        if (source[i] === '!' && source[i + 1] !== '=') name += source[i++];
        if (source[i] === '.' && silentSuffixAt(source, i, ':' + name, lineAt(i))) { name += '.'; i++; }
        emit({ type: 'SIGIL', value: name });
      } else {
        emit({ type: 'COLON' });
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
        emit({ type: 'DISCARD' });
      } else if (!value.endsWith('?') && source[i] === '.' &&
                 silentSuffixAt(source, i, value, lineAt(i))) {
        emit({ type: 'IDENT', value: value + '.' });
        i++;
      } else if (!value.endsWith('?') && source[i] === '!' && source[i + 1] !== '=' && !KEYWORDS.has(value)) {
        // A `!` glued to the end of a name is part of it: the function writes.
        // A keyword keeps its own token (`.reduce!` is a built-in method).
        emit({ type: 'IDENT', value: value + '!' });
        i++;
      } else if ((value === 'untracked' || value === 'class' || value === 'base' || value === 'super' || value === 'use') && (tokens[tokens.length - 1]?.type === 'DOT' || (value === 'use' && tokens[tokens.length - 1]?.type === 'AT') || (source[i] === ':' && source[i + 1] !== ':'))) {
        // Reserved as a name of its own: a member or a key can have this name.
        emit({ type: 'IDENT', value });
      } else {
        // `class` names the running actor's class, so nothing can be declared or set
        // under it: `class = …`, `class <- …`, `class *Integer = …`, `(class Integer)`.
        // A member may have the name (`@class`, `k.class()`), and so may an attribute
        // (`<Box class="a" />`).
        const asMember = tokens[tokens.length - 1]?.type === 'AT' || /^=["{]/.test(source.slice(i));
        // After a name, `*`, `|`, `of` or `as !`, it's a type: `child class = …`.
        const prevTok = tokens[tokens.length - 1];
        const asType = prevTok && (['IDENT', 'STAR', 'PIPE'].includes(prevTok.type) || (prevTok.type === 'KEYWORD' && prevTok.value === 'of')
          || (prevTok.type === 'BANG' && tokens[tokens.length - 2]?.type === 'KEYWORD' && tokens[tokens.length - 2].value === 'as'));
        if (value === 'class' && !asMember && !asType && /^[ \t]*(=(?![=>])|<-|<\||\*[ \t]*[A-Za-z]|[A-Za-z_]\w*[ \t]*(=(?![=>])|[,)]))/.test(source.slice(i))) {
          throw new Error(`'class' is reserved: it names the class of the running actor, so it can't be declared or set (line ${lineAt(i)})`);
        }
        // `base` names the parent layer, likewise: `base = …`, `(base Integer)`.
        if (value === 'base' && !asMember && /^[ \t]*(=(?![=>])|<-|<\||\*[ \t]*[A-Za-z]|[A-Za-z_]\w*[ \t]*(=(?![=>])|[,)]))/.test(source.slice(i))) {
          throw new Error(`'base' is reserved: it names the parent layer, so it can't be declared or set (line ${lineAt(i)})`);
        }
        emit({ type: KEYWORDS.has(value) ? 'KEYWORD' : 'IDENT', value });
      }
      continue;
    }

    // @name — public function sigil
    if (source[i] === '@') { emit({ type: 'AT' }); i++; continue; }

    // &name — function reference
    if (source[i] === '&') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name && source[i] === '.' && silentSuffixAt(source, i, '&' + name, lineAt(i))) { name += '.'; i++; }
      else if (name && source[i] === '!' && source[i + 1] !== '=') { name += '!'; i++; }
      if (!name) throw new Error(`Unexpected character '&' (line ${lineAt(i - 1)})`);
      emit({ type: 'AMPERSAND_IDENT', value: name });
      continue;
    }

    // #Name — end qualifier;  bare # — HASH
    if (source[i] === '#') {
      i++;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) name += source[i++];
      if (name && source[i] === '!' && source[i + 1] !== '=') { name += '!'; i++; }
      if (name) emit({ type: 'HASH_IDENT', value: name });
      else emit({ type: 'HASH' });
      continue;
    }

    // Bare `?` — type-field optional qualifier (prefix), and presence-check
    // operator (postfix on a parenthesized expression). `??` is the
    // null-coalesce / fallback operator (slice 11). Trailing `?` after an
    // identifier is consumed by the IDENT scanner above (e.g. `started?`),
    // so these only fire when `?` stands alone.
    if (source[i] === '?' && source[i + 1] === '?') {
      emit({ type: 'NULL_COALESCE' });
      i += 2;
      continue;
    }
    if (source[i] === '?') { emit({ type: 'QUESTION' }); i++; continue; }
    if (source[i] === ';') { emit({ type: 'NEWLINE' }); i++; continue; }
    if (source[i] === ',') { emit({ type: 'COMMA' }); i++; continue; }
    if (source[i] === '(') { emit({ type: 'LPAREN' }); i++; continue; }
    if (source[i] === ')') { emit({ type: 'RPAREN' }); i++; continue; }
    // After a space or tab, a `[` can't begin a subscript: `xs[0]` indexes, `xs [0]` doesn't.
    if (source[i] === '[') { emit({ type: 'LBRACKET', ...(/[ \t]/.test(source[i - 1] ?? '') && { spaced: true }) }); i++; continue; }
    if (source[i] === ']') { emit({ type: 'RBRACKET' }); i++; continue; }
    if (source[i] === '{') { emit({ type: 'LBRACE' }); i++; continue; }
    if (source[i] === '}') { emit({ type: 'RBRACE' }); i++; continue; }
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
          emit({ type: 'REGEX', pattern, flags });
          i = j;
          continue;
        }
      }
      emit({ type: 'SLASH', value: '/' }); i++; continue;
    }
    if (source[i] === '|') { emit({ type: 'PIPE' }); i++; continue; }

    if (source[i] === '\r' || source[i] === '﻿') { i++; continue; }
    throw new Error(`Unexpected character '${source[i]}' (line ${lineAt(i)})`);
  }

  tokStart = source.length;
  emit({ type: 'EOF' });
  return tokens;
}
