import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Construction + destructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('List construction + destructure', () => {
  const script = `
      --- construction ---

      @emptyList
        =
        empty List of Integers = []
        -> result: empty

      @singleHead
        =
        nums List of Integers = [7] as List of Integers
        [h Integer] = nums
        -> head: h

      @typedList
        =
        nums List of Integers = [1, 2, 3] as List of Integers
        -> result: nums

      @textHead
        =
        words List of Texts = ["hello", "world"] as List of Texts
        [h Text, ..._] = words
        -> first: h

      --- positional destructure ---

      @posTwo
        =
        nums List of Integers = [5, 6, 7] as List of Integers
        [a Integer, b Integer, _] = nums
        -> sum: (a + b) as Integer

      @posThree
        =
        nums List of Integers = [1, 2, 3] as List of Integers
        [a Integer, b Integer, c Integer] = nums
        -> sum: a + b + c as Integer

      --- head+tail destructure ---

      @headTail
        =
        nums List of Integers = [10, 20, 30] as List of Integers
        [h Integer, ...t] = nums
        -> head: h

      @singleTail
        =
        nums List of Integers = [42] as List of Integers
        [h Integer, ...t] = nums
        -> tail: t

      @discardHead
        =
        nums List of Integers = [100, 200, 300] as List of Integers
        [_, ...t] = nums
        [h Integer, ..._] = t
        -> second: h
  `;

  it('empty list is []', async () => {
    await expectBehavior({ script, receive: { id: '1', op: '@emptyList', from: 'c' }, reply: { id: '1', 'bv-a': { result: 'List of Integers' }, re: { result: [] }, to: 'c' } });
  });

  it('[7] head destructure', async () => {
    await expectBehavior({ script, receive: { id: '2', op: '@singleHead', from: 'c' }, reply: { id: '2', 'bv-a': { head: 'Integer' }, re: { head: 7 }, to: 'c' } });
  });

  it('typed list variable carries List of Integers in bv-a', async () => {
    await expectBehavior({ script, receive: { id: '3', op: '@typedList', from: 'c' }, reply: expect.objectContaining({ id: '3', 'bv-a': { result: 'List of Integers' }, re: { result: [1, 2, 3] } }) });
  });

  it('List of Texts — head destructure', async () => {
    await expectBehavior({ script, receive: { id: '4', op: '@textHead', from: 'c' }, reply: { id: '4', 'bv-a': { first: 'Text' }, re: { first: 'hello' }, to: 'c' } });
  });

  it('[a, b, _] positional destructure', async () => {
    await expectBehavior({ script, receive: { id: '5', op: '@posTwo', from: 'c' }, reply: { id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' } });
  });

  it('[a, b, c] positional destructure', async () => {
    await expectBehavior({ script, receive: { id: '6', op: '@posThree', from: 'c' }, reply: { id: '6', 'bv-a': { sum: 'Integer' }, re: { sum: 6 }, to: 'c' } });
  });

  it('[h, ...t] head+tail — head is first element', async () => {
    await expectBehavior({ script, receive: { id: '7', op: '@headTail', from: 'c' }, reply: { id: '7', 'bv-a': { head: 'Integer' }, re: { head: 10 }, to: 'c' } });
  });

  it('[h, ...t] single element — tail is null', async () => {
    await expectBehavior({ script, receive: { id: '8', op: '@singleTail', from: 'c' }, reply: { id: '8', re: { tail: null }, to: 'c' } });
  });

  it('discard head, destructure tail — second element', async () => {
    await expectBehavior({ script, receive: { id: '9', op: '@discardHead', from: 'c' }, reply: { id: '9', 'bv-a': { second: 'Integer' }, re: { second: 200 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type matching + Anything + BV-A + arity
// ═══════════════════════════════════════════════════════════════════════════════

describe('List type matching + Anything + BV-A', () => {
  const script = `
      @sum
        =
        nums: List of Integers
        =
        [a Integer, b Integer] = nums
        -> total: (a + b) as Integer

      @buildAnything
        =
        items List of Anything = [1, "hello"] as List of Anything
        [h Anything, ..._] = items
        -> first: h

      @buildBareList
        =
        items List = [1, 2, 3] as List of Anything
        -> result: items

      @buildMixedBva
        =
        items List of Anything = [1, "two"] as List of Anything
        -> result: items

      @run
        =
        items: List
        =
        [h Anything, ..._] = items
        -> first: h

      @arityError
        =
        nums List of Integers = [1, 2, 3] as List of Integers
        [a Integer, b Integer] = nums
        -> result: 0 as Integer
  `;

  it('List of Integers param — type match dispatches', async () => {
    await expectBehavior({ script, receive: { id: '1', op: [{ nums: [3, 4] }, '@sum'], 'bv-a': [{ nums: 'List of Integers' }], from: 'c' }, reply: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' } });
  });

  it('List of Integers param — type mismatch → unhandled', async () => {
    await expectBehavior({ script, receive: { id: '2', op: [{ nums: ['a'] }, '@sum'], 'bv-a': [{ nums: 'List of Texts' }], from: 'c' }, reply: { id: '2', ex: { '@sum': 'unhandled' }, to: 'c' } });
  });

  it('List of Anything — mixed elements, head destructure', async () => {
    await expectBehavior({ script, receive: { id: '3', op: '@buildAnything', from: 'c' }, reply: expect.objectContaining({ re: { first: 1 } }) });
  });

  it('bare List → component types array in bv-a', async () => {
    await expectBehavior({ script, receive: { id: '4', op: '@buildBareList', from: 'c' }, reply: expect.objectContaining({ 'bv-a': { result: ['Integer', 'Integer', 'Integer'] } }) });
  });

  it('List of Anything → component types in bv-a', async () => {
    await expectBehavior({ script, receive: { id: '5', op: '@buildMixedBva', from: 'c' }, reply: { id: '5', 'bv-a': { result: ['Integer', 'Text'] }, re: { result: [1, 'two'] }, to: 'c' } });
  });

  it('List param accepts component bv-a from caller', async () => {
    await expectBehavior({ script, receive: { id: '6', op: [{ items: [42, '@hello'] }, '@run'], 'bv-a': [{ items: ['Integer', 'Text'] }], from: 'c' }, reply: { id: '6', 'bv-a': { first: 'Anything' }, re: { first: 42 }, to: 'c' } });
  });

  it('[a, b] = [1,2,3] — under-destructured without discard → runtime error', async () => {
    await expectBehavior({ script, receive: { id: '7', op: '@arityError', from: 'c' }, reply: { id: '7', ex: { '@arityError': 'error' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors + valid compilation checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('List — compile errors', () => {
  it('List of Integer (singular) throws', () => {
    expect(() => compileSource(`@test = { x List of Integer = []; -> result: 0 as Integer }\n`)).toThrow(/Use plural 'Integers' not 'Integer' after 'of'/);
  });

  it('List of Text (singular) throws', () => {
    expect(() => compileSource(`@test = { x List of Text = []; -> result: 0 as Integer }\n`)).toThrow(/Use plural 'Texts' not 'Text' after 'of'/);
  });

  it('Integers as standalone type throws', () => {
    expect(() => compileSource(`@test = { x Integers = []; -> result: 0 as Integer }\n`)).toThrow(/'Integers' is not a valid standalone type/);
  });

  it('List of List (singular nested) throws', () => {
    expect(() => compileSource(`
      @test
        =
        x List of List of Integers = []
        -> result: 0 as Integer
    `)).toThrow(/Use plural 'Lists' not 'List' after 'of'/);
  });
});

describe('List — valid compilation', () => {
  it('bare List = [] is valid (List of Anything)', () => {
    expect(() => compileSource(`@test = { x List = []; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('bare :x : List param is valid', () => {
    expect(() => compileSource('@test = |x: List| -> result: 0 as Integer\n')).not.toThrow();
  });

  it('List of Anything is a valid type', () => {
    expect(() => compileSource(`@test = { x List of Anything = []; -> result: 0 as Integer }\n`)).not.toThrow();
  });

  it('List of Lists of Integers is a valid type', () => {
    expect(() => compileSource(`
      @test
        =
        x List of Lists of Integers = []
        -> result: 0 as Integer
    `)).not.toThrow();
  });
});
