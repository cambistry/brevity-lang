import { _bv_eq } from '../../src/codegen/javascript/runtime/equality.js';

// ═══════════════════════════════════════════════════════════════════════════════
// _bv_eq — canonical structural equality (JS reference impl).
//
// Verifies the contract documented in src/codegen/javascript/runtime/equality.js
// and used by List.contains, .index_of, .replace, etc. (Phase C). Mirrors the
// rules every other backend's equality helper must implement.
//
// Decimal is duck-typed { c: BigInt, s: Number, cmp() } in this file because
// BvDecimal is defined inside the runtime preamble string, not as an importable
// JS class. The shape match here is the same one the runtime relies on.
// ═══════════════════════════════════════════════════════════════════════════════

const list = (...vals) => vals.reduceRight((tail, head) => ({ head, tail }), null);

// Stand-in for the runtime BvDecimal — keeps the c/s/cmp contract.
function dec(c, s) {
  return {
    c: BigInt(c),
    s,
    cmp(o) {
      const aScale = this.s, bScale = o.s;
      const align = (v, from, to) => from === to ? v : v * 10n ** BigInt(to - from);
      const tgt = aScale > bScale ? aScale : bScale;
      const av = align(this.c, aScale, tgt);
      const bv = align(o.c, bScale, tgt);
      return av < bv ? -1 : av > bv ? 1 : 0;
    },
  };
}

describe('_bv_eq — Integer (BigInt + cross-type Number)', () => {
  it('equal BigInts', () => expect(_bv_eq(5n, 5n)).toBe(true));
  it('unequal BigInts', () => expect(_bv_eq(5n, 6n)).toBe(false));
  it('equal whole Numbers', () => expect(_bv_eq(5, 5)).toBe(true));
  it('BigInt and whole Number cross-type', () => expect(_bv_eq(5n, 5)).toBe(true));
  it('whole Number and BigInt cross-type', () => expect(_bv_eq(5, 5n)).toBe(true));
  it('zero across types', () => expect(_bv_eq(0n, 0)).toBe(true));
  it('negative across types', () => expect(_bv_eq(-7n, -7)).toBe(true));
  it('non-integer Number is not Integer-equal', () => expect(_bv_eq(5.5, 5n)).toBe(false));
});

describe('_bv_eq — Text', () => {
  it('equal Text', () => expect(_bv_eq('hi', 'hi')).toBe(true));
  it('unequal Text', () => expect(_bv_eq('hi', 'bye')).toBe(false));
  it('empty Text', () => expect(_bv_eq('', '')).toBe(true));
  it('Text vs Integer is unequal', () => expect(_bv_eq('5', 5n)).toBe(false));
});

describe('_bv_eq — Boolean', () => {
  it('true === true', () => expect(_bv_eq(true, true)).toBe(true));
  it('false === false', () => expect(_bv_eq(false, false)).toBe(true));
  it('true vs false', () => expect(_bv_eq(true, false)).toBe(false));
  it('Boolean vs Integer unequal', () => expect(_bv_eq(true, 1n)).toBe(false));
});

describe('_bv_eq — null', () => {
  it('null === null', () => expect(_bv_eq(null, null)).toBe(true));
  it('null vs Integer', () => expect(_bv_eq(null, 0n)).toBe(false));
  it('null vs empty Text', () => expect(_bv_eq(null, '')).toBe(false));
  it('null vs empty list', () => {
    // both are null at runtime — empty list IS null
    expect(_bv_eq(null, null)).toBe(true);
  });
});

describe('_bv_eq — Decimal value-equality', () => {
  it('same scale, same coefficient', () => expect(_bv_eq(dec(10, 0), dec(10, 0))).toBe(true));
  it('different scale, same value (1 vs 1.0)', () => expect(_bv_eq(dec(1, 0), dec(10, 1))).toBe(true));
  it('different scale, same value (1.0 vs 1.00)', () => expect(_bv_eq(dec(10, 1), dec(100, 2))).toBe(true));
  it('unequal value', () => expect(_bv_eq(dec(10, 1), dec(11, 1))).toBe(false));
  it('Decimal vs Integer is unequal (no cross-type)', () => expect(_bv_eq(dec(5, 0), 5n)).toBe(false));
});

describe('_bv_eq — List recursive structural', () => {
  it('two empty lists', () => expect(_bv_eq(null, null)).toBe(true));
  it('singleton equal', () => expect(_bv_eq(list(1n), list(1n))).toBe(true));
  it('multi-element equal', () => expect(_bv_eq(list(1n, 2n, 3n), list(1n, 2n, 3n))).toBe(true));
  it('multi-element unequal at tail', () => expect(_bv_eq(list(1n, 2n, 3n), list(1n, 2n, 4n))).toBe(false));
  it('different lengths (shorter first)', () => expect(_bv_eq(list(1n), list(1n, 2n))).toBe(false));
  it('different lengths (longer first)', () => expect(_bv_eq(list(1n, 2n), list(1n))).toBe(false));
  it('cross-type elements via Integer rule', () => expect(_bv_eq(list(1n, 2n), list(1, 2))).toBe(true));
  it('nested lists equal', () => expect(_bv_eq(list(list(1n), list(2n)), list(list(1n), list(2n)))).toBe(true));
  it('nested lists unequal', () => expect(_bv_eq(list(list(1n)), list(list(2n)))).toBe(false));
  it('empty vs singleton', () => expect(_bv_eq(null, list(1n))).toBe(false));
  it('Texts in list', () => expect(_bv_eq(list('a', 'b'), list('a', 'b'))).toBe(true));
});

describe('_bv_eq — actor refs / unknown objects (identity only)', () => {
  it('same reference is equal', () => {
    const ref = { kind: 'actor', addr: 'a-1' };
    expect(_bv_eq(ref, ref)).toBe(true);
  });
  it('look-alike refs are NOT equal (identity, not structural)', () => {
    const a = { kind: 'actor', addr: 'a-1' };
    const b = { kind: 'actor', addr: 'a-1' };
    expect(_bv_eq(a, b)).toBe(false);
  });
  it('plain objects without head/tail/c+s+cmp fall to identity', () => {
    expect(_bv_eq({ x: 1 }, { x: 1 })).toBe(false);
  });
});
