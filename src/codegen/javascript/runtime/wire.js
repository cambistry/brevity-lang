// Slice 12+13 wire format helpers. Outbound: strip the `__type` tag from a
// runtime tagged object and reshape to wire form (positional list when
// all-required, named map when any field is optional). Inbound: reconstruct
// the tagged object given a `::Name` annotation and wire payload.
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

export function _bv_from_wire(tag, payload, _bv_types) {
  if (typeof tag !== 'string') return payload;
  // The tag is `::Name` or `authority ::Name`. Take the name after the last `::`.
  const at = tag.lastIndexOf('::');
  if (at === -1) return payload;
  const name = tag.slice(at + 2);
  const decl = _bv_types && _bv_types[name];
  if (!decl) return payload;
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
// object; a named reply tags per key. Slots whose tag is not `::Name` pass through.
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
// return the op selector to send. An address `#<alias selector>` resolves to
// its trailing `selector`; a bare address passes through unchanged. Mirrors the
// DOM closure route's `v.slice(2, -1).split(' ').pop()`.
export function _bv_sel(addr) {
  if (typeof addr === 'string' && addr.startsWith('#<') && addr.endsWith('>')) {
    const inner = addr.slice(2, -1);
    const sp = inner.lastIndexOf(' ');
    return sp === -1 ? inner : inner.slice(sp + 1);
  }
  return addr;
}

// Slice 12 inbound: walk a packed Object (`positional` + `named`)
// alongside the parallel ty tag object and reconstruct any
// type-valued slot. Slots whose tag is not `::Name` pass through.
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
