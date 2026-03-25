import compile from '../../index.js';
import { expectReply } from '../helpers.js';

describe('reduce', () => {
  const script = `
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

    --- lineal trailing block ---

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

  it('reduce(0, nums, &add) sums with initial', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@sumWithInit', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('reduce(1, nums) |acc, item| block computes product', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@productBlock', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' },
    });
  });

  it('reduce(nums, &add) sums without initial', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@sumNoInit', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' },
    });
  });

  it('reduce(nums) trailing block sums without initial', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@sumBlockNoInit', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' },
    });
  });

  it('reduce on single-element list returns the element', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@singleElement', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('reduce on empty list returns null', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@emptyList', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' },
    });
  });

  it('reduce 0, nums, &add — no parens with initial', async () => {
    await expectReply({
      script, receive: { id: '7', op: '@noParenInit', from: 'c' },
      reply: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' },
    });
  });

  it('reduce nums, &add — no parens no initial', async () => {
    await expectReply({
      script, receive: { id: '8', op: '@noParenNoInit', from: 'c' },
      reply: { id: '8', 'bv-a': { result: 'Integer | null' }, re: { result: 15 }, to: 'c' },
    });
  });

  it('reduce(1, nums) lineal — product with initial', async () => {
    await expectReply({
      script, receive: { id: '9', op: '@spaciousWithInit', from: 'c' },
      reply: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' },
    });
  });

  it('reduce(nums) lineal — sum without initial', async () => {
    await expectReply({
      script, receive: { id: '10', op: '@spaciousNoInit', from: 'c' },
      reply: { id: '10', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' },
    });
  });

  it('reduce 0, nums lineal — no parens with initial', async () => {
    await expectReply({
      script, receive: { id: '11', op: '@spaciousNoParenInit', from: 'c' },
      reply: { id: '11', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
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
