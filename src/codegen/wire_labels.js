import { _opre_quote as quote } from './opre_tokens.js';

// How an actor's own labels are spelled on the wire.
//
// Inside an actor, `a`, `@a` and `#a` are different labels. On the wire, `@a`
// and `#a` keep their sigils and a protected (bare) label takes a leading `.`:
// `helper` is op `.helper`, cell `val` is `.val`. A leading `.` is a
// delimiter, so the label reads as local. See
// notes/protected-names-dot-prefix-2026-11-11.md.
//
// Intrinsic ops and their compiled arms (`set`, `update`, `set@x`, `new@X`,
// `get@x`, `subscribe@x`, `as`) aren't labels, so they keep their names.

const INTRINSIC = new Set(['set', 'update', 'new', 'as', 'subscribe', 'get']);

export function wireLabel(name) {
  if (typeof name !== 'string' || name === '') return name;
  if (/^[@#.]/.test(name)) return name;
  if (INTRINSIC.has(name)) return name;
  if (/^(set|new|get|subscribe|update)[@#.]/.test(name)) return name;
  return '.' + name;
}

// A label as a token of an Opre address. A public member travels bare, so
// `@a` is token `a`; private `#a` and protected `.a` keep their wire labels.
// A synthesized closure's `@N` is its whole name, not a public `N`, so it
// keeps its `@`: `#<. @0>`.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
export function addressToken(name) {
  if (typeof name !== 'string' || name === '') return name;
  if (/^@\d+$/.test(name)) return name;
  if (name.startsWith('@')) return name.slice(1);
  return wireLabel(name);
}

// The relative address of one of this actor's own labels: `@a` is `. a`.
export function selfAddress(name) {
  return '. ' + quote(addressToken(name));
}
