import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// XML class invocation
//
// <T attr="value" attr2={expr} /> is syntax sugar for T(attr: "value", attr2: expr)
//
// Rules:
//   - Self-closing tags only (open/close form is a future feature)
//   - All attributes are named (no positional args)
//   - String attributes: attr="value" or attr='value' → Text
//   - Expression attributes: attr={expr} → any type
//   - Calling a class with positional params via XML is a compiler error
//   - Calling a non-class (plain function) via XML is a compiler error
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ─────────────────────────────────────────────────────────────

describe('XML tags — compilation', () => {
  it('basic self-closing tag compiles', () => {
    expect(() => compileSource(`
      Greeting = *(msg: Text) {
        @get = -> result: msg
      }
      @test = {
        g = <Greeting msg="hello" />
        :result Text = g.get()
        -> :result
      }
    `)).not.toThrow();
  });

  it('expression attribute compiles', () => {
    expect(() => compileSource(`
      Box = *(value: Integer) {
        @get = -> result: value
      }
      @test = {
        b = <Box value={42} />
        :result Integer = b.get()
        -> :result
      }
    `)).not.toThrow();
  });

  it('mixed string and expression attributes compile', () => {
    expect(() => compileSource(`
      Card = *(title: Text, count: Integer) {
        @get = -> result: title
      }
      @test = {
        c = <Card title="hello" count={5} />
        :result Text = c.get()
        -> :result
      }
    `)).not.toThrow();
  });

  it('single-quoted string attribute compiles', () => {
    expect(() => compileSource(`
      Label = *(text: Text) {
        @get = -> result: text
      }
      @test = {
        l = <Label text='world' />
        :result Text = l.get()
        -> :result
      }
    `)).not.toThrow();
  });

  it('class with positional params is a compiler error', () => {
    expect(() => compileSource(`
      Point = *(x Integer, y Integer) {
        @get = -> result: x
      }
      @test = {
        p = <Point x={1} y={2} />
        :result Integer = p.get()
        -> :result
      }
    `)).toThrow(/positional/i);
  });

  it('non-class name is a compiler error', () => {
    expect(() => compileSource(`
      fn = (a: Integer) { a }
      @test = {
        result Integer = <fn a={5} />
        -> :result
      }
    `)).toThrow();
  });

  it('no attributes compiles', () => {
    expect(() => compileSource(`
      Empty = * {
        @ping = -> result: 1
      }
      @test = {
        e = <Empty />
        :result Integer = e.ping()
        -> :result
      }
    `)).not.toThrow();
  });

  it('complex expression in attribute compiles', () => {
    expect(() => compileSource(`
      Box = *(value: Integer) {
        @get = -> result: value
      }
      @test = {
        x Integer = 10
        b = <Box value={x + 5} />
        :result Integer = b.get()
        -> :result
      }
    `)).not.toThrow();
  });
});

// ── Runtime: basic usage ────────────────────────────────────────────────────

describe('XML tags — runtime', () => {
  const script = `
    Greeting = *(msg: Text) {
      @get = -> result: msg
    }

    Box = *(value: Integer) {
      @get = -> result: value
    }

    Card = *(title: Text, count: Integer) {
      @getTitle = -> result: title
      @getCount = -> result: count
    }

    @testString
      =
      g = <Greeting msg="hello" />
      :result Text = g.get()
      -> :result

    @testExpr
      =
      b = <Box value={42} />
      :result Integer = b.get()
      -> :result

    @testMixed
      =
      c = <Card title="world" count={7} />
      :result Text = c.getTitle()
      -> :result

    @testMixedCount
      =
      c = <Card title="world" count={7} />
      :result Integer = c.getCount()
      -> :result

    @testComputedExpr
      =
      x Integer = 10
      b = <Box value={x * 3} />
      :result Integer = b.get()
      -> :result
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
    Empty = * {
      @ping = -> result: 1
    }

    @test
      =
      e = <Empty />
      :result Integer = e.ping()
      -> :result
  `;

  it('no-attribute tag constructs correctly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ── Runtime: nested XML class calls ─────────────────────────────────────────

describe('XML tags — nested', () => {
  const script = `
    Inner = *(value: Integer) {
      @get = -> result: value
    }

    Outer = *(child: Inner) {
      @getValue = {
        :result Integer = child.get()
        -> :result
      }
    }

    @test
      =
      o = <Outer child={<Inner value={99} />} />
      :result Integer = o.getValue()
      -> :result
  `;

  // TODO: nested class calls in named arg position need async handling
  it.skip('nested XML class call in expression attribute', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });
});

// ── R:untime XML equivalent to function call syntax ─────────────────────────

describe('XML tags — equivalence with function syntax', () => {
  const script = `
    Config = *(host: Text, port: Integer) {
      @getHost = -> result: host
      @getPort = -> result: port
    }

    @testXml
      =
      c = <Config host="localhost" port={8080} />
      :result Text = c.getHost()
      -> :result

    @testFn
      =
      c = Config(host: "localhost", port: 8080)
      :result Text = c.getHost()
      -> :result

    @testXmlPort
      =
      c = <Config host="localhost" port={8080} />
      :result Integer = c.getPort()
      -> :result

    @testFnPort
      =
      c = Config(host: "localhost", port: 8080)
      :result Integer = c.getPort()
      -> :result
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
    Widget = *(label: Text = "default", size: Integer = 10) {
      @getLabel = -> result: label
      @getSize = -> result: size
    }

    @testAllProvided
      =
      w = <Widget label="custom" size={20} />
      :result Text = w.getLabel()
      -> :result

    @testDefaults
      =
      w = <Widget />
      :result Text = w.getLabel()
      -> :result

    @testPartial
      =
      w = <Widget label="partial" />
      :result Integer = w.getSize()
      -> :result
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
