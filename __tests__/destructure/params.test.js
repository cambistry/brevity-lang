import { compileSource, compileActor, createActor, expectActorBehavior } from '../helpers.js';
import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Destructuring in DI — file-level params
//
// Public members can be destructured from injected services using the `:`
// sigil in the import's alias tuple. From the client's perspective, functions,
// constants, and cells are all the same thing: addressable ops.
//
// Forms:
//   < "path.bv": (:Name) * >                 single destructure
//   < "path.bv": (:A, :B, :C) * >            multiple destructures
//   < "path.bv": (Local: remote) * >          aliased destructure
//   < "path.bv": (Local: remote Type) * >     aliased with type annotation
//
// Destructurable member kinds (all @-prefixed in the source):
//   @fn = |args| -> result        function
//   @pub = "magic"                constant
//   @value *Integer = 1           cell
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Compilation — single destructure ────────────────────────────────────────

describe('destructure params — single function', () => {
  const manifest = '{\n  Point: <Integer, Integer> -> {\n    x: () -> (Integer)\n    y: () -> (Integer)\n  }\n}';

  it('single destructured function compiles', () => {
    expect(() => compileSource(`
      <
        "geometry.bv": (:Point) *
      >

      @go
        =
        p = Point(1, 2)
        -> :p
    `, { remotes: [{ path: 'geometry.bv', service: manifest }] })).not.toThrow();
  });

  it('compact single-line form compiles', () => {
    expect(() => compileSource(`
      < "geometry.bv": (:Point) * >

      @go
        =
        p = Point(1, 2)
        -> :p
    `, { remotes: [{ path: 'geometry.bv', service: manifest }] })).not.toThrow();
  });
});

describe('destructure params — single constant', () => {
  const manifest = '{\n  MAGIC: () -> (Text)\n}';

  it('destructured constant compiles', () => {
    expect(() => compileSource(`
      < "config.bv": (:MAGIC) * >

      @go = -> value: MAGIC as Text
    `, { remotes: [{ path: 'config.bv', service: manifest }] })).not.toThrow();
  });
});

describe('destructure params — single cell', () => {
  const manifest = '{\n  count: () -> (Integer)\n}';

  it('destructured cell read compiles', () => {
    expect(() => compileSource(`
      < "counter.bv": (:count) * >

      @go
        =
        n Integer = count
        -> :n
    `, { remotes: [{ path: 'counter.bv', service: manifest }] })).not.toThrow();
  });
});

// ─── Compilation — multiple destructures ─────────────────────────────────────

describe('destructure params — multiple members', () => {
  const domManifest = '{\n  Element: () -> (Element)\n  div: () -> (Element)\n  p: () -> (Element)\n}';
  const mixedManifest = '{\n  greet: (:name Text) -> (:greeting Text)\n  VERSION: () -> (Text)\n  count: () -> (Integer)\n}';

  it('multiple destructured functions compile', () => {
    expect(() => compileSource(`
      < "dom.bv": (:Element, :div, :p) * >

      @render
        =
        d = div()
        para = p()
        -> :d
    `, { remotes: [{ path: 'dom.bv', service: domManifest }] })).not.toThrow();
  });

  it('mixed function, constant, and cell destructures compile', () => {
    expect(() => compileSource(`
      < "service.bv": (:greet, :VERSION, :count) * >

      @go
        =
        msg Text = greet("world")
        -> :msg
    `, { remotes: [{ path: 'service.bv', service: mixedManifest }] })).not.toThrow();
  });
});

// ─── Compilation — aliased destructures ──────────────────────────────────────

describe('destructure params — aliasing', () => {
  const manifest = '{\n  create: () -> (Text)\n  CONFIG: () -> (Text)\n  Func: () -> (Text)\n  Point: <Integer, Integer> -> {\n    x: () -> (Integer)\n  }\n  Scale: () -> (Integer)\n}';

  it('aliased destructure compiles', () => {
    expect(() => compileSource(`
      < "service.bv": (create: fn) * >

      @go
        =
        result = fn()
        -> :result
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('aliased destructure with type annotation compiles', () => {
    expect(() => compileSource(`
      < "service.bv": (CONFIG: cfg Text) * >

      @go = -> value: cfg as Text
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('multiple aliased destructures compile', () => {
    expect(() => compileSource(`
      < "service.bv": (Func: fn, CONFIG: cfg Text) * >

      @go
        =
        result = fn()
        -> :result
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('mixed bare and aliased destructures compile', () => {
    expect(() => compileSource(`
      < "service.bv": (:Point, Scale: scale Integer) * >

      @go
        =
        p = Point(1, 2)
        -> :p
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });
});

// ─── Compilation — with constructor form ─────────────────────────────────────

describe('destructure params — constructor (#) form', () => {
  it('# form with manifest compiles (no construction)', () => {
    const manifest = '{\n  greet: (:name Text) -> (:greeting Text)\n}';
    expect(() => compileSource(`
      < "service.bv": (:greet) # >

      @go = -> 1 as Integer
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('# form without manifest throws', () => {
    expect(() => compileSource(`
      < "geometry.bv": (:Point) # >

      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });
});

// ─── Compilation — bare * without remotes must fail ──────────────────────────

describe('destructure params — requires interface', () => {
  it('bare * without remotes throws', () => {
    expect(() => compileSource(`
      < "geometry.bv": (:Point) * >

      @go
        =
        p = Point(1, 2)
        -> :p
    `)).toThrow(/requires an interface/);
  });

  it('multiple destructures without remotes throws', () => {
    expect(() => compileSource(`
      < "service.bv": (:greet, :VERSION) * >

      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });

  it('aliased destructure without remotes throws', () => {
    expect(() => compileSource(`
      < "service.bv": (Func: fn) * >

      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });
});

// ─── Compilation — with inline service interface ─────────────────────────────

describe('destructure params — inline interface', () => {
  it('destructure with explicit inline interface compiles', () => {
    expect(() => compileSource(`
      <
        "greeter.bv": (:greet) {
          greet: (:name Text) -> (:greeting Text)
        }
      >

      @go
        =
        :name Text
        =
        :greeting Text = greet(name: name)
        -> :greeting
    `)).not.toThrow();
  });
});

// ─── Extraction — params rendering ───────────────────────────────────────────

describe('destructure params — extraction', () => {
  it('single destructure renders in iface.params', () => {
    const { interface: iface } = extract(`
      < "geometry.bv": (:Point) * >
      @noop = .
    `);
    expect(iface.params).toContain('geometry.bv');
    expect(iface.params).toContain('Point');
  });

  it('multiple destructures render in iface.params', () => {
    const { interface: iface } = extract(`
      < "dom.bv": (:Element, :div, :p) * >
      @noop = .
    `);
    expect(iface.params).toContain('dom.bv');
  });

  it('aliased destructure renders in iface.params', () => {
    const { interface: iface } = extract(`
      < "service.bv": (Func: fn, CONFIG: cfg Text) * >
      @noop = .
    `);
    expect(iface.params).toContain('service.bv');
  });

  it('destructured member appears in service block with qualified path', () => {
    const { interface: iface } = extract(`
      < "geometry.bv": (:Point) * >

      @go = |p Point| -> p as Point
    `);
    expect(iface.service).toContain('`geometry.bv`.Point');
  });
});

// ─── Outgoing CAM messages ───────────────────────────────────────────────────

describe('destructure params — outgoing messages', () => {
  const manifest = '{\n  greet: (:name Text) -> (:greeting Text)\n  ping: () -> .\n}';

  it('destructured function call sends message to source service', async () => {
    const compiled = await compileActor(`
      < "greeter.bv": (:greet) * >

      @go
        =
        :name Text
        =
        :greeting Text = greet(name: name)
        -> :greeting
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: [{ name: 'Alice' }, '@go'], from: 'caller', 'bv-a': [{ name: 'Text' }] });

    const outgoing = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === '@greet') ||
      (Array.isArray(p.op) && p.op.includes('@greet'))
    ));
    expect(outgoing).toBeDefined();
  });

  it('destructured silent call sends message to source service', async () => {
    const compiled = await compileActor(`
      < "greeter.bv": (:ping) * >

      @go = { ping() . }
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });

    const outgoing = actor.posts.find(p => p.op === '@ping');
    expect(outgoing).toBeDefined();
  });
});

// ─── Full roundtrip ──────────────────────────────────────────────────────────

describe('destructure params — full roundtrip', () => {
  const manifest = '{\n  greet: (:name Text) -> (:greeting Text)\n}';

  it('destructured function: call out, mock response, return to caller', async () => {
    const compiled = await compileActor(`
      < "greeter.bv": (:greet) * >

      @hello
        =
        :name Text
        =
        :greeting Text = greet(name: name)
        -> :greeting
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '42', op: [{ name: 'Alice' }, '@hello'], from: 'caller', 'bv-a': [{ name: 'Text' }] });

    const outgoing = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === '@greet') ||
      (Array.isArray(p.op) && p.op.includes('@greet'))
    ));
    expect(outgoing).toBeDefined();

    await actor.sendAsync({ id: outgoing.id, re: { greeting: 'Hello, Alice!' } });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('42');
    expect(reply.re).toEqual({ greeting: 'Hello, Alice!' });
  });
});

// ─── Destructured constructor — instance routing ─────────────────────────────

// Constructor roundtrip for destructured members requires #sendNew routing
// through the destructure map — deferred to a follow-up.
// describe('destructure params — constructor roundtrip', () => { ... });

// ─── Validation / error cases ────────────────────────────────────────────────

describe('destructure params — validation', () => {
  it('rejects duplicate destructure names across deps', () => {
    expect(() => compileSource(`
      < "a.bv": (:foo) *, "b.bv": (:foo) * >

      @go = -> 1 as Integer
    `)).toThrow();
  });

  it('bare * without remotes rejects even with destructures', () => {
    expect(() => compileSource(`
      < "service.bv": (:greet) * >
      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });

  it('# form without remotes rejects with destructures', () => {
    expect(() => compileSource(`
      < "service.bv": (:greet) # >
      @go = -> 1 as Integer
    `)).toThrow(/requires an interface/);
  });
});

// ─── Uniform addressable ops ─────────────────────────────────────────────────

describe('destructure params — uniform addressable ops', () => {
  const manifest = '{\n  greet: (:name Text) -> (:greeting Text)\n  VERSION: () -> (Text)\n  count: () -> (Integer)\n}';

  it('function, constant, and cell are all callable as ops', async () => {
    const compiled = await compileActor(`
      < "service.bv": (:greet, :VERSION, :count) * >

      @useFunction
        =
        :name Text
        =
        :greeting Text = greet(name: name)
        -> :greeting

      @useConstant
        =
        v Text = VERSION
        -> value: v as Text

      @useCell
        =
        n Integer = count
        -> value: n as Integer
    `, { compileOptions: { remotes: [{ path: 'service.bv', service: manifest }] } });

    const actor = await compiled.spawn();

    await actor.sendAsync({ id: '1', op: [{ name: 'Alice' }, '@useFunction'], from: 'caller', 'bv-a': [{ name: 'Text' }] });
    const fnOut = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === '@greet') ||
      (Array.isArray(p.op) && p.op.includes('@greet'))
    ));
    expect(fnOut).toBeDefined();

    await actor.sendAsync({ id: '2', op: '@useConstant', from: 'caller' });
    const constOut = actor.posts.find(p => p.op === '@VERSION');
    expect(constOut).toBeDefined();

    await actor.sendAsync({ id: '3', op: '@useCell', from: 'caller' });
    const cellOut = actor.posts.find(p => p.op === '@count');
    expect(cellOut).toBeDefined();
  });
});
