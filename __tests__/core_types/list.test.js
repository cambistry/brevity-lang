import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Construction + destructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('List construction + destructure', () => {
  const script = `
      --- construction ---

      @emptyList
        =
        empty List[Integer] = []
        return result: empty

      @singleHead
        =
        nums List[Integer] = [7]
        [h Integer] = nums
        return head: h

      @typedList
        =
        nums List[Integer] = [1, 2, 3]
        return result: nums

      @textHead
        =
        words List[Text] = ["hello", "world"]
        [h Text, ..._] = words
        return first: h

      --- positional destructure ---

      @posTwo
        =
        nums List[Integer] = [5, 6, 7]
        [a Integer, b Integer, _] = nums
        return sum: a + b

      @posThree
        =
        nums List[Integer] = [1, 2, 3]
        [a Integer, b Integer, c Integer] = nums
        return sum: a + b + c

      --- head+tail destructure ---

      @headTail
        =
        nums List[Integer] = [10, 20, 30]
        [h Integer, ...t] = nums
        return head: h

      @singleTail
        =
        nums List[Integer] = [42]
        [h Integer, ...t] = nums
        return tail: t

      @discardHead
        =
        nums List[Integer] = [100, 200, 300]
        [_, ...t] = nums
        [h Integer, ..._] = t
        return second: h
  `;

  it('empty list is []', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'emptyList', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'List[Integer]' }], re: [{ result: [] }], to: 'c' } });
  });

  it('[7] head destructure', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'singleHead', from: 'c' } }, { output: { id: '2', 'ty': [{ head: 'Integer' }], re: [{ head: 7 }], to: 'c' } });
  });

  it('typed list variable carries List[Integer] in ty', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'typedList', from: 'c' } }, { output: expect.objectContaining({ id: '3', 'ty': [{ result: 'List[Integer]' }], re: [{ result: [1, 2, 3] }] }) });
  });

  it('List[Text] — head destructure', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'textHead', from: 'c' } }, { output: { id: '4', 'ty': [{ first: 'Text' }], re: [{ first: 'hello' }], to: 'c' } });
  });

  it('[a, b, _] positional destructure', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'posTwo', from: 'c' } }, { output: { id: '5', 'ty': [{ sum: 'Integer' }], re: [{ sum: 11 }], to: 'c' } });
  });

  it('[a, b, c] positional destructure', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'posThree', from: 'c' } }, { output: { id: '6', 'ty': [{ sum: 'Integer' }], re: [{ sum: 6 }], to: 'c' } });
  });

  it('[h, ...t] head+tail — head is first element', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'headTail', from: 'c' } }, { output: { id: '7', 'ty': [{ head: 'Integer' }], re: [{ head: 10 }], to: 'c' } });
  });

  it('[h, ...t] single element — tail is null', async () => {
    await expectBehavior(script, { input: { id: '8', op: 'singleTail', from: 'c' } }, { output: { id: '8', re: [{ tail: null }], to: 'c' } });
  });

  it('discard head, destructure tail — second element', async () => {
    await expectBehavior(script, { input: { id: '9', op: 'discardHead', from: 'c' } }, { output: { id: '9', 'ty': [{ second: 'Integer' }], re: [{ second: 200 }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type matching + Anything + BV-A + arity
// ═══════════════════════════════════════════════════════════════════════════════

describe('List type matching + Anything + BV-A', () => {
  const script = `
      @sum
        =
        nums: List[Integer]
        =
        [a Integer, b Integer] = nums
        return total: a + b

      @buildAnything
        =
        items List[Anything] = [1, "hello"]
        [h Anything, ..._] = items
        return first: h

      @buildBareList
        =
        items List = [1, 2, 3]
        return result: items

      @buildMixedTy
        =
        items List[Anything] = [1, "two"]
        return result: items

      @run
        =
        items: List
        =
        [h Anything, ..._] = items
        return first: h

      @arityError
        =
        nums List[Integer] = [1, 2, 3]
        [a Integer, b Integer] = nums
        return result: 0
  `;

  it('List[Integer] param — type match dispatches', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[{ nums: [3, 4] }], 'sum'], 'ty': [[{ nums: 'List[Integer]' }]], from: 'c' } }, { output: { id: '1', 'ty': [{ total: 'Integer' }], re: [{ total: 7 }], to: 'c' } });
  });

  it('List[Integer] param — type mismatch → unhandled', async () => {
    await expectBehavior(script, { input: { id: '2', op: [[{ nums: ['a'] }], 'sum'], 'ty': [[{ nums: 'List[Text]' }]], from: 'c' } }, { output: { id: '2', ex: { 'sum': 'unhandled' }, to: 'c' } });
  });

  it('List[Anything] — mixed elements, head destructure', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'buildAnything', from: 'c' } }, { output: expect.objectContaining({ re: [{ first: 1 }] }) });
  });

  it('bare List → component types array in ty', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'buildBareList', from: 'c' } }, { output: expect.objectContaining({ 'ty': [{ result: ['Integer', 'Integer', 'Integer'] }] }) });
  });

  it('List[Anything] → component types in ty', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'buildMixedTy', from: 'c' } }, { output: { id: '5', 'ty': [{ result: ['Integer', 'Text'] }], re: [{ result: [1, 'two'] }], to: 'c' } });
  });

  it('List param accepts component ty from caller', async () => {
    await expectBehavior(script, { input: { id: '6', op: [[{ items: [42, 'hello'] }], 'run'], 'ty': [[{ items: ['Integer', 'Text'] }]], from: 'c' } }, { output: { id: '6', 'ty': [{ first: 'Integer' }], re: [{ first: 42 }], to: 'c' } });
  });

  it('[a, b] = [1,2,3] — under-destructured without discard → runtime error', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'arityError', from: 'c' } }, { output: { id: '7', ex: { 'arityError': 'error' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors + valid compilation checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('List — compile errors', () => {
  it('a plural is not a type', () => {
    expect(() => compileSource(`@test = { x Integers = []; return result: 0 }\n`)).toThrow();
  });

  it('`of` is not a type form', () => {
    expect(() => compileSource(`@test = { x List of Integers = []; return result: 0 }\n`)).toThrow();
  });

  it('a container\'s `[` follows its name', () => {
    expect(() => compileSource(`@test = { x List [Integer] = []; return result: 0 }\n`)).toThrow();
  });
});

describe('List — valid compilation', () => {
  it('bare List = [] is valid (List[Anything])', () => {
    expect(() => compileSource(`@test = { x List = []; return result: 0 }\n`)).not.toThrow();
  });

  it('bare :x : List param is valid', () => {
    expect(() => compileSource('@test = (x: List) -> result: 0\n')).not.toThrow();
  });

  it('List[Anything] is a valid type', () => {
    expect(() => compileSource(`@test = { x List[Anything] = []; return result: 0 }\n`)).not.toThrow();
  });

  it('List[List[Integer]] is a valid type', () => {
    expect(() => compileSource(`
      @test
        =
        x List[List[Integer]] = []
        return result: 0
    `)).not.toThrow();
  });
});
