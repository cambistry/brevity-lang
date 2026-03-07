import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('proc — basic call from handler', () => {
  it('handler calls proc, destructures result', async () => {
    const source = [
      'on foo()',
      '  result: x = square(10)',
      '  reply :x',
      '',
      'proc square(num : Integer)',
      '  sq = num * num',
      '  reply(result: sq : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0)); // flush async dispatch
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { foo: { x: 100 } }, to: 'caller' });
  });

  it('proc result assigned as whole Structure, then destructured', async () => {
    const source = [
      'on foo()',
      '  s = square(10)',
      '  result: x = s',
      '  reply :x',
      '',
      'proc square(num : Integer)',
      '  sq = num * num',
      '  reply(result: sq : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { foo: { x: 100 } }, to: 'caller' });
  });

  it('proc with named arg', async () => {
    const source = [
      'on greet(:name : Text)',
      '  result: msg = format(name)',
      '  reply :msg',
      '',
      'proc format(val : Text)',
      '  reply(result: val : Text)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { greet: { name: 'world' } }, 'bv-a': { greet: { name: 'Text' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { greet: { msg: 'world' } }, to: 'caller' });
  });

  it('proc called twice in same handler with different args', async () => {
    const source = [
      'on foo()',
      '  result: a = square(3)',
      '  result: b = square(4)',
      '  reply sum: a + b',
      '',
      'proc square(num : Integer)',
      '  sq = num * num',
      '  reply(result: sq : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { foo: { sum: 25 } }, to: 'caller' });
  });
});

describe('proc — mixed destructure from proc result', () => {
  it('positional + named + key-mapped all bound correctly', async () => {
    const source = [
      'on foo()',
      '  a, b, :c, d: x = sub()',
      '  reply pa: a + b, nc: c, nd: x',
      '',
      'proc sub',
      '',
      '  reply',
      '    10 : Integer',
      '    20 : Integer',
      '    c: "v1" : Text',
      '    d: "v2" : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'foo', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { foo: { pa: 30, nc: 'v1', nd: 'v2' } }, to: 'caller',
    });
  });
});

describe('proc — namespace', () => {
  it('on and proc with the same name throws at compile time', () => {
    const source = [
      'on square()',
      '  reply result: 0',
      '',
      'proc square(num : Integer)',
      '  reply(result: num : Integer)',
    ].join('\n');
    expect(() => compile(source)).toThrow(/'square' is declared as both/);
  });
});

describe('proc — direct call harness', () => {
  it.todo('proc exposed as public method for direct testing');
});
