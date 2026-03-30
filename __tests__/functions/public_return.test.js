import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Same-line + delimited return forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — same-line + delimited', () => {
  const script = `
    --- same-line no-paren ---

    @typedPos
      =
      n: Integer
      =
      -> n as Integer
    @twoBarePos
      =
      x: Integer
      y: Integer
      =
      -> x, y

    @sigilReturn
      =
      a: Integer
      b: Integer
      =
      -> :a, :b

    @keyValueReturn
      =
      a: Integer
      b: Integer
      =
      -> result: (a + b) as Integer

    --- delimited paren form ---

    @denseComputed = |a: Integer, b: Integer|
      ->(c: (a + b) as Integer)

    @denseMultiPos = |a: Integer, b: Integer|
      ->(a as Integer, b as Integer)

    @denseNamedParen = |a: Integer, b: Integer|
      ->(:a, :b)

    --- literal returns ---

    @stringLiteral = -> "Hello from Brevity!" as Text

    @numLiteral = -> 42 as Integer

    @boolLiteral = -> true as Boolean

    @stringKeyVal = -> msg: "hello" as Text
  `;

  it('-> n : Integer — typed positional', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 7 }, '@typedPos'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [7], to: 'c' } },
    );
  });

  it('-> x, y — two bare positionals', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ x: 3, y: 4 }, '@twoBarePos'], 'bv-a': [{ x: 'Integer', y: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer', 'Integer'], re: [3, 4], to: 'c' } },
    );
  });

  it('-> :a, :b — sigil no-paren', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 10, b: 20 }, '@sigilReturn'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 10, b: 20 }, to: 'c' } },
    );
  });

  it('-> result: (a + b) as Integer — key-value', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 5, b: 6 }, '@keyValueReturn'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'c' } },
    );
  });

  it('->(c: (a + b) as Integer) — delimited computed', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [{ a: 3, b: 4 }, '@denseComputed'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '5', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' } },
    );
  });

  it('->(a as Integer, b as Integer) — delimited multi-positional', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [{ a: 8, b: 9 }, '@denseMultiPos'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '6', 'bv-a': ['Integer', 'Integer'], re: [8, 9], to: 'c' } },
    );
  });

  it('->(:a, :b) — delimited named paren', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: [{ a: 11, b: 22 }, '@denseNamedParen'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '7', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 11, b: 22 }, to: 'c' } },
    );
  });

  it('-> "Hello from Brevity!" as Text — string literal', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@stringLiteral', from: 'c' } },
      { output: { id: '8', 'bv-a': ['Text'], re: ['Hello from Brevity!'], to: 'c' } },
    );
  });

  it('-> 42 as Integer — number literal', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@numLiteral', from: 'c' } },
      { output: { id: '9', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('-> true as Boolean — boolean literal', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@boolLiteral', from: 'c' } },
      { output: { id: '10', 'bv-a': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('-> msg: "hello" as Text — string key-value', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@stringKeyVal', from: 'c' } },
      { output: { id: '11', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal return style
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — lineal form', () => {
  const script = `
    --- single named field on next line ---

    @spaciousSingle
      =
      a: Integer
      =
      ->
      :a

    --- two named fields, blank-line terminated ---

    @spaciousTwo
      =
      a: Integer
      b: Integer
      =
      ->
      :a
      :b

    --- lineal with typed key-value via private function ---

    @spaciousKeyValue
      =
      result: x = sub()
      -> :x

    sub
      =
      ->
        result: 99 as Integer

    --- terminated by -- comment ---

    @spaciousDashTerm
      =
      a: Integer
      =
      ->
      :a
      --

    --- ->() empty parens — next function follows immediately ---

    @emptyParens
      =
      ->()
    @afterEmpty
      =
      -> answer: "pong" as Text

    --- -- terminator allows next function to follow ---

    @spaciousDashNext
      =
      result: x = val()
      ->
      :x
      --
    val
      =
      -> result: 5 as Integer

    --- whitespace-only blank line terminates ---

    @greet
      =
      ->
      msg: "hello" as Text
    ${'  '}
    @ping
      =
      -> status: "ok" as Text
  `;

  it('-> \\n :a — single named field on next line', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 7 }, '@spaciousSingle'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { a: 'Integer' }, re: { a: 7 }, to: 'c' } },
    );
  });

  it('-> \\n :a \\n :b — two named fields, blank-line terminated', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ a: 3, b: 4 }, '@spaciousTwo'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 3, b: 4 }, to: 'c' } },
    );
  });

  it('lineal -> with typed key-value from private function', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@spaciousKeyValue', from: 'c' } },
      { output: { id: '3', re: { x: 99 }, to: 'c' } },
    );
  });

  it('lineal -> terminated by -- comment', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 21 }, '@spaciousDashTerm'], 'bv-a': [{ a: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { a: 'Integer' }, re: { a: 21 }, to: 'c' } },
    );
  });

  it('->() empty parens — next function follows immediately', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@afterEmpty', from: 'c' } },
      { output: { id: '5', 'bv-a': { answer: 'Text' }, re: { answer: 'pong' }, to: 'c' } },
    );
  });

  it('-- terminator allows next function to follow', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@spaciousDashNext', from: 'c' } },
      { output: { id: '6', re: { x: 5 }, to: 'c' } },
    );
  });

  it('whitespace-only blank line terminates lineal reply — @greet', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@greet', from: 'c' } },
      { output: { id: '7', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' } },
    );
  });

  it('whitespace-only blank line terminates lineal reply — @ping', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@ping', from: 'c' } },
      { output: { id: '8', 'bv-a': { status: 'Text' }, re: { status: 'ok' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('public function return — compile errors', () => {
  it('same-line field then continuation on next line → ambiguous', () => {
    expect(() => compileSource(`
      @go
        =
        a: Integer
        b: Integer
        =
        -> :a
        :b
    `)).toThrow();
  });

  it('lineal -> not terminated before next declaration', () => {
    expect(() => compileSource(`
      @go
        =
        result: x = val()
        ->
        :x
      val
        =
        -> result: 5 as Integer
    `)).toThrow();
  });
});
