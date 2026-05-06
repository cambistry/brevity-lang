import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited (pipe) param style — @name = (params) ->  body
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — delimited (pipe)', () => {
  const script = `
    --- named sigil ---

    @singleNamed = (:n Integer) -> :n

    @twoNamed = (:n Integer, :m Integer) -> sum: (n + m)

    --- positional ---

    @singlePos = (n Integer) -> n
    @twoPos = (a Integer, b Integer) -> sum: (a + b)

    --- key-mapped ---

    @keyMapped = (a: (x) Integer) -> x
    --- mixed positional + named ---

    @mixedPosNamed = (a Integer, :b Integer) -> sum: (a + b)
  `;

  it('single named param :n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 42 }, '@singleNamed'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'c' } },
    );
  });

  it('two named params :n : Integer, :m : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ n: 3, m: 4 }, '@twoNamed'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });

  it('positional param n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[99], '@singlePos'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': ['Integer'], re: [99], to: 'c' } },
    );
  });

  it('two positional params a : Integer, b : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[5, 6], '@twoPos'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' } },
    );
  });

  it('key-mapped a: x : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [{ a: 77 }, '@keyMapped'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '5', 'bv-a': ['Integer'], re: [77], to: 'c' } },
    );
  });

  it('mixed positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [[3, { b: 4 }], '@mixedPosNamed'], 'bv-a': [['Integer', { b: 'Integer' }]], from: 'c' } },
      { output: { id: '6', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal param form — @name\n=\nparam\nparam\n=\nbody
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — lineal form', () => {
  const script = `
    --- no params ---

    @noParams
      =
      -> answer: "world"

    --- single param ---

    @singleParam
      =
      :n Integer
      =
      -> :n

    --- two params ---

    @twoParams
      =
      :a Integer
      :b Integer
      =
      -> sum: (a + b)

    --- key-mapped ---

    @keyMappedOpen
      =
      a: (x) Integer
      =
      -> x
    --- mixed positional + named ---

    @mixedOpen
      =
      n Integer
      :m Integer
      =
      -> sum: (n + m)

    --- multiple functions don't bleed ---

    @foo
      =
      :x Integer
      =
      -> :x

    @bar
      =
      :y Integer
      =
      -> :y
  `;

  it('no params — = opens body directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@noParams', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('single param :n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ n: 10 }, '@singleParam'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { n: 'Integer' }, re: { n: 10 }, to: 'c' } },
    );
  });

  it('two params :a : Integer, :b : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 10, b: 20 }, '@twoParams'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' } },
    );
  });

  it('key-mapped a: x : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 55 }, '@keyMappedOpen'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': ['Integer'], re: [55], to: 'c' } },
    );
  });

  it('mixed positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[3, { m: 4 }], '@mixedOpen'], 'bv-a': [['Integer', { m: 'Integer' }]], from: 'c' } },
      { output: { id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });

  it('multiple functions — @foo', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [{ x: 1 }, '@foo'], 'bv-a': [{ x: 'Integer' }], from: 'c' } },
      { output: { id: '6', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } },
    );
  });

  it('multiple functions — @bar', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: [{ y: 2 }, '@bar'], 'bv-a': [{ y: 'Integer' }], from: 'c' } },
      { output: { id: '7', 'bv-a': { y: 'Integer' }, re: { y: 2 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — compile errors', () => {
  it('same-line params without pipes → compile error', () => {
    expect(() => compileSource('@go :n Integer -> :n\n')).toThrow();
  });

  it('paren-style params → compile error', () => {
    expect(() => compileSource('@go(:n Integer) -> :n\n')).toThrow(/Unexpected token after '@go'/);
  });

  it('// comment inside lineal params is ignored', () => {
    expect(() => compileSource(`
      @go
        =
        :n Integer
        // end params
        -> :n
    `)).not.toThrow();
  });

  it('-- stitch inside lineal params is ignored', () => {
    expect(() => compileSource(`
      @go
        =
        :n Integer
        -- end params
        -> :n
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public params with defaults — delimited (pipe) form
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — optional args — delimited (pipe)', () => {
  const script = `
    @posOpt = (a Integer, b Integer = 0) -> sum: (a + b)

    @namedOpt = (:a Integer, :b Integer = 99) -> sum: (a + b)

    @mixedOpt = (a Integer, :b Integer = 50) -> sum: (a + b)
  `;

  it('positional default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3, 7], '@posOpt'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 10 }, to: 'c' } },
    );
  });

  it('positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3], '@posOpt'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 3 }, to: 'c' } },
    );
  });

  it('named default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 3, b: 7 }, '@namedOpt'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 10 }, to: 'c' } },
    );
  });

  it('named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 3 }, '@namedOpt'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 102 }, to: 'c' } },
    );
  });

  it('mixed — named omitted uses default', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[10], '@mixedOpt'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 60 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public params with defaults — lineal form
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — optional args — lineal form', () => {
  const script = `
    @posOptOpen
      =
      a Integer
      b Integer = 0
      =
      -> sum: (a + b)

    @namedOptOpen
      =
      :a Integer
      :b Integer = 99
      =
      -> sum: (a + b)
  `;

  it('lineal positional default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5, 3], '@posOptOpen'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 8 }, to: 'c' } },
    );
  });

  it('lineal positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[5], '@posOptOpen'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 5 }, to: 'c' } },
    );
  });

  it('lineal named default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 5, b: 3 }, '@namedOptOpen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 8 }, to: 'c' } },
    );
  });

  it('lineal named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 5 }, '@namedOptOpen'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 104 }, to: 'c' } },
    );
  });
});
