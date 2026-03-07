import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('function — curly-brace body', () => {
  it('(a) { a + 1 } binds single positional', async () => {
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

  it('(a, b) { a + b } binds two positionals', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) { a + b }',
      '  result = fn(3, 4)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 7 } }, to: 'caller' });
  });

  it('(a, b) { a * b } multiplies', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) { a * b }',
      '  result = fn(6, 7)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 42 } }, to: 'caller' });
  });
});

describe('function — single-expr body (no curlies)', () => {
  it('(a) a + 1 parses expr to EOL', async () => {
    const source = [
      'on go()',
      '  fn = (a) a + 1',
      '  result = fn(10)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 11 } }, to: 'caller' });
  });

  it('(a : Integer) a * 2 with typed param', async () => {
    const source = [
      'on go()',
      '  fn = (a : Integer) a * 2',
      '  result = fn(7)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 14 } }, to: 'caller' });
  });

  it('(a, b) a - b with two params', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) a - b',
      '  result = fn(10, 3)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 7 } }, to: 'caller' });
  });
});

describe('function — return type annotation', () => {
  it('(a, b) { a / b } : Float compiles and returns correct value', async () => {
    const source = [
      'on go()',
      '  fn = (a, b) { a / b } : Float',
      '  result = fn(10, 2)',
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

describe('function — called multiple times', () => {
  it('same function called twice gives independent results', async () => {
    const source = [
      'on go()',
      '  fn = (a) { a * a }',
      '  x = fn(3)',
      '  y = fn(5)',
      '  reply :x, :y',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 9, y: 25 } }, to: 'caller' });
  });

  it('two distinct functions in same handler', async () => {
    const source = [
      'on go()',
      '  double = (a) a * 2',
      '  triple = (a) a * 3',
      '  x = double(4)',
      '  y = triple(4)',
      '  reply :x, :y',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 8, y: 12 } }, to: 'caller' });
  });
});
