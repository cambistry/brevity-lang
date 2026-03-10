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
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: ['Integer'] }, re: { go: [7] }, to: 'caller' });
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
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: ['Integer', 'Integer'] }, re: { go: [3, 4] }, to: 'caller' });
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
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, re: { go: { a: 10, b: 20 } }, to: 'caller' });
  });

  it('reply result: a + b — key-value no-paren', async () => {
    const source = [
      'on go(:a : Integer, :b : Integer)',
      '  reply result: a + b : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 5, b: 6 } }, 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 11 } }, to: 'caller' });
  });
});

describe('reply', () => {
  it('computed reply field — reply(c: a + b : Integer)', async () => {
    const source = 'on add(:a : Integer, :b : Integer)\n  reply(c: a + b : Integer)\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', 'bv-a': { add: { c: 'Integer' } }, re: { add: { c: 7 } }, to: 'caller' });
  });
});

// ─── open style ──────────────────────────────────────────────────────────────

describe('reply — open style', () => {
  it('reply\\n :a — single named field on next line', async () => {
    const source = [
      'on go(:a : Integer)',
      '  reply',
      '  :a',
      '',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 7 } }, 'bv-a': { go: { a: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { a: 'Integer' } }, re: { go: { a: 7 } }, to: 'caller' });
  });

  it('reply\\n :a\\n :b — two named fields, blank-line terminated', async () => {
    const source = [
      'on go(:a : Integer, :b : Integer)',
      '  reply',
      '  :a',
      '  :b',
      '',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 3, b: 4 } }, 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { a: 'Integer', b: 'Integer' } }, re: { go: { a: 3, b: 4 } }, to: 'caller' });
  });

  it('reply open style with typed positional and key-value fields', async () => {
    // already tested via proc.test.js (proc sub open-style reply)
    const source = [
      'on go()',
      '  result: x = sub()',
      '  reply :x',
      '',
      'proc sub',
      '',
      '  reply',
      '    result: 99 : Integer',
      '',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 99 } }, to: 'caller' });
  });

  it('reply open style terminated by -- comment', async () => {
    const source = [
      'on go(:a : Integer)',
      '  reply',
      '  :a',
      '  --',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { a: 21 } }, 'bv-a': { go: { a: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { a: 'Integer' } }, re: { go: { a: 21 } }, to: 'caller' });
  });

  it('reply() explicit empty parens — next handler follows immediately', async () => {
    // reply() is explicit style (parens), so no open-style reading; next decl can follow
    const source = [
      'on ping()',
      '  reply()',
      'on pong()',
      '  reply answer: "pong" : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'pong', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { pong: { answer: 'Text' } }, re: { pong: { answer: 'pong' } }, to: 'caller' });
  });

  it('reply open style terminated by -- allows next proc to follow', async () => {
    const source = [
      'on go()',
      '  result: x = val()',
      '  reply',
      '  :x',
      '  --',
      'proc val()',
      '  reply result: 5 : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'go', from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { go: { x: 5 } }, to: 'caller' });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('reply — invalid (compile throws)', () => {
  it('reply :a\\n :b — same-line field then continuation on next line', () => {
    const source = [
      'on go(:a : Integer, :b : Integer)',
      '  reply :a',
      '  :b',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });

  it('reply open style not terminated before next proc', () => {
    // open-style reply must be terminated by blank line or -- before next declaration
    const source = [
      'on go()',
      '  result: x = val()',
      '  reply',
      '  :x',
      'proc val()',
      '  reply result: 5 : Integer',
    ].join('\n');
    expect(() => compile(source)).toThrow();
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('reply — open-form reply terminated by whitespace-only blank line', () => {
  it('whitespace-only blank line terminates open-form reply; next handler parses correctly', async () => {
    const source = `
      on greet()
        reply
        msg: "hello" : Text
      ${'  '}
      on ping()
        reply status: "ok" : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };

    new Actor(binding).receive({ id: '1', op: 'greet', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { greet: { msg: 'Text' } }, re: { greet: { msg: 'hello' } }, to: 'caller',
    });

    new Actor(binding).receive({ id: '2', op: 'ping', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '2', 'bv-a': { ping: { status: 'Text' } }, re: { ping: { status: 'ok' } }, to: 'caller',
    });
  });
});
