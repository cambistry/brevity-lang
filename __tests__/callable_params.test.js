import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ── 1. Function literal as positional callable arg ────────────────────────────

describe('callable params — function literal as positional arg', () => {
  it('applies a function literal passed as positional arg', async () => {
    const source = [
      'on go()',
      '  apply = (n, f) { r : Integer = f(n) }',
      '  result : Integer = apply(5, (x : Integer) x * 2)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 10 } }, to: 'caller',
    });
  });
});

// ── 2. Function literal as named callable arg ─────────────────────────────────

describe('callable params — function literal as named arg', () => {
  it('applies a function literal passed as named arg', async () => {
    const source = [
      'on go()',
      '  compute = (:n : Integer, :transform) { r : Integer = transform(n) }',
      '  result : Integer = compute(n: 3, transform: (x : Integer) x + 7)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 10 } }, to: 'caller',
    });
  });
});

// ── 3. Proc reference &name as callable ──────────────────────────────────────

describe('callable params — proc reference &name as callable', () => {
  it('passes &proc as a callable arg', async () => {
    const source = [
      'proc double(n : Integer)',
      '  reply(n * 2 : Integer)',
      '',
      'on go()',
      '  apply = (n, f) { r : Integer = f(n) }',
      '  result : Integer = apply(5, &double)',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 10 } }, to: 'caller',
    });
  });
});

// ── 4. Callable-typed local variable ─────────────────────────────────────────

describe('callable params — Callable-typed local variable', () => {
  it('assigns a function literal to a Callable-typed local and calls it', async () => {
    const source = [
      'on go()',
      '  fn : Callable = (x : Integer) x + 1',
      '  r : Integer = fn(9)',
      '  reply :r',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { go: { r: 'Integer' } }, re: { go: { r: 10 } }, to: 'caller',
    });
  });
});

// ── 5. Proc returning a callable (ImplicitReturn in proc) ─────────────────────

describe('callable params — proc returning a callable via ImplicitReturn', () => {
  it('proc body ImplicitReturn returns a function literal as callable', async () => {
    const source = [
      'proc constant(n : Integer)',
      '  fn = () n : Integer',
      '  reply(fn : Callable)',
      '',
      'on go()',
      '  getConst = constant(42)',
      '  result : Integer = getConst()',
      '  reply :result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 42 } }, to: 'caller',
    });
  });
});
