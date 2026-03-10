import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ─── same-line no-paren ───────────────────────────────────────────────────────

describe('on params — same-line no-paren', () => {
  it('single named param :n : Integer', async () => {
    const source = `
      on go :n : Integer
        reply :n
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 42 } }, 'bv-a': { go: { n: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { n: 'Integer' } }, re: { go: { n: 42 } }, to: 'caller' });
  });

  it('two named params :n : Integer, :m : Integer', async () => {
    const source = `
      on go :n : Integer, :m : Integer
        reply sum: n + m : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 3, m: 4 } }, 'bv-a': { go: { n: 'Integer', m: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { sum: 'Integer' } }, re: { go: { sum: 7 } }, to: 'caller' });
  });

  it('positional param n : Integer', async () => {
    const source = `
      on go n : Integer
        reply n : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: [99] }, 'bv-a': { go: ['Integer'] }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: ['Integer'] }, re: { go: [99] }, to: 'caller' });
  });

  it('two positional params a : Integer, b : Integer', async () => {
    const source = `
      on add a : Integer, b : Integer
        reply sum: a + b : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: [5, 6] }, 'bv-a': { add: ['Integer', 'Integer'] }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { add: { sum: 'Integer' } }, re: { add: { sum: 11 } }, to: 'caller' });
  });

  it('body follows on next line without blank line', async () => {
    // same-line explicit: body may immediately follow on next line
    const source = `
      on ping :x : Integer
        reply :x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { ping: { x: 7 } }, 'bv-a': { ping: { x: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { ping: { x: 'Integer' } }, re: { ping: { x: 7 } }, to: 'caller' });
  });

});

// ─── open style ──────────────────────────────────────────────────────────────

describe('on params — open style', () => {
  it('no params — blank line after on name', async () => {
    const source = `
      on hello

        reply answer: "world" : Text
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { hello: { answer: 'Text' } }, re: { hello: { answer: 'world' } }, to: 'caller' });
  });

  it('single param :n : Integer blank-line terminated', async () => {
    const source = `
      on go
        :n : Integer

        reply :n
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 10 } }, 'bv-a': { go: { n: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { n: 'Integer' } }, re: { go: { n: 10 } }, to: 'caller' });
  });

  it('two params blank-line terminated', async () => {
    const source = `
      on add
        :a : Integer
        :b : Integer

        reply sum: a + b : Integer
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 10, b: 20 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { add: { sum: 'Integer' } }, re: { add: { sum: 30 } }, to: 'caller' });
  });

  it('single param terminated by -- comment', async () => {
    const source = `
      on go
        :n : Integer
        --
        reply :n
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 55 } }, 'bv-a': { go: { n: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { n: 'Integer' } }, re: { go: { n: 55 } }, to: 'caller' });
  });

  it('single param terminated by bare //', async () => {
    const source = `
      on go
        :n : Integer
        //
        reply :n
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { go: { n: 33 } }, 'bv-a': { go: { n: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { go: { n: 'Integer' } }, re: { go: { n: 33 } }, to: 'caller' });
  });

  it('multiple handlers: open style does not bleed into next handler', async () => {
    const source = `
      on foo
        :x : Integer

        reply :x

      on bar
        :y : Integer

        reply :y
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { foo: { x: 1 } }, 'bv-a': { foo: { x: 'Integer' } }, from: 'caller' });
    new Actor(binding).receive({ id: '2', op: { bar: { y: 2 } }, 'bv-a': { bar: { y: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { foo: { x: 'Integer' } }, re: { foo: { x: 1 } }, to: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '2', 'bv-a': { bar: { y: 'Integer' } }, re: { bar: { y: 2 } }, to: 'caller' });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('on params — invalid (compile throws)', () => {
  it('no-paren args and body on same line — ambiguous, not allowed', () => {
    // parens required if body follows on the same line
    const source = 'on go :n : Integer reply :n\n';
    expect(() => compile(source)).toThrow();
  });

  it('on go\\n body — CR after name, body immediately (no parens, no blank line)', () => {
    const source = `
      on go
        reply answer: "world" : Text
    `;
    expect(() => compile(source)).toThrow();
  });

  it('open-style param without blank-line terminator before body', () => {
    const source = `
      on go
        :n : Integer
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('// with content does not terminate open-style params', () => {
    // only bare // (empty) counts as a terminator, not // comment text
    const source = `
      on go
        :n : Integer
        // end params
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('-- with content does not terminate open-style params', () => {
    const source = `
      on go
        :n : Integer
        -- end params
        reply :n
    `;
    expect(() => compile(source)).toThrow();
  });

  it('same-line param then open-style continuation on next line', () => {
    // args started on same line → can't continue to next line
    const source = `
      on go :n : Integer
        :m : Integer

        reply :n
    `;
    // :m : Integer is treated as body — no value → compile error
    expect(() => compile(source)).toThrow();
  });
});
