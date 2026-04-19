export const LIST_PREAMBLE = `const _List = {
  empty: null,
  cons(head, tail) { return { head, tail }; },
  from(arr) { if (arr === null) return null; return arr.reduceRight((tail, head) => ({ head, tail }), null); },
  toArray(list) { if (list === null) return []; const a = []; while (list !== null) { a.push(list.head); list = list.tail; } return a; },
  _typeOf(v) { if (typeof v === 'number') return 'Integer'; if (typeof v === 'string') return 'Text'; if (typeof v === 'boolean') return 'Boolean'; return 'Anything'; },
  typesOf(list) { const a = []; let l = list; while (l !== null) { a.push(_List._typeOf(l.head)); l = l.tail; } return a; },
  async mapAsync(list, fn) {
    if (list === null) return null;
    const results = [];
    let cur = list;
    while (cur !== null) {
      const r = await fn(Structure.pack([cur.head]));
      results.push(Structure.one(r, 'over'));
      cur = cur.tail;
    }
    return _List.from(results);
  },
  async foldAsync(list, initial, fn) {
    if (list === null) return null;
    let acc = initial;
    let cur = list;
    if (acc === null) {
      acc = cur.head;
      cur = cur.tail;
      if (cur === null) return acc;
    }
    while (cur !== null) {
      const r = await fn(Structure.pack([acc, cur.head]));
      acc = Structure.one(r, 'reduce');
      cur = cur.tail;
    }
    return acc;
  },
};`;

export const TEXT_PREAMBLE = `
function _bv_text_index_of(t, needle) {
  if (needle instanceof RegExp) {
    const m = t.match(needle);
    if (!m) return -1;
    return [...t.slice(0, m.index)].length;
  }
  const idx = t.indexOf(needle);
  if (idx === -1) return -1;
  return [...t.slice(0, idx)].length;
}
function _bv_text_before(t, needle) {
  if (needle instanceof RegExp) {
    const m = t.match(needle);
    if (!m) return t;
    return t.slice(0, m.index);
  }
  const idx = t.indexOf(needle);
  if (idx === -1) return t;
  return t.slice(0, idx);
}
function _bv_text_after(t, needle) {
  if (needle instanceof RegExp) {
    const m = t.match(needle);
    if (!m) return "";
    return t.slice(m.index + m[0].length);
  }
  const idx = t.indexOf(needle);
  if (idx === -1) return "";
  return t.slice(idx + needle.length);
}`;

export const STRUCTURE_PREAMBLE = `const Structure = {
  pack(payload) {
    if (payload == null) return { positional: [], named: {}, positional_types: null, named_types: null };
    if (Array.isArray(payload)) {
      const last = payload[payload.length - 1];
      if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
        return { positional: payload.slice(0, -1), named: last, positional_types: null, named_types: null };
      }
      return { positional: payload, named: {}, positional_types: null, named_types: null };
    }
    return { positional: [], named: payload, positional_types: null, named_types: null };
  },
  one(s, name) {
    if (s.positional.length !== 1)
      throw new Error("'" + name + "' requires exactly 1 positional return value, got " + s.positional.length);
    return s.positional[0];
  },
  splat({ positional, named }) {
    const hasPos = positional.length > 0;
    const hasNamed = Object.keys(named).length > 0;
    if (hasPos && hasNamed) return [...positional, named];
    if (hasPos) return positional;
    return named;
  },
};
function _matchTypes(types, named, positional, requiredPos) {
  if (types === null) return named.length === 0 && positional.length === 0;
  const minPos = requiredPos !== undefined ? requiredPos : positional.length;
  if (types.positional.length < minPos || types.positional.length > positional.length) return false;
  for (let i = 0; i < types.positional.length; i++) {
    if (types.positional[i] !== positional[i]) return false;
  }
  for (const [name, type] of named) {
    if (!(name in types.named)) return false;
    if (types.named[name] !== type) return false;
  }
  return true;
}`;
