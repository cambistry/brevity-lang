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
    expect(iface.params).toBe('<>');
    expect(iface.service).toBe('{\n  ping: () -> (Integer)\n}');
  });
});

// ── File-level params rendering ──────────────────────────────────────────────
//
// The file-actor's construction-time inputs are rendered into `iface.params`
// in declaration order, using a compact form:
//
//   :path           — service injection (replaces { ...iface })
//   :path #         — constructor injection (replaces <...> -> { ...iface })
//   :name Type      — named scalar param
//   Type            — positional scalar param
//
// Paths containing any non-word character are quoted: `:"/db"`
// Identifier paths are bare:                           `:db`
// The local alias (e.g. `(DB)`) is NOT surfaced in params.

describe('extract — params rendering', () => {
  it('service DI with inline iface renders as compact form', () => {
    const { interface: iface } = extract(`
      < "/db": (DB) { lookup: (:key Text) -> (:value Text) } >

      @go = |:key Text| {
        :value Text = DB.lookup(:key)
        -> :value
      }
    `);
    expect(iface.params).toBe('<\n  :"/db"\n>');
  });

  it('bare service DI renders with no sigil', () => {
    const { interface: iface } = extract(`
      < "/db": (DB) >
      @noop = .
    `);
    expect(iface.params).toBe('<\n  :"/db"\n>');
  });

  it('constructor DI with inline ctor+iface renders as compact #', () => {
    const { interface: iface } = extract(`
      < "thing.bv": (Thing) <:a Integer> -> { get: () -> (:value Integer) } >

      t = Thing(a: 5)

      @go = { :value Integer = t.get(); -> :value }
    `);
    expect(iface.params).toBe('<\n  :"thing.bv" #\n>');
  });

  it('bare constructor DI # renders as compact #', () => {
    const { interface: iface } = extract(`
      < "thing.bv": (Thing) # >
      @noop = .
    `);
    expect(iface.params).toBe('<\n  :"thing.bv" #\n>');
  });

  it('named scalar param renders as :name Type', () => {
    const { interface: iface } = extract(`
      < :value Integer >
      @get = -> value
    `);
    expect(iface.params).toBe('<\n  :value Integer\n>');
  });

  it('multiple named scalar params render in order', () => {
    const { interface: iface } = extract(`
      <
        :name Text
        :count Integer
      >
      @greet = -> greeting: name as Text
    `);
    expect(iface.params).toBe('<\n  :name Text\n  :count Integer\n>');
  });

  it('positional scalar param renders as bare Type (binding name dropped)', () => {
    const { interface: iface } = extract(`
      <
        t Text
        n Integer
      >
      @noop = .
    `);
    expect(iface.params).toBe('<\n  Text\n  Integer\n>');
  });

  it('mixed positional and named scalar params preserve order', () => {
    const { interface: iface } = extract(`
      <
        t Text
        :limit Integer
      >
      @noop = .
    `);
    expect(iface.params).toBe('<\n  Text\n  :limit Integer\n>');
  });

  it('path with non-word char quotes in rendered params', () => {
    const { interface: iface } = extract(`
      < "my-app.bv": (App) # >
      @noop = .
    `);
    expect(iface.params).toBe('<\n  :"my-app.bv" #\n>');
  });

  it('all four entry kinds mixed, declaration order preserved', () => {
    // Positional scalars must come first, before any named entries.
    const { interface: iface } = extract(`
      <
        t Text
        "/db": (DB)
        :value Integer
        "thing.bv": (Thing) #
      >
      @noop = .
    `);
    expect(iface.params).toBe(
      '<\n  Text\n  :"/db"\n  :value Integer\n  :"thing.bv" #\n>',
    );
  });

  it('does not surface the local alias (DB) in params', () => {
    const { interface: iface } = extract(`
      < "/db": (DB) >
      @noop = .
    `);
    expect(iface.params).not.toContain('DB');
    expect(iface.params).not.toContain('(');
  });
});

// ── Basic extraction, continued ──────────────────────────────────────────────

describe('extract — basic (continued)', () => {
  it('interface matches public function signatures', () => {
    const { interface: iface } = extract(`
      @greet = |:name Text| -> greeting: "hi"
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text) -> (:greeting Text)\n}');
  });

  it('constructor appears in interface', () => {
    const { interface: iface } = extract(`
      @Box = <:value Integer> {
        @get = -> value
      }
    `);
    expect(iface.service).toContain('Box:');
    expect(iface.service).toContain('<:value Integer>');
  });
});

// ── No validation ────────────────────────────────────────────────────────────

describe('extract — no validation', () => {
  it('succeeds without remote interfaces (compile would need them)', () => {
    expect(() => extract(`
      < "Remote": (Remote) >
      @fetch
        =
        :url Text
        =
        :response = Remote.get(:url)
        -> :response as Text
    `)).not.toThrow();
  });
});

// ── Round-trip: extract → compile ────────────────────────────────────────────

describe('extract + compile — round-trip', () => {
  it('extract interface from A, feed into compile of B', () => {
    const { interface: ifaceA } = extract(`
      @get
        =
        :url Text
        =
        -> response: "hello"
    `);

    const { ast } = extract(`
      < "Remote": (Remote) >

      @fetch
        =
        :url Text
        =
        :response = Remote.get(:url)
        -> :response as Text
    `);

    expect(() => compile(ast, { remotes: [{ path: 'Remote', service: ifaceA.service }] })).not.toThrow();
  });

  it('wrong arg count caught after round-trip', () => {
    const { interface: ifaceA } = extract(`
      @get = |:key Text| -> value: "v"
    `);

    const { ast } = extract(`
      < "Store": (Store) >
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
        :name Text
        :greeting Text = "hello"
        =
        -> result: (name + " " + greeting)
    `);

    // interface should contain :greeting Text?
    expect(ifaceA.service).toContain('Text?');

    const { ast } = extract(`
      < "Greeter": (Greeter) >

      @go
        =
        :result = Greeter.greet(name: "world")
        -> :result as Text
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
      < "Math": (Math) >

      @go
        =
        result Integer = Math.add(1, 2)
        -> :result
    `);

    expect(() => compile(ast, { remotes: [{ path: 'Math', service: ifaceA.service }] })).not.toThrow();
  });

  it('constructor with optional param in interface', () => {
    const { interface: ifaceA } = extract(`
      @Counter = <start Integer = 0> {
        @get = -> value: start
      }
    `);

    expect(ifaceA.service).toContain('Integer?');
  });
});
