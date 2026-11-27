import { compileSource, compileActor } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Destructuring in DI — file-level params
//
// Public members can be destructured from injected services using the `:`
// sigil in the import's alias tuple. From the client's perspective, functions,
// constants, and cells are all the same thing: addressable ops.
//
// Forms:
//   *( "path.bv": (:Name) )                 single destructure
//   *( "path.bv": (:A, :B, :C) )            multiple destructures
//   *( "path.bv": (Local: remote) )          aliased destructure
//   *( "path.bv": (Local: remote Type) )     aliased with type annotation
//
// Destructurable member kinds (all @-prefixed in the source):
//   @fn = (args) -> result        function
//   @pub = "magic"                constant
//   @value *Integer = 1           cell
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Compilation — single destructure ────────────────────────────────────────

describe('destructure params — single function', () => {
  const manifest = {
    ':Point': {
      public: { $new: [{ args: ['Integer', 'Integer'], re: [':Point'], writes: false }] },
      instance: {
        public: { x: [{ re: ['Integer'], writes: false }], y: [{ re: ['Integer'], writes: false }] },
      },
    },
  };

  it('single destructured function compiles', () => {
    expect(() => compileSource(`
      use :Point = "geometry.bv"

      @go
        =
        p = Point(1, 2)
        return :p
    `, { remotes: [{ path: 'geometry.bv', service: manifest }] })).not.toThrow();
  });

  it('compact single-line form compiles', () => {
    expect(() => compileSource(`
      use :Point = "geometry.bv"

      @go
        =
        p = Point(1, 2)
        return :p
    `, { remotes: [{ path: 'geometry.bv', service: manifest }] })).not.toThrow();
  });
});

describe('destructure params — single constant', () => {
  const manifest = { public: { MAGIC: [{ re: ['Text'], writes: false }] } };

  it('destructured constant compiles', () => {
    expect(() => compileSource(`
      use :MAGIC = "config.bv"

      @go = () -> value: MAGIC as Text
    `, { remotes: [{ path: 'config.bv', service: manifest }] })).not.toThrow();
  });
});

describe('destructure params — single cell', () => {
  const manifest = { public: { count: [{ re: ['Integer'], writes: false }] } };

  it('destructured cell read compiles', () => {
    expect(() => compileSource(`
      use :count = "counter.bv"

      @go
        =
        n Integer = count
        return :n
    `, { remotes: [{ path: 'counter.bv', service: manifest }] })).not.toThrow();
  });
});

// ─── Compilation — multiple destructures ─────────────────────────────────────

describe('destructure params — multiple members', () => {
  const domDocument = {
    public: {
      Element: [{ re: ['Element'], writes: false }],
      div: [{ re: ['Element'], writes: false }],
      p: [{ re: ['Element'], writes: false }],
    },
  };
  const mixedManifest = {
    public: {
      greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }],
      VERSION: [{ re: ['Text'], writes: false }],
      count: [{ re: ['Integer'], writes: false }],
    },
  };

  it('multiple destructured functions compile', () => {
    expect(() => compileSource(`
      use :Element, :div, :p = "dom.bv"

      @render
        =
        d = div()
        para = p()
        return :d
    `, { remotes: [{ path: 'dom.bv', service: domDocument }] })).not.toThrow();
  });

  it('mixed function, constant, and cell destructures compile', () => {
    expect(() => compileSource(`
      use :greet, :VERSION, :count = "service.bv"

      @go
        =
        msg Text = greet("world")
        return :msg
    `, { remotes: [{ path: 'service.bv', service: mixedManifest }] })).not.toThrow();
  });
});

// ─── Compilation — aliased destructures ──────────────────────────────────────

describe('destructure params — aliasing', () => {
  const manifest = {
    public: {
      create: [{ re: ['Text'], writes: false }],
      CONFIG: [{ re: ['Text'], writes: false }],
      Func: [{ re: ['Text'], writes: false }],
      Scale: [{ re: ['Integer'], writes: false }],
    },
    ':Point': {
      public: { $new: [{ args: ['Integer', 'Integer'], re: [':Point'], writes: false }] },
      instance: { public: { x: [{ re: ['Integer'], writes: false }] } },
    },
  };

  it('aliased destructure compiles', () => {
    expect(() => compileSource(`
      use create: fn = "service.bv"

      @go
        =
        result = fn()
        return :result
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('aliased destructure with type annotation compiles', () => {
    expect(() => compileSource(`
      use CONFIG: cfg Text = "service.bv"

      @go = () -> value: cfg
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('multiple aliased destructures compile', () => {
    expect(() => compileSource(`
      use Func: fn, CONFIG: cfg Text = "service.bv"

      @go
        =
        result = fn()
        return :result
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('mixed bare and aliased destructures compile', () => {
    expect(() => compileSource(`
      use :Point, Scale: scale Integer = "service.bv"

      @go
        =
        p = Point(1, 2)
        return :p
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });
});

// ─── Compilation — an unclaimed source ───────────────────────────────────────

describe('destructure params — unclaimed source', () => {
  it('with a document, compiles', () => {
    const manifest = {
      public: { greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }] },
    };
    expect(() => compileSource(`
      use :greet = "service.bv"

      @go = () -> 1
    `, { remotes: [{ path: 'service.bv', service: manifest }] })).not.toThrow();
  });

  it('without a document, throws', () => {
    expect(() => compileSource(`
      use :Point = "geometry.bv"

      @go = () -> 1
    `)).toThrow(/has no type/);
  });
});

// ─── Compilation — bare * without remotes must fail ──────────────────────────

describe('destructure params — requires interface', () => {
  it('bare * without remotes throws', () => {
    expect(() => compileSource(`
      use :Point = "geometry.bv"

      @go
        =
        p = Point(1, 2)
        return :p
    `)).toThrow(/has no type/);
  });

  it('multiple destructures without remotes throws', () => {
    expect(() => compileSource(`
      use :greet, :VERSION = "service.bv"

      @go = () -> 1
    `)).toThrow(/has no type/);
  });

  it('aliased destructure without remotes throws', () => {
    expect(() => compileSource(`
      use Func: fn = "service.bv"

      @go = () -> 1
    `)).toThrow(/has no type/);
  });
});

// ─── Compilation — with inline service interface ─────────────────────────────

describe('destructure params — inline interface', () => {
  it('destructure with explicit inline interface compiles', () => {
    expect(() => compileSource(`
      use :greet = "greeter.bv" as {
        greet (name: Text) -> (greeting: Text)
      }

      @go
        =
        name: Text
        =
        :greeting Text = greet(name: name)
        return :greeting
    `)).not.toThrow();
  });
});

// ─── Extraction — params rendering ───────────────────────────────────────────

describe('destructure params — extraction', () => {
  it('single destructure renders in iface.params (key only; the destructure is a binding)', () => {
    const { interface: iface } = extract(`
      use :Point = "geometry.bv"
    `);
    expect(iface.params).toBe('(\n  "geometry.bv":\n)');
  });

  it('multiple destructures render in iface.params', () => {
    const { interface: iface } = extract(`
      use :Element, :div, :p = "dom.bv"
    `);
    expect(iface.params).toContain('dom.bv');
  });

  it('aliased destructure renders in iface.params', () => {
    const { interface: iface } = extract(`
      use Func: fn, CONFIG: cfg Text = "service.bv"
    `);
    expect(iface.params).toContain('service.bv');
  });

  it('destructured member appears in constructor block with qualified path', () => {
    const { interface: iface } = extract(`
      use :Point = "geometry.bv"

      @go = (p Point) -> p
    `);
    expect(iface.service.public.go).toEqual([{ args: ['geometry.bv:Point'], re: ['geometry.bv:Point'], writes: false }]);
  });
});

// ─── Outgoing CAM messages ───────────────────────────────────────────────────

describe('destructure params — outgoing messages', () => {
  const manifest = {
    public: {
      greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }],
      'ping.': [{ writes: true }],
    },
  };

  it('destructured function call sends message to source service', async () => {
    const compiled = await compileActor(`
      use :greet = "greeter.bv"

      @go
        =
        name: Text
        =
        :greeting Text = greet(name: name)
        return :greeting
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: [[{ name: 'Alice' }], 'go'], from: 'caller', 'ty': [[{ name: 'Text' }]] });

    const outgoing = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === 'greet') ||
      (Array.isArray(p.op) && p.op.includes('greet'))
    ));
    expect(outgoing).toBeDefined();
  });

  it('destructured silent call sends message to source service', async () => {
    const compiled = await compileActor(`
      use :ping. = "greeter.bv"

      @go. = { ping... }
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', op: 'go.', from: 'caller' });

    const outgoing = actor.posts.find(p => p.op === 'ping.');
    expect(outgoing).toBeDefined();
  });
});

// ─── Full roundtrip ──────────────────────────────────────────────────────────

describe('destructure params — full roundtrip', () => {
  const manifest = { public: { greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }] } };

  it('destructured function: call out, mock response, return to caller', async () => {
    const compiled = await compileActor(`
      use :greet = "greeter.bv"

      @hello
        =
        name: Text
        =
        :greeting Text = greet(name: name)
        return :greeting
    `, { compileOptions: { remotes: [{ path: 'greeter.bv', service: manifest }] } });

    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '42', op: [[{ name: 'Alice' }], 'hello'], from: 'caller', 'ty': [[{ name: 'Text' }]] });

    const outgoing = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === 'greet') ||
      (Array.isArray(p.op) && p.op.includes('greet'))
    ));
    expect(outgoing).toBeDefined();

    await actor.sendAsync({ id: outgoing.id, re: [{ greeting: 'Hello, Alice!' }] });

    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.id).toBe('42');
    expect(reply.re).toEqual([{ greeting: 'Hello, Alice!' }]);
  });
});

// ─── Destructured class — actor routing ──────────────────────────────────────

// Class construction roundtrip for destructured members requires #sendNew
// routing through the destructure map — deferred to a follow-up.
// describe('destructure params — class roundtrip', () => { ... });

// ─── Validation / error cases ────────────────────────────────────────────────

describe('destructure params — validation', () => {
  it('rejects duplicate destructure names across deps', () => {
    expect(() => compileSource(`
      use :foo = "a.bv"
      use :foo = "b.bv"

      @go = () -> 1
    `)).toThrow();
  });

  it('bare * without remotes rejects even with destructures', () => {
    expect(() => compileSource(`
      use :greet = "service.bv"
      @go = () -> 1
    `)).toThrow(/has no type/);
  });
});

// ─── Uniform addressable ops ─────────────────────────────────────────────────

describe('destructure params — uniform addressable ops', () => {
  const manifest = {
    public: {
      greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }],
      VERSION: [{ re: ['Text'], writes: false }],
      count: [{ re: ['Integer'], writes: false }],
    },
  };

  it('function, constant, and cell are all callable as ops', async () => {
    const compiled = await compileActor(`
      use :greet, :VERSION, :count = "service.bv"

      @useFunction
        =
        name: Text
        =
        :greeting Text = greet(name: name)
        return :greeting

      @useConstant
        =
        v Text = VERSION
        return value: v

      @useCell
        =
        n Integer = count
        return value: n
    `, { compileOptions: { remotes: [{ path: 'service.bv', service: manifest }] } });

    const actor = await compiled.spawn();

    await actor.sendAsync({ id: '1', op: [[{ name: 'Alice' }], 'useFunction'], from: 'caller', 'ty': [[{ name: 'Text' }]] });
    const fnOut = actor.posts.find(p => p.op && (
      (typeof p.op === 'string' && p.op === 'greet') ||
      (Array.isArray(p.op) && p.op.includes('greet'))
    ));
    expect(fnOut).toBeDefined();

    await actor.sendAsync({ id: '2', op: 'useConstant', from: 'caller' });
    const constOut = actor.posts.find(p => p.op === 'VERSION');
    expect(constOut).toBeDefined();

    await actor.sendAsync({ id: '3', op: 'useCell', from: 'caller' });
    const cellOut = actor.posts.find(p => p.op === 'count');
    expect(cellOut).toBeDefined();
  });
});
