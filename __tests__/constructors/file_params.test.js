import { compileSource, createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File-level scalar params
//
// Every Brevity file is by default a constructor. In addition to service (*)
// and constructor (#) injections, a file can declare plain scalar params
// in its top-level < ... > header. These are parameters the parent actor
// supplies at construction time (not DI in the service/ctor sense).
//
// Forms:
//   <:name Type>                named scalar
//   < Type >                    positional scalar
//   < Type, :opts List >        mixed with other entries in declaration order
//
// Inside the file, params bind to the names declared in the header
// (same as inline constructor params). Positional params must be written
// with a binding — `< t Text >`, not `< Text >` — and the binding name
// is dropped in the `params` manifest output. Positional entries must
// appear before any named entries in the header.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Compilation ─────────────────────────────────────────────────────────────

describe('file scalar params — compilation', () => {
  it('single named scalar param compiles', () => {
    expect(() => compileSource(`
      < :value Integer >
      =

      @get = -> value
    `)).not.toThrow();
  });

  it('multiple named scalar params compile', () => {
    expect(() => compileSource(`
      <
        :name Text
        :count Integer
      >
      =

      @label = -> line: name
    `)).not.toThrow();
  });

  it('single positional scalar param compiles', () => {
    expect(() => compileSource(`
      < t Text >
      =

      @echo = -> t
    `)).not.toThrow();
  });

  it('mixed positional and named scalar params compile', () => {
    expect(() => compileSource(`
      <
        t Text
        :limit Integer
      >
      =

      @first = -> t
    `)).not.toThrow();
  });

  it('scalar params mixed with service DI in same header compile', () => {
    expect(() => compileSource(`
      <
        "/db": (DB) { lookup: (key: Text) -> (value: Text) }
        :prefix Text
      >
      =

      @get = (:key Text) {
        :value Text = DB.lookup(:key)
        -> line: prefix + value
      }
    `)).not.toThrow();
  });

  it('scalar params mixed with constructor DI in same header compile', () => {
    expect(() => compileSource(`
      <
        "thing.bv": (Thing) <:a Integer> -> { get: () -> (value: Integer) }
        :base Integer
      >
      =

      t = Thing(a: base)

      @go = { :value Integer = t.get(); -> :value }
    `)).not.toThrow();
  });
});

// ─── Runtime ─────────────────────────────────────────────────────────────────
//
// Construction note: the test helper `createActor` currently spawns the
// actor with no explicit caller-supplied constructor args. For file-level
// scalar params, the parent actor would send a `new` message carrying the
// args. The exact wire shape for delivering scalar args at construction is
// part of this phase to decide — these tests assume `createActor` grows a
// `constructorArgs` option (or similar) for providing them. Rename/rework
// this option freely if the shape lands differently.

describe('file scalar params — runtime (named)', () => {
  it('named scalar param is visible as a local binding in handlers', async () => {
    const actor = await createActor(`
      < :value Integer >
      =

      @get = -> :value
    `, {
      constructorArgs: { value: 42 },
    });

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@get', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { value: 42 }, to: 'caller' }) },
    );
  });

  it('multiple named scalar params bind independently', async () => {
    const actor = await createActor(`
      <
        :name Text
        :count Integer
      >
      =

      @get_name = -> label: name
      @get_count = -> n: count
    `, {
      constructorArgs: { name: 'widget', count: 3 },
    });

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@get_name', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { label: 'widget' }, to: 'caller' }) },
      { input: { id: '2', op: '@get_count', from: 'caller' } },
      { output: expect.objectContaining({ id: '2', re: { n: 3 }, to: 'caller' }) },
    );
  });
});

describe('file scalar params — runtime (positional)', () => {
  it('positional scalar param binds to its declared name', async () => {
    const actor = await createActor(`
      < t Text >
      =

      @echo = -> got: t
    `, {
      constructorArgs: ['hello'],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@echo', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { got: 'hello' }, to: 'caller' }) },
    );
  });

  it('multiple positional scalars bind to declared names', async () => {
    const actor = await createActor(`
      <
        t Text
        n Integer
      >
      =

      @first = -> got: t
      @second = -> num: n
    `, {
      constructorArgs: ['a', 7],
    });

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@first', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { got: 'a' }, to: 'caller' }) },
      { input: { id: '2', op: '@second', from: 'caller' } },
      { output: expect.objectContaining({ id: '2', re: { num: 7 }, to: 'caller' }) },
    );
  });
});
