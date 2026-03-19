import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — over with trailing block and function references
// ═══════════════════════════════════════════════════════════════════════════════

describe('over — all forms', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- helpers ---

      double
        =
        n : Integer
        =
        -> n * 2 : Integer

      increment
        =
        n : Integer
        =
        -> n + 1 : Integer

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)

      --- inline trailing block ---

      @mapAddOne
        =
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : List of Integers = over(nums) |item : Integer| { item + 1 } : Integer
        -> :result

      @identityText
        =
        words : List of Texts = ["hello", "world"] : List of Texts
        result : List of Texts = over(words) |w : Text| { w } : Text
        -> :result

      @untypedBody
        =
        nums : List of Integers = [10, 20] : List of Integers
        result : List = over(nums) |item| { item }
        -> :result

      @emptyList
        =
        nums : List of Integers = []
        result : List of Integers = over(nums) |item : Integer| { item + 1 } : Integer
        -> :result

      @fnCallInBody
        =
        nums : List of Integers = [3, 4] : List of Integers
        result : List of Integers = over(nums) |item : Integer| {
          result: sq : Integer = square(item)
          sq
        } : Integer
        -> :result

      --- function reference forms ---

      @refParen
        =
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : List of Integers = over(nums, &double)
        -> :result

      @refNoParen
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : List of Integers = over nums, &increment
        -> :result

      @localRefParen
        =
        triple = |n : Integer| n * 3 : Integer
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : List of Integers = over(nums, &triple)
        -> :result

      @localRefNoParen
        =
        negate = |n : Integer| 0 - n : Integer
        nums : List of Integers = [5, 10, 15] : List of Integers
        result : List of Integers = over nums, &negate
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'mapAddOne', from: 'c' },
        { id: '2', op: 'identityText', from: 'c' },
        { id: '3', op: 'untypedBody', from: 'c' },
        { id: '4', op: 'emptyList', from: 'c' },
        { id: '5', op: 'fnCallInBody', from: 'c' },
        { id: '6', op: 'refParen', from: 'c' },
        { id: '7', op: 'refNoParen', from: 'c' },
        { id: '8', op: 'localRefParen', from: 'c' },
        { id: '9', op: 'localRefNoParen', from: 'c' },
      ],
    });
  });

  // inline trailing block
  it('maps integers: adds 1 to each element', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'List of Integers' }, re: { result: [2, 3, 4] }, to: 'c' });
  });

  it('identity map over texts', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'List of Texts' }, re: { result: ['hello', 'world'] }, to: 'c' });
  });

  it('untyped fn body → bv-a emits component types', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({
      'bv-a': { result: ['Integer', 'Integer'] }, re: { result: [10, 20] },
    }));
  });

  it('over empty list → result is null', () => {
    expect(outputs[3]).toEqual(expect.objectContaining({ re: { result: null } }));
  });

  it('function call inside fn body', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { result: 'List of Integers' }, re: { result: [9, 16] }, to: 'c' });
  });

  // function references
  it('over(list, &fn) — with parens', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { result: 'List of Integers' }, re: { result: [2, 4, 6] }, to: 'c' });
  });

  it('over list, &fn — without parens', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { result: 'List of Integers' }, re: { result: [11, 21, 31] }, to: 'c' });
  });

  it('over(list, &localFn) — local function reference', () => {
    expect(outputs[7]).toEqual({ id: '8', 'bv-a': { result: 'List of Integers' }, re: { result: [3, 6, 9] }, to: 'c' });
  });

  it('over list, &localFn — local without parens', () => {
    expect(outputs[8]).toEqual({ id: '9', 'bv-a': { result: 'List of Integers' }, re: { result: [-5, -10, -15] }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors + todo
// ═══════════════════════════════════════════════════════════════════════════════

describe('over — compile errors', () => {
  it('bare function name without & throws', () => {
    expect(() => compile(`
      @test
        =
        triple = |n : Integer| n * 3 : Integer
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : List of Integers = over(nums, triple)
        -> :result
    `)).toThrow(/use &triple/);
  });
});

describe('over — standalone', () => {
  it.todo('standalone over (side-effect only) — requires actor state, not yet implemented');
});
