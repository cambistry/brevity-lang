import { compileSource, compileActor, createActor } from '../helpers.js';

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
//   (Alias) #                     generic constructor (signature deferred)
//   Coerced = Alias as <ctor> -> { iface }   coercion of a # dep to a typed ctor
//
// This file replaces the older `constructs` keyword.
// ═══════════════════════════════════════════════════════════════════════════════

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';

// ─── Phase 1: explicit constructor form ─────────────────────────────────────

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

describe('explicit form — ::new emission', () => {
  const singleArgSource = `
    < "thing.bv": (Thing) <:a Integer> -> { get: () -> (:value Integer) } >

    t = Thing(a: 5)

    @go = { :value Integer = t.get(); -> :value }
  `;

  let compiled;
  beforeAll(async () => { compiled = await compileActor(singleArgSource); });

  it('construction emits ::new with named arg payload', async () => {
    const actor = await compiled.spawn();
    if (_target === 'js') {
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 5 }, '::new'],
        to: 'Thing',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 5 }, '::new'],
        to: 'Thing',
      }));
    }
  });

  it('multi-arg constructor emits all args in ::new', async () => {
    const actor = await createActor(`
      < "db.bv": (DB) <:host Text, :port Integer> -> { ping: () -> . } >

      db = DB(host: "localhost", port: 5432)

      @status = -> ok: "ready" as Text
    `);
    if (_target === 'js') {
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ host: 'localhost', port: 5432 }, '::new'],
        to: 'DB',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<DB>', from: 'DB/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ host: 'localhost', port: 5432 }, '::new'],
        to: 'DB',
      }));
    }
  });

  it('zero-arg constructor emits ::new with empty payload', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) <> -> { ping: () -> . } >

      t = Thing()

      @status = -> ok: "ready" as Text
    `);
    if (_target === 'js') {
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{}, '::new'],
        to: 'Thing',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{}, '::new'],
        to: 'Thing',
      }));
    }
  });
});

describe('explicit form — instance routing after ::new', () => {
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

  let compiled;
  beforeAll(async () => { compiled = await compileActor(source); });

  it('non-silent method call routes to instance address', async () => {
    const actor = await compiled.spawn();
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1',
      });
      await actor.sendAsync({ id: '99', op: '@go', from: 'caller' });
      const getMsg = actor.posts.find(p => p.op === '@get');
      expect(getMsg).toEqual(expect.objectContaining({
        op: '@get', to: 'Thing/1',
      }));
      await actor.sendAsync({ id: getMsg.id, re: { value: 42 } });
      const reply = actor.posts.find(p => p.to === 'caller');
      expect(reply.re).toEqual({ value: 42 });
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' });
      actor.send({ id: '99', op: '@go', from: 'caller' });
      await actor.sendAsync({ id: '2', re: { value: 42 } });
      expect(actor.posts.find(p => p.op === '@get')).toEqual(expect.objectContaining({
        op: '@get', to: 'Thing/1',
      }));
      const reply = actor.posts.find(p => p.to === 'caller');
      expect(reply.re).toEqual({ value: 42 });
    }
  });

  it('silent method call routes to instance address', async () => {
    const actor = await compiled.spawn();
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<Thing>', from: 'Thing/77',
      });
      await actor.sendAsync({ id: '1', op: '@notify', from: 'caller' });
      const pingMsg = actor.posts.find(p => p.op === '@ping');
      expect(pingMsg).toEqual(expect.objectContaining({
        op: '@ping', to: 'Thing/77',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/77' });
      await actor.sendAsync({ id: '2', op: '@notify', from: 'caller' });
      expect(actor.posts.find(p => p.op === '@ping')).toEqual(expect.objectContaining({
        op: '@ping', to: 'Thing/77',
      }));
    }
  });
});

describe('explicit form — multiple instances', () => {
  it('two instances of the same dep route to independent addresses', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) <:tag Text> -> { ping: () -> . } >

      a = Thing(tag: "first")
      b = Thing(tag: "second")

      @both = {
        a.ping()
        b.ping()
        .
      }
    `);
    if (_target === 'js') {
      const new1 = actor.posts[0];
      expect(new1).toEqual(expect.objectContaining({
        op: [{ tag: 'first' }, '::new'], to: 'Thing',
      }));
      const new2 = actor.posts[1];
      expect(new2).toEqual(expect.objectContaining({
        op: [{ tag: 'second' }, '::new'], to: 'Thing',
      }));
      await actor.sendAsync({
        id: new1.id, re: {}, 'bv-a': 'self<Thing>', from: 'Thing/A',
      });
      await actor.sendAsync({
        id: new2.id, re: {}, 'bv-a': 'self<Thing>', from: 'Thing/B',
      });
      await actor.sendAsync({ id: '1', op: '@both', from: 'caller' });
      const aPing = actor.posts.find(p => p.to === 'Thing/A');
      expect(aPing).toEqual(expect.objectContaining({ op: '@ping' }));
      // Reply to the first ping so the second one can fire
      await actor.sendAsync({ id: aPing.id, re: {} });
      const bPing = actor.posts.find(p => p.to === 'Thing/B');
      expect(bPing).toEqual(expect.objectContaining({ op: '@ping' }));
    } else {
      actor.send({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/A' });
      actor.send({ id: '2', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/B' });
      actor.send({ id: '99', op: '@both', from: 'caller' });
      await actor.sendAsync({ id: '3', re: {} });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ tag: 'first' }, '::new'], to: 'Thing',
      }));
      expect(actor.posts[1]).toEqual(expect.objectContaining({
        op: [{ tag: 'second' }, '::new'], to: 'Thing',
      }));
      expect(actor.posts.find(p => p.to === 'Thing/A')).toBeDefined();
      expect(actor.posts.find(p => p.to === 'Thing/B')).toBeDefined();
    }
  });
});

describe('explicit form — full roundtrip', () => {
  it('construct, call method with arg, mock reply, return to caller', async () => {
    const source = `
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
    `;
    const actor = await createActor(source);
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<Math>', from: 'Math/1',
      });
      await actor.sendAsync({
        id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }],
      });
      const doubleMsg = actor.posts.find(p => p.op?.[1] === '@double');
      expect(doubleMsg).toEqual(expect.objectContaining({
        op: [{ n: 5 }, '@double'], to: 'Math/1',
      }));
      await actor.sendAsync({ id: doubleMsg.id, re: { result: 10 } });
      const reply = actor.posts.find(p => p.to === 'tester');
      expect(reply.re).toEqual({ answer: 11 });
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Math>', from: 'Math/1' });
      actor.send({
        id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }],
      });
      await actor.sendAsync({ id: '2', re: { result: 10 } });
      expect(actor.posts.find(p => p.op?.[1] === '@double')).toEqual(expect.objectContaining({
        to: 'Math/1',
      }));
      const reply = actor.posts.find(p => p.to === 'tester');
      expect(reply.re).toEqual({ answer: 11 });
    }
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
//
// `(Alias) #` declares a constructor-shaped dependency whose manifest is
// resolved by the compiler host via `options.remotes`. The manifest format
// is the same `<:p Type, ...> -> { iface }` shape as the inline form.
// Without a manifest, the compiler rejects the file — same as bare `*`.

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

  it('construction against # dep emits ::new with call args', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) # >

      t = Thing(a: 7)

      @status = -> ok: "ready" as Text
    `, { compileOptions: { remotes: [{ path: 'thing.bv', service: ctorManifest }] } });
    if (_target === 'js') {
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 7 }, '::new'],
        to: 'Thing',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 7 }, '::new'],
        to: 'Thing',
      }));
    }
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
  it('construction via coerced name emits ::new addressed to underlying dep', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: 5)

      @status = -> ok: "ready" as Text
    `);
    if (_target === 'js') {
      // ::new must go to 'Thing' (the underlying dep), not 'Coerced'
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 5 }, '::new'],
        to: 'Thing',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ a: 5 }, '::new'],
        to: 'Thing',
      }));
    }
  });

  it('method calls on coerced instance route to underlying instance address', async () => {
    const actor = await createActor(`
      < "thing.bv": (Thing) # >

      Coerced = Thing as <:a Integer> -> { get: () -> (:value Integer) }

      thing = Coerced(a: 5)

      @go
        =
        :value Integer = thing.get()
        -> :value
    `);
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<Thing>', from: 'Thing/42',
      });
      await actor.sendAsync({ id: '7', op: '@go', from: 'caller' });
      const getMsg = actor.posts.find(p => p.op === '@get');
      expect(getMsg).toEqual(expect.objectContaining({
        op: '@get', to: 'Thing/42',
      }));
      await actor.sendAsync({ id: getMsg.id, re: { value: 99 } });
      const reply = actor.posts.find(p => p.to === 'caller');
      expect(reply.re).toEqual({ value: 99 });
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Thing>', from: 'Thing/42' });
      actor.send({ id: '7', op: '@go', from: 'caller' });
      await actor.sendAsync({ id: '2', re: { value: 99 } });
      expect(actor.posts.find(p => p.op === '@get')).toEqual(expect.objectContaining({
        to: 'Thing/42',
      }));
      const reply = actor.posts.find(p => p.to === 'caller');
      expect(reply.re).toEqual({ value: 99 });
    }
  });
});
