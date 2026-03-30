import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// over with trailing block and function references
// ═══════════════════════════════════════════════════════════════════════════════

describe('over — all forms', () => {
  const script = `
    --- helpers ---

    double
      =
      n Integer
      =
      -> (n * 2) as Integer

    increment
      =
      n Integer
      =
      -> (n + 1) as Integer

    square
      =
      num Integer
      =
      sq Integer = num * num
      ->(result: sq as Integer)

    --- inline trailing block ---

    @mapAddOne
      =
      nums List of Integers = [1, 2, 3] as List of Integers
      result List of Integers = over(nums) |item Integer| { item + 1 } as Integer
      -> :result

    @identityText
      =
      words List of Texts = ["hello", "world"] as List of Texts
      result List of Texts = over(words) |w Text| { w } as Text
      -> :result

    @untypedBody
      =
      nums List of Integers = [10, 20] as List of Integers
      result List = over(nums) |item| { item }
      -> :result

    @emptyList
      =
      nums List of Integers = []
      result List of Integers = over(nums) |item Integer| { item + 1 } as Integer
      -> :result

    @fnCallInBody
      =
      nums List of Integers = [3, 4] as List of Integers
      result List of Integers = over(nums) |item Integer| {
        result: sq Integer = square(item)
        sq
      } as Integer
      -> :result

    --- function reference forms ---

    @refParen
      =
      nums List of Integers = [1, 2, 3] as List of Integers
      result List of Integers = over(nums, &double)
      -> :result

    @refNoParen
      =
      nums List of Integers = [10, 20, 30] as List of Integers
      result List of Integers = over nums, &increment
      -> :result

    @localRefParen
      =
      triple = |n Integer| n * 3 as Integer
      nums List of Integers = [1, 2, 3] as List of Integers
      result List of Integers = over(nums, &triple)
      -> :result

    @localRefNoParen
      =
      negate = |n Integer| 0 - n as Integer
      nums List of Integers = [5, 10, 15] as List of Integers
      result List of Integers = over nums, &negate
      -> :result

    --- lineal trailing block ---

    @spaciousParen
      =
      nums List of Integers = [1, 2, 3] as List of Integers
      result List of Integers = over(nums)
        =
        item Integer
        =
        -> (item + 1) as Integer
      -> :result

    @spaciousNoParen
      =
      nums List of Integers = [10, 20, 30] as List of Integers
      result List of Integers = over nums
        =
        item Integer
        =
        -> item * 2 as Integer
      -> :result
  `;

  it('maps integers: adds 1 to each element', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@mapAddOne', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'List of Integers' }, re: { result: [2, 3, 4] }, to: 'c' } },
    );
  });

  it('identity map over texts', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@identityText', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'List of Texts' }, re: { result: ['hello', 'world'] }, to: 'c' } },
    );
  });

  it('untyped fn body → bv-a emits component types', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@untypedBody', from: 'c' } },
      { output: expect.objectContaining({ 'bv-a': { result: ['Integer', 'Integer'] }, re: { result: [10, 20] } }) },
    );
  });

  it('over empty list → result is []', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@emptyList', from: 'c' } },
      { output: expect.objectContaining({ re: { result: [] } }) },
    );
  });

  it('function call inside fn body', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@fnCallInBody', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'List of Integers' }, re: { result: [9, 16] }, to: 'c' } },
    );
  });

  it('over(list, &fn) — with parens', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@refParen', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'List of Integers' }, re: { result: [2, 4, 6] }, to: 'c' } },
    );
  });

  it('over list, &fn — without parens', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@refNoParen', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'List of Integers' }, re: { result: [11, 21, 31] }, to: 'c' } },
    );
  });

  it('over(list, &localFn) — local function reference', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@localRefParen', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'List of Integers' }, re: { result: [3, 6, 9] }, to: 'c' } },
    );
  });

  it('over list, &localFn — local without parens', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@localRefNoParen', from: 'c' } },
      { output: { id: '9', 'bv-a': { result: 'List of Integers' }, re: { result: [-5, -10, -15] }, to: 'c' } },
    );
  });

  it('over(nums) lineal trailing block — with parens', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@spaciousParen', from: 'c' } },
      { output: { id: '10', 'bv-a': { result: 'List of Integers' }, re: { result: [2, 3, 4] }, to: 'c' } },
    );
  });

  it('over nums lineal trailing block — without parens', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@spaciousNoParen', from: 'c' } },
      { output: { id: '11', 'bv-a': { result: 'List of Integers' }, re: { result: [20, 40, 60] }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors + todo
// ═══════════════════════════════════════════════════════════════════════════════

describe('over — compile errors', () => {
  it('bare function name without & throws', () => {
    expect(() => compileSource(`
      @test
        =
        triple = |n Integer| n * 3 as Integer
        nums List of Integers = [1, 2, 3] as List of Integers
        result List of Integers = over(nums, triple)
        -> :result
    `)).toThrow(/use &triple/);
  });
});

describe('over — standalone', () => {
  it.todo('standalone over (side-effect only) — requires actor state, not yet implemented');
});
