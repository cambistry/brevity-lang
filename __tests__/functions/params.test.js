import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private function (lambda) param forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — all forms', () => {
  const script = `
    --- named via trailing colon ---

    @namedSigil
      =
      fn = (:name) { name }
      result Integer = fn(name: 42)
      -> :result

    @namedTyped
      =
      fn = (:n Integer) { n * 2 }
      result Integer = fn(n: 5)
      -> :result

    --- key-mapped ---

    @keyMapped
      =
      fn = (label: (x)) { x + 1 }
      result Integer = fn(label: 9)
      -> :result

    @keyMappedTwo
      =
      fn = (first: (a), last: (b)) { a + b }
      result Integer = fn(first: 3, last: 4)
      -> :result

    @keyMappedTyped
      =
      fn = (label: (x) Integer) { x + 1 }
      result Integer = fn(label: 9)
      -> :result

    --- mixed positional + named ---

    @mixedPosNamed
      =
      fn = (a, :b) { a + b }
      result Integer = fn(3, b: 4)
      -> :result

    @twoNamed
      =
      fn = (:a, :b) { a + b }
      result Integer = fn(a: 10, b: 20)
      -> :result

    --- positional ---

    @twoPosUntyped
      =
      fn = (a, b) { a + b }
      result Integer = fn(3, 4)
      -> :result

    @twoPosTyped
      =
      fn = (a Integer, b Integer) { a + b }
      result Integer = fn(3, 4)
      -> :result

    --- no params ---

    @noParam
      =
      fn = { 42 }
      result Integer = fn()
      -> :result
  `;

  it('(:name) ->  binds named field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@namedSigil', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('(:n Integer) ->  typed sigil', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@namedTyped', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(label: x) ->  binds key to local name', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@keyMapped', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(first: a, last: b) ->  two key-mapped params', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@keyMappedTwo', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(label: (x) Integer) ->  key-mapped with type', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@keyMappedTyped', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(a, :b) ->  positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@mixedPosNamed', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(:a, :b) ->  two named-only params', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@twoNamed', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });

  it('(a, b) ->  untyped positional', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@twoPosUntyped', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(a Integer, b Integer) ->  typed positional', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@twoPosTyped', from: 'c' } },
      { output: { id: '9', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('no params — bare braces { 42 }', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@noParam', from: 'c' } },
      { output: { id: '10', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Trailing-colon named params are no longer valid
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — trailing colon rejected', () => {
  it('(:a) ->  succeeds (prefix sigil is the new form)', () => {
    expect(() => compileSource('f = (:a) -> a\n')).not.toThrow();
  });

  it('(:a, :b) ->  succeeds', () => {
    expect(() => compileSource('f = (:a, :b) -> a + b\n')).not.toThrow();
  });

  it('(a, :b) ->  succeeds', () => {
    expect(() => compileSource('f = (a, :b) -> a + b\n')).not.toThrow();
  });

  it('(a:) ->  trailing colon fails', () => {
    expect(() => compileSource('f = (a:) -> a\n')).toThrow();
  });

  it('(a:, b:) ->  trailing colon fails', () => {
    expect(() => compileSource('f = (a:, b:) -> a + b\n')).toThrow();
  });

  it('(a, b:) ->  trailing colon fails', () => {
    expect(() => compileSource('f = (a, b:) -> a + b\n')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lambda params with defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — optional defaults', () => {
  const script = `
    --- positional default ---

    @posDefault
      =
      fn = (a, b Integer = 10) { a + b }
      result Integer = fn(3)
      -> :result

    @posDefaultProvided
      =
      fn = (a, b Integer = 10) { a + b }
      result Integer = fn(3, 5)
      -> :result

    --- inferred default ---

    @inferredDefault
      =
      fn = (a, b=100) { a + b }
      result Integer = fn(7)
      -> :result

    --- named default ---

    @namedDefault
      =
      fn = (:a Integer, :b Integer = 50) { a + b }
      result Integer = fn(a: 3)
      -> :result

    @namedDefaultProvided
      =
      fn = (:a Integer, :b Integer = 50) { a + b }
      result Integer = fn(a: 3, b: 7)
      -> :result

    --- mixed positional + named default ---

    @mixedDefault
      =
      fn = (a, :b Integer = 20) { a + b }
      result Integer = fn(5)
      -> :result

    --- string default ---

    @stringDefault
      =
      fn = (:a Text, :b Text = "world") { a + " " + b }
      result Text = fn(a: "hello")
      -> :result
  `;

  it('positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@posDefault', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('positional default — provided', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@posDefaultProvided', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('inferred default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@inferredDefault', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 107 }, to: 'c' } },
    );
  });

  it('named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@namedDefault', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 53 }, to: 'c' } },
    );
  });

  it('named default — provided', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@namedDefaultProvided', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('mixed positional + named default — named omitted', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@mixedDefault', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });

  it('string default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@stringDefault', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });
});
