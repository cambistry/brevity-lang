import { expectBehavior, compileSource, compileActor } from '../helpers.js';

// Read-only ref parameters — `&Type` declares a parameter that the callee
// can read (and subscribe to, in a live-cell sense) but cannot mutate. The
// caller passes the value bare; no grant marker is needed at the call site
// because the callee is requesting strictly less than full capability.
//
// Restrictions enforced inside the callee body:
//   - `<-` against the parameter is a compile error
//   - calling any `.X!` (bang) method on the parameter is a compile error
//
// Read access (.size, .first, .contains, .subscribe, plain field reads on
// types) remains allowed.
//
// Per notes/capability-sigils-2026-05-06.md.

// ── Reads succeed ────────────────────────────────────────────────────────────

describe('readonly param — &Type permits reads', () => {
  it('&List of Integers — value flows through readonly param', async () => {
    await expectBehavior(`
      @run
        =
        ns *List of Integers = [10, 20, 30]
        echo = (xs &List of Integers) { xs }
        result List of Integers = echo(ns)
        return :result
    `,
      { input: { id: '1', op: 'run', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'List of Integers' }, re: { result: [10, 20, 30] }, to: 'c' } },
    );
  });
});

// ── A read-only param is live ────────────────────────────────────────────────
// What `&Type` gives over a bare `Type` (a snapshot): the callee holds the
// caller's cell and sees its later writes. The caller passes the cell bare.
// A note and its handler's reply can come in either order, so notes are
// picked out of the posts.
describe('readonly param — &Type is live', () => {
  const script = `
    *
      "svc.bv": Svc {
        note. (Integer) => .
      }
    *
    @n *Integer = 0

    Watcher = (n &Integer) *{
      n.subscribe (v Integer) { Svc.note(v)... }
    }
    NamedWatcher = (n: &Integer) *{
      n.subscribe (v Integer) { Svc.note(v)... }
    }
    Reader = (n &Integer) *{
      @get = {
        r Integer = n
        return r
      }
    }

    @watch = {
      w = Watcher(@n)
      return 1
    }
    @watchNamed = {
      w = NamedWatcher(n: @n)
      return 1
    }
    @read = {
      r = Reader(@n)
      v Integer = r.get()
      return v
    }

    @bump! = { @n <- @n + 1 }
  `;
  const notes = (actor) => actor.posts.filter(p => Array.isArray(p.op) && p.op[1] === 'note.');

  it('a subscriber sees the cell now and after each write', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: 'watch', from: 'c' });
    await actor.sendAsync({ id: '2', op: 'bump!', from: 'c' });
    await actor.sendAsync({ id: '3', op: 'bump!', from: 'c' });
    expect(notes(actor)).toEqual([
      expect.objectContaining({ op: [[0], 'note.'], to: 'Svc' }),
      expect.objectContaining({ op: [[1], 'note.'], to: 'Svc' }),
      expect.objectContaining({ op: [[2], 'note.'], to: 'Svc' }),
    ]);
  });

  it('a named one is live too', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: 'watchNamed', from: 'c' });
    await actor.sendAsync({ id: '2', op: 'bump!', from: 'c' });
    expect(notes(actor)).toEqual([
      expect.objectContaining({ op: [[0], 'note.'], to: 'Svc' }),
      expect.objectContaining({ op: [[1], 'note.'], to: 'Svc' }),
    ]);
  });

  it('a class that only reads it gets the cell\'s value', () => expectBehavior(script,
    { input: { id: '1', op: 'bump!', from: 'c' } },
    { output: expect.objectContaining({ id: '1', re: '#<.>', to: 'c' }) },
    { input: { id: '2', op: 'read', from: 'c' } },
    { output: { id: '2', re: [1], 'ty': ['Integer'], to: 'c' } },
  ));
});

// Only a class subscribes to its param: it lives on after it's made, so the
// subscription has an owner. A function's call ends, so it's refused.
describe('readonly param — a function can\'t subscribe to its param', () => {
  it('a private function', () => {
    expect(() => compileSource(`
      @n *Integer = 0
      watch = (n &Integer) {
        n.subscribe (v Integer) { v }
        return 1
      }
      @go = {
        k Integer = watch(@n)
        return k
      }
    `)).toThrow(/'n' is a param of 'watch', and a function can't subscribe to its param — take it as a class param and subscribe in the class/);
  });

  it('a public function', () => {
    expect(() => compileSource(`
      @n *Integer = 0
      @watch = (n &Integer) {
        n.subscribe (v Integer) { v }
        return 1
      }
    `)).toThrow(/'n' is a param of '@watch', and a function can't subscribe to its param/);
  });

  it('a lambda', () => {
    expect(() => compileSource(`
      @n *Integer = 0
      @go = {
        watch = (n &Integer) {
          n.subscribe (v Integer) { v }
          return 1
        }
        k Integer = watch(@n)
        return k
      }
    `)).toThrow(/'n' is a param of 'watch', and a function can't subscribe to its param/);
  });
});

// ── Writes are rejected ──────────────────────────────────────────────────────

describe('readonly param — &Type rejects mutation', () => {
  it('`<-` against an &Integer param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        n *Integer = 0
        bump = (x &Integer) { x <- x + 1 }
        bump(n)
        return result: n
    `)).toThrow(/read-only/);
  });

  it('`<-` against an &Point param → compile error', () => {
    expect(() => compileSource(`
      type Point (x Integer, y Integer)
      @run
        =
        coords *Point = Point(0, 0)
        replace = (p &Point) { p <- Point(7, 8) }
        replace(coords)
        return :coords
    `)).toThrow(/read-only/);
  });

  it('.append! on an &List param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        ns *List of Integers = [1, 2]
        addOne = (xs &List of Integers) { xs.append!(99) }
        addOne(ns)
        return :ns
    `)).toThrow(/read-only parameter/);
  });

  it('.reverse! on an &List param → compile error', () => {
    expect(() => compileSource(`
      @run
        =
        ns *List of Integers = [1, 2, 3]
        rev = (xs &List of Integers) { xs.reverse! }
        rev(ns)
        return :ns
    `)).toThrow(/read-only parameter/);
  });
});
