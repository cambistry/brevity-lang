import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── 1. Dense form with initial value ─────────────────────────────────────────

describe('fold — dense with initial, &proc', () => {
  it('fold(0, nums, &add) sums a list', async () => {
    const source = `
      proc add(acc : Integer, item : Integer)
        reply acc + item : Integer

      on test()
        nums : List of Integers = [1, 2, 3, 4] : List of Integers
        result : Integer = fold(0, nums, &add)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 10 },
        to: 'caller',
      },
    });
  });
});

describe('fold — dense with initial, trailing block', () => {
  it('fold(1, nums) |acc, item| block computes product', async () => {
    const source = `
      on test()
        nums : List of Integers = [2, 3, 4] : List of Integers
        result : Integer = fold(1, nums) |acc : Integer, item : Integer| { acc * item } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 24 },
        to: 'caller',
      },
    });
  });
});

// ── 2. Dense form without initial value ──────────────────────────────────────

describe('fold — dense no initial, &proc', () => {
  it('fold(nums, &add) sums without initial', async () => {
    const source = `
      proc add(acc : Integer, item : Integer)
        reply acc + item : Integer

      on test()
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = fold(nums, &add)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 60 },
        to: 'caller',
      },
    });
  });
});

describe('fold — dense no initial, trailing block', () => {
  it('fold(nums) |acc, item| block sums', async () => {
    const source = `
      on test()
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = fold(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 60 },
        to: 'caller',
      },
    });
  });

  it('fold on single-element list returns the element', async () => {
    const source = `
      on test()
        nums : List of Integers = [42] : List of Integers
        result : Integer | null = fold(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 42 },
        to: 'caller',
      },
    });
  });

  it('fold on empty list returns null', async () => {
    const source = `
      on test()
        nums : List of Integers = []
        result : Integer | null = fold(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: null },
        to: 'caller',
      },
    });
  });
});

// ── 3. Spacious form ──────────────────────────────────────────────────────────

describe('fold — spacious with initial, &proc', () => {
  it('fold 0, nums, &add sums a list', async () => {
    const source = `
      proc add(acc : Integer, item : Integer)
        reply acc + item : Integer

      on test()
        nums : List of Integers = [5, 5, 5] : List of Integers
        result : Integer = fold 0, nums, &add
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });
});

describe('fold — spacious no initial, &proc', () => {
  it('fold nums, &add sums without initial', async () => {
    const source = `
      proc add(acc : Integer, item : Integer)
        reply acc + item : Integer

      on test()
        nums : List of Integers = [7, 8] : List of Integers
        result : Integer | null = fold nums, &add
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'Integer | null' },
        re: { result: 15 },
        to: 'caller',
      },
    });
  });
});

// ── 4. Compile errors ─────────────────────────────────────────────────────────

describe('fold — compile errors', () => {
  it('bare function name without & throws', () => {
    expect(() => compile(`
      on test()
        sum = |acc : Integer, item : Integer| acc + item : Integer
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : Integer = fold(0, nums, sum)
        reply :result
    `)).toThrow(/use &sum/);
  });
});
