import compile from '../index.js';
import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Construction + destructure
//
// List construction, typed list variables, positional destructure,
// head+tail destructure, discard head, single-element tail = null.
// ═══════════════════════════════════════════════════════════════════════════════

describe('List construction + destructure', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- construction ---

      @emptyList
        =
        empty : List of Integers = []
        -> result: empty

      @singleHead
        =
        nums : List of Integers = [7] : List of Integers
        [h : Integer] = nums
        -> head: h

      @typedList
        =
        nums : List of Integers = [1, 2, 3] : List of Integers
        -> result: nums

      @textHead
        =
        words : List of Texts = ["hello", "world"] : List of Texts
        [h : Text, ..._] = words
        -> first: h

      --- positional destructure ---

      @posTwo
        =
        nums : List of Integers = [5, 6, 7] : List of Integers
        [a : Integer, b : Integer, _] = nums
        -> sum: a + b : Integer

      @posThree
        =
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer, c : Integer] = nums
        -> sum: a + b + c : Integer

      --- head+tail destructure ---

      @headTail
        =
        nums : List of Integers = [10, 20, 30] : List of Integers
        [h : Integer, ...t] = nums
        -> head: h

      @singleTail
        =
        nums : List of Integers = [42] : List of Integers
        [h : Integer, ...t] = nums
        -> tail: t

      @discardHead
        =
        nums : List of Integers = [100, 200, 300] : List of Integers
        [_, ...t] = nums
        [h : Integer, ..._] = t
        -> second: h
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'emptyList', from: 'c' },
        { id: '2', op: 'singleHead', from: 'c' },
        { id: '3', op: 'typedList', from: 'c' },
        { id: '4', op: 'textHead', from: 'c' },
        { id: '5', op: 'posTwo', from: 'c' },
        { id: '6', op: 'posThree', from: 'c' },
        { id: '7', op: 'headTail', from: 'c' },
        { id: '8', op: 'singleTail', from: 'c' },
        { id: '9', op: 'discardHead', from: 'c' },
      ],
    });
  });

  // [] typed as List of Integers is null at runtime
  it('empty list is null', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'List of Integers' }, re: { result: null }, to: 'c' });
  });

  // [7] — head is 7
  it('[7] head destructure', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { head: 'Integer' }, re: { head: 7 }, to: 'c' });
  });

  // typed list variable → bv-a contains "List of Integers"
  it('typed list variable carries List of Integers in bv-a', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({
      id: '3', 'bv-a': { result: 'List of Integers' }, re: { result: [1, 2, 3] }, to: 'c',
    }));
  });

  // List of Texts — head is "hello"
  it('List of Texts — head destructure', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { first: 'Text' }, re: { first: 'hello' }, to: 'c' });
  });

  // [a, b, _] = [5,6,7] — first two elements
  it('[a, b, _] positional destructure', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' });
  });

  // [a, b, c] = [1,2,3] — all three elements
  it('[a, b, c] positional destructure', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { sum: 'Integer' }, re: { sum: 6 }, to: 'c' });
  });

  // [h, ...t] = [10,20,30] — head is 10
  it('[h, ...t] head+tail — head is first element', () => {
    expect(outputs[6]).toEqual({ id: '7', 'bv-a': { head: 'Integer' }, re: { head: 10 }, to: 'c' });
  });

  // [h, ...t] = [42] — tail of single-element list is null
  it('[h, ...t] single element — tail is null', () => {
    expect(outputs[7]).toEqual({ id: '8', re: { tail: null }, to: 'c' });
  });

  // [_, ...t] then [h, ..._] = t — gets second element
  it('discard head, destructure tail — second element', () => {
    expect(outputs[8]).toEqual({ id: '9', 'bv-a': { second: 'Integer' }, re: { second: 200 }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture — Type matching + Anything + BV-A + arity
//
// List type matching on incoming params, List of Anything construction,
// bare List BV-A component types, and runtime arity check.
// ═══════════════════════════════════════════════════════════════════════════════

describe('List type matching + Anything + BV-A', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      --- type matching on incoming param ---

      @sum
        =
        :nums : List of Integers
        =
        [a : Integer, b : Integer] = nums
        -> total: a + b : Integer

      --- List of Anything construction ---

      @buildAnything
        =
        items : List of Anything = [1, "hello"] : List of Anything
        [h : Anything, ..._] = items
        -> first: h

      --- bare List BV-A ---

      @buildBareList
        =
        items : List = [1, 2, 3] : List of Anything
        -> result: items

      --- List of Anything BV-A ---

      @buildMixedBva
        =
        items : List of Anything = [1, "two"] : List of Anything
        -> result: items

      --- incoming List param with component bv-a ---

      @run
        =
        :items : List
        =
        [h : Anything, ..._] = items
        -> first: h

      --- runtime arity error ---

      @arityError
        =
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer] = nums
        -> result: 0 : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ nums: [3, 4] }, 'sum'], 'bv-a': [{ nums: 'List of Integers' }], from: 'c' },
        { id: '2', op: [{ nums: ['a'] }, 'sum'], 'bv-a': [{ nums: 'List of Texts' }], from: 'c' },
        { id: '3', op: 'buildAnything', from: 'c' },
        { id: '4', op: 'buildBareList', from: 'c' },
        { id: '5', op: 'buildMixedBva', from: 'c' },
        { id: '6', op: [{ items: [42, 'hello'] }, 'run'], 'bv-a': [{ items: ['Integer', 'Text'] }], from: 'c' },
        { id: '7', op: 'arityError', from: 'c' },
      ],
    });
  });

  // :nums : List of Integers matches correct bv-a
  it('List of Integers param — type match dispatches', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' });
  });

  // :nums : List of Integers does not match List of Texts bv-a
  it('List of Integers param — type mismatch → unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { sum: 'unhandled' }, to: 'c' });
  });

  // [1, "hello"] : List of Anything — mixed elements, head is 1
  it('List of Anything — mixed elements, head destructure', () => {
    expect(outputs[2]).toEqual(expect.objectContaining({ re: { first: 1 }, to: 'c' }));
  });

  // bare List → bv-a emits component-types array
  it('bare List → component types array in bv-a', () => {
    expect(outputs[3]).toEqual(expect.objectContaining({
      'bv-a': { result: ['Integer', 'Integer', 'Integer'] },
    }));
  });

  // List of Anything → bv-a emits component types
  it('List of Anything → component types in bv-a', () => {
    expect(outputs[4]).toEqual({
      id: '5', 'bv-a': { result: ['Integer', 'Text'] }, re: { result: [1, 'two'] }, to: 'c',
    });
  });

  // :items : List param accepts array + component bv-a
  it('List param accepts component bv-a from caller', () => {
    expect(outputs[5]).toEqual({ id: '6', 'bv-a': { first: 'Anything' }, re: { first: 42 }, to: 'c' });
  });

  // [a, b] = [1,2,3] without discard — runtime arity error
  it('[a, b] = [1,2,3] — under-destructured without discard → runtime error', () => {
    expect(outputs[6]).toEqual({ id: '7', ex: { arityError: 'error' }, to: 'c' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors + valid compilation checks (no build needed — instant)
// ═══════════════════════════════════════════════════════════════════════════════

describe('List — compile errors', () => {
  it('List of Integer (singular) throws', () => {
    expect(() => compile(`
      @test
        =
        x : List of Integer = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Integers' not 'Integer' after 'of'/);
  });

  it('List of Text (singular) throws', () => {
    expect(() => compile(`
      @test
        =
        x : List of Text = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Texts' not 'Text' after 'of'/);
  });

  it('Integers as standalone type throws', () => {
    expect(() => compile(`
      @test
        =
        x : Integers = []
        -> result: 0 : Integer
    `)).toThrow(/'Integers' is not a valid standalone type/);
  });

  it('List of List (singular nested) throws', () => {
    expect(() => compile(`
      @test
        =
        x : List of List of Integers = []
        -> result: 0 : Integer
    `)).toThrow(/Use plural 'Lists' not 'List' after 'of'/);
  });
});

describe('List — valid compilation', () => {
  it('bare List = [] is valid (List of Anything)', () => {
    expect(() => compile(`
      @test
        =
        x : List = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('bare :x : List param is valid', () => {
    expect(() => compile(
      '@test = |:x : List| -> result: 0 : Integer\n'
    )).not.toThrow();
  });

  it('List of Anything is a valid type', () => {
    expect(() => compile(`
      @test
        =
        x : List of Anything = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });

  it('List of Lists of Integers is a valid type', () => {
    expect(() => compile(`
      @test
        =
        x : List of Lists of Integers = []
        -> result: 0 : Integer
    `)).not.toThrow();
  });
});
