import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Private function (lambda) param forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — all forms', () => {
  const script = `
    --- named via trailing colon ---

    @namedSigil
      =
      fn = (name:) { name }
      result Integer = fn(name: 42)
      return :result

    @namedTyped
      =
      fn = (n: Integer) { n * 2 }
      result Integer = fn(n: 5)
      return :result

    --- key-mapped ---

    @keyMapped
      =
      fn = (label: x) { x + 1 }
      result Integer = fn(label: 9)
      return :result

    @keyMappedTwo
      =
      fn = (first: a, last: b) { a + b }
      result Integer = fn(first: 3, last: 4)
      return :result

    @keyMappedTyped
      =
      fn = (label: x Integer) { x + 1 }
      result Integer = fn(label: 9)
      return :result

    --- mixed positional + named ---

    @mixedPosNamed
      =
      fn = (a, b:) { a + b }
      result Integer = fn(3, b: 4)
      return :result

    @twoNamed
      =
      fn = (a:, b:) { a + b }
      result Integer = fn(a: 10, b: 20)
      return :result

    --- positional ---

    @twoPosUntyped
      =
      fn = (a, b) { a + b }
      result Integer = fn(3, 4)
      return :result

    @twoPosTyped
      =
      fn = (a Integer, b Integer) { a + b }
      result Integer = fn(3, 4)
      return :result

    --- no params ---

    @noParam
      =
      fn = { 42 }
      result Integer = fn()
      return :result
  `;

  it('(:name) ->  binds named field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'namedSigil', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('(n: Integer) ->  typed sigil', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'namedTyped', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(label: x) ->  binds key to local name', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'keyMapped', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(first: a, last: b) ->  two key-mapped params', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'keyMappedTwo', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(label: x Integer) ->  key-mapped with type', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'keyMappedTyped', from: 'c' } },
      { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('(a, :b) ->  positional + named', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'mixedPosNamed', from: 'c' } },
      { output: { id: '6', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(:a, :b) ->  two named-only params', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'twoNamed', from: 'c' } },
      { output: { id: '7', 'ty': { result: 'Integer' }, re: { result: 30 }, to: 'c' } },
    );
  });

  it('(a, b) ->  untyped positional', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: 'twoPosUntyped', from: 'c' } },
      { output: { id: '8', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('(a Integer, b Integer) ->  typed positional', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: 'twoPosTyped', from: 'c' } },
      { output: { id: '9', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('no params — bare braces { 42 }', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: 'noParam', from: 'c' } },
      { output: { id: '10', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Prefix-colon param form retired 2026-05-10; trailing-colon is the new form
// ═══════════════════════════════════════════════════════════════════════════════

describe('function params — prefix-colon rejected, trailing-colon accepted', () => {
  it('(a:) ->  succeeds (trailing colon is the new form)', () => {
    expect(() => compileSource('f = (a:) -> a\n')).not.toThrow();
  });

  it('(a:, b:) ->  succeeds', () => {
    expect(() => compileSource('f = (a:, b:) -> a + b\n')).not.toThrow();
  });

  it('(a, b:) ->  succeeds', () => {
    expect(() => compileSource('f = (a, b:) -> a + b\n')).not.toThrow();
  });

  it('(:a) ->  prefix sigil fails', () => {
    expect(() => compileSource('f = (:a) -> a\n')).toThrow();
  });

  it('(:a, :b) ->  prefix sigil fails', () => {
    expect(() => compileSource('f = (:a, :b) -> a + b\n')).toThrow();
  });

  it('(a, :b) ->  prefix sigil fails', () => {
    expect(() => compileSource('f = (a, :b) -> a + b\n')).toThrow();
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
      return :result

    @posDefaultProvided
      =
      fn = (a, b Integer = 10) { a + b }
      result Integer = fn(3, 5)
      return :result

    --- inferred default ---

    @inferredDefault
      =
      fn = (a, b=100) { a + b }
      result Integer = fn(7)
      return :result

    --- named default ---

    @namedDefault
      =
      fn = (a: Integer, b: Integer = 50) { a + b }
      result Integer = fn(a: 3)
      return :result

    @namedDefaultProvided
      =
      fn = (a: Integer, b: Integer = 50) { a + b }
      result Integer = fn(a: 3, b: 7)
      return :result

    --- mixed positional + named default ---

    @mixedDefault
      =
      fn = (a, b: Integer = 20) { a + b }
      result Integer = fn(5)
      return :result

    --- string default ---

    @stringDefault
      =
      fn = (a: Text, b: Text = "world") { a + " " + b }
      result Text = fn(a: "hello")
      return :result
  `;

  it('positional default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'posDefault', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 13 }, to: 'c' } },
    );
  });

  it('positional default — provided', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'posDefaultProvided', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('inferred default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'inferredDefault', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 107 }, to: 'c' } },
    );
  });

  it('named default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'namedDefault', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 53 }, to: 'c' } },
    );
  });

  it('named default — provided', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'namedDefaultProvided', from: 'c' } },
      { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('mixed positional + named default — named omitted', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'mixedDefault', from: 'c' } },
      { output: { id: '6', 'ty': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });

  it('string default — omitted', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'stringDefault', from: 'c' } },
      { output: { id: '7', 'ty': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });
});

// An expression default runs in the callee once the other params are bound
// (notes/param-default-expressions-2026-11-10.md).
describe('function params — expression defaults', () => {
  const script = `
    double = (n Integer) { n * 2 }

    @sum = (a Integer, b Integer = 1 + 2) { a + b }
    @fromEarlier = (a Integer, b Integer = a * 2) { a + b }
    @fromLater = (a Integer = b + 1, b: Integer = 10) { a + b }
    @fromFile = (a Integer, b Integer = double(a)) { a + b }
    @negative = (b: Integer = -1) { b }
    @literals = (a Integer = 5, b: Integer = 10) { a + b }

    @local
      =
      fn = (a Integer, b Integer = a + 100) { a + b }
      result Integer = fn(3)
      return :result

    @localLater
      =
      fn = (a Integer = b + 1, b: Integer = 10) { a + b }
      result Integer = fn(b: 4)
      return :result
  `;
  const reads = (input, value) => expectBehavior(script,
    { input: { id: '1', ...input, from: 'c' } },
    { output: { id: '1', re: [value], to: 'c' } },
  );

  it('an omitted arg takes the expression', () => reads({ op: [[1], 'sum'], 'ty': [['Integer']] }, 4));
  it('a given arg wins', () => reads({ op: [[1, 5], 'sum'], 'ty': [['Integer', 'Integer']] }, 6));
  it('a default reads an earlier param', () => reads({ op: [[3], 'fromEarlier'], 'ty': [['Integer']] }, 9));
  it('a default reads a later param', () => reads({ op: 'fromLater' }, 21));
  it('a default reads a later param given by name', () => reads({ op: [{ b: 4 }, 'fromLater'], 'ty': [{ b: 'Integer' }] }, 9));
  it('a default calls a file-level function', () => reads({ op: [[3], 'fromFile'], 'ty': [['Integer']] }, 9));
  it('a negative literal default', () => reads({ op: 'negative' }, -1));
  it('an omitted positional with a named arg given', () => reads({ op: [{ b: 4 }, 'literals'], 'ty': [{ b: 'Integer' }] }, 9));
  it('a private function takes one too', () => expectBehavior(script,
    { input: { id: '1', op: 'local', from: 'c' } },
    { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 106 }, to: 'c' } },
  ));
  it('a private function\'s default reads a later param', () => expectBehavior(script,
    { input: { id: '1', op: 'localLater', from: 'c' } },
    { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 9 }, to: 'c' } },
  ));

  it('an untyped param with an expression default is an error', () => {
    expect(() => compileSource('@f = (a Integer, b = a + 1) { a + b }')).toThrow(/Param 'b': a default that isn't a literal needs a type/);
  });

  it('defaults that name each other are an error', () => {
    expect(() => compileSource('@f = (a Integer = b, b Integer = a) { a + b }')).toThrow(/Param defaults form a cycle: a → b → a/);
  });
});
