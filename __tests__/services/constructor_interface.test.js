import { extract } from '../../index.js';

// ── Single public class — basic actor interfaces ─────────────────────────────

describe('class interface — basic', () => {
  it('no-param class with one method', () => {
    const { interface: iface } = extract(`
      @Greeter = * {
        @hello = -> greeting: "hi"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Greeter: *() -> {\n    hello: () -> (greeting: Text)\n  }\n}',
    );
  });

  it('single named param', () => {
    const { interface: iface } = extract(`
      @Document = *(content: Text) {
        @body = -> content as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document: *(content: Text) -> {\n    body: () -> (Text)\n  }\n}',
    );
  });

  it('single positional param', () => {
    const { interface: iface } = extract(`
      @Wrapper = *(n Integer) {
        @get = -> value: n as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Wrapper: *(Integer) -> {\n    get: () -> (value: Integer)\n  }\n}',
    );
  });

  it('multiple params', () => {
    const { interface: iface } = extract(`
      @Pair = *(a Integer, b Integer) {
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Pair: *(Integer, Integer) -> {\n    sum: () -> (total: Integer)\n  }\n}',
    );
  });
});

// ── Actor interface — varied method signatures ───────────────────────────────

describe('class interface — actor methods', () => {
  it('method with args', () => {
    const { interface: iface } = extract(`
      @Search = *(corpus: Text) {
        @find = (query: Text) -> result: "found"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Search: *(corpus: Text) -> {\n    find: (query: Text) -> (result: Text)\n  }\n}',
    );
  });

  it('silent method', () => {
    const { interface: iface } = extract(`
      @Logger = * {
        @log = (msg: Text) .
      }
    `);
    expect(iface.service).toBe(
      '{\n  Logger: *() -> {\n    log: (msg: Text) -> .\n  }\n}',
    );
  });

  it('multiple methods in order', () => {
    const { interface: iface } = extract(`
      @Document = *(content: Text) {
        @title = -> "untitled"
        @body = -> content as Text
        @index_of = (match: Text) -> pos: 0 as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document: *(content: Text) -> {\n    title: () -> (Text)\n    body: () -> (Text)\n    index_of: (match: Text) -> (pos: Integer)\n  }\n}',
    );
  });

  it('no-arg method returning inferred type from class param', () => {
    const { interface: iface } = extract(`
      @Box = *(value: Integer) {
        @get = -> value as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Box: *(value: Integer) -> {\n    get: () -> (Integer)\n  }\n}',
    );
  });
});

// ── Private actor methods excluded ───────────────────────────────────────────

describe('class interface — private methods excluded', () => {
  it('private method does not appear in actor interface', () => {
    const { interface: iface } = extract(`
      @Document = *(content: Text) {
        helper = (t Text) -> r: t as Text
        @title = -> helper(content) as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document: *(content: Text) -> {\n    title: () -> (Text)\n  }\n}',
    );
  });
});

// ── Class alongside file-level public functions ──────────────────────────────

describe('class interface — mixed with public functions', () => {
  it('class and public function in same file', () => {
    const { interface: iface } = extract(`
      @Document = *(content: Text) {
        @title = -> "untitled"
        @body = -> content as Text
        @index_of = (match: Text) -> pos: 0 as Integer
      }
      @publish = (doc: Document) .
    `);
    expect(iface.service).toBe(
      '{\n  publish: (doc: Document) -> .\n  Document: *(content: Text) -> {\n    title: () -> (Text)\n    body: () -> (Text)\n    index_of: (match: Text) -> (pos: Integer)\n  }\n}',
    );
  });

  it('public function before class', () => {
    const { interface: iface } = extract(`
      @ping = -> 1
      @Counter = *(start Integer) {
        @get = -> value: start as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  ping: () -> (Integer)\n  Counter: *(Integer) -> {\n    get: () -> (value: Integer)\n  }\n}',
    );
  });

  it('multiple classes', () => {
    const { interface: iface } = extract(`
      @Point = *(x Integer, y Integer) {
        @sum = -> total: (x + y) as Integer
      }
      @Label = *(text: Text) {
        @get = -> text as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Point: *(Integer, Integer) -> {\n    sum: () -> (total: Integer)\n  }\n  Label: *(text: Text) -> {\n    get: () -> (Text)\n  }\n}',
    );
  });
});

// ── Private classes excluded ─────────────────────────────────────────────────

describe('class interface — private classes excluded', () => {
  // TODO: @-methods inside private classes currently leak into
  // the service interface as top-level functions. Once that is fixed,
  // the expectation below should drop the `get` line.
  it('non-public class does not appear in interface', () => {
    const { interface: iface } = extract(`
      Helper = *(n Integer) {
        @get = -> value: n as Integer
      }
      @use
        =
        h = Helper(5)
        :value Integer = h.get()
        -> :value as Integer
    `);
    expect(iface.service).toBe(
      '{\n  use: () -> (value: Integer)\n  get: () -> (value: Integer)\n}',
    );
  });
});

// ── Class interface — optional params ────────────────────────────────────────

describe('class interface — optional params', () => {
  it('positional optional shows ? Type', () => {
    const { interface: iface } = extract(`
      @Counter = *(start Integer = 0) {
        @get = -> value: start as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Counter: *(? Integer) -> {\n    get: () -> (value: Integer)\n  }\n}',
    );
  });

  it('named optional shows ? name: Type', () => {
    const { interface: iface } = extract(`
      @Config = *(label: Text = "default") {
        @get = -> label as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Config: *(? label: Text) -> {\n    get: () -> (Text)\n  }\n}',
    );
  });

  it('mixed required and optional params', () => {
    const { interface: iface } = extract(`
      @Pair = *(a Integer, b Integer = 0) {
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Pair: *(Integer, ? Integer) -> {\n    sum: () -> (total: Integer)\n  }\n}',
    );
  });

  it('inferred type from default shows in interface', () => {
    const { interface: iface } = extract(`
      @Box = *(value=42) {
        @get = -> value as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Box: *(? Integer) -> {\n    get: () -> (Integer)\n  }\n}',
    );
  });

  it('actor method with optional arg', () => {
    const { interface: iface } = extract(`
      @Store = * {
        @get = (key: Text, fallback: Text = "none") -> value: "found"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Store: *() -> {\n    get: (key: Text, ? fallback: Text) -> (value: Text)\n  }\n}',
    );
  });

  it('all-optional class params', () => {
    const { interface: iface } = extract(`
      @Defaults = *(x=10, y=20) {
        @sum = -> total: (x + y) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Defaults: *(? Integer, ? Integer) -> {\n    sum: () -> (total: Integer)\n  }\n}',
    );
  });
});

// ── Class interface — imported type address resolution ──────────────────────

describe('class interface — imported type address resolution', () => {
  it('class param of imported type renders as backtick address', () => {
    const { interface: iface } = extract(`
      *( "/models/item": (Item) )
      =

      @Wrapper = *(item: Item) {
        @get = -> item as Item
      }
    `);
    expect(iface.service).toBe(
      '{\n  Wrapper: *(item: `/models/item`) -> {\n    get: () -> (`/models/item`)\n  }\n}',
    );
  });

  it('actor method returning imported type', () => {
    const { interface: iface } = extract(`
      *( "/models/pair": (Pair) )
      =

      @Factory = * {
        @make = -> Pair(key: "a", value: "b") as Pair
      }
    `);
    expect(iface.service).toBe(
      '{\n  Factory: *() -> {\n    make: () -> (`/models/pair`)\n  }\n}',
    );
  });

  it('actor method accepting imported type as parameter', () => {
    const { interface: iface } = extract(`
      *( "/models/item": (Item) )
      =

      @Processor = * {
        @handle = (item: Item) .
      }
    `);
    expect(iface.service).toBe(
      '{\n  Processor: *() -> {\n    handle: (item: `/models/item`) -> .\n  }\n}',
    );
  });
});
