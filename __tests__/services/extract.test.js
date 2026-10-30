import { extract, compile } from '../../index.js';

// ── Basic extraction ─────────────────────────────────────────────────────────

describe('extract — basic', () => {
  it('returns ast and interface', () => {
    const result = extract('@ping = -> 1\n');
    expect(result).toHaveProperty('ast');
    expect(result).toHaveProperty('interface');
  });

  it('interface separates file-level params from service', () => {
    const { interface: iface } = extract('@ping = -> 1\n');
    expect(iface.params).toBe('()');
    expect(iface.service).toBe('{\n  ping () -> (Integer)\n}');
  });
});

// ── File-level params rendering ──────────────────────────────────────────────
//
// The file-actor's construction-time inputs are rendered into `iface.params`
// in declaration order, as `( … )`: the caller-facing side of the header.
//
//   "path": { iface }              — service dependency, inline interface
//   "path": (…) -> *{ iface }      — class dependency, inline profile
//   "path": #                      — class dependency, profile from the remote
//   "path":                        — dependency, type from the remote
//   "name": Type                   — named scalar param
//   Type                           — positional scalar param
//
// Bindings are private and not surfaced: a dependency's alias or destructure,
// a positional param's name, a renamed param's local. Every named key is
// quoted (keys are paths); a positional entry is only its type.

describe('extract — params rendering', () => {
  it('service DI with inline iface renders as compact form', () => {
    const { interface: iface } = extract(`
      *
        "/db": DB { lookup (key: Text) -> (value: Text) }
      *

      @go = (key: Text) {
        :value Text = DB.lookup(:key)
        return :value
      }
    `);
    expect(iface.params).toBe('(\n  "/db": {\n    lookup (key: Text) -> (value: Text)\n  }\n)');
  });

  it('bare service DI renders as key: with no type', () => {
    const { interface: iface } = extract(`
      *
        "/db": DB
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  "/db":\n)');
  });

  it('class DI with an inline profile renders the profile', () => {
    const { interface: iface } = extract(`
      *
        "thing.bv": Thing (a: Integer) -> *{ get () -> (value: Integer) }
      *

      t = Thing(a: 5)

      @go = { :value Integer = t.get(); return :value }
    `);
    expect(iface.params).toBe('(\n  "thing.bv": (a: Integer) -> *{\n    get () -> (value: Integer)\n  }\n)');
  });

  it('bare class DI renders as #', () => {
    const { interface: iface } = extract(`
      *
        "thing.bv": Thing #
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  "thing.bv": #\n)');
  });

  it('named scalar param renders as "name": Type', () => {
    const { interface: iface } = extract(`
      *
        value: Integer
      *
      @get = -> value
    `);
    expect(iface.params).toBe('(\n  "value": Integer\n)');
  });

  it('multiple named scalar params render in order', () => {
    const { interface: iface } = extract(`
      *
        name: Text
        count: Integer
      *
      @greet = -> greeting: name as Text
    `);
    expect(iface.params).toBe('(\n  "name": Text\n  "count": Integer\n)');
  });

  it('positional scalar param renders as bare Type (binding name dropped)', () => {
    const { interface: iface } = extract(`
      *
        t Text
        n Integer
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  Text\n  Integer\n)');
  });

  it('mixed positional and named scalar params preserve order', () => {
    const { interface: iface } = extract(`
      *
        t Text
        limit: Integer
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  Text\n  "limit": Integer\n)');
  });

  it('a dependency key is always quoted', () => {
    const { interface: iface } = extract(`
      *
        "my-app.bv": App #
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  "my-app.bv": #\n)');
  });

  it('all four entry kinds mixed, declaration order preserved', () => {
    // Positional scalars must come first, before any named entries.
    const { interface: iface } = extract(`
      *
        t Text
        "/db": DB
        value: Integer
        "thing.bv": Thing #
      *
      @noop = .
    `);
    expect(iface.params).toBe(
      '(\n  Text\n  "/db":\n  "value": Integer\n  "thing.bv": #\n)',
    );
  });

  it('does not surface the local alias (DB) in params', () => {
    const { interface: iface } = extract(`
      *
        "/db": DB
      *
      @noop = .
    `);
    expect(iface.params).not.toContain('DB');
  });

  it('a renamed named param surfaces its key, not its local', () => {
    const { interface: iface } = extract(`
      *
        limit: n Integer
      *
      @get = -> n
    `);
    expect(iface.params).toBe('(\n  "limit": Integer\n)');
  });

  it('a bare-identifier key is quoted too; its destructure is not surfaced', () => {
    const { interface: iface } = extract(`
      *
        HTML: (:div, :span)
        Shapes: :Box #
      *
      @noop = .
    `);
    expect(iface.params).toBe('(\n  "HTML":\n  "Shapes": #\n)');
  });
});

// ── Basic extraction, continued ──────────────────────────────────────────────

describe('extract — basic (continued)', () => {
  it('interface matches public function signatures', () => {
    const { interface: iface } = extract(`
      @greet = (name: Text) -> greeting: "hi"
    `);
    expect(iface.service).toBe('{\n  greet (name: Text) -> (greeting: Text)\n}');
  });

  it('class appears in interface', () => {
    const { interface: iface } = extract(`
      @Box = (value: Integer) *{
        @get = -> value
      }
    `);
    expect(iface.service).toContain('Box (');
    expect(iface.service).toContain('(value: Integer) -> *{');
  });
});

// ── No validation ────────────────────────────────────────────────────────────

describe('extract — no validation', () => {
  it('succeeds without remote interfaces (compile would need them)', () => {
    expect(() => extract(`
      *
        "Remote": Remote
      *
      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        return :response as Text
    `)).not.toThrow();
  });
});

// ── Round-trip: extract → compile ────────────────────────────────────────────

describe('extract + compile — round-trip', () => {
  it('extract interface from A, feed into compile of B', () => {
    const { interface: ifaceA } = extract(`
      @get
        =
        url: Text
        =
        -> response: "hello"
    `);

    const { ast } = extract(`
      *
        "Remote": Remote
      *

      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        return :response as Text
    `);

    expect(() => compile(ast, { remotes: [{ path: 'Remote', service: ifaceA.service }] })).not.toThrow();
  });

  it('wrong arg count caught after round-trip', () => {
    const { interface: ifaceA } = extract(`
      @get = (key: Text) -> value: "v"
    `);

    const { ast } = extract(`
      *
        "Store": Store
      *
      @go = { Store.get() . }
    `);

    expect(() => compile(ast, { remotes: [{ path: 'Store', service: ifaceA.service }] })).toThrow(/don't match/);
  });
});

// ── Round-trip with optional args ───────────────────────────────────────────

describe('extract + compile — optional args round-trip', () => {
  it('consumer can call with fewer args when interface shows ?', () => {
    const { interface: ifaceA } = extract(`
      @greet
        =
        name: Text
        greeting: Text = "hello"
        =
        -> result: (name + " " + greeting)
    `);

    // interface should contain `? greeting: Text`
    expect(ifaceA.service).toContain('? greeting: Text');

    const { ast } = extract(`
      *
        "Greeter": Greeter
      *

      @go
        =
        :result = Greeter.greet(name: "world")
        return :result as Text
    `);

    // Should compile without error — greeting is optional in the interface
    expect(() => compile(ast, { remotes: [{ path: 'Greeter', service: ifaceA.service }] })).not.toThrow();
  });

  it('consumer can call with all args when interface shows ?', () => {
    const { interface: ifaceA } = extract(`
      @add
        =
        a Integer
        b Integer = 0
        =
        -> (a + b)
    `);

    const { ast } = extract(`
      *
        "Math": Math
      *

      @go
        =
        result Integer = Math.add(1, 2)
        return :result
    `);

    expect(() => compile(ast, { remotes: [{ path: 'Math', service: ifaceA.service }] })).not.toThrow();
  });

  it('class with optional param in interface', () => {
    const { interface: ifaceA } = extract(`
      @Counter = (start Integer = 0) *{
        @get = -> value: start
      }
    `);

    expect(ifaceA.service).toContain('? Integer');
  });
});

// ── Params document as a remote's constructor signature ─────────────────────

describe('params document — read back as constructor params', () => {
  const remote = extract(`
    *
      t Text
      limit: Integer
      "/db": DB
    *
    @noop = .
  `).interface;
  const consumer = (call) => extract(`
    *
      "svc.bv": Svc #
    *
    s = ${call}
    @noop = .
  `).ast;
  const remotes = [{ path: 'svc.bv', params: remote.params, service: remote.service }];

  it('accepts a call matching the positional and named params', () => {
    expect(() => compile(consumer('Svc("a", limit: 3)'), { remotes })).not.toThrow();
  });

  it('rejects a missing named param', () => {
    expect(() => compile(consumer('Svc("a")'), { remotes })).toThrow(/missing: limit/);
  });

  it('reads past multi-line dependency entries', () => {
    const typed = extract(`
      *
        "/db": DB { get (key: Text) -> (value: Text) }
        "lib.bv": Lib (a: Integer, b: Text) -> *{ ping () -> . }
        limit: lim Integer
      *
      @noop = .
    `).interface;
    expect(typed.params).toBe(
      '(\n  "/db": {\n    get (key: Text) -> (value: Text)\n  }\n' +
      '  "lib.bv": (a: Integer, b: Text) -> *{\n    ping () -> .\n  }\n  "limit": Integer\n)',
    );
    const typedRemotes = [{ path: 'svc.bv', params: typed.params, service: typed.service }];
    expect(() => compile(consumer('Svc(limit: 3)'), { remotes: typedRemotes })).not.toThrow();
    expect(() => compile(consumer('Svc()'), { remotes: typedRemotes })).toThrow(/missing: limit/);
  });

  it('rejects the retired *( … ) params document', () => {
    expect(() => compile(consumer('Svc("a", limit: 3)'), {
      remotes: [{ path: 'svc.bv', params: '*(\n  Text\n)', service: remote.service }],
    })).toThrow(/'\*\( … \)' is retired/);
  });
});
