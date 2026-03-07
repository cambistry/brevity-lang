import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('function return — implicit (curly body)', () => {
  it('{ expr } still implicitly wraps final expression', async () => {
    const source = [
      'on go()',
      '  fn = (a) { a + 1 }',
      '  result = fn(5)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 6 } }, to: 'caller' });
  });

  it('body with assign then implicit return', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    x = a * 2',
      '    x + 1',
      '  }',
      '  result = fn(4)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 9 } }, to: 'caller' });
  });
});

describe('function return — explicit positional', () => {
  it('return (x : Integer) returns positional structure', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    x = a + 1',
      '    return (x : Integer)',
      '  }',
      '  result = fn(5)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 6 } }, to: 'caller' });
  });

  it('return (a : Integer, b : Integer) multi-positional', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) {',
      '    return (a : Integer, b : Integer)',
      '  }',
      '  x, y = fn(3, 4)',
      '  reply :x, :y',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 3, y: 4 } }, to: 'caller' });
  });
});

describe('function return — explicit named', () => {
  it('return (:x) returns named structure', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    x = a + 1',
      '    return (:x)',
      '  }',
      '  :x = fn(5)',
      '  reply :x',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 6 } }, to: 'caller' });
  });

  it('return (result: a + 1) named with expression', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return (result: a + 1)',
      '  }',
      '  :result = fn(5)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 6 } }, to: 'caller' });
  });
});

describe('function return — before end (early exit)', () => {
  it('return followed by dead code returns the early value', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return (a : Integer)',
      '    a + 999',
      '  }',
      '  result = fn(5)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 5 } }, to: 'caller' });
  });
});

describe('function return — no-paren explicit (same-line)', () => {
  it('return a — bare positional variable', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return a',
      '  }',
      '  result = fn(42)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 42 } }, to: 'caller' });
  });

  it('return a, b — two bare positionals', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) {',
      '    return a, b',
      '  }',
      '  x, y = fn(3, 4)',
      '  reply :x, :y',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 3, y: 4 } }, to: 'caller' });
  });

  it('return :a — sigil no-paren', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return :a',
      '  }',
      '  :a = fn(99)',
      '  reply :a',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { a: 99 } }, to: 'caller' });
  });

  it('return a: x — key-value no-paren', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return result: a',
      '  }',
      '  :result = fn(7)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 7 } }, to: 'caller' });
  });

  it('return a : Integer — typed positional no-paren', async () => {
    const source = [
      'on go()',
      '  fn = (a) {',
      '    return a : Integer',
      '  }',
      '  result = fn(13)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 13 } }, to: 'caller' });
  });
});
