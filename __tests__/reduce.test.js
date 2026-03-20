import compile from '../index.js';
import { runActor } from './helpers.js';

describe('reduce', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      add
        =
        acc : Integer
        item : Integer
        =
        -> acc + item : Integer

      @sumWithInit
        =
        nums : List of Integers = [1, 2, 3, 4] : List of Integers
        result : Integer = reduce(0, nums, &add)
        -> :result

      @productBlock
        =
        nums : List of Integers = [2, 3, 4] : List of Integers
        result : Integer = reduce(1, nums) |acc : Integer, item : Integer| { acc * item } : Integer
        -> :result

      @sumNoInit
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = reduce(nums, &add)
        -> :result

      @sumBlockNoInit
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result

      @singleElement
        =
        nums : List of Integers = [42] : List of Integers
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result

      @emptyList
        =
        nums : List of Integers = []
        result : Integer | null = reduce(nums) |acc : Integer, item : Integer| { acc + item } : Integer
        -> :result

      @noParenInit
        =
        nums : List of Integers = [5, 5, 5] : List of Integers
        result : Integer = reduce 0, nums, &add
        -> :result

      @noParenNoInit
        =
        nums : List of Integers = [7, 8] : List of Integers
        result : Integer | null = reduce nums, &add
        -> :result

      --- spacious trailing block ---

      @spaciousWithInit
        =
        nums : List of Integers = [2, 3, 4] : List of Integers
        result : Integer = reduce(1, nums)
          =
          acc : Integer
          item : Integer
          =
          -> acc * item : Integer
        -> :result

      @spaciousNoInit
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = reduce(nums)
          =
          acc : Integer
          item : Integer
          =
          -> acc + item : Integer
        -> :result

      @spaciousNoParenInit
        =
        nums : List of Integers = [1, 2, 3, 4] : List of Integers
        result : Integer = reduce 0, nums
          =
          acc : Integer
          item : Integer
          =
          -> acc + item : Integer
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@sumWithInit', from: 'c' },
        { id: '2', op: '@productBlock', from: 'c' },
        { id: '3', op: '@sumNoInit', from: 'c' },
        { id: '4', op: '@sumBlockNoInit', from: 'c' },
        { id: '5', op: '@singleElement', from: 'c' },
        { id: '6', op: '@emptyList', from: 'c' },
        { id: '7', op: '@noParenInit', from: 'c' },
        { id: '8', op: '@noParenNoInit', from: 'c' },
        { id: '9', op: '@spaciousWithInit', from: 'c' },
        { id: '10', op: '@spaciousNoInit', from: 'c' },
        { id: '11', op: '@spaciousNoParenInit', from: 'c' },
      ],
    });
  });

  it('reduce(0, nums, &add) sums with initial', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });

  it('reduce(1, nums) |acc, item| block computes product', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' });
  });

  it('reduce(nums, &add) sums without initial', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' });
  });

  it('reduce(nums) trailing block sums without initial', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' });
  });

  it('reduce on single-element list returns the element', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' });
  });

  it('reduce on empty list returns null', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' });
  });

  it('reduce 0, nums, &add — no parens with initial', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' });
  });

  it('reduce nums, &add — no parens no initial', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'Integer | null' }, re: { result: 15 }, to: 'c' });
  });

  // spacious trailing block
  it('reduce(1, nums) spacious — product with initial', () => {
    expect(outputs[8]).toEqual({ id: '9', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' });
  });

  it('reduce(nums) spacious — sum without initial', () => {
    expect(outputs[9]).toEqual({ id: '10', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' });
  });

  it('reduce 0, nums spacious — no parens with initial', () => {
    expect(outputs[10]).toEqual({ id: '11', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' });
  });
});

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
