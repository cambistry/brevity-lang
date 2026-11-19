import { createActor, expectActorBehavior, compileSource } from '../helpers.js';

// `class` in value position, in a factory file (a `*` header)
//
// A factory file is built by its host, so its code has a class: `class`, the
// file's own kind. It works in three
// positions:
//   - Type position:        @peer *class | null = null   (self/peer.test.js)
//   - Call/construct:       child = class(args)          (self/self.test.js)
//   - Value position:       covered here
//
// Evaluating `class` (no call) yields the address of what builds the file: the
// file's own, `#<c.bv>`. It's a declared actor, so its tag is `*`, as any actor
// no `new` built is (__tests__/classes/actor_value.test.js,
// notes/actors-not-classes-2026-11-18.md). In an actor a `new` built, `class` is
// that `new`'s actor.
//
// The handler name is conventional, not reserved: `@class = { class }` is an
// ordinary public handler returning a value.
// ═══════════════════════════════════════════════════════════════════════════════

describe('class as a value — compilation', () => {
  it('@class = { class } compiles in a file-as-class body', () => {
    expect(() => compileSource(`
      *
      @class = { class }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('@class = { class } compiles in a named class body', () => {
    expect(() => compileSource(`
      C = () *{
        @class = { class }
      }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'host.bv' })).not.toThrow();
  });

  it('handler name is not reserved — any name returning class compiles', () => {
    // Confirms the mechanism is class-as-value, not a privileged @class hook.
    expect(() => compileSource(`
      *
      @kind = { class }
      @species = { class }
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('class as a value without fileName fails to compile', () => {
    // The address is provisioned at compile time. With no file identity
    // there's nowhere for `class` to resolve to — fail loudly rather than
    // emit an unresolvable address.
    expect(() => compileSource(`
      *
      @class = { class }
    `)).toThrow();
  });
});

// ─── Runtime: wire shape ─────────────────────────────────────────────────────
//
// `fileName` declares the wire path this source pretends to live at. `class` in a
// handler body is that address, `#<c.bv>`, tagged `*` when it's returned. In a real
// (filesystem-rooted) compile the path is supplied by the compiler; tests stand
// in for that source.

describe('class as a value — wire shape', () => {
  it('@class reply carries the file\'s address, tagged `*`', async () => {
    const actor = await createActor(`
      *
      @class = { return class }
    `, { fileName: 'c.bv' });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'class', from: 'caller' } },
      { output: { id: '1', re: ['#<c.bv>'], 'ty': ['*'], to: 'caller' } },
    );
  });
});

describe('`Self` is an ordinary name', () => {
  it('a function named `Self` in a factory file is that function, not `class`', async () => {
    const actor = await createActor(`
      *
      Self = (n Integer) -> n * 2
      @a = { return Self(3) }
    `, { fileName: 'c.bv' });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'a', from: 'caller' } },
      { output: { id: '1', re: [6], to: 'caller' } },
    );
  });
});
