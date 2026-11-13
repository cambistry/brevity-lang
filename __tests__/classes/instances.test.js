import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Each construction of a class is its own actor with its own state. (On rust
// and erlang an ordinary class used to compile to one shared state on its
// parent; see notes/session-2026-10-29-class-instances.md.)
// ═══════════════════════════════════════════════════════════════════════════════

describe('class instances — independent state', () => {
  it('two instances keep their own param values', async () => {
    await expectBehavior(`
      C = (@n Integer) *{ @x = -> 1 }
      @run = { a = C(1); b = C(2); x Integer = a.n(); y Integer = b.n(); return r: x * 10 + y }
    `,
      { input: { id: '1', op: 'run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { r: 12 } }) },
    );
  });

  it('two instances held in constructor-block cells', async () => {
    await expectBehavior(`
      C = (@n Integer) *{ @x = -> 1 }
      c = C(3)
      d = C(4)
      @run = { x Integer = c.n(); y Integer = d.n(); return r: x * 10 + y }
    `,
      { input: { id: '1', op: 'run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { r: 34 } }) },
    );
  });

  it('a list of instances', async () => {
    await expectBehavior(`
      C = (@n Integer) *{ @x = -> 1 }
      @run = { cs List = [C(1), C(2)]; ns List = over(cs) (c) { c.n() }; return r: ns }
    `,
      { input: { id: '1', op: 'run', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { r: [1, 2] } }) },
    );
  });
});
