import { expectBehavior, compileSource } from '../helpers.js';

describe('lineal function — runtime', () => {
  const script = `
    // lineal function — param styles
    @noArgSingle
      =
      result: x Integer = getFortyTwo()
      return :x

    @noArgDouble
      =
      result: x Integer = getFortyTwoExplicit()
      return :x

    @singlePos
      =
      result: x Integer = double(5)
      return :x

    @multiPos
      =
      result: s Integer = add(3, 4)
      return :s

    @named
      =
      result: msg Text = greet(name: "world")
      return :msg

    @mixed
      =
      result: x Integer = mix(10, label: "hi")
      return :x

    @keyed
      =
      result: x Text = extract(tag: "hello")
      return :x

    getFortyTwo
      =
      return result: 42

    getFortyTwoExplicit
      =
      =
      return result: 42

    double
      =
      n Integer
      =
      return result: (n * 2)

    add
      =
      a Integer
      b Integer
      =
      return result: (a + b)

    greet
      =
      name: Text
      =
      return result: name

    mix
      =
      n Integer
      label: Text
      =
      return result: n

    extract
      =
      tag: t Text
      =
      return result: t

    // lineal function — body and return forms
    @multiStmt
      =
      result: x Integer = compute(5)
      return :x

    @spaciousReturn
      =
      x: a Integer, y: b Text = info(5)
      return :a, :b

    @denseInline
      =
      p Integer, q Integer, sum: Integer, product: prod Integer = denseReturnInline(3, 4)
      return :p, :q, :sum, :prod

    @denseMulti
      =
      v Integer, doubled: Integer, label: lbl Text = denseReturnMulti(5)
      return :v, :doubled, :lbl

    compute
      =
      n Integer
      =
      doubled Integer = n * 2
      return result: doubled

    info
      =
      n Integer
      =
      doubled Integer = n * 2
      return
        x: doubled
        y: "hello"

    denseReturnInline
      =
      a Integer
      b Integer
      =
      sum Integer = a + b
      return (a, b, :sum, product: (a * b))

    denseReturnMulti
      =
      n Integer
      =
      doubled Integer = n * 2
      return (
        n,
        :doubled,
        label: "done"
      )

    // lineal function — composition
    @multiFn
      =
      result: a Integer = double(5)
      result: b Integer = triple(5)
      return sum: (a + b)

    @crossCall
      =
      result: x Integer = quad(5)
      return :x

    @denseSpacious
      =
      fn = (a) { a + 1 }
      result: squared Integer = square(5)
      extra Integer = fn(squared)
      return :extra

    triple
      =
      n Integer
      =
      return result: (n * 3)

    quad
      =
      n Integer
      =
      result: d Integer = double(n)
      return result: d * 2

    square
      =
      n Integer
      =
      return result: (n * n)

    // lineal function — optional params
    @testTypedBoth
      =
      result: r Integer = addTyped(3, 7)
      return :r

    @testTypedDefault
      =
      result: r Integer = addTyped(3)
      return :r

    @testInferredBoth
      =
      result: r Integer = addInferred(3, 7)
      return :r

    @testInferredDefault
      =
      result: r Integer = addInferred(3)
      return :r

    @testNamedBoth
      =
      result: r Integer = addNamed(a: 3, b: 7)
      return :r

    @testNamedDefault
      =
      result: r Integer = addNamed(a: 3)
      return :r

    addTyped
      =
      a Integer
      b Integer = 0
      =
      return result: (a + b)

    addInferred
      =
      a Integer
      b=1000
      =
      return result: (a + b)

    addNamed
      =
      a: Integer
      b: Integer = 50
      =
      return result: (a + b)
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Param styles
  // ═══════════════════════════════════════════════════════════════════════════════

  it('lineal function — param styles — no-arg — single =', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'noArgSingle', from: 'c' } }, { output: { id: '1', 'ty': [{ x: 'Integer' }], re: [{ x: 42 }], to: 'c' } });
  });

  it('lineal function — param styles — no-arg — double =', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'noArgDouble', from: 'c' } }, { output: { id: '2', 'ty': [{ x: 'Integer' }], re: [{ x: 42 }], to: 'c' } });
  });

  it('lineal function — param styles — single positional param', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'singlePos', from: 'c' } }, { output: { id: '3', 'ty': [{ x: 'Integer' }], re: [{ x: 10 }], to: 'c' } });
  });

  it('lineal function — param styles — multiple positional params', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'multiPos', from: 'c' } }, { output: { id: '4', 'ty': [{ s: 'Integer' }], re: [{ s: 7 }], to: 'c' } });
  });

  it('lineal function — param styles — named param (sigil)', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'named', from: 'c' } }, { output: { id: '5', 'ty': [{ msg: 'Text' }], re: [{ msg: 'world' }], to: 'c' } });
  });

  it('lineal function — param styles — mixed positional + named', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'mixed', from: 'c' } }, { output: { id: '6', 'ty': [{ x: 'Integer' }], re: [{ x: 10 }], to: 'c' } });
  });

  it('lineal function — param styles — key-mapped param', async () => {
    await expectBehavior(script, { input: { id: '7', op: 'keyed', from: 'c' } }, { output: { id: '7', 'ty': [{ x: 'Text' }], re: [{ x: 'hello' }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Body and return forms
  // ═══════════════════════════════════════════════════════════════════════════════

  it('lineal function — body and return forms — multi-statement body', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'multiStmt', from: 'c' } }, { output: { id: '1', 'ty': [{ x: 'Integer' }], re: [{ x: 10 }], to: 'c' } });
  });

  it('lineal function — body and return forms — lineal return (-> on own line, fields below)', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'spaciousReturn', from: 'c' } }, { output: { id: '2', 'ty': [{ a: 'Integer', b: 'Text' }], re: [{ a: 10, b: 'hello' }], to: 'c' } });
  });

  it('lineal function — body and return forms — delimited return — single-line ->(…)', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'denseInline', from: 'c' } },
      { output: { id: '3', 'ty': [{ p: 'Integer', q: 'Integer', sum: 'Integer', prod: 'Integer' }], re: [{ p: 3, q: 4, sum: 7, prod: 12 }], to: 'c' } },
    );
  });

  it('lineal function — body and return forms — delimited return — multiline ->(…)', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'denseMulti', from: 'c' } },
      { output: { id: '4', 'ty': [{ v: 'Integer', doubled: 'Integer', lbl: 'Text' }], re: [{ v: 5, doubled: 10, lbl: 'done' }], to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Composition
  // ═══════════════════════════════════════════════════════════════════════════════

  it('lineal function — composition — multiple lineal functions in same actor', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'multiFn', from: 'c' } }, { output: { id: '1', 'ty': [{ sum: 'Integer' }], re: [{ sum: 25 }], to: 'c' } });
  });

  it('lineal function — composition — lineal function calls another lineal function', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'crossCall', from: 'c' } }, { output: { id: '2', 'ty': [{ x: 'Integer' }], re: [{ x: 20 }], to: 'c' } });
  });

  it('lineal function — composition — lineal top-level + delimited lambda in public function', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'denseSpacious', from: 'c' } }, { output: { id: '3', 'ty': [{ extra: 'Integer' }], re: [{ extra: 26 }], to: 'c' } });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Lineal function — optional params
  // ═══════════════════════════════════════════════════════════════════════════════

  it('lineal function — optional params — typed default — both provided', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'testTypedBoth', from: 'c' } }, { output: { id: '1', 'ty': [{ r: 'Integer' }], re: [{ r: 10 }], to: 'c' } });
  });

  it('lineal function — optional params — typed default — omitted uses 0', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'testTypedDefault', from: 'c' } }, { output: { id: '2', 'ty': [{ r: 'Integer' }], re: [{ r: 3 }], to: 'c' } });
  });

  it('lineal function — optional params — inferred default — both provided', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'testInferredBoth', from: 'c' } }, { output: { id: '3', 'ty': [{ r: 'Integer' }], re: [{ r: 10 }], to: 'c' } });
  });

  it('lineal function — optional params — inferred default — omitted uses 1000', async () => {
    await expectBehavior(script, { input: { id: '4', op: 'testInferredDefault', from: 'c' } }, { output: { id: '4', 'ty': [{ r: 'Integer' }], re: [{ r: 1003 }], to: 'c' } });
  });

  it('lineal function — optional params — named default — both provided', async () => {
    await expectBehavior(script, { input: { id: '5', op: 'testNamedBoth', from: 'c' } }, { output: { id: '5', 'ty': [{ r: 'Integer' }], re: [{ r: 10 }], to: 'c' } });
  });

  it('lineal function — optional params — named default — omitted uses 50', async () => {
    await expectBehavior(script, { input: { id: '6', op: 'testNamedDefault', from: 'c' } }, { output: { id: '6', 'ty': [{ r: 'Integer' }], re: [{ r: 53 }], to: 'c' } });
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
        result Integer = fire.()
        return result
      fire.
        =
    `)).toThrow(/'fire\.' is silent/);
  });

  it('public and private function with same base name can coexist', () => {
    expect(() => compileSource(`
      @square
        =
        return result: 0

      square
        =
        num Integer
        =
        return (result: num)
    `)).not.toThrow();
  });

  it('single = with typed param is valid (whitespace type syntax)', () => {
    // With whitespace type syntax, `n Integer` is a valid single-param declaration
    // so a single = delimiter suffices when the param has a type
    expect(() => compileSource(`
      @go
        =
        result: x Integer = double(5)
        return :x

      double
        =
        n Integer
        return result: (n * 2)
    `)).not.toThrow();
  });

  it("lineal params without leading '=' is a parse error", () => {
    expect(() => compileSource(`
      double
        n Integer
        =
        return result: (n * 2)
    `)).toThrow(/Unexpected token at top level: EQUALS/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Silent function + edge cases
// ═══════════════════════════════════════════════════════════════════════════════

const edgeCaseScript = `
  @goSilent!
    =
    fire...
    return answer: "ok"

  fire.
    =

  @fooStruct
    =
    s Object = square(10)
    result: x Integer = s
    return :x

  @fooDblCall
    =
    result: a Integer = square(3)
    result: b Integer = square(4)
    return sum: (a + b)

  square
    =
    num Integer
    =
    sq Integer = num * num
    return (result: sq)

  @testUnwrap
    =
    a Integer = getOne()
    return result: a

  getOne
    =
    return 42

  @testTooMany
    =
    a Integer = getTwo()
    return result: a

  getTwo
    =
    return (1, 2)
`;

describe('lineal function — silent (. stop)', () => {
  it('side-effect-only function with dot', async () => {
    await expectBehavior(edgeCaseScript, { input: { id: '1', op: 'goSilent!', from: 'c' } }, { output: { id: '1', 'ty': [{ answer: 'Text' }], re: [{ answer: 'ok' }], to: 'c' } });
  });
});

describe('lineal function — edge cases', () => {
  it('result assigned as whole Object, then destructured', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: 'fooStruct', from: 'caller' } },
      { output: { id: '1', 'ty': [{ x: 'Integer' }], re: [{ x: 100 }], to: 'caller' } },
    );
  });

  it('same function called twice with different args', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: 'fooDblCall', from: 'caller' } },
      { output: { id: '1', 'ty': [{ sum: 'Integer' }], re: [{ sum: 25 }], to: 'caller' } },
    );
  });

  it('plain assign from function returning 1 positional unwraps correctly', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: 'testUnwrap', from: 'caller' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'caller' } },
    );
  });

  it('plain assign from function returning 2 positionals throws at runtime', async () => {
    await expectBehavior(edgeCaseScript,
      { input: { id: '1', op: 'testTooMany', from: 'caller' } },
      { output: { id: '1', ex: { 'testTooMany': 'error' }, to: 'caller' } },
    );
  });
});
