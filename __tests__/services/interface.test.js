import { extract } from '../../index.js';

// ── Single public function — varied input signatures ──────────────────────────────────

describe('service interface — input signatures', () => {
  it('no args', () => {
    const { interface: iface } = extract(`
      @ping
        =
        -> 1
    `);
    expect(iface.service).toBe('{\n  ping: () -> (Integer)\n}');
  });

  it('single named arg', () => {
    const { interface: iface } = extract(`
      @greet
        =
        :name Text
        =
        -> greeting: "hi"
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text) -> (:greeting Text)\n}');
  });

  it('single positional arg', () => {
    const { interface: iface } = extract(`
      @double
        =
        n Integer
        =
        -> n + n
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
        -> 0, result: "ok"
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
        -> n * n
    `);
    expect(iface.service).toBe('{\n  square: (Integer) -> (Integer)\n}');
  });

  it('named reply', () => {
    const { interface: iface } = extract(`
      @lookup
        =
        :key Text
        =
        -> value: "found"
    `);
    expect(iface.service).toBe('{\n  lookup: (:key Text) -> (:value Text)\n}');
  });

  it('sigil reply', () => {
    const { interface: iface } = extract(`
      @echo
        =
        :msg Text
        =
        -> :msg
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
        -> a / b, remainder: 0
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
        -> 1
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
        -> value: "v"
      @set = |:key Text, :value Text| .
      @count
        =
        -> 0
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  get: (:key Text) -> (:value Text)\n  set: (:key Text, :value Text) -> .\n  count: () -> (Integer)\n}',
    );
  });

  it('overloaded public function — both variants listed', () => {
    const source = `
      @notify = |:msg Integer| .
      @notify = |:msg Text| -> ack: "noted"
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
        -> :msg
      helper
        =
        n Integer
        =
        ->(result: n)
    `;
    expect(extract(source).interface.service).toBe('{\n  echo: (:msg Text) -> (:msg Text)\n}');
  });

  it('function-only file produces empty service block', () => {
    const source = `
      helper
        =
        n Integer
        =
        ->(result: n)
    `;
    expect(extract(source).interface.service).toBe('{\n}');
  });
});

// ── Optional args in iface — `? ` slot prefix ────────────────────────────

describe('service interface — optional args', () => {
  it('positional optional shows ? Type', () => {
    const { interface: iface } = extract(`
      @add
        =
        a Integer
        b Integer = 0
        =
        -> (a + b)
    `);
    expect(iface.service).toBe('{\n  add: (Integer, ? Integer) -> (Integer)\n}');
  });

  it('named optional shows ? :name Type', () => {
    const { interface: iface } = extract(`
      @greet
        =
        :name Text
        :greeting Text = "hello"
        =
        -> result: (name + greeting)
    `);
    expect(iface.service).toBe('{\n  greet: (:name Text, ? :greeting Text) -> (:result Text)\n}');
  });

  it('all-optional positional params', () => {
    const { interface: iface } = extract(`
      @ping
        =
        retries Integer = 3
        =
        -> retries
    `);
    expect(iface.service).toBe('{\n  ping: (? Integer) -> (Integer)\n}');
  });

  it('mixed required and optional', () => {
    const { interface: iface } = extract(`
      @search
        =
        :query Text
        :limit Integer = 10
        :offset Integer = 0
        =
        -> result: "ok"
    `);
    expect(iface.service).toBe('{\n  search: (:query Text, ? :limit Integer, ? :offset Integer) -> (:result Text)\n}');
  });

  it('inferred type from default shows in iface', () => {
    const { interface: iface } = extract(`
      @compute
        =
        a Integer
        b=100
        =
        -> (a + b)
    `);
    expect(iface.service).toBe('{\n  compute: (Integer, ? Integer) -> (Integer)\n}');
  });

  it('delimited form optional arg', () => {
    const { interface: iface } = extract(`
      @double = |n Integer, factor Integer = 2| -> (n * factor)
    `);
    expect(iface.service).toBe('{\n  double: (Integer, ? Integer) -> (Integer)\n}');
  });

  it('silent function with optional arg', () => {
    const { interface: iface } = extract(`
      @notify = |:msg Text, :urgent Boolean = false| .
    `);
    expect(iface.service).toBe('{\n  notify: (:msg Text, ? :urgent Boolean) -> .\n}');
  });

  it('overloaded function — one variant has optional args', () => {
    const { interface: iface } = extract(`
      @fetch = |:url Text| -> response: "ok"
      @fetch = |:url Text, :timeout Integer = 30| -> response: "ok"
    `);
    expect(iface.service).toBe(
      '{\n  fetch: (:url Text) -> (:response Text) | (:url Text, ? :timeout Integer) -> (:response Text)\n}',
    );
  });
});

// ── Public ref-cell accessors (auto-generated getter + setter) ────────────────

describe('service interface — public refs (@name Type!)', () => {
  it('integer ref compresses to Integer!', () => {
    const { interface: iface } = extract('@val Integer! = 0\n');
    expect(iface.service).toBe('{\n  val: Integer!\n}');
  });

  it('text ref compresses to Text!', () => {
    const { interface: iface } = extract('@name Text! = ""\n');
    expect(iface.service).toBe('{\n  name: Text!\n}');
  });

  it('boolean ref compresses to Boolean!', () => {
    const { interface: iface } = extract('@flag Boolean! = false\n');
    expect(iface.service).toBe('{\n  flag: Boolean!\n}');
  });

  it('multiple refs — declaration order, each compressed', () => {
    const source = `
      @a Integer! = 0
      @b Text! = ""
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  a: Integer!\n  b: Text!\n}',
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
      @val Integer! = 0
      @greet = |:name Text| -> msg: "hi"
      @magic = "abc"
    `;
    expect(extract(source).interface.service).toBe(
      '{\n  val: Integer!\n  greet: (:name Text) -> (:msg Text)\n  magic: () -> (Text)\n}',
    );
  });
});

// ── Imported types resolve to backtick-quoted addresses ─────────────────────

describe('service interface — imported type address resolution', () => {
  it('return type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      < "/services/pair": (Pair) >

      @get
        =
        -> Pair(key: "a", value: "b") as Pair
    `);
    expect(iface.service).toBe('{\n  get: () -> (`/services/pair`)\n}');
  });

  it('parameter type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      < "/services/pair": (Pair) >

      @accept = |p Pair| .
    `);
    expect(iface.service).toBe('{\n  accept: (`/services/pair`) -> .\n}');
  });

  it('named parameter type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      < "/services/pair": (Pair) >

      @accept = |:item Pair| .
    `);
    expect(iface.service).toBe('{\n  accept: (:item `/services/pair`) -> .\n}');
  });

  it('built-in types remain unqualified alongside imported types', () => {
    const { interface: iface } = extract(`
      < "/services/pair": (Pair) >

      @process
        =
        :label Text
        p Pair
        =
        -> count: 1
    `);
    expect(iface.service).toBe('{\n  process: (:label Text, `/services/pair`) -> (:count Integer)\n}');
  });

  it('List of imported type resolves inner type', () => {
    const { interface: iface } = extract(`
      < "/models/item": (Item) >

      @list
        =
        -> items as List of Item
    `);
    expect(iface.service).toBe('{\n  list: () -> (List of `/models/item`)\n}');
  });

  it('imported type with | null suffix', () => {
    const { interface: iface } = extract(`
      < "/models/item": (Item) >

      @find
        =
        :key Text
        =
        -> result as Item | null
    `);
    expect(iface.service).toBe('{\n  find: (:key Text) -> (`/models/item` | null)\n}');
  });

  it('multiple dependencies resolve independently', () => {
    const { interface: iface } = extract(`
      <
        "/models/user": (User)
        "/models/session": (Session)
      >

      @login
        =
        u User
        =
        -> s as Session
    `);
    expect(iface.service).toBe('{\n  login: (`/models/user`) -> (`/models/session`)\n}');
  });

  it('dependency with inline constraint resolves type in interface', () => {
    const { interface: iface } = extract(`
      < "/services/db": (DB) { lookup: (:key Text) -> (:value Text) } >

      @query
        =
        :db DB
        =
        -> result: "ok"
    `);
    expect(iface.service).toBe('{\n  query: (:db `/services/db`) -> (:result Text)\n}');
  });

  it('member type via dot-access resolves as path.Member', () => {
    const { interface: iface } = extract(`
      < "geometry.bv": (Geo) >

      @assign = |p Geo.Point| .
    `);
    expect(iface.service).toBe('{\n  assign: (`geometry.bv`.Point) -> .\n}');
  });

  it('member type in return position resolves as path.Member', () => {
    const { interface: iface } = extract(`
      < "geometry.bv": (Geo) >

      @make
        =
        -> Geo.Point(1, 2) as Geo.Point
    `);
    expect(iface.service).toBe('{\n  make: () -> (`geometry.bv`.Point)\n}');
  });

  it('member type with named param resolves as path.Member', () => {
    const { interface: iface } = extract(`
      < "geometry.bv": (Geo) >

      @move = |:point Geo.Point, :dx Integer| .
    `);
    expect(iface.service).toBe('{\n  move: (:point `geometry.bv`.Point, :dx Integer) -> .\n}');
  });

  it('constant of imported type resolves in getter', () => {
    const { interface: iface } = extract(`
      < "/models/config": (Config) >

      @current = Config()
    `);
    expect(iface.service).toBe('{\n  current: () -> (`/models/config`)\n}');
  });
});

// ── self-as declarations surface in service interface ─────────────────────

describe('service interface — self-as declarations', () => {
  it('single self-as type appended after service block', () => {
    const { interface: iface } = extract(`
      self as Integer = -> 100
      @get
        =
        -> 1
    `);
    expect(iface.service).toBe('{\n  get: () -> (Integer)\n} | Integer');
  });

  it('multiple self-as types appended in declaration order', () => {
    const { interface: iface } = extract(`
      self as Text = -> "one hundred"
      self as Integer = -> 100
      @get
        =
        -> num: 100
    `);
    expect(iface.service).toBe('{\n  get: () -> (:num Integer)\n} | Text | Integer');
  });

  it('self-as with no public handlers', () => {
    const { interface: iface } = extract(`
      self as Integer = -> 42
    `);
    expect(iface.service).toBe('{\n} | Integer');
  });

  it('negated self-as excluded from interface', () => {
    const { interface: iface } = extract(`
      self as !Wrapper = -> 0
      @ping = -> pong: "ok"
    `);
    expect(iface.service).toBe('{\n  ping: () -> (:pong Text)\n}');
  });

  it('mixed positive and negated — only positive types listed', () => {
    const { interface: iface } = extract(`
      self as Integer = -> 42
      self as !Fallback = -> 0
      @ping = -> pong: "ok"
    `);
    expect(iface.service).toBe('{\n  ping: () -> (:pong Text)\n} | Integer');
  });

  it('self-as with imported type resolves to backtick address', () => {
    const { interface: iface } = extract(`
      < "/models/token": (Token) >

      self as Token = -> Token()
      @get
        =
        -> 1
    `);
    expect(iface.service).toBe('{\n  get: () -> (Integer)\n} | `/models/token`');
  });
});
