import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('function params — named via sigil', () => {
  it('(:name) binds named field', async () => {
    const source = [
      'on go()',
      '  fn = (:name) { name }',
      '  result, = fn(name: 42)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 42 } }, to: 'caller' });
  });

  it('(:n : Integer) with typed sigil', async () => {
    const source = [
      'on go()',
      '  fn = (:n : Integer) { n * 2 }',
      '  result, = fn(n: 5)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 10 } }, to: 'caller' });
  });
});

describe('function params — key-mapped', () => {
  it('(label: x) binds key to local name', async () => {
    const source = [
      'on go()',
      '  fn = (label: x) { x + 1 }',
      '  result, = fn(label: 9)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 10 } }, to: 'caller' });
  });

  it('(first: a, last: b) two key-mapped params', async () => {
    const source = [
      'on go()',
      '  fn = (first: a, last: b) { a + b }',
      '  result, = fn(first: 3, last: 4)',
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

describe('function params — mixed positional and named', () => {
  it('(a, :b) binds positional and named', async () => {
    const source = [
      'on go()',
      '  fn = (a, :b) { a + b }',
      '  result, = fn(3, b: 4)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 7 } }, to: 'caller' });
  });

  it('(:a, :b) two named-only params', async () => {
    const source = [
      'on go()',
      '  fn = (:a, :b) { a + b }',
      '  result, = fn(a: 10, b: 20)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 30 } }, to: 'caller' });
  });
});
