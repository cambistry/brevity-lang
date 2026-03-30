import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Delimited (pipe) param style — @name = |params| body
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — delimited (pipe)', () => {
  const script = `
    --- named sigil ---

    @singleNamed = |n: Integer| -> :n

    @twoNamed = |n: Integer, m: Integer| -> sum: (n + m) as Integer

    --- positional ---

    @singlePos = |n Integer| -> n as Integer
    @twoPos = |a Integer, b Integer| -> sum: (a + b) as Integer

    --- key-mapped ---

    @keyMapped = |a: (x) Integer| -> x as Integer
    --- mixed positional + named ---

    @mixedPosNamed = |a Integer, b: Integer| -> sum: (a + b) as Integer
  `;

  it('single named param :n : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '1', op: [{ n: 42 }, '@singleNamed'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'c' },
    });
  });

  it('two named params :n : Integer, :m : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '2', op: [{ n: 3, m: 4 }, '@twoNamed'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'c' },
      reply: { id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });

  it('positional param n : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '3', op: [[99], '@singlePos'], 'bv-a': [['Integer']], from: 'c' },
      reply: { id: '3', 'bv-a': ['Integer'], re: [99], to: 'c' },
    });
  });

  it('two positional params a : Integer, b : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '4', op: [[5, 6], '@twoPos'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      reply: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 11 }, to: 'c' },
    });
  });

  it('key-mapped a: x : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '5', op: [{ a: 77 }, '@keyMapped'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
      reply: { id: '5', 'bv-a': ['Integer'], re: [77], to: 'c' },
    });
  });

  it('mixed positional + named', async () => {
    await expectBehavior({
      script,
      receive: { id: '6', op: [[3, { b: 4 }], '@mixedPosNamed'], 'bv-a': [['Integer', { b: 'Integer' }]], from: 'c' },
      reply: { id: '6', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
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
      -> answer: "world" as Text

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
      -> sum: (a + b) as Integer

    --- key-mapped ---

    @keyMappedOpen
      =
      a: (x) Integer
      =
      -> x as Integer
    --- mixed positional + named ---

    @mixedOpen
      =
      n Integer
      m: Integer
      =
      -> sum: (n + m) as Integer

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
  `;

  it('no params — = opens body directly', async () => {
    await expectBehavior({
      script,
      receive: { id: '1', op: '@noParams', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' },
    });
  });

  it('single param :n : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '2', op: [{ n: 10 }, '@singleParam'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: { id: '2', 'bv-a': { n: 'Integer' }, re: { n: 10 }, to: 'c' },
    });
  });

  it('two params :a : Integer, :b : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '3', op: [{ a: 10, b: 20 }, '@twoParams'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '3', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' },
    });
  });

  it('key-mapped a: x : Integer', async () => {
    await expectBehavior({
      script,
      receive: { id: '4', op: [{ a: 55 }, '@keyMappedOpen'], 'bv-a': [{ a: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': ['Integer'], re: [55], to: 'c' },
    });
  });

  it('mixed positional + named', async () => {
    await expectBehavior({
      script,
      receive: { id: '5', op: [[3, { m: 4 }], '@mixedOpen'], 'bv-a': [['Integer', { m: 'Integer' }]], from: 'c' },
      reply: { id: '5', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });

  it('multiple functions — @foo', async () => {
    await expectBehavior({
      script,
      receive: { id: '6', op: [{ x: 1 }, '@foo'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '6', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' },
    });
  });

  it('multiple functions — @bar', async () => {
    await expectBehavior({
      script,
      receive: { id: '7', op: [{ y: 2 }, '@bar'], 'bv-a': [{ y: 'Integer' }], from: 'c' },
      reply: { id: '7', 'bv-a': { y: 'Integer' }, re: { y: 2 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('@params — compile errors', () => {
  it('same-line params without pipes → compile error', () => {
    expect(() => compileSource('@go n: Integer -> :n\n')).toThrow();
  });

  it('paren-style params → compile error', () => {
    expect(() => compileSource('@go(n: Integer) -> :n\n')).toThrow(/Unexpected token after '@go'/);
  });

  it('// with content does not terminate lineal form params', () => {
    expect(() => compileSource(`
      @go
        =
        n: Integer
        // end params
        -> :n
    `)).toThrow();
  });

  it('-- with content does not terminate lineal form params', () => {
    expect(() => compileSource(`
      @go
        =
        n: Integer
        -- end params
        -> :n
    `)).toThrow();
  });
});
