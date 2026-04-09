import { compileSource, createActor, expectBehavior, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Dependency injection — constructor form
//
// A file declares an external dependency in its < ... > header. When the
// declaration includes a constructor signature, the file can construct
// instances of that dependency at top level:
//
//   < "thing.bv": (Thing) <:a Integer> -> { get: () -> (:value Integer) } >
//
//   t = Thing(a: 5)
//
//   @go = { :value Integer = t.get(); -> :value }
//
// Construction emits a `::new` message addressed to the dependency. The
// reply carries the new instance's address in `from`. Subsequent method
// calls on the local handle route to that instance address.
//
// Three declaration shapes are supported:
//
//   (Alias) <ctor> -> { iface }   explicit constructor + service (compile-time check)
//   (Alias) #                     generic constructor (signature deferred to host)
//   Coerced = Alias as <ctor> -> { iface }   coercion of a # dep to a typed ctor
//
// This file replaces the older `constructs` keyword.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 1: explicit constructor form — compile-time ──────────────────────

describe('explicit form — compilation', () => {
  it('single dependency with explicit constructor compiles', () => {
    expect(() => compileSource(`
      <
        "thing.bv": (Thing) <:a Integer> -> {
          get: () -> (:value Integer)
        }
      >

      t = Thing(a: 5)

      @go = { :value Integer = t.get(); -> :value }
    `)).not.toThrow();
  });

  it('empty constructor params <> compiles', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <> -> { ping: () -> . } >

      t = Thing()

      @go = { t.ping() . }
    `)).not.toThrow();
  });

  it('multiple dependencies with constructors compile', () => {
    expect(() => compileSource(`
      <
        "db.bv": (DB) <:host Text> -> { lookup: (:key Text) -> (:value Text) }
        "cache.bv": (Cache) <:size Integer> -> { get: (:key Text) -> (:value Text) }
      >

      db = DB(host: "localhost")
      cache = Cache(size: 100)

      @go
        =
        :key Text
        =
        :value Text = cache.get(:key)
        -> :value
    `)).not.toThrow();
  });
});

// ─── Phase 1: explicit constructor form — runtime ───────────────────────────
//
// Each test asserts construction emissions inline via `createActor`'s
// `expects` block (which runs with cursor at 0, so file-init `::new`
// outbounds are assertable). Subsequent routing assertions use
// `expectActorBehavior` (cursor at posts.length).

describe('explicit form — instance routing', () => {
  const source = `
    < "thing.bv": (Thing) <:a Integer> -> {
        get: () -> (:value Integer)
        ping: () -> .
      }
    >

    t = Thing(a: 5)

    @go = { :value Integer = t.get(); -> :value }
    @notify = { t.ping() . }
  `;

  it('non-silent method call routes to instance address', async () => {
    const actor = await createActor(source, {
      expects: [
        // The actor's construction emission, then the test's reply
        { output: expect.objectContaining({ op: [{ a: 5 }, '::new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Reply to ::new (id '1'), supplying the instance address
      { input: { id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' } },
      // Trigger the user-facing handler
      { input: { id: '99', op: '@go', from: 'caller' } },
      // First post after the cursor: t.get() routed to the instance
      { output: expect.objectContaining({ op: '@get', to: 'Thing/1' }) },
      // Reply to t.get() with the value
      { input: { id: '2', re: { value: 42 } } },
      // Final reply to the original caller
      { output: expect.objectContaining({ id: '99', re: { value: 42 }, to: 'caller' }) },
    );
  });

  it('silent method call routes to instance address', async () => {
    const actor = await createActor(source, {
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '::new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/77' } },
      { input: { id: '2', op: '@notify', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Thing/77' }) },
    );
  });
});

describe('explicit form — multiple instances', () => {
  it('two instances of the same dep route to independent addresses', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) <:tag Text> -> {
          ping: () -> (:ok Text)
        }
      >

      a = Thing(tag: "first")
      b = Thing(tag: "second")

      @ping_a
        =
        :ok Text = a.ping()
        -> :ok
      @ping_b
        =
        :ok Text = b.ping()
        -> :ok
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ tag: 'first' }, '::new'], to: 'Thing' }) },
        { output: expect.objectContaining({ op: [{ tag: 'second' }, '::new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Reply to both ::news in seq order: id '1' = a, id '2' = b
      { input: { id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/A' } },
      { input: { id: '2', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/B' } },
      // Hit a
      { input: { id: '10', op: '@ping_a', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Thing/A' }) },
      { input: { id: '3', re: { ok: 'A' } } },
      { output: expect.objectContaining({ id: '10', re: { ok: 'A' }, to: 'caller' }) },
      // Hit b
      { input: { id: '20', op: '@ping_b', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Thing/B' }) },
      { input: { id: '4', re: { ok: 'B' } } },
      { output: expect.objectContaining({ id: '20', re: { ok: 'B' }, to: 'caller' }) },
    );
  });
});

describe('explicit form — full roundtrip', () => {
  it('construct, call method with arg, mock reply, return to caller', async () => {
    const actor = await createActor(`
      < "math.bv": (Math) <:base Integer> -> {
          double: (:n Integer) -> (:result Integer)
        }
      >

      m = Math(base: 0)

      @compute
        =
        :n Integer
        =
        :result Integer = m.double(:n)
        -> answer: (result + 1) as Integer
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ base: 0 }, '::new'], to: 'Math' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: {}, 'bv-a': 'self<Math>', from: 'Math/1' } },
      { input: { id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }] } },
      { output: expect.objectContaining({ op: [{ n: 5 }, '@double'], to: 'Math/1' }) },
      { input: { id: '2', re: { result: 10 } } },
      { output: expect.objectContaining({ id: '7', re: { answer: 11 }, to: 'tester' }) },
    );
  });
});

describe('explicit form — constructor arg validation', () => {
  it('rejects wrong constructor arg type', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer> -> { ping: () -> . } >

      t = Thing(a: "not-an-int")

      @go = { t.ping() . }
    `)).toThrow(/expected Integer, got Text/);
  });

  it('rejects extra constructor args', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer> -> { ping: () -> . } >

      t = Thing(a: 5, b: 99)

      @go = { t.ping() . }
    `)).toThrow(/don't match|unexpected/i);
  });

  it('rejects missing constructor args', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer, :b Text> -> { ping: () -> . } >

      t = Thing(a: 5)

      @go = { t.ping() . }
    `)).toThrow(/don't match|missing/i);
  });

  it('rejects construction against (Alias) { iface } service-only form', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) { ping: () -> . } >

      t = Thing()

      @go = { t.ping() . }
    `)).toThrow(/no constructor signature/);
  });
});

describe('explicit form — method call validation', () => {
  it('rejects undefined method on inline interface', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer> -> { ping: () -> . } >

      t = Thing(a: 5)

      @go = { t.missing() . }
    `)).toThrow(/has no function 'missing'/);
  });

  it('rejects wrong arg type at method call site', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer> -> { call: (:msg Text) -> . } >

      t = Thing(a: 5)

      @go = { n Integer = 42; t.call(msg: n) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('rejects returning silent method call', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) <:a Integer> -> { fire: () -> . } >

      t = Thing(a: 5)

      @go = -> t.fire()
    `)).toThrow(/silent/);
  });
});

// ─── Phase 2a: # form (generic constructor type) ────────────────────────────

describe('# form — requires manifest', () => {
  it('bare # form throws without options.remotes', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });

  it('# form with construction throws without options.remotes', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      t = Thing(a: 5)

      @go = { t.ping() . }
    `)).toThrow(/requires an interface/);
  });
});

describe('# form — manifest from options.remotes', () => {
  const ctorManifest = '<:a Integer> -> {\n  ping: () -> .\n  get: () -> (:value Integer)\n}';

  it('# form compiles when manifest supplied via options.remotes', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      t = Thing(a: 5)

      @go = { t.ping() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).not.toThrow();
  });

  it('# form validates constructor args against the resolved manifest', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      t = Thing(a: "not-an-int")

      @go = { t.ping() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).toThrow(/expected Integer, got Text/);
  });

  it('# form validates method calls against the resolved interface', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      t = Thing(a: 5)

      @go = { t.missing() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).toThrow(/has no function 'missing'/);
  });

  it('# form: instance method call routes to instance address', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) # >

      t = Thing(a: 5)

      @go
        =
        :value Integer = t.get()
        -> :value
    `, {
      compileOptions: { remotes: [{ path: 'thing.bv', service: ctorManifest }] },
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '::new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/9' } },
      { input: { id: '50', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@get', to: 'Thing/9' }) },
      { input: { id: '2', re: { value: 17 } } },
      { output: expect.objectContaining({ id: '50', re: { value: 17 }, to: 'caller' }) },
    );
  });
});

// ─── Phase 2b: coercion to constructor ──────────────────────────────────────

describe('coercion to constructor — compilation', () => {
  it('coercion of # dep to a typed constructor compiles', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: 5)

      @go = { :value Integer = thing.get(); -> :value }
    `)).not.toThrow();
  });

  it('coercion validates constructor args', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: "not-an-int")

      @go = { thing.get() . }
    `)).toThrow(/expected Integer, got Text/);
  });

  it('coercion validates method calls', () => {
    expect(() => compileSource(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: 5)

      @go = { thing.missing() . }
    `)).toThrow(/has no function 'missing'/);
  });
});

describe('coercion to constructor — runtime', () => {
  it('::new is addressed to underlying dep, methods route to its instance', async () => {
    // ::new must go to 'Thing' (the underlying dep), not 'Coerced'.
    // The instance address from that reply is what subsequent method calls
    // route to.
    const actor = await createActor(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: 5)

      @go
        =
        :value Integer = thing.get()
        -> :value
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '::new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // ::new is addressed to the underlying dep 'Thing', so the reply
      // arrives under id '1' and supplies the instance address.
      { input: { id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/42' } },
      { input: { id: '7', op: '@go', from: 'caller' } },
      // The instance address came from the Thing reply, not 'Coerced/...'
      { output: expect.objectContaining({ op: '@get', to: 'Thing/42' }) },
      { input: { id: '2', re: { value: 99 } } },
      { output: expect.objectContaining({ id: '7', re: { value: 99 }, to: 'caller' }) },
    );
  });
});
