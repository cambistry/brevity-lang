import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ── Construction and reply ────────────────────────────────────────────────────

describe('List construction — reply', () => {
  it('[] typed as List of Integers is null at runtime', async () => {
    const source = [
      'on test()',
      '  empty : List of Integers = []',
      '  reply result: empty',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'List of Integers' } },
      re: { test: { result: null } },
      to: 'caller',
    });
  });

  it('[7] : List of Integers — head is 7', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [7] : List of Integers',
      '  [h : Integer] = nums',
      '  reply head: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { head: 'Integer' } },
      re: { test: { head: 7 } },
      to: 'caller',
    });
  });

  it('typed list variable → bv-a contains "List of Integers"', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [1, 2, 3] : List of Integers',
      '  reply result: nums',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        'bv-a': { test: { result: 'List of Integers' } },
        re: { test: { result: [1, 2, 3] } },
        to: 'caller',
      })
    );
  });

  it('List of Texts works', async () => {
    const source = [
      'on test()',
      '  words : List of Texts = ["hello", "world"] : List of Texts',
      '  [h : Text, ..._] = words',
      '  reply first: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { first: 'Text' } },
      re: { test: { first: 'hello' } },
      to: 'caller',
    });
  });
});

// ── Positional destructure ────────────────────────────────────────────────────

describe('List positional destructure', () => {
  it('[a : Integer, b : Integer, _] = list — first two elements', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [5, 6, 7] : List of Integers',
      '  [a : Integer, b : Integer, _] = nums',
      '  reply sum: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { sum: 'Integer' } },
      re: { test: { sum: 11 } },
      to: 'caller',
    });
  });

  it('[a : Integer, b : Integer, c : Integer] = list — first three', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [1, 2, 3] : List of Integers',
      '  [a : Integer, b : Integer, c : Integer] = nums',
      '  reply sum: a + b + c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { sum: 'Integer' } },
      re: { test: { sum: 6 } },
      to: 'caller',
    });
  });
});

// ── Head+tail destructure ─────────────────────────────────────────────────────

describe('List head+tail destructure', () => {
  it('[h : Integer, ...t] = list — head is first element', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [10, 20, 30] : List of Integers',
      '  [h : Integer, ...t] = nums',
      '  reply head: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { head: 'Integer' } },
      re: { test: { head: 10 } },
      to: 'caller',
    });
  });

  it('[h : Integer, ...t] = [42] — tail of single-element list is null', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [42] : List of Integers',
      '  [h : Integer, ...t] = nums',
      '  reply tail: t',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      re: { test: { tail: null } },
      to: 'caller',
    });
  });

  it('[_, ...t] = list — discard head, destructure tail to get second element', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [100, 200, 300] : List of Integers',
      '  [_, ...t] = nums',
      '  [h : Integer, ..._] = t',
      '  reply second: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { second: 'Integer' } },
      re: { test: { second: 200 } },
      to: 'caller',
    });
  });
});

// ── bv-a and type matching ────────────────────────────────────────────────────

describe('List type matching', () => {
  it(':nums : List of Integers matches correct bv-a', async () => {
    const source = [
      'on sum(:nums : List of Integers)',
      '  [a : Integer, b : Integer] = nums',
      '  reply total: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({
      id: '1',
      op: { sum: { nums: [3, 4] } },
      'bv-a': { sum: { nums: 'List of Integers' } },
      from: 'caller',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { sum: { total: 'Integer' } },
      re: { sum: { total: 7 } },
      to: 'caller',
    });
  });

  it(':nums : List of Integers does not match List of Texts bv-a', async () => {
    const source = [
      'on sum(:nums : List of Integers)',
      '  [a : Integer, b : Integer] = nums',
      '  reply total: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({
      id: '1',
      op: { sum: { nums: ['a'] } },
      'bv-a': { sum: { nums: 'List of Texts' } },
      from: 'caller',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: { sum: 'unhandled' },
      to: 'caller',
    });
  });
});

// ── Runtime arity check ───────────────────────────────────────────────────────

describe('List destructure arity', () => {
  it('[a, b] = [1, 2, 3] throws — under-destructured without discard', async () => {
    const source = [
      'on test()',
      '  nums : List of Integers = [1, 2, 3] : List of Integers',
      '  [a : Integer, b : Integer] = nums',
      '  reply result: 0 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: { test: 'error' },
      to: 'caller',
    });
  });
});

// ── Compile errors ────────────────────────────────────────────────────────────

describe('List compile errors', () => {
  it('x : List of Integer (singular) throws', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Integer = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/Use plural 'Integers' not 'Integer' after 'of'/);
  });

  it('x : List of Text (singular) throws', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Text = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/Use plural 'Texts' not 'Text' after 'of'/);
  });

  it('x : Integers = ... (plural standalone) throws', () => {
    expect(() => compile([
      'on test()',
      '  x : Integers = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/'Integers' is not a valid standalone type/);
  });
});

// ── Bare List = List of Any ───────────────────────────────────────────────────

describe('Bare List (= List of Any)', () => {
  it('x : List = [] is valid — bare List treated as List of Any', () => {
    expect(() => compile([
      'on test()',
      '  x : List = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it(':x : List param is valid — bare List treated as List of Any', () => {
    expect(() => compile(
      'on test(:x : List) reply result: 0 : Integer\n'
    )).not.toThrow();
  });

  it('bare List reply emits component-types array in bv-a', async () => {
    const source = [
      'on test()',
      '  items : List = [1, 2, 3] : List of Any',
      '  reply result: items',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({
        'bv-a': { test: { result: ['Integer', 'Integer', 'Integer'] } },
      })
    );
  });
});

// ── List of Any ───────────────────────────────────────────────────────────────

describe('List of Any', () => {
  it('[1, "hello"] : List of Any — mixed elements', async () => {
    const source = [
      'on test()',
      '  items : List of Any = [1, "hello"] : List of Any',
      '  [h : Any, ..._] = items',
      '  reply first: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({
        re: { test: { first: 1 } },
        to: 'caller',
      })
    );
  });

  it('List of Any is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Any = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });
});

// ── List of Any — BV-A in both directions ────────────────────────────────────

describe('List of Any BV-A', () => {
  it('re: List of Any emits component types array in bv-a', async () => {
    const source = [
      'on build()',
      '  items : List of Any = [1, "two"] : List of Any',
      '  reply result: items',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'build', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { build: { result: ['Integer', 'Text'] } },
      re: { build: { result: [1, 'two'] } },
      to: 'caller',
    });
  });

  it('op: List of Any param accepts array + component bv-a', async () => {
    const source = [
      'on run(:items : List)',
      '  [h : Any, ..._] = items',
      '  reply first: h',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({
      id: '1',
      op: { run: { items: [42, 'hello'] } },
      'bv-a': { run: { items: ['Integer', 'Text'] } },
      from: 'caller',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { run: { first: 'Any' } },
      re: { run: { first: 42 } },
      to: 'caller',
    });
  });
});

// ── Nested lists ──────────────────────────────────────────────────────────────

describe('Nested List of Lists', () => {
  it('List of Lists of Integers is a valid type', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Lists of Integers = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('List of List (singular) throws', () => {
    expect(() => compile([
      'on test()',
      '  x : List of List of Integers = []',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/Use plural 'Lists' not 'List' after 'of'/);
  });
});
