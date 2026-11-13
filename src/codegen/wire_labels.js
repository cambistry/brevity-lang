import { _opre_quote as quote } from './opre_tokens.js';

// How an actor's own labels are spelled on the wire.
//
// The wire name is the name. Inside an actor, `a`, `@a` and `#a` are different
// labels, and on the wire they stay different:
//
//   source   wire
//   @a       a       public: travels bare
//   a        ~a      protected
//   #a       #a      private
//            $set    an intrinsic op: $get, $set, $new, $subscribe, $update, $as
//
// A synthesized name keeps its `@`: a closure's `@0` or an event endpoint's
// `@__evt_…` is the whole name, not a public member `0`.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.

// Source handler names that are intrinsics: `set` (the whole-actor setter),
// `update`, and the `as` clauses.
const INTRINSIC = new Set(['set', 'update', 'new', 'as', 'subscribe', 'get']);

// A synthesized name: the whole token, `@` and all.
const SYNTHESIZED = /^@(\d+$|__)/;

export function wireLabel(name) {
  if (typeof name !== 'string' || name === '') return name;
  if (SYNTHESIZED.test(name)) return name;
  if (name.startsWith('@')) return name.slice(1);
  if (/^[#~$]/.test(name)) return name;
  if (INTRINSIC.has(name)) return '$' + name;
  return '~' + name;
}

// The op of a public member called on another actor: `x.get()` is `get`.
export function memberOp(member) {
  return wireLabel(member.startsWith('@') ? member : '@' + member);
}

// An intrinsic op by its source name: `set` is `$set`.
export function intrinsicOp(name) {
  return '$' + name;
}

// A compiled cell or class arm (`set@val`, `set.val`, `new@Box`) as the
// intrinsic it answers and the token of `to` it answers for:
// `set@val` is `$set` to `val`, `set.val` is `$set` to `~val`, `new@Box` is
// `$new` to `Box`. Anything else is null.
export function intrinsicArm(name) {
  const m = typeof name === 'string' && /^(set|new|get|subscribe|update)([@.#])(.+)$/.exec(name);
  if (!m) return null;
  const [, op, sigil, rest] = m;
  const label = sigil === '.' ? rest : sigil + rest;
  return { op: intrinsicOp(op), target: wireLabel(label) };
}

// A label as a token of an Opre address. The token is the wire name.
export function addressToken(name) {
  return wireLabel(name);
}

// The relative address of one of this actor's own labels: `@a` is `. a`.
export function selfAddress(name) {
  return '. ' + quote(addressToken(name));
}
