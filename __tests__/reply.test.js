import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('reply — same-line no-paren explicit', () => {
  it('reply a : Integer — typed positional', async () => {
    const source = `
      @go
        =
        :n : Integer
        =
        -> n : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ n: 7 }, 'go'], 'bv-a': [{ n: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer'], re: [7], to: 'caller' },
    });
  });

  it('reply a, b — two bare positionals', async () => {
    const source = `
      @go
        =
        :x : Integer
        :y : Integer
        =
        -> x, y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 3, y: 4 }, 'go'], 'bv-a': [{ x: 'Integer', y: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'caller' },
    });
  });

  it('reply :a, :b — sigil no-paren', async () => {
    const source = `
      @go
        =
        :a : Integer
        :b : Integer
        =
        -> :a, :b
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 10, b: 20 }, 'go'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 10, b: 20 }, to: 'caller' },
    });
  });

  it('reply result: a + b — key-value no-paren', async () => {
    const source = `
      @go
        =
        :a : Integer
        :b : Integer
        =
        -> result: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 5, b: 6 }, 'go'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'caller' },
    });
  });
});

describe('reply', () => {
  it('computed -> field — ->(c: a + b : Integer)', async () => {
    const source = '@add = |:a : Integer, :b : Integer|\n  ->(c: a + b : Integer)\n';
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });
});

// ─── open style ──────────────────────────────────────────────────────────────

describe('reply — open style', () => {
  it('reply\\n :a — single named field @next line', async () => {
    const source = `
      @go
        =
        :a : Integer
        =
        ->
        :a

    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 7 }, 'go'], 'bv-a': [{ a: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer' }, re: { a: 7 }, to: 'caller' },
    });
  });

  it('reply\\n :a\\n :b — two named fields, blank-line terminated', async () => {
    const source = `
      @go
        =
        :a : Integer
        :b : Integer
        =
        ->
        :a
        :b

    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'go'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 3, b: 4 }, to: 'caller' },
    });
  });

  it('reply open style with typed positional and key-value fields', async () => {
    // already tested via proc.test.js (proc sub open-style reply)
    const source = `
      @go
        =
        result: x = sub()
        -> :x

      sub
        =
        ->
          result: 99 : Integer

    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { x: 99 }, to: 'caller' },
    });
  });

  it('reply open style terminated by -- comment', async () => {
    const source = `
      @go
        =
        :a : Integer
        =
        ->
        :a
        --
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 21 }, 'go'], 'bv-a': [{ a: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer' }, re: { a: 21 }, to: 'caller' },
    });
  });

  it('reply() explicit empty parens — next handler follows immediately', async () => {
    // ->() is explicit style (parens), so no open-style reading; next decl can follow
    const source = `
      @ping
        =
        ->()
      @pong
        =
        -> answer: "pong" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'pong', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'pong' }, to: 'caller' },
    });
  });

  it('reply open style terminated by -- allows next proc to follow', async () => {
    const source = `
      @go
        =
        result: x = val()
        ->
        :x
        --
      val
        =
        -> result: 5 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: { id: '1', re: { x: 5 }, to: 'caller' },
    });
  });
});

// ─── invalid ─────────────────────────────────────────────────────────────────

describe('reply — invalid (compile throws)', () => {
  it('reply :a\\n :b — same-line field then continuation on next line', () => {
    const source = `
      @go
        =
        :a : Integer
        :b : Integer
        =
        -> :a
        :b
    `;
    expect(() => compile(source)).toThrow();
  });

  it('reply open style not terminated before next proc', () => {
    // open-style -> must be terminated by blank line or -- before next declaration
    const source = `
      @go
        =
        result: x = val()
        ->
        :x
      val
        =
        -> result: 5 : Integer
    `;
    expect(() => compile(source)).toThrow();
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('reply — open-form -> terminated by whitespace-only blank line', () => {
  it('whitespace-only blank line terminates open-form reply; next handler parses correctly', async () => {
    const source = `
      @greet
        =
        ->
        msg: "hello" : Text
      ${'  '}
      @ping
        =
        -> status: "ok" : Text
    `;
    await expectReply({
      source,
      receive: [
        { id: '1', op: 'greet', from: 'caller' },
        { id: '2', op: 'ping', from: 'caller' },
      ],
      reply: [
        { id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'caller' },
        { id: '2', 'bv-a': { status: 'Text' }, re: { status: 'ok' }, to: 'caller' },
      ],
    });
  });
});
