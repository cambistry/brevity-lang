import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── Construction and -> ────────────────────────────────────────────────────

describe('List construction — reply', () => {
  it('[] typed as List of Integers is null at runtime', async () => {
    const source = `
      on test()
        empty : List of Integers = []
        -> result: empty
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'List of Integers' },
        re: { result: null },
        to: 'caller',
      },
    });
  });

  it('[7] : List of Integers — head is 7', async () => {
    const source = `
      on test()
        nums : List of Integers = [7] : List of Integers
        [h : Integer] = nums
        -> head: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { head: 'Integer' },
        re: { head: 7 },
        to: 'caller',
      },
    });
  });

  it('typed list variable → bv-a contains "List of Integers"', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        -> result: nums
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        id: '1',
        'bv-a': { result: 'List of Integers' },
        re: { result: [1, 2, 3] },
        to: 'caller',
      }),
    });
  });

  it('List of Texts works', async () => {
    const source = `
      on test()
        words : List of Texts = ["hello", "world"] : List of Texts
        [h : Text, ..._] = words
        -> first: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { first: 'Text' },
        re: { first: 'hello' },
        to: 'caller',
      },
    });
  });
});

// ── Positional destructure ────────────────────────────────────────────────────

describe('List positional destructure', () => {
  it('[a : Integer, b : Integer, _] = list — first two elements', async () => {
    const source = `
      on test()
        nums : List of Integers = [5, 6, 7] : List of Integers
        [a : Integer, b : Integer, _] = nums
        -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { sum: 'Integer' },
        re: { sum: 11 },
        to: 'caller',
      },
    });
  });

  it('[a : Integer, b : Integer, c : Integer] = list — first three', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer, c : Integer] = nums
        -> sum: a + b + c : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { sum: 'Integer' },
        re: { sum: 6 },
        to: 'caller',
      },
    });
  });
});

// ── Head+tail destructure ─────────────────────────────────────────────────────

describe('List head+tail destructure', () => {
  it('[h : Integer, ...t] = list — head is first element', async () => {
    const source = `
      on test()
        nums : List of Integers = [10, 20, 30] : List of Integers
        [h : Integer, ...t] = nums
        -> head: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { head: 'Integer' },
        re: { head: 10 },
        to: 'caller',
      },
    });
  });

  it('[h : Integer, ...t] = [42] — tail of single-element list is null', async () => {
    const source = `
      on test()
        nums : List of Integers = [42] : List of Integers
        [h : Integer, ...t] = nums
        -> tail: t
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        re: { tail: null },
        to: 'caller',
      },
    });
  });

  it('[_, ...t] = list — discard head, destructure tail to get second element', async () => {
    const source = `
      on test()
        nums : List of Integers = [100, 200, 300] : List of Integers
        [_, ...t] = nums
        [h : Integer, ..._] = t
        -> second: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { second: 'Integer' },
        re: { second: 200 },
        to: 'caller',
      },
    });
  });
});

// ── bv-a and type matching ────────────────────────────────────────────────────

describe('List type matching', () => {
  it(':nums : List of Integers matches correct bv-a', async () => {
    const source = `
      on sum(:nums : List of Integers)
        [a : Integer, b : Integer] = nums
        -> total: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ nums: [3, 4] }, 'sum'], 'bv-a': [{ nums: 'List of Integers' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'caller' },
    });
  });

  it(':nums : List of Integers does not match List of Texts bv-a', async () => {
    const source = `
      on sum(:nums : List of Integers)
        [a : Integer, b : Integer] = nums
        -> total: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ nums: ['a'] }, 'sum'], 'bv-a': [{ nums: 'List of Texts' }], from: 'caller' },
      reply: { id: '1', ex: { sum: 'unhandled' }, to: 'caller' },
    });
  });
});

// ── Runtime arity check ───────────────────────────────────────────────────────

describe('List destructure arity', () => {
  it('[a, b] = [1, 2, 3] throws — under-destructured without discard', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer] = nums
        -> result: 0 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        ex: { test: 'error' },
        to: 'caller',
      },
    });
  });
});

// ── Compile errors ────────────────────────────────────────────────────────────

describe('List compile errors', () => {
  it('x : List of Integer (singular) throws', () => {
    expect(() => compile(`
      on test()
        x : List of Integer = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Integers' not 'Integer' after 'of'/);
  });

  it('x : List of Text (singular) throws', () => {
    expect(() => compile(`
      on test()
        x : List of Text = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Texts' not 'Text' after 'of'/);
  });

  it('x : Integers = ... (plural standalone) throws', () => {
    expect(() => compile(`
      on test()
        x : Integers = []
        -> result: 0 : Integer
    `)).toThrow(/'Integers' is not a valid standalone type/);
  });
});

// ── Bare List = List of Anything ───────────────────────────────────────────────────

describe('Bare List (= List of Anything)', () => {
  it('x : List = [] is valid — bare List treated as List of Anything', () => {
    expect(() => compile(`
      on test()
        x : List = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it(':x : List param is valid — bare List treated as List of Anything', () => {
    expect(() => compile(
      'on test(:x : List) -> result: 0 : Integer\n'
    )).not.toThrow();
  });

  it('bare List -> emits component-types array in bv-a', async () => {
    const source = `
      on test()
        items : List = [1, 2, 3] : List of Anything
        -> result: items
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        'bv-a': { result: ['Integer', 'Integer', 'Integer'] },
      }),
    });
  });
});

// ── List of Anything ───────────────────────────────────────────────────────────────

describe('List of Anything', () => {
  it('[1, "hello"] : List of Anything — mixed elements', async () => {
    const source = `
      on test()
        items : List of Anything = [1, "hello"] : List of Anything
        [h : Anything, ..._] = items
        -> first: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        re: { first: 1 },
        to: 'caller',
      }),
    });
  });

  it('List of Anything is a valid type (no throw)', () => {
    expect(() => compile(`
      on test()
        x : List of Anything = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });
});

// ── List of Anything — BV-A in both directions ────────────────────────────────────

describe('List of Anything BV-A', () => {
  it('re: List of Anything emits component types array in bv-a', async () => {
    const source = `
      on build()
        items : List of Anything = [1, "two"] : List of Anything
        -> result: items
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'build', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: ['Integer', 'Text'] },
        re: { result: [1, 'two'] },
        to: 'caller',
      },
    });
  });

  it('op: List of Anything param accepts array + component bv-a', async () => {
    const source = `
      on run(:items : List)
        [h : Anything, ..._] = items
        -> first: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ items: [42, 'hello'] }, 'run'], 'bv-a': [{ items: ['Integer', 'Text'] }], from: 'caller' },
      reply: { id: '1', 'bv-a': { first: 'Anything' }, re: { first: 42 }, to: 'caller' },
    });
  });
});

// ── Nested lists ──────────────────────────────────────────────────────────────

describe('Nested List of Lists', () => {
  it('List of Lists of Integers is a valid type', () => {
    expect(() => compile(`
      on test()
        x : List of Lists of Integers = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('List of List (singular) throws', () => {
    expect(() => compile(`
      on test()
        x : List of List of Integers = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Lists' not 'List' after 'of'/);
  });
});
