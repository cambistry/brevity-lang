import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate, expectReply } from './helpers.js';

async function initThenReceive(source, exportName, messages) {
  const { output } = compile(source);
  const Actor = await evaluate(output, exportName);
  const binding = { post: jest.fn() };
  const actor = new Actor(binding);
  actor.receive({ id: 'init-0', cam: 'init', from: 'system' });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const msg of messages) {
    actor.receive(msg);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  return binding;
}

const DRAINER = `
  actor Drainer

  init
  $x : Integer = 10
  $y : Integer = 0

  on drain()

  while $x > 0 {
    $x = $x - 1
    $y = $y + 1
  }
  reply $x, $y : Integer

  end
`;

// ── basic ────────────────────────────────────────────────────────────────────

describe('while — state mutation loop', () => {
  it('drains $x to 0 and accumulates $y to 10', async () => {
    const binding = await initThenReceive(DRAINER, 'Drainer', [
      { id: '1', op: 'drain', from: 'caller' },
    ]);
    expect(binding.post).toHaveBeenNthCalledWith(1, { id: 'init-0', re: 'init', to: 'system' });
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0, 10], to: 'caller' })
    );
  });
});

// ── condition forms ──────────────────────────────────────────────────────────

describe('while — parenthesized condition', () => {
  it('parens around condition with block body', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 3

      on test()

      while ($x > 0) {
        $x = $x - 1
      }
      reply $x : Integer

      end
    `, 'T', [{ id: '1', op: 'test', from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0], to: 'caller' })
    );
  });

  it('parens around condition with single-line body', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 3

      on test()

      while ($x > 0) $x = $x - 1
      reply $x : Integer

      end
    `, 'T', [{ id: '1', op: 'test', from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0], to: 'caller' })
    );
  });
});

// ── single-line body ─────────────────────────────────────────────────────────

describe('while — single-line body', () => {
  it('bare condition with single-line body', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 5

      on test()

      while $x > 0 $x = $x - 1
      reply $x : Integer

      end
    `, 'T', [{ id: '1', op: 'test', from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0], to: 'caller' })
    );
  });
});

// ── lexical scope ────────────────────────────────────────────────────────────

describe('while — lexical scope', () => {
  it('reads and writes actor state inside block body', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 0

      on test(step : Integer)

      while $x < 9 {
        $x = $x + step
      }
      reply $x : Integer

      end
    `, 'T', [{ id: '1', op: [[3], 'test'], 'bv-a': [['Integer']], from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [9], to: 'caller' })
    );
  });

  it('reads and writes actor state inside single-line body', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 0

      on test(limit : Integer)

      while $x < limit $x = $x + 1
      reply $x : Integer

      end
    `, 'T', [{ id: '1', op: [[5], 'test'], 'bv-a': [['Integer']], from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [5], to: 'caller' })
    );
  });

  it('plain assignment to outer-scope variable inside block body → compile error', () => {
    expect(() => compile(`
      on test()
        x : Integer = 0 : Integer
        while true {
          x = 1
        }
        reply :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('plain assignment to outer-scope variable in single-line body → compile error', () => {
    expect(() => compile(`
      on test()
        x : Integer = 0 : Integer
        while true x = 1
        reply :x
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });
});

// ── evaluates to null ────────────────────────────────────────────────────────

describe('while — evaluates to null', () => {
  it('while at end of function returns null (block never runs)', async () => {
    const source = `
      on test()
        fn = () {
          while false { }
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

  it('while at end of function returns null (block runs)', async () => {
    const binding = await initThenReceive(`
      actor T

      init
      $x : Integer = 3

      on test()

      fn = () {
        while $x > 0 {
          $x = $x - 1
        }
      } : Integer | null
      result : Integer | null = fn()
      reply $x, :result

      end
    `, 'T', [{ id: '1', op: 'test', from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0, { result: null }], to: 'caller' })
    );
  });

  it('while at end of function with non-nullable return type → compile error', () => {
    expect(() => compile(`
      on test()
        fn = () {
          while false { }
        } : Integer
        result : Integer = fn()
        reply :result
    `)).toThrow(/while always evaluates to null/i);
  });
});
