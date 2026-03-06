import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('proc params — same-line no-paren', () => {
  it('single named param :n : Integer (call with named arg)', async () => {
    const source = [
      'on go()',
      '  result: x = double(n: 21)',
      '  reply :x',
      '',
      'proc double :n : Integer',
      '  reply result: n * 2 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 42 } }, to: 'caller' });
  });

  it('two named params :a : Integer, :b : Integer (call with named args)', async () => {
    const source = [
      'on go()',
      '  result: s = add(a: 3, b: 4)',
      '  reply :s',
      '',
      'proc add :a : Integer, :b : Integer',
      '  reply result: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { s: 7 } }, to: 'caller' });
  });

  it('positional param n : Integer', async () => {
    const source = [
      'on go()',
      '  result: x = triple(5)',
      '  reply :x',
      '',
      'proc triple n : Integer',
      '  reply result: n * 3 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 15 } }, to: 'caller' });
  });

  it('body follows on next line without blank line', async () => {
    const source = [
      'on go()',
      '  result: x = inc(9)',
      '  reply :x',
      '',
      'proc inc n : Integer',
      '  reply result: n + 1 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 10 } }, to: 'caller' });
  });
});

// ─── paren style (already tested in proc.test.js, here for completeness) ─────

describe('proc params — paren style', () => {
  it('proc(n : Integer) — explicit paren style', async () => {
    const source = [
      'on go()',
      '  result: x = sq(7)',
      '  reply :x',
      '',
      'proc sq(n : Integer)',
      '  reply result: n * n : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 49 } }, to: 'caller' });
  });

  it('proc() — empty parens, no params', async () => {
    const source = [
      'on go()',
      '  result: x = const()',
      '  reply :x',
      '',
      'proc const()',
      '  reply result: 42 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 42 } }, to: 'caller' });
  });
});

// ─── open style ──────────────────────────────────────────────────────────────

describe('proc params — open style', () => {
  it('single param n : Integer blank-line terminated', async () => {
    const source = [
      'on go()',
      '  result: x = double(10)',
      '  reply :x',
      '',
      'proc double',
      '  n : Integer',
      '',
      '  reply result: n * 2 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 20 } }, to: 'caller' });
  });

  it('two params a : Integer, b : Integer blank-line terminated', async () => {
    const source = [
      'on go()',
      '  result: s = add(6, 7)',
      '  reply :s',
      '',
      'proc add',
      '  a : Integer',
      '  b : Integer',
      '',
      '  reply result: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { s: 13 } }, to: 'caller' });
  });

  it('single param n : Integer terminated by bare --', async () => {
    const source = [
      'on go()',
      '  result: x = inc(4)',
      '  reply :x',
      '',
      'proc inc',
      '  n : Integer',
      '  --',
      '  reply result: n + 1 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 5 } }, to: 'caller' });
  });

  it('no params — blank line after proc name', async () => {
    const source = [
      'on go()',
      '  result: x = forty()',
      '  reply :x',
      '',
      'proc forty',
      '',
      '  reply result: 40 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 40 } }, to: 'caller' });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('proc params — invalid (compile throws)', () => {
  it('proc sub\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = [
      'on go()',
      '  result: x = sub()',
      '  reply :x',
      '',
      'proc sub',
      '  reply result: 0 : Integer',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });

  it('open-style param without blank-line terminator before body', () => {
    const source = [
      'on go()',
      '  result: x = double(5)',
      '  reply :x',
      '',
      'proc double',
      '  n : Integer',
      '  reply result: n * 2 : Integer',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    const source = [
      'on go()',
      '  result: x = inc(1)',
      '  reply :x',
      '',
      'proc inc',
      '  n : Integer',
      '  // done',
      '  reply result: n + 1 : Integer',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = [
      'on go()',
      '  result: x = inc(1)',
      '  reply :x',
      '',
      'proc inc',
      '  n : Integer',
      '  -- done',
      '  reply result: n + 1 : Integer',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });
});
