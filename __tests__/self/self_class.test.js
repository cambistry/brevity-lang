import { createActor, expectActorBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Self in value position — class-as-address
//
// `Self` already works in two positions (covered by self.test.js):
//   - Type position:        @peer *Self | null = null
//   - Call/construct:       child = Self(args)
//
// This file covers a third: Self in *bare value* position. Evaluating `Self`
// (no call) yields the class address — the same wire identity #new is sent
// to. Its type is `Class`: a base metatype whose values are class addresses,
// sitting alongside Integer/Text/Boolean/etc. on the bv-a ladder.
//
// A class author opts in to exposing its class via an ordinary public
// handler:
//
//   @class = { Self }
//
// The handler name is conventional, not reserved. The mechanism is
// Self-as-value; @class is just the name we use in these tests because it
// mirrors the design sketch. (No method names are reserved by Brevity for
// this purpose — class reflection is opt-in.)
//
// Wire shape on the @class reply mirrors #new's reply shape inverted:
//   #new       reply: re: "#<C/1>"   bv-a: "#<C>"     (instance addr, class metatype)
//   @class     reply: re: "#<C>"     bv-a: "Class"    (class addr,    Class metatype)
//
// Scope of this ticket: the Self alias as a value and the wire encoding of
// the resulting reply. Class equality, reflection over DI bindings, and any
// caller-side use of `Class` values are out of scope.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Self as value — compilation', () => {
  it('@class = { Self } compiles in a file-as-class body', () => {
    expect(() => compileSource(`
      *
      =
      @class = { Self }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('@class = { Self } compiles in a named class body', () => {
    expect(() => compileSource(`
      C = *() {
        @class = { Self }
      }
      @ping = -> ok: "pong" as Text
    `, { fileName: 'host.bv' })).not.toThrow();
  });

  it('handler name is not reserved — any name returning Self compiles', () => {
    // Confirms the mechanism is Self-as-value, not a privileged @class hook.
    expect(() => compileSource(`
      *
      =
      @kind = { Self }
      @species = { Self }
    `, { fileName: 'c.bv' })).not.toThrow();
  });

  it('Self-as-value without fileName fails to compile', () => {
    // Class address must be provisioned at compile time. Sources that
    // reference Self in value position with no file identity have nowhere
    // for `Self` to resolve to — fail loudly rather than emit a class with
    // an unresolvable address.
    expect(() => compileSource(`
      *
      =
      @class = { Self }
    `)).toThrow();
  });
});

// ─── Runtime: wire shape ─────────────────────────────────────────────────────
//
// `fileName` declares the wire path this source pretends to live at. The
// compiled class is provisioned with that address; `Self` in a handler body
// reads it back out, and the reply serializes `re: "#<c.bv>"` with bv-a
// "Class". In a real (filesystem-rooted) compile the path is supplied by
// the compiler; tests stand in for that source.

describe('Self as value — wire shape', () => {
  it('@class reply carries the class address with bv-a "Class"', async () => {
    const actor = await createActor(`
      *
      =
      @class = { Self }
    `, { fileName: 'c.bv' });
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@class', from: 'caller' } },
      { output: { id: '1', re: '#<c.bv>', 'bv-a': 'Class', to: 'caller' } },
    );
  });
});
