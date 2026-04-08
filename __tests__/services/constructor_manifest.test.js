import { extract } from '../../index.js';

// ── Single public constructor — basic instance interfaces ────────────────────

describe('constructor manifest — basic', () => {
  it('no-param constructor with one method', () => {
    const { manifest } = extract(`
      @Greeter = <> {
        @hello = -> greeting: "hi" as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Greeter: <> -> {\n    hello: () -> (:greeting Text)\n  }\n}',
    );
  });

  it('single named param', () => {
    const { manifest } = extract(`
      @Document = <:content Text> {
        @body = -> content as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Document: <:content Text> -> {\n    body: () -> (Text)\n  }\n}',
    );
  });

  it('single positional param', () => {
    const { manifest } = extract(`
      @Wrapper = <n Integer> {
        @get = -> value: n as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Wrapper: <Integer> -> {\n    get: () -> (:value Integer)\n  }\n}',
    );
  });

  it('multiple params', () => {
    const { manifest } = extract(`
      @Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Pair: <Integer, Integer> -> {\n    sum: () -> (:total Integer)\n  }\n}',
    );
  });
});

// ── Instance interface — varied method signatures ────────────────────────────

describe('constructor manifest — instance methods', () => {
  it('method with args', () => {
    const { manifest } = extract(`
      @Search = <:corpus Text> {
        @find = |:query Text| -> result: "found" as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Search: <:corpus Text> -> {\n    find: (:query Text) -> (:result Text)\n  }\n}',
    );
  });

  it('silent method', () => {
    const { manifest } = extract(`
      @Logger = <> {
        @log = |:msg Text| .
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Logger: <> -> {\n    log: (:msg Text) -> .\n  }\n}',
    );
  });

  it('multiple methods in order', () => {
    const { manifest } = extract(`
      @Document = <:content Text> {
        @title = -> "untitled" as Text
        @body = -> content as Text
        @index_of = |:match Text| -> pos: 0 as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Document: <:content Text> -> {\n    title: () -> (Text)\n    body: () -> (Text)\n    index_of: (:match Text) -> (:pos Integer)\n  }\n}',
    );
  });

  it('no-arg method returning inferred type from constructor param', () => {
    const { manifest } = extract(`
      @Box = <:value Integer> {
        @get = -> value as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Box: <:value Integer> -> {\n    get: () -> (Integer)\n  }\n}',
    );
  });
});

// ── Private instance methods excluded ────────────────────────────────────────

describe('constructor manifest — private methods excluded', () => {
  it('private method does not appear in instance interface', () => {
    const { manifest } = extract(`
      @Document = <:content Text> {
        helper = |t Text| -> r: t as Text
        @title = -> helper(content) as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Document: <:content Text> -> {\n    title: () -> (Text)\n  }\n}',
    );
  });
});

// ── Constructor alongside file-level public functions ────────────────────────

describe('constructor manifest — mixed with public functions', () => {
  it('constructor and public function in same file', () => {
    const { manifest } = extract(`
      @Document = <:content Text> {
        @title = -> "untitled" as Text
        @body = -> content as Text
        @index_of = |:match Text| -> pos: 0 as Integer
      }
      @publish = |:doc Document| .
    `);
    expect(manifest.service).toBe(
      '{\n  publish: (:doc Document) -> .\n  Document: <:content Text> -> {\n    title: () -> (Text)\n    body: () -> (Text)\n    index_of: (:match Text) -> (:pos Integer)\n  }\n}',
    );
  });

  it('public function before constructor', () => {
    const { manifest } = extract(`
      @ping = -> 1 as Integer
      @Counter = <start Integer> {
        @get = -> value: start as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  ping: () -> (Integer)\n  Counter: <Integer> -> {\n    get: () -> (:value Integer)\n  }\n}',
    );
  });

  it('multiple constructors', () => {
    const { manifest } = extract(`
      @Point = <x Integer, y Integer> {
        @sum = -> total: (x + y) as Integer
      }
      @Label = <:text Text> {
        @get = -> text as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Point: <Integer, Integer> -> {\n    sum: () -> (:total Integer)\n  }\n  Label: <:text Text> -> {\n    get: () -> (Text)\n  }\n}',
    );
  });
});

// ── Private constructors excluded ────────────────────────────────────────────

describe('constructor manifest — private constructors excluded', () => {
  // TODO: @-methods inside private constructors currently leak into
  // the service manifest as top-level functions. Once that is fixed,
  // the expectation below should drop the `get` line.
  it('non-public constructor does not appear in manifest', () => {
    const { manifest } = extract(`
      Helper = <n Integer> {
        @get = -> value: n as Integer
      }
      @use
        =
        h = Helper(5)
        :value = h.get()
        -> :value as Integer
    `);
    expect(manifest.service).toBe(
      '{\n  use: () -> (:value Integer)\n  get: () -> (:value Integer)\n}',
    );
  });
});

// ── Constructor manifest — optional params ──────────────────────────────────

describe('constructor manifest — optional params', () => {
  it('positional optional shows Type?', () => {
    const { manifest } = extract(`
      @Counter = <start Integer = 0> {
        @get = -> value: start as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Counter: <Integer?> -> {\n    get: () -> (:value Integer)\n  }\n}',
    );
  });

  it('named optional shows :name Type?', () => {
    const { manifest } = extract(`
      @Config = <:label Text = "default"> {
        @get = -> label as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Config: <:label Text?> -> {\n    get: () -> (Text)\n  }\n}',
    );
  });

  it('mixed required and optional params', () => {
    const { manifest } = extract(`
      @Pair = <a Integer, b Integer = 0> {
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Pair: <Integer, Integer?> -> {\n    sum: () -> (:total Integer)\n  }\n}',
    );
  });

  it('inferred type from default shows in manifest', () => {
    const { manifest } = extract(`
      @Box = <value=42> {
        @get = -> value as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Box: <Integer?> -> {\n    get: () -> (Integer)\n  }\n}',
    );
  });

  it('instance method with optional arg', () => {
    const { manifest } = extract(`
      @Store = <> {
        @get = |:key Text, :fallback Text = "none"| -> value: "found" as Text
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Store: <> -> {\n    get: (:key Text, :fallback Text?) -> (:value Text)\n  }\n}',
    );
  });

  it('all-optional constructor params', () => {
    const { manifest } = extract(`
      @Defaults = <x=10, y=20> {
        @sum = -> total: (x + y) as Integer
      }
    `);
    expect(manifest.service).toBe(
      '{\n  Defaults: <Integer?, Integer?> -> {\n    sum: () -> (:total Integer)\n  }\n}',
    );
  });
});
