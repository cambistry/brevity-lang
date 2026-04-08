import { extract } from '../../index.js';

// ── Single public function — varied input signatures ──────────────────────────────────

describe('service manifest — input signatures', () => {
  it('no args', () => {
    const { manifest } = extract(`
      @ping
        =
        -> 1 as Integer
    `);
    expect(manifest.service).toBe('{\n  ping: () -> (Integer)\n}');
  });

  it('single named arg', () => {
    const { manifest } = extract(`
      @greet
        =
        :name Text
        =
        -> greeting: "hi" as Text
    `);
    expect(manifest.service).toBe('{\n  greet: (:name Text) -> (:greeting Text)\n}');
  });

  it('single positional arg', () => {
    const { manifest } = extract(`
      @double
        =
        n Integer
        =
        -> n + n as Integer
    `);
    expect(manifest.service).toBe('{\n  double: (Integer) -> (Integer)\n}');
  });

  it('mixed positional and named args', () => {
    const { manifest } = extract(`
      @compute
        =
        a Integer
        :label Text
        =
        -> 0 as Integer, result: "ok" as Text
    `);
    expect(manifest.service).toBe('{\n  compute: (Integer, :label Text) -> (Integer, :result Text)\n}');
  });
});

// ── Single public function — varied -> signatures ──────────────────────────────────

describe('service manifest — -> signatures', () => {
  it('positional reply', () => {
    const { manifest } = extract(`
      @square
        =
        n Integer
        =
        -> n * n as Integer
    `);
    expect(manifest.service).toBe('{\n  square: (Integer) -> (Integer)\n}');
  });

  it('named reply', () => {
    const { manifest } = extract(`
      @lookup
        =
        :key Text
        =
        -> value: "found" as Text
    `);
    expect(manifest.service).toBe('{\n  lookup: (:key Text) -> (:value Text)\n}');
  });

  it('sigil reply', () => {
    const { manifest } = extract(`
      @echo
        =
        :msg Text
        =
        -> :msg as Text
    `);
    expect(manifest.service).toBe('{\n  echo: (:msg Text) -> (:msg Text)\n}');
  });

  it('mixed positional and named reply', () => {
    const { manifest } = extract(`
      @divide
        =
        a Integer
        b Integer
        =
        -> a / b as Integer, remainder: 0 as Integer
    `);
    expect(manifest.service).toBe('{\n  divide: (Integer, Integer) -> (Integer, :remainder Integer)\n}');
  });
});

// ── Silent public functions ───────────────────────────────────────────────────────────

describe('service manifest — silent public functions', () => {
  it('silent public function with named arg shows -> .', () => {
    const { manifest } = extract('@notify = |:msg Text| .\n');
    expect(manifest.service).toBe('{\n  notify: (:msg Text) -> .\n}');
  });

  it('silent public function with no args shows -> .', () => {
    const { manifest } = extract('@sync = .\n');
    expect(manifest.service).toBe('{\n  sync: () -> .\n}');
  });

  it('silent public function with positional arg shows -> .', () => {
    const { manifest } = extract('@fire = |n Integer| .\n');
    expect(manifest.service).toBe('{\n  fire: (Integer) -> .\n}');
  });
});

// ── Multiple public functions ─────────────────────────────────────────────────────────

describe('service manifest — multiple public functions', () => {
  it('replying and silent public functions appear in order', () => {
    const source = `
      @ping
        =
        -> 1 as Integer
      @log = |:msg Text| .
    `;
    expect(extract(source).manifest.service).toBe(
      '{\n  ping: () -> (Integer)\n  log: (:msg Text) -> .\n}',
    );
  });

  it('three public functions with distinct signatures', () => {
    const source = `
      @get
        =
        :key Text
        =
        -> value: "v" as Text
      @set = |:key Text, :value Text| .
      @count
        =
        -> 0 as Integer
    `;
    expect(extract(source).manifest.service).toBe(
      '{\n  get: (:key Text) -> (:value Text)\n  set: (:key Text, :value Text) -> .\n  count: () -> (Integer)\n}',
    );
  });

  it('overloaded public function — both variants listed', () => {
    const source = `
      @notify = |:msg Integer| .
      @notify = |:msg Text| -> ack: "noted" as Text
    `;
    expect(extract(source).manifest.service).toBe(
      '{\n  notify: (:msg Integer) -> . | (:msg Text) -> (:ack Text)\n}',
    );
  });
});

// ── Procs excluded ────────────────────────────────────────────────────────────

describe('service manifest — private function excluded', () => {
  it('function does not appear in manifest', () => {
    const source = `
      @echo
        =
        :msg Text
        =
        -> :msg as Text
      helper
        =
        n Integer
        =
        ->(result: n as Integer)
    `;
    expect(extract(source).manifest.service).toBe('{\n  echo: (:msg Text) -> (:msg Text)\n}');
  });

  it('function-only file produces empty service block', () => {
    const source = `
      helper
        =
        n Integer
        =
        ->(result: n as Integer)
    `;
    expect(extract(source).manifest.service).toBe('{\n}');
  });
});

// ── Optional args in manifest — ? suffix ────────────────────────────────────

describe('service manifest — optional args', () => {
  it('positional optional shows Type?', () => {
    const { manifest } = extract(`
      @add
        =
        a Integer
        b Integer = 0
        =
        -> (a + b) as Integer
    `);
    expect(manifest.service).toBe('{\n  add: (Integer, Integer?) -> (Integer)\n}');
  });

  it('named optional shows :name Type?', () => {
    const { manifest } = extract(`
      @greet
        =
        :name Text
        :greeting Text = "hello"
        =
        -> result: (name + greeting) as Text
    `);
    expect(manifest.service).toBe('{\n  greet: (:name Text, :greeting Text?) -> (:result Text)\n}');
  });

  it('all-optional positional params', () => {
    const { manifest } = extract(`
      @ping
        =
        retries Integer = 3
        =
        -> retries as Integer
    `);
    expect(manifest.service).toBe('{\n  ping: (Integer?) -> (Integer)\n}');
  });

  it('mixed required and optional', () => {
    const { manifest } = extract(`
      @search
        =
        :query Text
        :limit Integer = 10
        :offset Integer = 0
        =
        -> result: "ok" as Text
    `);
    expect(manifest.service).toBe('{\n  search: (:query Text, :limit Integer?, :offset Integer?) -> (:result Text)\n}');
  });

  it('inferred type from default shows in manifest', () => {
    const { manifest } = extract(`
      @compute
        =
        a Integer
        b=100
        =
        -> (a + b) as Integer
    `);
    expect(manifest.service).toBe('{\n  compute: (Integer, Integer?) -> (Integer)\n}');
  });

  it('delimited form optional arg', () => {
    const { manifest } = extract(`
      @double = |n Integer, factor Integer = 2| -> (n * factor) as Integer
    `);
    expect(manifest.service).toBe('{\n  double: (Integer, Integer?) -> (Integer)\n}');
  });

  it('silent function with optional arg', () => {
    const { manifest } = extract(`
      @notify = |:msg Text, :urgent Boolean = false| .
    `);
    expect(manifest.service).toBe('{\n  notify: (:msg Text, :urgent Boolean?) -> .\n}');
  });

  it('overloaded function — one variant has optional args', () => {
    const { manifest } = extract(`
      @fetch = |:url Text| -> response: "ok" as Text
      @fetch = |:url Text, :timeout Integer = 30| -> response: "ok" as Text
    `);
    expect(manifest.service).toBe(
      '{\n  fetch: (:url Text) -> (:response Text) | (:url Text, :timeout Integer?) -> (:response Text)\n}',
    );
  });
});
