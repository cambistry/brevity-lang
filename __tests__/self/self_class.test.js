import { createActor, expectActorBehavior, compileSource } from '../helpers.js';

// `Self` in value position
//
// `Self` already works in two positions (covered by self.test.js):
//   - Type position:        @peer *Self | null = null
//   - Call/construct:       child = Self(args)
//
// This file covers a third: Self in *bare value* position. Evaluating `Self`
// (no call) yields an actor's address: the file's, or in an actor a `new`
// built, the actor whose `new` that is (the one `Self(args)` asks). It's a
// declared actor, so its tag is `*`, as any actor no `new` built is
// (__tests__/classes/actor_value.test.js, notes/actors-not-classes-2026-11-18.md).
//
// The handler name is conventional, not reserved: `@class = { Self }` is an
// ordinary public handler returning a value.
//
//   #new   reply: re: "#<C:1>"     ty: ":C"   (built, tagged with its maker)
//   @class reply: re: ["#<c.bv>"]  ty: ["*"]  (declared, tagged `*`)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Self as value — compilation', () => {
  it('@class = { Self } compiles in a file-as-class body', () => {
    expect(() => compileSource(`
      *
      @class = { Self }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('@class = { Self } compiles in a named class body', () => {
    expect(() => compileSource(`
      C = () *{
        @class = { Self }
      }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'host.bv' })).not.toThrow();
  });

  it('handler name is not reserved — any name returning Self compiles', () => {
    // Confirms the mechanism is Self-as-value, not a privileged @class hook.
    expect(() => compileSource(`
      *
      @kind = { Self }
      @species = { Self }
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('Self-as-value without fileName fails to compile', () => {
    // The address is provisioned at compile time. With no file identity
    // there's nowhere for `Self` to resolve to — fail loudly rather than
    // emit an unresolvable address.
    expect(() => compileSource(`
      *
      @class = { Self }
    `)).toThrow();
  });
});

// ─── Runtime: wire shape ─────────────────────────────────────────────────────
//
// `fileName` declares the wire path this source pretends to live at. `Self` in a
// handler body is that address, `#<c.bv>`, tagged `*` when it's returned. In a real
// (filesystem-rooted) compile the path is supplied by the compiler; tests stand
// in for that source.

describe('Self as value — wire shape', () => {
  it('@class reply carries the file\'s address, tagged `*`', async () => {
    const actor = await createActor(`
      *
      @class = { return Self }
    `, { fileName: 'c.bv' });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'class', from: 'caller' } },
      { output: { id: '1', re: ['#<c.bv>'], 'ty': ['*'], to: 'caller' } },
    );
  });
});
