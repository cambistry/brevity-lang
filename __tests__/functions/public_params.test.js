import { expectBehavior, compileSource } from '../helpers.js';

describe('public params — runtime', () => {
  const script = `
    // @params — delimited (pipe)
    --- named sigil ---

    @singleNamed = (n: Integer) -> :n

    @twoNamed = (n: Integer, m: Integer) -> sum: (n + m)

    --- positional ---

    @singlePos = (n Integer) -> n
    @twoPos = (a Integer, b Integer) -> sum: (a + b)

    --- key-mapped ---

    @keyMapped = (a: x Integer) -> x
    --- mixed positional + named ---

    @mixedPosNamed = (a Integer, b: Integer) -> sum: (a + b)

    // @params — lineal form
    --- no params ---

    @noParams
      =
      -> answer: "world"

    --- single param ---

    @singleParam
      =
      n: Integer
      =
      -> :n

    --- two params ---

    @twoParams
      =
      a: Integer
      b: Integer
      =
      -> sum: (a + b)

    --- key-mapped ---

    @keyMappedOpen
      =
      a: x Integer
      =
      -> x
    --- mixed positional + named ---

    @mixedOpen
      =
      n Integer
      m: Integer
      =
      -> sum: (n + m)

    --- multiple functions don't bleed ---

    @foo
      =
      x: Integer
      =
      -> :x

    @bar
      =
      y: Integer
      =
      -> :y

    // @params — optional args — delimited (pipe)
    @posOpt = (a Integer, b Integer = 0) -> sum: (a + b)

    @namedOpt = (a: Integer, b: Integer = 99) -> sum: (a + b)

    @mixedOpt = (a Integer, b: Integer = 50) -> sum: (a + b)

    // @params — optional args — lineal form
    @posOptOpen
      =
      a Integer
      b Integer = 0
      =
      -> sum: (a + b)

    @namedOptOpen
      =
      a: Integer
      b: Integer = 99
      =
      -> sum: (a + b)
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Delimited (pipe) param style — @name = (params) ->  body
  // ═══════════════════════════════════════════════════════════════════════════════

  it('@params — delimited (pipe) — single named param :n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[{ n: 42 }], 'singleNamed'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { output: { id: '1', 'ty': [{ n: 'Integer' }], re: [{ n: 42 }], to: 'c' } },
    );
  });

  it('@params — delimited (pipe) — two named params :n : Integer, :m : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[{ n: 3, m: 4 }], 'twoNamed'], 'ty': [[{ n: 'Integer', m: 'Integer' }]], from: 'c' } },
      { output: { id: '2', 'ty': [{ sum: 'Integer' }], re: [{ sum: 7 }], to: 'c' } },
    );
  });

  it('@params — delimited (pipe) — positional param n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[99], 'singlePos'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '3', 'ty': ['Integer'], re: [99], to: 'c' } },
    );
  });

  it('@params — delimited (pipe) — two positional params a : Integer, b : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[5, 6], 'twoPos'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '4', 'ty': [{ sum: 'Integer' }], re: [{ sum: 11 }], to: 'c' } },
    );
  });

  it('@params — delimited (pipe) — key-mapped a: x : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[{ a: 77 }], 'keyMapped'], 'ty': [[{ a: 'Integer' }]], from: 'c' } },
      { output: { id: '5', 'ty': ['Integer'], re: [77], to: 'c' } },
    );
  });

  it('@params — delimited (pipe) — mixed positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [[3, { b: 4 }], 'mixedPosNamed'], 'ty': [['Integer', { b: 'Integer' }]], from: 'c' } },
      { output: { id: '6', 'ty': [{ sum: 'Integer' }], re: [{ sum: 7 }], to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Lineal param form — @name\n=\nparam\nparam\n=\nbody
  // ═══════════════════════════════════════════════════════════════════════════════

  it('@params — lineal form — no params — = opens body directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'noParams', from: 'c' } },
      { output: { id: '1', 'ty': [{ answer: 'Text' }], re: [{ answer: 'world' }], to: 'c' } },
    );
  });

  it('@params — lineal form — single param :n : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[{ n: 10 }], 'singleParam'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { output: { id: '2', 'ty': [{ n: 'Integer' }], re: [{ n: 10 }], to: 'c' } },
    );
  });

  it('@params — lineal form — two params :a : Integer, :b : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[{ a: 10, b: 20 }], 'twoParams'], 'ty': [[{ a: 'Integer', b: 'Integer' }]], from: 'c' } },
      { output: { id: '3', 'ty': [{ sum: 'Integer' }], re: [{ sum: 30 }], to: 'c' } },
    );
  });

  it('@params — lineal form — key-mapped a: x : Integer', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[{ a: 55 }], 'keyMappedOpen'], 'ty': [[{ a: 'Integer' }]], from: 'c' } },
      { output: { id: '4', 'ty': ['Integer'], re: [55], to: 'c' } },
    );
  });

  it('@params — lineal form — mixed positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[3, { m: 4 }], 'mixedOpen'], 'ty': [['Integer', { m: 'Integer' }]], from: 'c' } },
      { output: { id: '5', 'ty': [{ sum: 'Integer' }], re: [{ sum: 7 }], to: 'c' } },
    );
  });

  it('@params — lineal form — multiple functions — @foo', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [[{ x: 1 }], 'foo'], 'ty': [[{ x: 'Integer' }]], from: 'c' } },
      { output: { id: '6', 'ty': [{ x: 'Integer' }], re: [{ x: 1 }], to: 'c' } },
    );
  });

  it('@params — lineal form — multiple functions — @bar', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: [[{ y: 2 }], 'bar'], 'ty': [[{ y: 'Integer' }]], from: 'c' } },
      { output: { id: '7', 'ty': [{ y: 'Integer' }], re: [{ y: 2 }], to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public params with defaults — delimited (pipe) form
  // ═══════════════════════════════════════════════════════════════════════════════

  it('@params — optional args — delimited (pipe) — positional default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3, 7], 'posOpt'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'ty': [{ sum: 'Integer' }], re: [{ sum: 10 }], to: 'c' } },
    );
  });

  it('@params — optional args — delimited (pipe) — positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3], 'posOpt'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '2', 'ty': [{ sum: 'Integer' }], re: [{ sum: 3 }], to: 'c' } },
    );
  });

  it('@params — optional args — delimited (pipe) — named default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[{ a: 3, b: 7 }], 'namedOpt'], 'ty': [[{ a: 'Integer', b: 'Integer' }]], from: 'c' } },
      { output: { id: '3', 'ty': [{ sum: 'Integer' }], re: [{ sum: 10 }], to: 'c' } },
    );
  });

  it('@params — optional args — delimited (pipe) — named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[{ a: 3 }], 'namedOpt'], 'ty': [[{ a: 'Integer' }]], from: 'c' } },
      { output: { id: '4', 'ty': [{ sum: 'Integer' }], re: [{ sum: 102 }], to: 'c' } },
    );
  });

  it('@params — optional args — delimited (pipe) — mixed — named omitted uses default', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[10], 'mixedOpt'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '5', 'ty': [{ sum: 'Integer' }], re: [{ sum: 60 }], to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public params with defaults — lineal form
  // ═══════════════════════════════════════════════════════════════════════════════

  it('@params — optional args — lineal form — lineal positional default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5, 3], 'posOptOpen'], 'ty': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'ty': [{ sum: 'Integer' }], re: [{ sum: 8 }], to: 'c' } },
    );
  });

  it('@params — optional args — lineal form — lineal positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[5], 'posOptOpen'], 'ty': [['Integer']], from: 'c' } },
      { output: { id: '2', 'ty': [{ sum: 'Integer' }], re: [{ sum: 5 }], to: 'c' } },
    );
  });

  it('@params — optional args — lineal form — lineal named default — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[{ a: 5, b: 3 }], 'namedOptOpen'], 'ty': [[{ a: 'Integer', b: 'Integer' }]], from: 'c' } },
      { output: { id: '3', 'ty': [{ sum: 'Integer' }], re: [{ sum: 8 }], to: 'c' } },
    );
  });

  it('@params — optional args — lineal form — lineal named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[{ a: 5 }], 'namedOptOpen'], 'ty': [[{ a: 'Integer' }]], from: 'c' } },
      { output: { id: '4', 'ty': [{ sum: 'Integer' }], re: [{ sum: 104 }], to: 'c' } },
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
    expect(() => compileSource('@go(n: Integer) -> :n\n')).toThrow(/Unexpected token after '@go'/);
  });

  it('// comment inside lineal params is ignored', () => {
    expect(() => compileSource(`
      @go
        =
        n: Integer
        // end params
        =
        -> :n
    `)).not.toThrow();
  });

  it('-- stitch inside lineal params is ignored', () => {
    expect(() => compileSource(`
      @go
        =
        n: Integer
        -- end params
        =
        -> :n
    `)).not.toThrow();
  });
});