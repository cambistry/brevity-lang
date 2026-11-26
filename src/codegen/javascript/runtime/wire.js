import { _opre_split } from '../../opre_tokens.js';

// Wire format helpers. A typed value goes on the wire as a list
// (notes/positional-type-fields-2026-11-26.md): the positional values given
// (always a prefix, as positional args fill in order), then the named values
// given in one trailing object. Always a list, so it is never taken for a
// named-args bag. A type with named fields reads a trailing plain object as
// them.
//
// The type registry `_bv_types` is emitted per-program by the codegen and
// carries each type's field keys, positional first (`pos` of them). Without
// that registry these helpers are no-ops.

export function _bv_to_wire(v, _bv_types) {
  if (v == null || typeof v !== 'object') return v;
  const tag = v.__type;
  if (typeof tag !== 'string') return v;
  const decl = _bv_types && _bv_types[tag];
  if (!decl) return v;
  const named = {};
  for (const f of decl.fields.slice(decl.pos)) {
    if (v[f] !== undefined) named[f] = v[f];
  }
  const out = [];
  for (const f of decl.fields.slice(0, decl.pos)) {
    if (v[f] === undefined) break;
    out.push(v[f]);
  }
  if (Object.keys(named).length > 0) out.push(named);
  return out;
}

// A type's tag is its address: its authority, the classes that own it, and its
// bare name (`:Point`, `:W:X`, `svc.bv:Point`). Nothing in its shape says it
// names a type: it does when the registry has it, under its key or the alias
// spelling of its authority (`Svc:Point`). Returns the type's key, or null.
export function _bv_type_name(tag, _bv_types) {
  if (typeof tag !== 'string' || !_bv_types || !Object.hasOwn(_bv_types, tag)) return null;
  return _bv_types[tag].key;
}

export function _bv_from_wire(tag, payload, _bv_types) {
  const key = _bv_type_name(tag, _bv_types);
  if (!key || !Array.isArray(payload)) return payload;
  const decl = _bv_types[key];
  const out = { __type: key };
  const last = payload[payload.length - 1];
  // A trailing plain object holds the named values of a type that has them.
  const named = decl.pos < decl.fields.length && last != null && typeof last === 'object' && !Array.isArray(last) ? last : null;
  const positional = named ? payload.slice(0, -1) : payload;
  positional.slice(0, decl.pos).forEach((x, i) => { out[decl.fields[i]] = x; });
  if (named) {
    for (const f of decl.fields.slice(decl.pos)) {
      if (f in named) out[f] = named[f];
    }
  }
  return out;
}

// A reply's counterpart to `_bv_unwire_packed`: `re` and its parallel `ty`, in
// wire shape. A positional reply tags per slot, with named slots in a trailing
// object; a named reply tags per key. Slots whose tag names no known type pass through.
export function _bv_unwire_reply(re, ty, _bv_types) {
  if (ty == null || typeof ty !== 'object' || re == null || typeof re !== 'object') return re;
  if (Array.isArray(re) !== Array.isArray(ty)) return re;
  if (Array.isArray(re)) {
    return re.map((v, i) => (typeof ty[i] === 'object'
      ? _bv_unwire_reply(v, ty[i], _bv_types)
      : _bv_from_wire(ty[i], v, _bv_types)));
  }
  const out = {};
  for (const k of Object.keys(re)) out[k] = _bv_from_wire(ty[k], re[k], _bv_types);
  return out;
}

// Reference-field invocation: given the address held in a reference field,
// return the op to send. An address `#<alias:member>` names its member by its
// last token, and the token is the op (`#<x:p>` → `p`, `#<main:@0>` → `@0`);
// a bare address passes through unchanged.
export function _bv_sel(addr) {
  if (typeof addr === 'string' && addr.startsWith('#<') && addr.endsWith('>')) {
    const tokens = _opre_split(addr.slice(2, -1));
    const last = tokens[tokens.length - 1];
    return typeof last === 'string' ? last : addr;
  }
  return addr;
}

// The tokens of a received `to` that name something inside us. What reaches
// us is relative to us, and bare: `:Box:1` or `Box:1`.
export function _bv_local_tokens(to) {
  if (typeof to !== 'string' || to === '') return [];
  let tokens;
  try { tokens = _opre_split(to); } catch { return []; }
  return tokens[0] === null ? tokens.slice(1) : tokens;
}

// Slice 12 inbound: walk a packed Object (`positional` + `named`)
// alongside the parallel ty tag object and reconstruct any
// type-valued slot. Slots whose tag names no known type pass through.
export function _bv_unwire_packed(s, types, _bv_types) {
  if (!types || !s) return s;
  const out = { positional: [], named: {} };
  for (let i = 0; i < s.positional.length; i++) {
    const tag = types.positional?.[i];
    out.positional.push(_bv_from_wire(tag, s.positional[i], _bv_types));
  }
  for (const k of Object.keys(s.named)) {
    const tag = types.named?.[k];
    out.named[k] = _bv_from_wire(tag, s.named[k], _bv_types);
  }
  return out;
}

// The address a reply names, unbracketed: its one value, `re: ['#<…>']`. A
// reply with no address in it names the sender (`from`). A `re` that isn't a
// list isn't a reply (undefined: malformed).
export function _bv_new_reply_addr(message) {
  const re = message.re;
  if (!Array.isArray(re)) return undefined;
  const a = re.length === 1 ? re[0] : null;
  if (typeof a === 'string' && a.startsWith('#<') && a.endsWith('>')) return a.slice(2, -1);
  return message.from ?? null;
}

// A reply's one value: an address reply is `['#<…>']`.
export function _bv_reply_one(re) {
  return re.length === 1 ? re[0] : re;
}
