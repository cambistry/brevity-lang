import { expectBehavior, compileSource } from '../helpers.js';

describe('reduce', () => {
  const script = `
    add
      =
      acc Integer
      item Integer
      =
      -> acc + item as Integer

    @sumWithInit
      =
      nums List of Integers = [1, 2, 3, 4]
      result Integer = reduce(0, nums, &add)
      -> :result

    @productBlock
      =
      nums List of Integers = [2, 3, 4]
      result Integer = reduce(1, nums) |acc Integer, item Integer| { acc * item } as Integer
      -> :result

    @sumNoInit
      =
      nums List of Integers = [10, 20, 30]
      result Integer | null = reduce(nums, &add)
      -> :result

    @sumBlockNoInit
      =
      nums List of Integers = [10, 20, 30]
      result Integer | null = reduce(nums) |acc Integer, item Integer| { acc + item } as Integer
      -> :result

    @singleElement
      =
      nums List of Integers = [42]
      result Integer | null = reduce(nums) |acc Integer, item Integer| { acc + item } as Integer
      -> :result

    @emptyList
      =
      nums List of Integers = []
      result Integer | null = reduce(nums) |acc Integer, item Integer| { acc + item } as Integer
      -> :result

    @noParenInit
      =
      nums List of Integers = [5, 5, 5]
      result Integer = reduce 0, nums, &add
      -> :result

    @noParenNoInit
      =
      nums List of Integers = [7, 8]
      result Integer | null = reduce nums, &add
      -> :result

    --- lineal trailing block ---

    @spaciousWithInit
      =
      nums List of Integers = [2, 3, 4]
      result Integer = reduce(1, nums)
        =
        acc Integer
        item Integer
        =
        -> acc * item as Integer
      -> :result

    @spaciousNoInit
      =
      nums List of Integers = [10, 20, 30]
      result Integer | null = reduce(nums)
        =
        acc Integer
        item Integer
        =
        -> acc + item as Integer
      -> :result

    @spaciousNoParenInit
      =
      nums List of Integers = [1, 2, 3, 4]
      result Integer = reduce 0, nums
        =
        acc Integer
        item Integer
        =
        -> acc + item as Integer
      -> :result
  `;

  it('reduce(0, nums, &add) sums with initial', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@sumWithInit', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('reduce(1, nums) |acc, item| block computes product', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@productBlock', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' } },
    );
  });

  it('reduce(nums, &add) sums without initial', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@sumNoInit', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' } },
    );
  });

  it('reduce(nums) trailing block sums without initial', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@sumBlockNoInit', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' } },
    );
  });

  it('reduce on single-element list returns the element', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@singleElement', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('reduce on empty list returns null', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@emptyList', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' } },
    );
  });

  it('reduce 0, nums, &add — no parens with initial', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@noParenInit', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('reduce nums, &add — no parens no initial', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@noParenNoInit', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'Integer | null' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('reduce(1, nums) lineal — product with initial', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@spaciousWithInit', from: 'c' } },
      { output: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 24 }, to: 'c' } },
    );
  });

  it('reduce(nums) lineal — sum without initial', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@spaciousNoInit', from: 'c' } },
      { output: { id: '10', 'bv-a': { result: 'Integer | null' }, re: { result: 60 }, to: 'c' } },
    );
  });

  it('reduce 0, nums lineal — no parens with initial', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@spaciousNoParenInit', from: 'c' } },
      { output: { id: '11', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });
});

describe('reduce — compile errors', () => {
  it('bare function name without & throws', () => {
    expect(() => compileSource(`
      @test
        =
        sum = |acc Integer, item Integer| acc + item
        nums List of Integers = [1, 2, 3]
        result Integer = reduce(0, nums, sum)
        -> :result
    `)).toThrow(/use &sum/);
  });
});
