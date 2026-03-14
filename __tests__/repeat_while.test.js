import compile from '../index.js';
import { expectReply, runActor } from './helpers.js';

// ── basic ────────────────────────────────────────────────────────────────────

describe('repeat while — state mutation loop', () => {
  it('drains $x to 0 and accumulates $y to 10', async () => {
    const posts = await runActor({
      source: `
        actor Drainer

        init
        $x : Integer = 10
        $y : Integer = 0

        on drain()

        repeat while $x > 0 {
          $x = $x - 1
          $y = $y + 1
        }
        reply $x, $y : Integer

        end
      `, exportName: 'Drainer',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'drain', from: 'caller' },
      ],
    });
    expect(posts[0]).toEqual({ id: 'init-0', re: 'init', to: 'system' });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0, 10], to: 'caller' }));
  });
});

// ── condition forms ──────────────────────────────────────────────────────────

describe('repeat while — parenthesized condition', () => {
  it('parens around condition with block body', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 3

        on test()

        repeat while ($x > 0) {
          $x = $x - 1
        }
        reply $x : Integer

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'caller' }));
  });

  it('parens around condition with single-line body', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 3

        on test()

        repeat while ($x > 0) $x = $x - 1
        reply $x : Integer

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'caller' }));
  });
});

// ── single-line body ─────────────────────────────────────────────────────────

describe('repeat while — single-line body', () => {
  it('bare condition with single-line state assign', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 5

        on test()

        repeat while $x > 0 $x = $x - 1
        reply $x : Integer

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0], to: 'caller' }));
  });

  it('single-line put form', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 3
          repeat while x > 0 x <- x - 1
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });
});

// ── ref + put ────────────────────────────────────────────────────────────────

describe('repeat while — ref + put counter loop', () => {
  it('counts down with ref and put', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 5
          repeat while x > 0 {
            x <- x - 1
          }
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });

  it('parens around condition with block body', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 4
          repeat while (x > 0) {
            x <- x - 1
          }
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });
});

// ── lexical scope ────────────────────────────────────────────────────────────

describe('repeat while — lexical scope', () => {
  it('reads and writes actor state inside block body', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 0

        on test(step : Integer)

        repeat while $x < 9 {
          $x = $x + step
        }
        reply $x : Integer

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: [[3], 'test'], 'bv-a': [['Integer']], from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [9], to: 'caller' }));
  });

  it('reads and writes actor state inside single-line body', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 0

        on test(limit : Integer)

        repeat while $x < limit $x = $x + 1
        reply $x : Integer

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: [[5], 'test'], 'bv-a': [['Integer']], from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [5], to: 'caller' }));
  });

  it('plain assignment to outer-scope variable inside block body → compile error', () => {
    expect(() => compile(`
      on test()
        x : Integer = 0 : Integer
        repeat while true {
          x = 1
        }
        reply :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('plain assignment to outer-scope variable in single-line body → compile error', () => {
    expect(() => compile(`
      on test()
        x : Integer = 0 : Integer
        repeat while true x = 1
        reply :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });
});

// ── evaluates to null ────────────────────────────────────────────────────────

describe('repeat while — evaluates to null', () => {
  it('at end of function returns null (block never runs)', async () => {
    const source = `
      on test()
        fn = {
          repeat while false { }
        } : Integer | null
        result : Integer | null = fn()
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'caller' },
    });
  });

  it('at end of function returns null (block runs)', async () => {
    const posts = await runActor({
      source: `
        actor T

        init
        $x : Integer = 3

        on test()

        fn = {
          repeat while $x > 0 {
            $x = $x - 1
          }
        } : Integer | null
        result : Integer | null = fn()
        reply $x, :result

        end
      `, exportName: 'T',
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts[1]).toEqual(expect.objectContaining({ id: '1', re: [0, { result: null }], to: 'caller' }));
  });

  it('at end of function with non-nullable return type → compile error', () => {
    expect(() => compile(`
      on test()
        fn = {
          repeat while false { }
        } : Integer
        result : Integer = fn()
        reply :result
    `)).toThrow(/while always evaluates to null/i);
  });
});
