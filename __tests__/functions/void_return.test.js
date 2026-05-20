import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Void-returning public functions — wire form is `re: []` (empty positional reply).
// Two surface forms produce it:
//   (a) empty body block        `{}`
//   (b) empty object value   `()`     (with or without explicit `->`)
// Both yield the unassignable type `()`.
// ═══════════════════════════════════════════════════════════════════════════════

describe('void return — public functions, empty body {}', () => {
  const script = `
    --- delimited inline ---

    @inlineEmpty = () { }

    --- lineal header, delimited body ---

    @linealHeaderEmpty
      =
      { }
  `;

  it('inline delimited empty body — () { } replies re: []', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inlineEmpty', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [], to: 'c' }) },
    );
  });

  it('lineal header, empty {} body replies re: []', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@linealHeaderEmpty', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [], to: 'c' }) },
    );
  });
});

describe('void return — public functions, () as tail value', () => {
  const script = `
    --- delimited body, implicit () tail ---

    @delimImplicit = () { () }

    --- delimited body, explicit -> () with space ---

    @delimExplicit = () { -> () }

    --- delimited body, explicit ->() no space ---

    @delimTight = () { ->() }

    --- single-line inline -> () ---

    @inlineArrow = () -> ()

    --- lineal body, implicit () tail ---

    @linealImplicit
      =
      ()

    --- lineal body, explicit -> () ---

    @linealExplicit
      =
      -> ()

    --- lineal body, ->() tight ---

    @linealTight
      =
      ->()
  `;

  it('delimited body, implicit () tail', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@delimImplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [], to: 'c' }) },
    );
  });

  it('delimited body, explicit -> ()', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@delimExplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [], to: 'c' }) },
    );
  });

  it('delimited body, ->() no space', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@delimTight', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: [], to: 'c' }) },
    );
  });

  it('single-line inline -> ()', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@inlineArrow', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [], to: 'c' }) },
    );
  });

  it('lineal body, implicit () tail', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@linealImplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '5', re: [], to: 'c' }) },
    );
  });

  it('lineal body, explicit -> ()', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@linealExplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '6', re: [], to: 'c' }) },
    );
  });

  it('lineal body, ->() no space', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@linealTight', from: 'c' } },
      { output: expect.objectContaining({ id: '7', re: [], to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Private (lambda / lineal) functions — same forms, called from a wrapper handler.
// The wrapper discards the void result (you cannot bind it) and replies with "ok"
// so we can assert the call completed cleanly.
// ═══════════════════════════════════════════════════════════════════════════════

describe('void return — private functions, empty body {}', () => {
  const script = `
    @callEmptyLambda
      =
      fn = () { }
      fn()
      -> ack: "ok"
  `;

  it('private lambda with empty body — call completes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@callEmptyLambda', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { ack: 'ok' }, to: 'c' }) },
    );
  });
});

describe('void return — private functions, () as tail value', () => {
  // Inline (lambda) forms — lambdas declared inside the handler body.
  const lambdaScript = `
    @callDelimImplicit
      =
      fn = () { () }
      fn()
      -> ack: "ok"

    @callDelimExplicit
      =
      fn = () { -> () }
      fn()
      -> ack: "ok"

    @callInlineArrow
      =
      fn = () -> ()
      fn()
      -> ack: "ok"
  `;

  // Lineal-form private functions are declared at top level (not nested inside
  // a handler — that would promote them to top level and conflict).
  const linealScript = `
    voidImplicit
      =
      ()

    voidExplicit
      =
      -> ()

    voidTight
      =
      ->()

    @callLinealImplicit
      =
      voidImplicit()
      -> ack: "ok"

    @callLinealExplicit
      =
      voidExplicit()
      -> ack: "ok"

    @callLinealTight
      =
      voidTight()
      -> ack: "ok"
  `;

  it('lambda { () } — implicit tail', async () => {
    await expectBehavior(lambdaScript,
      { input: { id: '1', op: '@callDelimImplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { ack: 'ok' }, to: 'c' }) },
    );
  });

  it('lambda { -> () } — explicit return', async () => {
    await expectBehavior(lambdaScript,
      { input: { id: '2', op: '@callDelimExplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: { ack: 'ok' }, to: 'c' }) },
    );
  });

  it('lambda () -> () — single-line', async () => {
    await expectBehavior(lambdaScript,
      { input: { id: '3', op: '@callInlineArrow', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: { ack: 'ok' }, to: 'c' }) },
    );
  });

  it('lineal fn — implicit () tail', async () => {
    await expectBehavior(linealScript,
      { input: { id: '4', op: '@callLinealImplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: { ack: 'ok' }, to: 'c' }) },
    );
  });

  it('lineal fn — explicit -> ()', async () => {
    await expectBehavior(linealScript,
      { input: { id: '5', op: '@callLinealExplicit', from: 'c' } },
      { output: expect.objectContaining({ id: '5', re: { ack: 'ok' }, to: 'c' }) },
    );
  });

  it('lineal fn — ->() tight', async () => {
    await expectBehavior(linealScript,
      { input: { id: '6', op: '@callLinealTight', from: 'c' } },
      { output: expect.objectContaining({ id: '6', re: { ack: 'ok' }, to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors — `()` is the unassignable type. Binding it must fail.
// ═══════════════════════════════════════════════════════════════════════════════

describe('void return — compile errors', () => {
  it('cannot bind result of empty-body lambda to a typed name', () => {
    expect(() => compileSource(`
      @test
        =
        fn = () { }
        x Integer = fn()
        -> :x
    `)).toThrow(/cannot.*bind|unassignable|\(\)/i);
  });

  it('cannot bind result of -> () lambda', () => {
    expect(() => compileSource(`
      @test
        =
        fn = () -> ()
        x = fn()
        -> :x
    `)).toThrow(/cannot.*bind|unassignable|\(\)/i);
  });

  it('cannot use () as an argument to another function', () => {
    expect(() => compileSource(`
      @test
        =
        fn = () -> ()
        double = (n) -> n * 2
        result Integer = double(fn())
        -> :result
    `)).toThrow(/cannot.*use|unassignable|\(\)/i);
  });

  it('cannot use () in an arithmetic expression', () => {
    expect(() => compileSource(`
      @test
        =
        fn = () -> ()
        x Integer = 1 + fn()
        -> :x
    `)).toThrow(/cannot.*use|unassignable|\(\)/i);
  });

  it('cannot use () as a reply field value', () => {
    expect(() => compileSource(`
      @test
        =
        fn = () -> ()
        -> result: fn()
    `)).toThrow(/cannot.*use|unassignable|\(\)/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// `()` is a parser-level marker, not a value — even the literal form cannot
// appear in expression position. These currently fail at parse time (the
// expression parser refuses bare `()`); the rule is the same as for void-fn
// calls and matches the user-facing semantics.
// ═══════════════════════════════════════════════════════════════════════════════

describe('void return — `()` literal is non-assignable', () => {
  it('cannot bind `()` literal to a name', () => {
    expect(() => compileSource(`
      @test
        =
        x = ()
        -> :x
    `)).toThrow(/unexpected.*expression|unassignable|\(\)/i);
  });

  it('cannot use `()` literal as a function argument', () => {
    expect(() => compileSource(`
      noop = (a) -> a
      @test
        =
        result = noop(())
        -> :result
    `)).toThrow(/unexpected.*expression|unassignable|\(\)/i);
  });

  it('cannot use `()` literal in an arithmetic expression', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 1 + ()
        -> :x
    `)).toThrow(/unexpected.*expression|unassignable|\(\)/i);
  });

  it('cannot use `()` literal as a reply field value', () => {
    expect(() => compileSource(`
      @test
        =
        -> result: ()
    `)).toThrow(/unexpected.*expression|unassignable|\(\)/i);
  });
});
