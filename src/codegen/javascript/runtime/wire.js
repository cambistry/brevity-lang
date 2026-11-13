import { _opre_split } from '../../opre_tokens.js';

// Slice 12+13 wire format helpers. Outbound: strip the `__type` tag from a
// runtime tagged object and reshape to wire form (positional list when
// all-required, named map when any field is optional). Inbound: reconstruct
// the tagged object given a type's tag and wire payload.
//
// The type registry `_bv_types` is emitted per-program by the codegen and
// carries the field order plus a flag indicating whether the type has any
// optional fields. Without that registry these helpers are no-ops.

export function _bv_to_wire(v, _bv_types) {
  if (v == null || typeof v !== 'object') return v;
  const tag = v.__type;
  if (typeof tag !== 'string') return v;
  const decl = _bv_types && _bv_types[tag];
  if (!decl) return v;
  if (decl.allRequired) {
    return decl.fields.map(f => v[f]);
  }
  const out = {};
  for (const f of decl.fields) {
    if (f in v && v[f] !== undefined) out[f] = v[f];
  }
  return out;
}

// A type's tag is its authority's address followed by its bare name
// (`. Point`, `Svc Point`, `. Class X`). Nothing in its shape says it names a
// type: it does when its last token is a type this program knows. Returns that
// name, or null.
export function _bv_type_name(tag, _bv_types) {
  if (typeof tag !== 'string' || !_bv_types) return null;
  let tokens;
  try { tokens = _opre_split(tag); } catch { return null; }
  if (tokens.length < 2) return null;
  const name = tokens[tokens.length - 1];
  return typeof name === 'string' && Object.hasOwn(_bv_types, name) ? name : null;
}

export function _bv_from_wire(tag, payload, _bv_types) {
  const name = _bv_type_name(tag, _bv_types);
  if (!name) return payload;
  const decl = _bv_types[name];
  const out = { __type: name };
  if (Array.isArray(payload)) {
    for (let i = 0; i < decl.fields.length && i < payload.length; i++) {
      out[decl.fields[i]] = payload[i];
    }
  } else if (payload && typeof payload === 'object') {
    for (const f of decl.fields) {
      if (f in payload) out[f] = payload[f];
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
// return the op to send. An address `#<alias member>` names its member by its
// last token, and the token is the op (`#<x p>` → `p`, `#<main @0>` → `@0`);
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
// us is relative to us: `. Box 1` or `Box 1`, bracketed or not.
export function _bv_local_tokens(to) {
  if (typeof to !== 'string' || to === '') return [];
  const a = to.startsWith('#<') && to.endsWith('>') ? to.slice(2, -1) : to;
  let tokens;
  try { tokens = _opre_split(a); } catch { return []; }
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
