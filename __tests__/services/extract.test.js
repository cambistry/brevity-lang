import { extract, compile } from '../../index.js';

// ── Basic extraction ─────────────────────────────────────────────────────────

describe('extract — basic', () => {
  it('returns ast, interface, and dependencies', () => {
    const result = extract('@ping = -> 1 as Integer\n');
    expect(result).toHaveProperty('ast');
    expect(result).toHaveProperty('interface');
    expect(result).toHaveProperty('dependencies');
  });

  it('interface matches public function signatures', () => {
    const { interface: iface } = extract(`
      @greet = |:name Text| -> greeting: "hi" as Text
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text) -> (:greeting Text)\n}');
  });

  it('constructor appears in interface', () => {
    const { interface: iface } = extract(`
      @Box = <:value Integer> {
        @get = -> value as Integer
      }
    `);
    expect(iface.service).toContain('Box:');
    expect(iface.service).toContain('<:value Integer>');
  });
});

// ── dependencies discovery ───────────────────────────────────────────────────

describe('extract — dependencies', () => {
  it('discovers a single dependency', () => {
    const { dependencies } = extract(`
      < "Remote": (Remote) { get: (:url Text) -> (:response Text) } >
      @fetch = |:url Text| -> response: "ok" as Text
    `);
    expect(dependencies).toEqual(['Remote']);
  });

  it('discovers multiple dependencies', () => {
    const { dependencies } = extract(`
      <
        "Auth": (Auth) { check: (:token Text) -> (:ok Boolean) }
        "Database": (Database) { query: (:q Text) -> (:result Text) }
      >
      @query = |:q Text| -> result: "ok" as Text
    `);
    expect(dependencies).toEqual(['Auth', 'Database']);
  });

  it('returns empty array when no dependencies', () => {
    const { dependencies } = extract('@ping = -> 1 as Integer\n');
    expect(dependencies).toEqual([]);
  });
});

// ── No validation ────────────────────────────────────────────────────────────

describe('extract — no validation', () => {
  it('succeeds without remote interfaces (compile would need them)', () => {
    expect(() => extract(`
      < "Remote": (Remote) * >
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
        -> response: "hello" as Text
    `);

    const { ast } = extract(`
      < "Remote": (Remote) * >

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
      @get = |:key Text| -> value: "v" as Text
    `);

    const { ast } = extract(`
      < "Store": (Store) * >
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
        -> result: (name + " " + greeting) as Text
    `);

    // interface should contain :greeting Text?
    expect(ifaceA.service).toContain('Text?');

    const { ast } = extract(`
      < "Greeter": (Greeter) * >

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
        -> (a + b) as Integer
    `);

    const { ast } = extract(`
      < "Math": (Math) * >

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
        @get = -> value: start as Integer
      }
    `);

    expect(ifaceA.service).toContain('Integer?');
  });
});
