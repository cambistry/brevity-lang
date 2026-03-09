import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('Type | null — valid syntax', () => {
  it('Integer | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Integer | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('Text | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Text | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('Float | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Float | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('Boolean | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : Boolean | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('List of Integers | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Integers | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });

  it('List of Texts | null is a valid type (no throw)', () => {
    expect(() => compile([
      'on test()',
      '  x : List of Texts | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).not.toThrow();
  });
});

describe('Type | null — plural standalone still errors', () => {
  it('Integers | null throws', () => {
    expect(() => compile([
      'on test()',
      '  x : Integers | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/'Integers' is not a valid standalone type/);
  });

  it('Texts | null throws', () => {
    expect(() => compile([
      'on test()',
      '  x : Texts | null = null',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/'Texts' is not a valid standalone type/);
  });
});

describe('Type | null — runtime behaviour', () => {
  it('Text | null var holding a Text value replies correctly', async () => {
    const source = [
      'on test()',
      '  msg : Text | null = "hello" : Text',
      '  reply result: msg',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'Text | null' } },
      re: { test: { result: 'hello' } },
      to: 'caller',
    });
  });

  it('Float | null var holding null replies correctly', async () => {
    const source = [
      'on test()',
      '  x : Float | null = null',
      '  reply result: x',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'test', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { test: { result: 'Float | null' } },
      re: { test: { result: null } },
      to: 'caller',
    });
  });
});
