// Opre addresses as tokens. See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
//
// An address is a sequence of tokens separated by single spaces. A token holds
// any characters. It is written in single quotes only when it must be:
//
//   - it contains a space:                'file/with spaces/'
//   - it starts with `'`:                 '''tis'
//   - it is a reserved whole token meant literally: '.'
//
// Inside quotes, `''` is one `'`. Outside quotes, `'` is an ordinary character
// (`Chris's-Computer`). Quoting a token that doesn't need it is an error.
//
// The whole token `.` at the head of an address is self: the address is
// relative to its sender. A parent that receives `. x` from child `c` rewrites
// it to `. c x`; the node at the global boundary replaces `.` with its own
// address. An address whose head isn't `.` passes through unchanged.
//
// In a token list, self is `null`; a literal `.` is the string '.'.
//
// These functions are also stringified into the JS runtime preamble, so each
// one stands alone: no module-level constants, and calls between them go only to
// functions listed in OPRE_TOKENS_PREAMBLE below.

// Does `token` have to be written in quotes?
export function _opre_needs_quote(token) {
  return token === '' || token === '.' || token.includes(' ') || token.startsWith("'");
}

// One token as it is written in an address. `null` is self.
export function _opre_quote(token) {
  if (token === null) return '.';
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
      if (j < address.length && address[j] !== ' ') throw new Error(`opre: text after a closing quote in ${JSON.stringify(address)}`);
      i = j;
    } else {
      const sp = address.indexOf(' ', i);
      const end = sp === -1 ? address.length : sp;
      token = address.slice(i, end);
      if (token === '') throw new Error(`opre: empty token in ${JSON.stringify(address)}`);
      if (token === '.') {
        if (i !== 0) throw new Error(`opre: self \`.\` is only an address's head token, in ${JSON.stringify(address)}`);
        token = null;
      }
      i = end;
    }
    tokens.push(token);
    if (i >= address.length) return tokens;
    i++; // the separating space
    if (i >= address.length) throw new Error(`opre: empty token in ${JSON.stringify(address)}`);
  }
}

// The address of a list of tokens. Only the head may be self (`null`).
export function _opre_join(tokens) {
  if (tokens.indexOf(null, 1) !== -1) throw new Error("opre: self `.` is only an address's head token");
  return tokens.map(_opre_quote).join(' ');
}

// Is the address relative to its sender: is its head token exactly `.`?
export function _opre_is_relative(address) {
  return typeof address === 'string' && (address === '.' || address.startsWith('. '));
}

// A relative address as seen one hop up, by the parent of the child `name` (an
// address of one or more tokens, already written): `. x` → `. name x`. Any
// other address is unchanged.
export function _opre_under(address, name) {
  if (!_opre_is_relative(address)) return address;
  return '. ' + name + address.slice(1);
}

// A relative address made global by the node `self` (an address, already
// written) at the global boundary: `. x` → `self x`. Any other address is
// unchanged.
export function _opre_resolve(address, self) {
  if (!_opre_is_relative(address)) return address;
  return self + address.slice(1);
}

// Rewrite every `#<…>` address in a string with `f`, which maps the address
// inside the brackets. `\>` and `\\` inside the brackets stay as they are.
export function _opre_map_bracketed(s, f) {
  return s.replace(/#<((?:[^>\\]|\\.)*)>/g, (_, a) => '#<' + f(a) + '>');
}

// The functions above, for the JS runtime preamble.
export const OPRE_TOKENS_PREAMBLE = [
  _opre_needs_quote, _opre_quote, _opre_split, _opre_join,
  _opre_is_relative, _opre_under, _opre_resolve, _opre_map_bracketed,
].map(f => f.toString()).join('\n');

export { _opre_split as split, _opre_join as join, _opre_quote as quote, _opre_is_relative as isRelative,
  _opre_under as under, _opre_resolve as resolve, _opre_map_bracketed as mapBracketed };
