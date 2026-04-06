import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Param styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — param styles', () => {
  const script = `
    @noArgSingle
      =
      result: x Integer = getFortyTwo()
      -> :x

    @noArgDouble
      =
      result: x Integer = getFortyTwoExplicit()
      -> :x

    @singlePos
      =
      result: x Integer = double(5)
      -> :x

    @multiPos
      =
      result: s Integer = add(3, 4)
      -> :s

    @named
      =
      result: msg Text = greet(name: "world")
      -> :msg

    @mixed
      =
      result: x Integer = mix(10, label: "hi")
      -> :x

    @keyed
      =
      result: x Text = extract(tag: "hello")
      -> :x

    getFortyTwo
      =
      -> result: 42 as Integer

    getFortyTwoExplicit
      =
      =
      -> result: 42 as Integer

    double
      =
      n Integer
      =
      -> result: (n * 2) as Integer

    add
      =
      a Integer
      b Integer
      =
      -> result: (a + b) as Integer

    greet
      =
      name: Text
      =
      -> result: name as Text

    mix
      =
      n Integer
      label: Text
      =
      -> result: n as Integer

    extract
      =
      tag: (t) Text
      =
      -> result: t as Text
  `;

  it('no-arg — single =', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@noArgSingle', from: 'c' } }, { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('no-arg — double =', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@noArgDouble', from: 'c' } }, { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' } });
  });

  it('single positional param', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@singlePos', from: 'c' } }, { output: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('multiple positional params', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@multiPos', from: 'c' } }, { output: { id: '4', 'bv-a': { s: 'Integer' }, re: { s: 7 }, to: 'c' } });
  });

  it('named param (sigil)', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@named', from: 'c' } }, { output: { id: '5', 'bv-a': { msg: 'Text' }, re: { msg: 'world' }, to: 'c' } });
  });

  it('mixed positional + named', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@mixed', from: 'c' } }, { output: { id: '6', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('key-mapped param', async () => {
    await expectBehavior(script, { input: { id: '7', op: '@keyed', from: 'c' } }, { output: { id: '7', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Body and return forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — body and return forms', () => {
  const script = `
    @multiStmt
      =
      result: x Integer = compute(5)
      -> :x

    @spaciousReturn
      =
      x: a Integer, y: b Text = info(5)
      -> :a, :b

    @denseInline
      =
      p Integer, q Integer, sum: Integer, product: prod Integer = denseReturnInline(3, 4)
      -> :p, :q, :sum, :prod

    @denseMulti
      =
      v Integer, doubled: Integer, label: lbl Text = denseReturnMulti(5)
      -> :v, :doubled, :lbl

    compute
      =
      n Integer
      =
      doubled Integer = n * 2
      -> result: doubled as Integer

    info
      =
      n Integer
      =
      doubled Integer = n * 2
      ->
        x: doubled as Integer
        y: "hello" as Text

    denseReturnInline
      =
      a Integer
      b Integer
      =
      sum Integer = a + b
      ->(a as Integer, b as Integer, :sum as Integer, product: (a * b) as Integer)

    denseReturnMulti
      =
      n Integer
      =
      doubled Integer = n * 2
      ->(
        n as Integer,
        :doubled as Integer,
        label: "done" as Text
      )
  `;

  it('multi-statement body', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@multiStmt', from: 'c' } }, { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } });
  });

  it('lineal return (-> on own line, fields below)', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@spaciousReturn', from: 'c' } }, { output: { id: '2', 'bv-a': { a: 'Integer', b: 'Text' }, re: { a: 10, b: 'hello' }, to: 'c' } });
  });

  it('delimited return — single-line ->(…)', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@denseInline', from: 'c' } },
      { output: { id: '3', 'bv-a': { p: 'Integer', q: 'Integer', sum: 'Integer', prod: 'Integer' }, re: { p: 3, q: 4, sum: 7, prod: 12 }, to: 'c' } },
    );
  });

  it('delimited return — multiline ->(…)', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@denseMulti', from: 'c' } },
      { output: { id: '4', 'bv-a': { v: 'Integer', doubled: 'Integer', lbl: 'Text' }, re: { v: 5, doubled: 10, lbl: 'done' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Composition
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — composition', () => {
  const script = `
    @multiFn
      =
      result: a Integer = double(5)
      result: b Integer = triple(5)
      -> sum: (a + b) as Integer

    @crossCall
      =
      result: x Integer = quad(5)
      -> :x

    @denseSpacious
      =
      fn = |a| { a + 1 }
      result: base Integer = square(5)
      extra Integer = fn(base)
      -> :extra

    double
      =
      n Integer
      =
      -> result: (n * 2) as Integer

    triple
      =
      n Integer
      =
      -> result: (n * 3) as Integer

    quad
      =
      n Integer
      =
      result: d Integer = double(n)
      -> result: d * 2 as Integer

    square
      =
      n Integer
      =
      -> result: (n * n) as Integer
  `;

  it('multiple lineal functions in same actor', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@multiFn', from: 'c' } }, { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'c' } });
  });

  it('lineal function calls another lineal function', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@crossCall', from: 'c' } }, { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 20 }, to: 'c' } });
  });

  it('lineal top-level + delimited lambda in public function', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@denseSpacious', from: 'c' } }, { output: { id: '3', 'bv-a': { extra: 'Integer' }, re: { extra: 26 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal function — optional params
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — optional params', () => {
  const script = `
    @testTypedBoth
      =
      result: r Integer = addTyped(3, 7)
      -> :r

    @testTypedDefault
      =
      result: r Integer = addTyped(3)
      -> :r

    @testInferredBoth
      =
      result: r Integer = addInferred(3, 7)
      -> :r

    @testInferredDefault
      =
      result: r Integer = addInferred(3)
      -> :r

    @testNamedBoth
      =
      result: r Integer = addNamed(a: 3, b: 7)
      -> :r

    @testNamedDefault
      =
      result: r Integer = addNamed(a: 3)
      -> :r

    addTyped
      =
      a Integer
      b Integer = 0
      =
      -> result: (a + b) as Integer

    addInferred
      =
      a Integer
      b=1000
      =
      -> result: (a + b) as Integer

    addNamed
      =
      a: Integer
      b: Integer = 50
      =
      -> result: (a + b) as Integer
  `;

  it('typed default — both provided', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@testTypedBoth', from: 'c' } }, { output: { id: '1', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' } });
  });

  it('typed default — omitted uses 0', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@testTypedDefault', from: 'c' } }, { output: { id: '2', 'bv-a': { r: 'Integer' }, re: { r: 3 }, to: 'c' } });
  });

  it('inferred default — both provided', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@testInferredBoth', from: 'c' } }, { output: { id: '3', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' } });
  });

  it('inferred default — omitted uses 1000', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@testInferredDefault', from: 'c' } }, { output: { id: '4', 'bv-a': { r: 'Integer' }, re: { r: 1003 }, to: 'c' } });
  });

  it('named default — both provided', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@testNamedBoth', from: 'c' } }, { output: { id: '5', 'bv-a': { r: 'Integer' }, re: { r: 10 }, to: 'c' } });
  });

  it('named default — omitted uses 50', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@testNamedDefault', from: 'c' } }, { output: { id: '6', 'bv-a': { r: 'Integer' }, re: { r: 53 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal function — compile errors', () => {
  it('assigning result of silent function is a compile error', () => {
    expect(() => compileSource(`
      @test
        =
        result Integer = fire()
        -> result as Integer
      fire
        =
        .
    `)).toThrow(/Silent function/);
  });

  it('public and private function with same base name can coexist', () => {
    expect(() => compileSource(`
      @square
        =
        -> result: 0 as Integer

      square
        =
        num Integer
        =
        ->(result: num as Integer)
    `)).not.toThrow();
  });

  it('single = with typed param is valid (whitespace type syntax)', () => {
    // With whitespace type syntax, `n Integer` is a valid single-param declaration
    // so a single = delimiter suffices when the param has a type
    expect(() => compileSource(`
      @go
        =
        result: x Integer = double(5)
        -> :x

      double
        =
        n Integer
        -> result: (n * 2) as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Silent function + edge cases
// ═══════════════════════════════════════════════════════════════════════════════

const edgeCaseScript = `
  @goSilent
    =
    spawn fire()
    -> answer: "ok" as Text

  fire
    =
    .

  @fooStruct
    =
    s Structure = square(10)
    result: x Integer = s
    -> :x

  @fooDblCall
    =
    result: a Integer = square(3)
    result: b Integer = square(4)
    -> sum: (a + b) as Integer

  square
    =
    num Integer
    =
    sq Integer = num * num
    ->(result: sq as Integer)

  @testUnwrap
    =
    a Integer = getOne()
    -> result: a

  getOne
    =
    -> 42 as Integer

  @testTooMany
    =
    a Integer = getTwo()
    -> result: a

  getTwo
    =
    ->(1 as Integer, 2 as Integer)
`;

describe('lineal function — silent (. stop)', () => {
  it('side-effect-only function with dot', async () => {
    await expectBehavior(edgeCaseScript, { input: { id: '1', op: '@goSilent', from: 'c' } }, { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } });
  });
});

describe('lineal function — edge cases', () => {
  it('result assigned as whole Structure, then destructured', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: '@fooStruct', from: 'caller' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 100 }, to: 'caller' } },
    );
  });

  it('same function called twice with different args', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: '@fooDblCall', from: 'caller' } },
      { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 25 }, to: 'caller' } },
    );
  });

  it('plain assign from function returning 1 positional unwraps correctly', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: '@testUnwrap', from: 'caller' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'caller' } },
    );
  });

  it('plain assign from function returning 2 positionals throws at runtime', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: '@testTooMany', from: 'caller' } },
      { output: { id: '1', ex: { '@testTooMany': 'error' }, to: 'caller' } },
    );
  });
});
