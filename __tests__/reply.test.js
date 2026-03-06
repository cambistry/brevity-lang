import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('reply — same-line no-paren explicit', () => {
  it('reply a : Integer — typed positional', async () => {
    const source = [
      'on go(:n : Integer)',
      '  reply n : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 7 } }, 'bv-a': { go: { n: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: [7] }, to: 'caller' });
  });

  it('reply a, b — two bare positionals', async () => {
    const source = [
      'on go(:x : Integer, :y : Integer)',
      '  reply x, y',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { x: 3, y: 4 } }, 'bv-a': { go: { x: 'Integer', y: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: [3, 4] }, to: 'caller' });
  });

  it('reply :a, :b — sigil no-paren', async () => {
    const source = [
      'on go(:a : Integer, :b : Integer)',
      '  reply :a, :b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 10, b: 20 } }, 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { a: 10, b: 20 } }, to: 'caller' });
  });

  it('reply result: a + b — key-value no-paren', async () => {
    const source = [
      'on go(:a : Integer, :b : Integer)',
      '  reply result: a + b',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 5, b: 6 } }, 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { result: 11 } }, to: 'caller' });
  });
});

describe('reply', () => {
  it('computed reply field — reply(c: a + b : Integer)', async () => {
    const source = 'on add(:a : Integer, :b : Integer)\n  reply(c: a + b : Integer)\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });
});
