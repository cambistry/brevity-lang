import { extract } from '../../index.js';

// ── Single public function — varied input signatures ──────────────────────────────────

describe('service interface — input signatures', () => {
  it('no args', () => {
    const { interface: iface } = extract(`
      @ping
        =
        return 1
    `);
    expect(iface.service).toEqual({ public: { ping: [{ re: ['Integer'], writes: false }] } });
  });

  it('single named arg', () => {
    const { interface: iface } = extract(`
      @greet
        =
        name: Text
        =
        return greeting: "hi"
    `);
    expect(iface.service).toEqual({
      public: { greet: [{ args: [{ name: 'Text' }], re: [{ greeting: 'Text' }], writes: false }] },
    });
  });

  it('single positional arg', () => {
    const { interface: iface } = extract(`
      @double
        =
        n Integer
        =
        return n + n
    `);
    expect(iface.service).toEqual({ public: { double: [{ args: ['Integer'], re: ['Integer'], writes: false }] } });
  });

  it('mixed positional and named args', () => {
    const { interface: iface } = extract(`
      @compute
        =
        a Integer
        label: Text
        =
        return 0, result: "ok"
    `);
    expect(iface.service).toEqual({
      public: {
        compute: [
          {
            args: ['Integer', { label: 'Text' }],
            re: ['Integer', { result: 'Text' }],
            writes: false,
          },
        ],
      },
    });
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
        return n * n
    `);
    expect(iface.service).toEqual({ public: { square: [{ args: ['Integer'], re: ['Integer'], writes: false }] } });
  });

  it('named reply', () => {
    const { interface: iface } = extract(`
      @lookup
        =
        key: Text
        =
        return value: "found"
    `);
    expect(iface.service).toEqual({ public: { lookup: [{ args: [{ key: 'Text' }], re: [{ value: 'Text' }], writes: false }] } });
  });

  it('sigil reply', () => {
    const { interface: iface } = extract(`
      @echo
        =
        msg: Text
        =
        return :msg
    `);
    expect(iface.service).toEqual({ public: { echo: [{ args: [{ msg: 'Text' }], re: [{ msg: 'Text' }], writes: false }] } });
  });

  it('mixed positional and named reply', () => {
    const { interface: iface } = extract(`
      @divide
        =
        a Integer
        b Integer
        =
        return a / b, remainder: 0
    `);
    expect(iface.service).toEqual({
      public: {
        divide: [
          {
            args: ['Integer', 'Integer'],
            re: ['Integer', { remainder: 'Integer' }],
            writes: false,
          },
        ],
      },
    });
  });
});

// ── Silent public functions ───────────────────────────────────────────────────────────

describe('service interface — silent public functions', () => {
  it('silent public function with named arg shows -> .', () => {
    const { interface: iface } = extract('@notify. = (msg: Text) {}\n');
    expect(iface.service).toEqual({ public: { 'notify.': [{ args: [{ msg: 'Text' }], writes: true }] } });
  });

  it('silent public function with no args shows -> .', () => {
    const { interface: iface } = extract('@sync. = {}\n');
    expect(iface.service).toEqual({ public: { 'sync.': [{ writes: true }] } });
  });

  it('silent public function with positional arg shows -> .', () => {
    const { interface: iface } = extract('@fire. = (n Integer) {}\n');
    expect(iface.service).toEqual({ public: { 'fire.': [{ args: ['Integer'], writes: true }] } });
  });
});

// ── Multiple public functions ─────────────────────────────────────────────────────────

describe('service interface — multiple public functions', () => {
  it('replying and silent public functions appear in order', () => {
    const source = `
      @ping
        =
        return 1
      @log. = (msg: Text) {}
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: {
          ping: [{ re: ['Integer'], writes: false }],
          'log.': [{ args: [{ msg: 'Text' }], writes: true }],
        },
      },
    );
  });

  it('three public functions with distinct signatures', () => {
    const source = `
      @get
        =
        key: Text
        =
        return value: "v"
      @set. = (key: Text, value: Text) {}
      @count
        =
        return 0
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: {
          get: [{ args: [{ key: 'Text' }], re: [{ value: 'Text' }], writes: false }],
          'set.': [{ args: [{ key: 'Text', value: 'Text' }], writes: true }],
          count: [{ re: ['Integer'], writes: false }],
        },
      },
    );
  });

  it('overloaded public function — both variants listed', () => {
    const source = `
      @notify. = (msg: Integer) {}
      @notify = (msg: Text) -> ack: "noted"
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: {
          'notify.': [{ args: [{ msg: 'Integer' }], writes: true }],
          notify: [{ args: [{ msg: 'Text' }], re: [{ ack: 'Text' }], writes: false }],
        },
      },
    );
  });
});

// ── Procs excluded ────────────────────────────────────────────────────────────

describe('service interface — private function excluded', () => {
  it('function does not appear in iface', () => {
    const source = `
      @echo
        =
        msg: Text
        =
        return :msg
      helper
        =
        n Integer
        =
        return (result: n)
    `;
    expect(extract(source).interface.service).toEqual({ public: { echo: [{ args: [{ msg: 'Text' }], re: [{ msg: 'Text' }], writes: false }] } });
  });

  it('function-only file produces empty service interface', () => {
    const source = `
      helper
        =
        n Integer
        =
        return (result: n)
    `;
    expect(extract(source).interface.service).toEqual({});
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
        return (a + b)
    `);
    expect(iface.service).toEqual({
      public: { add: [{ args: ['Integer', { '%opt': 'Integer' }], re: ['Integer'], writes: false }] },
    });
  });

  it('named optional shows ? name: Type', () => {
    const { interface: iface } = extract(`
      @greet
        =
        name: Text
        greeting: Text = "hello"
        =
        return result: (name + greeting)
    `);
    expect(iface.service).toEqual({
      public: {
        greet: [
          {
            args: [{ name: 'Text', greeting: { '%opt': 'Text' } }],
            re: [{ result: 'Text' }],
            writes: false,
          },
        ],
      },
    });
  });

  it('all-optional positional params', () => {
    const { interface: iface } = extract(`
      @ping
        =
        retries Integer = 3
        =
        return retries
    `);
    expect(iface.service).toEqual({ public: { ping: [{ args: [{ '%opt': 'Integer' }], re: ['Integer'], writes: false }] } });
  });

  it('mixed required and optional', () => {
    const { interface: iface } = extract(`
      @search
        =
        query: Text
        limit: Integer = 10
        offset: Integer = 0
        =
        return result: "ok"
    `);
    expect(iface.service).toEqual({
      public: {
        search: [
          {
            args: [{ query: 'Text', limit: { '%opt': 'Integer' }, offset: { '%opt': 'Integer' } }],
            re: [{ result: 'Text' }],
            writes: false,
          },
        ],
      },
    });
  });

  it('inferred type from default shows in iface', () => {
    const { interface: iface } = extract(`
      @compute
        =
        a Integer
        b=100
        =
        return (a + b)
    `);
    expect(iface.service).toEqual({
      public: { compute: [{ args: ['Integer', { '%opt': 'Integer' }], re: ['Integer'], writes: false }] },
    });
  });

  it('delimited form optional arg', () => {
    const { interface: iface } = extract(`
      @double = (n Integer, factor Integer = 2) -> (n * factor)
    `);
    expect(iface.service).toEqual({
      public: { double: [{ args: ['Integer', { '%opt': 'Integer' }], re: ['Integer'], writes: false }] },
    });
  });

  it('silent function with optional arg', () => {
    const { interface: iface } = extract(`
      @notify. = (msg: Text, urgent: Boolean = false) {}
    `);
    expect(iface.service).toEqual({
      public: { 'notify.': [{ args: [{ msg: 'Text', urgent: { '%opt': 'Boolean' } }], writes: true }] },
    });
  });

  it('overloaded function — one variant has optional args', () => {
    const { interface: iface } = extract(`
      @fetch = (url: Text) -> response: "ok"
      @fetch = (url: Text, timeout: Integer = 30) -> response: "ok"
    `);
    expect(iface.service).toEqual(
      {
        public: {
          fetch: [
            { args: [{ url: 'Text' }], re: [{ response: 'Text' }], writes: false },
            {
              args: [{ url: 'Text', timeout: { '%opt': 'Integer' } }],
              re: [{ response: 'Text' }],
              writes: false,
            },
          ],
        },
      },
    );
  });
});

// ── Public ref-cell accessors (auto-generated getter + setter) ────────────────

describe('service interface — public refs (@name *Type)', () => {
  it('integer ref compresses to *Integer', () => {
    const { interface: iface } = extract('@val *Integer = 0\n');
    expect(iface.service).toEqual({
      public: { val: [{ re: ['Integer'], writes: false }] },
      ':val': {
        public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
      },
    });
  });

  it('text ref compresses to *Text', () => {
    const { interface: iface } = extract('@name *Text = ""\n');
    expect(iface.service).toEqual({
      public: { name: [{ re: ['Text'], writes: false }] },
      ':name': {
        public: { $get: [{ re: ['Text'], writes: false }], $set: [{ args: ['Text'], writes: true }] },
      },
    });
  });

  it('boolean ref compresses to *Boolean', () => {
    const { interface: iface } = extract('@flag *Boolean = false\n');
    expect(iface.service).toEqual({
      public: { flag: [{ re: ['Boolean'], writes: false }] },
      ':flag': {
        public: { $get: [{ re: ['Boolean'], writes: false }], $set: [{ args: ['Boolean'], writes: true }] },
      },
    });
  });

  it('multiple refs — declaration order, each compressed', () => {
    const source = `
      @a *Integer = 0
      @b *Text = ""
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: { a: [{ re: ['Integer'], writes: false }], b: [{ re: ['Text'], writes: false }] },
        ':a': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
        ':b': {
          public: { $get: [{ re: ['Text'], writes: false }], $set: [{ args: ['Text'], writes: true }] },
        },
      },
    );
  });
});

// ── Public constants (auto getter only) ───────────────────────────────────────

describe('service interface — public constants (@name = value)', () => {
  it('text literal constant — getter only, type inferred', () => {
    const { interface: iface } = extract('@magic = "magic_string"\n');
    expect(iface.service).toEqual({ public: { magic: [{ re: ['Text'], writes: false }] } });
  });

  it('integer literal constant', () => {
    const { interface: iface } = extract('@answer = 42\n');
    expect(iface.service).toEqual({ public: { answer: [{ re: ['Integer'], writes: false }] } });
  });

  it('boolean literal constant', () => {
    const { interface: iface } = extract('@yes = true\n');
    expect(iface.service).toEqual({ public: { yes: [{ re: ['Boolean'], writes: false }] } });
  });

  it('type-call initialized constant', () => {
    const { interface: iface } = extract('@t = Text("x")\n');
    expect(iface.service).toEqual({ public: { t: [{ re: ['Text'], writes: false }] } });
  });
});

// ── Mixed: refs, constants, and handlers interleave in declaration order ─────

describe('service interface — mixed field and handler decls', () => {
  it('fields and handlers interleave in declaration order; per-field grouped', () => {
    const source = `
      @val *Integer = 0
      @greet = (name: Text) -> msg: "hi"
      @magic = "abc"
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: {
          val: [{ re: ['Integer'], writes: false }],
          greet: [{ args: [{ name: 'Text' }], re: [{ msg: 'Text' }], writes: false }],
          magic: [{ re: ['Text'], writes: false }],
        },
        ':val': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
      },
    );
  });
});

// ── Imported types resolve to backtick-quoted addresses ─────────────────────

describe('service interface — imported type address resolution', () => {
  it('return type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      use Pair = "/services/pair"

      @get
        =
        return Pair(key: "a", value: "b") as Pair
    `);
    expect(iface.service).toEqual({ public: { get: [{ re: ['/services/pair'], writes: false }] } });
  });

  it('parameter type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      use Pair = "/services/pair"

      @accept. = (p Pair) {}
    `);
    expect(iface.service).toEqual({ public: { 'accept.': [{ args: ['/services/pair'], writes: true }] } });
  });

  it('named parameter type from dependency renders as backtick address', () => {
    const { interface: iface } = extract(`
      use Pair = "/services/pair"

      @accept. = (item: Pair) {}
    `);
    expect(iface.service).toEqual({ public: { 'accept.': [{ args: [{ item: '/services/pair' }], writes: true }] } });
  });

  it('built-in types remain unqualified alongside imported types', () => {
    const { interface: iface } = extract(`
      use Pair = "/services/pair"

      @process
        =
        label: Text
        p Pair
        =
        return count: 1
    `);
    expect(iface.service).toEqual({
      public: {
        process: [
          {
            args: ['/services/pair', { label: 'Text' }],
            re: [{ count: 'Integer' }],
            writes: false,
          },
        ],
      },
    });
  });

  it('List of imported type resolves inner type', () => {
    const { interface: iface } = extract(`
      use Item = "/models/item"

      @list
        =
        return items as List[Item]
    `);
    expect(iface.service).toEqual({ public: { list: [{ re: [[['/models/item'], { '%t': 'List' }]], writes: false }] } });
  });

  it('imported type with | null suffix', () => {
    const { interface: iface } = extract(`
      use Item = "/models/item"

      @find
        =
        key: Text
        =
        return result as Item | null
    `);
    expect(iface.service).toEqual({
      public: {
        find: [{ args: [{ key: 'Text' }], re: [{ '%or': ['/models/item', null] }], writes: false }],
      },
    });
  });

  it('multiple dependencies resolve independently', () => {
    const { interface: iface } = extract(`
      use User = "/models/user"
      use Session = "/models/session"

      @login
        =
        u User
        =
        return s as Session
    `);
    expect(iface.service).toEqual({ public: { login: [{ args: ['/models/user'], re: ['/models/session'], writes: false }] } });
  });

  it('dependency with inline constraint resolves type in interface', () => {
    const { interface: iface } = extract(`
      use DB = "/services/db" as { lookup (key: Text) -> (value: Text) }

      @query
        =
        db: DB
        =
        return result: "ok"
    `);
    expect(iface.service).toEqual({
      public: { query: [{ args: [{ db: '/services/db' }], re: [{ result: 'Text' }], writes: false }] },
    });
  });

  it('member type via :: resolves as path::Member', () => {
    const { interface: iface } = extract(`
      use Geo = "geometry.bv"

      @assign. = (p Geo::Point) {}
    `);
    expect(iface.service).toEqual({ public: { 'assign.': [{ args: ['geometry.bv:Point'], writes: true }] } });
  });

  it('member type in return position resolves as path::Member', () => {
    const { interface: iface } = extract(`
      use Geo = "geometry.bv"

      @make
        =
        return Geo::Point(1, 2) as Geo::Point
    `);
    expect(iface.service).toEqual({ public: { make: [{ re: ['geometry.bv:Point'], writes: false }] } });
  });

  it('member type with named param resolves as path::Member', () => {
    const { interface: iface } = extract(`
      use Geo = "geometry.bv"

      @move. = (point: Geo::Point, dx: Integer) {}
    `);
    expect(iface.service).toEqual({
      public: { 'move.': [{ args: [{ point: 'geometry.bv:Point', dx: 'Integer' }], writes: true }] },
    });
  });

  it('constant of imported type resolves in getter', () => {
    const { interface: iface } = extract(`
      use Config = "/models/config"

      @current = Config()
    `);
    expect(iface.service).toEqual({ public: { current: [{ re: ['/models/config'], writes: false }] } });
  });
});

// ── self-as declarations surface in service interface ─────────────────────

describe('service interface — self-as declarations', () => {
  it('single self-as type appended after service interface body', () => {
    const { interface: iface } = extract(`
      self as Integer = () -> 100
      @get
        =
        return 1
    `);
    expect(iface.service).toEqual({
      public: { get: [{ re: ['Integer'], writes: false }], $as: [{ re: ['Integer'], writes: false }] },
    });
  });

  it('multiple self-as types appended in declaration order', () => {
    const { interface: iface } = extract(`
      self as Text = () -> "one hundred"
      self as Integer = () -> 100
      @get
        =
        return num: 100
    `);
    expect(iface.service).toEqual({
      public: {
        get: [{ re: [{ num: 'Integer' }], writes: false }],
        $as: [{ re: ['Text'], writes: false }, { re: ['Integer'], writes: false }],
      },
    });
  });

  it('self-as with no public handlers', () => {
    const { interface: iface } = extract(`
      self as Integer = () -> 42
    `);
    expect(iface.service).toEqual({ public: { $as: [{ re: ['Integer'], writes: false }] } });
  });

  it('negated self-as excluded from interface', () => {
    const { interface: iface } = extract(`
      self as !Wrapper = () -> 0
      @ping = () -> pong: "ok"
    `);
    expect(iface.service).toEqual({ public: { ping: [{ re: [{ pong: 'Text' }], writes: false }] } });
  });

  it('mixed positive and negated — only positive types listed', () => {
    const { interface: iface } = extract(`
      self as Integer = () -> 42
      self as !Fallback = () -> 0
      @ping = () -> pong: "ok"
    `);
    expect(iface.service).toEqual({
      public: {
        ping: [{ re: [{ pong: 'Text' }], writes: false }],
        $as: [{ re: ['Integer'], writes: false }],
      },
    });
  });

  it('self-as with imported type resolves to backtick address', () => {
    const { interface: iface } = extract(`
      use Token = "/models/token"

      self as Token = () -> Token()
      @get
        =
        return 1
    `);
    expect(iface.service).toEqual({
      public: {
        get: [{ re: ['Integer'], writes: false }],
        $as: [{ re: ['/models/token'], writes: false }],
      },
    });
  });
});

// ── General unions in interface ───────────────────────────────────────────────

describe('service interface — general unions', () => {
  it('union in positional param', () => {
    const { interface: iface } = extract(`
      @echo
        =
        x Integer | Text
        =
        return result: x
    `);
    expect(iface.service).toEqual({
      public: {
        echo: [
          {
            args: [{ '%or': ['Integer', 'Text'] }],
            re: [{ result: { '%or': ['Integer', 'Text'] } }],
            writes: false,
          },
        ],
      },
    });
  });

  it('union in named param', () => {
    const { interface: iface } = extract(`
      @echo
        =
        x: Integer | Text
        =
        return result: x
    `);
    expect(iface.service).toEqual({
      public: {
        echo: [
          {
            args: [{ x: { '%or': ['Integer', 'Text'] } }],
            re: [{ result: { '%or': ['Integer', 'Text'] } }],
            writes: false,
          },
        ],
      },
    });
  });

  it('three-member union in named param', () => {
    const { interface: iface } = extract(`
      @echo
        =
        x: Integer | Text | Boolean
        =
        return :x
    `);
    expect(iface.service).toEqual({
      public: {
        echo: [
          {
            args: [{ x: { '%or': ['Integer', 'Text', 'Boolean'] } }],
            re: [{ x: { '%or': ['Integer', 'Text', 'Boolean'] } }],
            writes: false,
          },
        ],
      },
    });
  });

  it('union in reply via as-clause', () => {
    const { interface: iface } = extract(`
      @pick
        =
        flag Boolean
        =
        return result as Integer | Text
    `);
    expect(iface.service).toEqual({
      public: { pick: [{ args: ['Boolean'], re: [{ '%or': ['Integer', 'Text'] }], writes: false }] },
    });
  });

  it('union including null in positional param', () => {
    const { interface: iface } = extract(`
      @maybe
        =
        x Integer | Text | null
        =
        return result as Integer | Text | null
    `);
    expect(iface.service).toEqual({
      public: {
        maybe: [
          {
            args: [{ '%or': ['Integer', 'Text', null] }],
            re: [{ '%or': ['Integer', 'Text', null] }],
            writes: false,
          },
        ],
      },
    });
  });
});

// ── Void return — `() -> ()` (empty reply, distinct from silent `-> .`) ───────

describe('service interface — void-returning public functions', () => {
  it('inline empty body { } shows -> ()', () => {
    const { interface: iface } = extract('@noop = () { }\n');
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('inline -> () shows -> ()', () => {
    const { interface: iface } = extract('@noop = () -> ()\n');
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('inline ->() (no space) shows -> ()', () => {
    const { interface: iface } = extract('@noop = () ->()\n');
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('delimited body, implicit () tail shows -> ()', () => {
    const { interface: iface } = extract('@noop = () { () }\n');
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('delimited body, explicit -> () shows -> ()', () => {
    const { interface: iface } = extract('@noop = () { return () }\n');
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('lineal body, implicit () tail shows -> ()', () => {
    const { interface: iface } = extract(`
      @noop
        =
        ()
    `);
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('lineal body, explicit -> () shows -> ()', () => {
    const { interface: iface } = extract(`
      @noop
        =
        return ()
    `);
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('lineal header, empty {} body shows -> ()', () => {
    const { interface: iface } = extract(`
      @noop
        =
        { }
    `);
    expect(iface.service).toEqual({ public: { noop: [{ re: [], writes: false }] } });
  });

  it('void function with named arg shows (name: Type) -> ()', () => {
    const { interface: iface } = extract('@log = (msg: Text) { }\n');
    expect(iface.service).toEqual({ public: { log: [{ args: [{ msg: 'Text' }], re: [], writes: false }] } });
  });

  it('void function with positional arg shows (Type) -> ()', () => {
    const { interface: iface } = extract('@drop = (n Integer) -> ()\n');
    expect(iface.service).toEqual({ public: { drop: [{ args: ['Integer'], re: [], writes: false }] } });
  });

  it('void distinguished from silent — both forms in same iface', () => {
    const source = `
      @noop = () -> ()
      @hush. = () {}
    `;
    expect(extract(source).interface.service).toEqual(
      { public: { noop: [{ re: [], writes: false }], 'hush.': [{ writes: true }] } },
    );
  });

  it('overloaded — void variant alongside replying variant', () => {
    const { interface: iface } = extract(`
      @set = (value: Integer) -> ()
      @set = (value: Text) -> ack: "noted"
    `);
    expect(iface.service).toEqual(
      {
        public: {
          set: [
            { args: [{ value: 'Integer' }], re: [], writes: false },
            { args: [{ value: 'Text' }], re: [{ ack: 'Text' }], writes: false },
          ],
        },
      },
    );
  });

  it('mixed: replying, void, and silent functions in declaration order', () => {
    const source = `
      @get = () -> 1
      @clear = () -> ()
      @notify. = (msg: Text) {}
    `;
    expect(extract(source).interface.service).toEqual(
      {
        public: {
          get: [{ re: ['Integer'], writes: false }],
          clear: [{ re: [], writes: false }],
          'notify.': [{ args: [{ msg: 'Text' }], writes: true }],
        },
      },
    );
  });
});
