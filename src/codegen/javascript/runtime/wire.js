// Slice 12+13 wire format helpers. Outbound: strip the `__type` tag from a
// runtime tagged object and reshape to wire form (positional list when
// all-required, named map when any field is optional). Inbound: reconstruct
// the tagged object given a `::Name` annotation and wire payload.
//
// The shape registry `_bv_types` is emitted per-program by the codegen and
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
  if (typeof tag !== 'string' || !tag.startsWith('::')) return payload;
  const name = tag.slice(2);
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

// Slice 12 inbound: walk a packed Object (`positional` + `named`)
// alongside the parallel bv-a tag object and reconstruct any
// shape-typed slot. Slots whose tag is not `::Name` pass through.
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
