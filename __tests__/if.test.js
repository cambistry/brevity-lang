import compile from '../index.js';
import { expectReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Boolean literals (truthiness)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Boolean literals', () => {
  const script = `
      @boolTrue = { result : Integer = if true 1 as Integer else 0 as Integer; -> :result }
      @boolFalse = { result : Integer = if false 1 as Integer else 0 as Integer; -> :result }
      @nullFalsy
        =
        cond : Integer | null = null
        result : Integer = if cond 1 as Integer else 0 as Integer
        -> :result
      @zeroTruthy
        =
        result : Integer = if 0 as Integer 1 as Integer else 99 as Integer
        -> :result
  `;

  it('true literal is truthy', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@boolTrue', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('false literal is falsy', async () => {
    await expectReply({
      script,
      receive: { id: '2', op: '@boolFalse', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' },
    });
  });

  it('null is falsy', async () => {
    await expectReply({
      script,
      receive: { id: '3', op: '@nullFalsy', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' },
    });
  });

  it('0 (integer zero) is truthy', async () => {
    await expectReply({
      script,
      receive: { id: '4', op: '@zeroTruthy', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Comparison operators
// ═══════════════════════════════════════════════════════════════════════════════

describe('Comparison operators', () => {
  const script = `
      @eqTrue
        =
        x : Integer = 5
        result : Integer = if x == 5 1 as Integer else 0 as Integer
        -> :result

      @neqTrue
        =
        x : Integer = 5
        result : Integer = if x != 3 1 as Integer else 0 as Integer
        -> :result

      @gtTrue
        =
        x : Integer = 10
        result : Integer = if x > 5 1 as Integer else 0 as Integer
        -> :result

      @ltTrue
        =
        x : Integer = 3
        result : Integer = if x < 5 1 as Integer else 0 as Integer
        -> :result

      @gteTrue
        =
        x : Integer = 5
        result : Integer = if x >= 5 1 as Integer else 0 as Integer
        -> :result

      @lteTrue
        =
        x : Integer = 5
        result : Integer = if x <= 5 1 as Integer else 0 as Integer
        -> :result
  `;

  it('== true case', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@eqTrue', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('!= true case', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@neqTrue', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('> true case', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@gtTrue', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('< true case', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@ltTrue', from: 'c' },
      reply: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('>= true case', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@gteTrue', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });

  it('<= true case', async () => {
    await expectReply({
      script, receive: { id: '6', op: '@lteTrue', from: 'c' },
      reply: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// if/else expression forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('if/else expression', () => {
  const script = `
      @singleLine
        =
        cond : Boolean = true
        x : Integer = if cond 10 as Integer else 20 as Integer
        -> result: x

      @blockForm
        =
        x : Integer = 1
        result : Text = if x == 1 {
          "abc" as Text
        } else {
          "def" as Text
        }
        -> :result

      @elseIf
        =
        x : Integer = 2
        result : Integer = if x == 1 10 as Integer else if x == 2 20 as Integer else 30 as Integer
        -> :result

      @shadow
        =
        x : Integer = 10
        result : Integer = if true {
          x : Integer = 99
        } else {
          0 as Integer
        }
        -> :x, :result

      @readOuter
        =
        x : Integer = 7
        result : Integer = if true {
          x
        } else {
          0 as Integer
        }
        -> :result
  `;

  it('single-line with type annotation on both branches', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@singleLine', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('block form — last expression is the value', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@blockForm', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'abc' }, to: 'c' },
    });
  });

  it('else if chain', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@elseIf', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' },
    });
  });

  it('inner block shadows outer variable; outer value is unchanged', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@shadow', from: 'c' },
      reply: { id: '4', 'bv-a': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c' },
    });
  });

  it('block reads outer scope variables', async () => {
    await expectReply({
      script, receive: { id: '5', op: '@readOuter', from: 'c' },
      reply: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// if without else + function call in branch
// ═══════════════════════════════════════════════════════════════════════════════

describe('if without else + function call', () => {
  const script = `
      @noElseFalse
        =
        result : Integer | null = if false 42 as Integer
        -> :result

      @noElseTrue
        =
        result : Integer | null = if true 42 as Integer
        -> :result

      @fnCallInIf
        =
        x : Integer = 5
        result : Integer = if x > 3 {
          result: sq : Integer = square(x)
          sq
        } else {
          0 as Integer
        }
        -> :result

      square
        =
        num : Integer
        =
        sq : Integer = num * num
        ->(result: sq : Integer)
  `;

  it('no-else if with false condition → result is null', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@noElseFalse', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' },
    });
  });

  it('no-else if with true condition → result is value', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@noElseTrue', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' },
    });
  });

  it('function call inside if block branch', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@fnCallInIf', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('if — compile errors', () => {
  it('plain assignment to outer-scope variable inside block → compile error', () => {
    expect(() => compile(`
      @test
        =
        x : Integer = 0
        result : Integer = if true {
          x = 1
        } else {
          x
        }
        -> :result
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('if without else assigned to non-nullable type → compile error', () => {
    expect(() => compile(`
      @test
        =
        result : Integer = if true 42 as Integer
        -> :result
    `)).toThrow(/if without else can return null/i);
  });

  it('mismatched branch types → compile error', () => {
    expect(() => compile(`
      @test
        =
        result : Integer = if true 1 as Integer else "text" as Text
        -> :result
    `)).toThrow(/branch type mismatch/i);
  });
});
