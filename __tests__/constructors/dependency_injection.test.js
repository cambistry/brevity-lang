import { compileSource, createActor, expectActorBehavior, compileActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Dependency injection — class form
//
// A file declares an external dependency in its *( ... ) header. When the
// declaration includes a class header, the file can construct actors of
// that dependency at top level:
//
//   *( "thing.bv": (Thing) *(a: Integer) -> { get: () -> (value: Integer) } )
//
//   t = Thing(a: 5)
//
//   @go = { :value Integer = t.get(); -> :value }
//
// Construction emits a ``new`` message addressed to the dependency. The
// reply carries the new actor's address in angle-delimited `re`.
// Subsequent method calls on the local handle route to that actor address.
//
// Three declaration shapes are supported:
//
//   (Alias) *(ctor) -> { iface }   explicit class header + service (compile-time check)
//   (Alias) #                     generic dep (signature deferred to host)
//   Coerced = Alias as *(ctor) -> { iface }   coercion of a # dep to a typed class
//
// This file replaces the older `constructs` keyword.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 1: explicit class form — compile-time ────────────────────────────

describe('explicit form — compilation', () => {
  it('single dependency with explicit class header compiles', () => {
    expect(() => compileSource(`
      *(
        "thing.bv": (Thing) *(a: Integer) -> {
          get: () -> (value: Integer)
        }
      )
      =

      t = Thing(a: 5)

      @go = { :value Integer = t.get(); -> :value }
    `)).not.toThrow();
  });

  it('empty class params *() compiles', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *() -> { ping: () -> . } )
      =

      t = Thing()

      @go = { t.ping() . }
    `)).not.toThrow();
  });

  it('multiple dependencies with class headers compile', () => {
    expect(() => compileSource(`
      *(
        "db.bv": (DB) *(host: Text) -> { lookup: (key: Text) -> (value: Text) }
        "cache.bv": (Cache) *(size: Integer) -> { get: (key: Text) -> (value: Text) }
      )
      =

      db = DB(host: "localhost")
      cache = Cache(size: 100)

      @go
        =
        key: Text
        =
        :value Text = cache.get(:key)
        -> :value
    `)).not.toThrow();
  });
});

// ─── Phase 1: explicit class form — runtime ─────────────────────────────────
//
// Each test asserts construction emissions inline via `createActor`'s
// `expects` block (which runs with cursor at 0, so file-init ``new``
// outbounds are assertable). Subsequent routing assertions use
// `expectActorBehavior` (cursor at posts.length).

describe('explicit form — actor routing', () => {
  const source = `
    *( "thing.bv": (Thing) *(a: Integer) -> {
        get: () -> (value: Integer)
        ping: () -> .
      }
    )
    =

    t = Thing(a: 5)

    @go = { :value Integer = t.get(); -> :value }
    @notify = { t.ping() . }
  `;

  it('non-silent method call routes to actor address', async () => {
    const actor = await createActor(source, {
      expects: [
        // The actor's construction emission, then the test's reply
        { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Reply to `new` (id '1'), supplying the actor address
      { input: { id: '1', re: '#<Thing/1>', 'bv-a': '#<Thing>', from: 'Thing' } },
      // Trigger the user-facing handler
      { input: { id: '99', op: '@go', from: 'caller' } },
      // First post after the cursor: t.get() routed to the actor
      { output: expect.objectContaining({ op: '@get', to: 'Thing/1' }) },
      // Reply to t.get() with the value
      { input: { id: '2', re: { value: 42 } } },
      // Final reply to the original caller
      { output: expect.objectContaining({ id: '99', re: { value: 42 }, to: 'caller' }) },
    );
  });

  it('silent method call routes to actor address', async () => {
    const actor = await createActor(source, {
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/77>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '2', op: '@notify', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Thing/77' }) },
    );
  });
});

describe('explicit form — multiple actors', () => {
  it('two actors of the same dep route to independent addresses', async () => {
    const actor = await createActor(`
      *( "thing.bv": (Thing) *(tag: Text) -> {
          ping: () -> (ok: Text)
        }
      )
      =

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
        { output: expect.objectContaining({ op: [{ tag: 'first' }, '#new'], to: 'Thing' }) },
        { output: expect.objectContaining({ op: [{ tag: 'second' }, '#new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Reply to both `new`s in seq order: id '1' = a, id '2' = b
      { input: { id: '1', re: '#<Thing/A>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '2', re: '#<Thing/B>', 'bv-a': '#<Thing>', from: 'Thing' } },
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
      *( "math.bv": (Math) *(base: Integer) -> {
          double: (n: Integer) -> (result: Integer)
        }
      )
      =

      m = Math(base: 0)

      @compute
        =
        n: Integer
        =
        :result Integer = m.double(:n)
        -> answer: result + 1
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ base: 0 }, '#new'], to: 'Math' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Math/1>', 'bv-a': '#<Math>', from: 'Math' } },
      { input: { id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }] } },
      { output: expect.objectContaining({ op: [{ n: 5 }, '@double'], to: 'Math/1' }) },
      { input: { id: '2', re: { result: 10 } } },
      { output: expect.objectContaining({ id: '7', re: { answer: 11 }, to: 'tester' }) },
    );
  });
});

describe('explicit form — deferred (function-body) construction', () => {
  it('construction inside a handler emits `new` lazily', async () => {
    const actor = await createActor(`
      *( "thing.bv": (Thing) *(a: Integer) -> { ping: () -> . } )
      =

      @spawn = {
        t = Thing(a: 5)
        .
      }
    `);
    await expectActorBehavior(actor,
      { input: { id: '99', op: '@spawn', from: 'caller' } },
      { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      { input: { id: '1', re: '#<Thing/1>', 'bv-a': '#<Thing>', from: 'Thing' } },
    );
  });

  it('construction + method call inside one handler', async () => {
    const actor = await createActor(`
      *( "thing.bv": (Thing) *(a: Integer) -> { get: () -> (value: Integer) } )
      =

      @go
        =
        t = Thing(a: 5)
        :value Integer = t.get()
        -> :value
    `);
    await expectActorBehavior(actor,
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      { input: { id: '1', re: '#<Thing/42>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { output: expect.objectContaining({ op: '@get', to: 'Thing/42' }) },
      { input: { id: '2', re: { value: 17 } } },
      { output: expect.objectContaining({ id: '99', re: { value: 17 }, to: 'caller' }) },
    );
  });
});

describe('explicit form — class arg validation', () => {
  it('rejects wrong class arg type', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer) -> { ping: () -> . } )
      =

      t = Thing(a: "not-an-int")

      @go = { t.ping() . }
    `)).toThrow(/expected Integer, got Text/);
  });

  it('rejects extra class args', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer) -> { ping: () -> . } )
      =

      t = Thing(a: 5, b: 99)

      @go = { t.ping() . }
    `)).toThrow(/don't match|unexpected/i);
  });

  it('rejects missing class args', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer, b: Text) -> { ping: () -> . } )
      =

      t = Thing(a: 5)

      @go = { t.ping() . }
    `)).toThrow(/don't match|missing/i);
  });

  it('rejects construction against (Alias) { iface } service-only form', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) { ping: () -> . } )
      =

      t = Thing()

      @go = { t.ping() . }
    `)).toThrow(/no constructor signature/);
    // (error message preserved verbatim from compiler output)
  });
});

describe('explicit form — method call validation', () => {
  it('rejects undefined method on inline interface', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer) -> { ping: () -> . } )
      =

      t = Thing(a: 5)

      @go = { t.missing() . }
    `)).toThrow(/has no function 'missing'/);
  });

  it('rejects wrong arg type at method call site', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer) -> { call: (msg: Text) -> . } )
      =

      t = Thing(a: 5)

      @go = { n Integer = 42; t.call(msg: n) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('rejects returning silent method call', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) *(a: Integer) -> { fire: () -> . } )
      =

      t = Thing(a: 5)

      @go = -> t.fire()
    `)).toThrow(/silent/);
  });
});

// ─── Phase 2a: # form (generic actor class) ─────────────────────────────────

describe('# form — requires manifest', () => {
  it('bare # form throws without options.remotes', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      @go = -> 1
    `)).toThrow(/requires an interface/);
  });

  it('# form with construction throws without options.remotes', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      t = Thing(a: 5)

      @go = { t.ping() . }
    `)).toThrow(/requires an interface/);
  });
});

describe('# form — manifest from options.remotes', () => {
  const ctorManifest = '*(a: Integer) -> {\n  ping: () -> .\n  get: () -> (value: Integer)\n}';

  it('# form compiles when manifest supplied via options.remotes', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      t = Thing(a: 5)

      @go = { t.ping() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).not.toThrow();
  });

  it('# form validates class args against the resolved manifest', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      t = Thing(a: "not-an-int")

      @go = { t.ping() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).toThrow(/expected Integer, got Text/);
  });

  it('# form validates method calls against the resolved interface', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      t = Thing(a: 5)

      @go = { t.missing() . }
    `, { remotes: [{ path: 'thing.bv', service: ctorManifest }] })).toThrow(/has no function 'missing'/);
  });

  it('# form: actor method call routes to actor address', async () => {
    const actor = await createActor(`
      *( "thing.bv": (Thing) # )
      =

      t = Thing(a: 5)

      @go
        =
        :value Integer = t.get()
        -> :value
    `, {
      compileOptions: { remotes: [{ path: 'thing.bv', service: ctorManifest }] },
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/9>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '50', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@get', to: 'Thing/9' }) },
      { input: { id: '2', re: { value: 17 } } },
      { output: expect.objectContaining({ id: '50', re: { value: 17 }, to: 'caller' }) },
    );
  });
});

// ─── Phase 2b: coercion to typed class ──────────────────────────────────────

describe('coercion to typed class — compilation', () => {
  it('coercion of # dep to a typed class compiles', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }

      thing = Coerced(a: 5)

      @go = { :value Integer = thing.get(); -> :value }
    `)).not.toThrow();
  });

  it('coercion validates class args', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }

      thing = Coerced(a: "not-an-int")

      @go = { thing.get() . }
    `)).toThrow(/expected Integer, got Text/);
  });

  it('coercion validates method calls', () => {
    expect(() => compileSource(`
      *( "thing.bv": (Thing) # )
      =

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }

      thing = Coerced(a: 5)

      @go = { thing.missing() . }
    `)).toThrow(/has no function 'missing'/);
  });
});

describe('coercion to typed class — runtime', () => {
  it('`new` is addressed to underlying dep, methods route to its actor', async () => {
    // `new` must go to 'Thing' (the underlying dep), not 'Coerced'.
    // The actor address from that reply is what subsequent method calls
    // route to.
    const actor = await createActor(`
      *( "thing.bv": (Thing) # )
      =

      Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }

      thing = Coerced(a: 5)

      @go
        =
        :value Integer = thing.get()
        -> :value
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) },
      ],
    });
    await expectActorBehavior(actor,
      // `new` is addressed to the underlying dep 'Thing', so the reply
      // arrives under id '1' and supplies the actor address.
      { input: { id: '1', re: '#<Thing/42>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '7', op: '@go', from: 'caller' } },
      // The actor address came from the Thing reply, not 'Coerced/...'
      { output: expect.objectContaining({ op: '@get', to: 'Thing/42' }) },
      { input: { id: '2', re: { value: 99 } } },
      { output: expect.objectContaining({ id: '7', re: { value: 99 }, to: 'caller' }) },
    );
  });
});

// ─── DI spread operator — `(...)` flattens interface into local scope ───────
//
// `<Name: (...)>` expands at validate time into a destructure entry per op
// in Name's remote manifest, letting the body call each op bare (no
// `Name.op(...)` prefix). Explicit entries before `...` alias or discard
// specific names; `...` supplies "everything else." The spread variant
// consumes the module binding — `Name` is no longer in scope.
//
// Spread semantics are target-agnostic (everything runs through the shared
// validator and codegen's destructured-member routing), so these tests are
// target-agnostic too.

describe('spread `(...)` — compilation', () => {
  const MATH_MANIFEST = `{
    double: (n: Integer) -> (result: Integer)
    inc: (n: Integer) -> (result: Integer)
    dec: (n: Integer) -> (result: Integer)
  }`;

  it('`(...)` flattens all manifest ops into scope', () => {
    expect(() => compileSource(`
      *(Math: (...))
      =
      @go = {
        :result Integer = double(n: 5)
        -> :result
      }
    `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
  });

  it('every spread-injected name is callable as a bare function', () => {
    expect(() => compileSource(`
      *(Math: (...))
      =
      @triple = {
        :result Integer = double(n: 5)
        :result Integer = inc(n: result)
        :result Integer = dec(n: result)
        -> :result
      }
    `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
  });

  it('alias before `...` binds a new local that routes to the remote op', () => {
    // Observable semantic: `D(...)` compiles (D is the local for remote `double`)
    // and `...` still supplies inc and dec. Runtime wiring verified in the
    // routing test below.
    expect(() => compileSource(`
      *(Math: (double: D, ...))
      =
      @go = {
        :result Integer = D(n: 5)
        :result Integer = inc(n: result)
        :result Integer = dec(n: result)
        -> :result
      }
    `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
  });

  it('`name: _` discard lets `...` supply the rest of the manifest', () => {
    // `double` is consumed by `_`, so `...` skips it — inc and dec still
    // spread in. The discarded name isn't added to local scope; enforcement
    // that consumed names aren't callable relies on the general unresolved-
    // reference check, which isn't a spread-operator concern.
    expect(() => compileSource(`
      *(Math: (double: _, ...))
      =
      @go = {
        :result Integer = inc(n: 5)
        :result Integer = dec(n: result)
        -> :result
      }
    `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
  });

  it('`(...)` without an available manifest is a compile error', () => {
    // No options.remotes for Math → the pre-existing interface check fires,
    // catching the missing manifest before spread expansion even runs.
    expect(() => compileSource(`
      *(Math: (...))
      =
      @go = { :result Integer = double(n: 5); -> :result }
    `)).toThrow(/Math.*interface|spread.*Math.*manifest/i);
  });

  it('two spreads sharing a manifest op is a compile error', () => {
    const OTHER = `{
      double: (n: Integer) -> (result: Integer)
      square: (n: Integer) -> (result: Integer)
    }`;
    expect(() => compileSource(`
      *(Math: (...), Other: (...))
      =
      @go = { :result Integer = double(n: 5); -> :result }
    `, { remotes: [
      { path: 'Math', service: MATH_MANIFEST },
      { path: 'Other', service: OTHER },
    ] })).toThrow(/collision.*double/i);
  });

  it('aliasing on one side resolves a spread-vs-spread collision', () => {
    const OTHER = `{
      double: (n: Integer) -> (result: Integer)
      square: (n: Integer) -> (result: Integer)
    }`;
    expect(() => compileSource(`
      *(Math: (...), Other: (double: OD, ...))
      =
      @go = {
        :result Integer = double(n: 5)
        :result Integer = OD(n: result)
        :result Integer = square(n: result)
        -> :result
      }
    `, { remotes: [
      { path: 'Math', service: MATH_MANIFEST },
      { path: 'Other', service: OTHER },
    ] })).not.toThrow();
  });

  it('discard on one side resolves a spread-vs-spread collision', () => {
    const OTHER = `{
      double: (n: Integer) -> (result: Integer)
      square: (n: Integer) -> (result: Integer)
    }`;
    expect(() => compileSource(`
      *(Math: (...), Other: (double: _, ...))
      =
      @go = {
        :result Integer = double(n: 5)
        :result Integer = square(n: result)
        -> :result
      }
    `, { remotes: [
      { path: 'Math', service: MATH_MANIFEST },
      { path: 'Other', service: OTHER },
    ] })).not.toThrow();
  });
});

describe('spread `(...)` — runtime routing', () => {
  const MATH_MANIFEST = `{
    double: (n: Integer) -> (result: Integer)
    inc: (n: Integer) -> (result: Integer)
  }`;

  it('spread-injected call routes to the service with the remote op', async () => {
    const compiled = await compileActor(`
      *(Math: (...))
      =
      @go = {
        :result Integer = double(n: 5)
        -> :result
      }
    `, { compileOptions: { remotes: [{ path: 'Math', service: MATH_MANIFEST }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '42', op: '@go', from: 'caller' });
    const outgoing = actor.posts.find(p => p.to === 'Math');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{ n: 5 }, '@double']);
    await actor.sendAsync({ id: outgoing.id, re: { result: 10 } });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply.id).toBe('42');
    expect(reply.re).toEqual({ result: 10 });
  });

  it('aliased spread entry routes to the original remote op', async () => {
    // `double: D` — the body calls `D(...)`, but the outbound op is still
    // `@double` (the remote name), not `@D` (the local binding).
    const compiled = await compileActor(`
      *(Math: (double: D, ...))
      =
      @go = {
        :result Integer = D(n: 3)
        -> :result
      }
    `, { compileOptions: { remotes: [{ path: 'Math', service: MATH_MANIFEST }] } });
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '9', op: '@go', from: 'caller' });
    const outgoing = actor.posts.find(p => p.to === 'Math');
    expect(outgoing.op).toEqual([{ n: 3 }, '@double']);
  });
});

// ─── Body-form DI destructure — `(...) = Name` and `:x = Name` ─────────────
//
// The body-form is the counterpart to the header spread. It adds manifest
// names to local scope without consuming the module binding — both the
// flattened names and the namespace remain callable. This mirrors Ruby's
// `include` or an explicit import-as-destructure at the call site.
//
// Validator folds body-form destructures into the dep's destructure list so
// codegen sees one unified picture: the original DestructureAssign node is
// skipped (its work already done at validate time).

describe('body-form DI destructure — <:Name> + (...) = Name', () => {
  const MATH_MANIFEST = `{
    double: (n: Integer) -> (result: Integer)
    inc: (n: Integer) -> (result: Integer)
    dec: (n: Integer) -> (result: Integer)
  }`;

  describe('compilation', () => {
    it('`<:Name>` retains the namespace — bare DI compiles', () => {
      expect(() => compileSource(`
        *(:Math)
        =
        @go = { :result Integer = Math.double(n: 5); -> :result }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });

    it('`(...) = Name` body destructure compiles', () => {
      expect(() => compileSource(`
        *(:Math)
        =
        @go = {
          (...) = Math
          :result Integer = double(n: 5)
          -> :result
        }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });

    it('namespace stays accessible alongside the flattened names', () => {
      // Both `double(...)` (flattened) and `Math.double(...)` (namespace)
      // should compile — retention is the whole point of the body form.
      expect(() => compileSource(`
        *(:Math)
        =
        @go = {
          (...) = Math
          :result Integer = double(n: 5)
          :result Integer = Math.inc(n: result)
          -> :result
        }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });

    it('specific-name body form `:double = Name` adds single local', () => {
      expect(() => compileSource(`
        *(:Math)
        =
        @go = {
          :double = Math
          :result Integer = double(n: 5)
          -> :result
        }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });

    it('aliased body form `double: d = Name` routes d to @double', () => {
      // Lowercase alias required in body form — uppercase idents are parsed
      // as type annotations by parseDestructureAssign.
      expect(() => compileSource(`
        *(:Math)
        =
        @go = {
          double: d = Math
          :result Integer = d(n: 5)
          -> :result
        }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });

    it('discard + spread in body: `(double: _, ...) = Name`', () => {
      expect(() => compileSource(`
        *(:Math)
        =
        @go = {
          (double: _, ...) = Math
          :result Integer = inc(n: 5)
          -> :result
        }
      `, { remotes: [{ path: 'Math', service: MATH_MANIFEST }] })).not.toThrow();
    });
  });

  describe('runtime routing', () => {
    it('body spread — call routes to the service with the remote op', async () => {
      const compiled = await compileActor(`
        *(:Math)
        =
        @go = {
          (...) = Math
          :result Integer = double(n: 5)
          -> :result
        }
      `, { compileOptions: { remotes: [{ path: 'Math', service: MATH_MANIFEST }] } });
      const actor = await compiled.spawn();
      await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
      const outgoing = actor.posts.find(p => p.to === 'Math');
      expect(outgoing).toBeDefined();
      expect(outgoing.op).toEqual([{ n: 5 }, '@double']);
    });

    it('body aliased — `d(...)` routes to the original @double', async () => {
      const compiled = await compileActor(`
        *(:Math)
        =
        @go = {
          double: d = Math
          :result Integer = d(n: 7)
          -> :result
        }
      `, { compileOptions: { remotes: [{ path: 'Math', service: MATH_MANIFEST }] } });
      const actor = await compiled.spawn();
      await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
      const outgoing = actor.posts.find(p => p.to === 'Math');
      expect(outgoing.op).toEqual([{ n: 7 }, '@double']);
    });

    it('namespace still routes: `Math.double(...)` after `(...) = Math`', async () => {
      const compiled = await compileActor(`
        *(:Math)
        =
        @go = {
          (...) = Math
          :result Integer = Math.inc(n: 5)
          -> :result
        }
      `, { compileOptions: { remotes: [{ path: 'Math', service: MATH_MANIFEST }] } });
      const actor = await compiled.spawn();
      await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
      const outgoing = actor.posts.find(p => p.to === 'Math');
      expect(outgoing.op).toEqual([{ n: 5 }, '@inc']);
    });
  });
});
