// Opre addresses as tokens. See notes/opre-colon-separator-2026-11-14.md, which
// revises notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
//
// An address is a sequence of tokens separated by `:`. A token holds any
// characters, spaces included. It is written in single quotes only when it must be:
//
//   - it contains a colon:                'bluster://n1'
//   - it starts with `'`:                 '''tis'
//   - it is empty:                        ''
//
// Inside quotes, `''` is one `'`. Outside quotes, `'` is an ordinary character
// (`Chris's-Computer`). Quoting a token that doesn't need it is an error.
//
// A leading `:` makes the address relative to its sender: `:x` is `x` under
// self, and a bare `:` is self. A parent that receives `:x` from child `c`
// rewrites it to `:c:x`; the node at the global boundary replaces the leading
// `:` with its own address and a colon (`self:x`). An address that doesn't
// start with `:` passes through unchanged.
//
// In a token list, self is `null`, and only the head may be self.
//
// These functions are also stringified into the JS runtime preamble, so each
// one stands alone: no module-level constants, and calls between them go only to
// functions listed in OPRE_TOKENS_PREAMBLE below.

// Does `token` have to be written in quotes?
export function _opre_needs_quote(token) {
  return token === '' || token.includes(':') || token.startsWith("'");
}

// One token as it is written in an address. `null` (self) is written as
// nothing: the address's leading `:` stands for it.
export function _opre_quote(token) {
  if (token === null) return '';
  if (typeof token !== 'string') throw new Error('opre: a token is a string');
  return _opre_needs_quote(token) ? "'" + token.replace(/'/g, "''") + "'" : token;
}

// The tokens of an address, self as `null`. Throws on a malformed address: an unclosed quote, a
// quoted token that needn't be, an empty token, or text right after a quote.
export function _opre_split(address) {
  if (typeof address !== 'string') throw new Error('opre: an address is a string');
  const tokens = [];
  if (address === '') return tokens;
  let i = 0;
  if (address[0] === ':') {
    tokens.push(null);
    if (address.length === 1) return tokens;
    i = 1;
  }
  for (;;) {
    let token;
    if (address[i] === "'") {
      let j = i + 1;
      token = '';
      for (;;) {
        if (j >= address.length) throw new Error(`opre: unclosed quote in ${JSON.stringify(address)}`);
        if (address[j] === "'") {
          if (address[j + 1] === "'") { token += "'"; j += 2; continue; }
          j++;
          break;
        }
        token += address[j++];
      }
      if (!_opre_needs_quote(token)) throw new Error(`opre: token ${JSON.stringify(token)} is quoted but needn't be`);
      if (j < address.length && address[j] !== ':') throw new Error(`opre: text after a closing quote in ${JSON.stringify(address)}`);
      i = j;
    } else {
      const sep = address.indexOf(':', i);
      const end = sep === -1 ? address.length : sep;
      token = address.slice(i, end);
      if (token === '') throw new Error(`opre: empty token in ${JSON.stringify(address)}`);
      i = end;
    }
    tokens.push(token);
    if (i >= address.length) return tokens;
    i++; // the separating colon
    if (i >= address.length) throw new Error(`opre: empty token in ${JSON.stringify(address)}`);
  }
}

// The address of a list of tokens. Only the head may be self (`null`).
export function _opre_join(tokens) {
  if (tokens.indexOf(null, 1) !== -1) throw new Error("opre: self is only an address's head token");
  if (tokens[0] === null) return ':' + tokens.slice(1).map(_opre_quote).join(':');
  return tokens.map(_opre_quote).join(':');
}

// Is the address relative to its sender: does it start with `:`?
export function _opre_is_relative(address) {
  return typeof address === 'string' && address.startsWith(':');
}

// A relative address as seen one hop up, by the parent of the child `name` (an
// address of one or more tokens, already written): `:x` → `:name:x`, `:` →
// `:name`. Any other address is unchanged.
export function _opre_under(address, name) {
  if (!_opre_is_relative(address)) return address;
  return ':' + name + (address === ':' ? '' : address);
}

// A relative address made global by the node `self` (an address, already
// written) at the global boundary: `:x` → `self:x`, `:` → `self`. Any other
// address is unchanged.
export function _opre_resolve(address, self) {
  if (!_opre_is_relative(address)) return address;
  return address === ':' ? self : self + address;
}

// Rewrite every `#<…>` address in a string with `f`, which maps the address
// inside the brackets. Escapes stay as they are: `\>` and `\\` inside the
// brackets, and outside them `\#<` (a literal `#<`, not an address) and `\\`.
// See notes/address-delimiter-change-plan-2026-04-23.md.
export function _opre_map_bracketed(s, f) {
  return s.replace(/\\[\s\S]|#<((?:[^>\\]|\\[\s\S])*)>/g, (m, a) => a === undefined ? m : '#<' + f(a) + '>');
}

// An address value (`#<…>`, as in a payload) as the bare address a `to`,
// `from` or `ty` holds: the brackets gone, and the escapes inside them (`\>`,
// `\\`) undone. Anything else is returned as it is.
export function _opre_unbracket(v) {
  if (typeof v !== 'string' || !v.startsWith('#<') || !v.endsWith('>')) return v;
  return v.slice(2, -1).replace(/\\([\s\S])/g, '$1');
}

// Is a received message malformed in its address fields? `to` and `from` hold a
// bare address and `ty` bare tags: an address value's `#<…>` belongs only in a
// payload. A receiver rejects such a message and never routes it.
export function _opre_bad_address(message) {
  const bracketed = (v) => typeof v === 'string' && v.startsWith('#<');
  const anyTag = (v) => (bracketed(v) || (Array.isArray(v) ? v.some(anyTag)
    : (v !== null && typeof v === 'object' && Object.values(v).some(anyTag))));
  return bracketed(message?.to) || bracketed(message?.from) || anyTag(message?.ty);
}

// The functions above, for the JS runtime preamble.
export const OPRE_TOKENS_PREAMBLE = [
  _opre_needs_quote, _opre_quote, _opre_split, _opre_join,
  _opre_is_relative, _opre_under, _opre_resolve, _opre_map_bracketed, _opre_unbracket,
  _opre_bad_address,
].map(f => f.toString()).join('\n');

export { _opre_split as split, _opre_join as join, _opre_quote as quote, _opre_is_relative as isRelative,
  _opre_under as under, _opre_resolve as resolve, _opre_map_bracketed as mapBracketed,
  _opre_unbracket as unbracket, _opre_bad_address as badAddress };
