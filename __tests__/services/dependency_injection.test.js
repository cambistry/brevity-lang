import { compileSource, compileActor } from '../helpers.js';
import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File-level dependency injection — constructor header on the file-as-actor
//
// The file-actor declares process dependencies in a top-level < ... > header.
// Each dependency is a path → alias mapping with a service constraint.
//
// Forms:
//   < "/path": (Alias) { method: sig } >   inline constraint (required)
//   < "/a": (A) { ... }, "/b": ... >        multiple dependencies
//
// The alias is used to call :methods Alias.method(args)
// Under the hood this produces outgoing CAM messages with to: "Alias"
//
// Bare * without a constraint is not supported — all dependencies must
// declare their interface explicitly.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Compilation ─────────────────────────────────────────────────────────────

describe('file-level DI — basic compilation', () => {
  it('single dependency with constraint compiles', () => {
    expect(() => compileSource(`
      <
        "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
      >

      @query = |:key Text| {
        :value Text = DB.lookup(:key)
        -> :value
      }
    `)).not.toThrow();
  });

  it('single dependency — compact form compiles', () => {
    expect(() => compileSource(`
      < "/services/db": (DB) { lookup: (:key Text) -> (:value Text) } >

      @query = |:key Text| {
        :value Text = DB.lookup(:key)
        -> :value
      }
    `)).not.toThrow();
  });

  it('multiple dependencies compile', () => {
    expect(() => compileSource(`
      <
        "/services/db": (DB) { put: (:key Text, :value Text) -> . }
        "/services/cache": (Cache) { get: (:key Text) -> (:value Text) }
      >

      @fetch = |:key Text| {
        :value Text = Cache.get(:key)
        -> :value
      }

      @store = |:key Text, :value Text| {
        DB.put(:key, :value) .
      }
    `)).not.toThrow();
  });

  it('comma-separated dependencies compile', () => {
    expect(() => compileSource(`
      <
        "/db": (DB) { ping: () -> . },
        "/cache": (Cache) { ping: () -> . }
      >

      @test = { DB.ping() . }
    `)).not.toThrow();
  });

  it('bare * parses but fails compilation without interface', () => {
    // Parsing succeeds — compile rejects because no interface is available
    const { ast } = extract(`
      <
        "/services/remote": (Remote) *
      >
      @go = { Remote.ping() . }
    `);
    expect(() => compile(ast)).toThrow(/requires an interface/);
  });
});

// ─── Outgoing CAM messages ───────────────────────────────────────────────────

describe('file-level DI — outgoing CAM messages', () => {
  const source = `
    <
      "/services/remote": (Remote) {
        ping: () -> .
        greet: (:name Text) -> (:greeting Text)
      }
    >

    @ping = { Remote.ping() . }

    @greet
      =
      :name Text
      =
      :greeting Text = Remote.greet(:name)
      -> :greeting
  `;

  let compiled;
  beforeAll(async () => { compiled = await compileActor(source); });

  it('silent call sends correct outgoing message', async () => {
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@ping', from: 'c' });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toBe('@ping');
  });

  it('call with args sends correct outgoing message', async () => {
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: [{ name: 'Alice' }, '@greet'], from: 'c', 'bv-a': [{ name: 'Text' }] });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{ name: 'Alice' }, '@greet']);
  });
});

// ─── Full roundtrip ──────────────────────────────────────────────────────────

describe('file-level DI — full roundtrip', () => {
  const source = `
    <
      "/services/db": (DB) {
        lookup: (:key Text) -> (:value Text)
      }
      "/services/math": (Math) {
        double: (:n Integer) -> (:result Integer)
      }
    >

    @fetch
      =
      :key Text
      =
      :value Text = DB.lookup(:key)
      -> :value

    @compute
      =
      :n Integer
      =
      :result Integer = Math.double(:n)
      -> answer: (result + 1) as Integer
  `;

  let compiled;
  beforeAll(async () => { compiled = await compileActor(source); });

  it('call out, mock response, return to caller', async () => {
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '42', op: [{ key: 'color' }, '@fetch'], from: 'caller', 'bv-a': [{ key: 'Text' }] });

    const outgoing = actor.posts.find(p => p.to === 'DB');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{ key: 'color' }, '@lookup']);

    await actor.sendAsync({ id: outgoing.id, re: { value: 'blue' } });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('42');
    expect(reply.re).toEqual({ value: 'blue' });
  });

  it('call out, transform result, return to caller', async () => {
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '7', op: [{ n: 5 }, '@compute'], from: 'tester', 'bv-a': [{ n: 'Integer' }] });

    const outgoing = actor.posts.find(p => p.to === 'Math');
    expect(outgoing.op).toEqual([{ n: 5 }, '@double']);

    await actor.sendAsync({ id: outgoing.id, re: { result: 10 } });

    const reply = actor.posts.find(p => p.to === 'tester');
    expect(reply.id).toBe('7');
    expect(reply.re).toEqual({ answer: 11 });
  });
});

// ─── Service coercion ────────────────────────────────────────────────────────

describe('file-level DI — service coercion with as', () => {
  it('as-cast in file body compiles', () => {
    expect(() => compileSource(`
      <
        "/services/store": (Store) { get: (:key Text) -> (:value Text) }
      >

      db = Store as { @get: (:key Text) -> (:value Text) }

      @fetch = |:key Text| {
        :value Text = db.get(:key)
        -> :value
      }
    `)).not.toThrow();
  });

  it('as-cast can widen to methods not in original constraint', () => {
    expect(() => compileSource(`
      <
        "/services/generic": (Svc) { basic: () -> . }
      >

      narrow = Svc as { @specialized: (:x Integer) -> (:result Integer) }

      @go = |:x Integer| {
        :result Integer = narrow.specialized(:x)
        -> :result
      }
    `)).not.toThrow();
  });

  it('as-cast rejects wrong arg type', () => {
    expect(() => compileSource(`
      <
        "/services/store": (Store) { get: (:key Text) -> (:value Text) }
      >

      db = Store as { @get: (:key Text) -> (:value Text) }

      @go = {
        :result Text = db.get(key: 42)
        -> :result
      }
    `)).toThrow(/type/i);
  });
});

// ─── Inline constraint validation ────────────────────────────────────────────

describe('file-level DI — inline constraint checks', () => {
  it('rejects call to undefined method', () => {
    expect(() => compileSource(`
      <
        "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
      >

      @go = { DB.missing() . }
    `)).toThrow(/has no function 'missing'/);
  });

  it('rejects wrong arg type', () => {
    expect(() => compileSource(`
      <
        "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
      >

      @go = { n Integer = 42; DB.lookup(n) . }
    `)).toThrow(/don't match|type/i);
  });

  it('rejects returning silent remote call', () => {
    expect(() => compileSource(`
      <
        "/services/remote": (Remote) { fire: (Text) -> . }
      >

      @go = -> Remote.fire("hi")
    `)).toThrow(/silent/);
  });

  it('multi-method constraint compiles', () => {
    expect(() => compileSource(`
      <
        "/services/store": (Store) {
          lookup: (:key Text) -> (:value Text)
          save: (:key Text, :value Text) -> .
        }
      >

      @read = |:key Text| {
        :value Text = Store.lookup(:key)
        -> :value
      }

      @write = |:key Text, :value Text| {
        Store.save(:key, :value) .
      }
    `)).not.toThrow();
  });
});

// ─── Dependency extraction ───────────────────────────────────────────────────

describe('file-level DI — dependency extraction', () => {
  it('extract surfaces inline-constraint dep in iface.params', () => {
    const { interface: iface } = extract(`
      <
        "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
      >
      @test = -> 1 as Integer
    `);
    expect(iface.params).toBe('<\n  :"/services/db" *\n>');
  });

  it('extract surfaces bare * dep in iface.params', () => {
    const { interface: iface } = extract(`
      <
        "/services/db": (DB) *
      >
      @test = -> 1 as Integer
    `);
    expect(iface.params).toBe('<\n  :"/services/db" *\n>');
  });

  it('extract surfaces multiple dependency paths in iface.params', () => {
    const { interface: iface } = extract(`
      <
        "/services/db": (DB) { lookup: (:key Text) -> (:value Text) }
        "/services/cache": (Cache) *
      >
      @test = -> 1 as Integer
    `);
    expect(iface.params).toBe('<\n  :"/services/db" *\n  :"/services/cache" *\n>');
  });

});

// ─── options.remotes injection ───────────────────────────────────────────────

describe('file-level DI — options.remotes injection', () => {
  const dbManifest = '{\n  lookup: (:key Text) -> (:value Text)\n}';

  it('bare * compiles when interface supplied via options.remotes', () => {
    const { ast } = extract(`
      <
        "/services/db": (DB) *
      >
      @go = { key Text = "test"; DB.lookup(:key) . }
    `);
    expect(() => compile(ast, {
      remotes: [{ path: '/services/db', service: dbManifest }],
    })).not.toThrow();
  });

  it('bare * fails compilation when no interface supplied', () => {
    const { ast } = extract(`
      <
        "/services/db": (DB) *
      >
      @go = { DB.lookup("test") . }
    `);
    expect(() => compile(ast)).toThrow(/requires an interface/);
  });

  it('options.remotes catches undefined method', () => {
    const { ast } = extract(`
      <
        "/services/db": (DB) *
      >
      @go = { DB.missing() . }
    `);
    expect(() => compile(ast, {
      remotes: [{ path: '/services/db', service: dbManifest }],
    })).toThrow(/has no function 'missing'/);
  });

  it('options.remotes catches wrong arg type', () => {
    const { ast } = extract(`
      <
        "/services/db": (DB) *
      >
      @go = { n Integer = 42; DB.lookup(n) . }
    `);
    expect(() => compile(ast, {
      remotes: [{ path: '/services/db', service: dbManifest }],
    })).toThrow(/don't match|type/i);
  });

  it('options.remotes catches returning silent call', () => {
    const { ast } = extract(`
      <
        "/services/db": (DB) { ping: () -> . }
      >
      @go = -> DB.ping()
    `);
    expect(() => compile(ast, {
      remotes: [{ path: '/services/db', service: '{\n  ping: () -> .\n}' }],
    })).toThrow(/silent/);
  });
});
