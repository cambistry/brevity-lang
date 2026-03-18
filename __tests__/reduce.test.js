import compile from '../index.js';
import { expectReply } from './helpers.js';

// ── 1. Dense form with initial value ─────────────────────────────────────────

describe('reduce — dense with initial, &proc', () => {
  it('reduce(0, nums, &add) sums a list', async () => {
    const source = `
      add
        =
        acc : Integer
        item : Integer
        =
        -> acc + item : Integer

      @test
        =
        nums : List of Integers = [1, 2, 3, 4] : List of Integers
        result : Integer = reduce(0, nums, &add)
        -> :result
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

describe('reduce — dense with initial, trailing block', () => {
  it('reduce(1, nums) |acc, item| block computes product', async () => {
    const source = `
      @test
        =
        nums : List of Integers = [2, 3, 4] : List of Integers
        result : Integer = reduce(1, nums) |acc : Integer, item : Integer| { acc * item } : Integer
        -> :result
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

describe('reduce — dense no initial, &proc', () => {
  it('reduce(nums, &add) sums without initial', async () => {
    const source = `
      add
        =
        acc : Integer
        item : Integer
        =
        -> acc + item : Integer

      @test
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = reduce(nums, &add)
        -> :result
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

describe('reduce — dense no initial, trailing block', () => {
  it('reduce(nums) |acc, item| block sums', async () => {
    const source = `
      @test
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result
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

  it('reduce on single-element list returns the element', async () => {
    const source = `
      @test
        =
        nums : List of Integers = [42] : List of Integers
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result
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

  it('reduce on empty list returns null', async () => {
    const source = `
      @test
        =
        nums : List of Integers = []
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result
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

// ── 3. No parens form ──────────────────────────────────────────────────────────

describe('reduce — no parens with initial, &proc', () => {
  it('reduce 0, nums, &add sums a list', async () => {
    const source = `
      add
        =
        acc : Integer
        item : Integer
        =
        -> acc + item : Integer

      @test
        =
        nums : List of Integers = [5, 5, 5] : List of Integers
        result : Integer = reduce 0, nums, &add
        -> :result
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

describe('reduce — no parens no initial, &proc', () => {
  it('reduce nums, &add sums without initial', async () => {
    const source = `
      add
        =
        acc : Integer
        item : Integer
        =
        -> acc + item : Integer

      @test
        =
        nums : List of Integers = [7, 8] : List of Integers
        result : Integer | null = reduce nums, &add
        -> :result
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

describe('reduce — compile errors', () => {
  it('bare function name without & throws', () => {
    expect(() => compile(`
      @test
        =
        sum = |acc : Integer, item : Integer| acc + item : Integer
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : Integer = reduce(0, nums, sum)
        -> :result
    `)).toThrow(/use &sum/);
  });
});
