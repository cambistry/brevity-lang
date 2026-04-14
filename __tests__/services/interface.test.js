import { extract } from '../../index.js';

// ── Single public function — varied input signatures ──────────────────────────────────

describe('service interface — input signatures', () => {
  it('no args', () => {
    const { interface: iface } = extract(`
      @ping
        =
        -> 1 as Integer
    `);
    expect(iface.service).toBe('{\n  ping: () -> (Integer)\n}');
  });

  it('single named arg', () => {
    const { interface: iface } = extract(`
      @greet
        =
        :name Text
        =
        -> greeting: "hi" as Text
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text) -> (:greeting Text)\n}');
  });

  it('single positional arg', () => {
    const { interface: iface } = extract(`
      @double
        =
        n Integer
        =
        -> n + n as Integer
    `);
    expect(iface.service).toBe('{\n  double: (Integer) -> (Integer)\n}');
  });

  it('mixed positional and named args', () => {
    const { interface: iface } = extract(`
      @compute
        =
        a Integer
        :label Text
        =
        -> 0 as Integer, result: "ok" as Text
    `);
    expect(iface.service).toBe('{\n  compute: (Integer, :label Text) -> (Integer, :result Text)\n}');
  });
});

// ── Single public function — varied -> signatures ──────────────────────────────────

describe('service interface — -> signatures', () => {
  it('positional reply', () => {
    const { interface: iface } = extract(`
      @square
        =
        n Integer
        =
        -> n * n as Integer
    `);
    expect(iface.service).toBe('{\n  square: (Integer) -> (Integer)\n}');
  });

  it('named reply', () => {
    const { interface: iface } = extract(`
      @lookup
        =
        :key Text
        =
        -> value: "found" as Text
    `);
    expect(iface.service).toBe('{\n  lookup: (:key Text) -> (:value Text)\n}');
  });

  it('sigil reply', () => {
    const { interface: iface } = extract(`
      @echo
        =
        :msg Text
        =
        -> :msg as Text
    `);
    expect(iface.service).toBe('{\n  echo: (:msg Text) -> (:msg Text)\n}');
  });

  it('mixed positional and named reply', () => {
    const { interface: iface } = extract(`
      @divide
        =
        a Integer
        b Integer
        =
        -> a / b as Integer, remainder: 0 as Integer
    `);
    expect(iface.service).toBe('{\n  divide: (Integer, Integer) -> (Integer, :remainder Integer)\n}');
  });
});

// ── Silent public functions ───────────────────────────────────────────────────────────

describe('service interface — silent public functions', () => {
  it('silent public function with named arg shows -> .', () => {
    const { interface: iface } = extract('@notify = |:msg Text| .\n');
    expect(iface.service).toBe('{\n  notify: (:msg Text) -> .\n}');
  });

  it('silent public function with no args shows -> .', () => {
    const { interface: iface } = extract('@sync = .\n');
    expect(iface.service).toBe('{\n  sync: () -> .\n}');
  });

  it('silent public function with positional arg shows -> .', () => {
    const { interface: iface } = extract('@fire = |n Integer| .\n');
    expect(iface.service).toBe('{\n  fire: (Integer) -> .\n}');
  });
});

// ── Multiple public functions ─────────────────────────────────────────────────────────

describe('service interface — multiple public functions', () => {
  it('replying and silent public functions appear in order', () => {
    const source = `
      @ping
        =
        -> 1 as Integer
      @log = |:msg Text| .
    `;
    expect(extract(source).interface.service).toBe(
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
    expect(extract(source).interface.service).toBe(
      '{\n  get: (:key Text) -> (:value Text)\n  set: (:key Text, :value Text) -> .\n  count: () -> (Integer)\n}',
    );
  });

  it('overloaded public function — both variants listed', () => {
    const source = `
      @notify = |:msg Integer| .
      @notify = |:msg Text| -> ack: "noted" as Text
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  notify: (:msg Integer) -> . | (:msg Text) -> (:ack Text)\n}',
    );
  });
});

// ── Procs excluded ────────────────────────────────────────────────────────────

describe('service interface — private function excluded', () => {
  it('function does not appear in iface', () => {
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
    expect(extract(source).interface.service).toBe('{\n  echo: (:msg Text) -> (:msg Text)\n}');
  });

  it('function-only file produces empty service block', () => {
    const source = `
      helper
        =
        n Integer
        =
        ->(result: n as Integer)
    `;
    expect(extract(source).interface.service).toBe('{\n}');
  });
});

// ── Optional args in iface — ? suffix ────────────────────────────────────

describe('service interface — optional args', () => {
  it('positional optional shows Type?', () => {
    const { interface: iface } = extract(`
      @add
        =
        a Integer
        b Integer = 0
        =
        -> (a + b) as Integer
    `);
    expect(iface.service).toBe('{\n  add: (Integer, Integer?) -> (Integer)\n}');
  });

  it('named optional shows :name Type?', () => {
    const { interface: iface } = extract(`
      @greet
        =
        :name Text
        :greeting Text = "hello"
        =
        -> result: (name + greeting) as Text
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text, :greeting Text?) -> (:result Text)\n}');
  });

  it('all-optional positional params', () => {
    const { interface: iface } = extract(`
      @ping
        =
        retries Integer = 3
        =
        -> retries as Integer
    `);
    expect(iface.service).toBe('{\n  ping: (Integer?) -> (Integer)\n}');
  });

  it('mixed required and optional', () => {
    const { interface: iface } = extract(`
      @search
        =
        :query Text
        :limit Integer = 10
        :offset Integer = 0
        =
        -> result: "ok" as Text
    `);
    expect(iface.service).toBe('{\n  search: (:query Text, :limit Integer?, :offset Integer?) -> (:result Text)\n}');
  });

  it('inferred type from default shows in iface', () => {
    const { interface: iface } = extract(`
      @compute
        =
        a Integer
        b=100
        =
        -> (a + b) as Integer
    `);
    expect(iface.service).toBe('{\n  compute: (Integer, Integer?) -> (Integer)\n}');
  });

  it('delimited form optional arg', () => {
    const { interface: iface } = extract(`
      @double = |n Integer, factor Integer = 2| -> (n * factor) as Integer
    `);
    expect(iface.service).toBe('{\n  double: (Integer, Integer?) -> (Integer)\n}');
  });

  it('silent function with optional arg', () => {
    const { interface: iface } = extract(`
      @notify = |:msg Text, :urgent Boolean = false| .
    `);
    expect(iface.service).toBe('{\n  notify: (:msg Text, :urgent Boolean?) -> .\n}');
  });

  it('overloaded function — one variant has optional args', () => {
    const { interface: iface } = extract(`
      @fetch = |:url Text| -> response: "ok" as Text
      @fetch = |:url Text, :timeout Integer = 30| -> response: "ok" as Text
    `);
    expect(iface.service).toBe(
      '{\n  fetch: (:url Text) -> (:response Text) | (:url Text, :timeout Integer?) -> (:response Text)\n}',
    );
  });
});

// ── Public ref-cell accessors (auto-generated getter + setter) ────────────────

describe('service interface — public refs (@name *Type)', () => {
  it('integer ref produces getter and setter', () => {
    const { interface: iface } = extract('@val *Integer = 0\n');
    expect(iface.service).toBe('{\n  val: () -> (Integer)\n  set val: (Integer) -> .\n}');
  });

  it('text ref produces getter and setter', () => {
    const { interface: iface } = extract('@name *Text = ""\n');
    expect(iface.service).toBe('{\n  name: () -> (Text)\n  set name: (Text) -> .\n}');
  });

  it('boolean ref produces getter and setter', () => {
    const { interface: iface } = extract('@flag *Boolean = false\n');
    expect(iface.service).toBe('{\n  flag: () -> (Boolean)\n  set flag: (Boolean) -> .\n}');
  });

  it('multiple refs — declaration order, grouped by field', () => {
    const source = `
      @a *Integer = 0
      @b *Text = ""
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  a: () -> (Integer)\n  set a: (Integer) -> .\n  b: () -> (Text)\n  set b: (Text) -> .\n}',
    );
  });
});

// ── Public constants (auto getter only) ───────────────────────────────────────

describe('service interface — public constants (@name = value)', () => {
  it('text literal constant — getter only, type inferred', () => {
    const { interface: iface } = extract('@magic = "magic_string"\n');
    expect(iface.service).toBe('{\n  magic: () -> (Text)\n}');
  });

  it('integer literal constant', () => {
    const { interface: iface } = extract('@answer = 42\n');
    expect(iface.service).toBe('{\n  answer: () -> (Integer)\n}');
  });

  it('boolean literal constant', () => {
    const { interface: iface } = extract('@yes = true\n');
    expect(iface.service).toBe('{\n  yes: () -> (Boolean)\n}');
  });

  it('constructor-initialized constant', () => {
    const { interface: iface } = extract('@t = Text("x")\n');
    expect(iface.service).toBe('{\n  t: () -> (Text)\n}');
  });
});

// ── Mixed: refs, constants, and handlers interleave in declaration order ─────

describe('service interface — mixed field and handler decls', () => {
  it('fields and handlers interleave in declaration order; per-field grouped', () => {
    const source = `
      @val *Integer = 0
      @greet = |:name Text| -> msg: "hi" as Text
      @magic = "abc"
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  val: () -> (Integer)\n  set val: (Integer) -> .\n  greet: (:name Text) -> (:msg Text)\n  magic: () -> (Text)\n}',
    );
  });
});
