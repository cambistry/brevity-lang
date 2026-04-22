export const LIST_PREAMBLE = `const _List = {
  empty: null,
  cons(head, tail) { return { head, tail }; },
  from(arr) { if (arr === null) return null; return arr.reduceRight((tail, head) => ({ head, tail }), null); },
  toArray(list) { if (list === null) return []; const a = []; while (list !== null) { a.push(list.head); list = list.tail; } return a; },
  _typeOf(v) { if (v instanceof BvDecimal) return 'Decimal'; if (typeof v === 'number' || typeof v === 'bigint') return 'Integer'; if (typeof v === 'string') return 'Text'; if (typeof v === 'boolean') return 'Boolean'; return 'Anything'; },
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
}
function _bv_graphemes(s) {
  return [...new Intl.Segmenter().segment(s)].map(g => g.segment);
}
function _bv_grapheme_index_of(s, needle) {
  const idx = s.indexOf(needle);
  if (idx === -1) return -1;
  return _bv_graphemes(s.slice(0, idx)).length;
}
function _bv_blob_index_of_re(s, re) {
  const m = s.match(re);
  if (!m) return -1;
  return _bv_enc.encode(s.slice(0, m.index)).length;
}
const _bv_enc = new TextEncoder();
const _bv_dec = new TextDecoder();
function _bv_blob_slice(s, start, end) {
  const buf = _bv_enc.encode(s);
  return _bv_dec.decode(buf.subarray(start, end));
}
function _bv_blob_first(s) {
  if (s.length === 0) return "";
  return _bv_dec.decode(_bv_enc.encode(s).subarray(0, 1));
}
function _bv_blob_last(s) {
  if (s.length === 0) return "";
  const buf = _bv_enc.encode(s);
  return _bv_dec.decode(buf.subarray(buf.length - 1));
}
function _bv_blob_reverse(s) {
  const buf = _bv_enc.encode(s);
  return _bv_dec.decode(buf.slice().reverse());
}
function _bv_blob_index_of(s, needle) {
  const buf = _bv_enc.encode(s);
  const nbuf = _bv_enc.encode(needle);
  outer: for (let i = 0; i <= buf.length - nbuf.length; i++) {
    for (let j = 0; j < nbuf.length; j++) { if (buf[i+j] !== nbuf[j]) continue outer; }
    return i;
  }
  return -1;
}`;

export const MATH_PREAMBLE = `
function _bv_float_op(a, op, b) {
  const _a = typeof a === 'bigint' ? Number(a) : (a instanceof BvDecimal ? a.toNumber() : +a);
  const _b = typeof b === 'bigint' ? Number(b) : (b instanceof BvDecimal ? b.toNumber() : +b);
  switch (op) {
    case '+': return _a + _b;
    case '-': return _a - _b;
    case '*': return _a * _b;
    case '/': return _a / _b;
    case '%': return _a % _b;
    case '**': return _a ** _b;
    case '==': case '===': return _a === _b;
    case '!=': case '!==': return _a !== _b;
    case '>': return _a > _b;
    case '<': return _a < _b;
    case '>=': return _a >= _b;
    case '<=': return _a <= _b;
    default: return _a + _b;
  }
}
function _bv_div(a, b) {
  if (typeof a === 'bigint' || typeof b === 'bigint') return BigInt(a) / BigInt(b);
  return Math.trunc(a / b);
}
function _bv_int_op(a, op, b) {
  const _a = typeof a === 'bigint' ? a : BigInt(a);
  const _b = typeof b === 'bigint' ? b : BigInt(b);
  switch (op) {
    case '+': return _a + _b;
    case '-': return _a - _b;
    case '*': return _a * _b;
    case '/': return _a / _b;
    case '%': return _a % _b;
    case '**': return _a ** _b;
    case '===': return _a === _b;
    case '!==': return _a !== _b;
    case '>': return _a > _b;
    case '<': return _a < _b;
    case '>=': return _a >= _b;
    case '<=': return _a <= _b;
    default: return _a + _b;
  }
}`;

export const DECIMAL_PREAMBLE = `class BvDecimal {
  constructor(c, s) { this.c = c; this.s = s; }
  static from(v) {
    if (v instanceof BvDecimal) return v;
    const s = String(v);
    const dot = s.indexOf('.');
    if (dot === -1) return new BvDecimal(BigInt(s), 0);
    const int = s.slice(0, dot);
    const frac = s.slice(dot + 1);
    return new BvDecimal(BigInt(int + frac), frac.length);
  }
  static fromInt(n) { return new BvDecimal(BigInt(n), 0); }
  _align(o) {
    if (this.s === o.s) return [this.c, o.c, this.s];
    if (this.s > o.s) return [this.c, o.c * 10n ** BigInt(this.s - o.s), this.s];
    return [this.c * 10n ** BigInt(o.s - this.s), o.c, o.s];
  }
  add(o) { const [a,b,s] = this._align(o); return new BvDecimal(a+b, s); }
  sub(o) { const [a,b,s] = this._align(o); return new BvDecimal(a-b, s); }
  mul(o) { return new BvDecimal(this.c * o.c, this.s + o.s); }
  divExact(o) {
    if (o.c === 0n) throw new Error('Division by zero');
    if (this.c === 0n) return new BvDecimal(0n, 0);
    const sign = (this.c < 0n) !== (o.c < 0n) ? -1n : 1n;
    let num = this.c < 0n ? -this.c : this.c;
    let den = o.c < 0n ? -o.c : o.c;
    let a = num, b = den;
    while (b > 0n) { [a, b] = [b, a % b]; }
    let d = den / a;
    while (d % 2n === 0n) d /= 2n;
    while (d % 5n === 0n) d /= 5n;
    if (d !== 1n) throw new Error('Non-terminating decimal division');
    let extra = 0;
    while (num % den !== 0n) { num *= 10n; extra++; }
    let rs = this.s + extra - o.s;
    let rc = sign * (num / den);
    if (rs < 0) { rc *= 10n ** BigInt(-rs); rs = 0; }
    while (rs > 0 && rc % 10n === 0n) { rc /= 10n; rs--; }
    return new BvDecimal(rc, rs);
  }
  rem(o) {
    const [a,b,s] = this._align(o);
    return new BvDecimal(a - (a / b) * b, s);
  }
  pow(exp) {
    const e = typeof exp === 'bigint' ? exp : BigInt(exp);
    if (e === 0n) return new BvDecimal(1n, 0);
    if (e > 0n) {
      let r = this;
      for (let i = 1n; i < e; i++) r = r.mul(this);
      let c = r.c, s = r.s;
      while (s > 0 && c % 10n === 0n) { c /= 10n; s--; }
      return new BvDecimal(c, s);
    }
    return new BvDecimal(1n, 0).divExact(this.pow(-e));
  }
  cmp(o) {
    const [a,b] = this._align(o);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  eq(o) { return this.cmp(o) === 0; }
  toNumber() {
    if (this.s === 0) return Number(this.c);
    const sign = this.c < 0n ? '-' : '';
    const abs = (this.c < 0n ? -this.c : this.c).toString();
    if (this.s >= abs.length) return Number(sign + '0.' + '0'.repeat(this.s - abs.length) + abs);
    return Number(sign + abs.slice(0, abs.length - this.s) + '.' + abs.slice(abs.length - this.s));
  }
}
function _bv_dec_op(a, op, b) {
  const _a = a instanceof BvDecimal ? a : typeof a === 'bigint' ? BvDecimal.fromInt(a) : BvDecimal.from(a);
  const _b = op === '**' ? b : (b instanceof BvDecimal ? b : typeof b === 'bigint' ? BvDecimal.fromInt(b) : BvDecimal.from(b));
  switch (op) {
    case '+': return _a.add(_b);
    case '-': return _a.sub(_b);
    case '*': return _a.mul(_b);
    case '/': return _a.divExact(_b);
    case '%': return _a.rem(_b);
    case '**': return _a.pow(_b);
    case '===': return _a.cmp(_b) === 0;
    case '!==': return _a.cmp(_b) !== 0;
    case '>': return _a.cmp(_b) > 0;
    case '<': return _a.cmp(_b) < 0;
    case '>=': return _a.cmp(_b) >= 0;
    case '<=': return _a.cmp(_b) <= 0;
    default: return _a.add(_b);
  }
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
