import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// XML constructor invocation
//
// <T attr="value" attr2={expr} /> is syntax sugar for T(attr: "value", attr2: expr)
//
// Rules:
//   - Self-closing tags only (open/close form is a future feature)
//   - All attributes are named (no positional args)
//   - String attributes: attr="value" or attr='value' → Text
//   - Expression attributes: attr={expr} → any type
//   - Calling a constructor with positional params via XML is a compiler error
//   - Calling a non-constructor (plain function) via XML is a compiler error
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ─────────────────────────────────────────────────────────────

describe('XML tags — compilation', () => {
  it('basic self-closing tag compiles', () => {
    expect(() => compileSource(`
      Greeting = <msg: Text> {
        @get = -> result: msg as Text
      }
      @test = {
        g = <Greeting msg="hello" />
        :result = g.get()
        -> :result as Text
      }
    `)).not.toThrow();
  });

  it('expression attribute compiles', () => {
    expect(() => compileSource(`
      Box = <value: Integer> {
        @get = -> result: value as Integer
      }
      @test = {
        b = <Box value={42} />
        :result = b.get()
        -> :result as Integer
      }
    `)).not.toThrow();
  });

  it('mixed string and expression attributes compile', () => {
    expect(() => compileSource(`
      Card = <title: Text, count: Integer> {
        @get = -> result: title as Text
      }
      @test = {
        c = <Card title="hello" count={5} />
        :result = c.get()
        -> :result as Text
      }
    `)).not.toThrow();
  });

  it('single-quoted string attribute compiles', () => {
    expect(() => compileSource(`
      Label = <text: Text> {
        @get = -> result: text as Text
      }
      @test = {
        l = <Label text='world' />
        :result = l.get()
        -> :result as Text
      }
    `)).not.toThrow();
  });

  it('constructor with positional params is a compiler error', () => {
    expect(() => compileSource(`
      Point = <x Integer, y Integer> {
        @get = -> result: x as Integer
      }
      @test = {
        p = <Point x={1} y={2} />
        :result = p.get()
        -> :result as Integer
      }
    `)).toThrow(/positional/i);
  });

  it('non-constructor name is a compiler error', () => {
    expect(() => compileSource(`
      fn = |a: Integer| { a }
      @test = {
        result Integer = <fn a={5} />
        -> :result
      }
    `)).toThrow();
  });

  it('no attributes compiles', () => {
    expect(() => compileSource(`
      Empty = <> {
        @ping = -> result: 1 as Integer
      }
      @test = {
        e = <Empty />
        :result = e.ping()
        -> :result as Integer
      }
    `)).not.toThrow();
  });

  it('complex expression in attribute compiles', () => {
    expect(() => compileSource(`
      Box = <value: Integer> {
        @get = -> result: value as Integer
      }
      @test = {
        x Integer = 10
        b = <Box value={x + 5} />
        :result = b.get()
        -> :result as Integer
      }
    `)).not.toThrow();
  });
});

// ── Runtime: basic usage ────────────────────────────────────────────────────

describe('XML tags — runtime', () => {
  const script = `
    Greeting = <msg: Text> {
      @get = -> result: msg as Text
    }

    Box = <value: Integer> {
      @get = -> result: value as Integer
    }

    Card = <title: Text, count: Integer> {
      @getTitle = -> result: title as Text
      @getCount = -> result: count as Integer
    }

    @testString
      =
      g = <Greeting msg="hello" />
      :result = g.get()
      -> :result as Text

    @testExpr
      =
      b = <Box value={42} />
      :result = b.get()
      -> :result as Integer

    @testMixed
      =
      c = <Card title="world" count={7} />
      :result = c.getTitle()
      -> :result as Text

    @testMixedCount
      =
      c = <Card title="world" count={7} />
      :result = c.getCount()
      -> :result as Integer

    @testComputedExpr
      =
      x Integer = 10
      b = <Box value={x * 3} />
      :result = b.get()
      -> :result as Integer
  `;

  it('string attribute', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testString', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('expression attribute', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testExpr', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('mixed — string attribute', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testMixed', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'world' }, to: 'c' } },
    );
  });

  it('mixed — expression attribute', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testMixedCount', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('computed expression in attribute', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@testComputedExpr', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });
});

// ── Runtime: no attributes ──────────────────────────────────────────────────

describe('XML tags — no attributes', () => {
  const script = `
    Empty = <> {
      @ping = -> result: 1 as Integer
    }

    @test
      =
      e = <Empty />
      :result = e.ping()
      -> :result as Integer
  `;

  it('no-attribute tag instantiates correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: nested XML constructor calls ───────────────────────────────────

describe('XML tags — nested', () => {
  const script = `
    Inner = <value: Integer> {
      @get = -> result: value as Integer
    }

    Outer = <child: Inner> {
      @getValue = {
        :result = child.get()
        -> :result as Integer
      }
    }

    @test
      =
      o = <Outer child={<Inner value={99} />} />
      :result = o.getValue()
      -> :result as Integer
  `;

  // TODO: nested constructor calls in named arg position need async handling
  it.skip('nested XML constructor in expression attribute', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });
});

// ── Runtime: XML equivalent to function call syntax ─────────────────────────

describe('XML tags — equivalence with function syntax', () => {
  const script = `
    Config = <host: Text, port: Integer> {
      @getHost = -> result: host as Text
      @getPort = -> result: port as Integer
    }

    @testXml
      =
      c = <Config host="localhost" port={8080} />
      :result = c.getHost()
      -> :result as Text

    @testFn
      =
      c = Config(host: "localhost", port: 8080)
      :result = c.getHost()
      -> :result as Text

    @testXmlPort
      =
      c = <Config host="localhost" port={8080} />
      :result = c.getPort()
      -> :result as Integer

    @testFnPort
      =
      c = Config(host: "localhost", port: 8080)
      :result = c.getPort()
      -> :result as Integer
  `;

  it('XML and function call produce same string result', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testXml', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'localhost' }, to: 'c' } },
    );
  });

  it('function call produces same string result', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testFn', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'localhost' }, to: 'c' } },
    );
  });

  it('XML and function call produce same integer result', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testXmlPort', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 8080 }, to: 'c' } },
    );
  });

  it('function call produces same integer result', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testFnPort', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 8080 }, to: 'c' } },
    );
  });
});

// ── Runtime: optional params with XML ───────────────────────────────────────

describe('XML tags — optional params', () => {
  const script = `
    Widget = <label: Text = "default", size: Integer = 10> {
      @getLabel = -> result: label as Text
      @getSize = -> result: size as Integer
    }

    @testAllProvided
      =
      w = <Widget label="custom" size={20} />
      :result = w.getLabel()
      -> :result as Text

    @testDefaults
      =
      w = <Widget />
      :result = w.getLabel()
      -> :result as Text

    @testPartial
      =
      w = <Widget label="partial" />
      :result = w.getSize()
      -> :result as Integer
  `;

  it('all attributes provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAllProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'custom' }, to: 'c' } },
    );
  });

  it('no attributes — defaults fill in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testDefaults', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'default' }, to: 'c' } },
    );
  });

  it('partial attributes — remaining use defaults', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testPartial', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });
});
