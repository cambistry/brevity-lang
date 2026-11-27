import { expectBehavior, compileSource } from '../helpers.js';

// A cell holding an actor of a class is a pointer. Its bare name is the actor, and
// `*name` the cell: `*p <- v` repoints it, `p <- v` is the actor's `set`, `p.m()`
// calls the actor, `f(*p)` grants the pointer to a `(q *C)` param, and
// `sub *p, fn` takes each repointing. See notes/actor-pointers-2026-11-27.md.

describe('a pointer — repointed, called, set and granted', () => {
  const script = `
    T = *(x Integer) { @a = () -> x }
    U = T ^ *(x Integer, y Integer) { super(x) }
    S = *(x Integer) {
      v *Integer = x
      set = (n Integer) { v <- n }
      @a = () -> v
    }
    held = *T(1)
    box = *S(2)
    read = (t T) -> t.a()
    @local = { c = *T(4); *c <- U(6, 7); x Integer = c.a(); return x }
    @localSet = { c = *S(4); c <- 9; x Integer = c.a(); return x }
    @state! = { *held <- U(8, 9); x Integer = held.a(); return x }
    @stateSet! = { box <- 11; x Integer = box.a(); return x }
    @inIf! = (n Integer) { c = *S(1); if (n > 0) { c <- 12; *held <- T(13) }; x Integer = c.a(); y Integer = held.a(); return x * 100 + y }
    @pass = { c = *T(3); x Integer = read(c); return x }
    @grant! = { c = *T(3); repoint! = (p *T) { *p <- T(5) }; repoint!(*c); x Integer = c.a(); return x }
  `;

  it('repointing a local takes a subclass instance, and a call reaches it', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'local', from: 'c' } }, { output: { id: '1', ty: ['Integer'], re: [6], to: 'c' } });
  });

  it("a bare write to a local is the actor's set", async () => {
    await expectBehavior(script, { input: { id: '2', op: 'localSet', from: 'c' } }, { output: { id: '2', ty: ['Integer'], re: [9], to: 'c' } });
  });

  it('repointing a state cell', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'state!', from: 'c' } }, { output: { id: '3', ty: ['Integer'], re: [8], to: 'c' } });
  });

  it("a bare write to a state cell is the actor's set", async () => {
    await expectBehavior(script, { input: { id: '4', op: 'stateSet!', from: 'c' } }, { output: { id: '4', ty: ['Integer'], re: [11], to: 'c' } });
  });

  it('a set and a repointing inside an if', async () => {
    await expectBehavior(script, { input: { id: '5', op: [[1], 'inIf!'], from: 'c', ty: [['Integer']] } }, { output: { id: '5', ty: ['Integer'], re: [1213], to: 'c' } });
  });

  it('a bare pointer passed to a param passes the actor', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'pass', from: 'c' } }, { output: { id: '6', ty: ['Integer'], re: [3], to: 'c' } });
  });

  it("a granted pointer is repointed by the callee", async () => {
    await expectBehavior(script, { input: { id: '7', op: 'grant!', from: 'c' } }, { output: { id: '7', ty: ['Integer'], re: [5], to: 'c' } });
  });
});

describe('a pointer — subscribed to', () => {
  const script = `
    C = *{
      @peer *class | null = null
      seen *Integer = 0
      @watch. = { sub *@peer, (p) { seen <- seen + 1 } }
      @seen = () -> seen
    }
    @run = {
      a C = C()
      b C = C()
      a.watch()...
      a.peer <- b
      a.peer <- a
      x Integer = a.seen()
      return x
    }
  `;

  it('a subscription to the cell takes its value, then each repointing', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'run', from: 'c' } }, { output: { id: '1', ty: ['Integer'], re: [3], to: 'c' } });
  });
});

describe('a pointer — what it refuses', () => {
  const classes = `
    T = *(x Integer) { @a = () -> x }
    C = *{
      @peer *class | null = null
      n *Integer = 0
      @g! = { n <- 1 }
      @f = () -> 1
    }
  `;

  it("a bare write sends the actor's set, so a class without one refuses it", () => {
    expect(() => compileSource(`${classes}
      @f = { c = *T(1); c <- T(2); return 1 }
    `)).toThrow("'c' points to a T, which has no 'set': repoint it with '*c <- …'");
  });

  it('a bare write to a name bound to an actor without a set is refused', () => {
    expect(() => compileSource(`${classes}
      @f = { t = T(1); t <- 2; return 1 }
    `)).toThrow("'t' names a T, which has no 'set', so 't <- …' has nothing to send to");
  });

  it('a name bound to an actor is not a cell, so it is not repointed', () => {
    expect(() => compileSource(`${classes}
      @f = { t = T(1); *t <- T(2); return 1 }
    `)).toThrow("'t' names a T, not a cell, so it can't be repointed: '*t <- …' needs 't *T'");
  });

  it('a value cell is written without the star', () => {
    expect(() => compileSource(`${classes}
      @f = { n *Integer = 1; *n <- 2; return n }
    `)).toThrow("'n' holds a value, not an actor, so it's written 'n <- …', not '*n <- …'");
  });

  it('a repointing takes one value', () => {
    expect(() => compileSource(`${classes}
      @f = { c = *T(1); *c <- 1, 2; return 1 }
    `)).toThrow("'*c <- …' repoints a cell, so it takes one value");
  });

  it('a subscription to a pointer names the cell', () => {
    expect(() => compileSource(`${classes}
      D = *{
        @peer *class | null = null
        seen *Integer = 0
        @watch. = { sub @peer, (p) { seen <- 1 } }
      }
    `)).toThrow("'@peer' is the D it points to, and an actor isn't a cell: subscribe to the pointer as 'sub *@peer, …'");
  });

  it('a subscription to a value cell has no star', () => {
    expect(() => compileSource(`${classes}
      D = *{
        @n *Integer = 0
        seen *Integer = 0
        @watch. = { sub *@n, (v) { seen <- 1 } }
      }
    `)).toThrow("'@n' holds a value, not an actor, so it's subscribed to as 'sub @n, …'");
  });

  it('a call through a pointer that may be null is guarded', () => {
    expect(() => compileSource(`${classes}
      D = *{
        @peer *class | null = null
        @go! = { @peer.g!() }
        @g! = { x = 1 }
      }
    `)).toThrow("'@peer' may be null, so a call through it is guarded: 'if (@peer) { … }'");
  });

  it('a guarded call through a pointer that may be null compiles', () => {
    expect(() => compileSource(`${classes}
      @f! = { c *C | null = null; if (c) { c.g!() }; return 1 }
    `)).not.toThrow();
  });
});
