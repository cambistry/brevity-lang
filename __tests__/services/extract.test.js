import { extract, compile } from '../../index.js';

// ── Basic extraction ─────────────────────────────────────────────────────────

describe('extract — basic', () => {
  it('returns ast, manifest, and useDecls', () => {
    const result = extract('@ping = -> 1 as Integer\n');
    expect(result).toHaveProperty('ast');
    expect(result).toHaveProperty('manifest');
    expect(result).toHaveProperty('useDecls');
  });

  it('manifest matches public function signatures', () => {
    const { manifest } = extract(`
      @greet = |name: Text| -> greeting: "hi" as Text
    `);
    expect(manifest.service).toBe('{\n  greet: (name: Text) -> (greeting: Text)\n}');
  });

  it('constructor appears in manifest', () => {
    const { manifest } = extract(`
      @Box = <value: Integer> {
        @get = -> value as Integer
      }
    `);
    expect(manifest.service).toContain('Box:');
    expect(manifest.service).toContain('<value: Integer>');
  });
});

// ── useDecls discovery ───────────────────────────────────────────────────────

describe('extract — useDecls', () => {
  it('discovers uses declarations', () => {
    const { useDecls } = extract(`
      uses Remote
      @fetch = |url: Text| -> response: "ok" as Text
    `);
    expect(useDecls).toEqual(['Remote']);
  });

  it('discovers multiple uses declarations', () => {
    const { useDecls } = extract(`
      uses Auth
      uses Database
      @query = |q: Text| -> result: "ok" as Text
    `);
    expect(useDecls).toEqual(['Auth', 'Database']);
  });

  it('returns empty array when no uses', () => {
    const { useDecls } = extract('@ping = -> 1 as Integer\n');
    expect(useDecls).toEqual([]);
  });
});

// ── No validation ────────────────────────────────────────────────────────────

describe('extract — no validation', () => {
  it('succeeds without remote manifests (compile would need them)', () => {
    expect(() => extract(`
      uses Remote
      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        -> :response as Text
    `)).not.toThrow();
  });
});

// ── Round-trip: extract → compile ────────────────────────────────────────────

describe('extract + compile — round-trip', () => {
  it('extract manifest from A, feed into compile of B', () => {
    const { manifest: manifestA } = extract(`
      @get
        =
        url: Text
        =
        -> response: "hello" as Text
    `);

    const { ast } = extract(`
      uses Remote

      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        -> :response as Text
    `);

    expect(() => compile(ast, { remotes: { Remote: manifestA.service } })).not.toThrow();
  });

  it('wrong arg count caught after round-trip', () => {
    const { manifest: manifestA } = extract(`
      @get = |key: Text| -> value: "v" as Text
    `);

    const { ast } = extract(`
      uses Store
      @go = { Store.get() . }
    `);

    expect(() => compile(ast, { remotes: { Store: manifestA.service } })).toThrow(/don't match/);
  });
});

// ── Round-trip with optional args ───────────────────────────────────────────

describe('extract + compile — optional args round-trip', () => {
  it('consumer can call with fewer args when manifest shows ?', () => {
    const { manifest: manifestA } = extract(`
      @greet
        =
        name: Text
        greeting: Text = "hello"
        =
        -> result: (name + " " + greeting) as Text
    `);

    // manifest should contain greeting: Text?
    expect(manifestA.service).toContain('Text?');

    const { ast } = extract(`
      uses Greeter

      @go
        =
        :result = Greeter.greet(name: "world")
        -> :result as Text
    `);

    // Should compile without error — greeting is optional in the manifest
    expect(() => compile(ast, { remotes: { Greeter: manifestA.service } })).not.toThrow();
  });

  it('consumer can call with all args when manifest shows ?', () => {
    const { manifest: manifestA } = extract(`
      @add
        =
        a Integer
        b Integer = 0
        =
        -> (a + b) as Integer
    `);

    const { ast } = extract(`
      uses Math

      @go
        =
        result Integer = Math.add(1, 2)
        -> :result
    `);

    expect(() => compile(ast, { remotes: { Math: manifestA.service } })).not.toThrow();
  });

  it('constructor with optional param in manifest', () => {
    const { manifest: manifestA } = extract(`
      @Counter = <start Integer = 0> {
        @get = -> value: start as Integer
      }
    `);

    expect(manifestA.service).toContain('Integer?');
  });
});
