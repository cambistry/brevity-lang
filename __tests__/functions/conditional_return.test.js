import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Block-body (lambda) functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return — block-body (lambda) functions', () => {
  const script = `
    @classify
      =
      fn = (a Integer) {
        if (a > 0) { -> "positive" }
        if (a < 0) { -> "negative" }
        -> "zero"
      }
      pos Text = fn(5)
      neg Text = fn(0 - 3)
      zero Text = fn(0)
      -> :pos, :neg, :zero

    @guards
      =
      singleGuard = (a Integer) {
        if (a > 10) { -> "big" }
        -> "small"
      }
      withLocals = (a Integer) {
        doubled = a * 2
        if (doubled > 10) { -> "over ten" }
        -> "under or equal"
      }
      big Text = singleGuard(100)
      small Text = singleGuard(1)
      hi Text = withLocals(6)
      lo Text = withLocals(3)
      -> :big, :small, :hi, :lo

    @elseClause
      =
      fn = (a Integer) {
        if (a > 0) { -> "positive" }
        else { -> "non-positive" }
      }
      yes Text = fn(5)
      no Text = fn(0 - 5)
      -> :yes, :no

    @nestedIf
      =
      fn = (a Integer) {
        if (a > 0) {
          if (a > 100) { -> "big" }
          -> "small positive"
        }
        -> "non-positive"
      }
      big Text = fn(200)
      small Text = fn(50)
      none Text = fn(0 - 1)
      -> :big, :small, :none

    @nestedIfElse
      =
      fn = (a Integer, b Integer) {
        if (a > 0) {
          if (b > 0) { -> "both positive" }
          else { -> "a positive b not" }
        }
        else { -> "a not positive" }
      }
      tt Text = fn(5, 3)
      tf Text = fn(5, 0 - 3)
      ff Text = fn(0 - 5, 3)
      -> :tt, :tf, :ff
  `;

  it('three-way classify: if-if-fallthrough', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@classify', from: 'c' } },
      { output: { id: '1', 'bv-a': { pos: 'Text', neg: 'Text', zero: 'Text' }, re: { pos: 'positive', neg: 'negative', zero: 'zero' }, to: 'c' } },
    );
  });

  it('single guard and guard-after-locals, all four cases', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@guards', from: 'c' } },
      { output: { id: '2', 'bv-a': { big: 'Text', small: 'Text', hi: 'Text', lo: 'Text' }, re: { big: 'big', small: 'small', hi: 'over ten', lo: 'under or equal' }, to: 'c' } },
    );
  });

  it('else clause — return from else branch', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@elseClause', from: 'c' } },
      { output: { id: '3', 'bv-a': { yes: 'Text', no: 'Text' }, re: { yes: 'positive', no: 'non-positive' }, to: 'c' } },
    );
  });

  it('nested if — inner if, outer body, fallthrough', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@nestedIf', from: 'c' } },
      { output: { id: '4', 'bv-a': { big: 'Text', small: 'Text', none: 'Text' }, re: { big: 'big', small: 'small positive', none: 'non-positive' }, to: 'c' } },
    );
  });

  it('nested if/else — all branches', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@nestedIfElse', from: 'c' } },
      { output: { id: '5', 'bv-a': { tt: 'Text', tf: 'Text', ff: 'Text' }, re: { tt: 'both positive', tf: 'a positive b not', ff: 'a not positive' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal functions — -> in block bodies has early-return semantics,
// top-level -> has reply semantics
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return — lineal functions', () => {
  const script = `
    @positive
      =
      result Text = classify(5)
      -> :result

    @negative
      =
      result Text = classify(0 - 3)
      -> :result

    @zero
      =
      result Text = classify(0)
      -> :result

    @singleGuardTrue
      =
      result Text = singleGuard(100)
      -> :result

    @singleGuardFalse
      =
      result Text = singleGuard(1)
      -> :result

    @withLocalsTrue
      =
      result Text = withLocals(6)
      -> :result

    @withLocalsFalse
      =
      result Text = withLocals(3)
      -> :result

    @elseTrue
      =
      result Text = elseReturn(5)
      -> :result

    @elseFalse
      =
      result Text = elseReturn(0 - 5)
      -> :result

    @nestedBig
      =
      result Text = nested(200)
      -> :result

    @nestedSmall
      =
      result Text = nested(50)
      -> :result

    @nestedNone
      =
      result Text = nested(0 - 1)
      -> :result

    @nestedElseTT
      =
      result Text = nestedElse(5, 3)
      -> :result

    @nestedElseTF
      =
      result Text = nestedElse(5, 0 - 3)
      -> :result

    @nestedElseFF
      =
      result Text = nestedElse(0 - 5, 3)
      -> :result

    classify
      =
      a Integer
      =
      if (a > 0) { -> "positive" }
      if (a < 0) { -> "negative" }
      -> "zero"

    singleGuard
      =
      a Integer
      =
      if (a > 10) { -> "big" }
      -> "small"

    withLocals
      =
      a Integer
      =
      doubled Integer = a * 2
      if (doubled > 10) { -> "over ten" }
      -> "under or equal"

    elseReturn
      =
      a Integer
      =
      if (a > 0) { -> "positive" }
      else { -> "non-positive" }
      -> "unreachable"

    nested
      =
      a Integer
      =
      if (a > 0) {
        if (a > 100) { -> "big" }
        -> "small positive"
      }
      -> "non-positive"

    nestedElse
      =
      a Integer
      b Integer
      =
      if (a > 0) {
        if (b > 0) { -> "both positive" }
        else { -> "a positive b not" }
      }
      else { -> "a not positive" }
      -> "unreachable"
  `;

  it('if (a > 0) → "positive" branch taken', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@positive', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'positive' }, to: 'c' } },
    );
  });

  it('if (a < 0) → "negative" branch taken', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@negative', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'negative' }, to: 'c' } },
    );
  });

  it('all conditions false → fallthrough "zero"', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@zero', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'zero' }, to: 'c' } },
    );
  });

  it('single guard — condition true → early return', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@singleGuardTrue', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'big' }, to: 'c' } },
    );
  });

  it('single guard — condition false → fallthrough', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@singleGuardFalse', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'small' }, to: 'c' } },
    );
  });

  it('guard after local assignment — condition true', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@withLocalsTrue', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: 'over ten' }, to: 'c' } },
    );
  });

  it('guard after local assignment — condition false → fallthrough', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: '@withLocalsFalse', from: 'c' } },
      { output: { id: '7', 'bv-a': { result: 'Text' }, re: { result: 'under or equal' }, to: 'c' } },
    );
  });

  it('else clause — condition true → if branch', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: '@elseTrue', from: 'c' } },
      { output: { id: '8', 'bv-a': { result: 'Text' }, re: { result: 'positive' }, to: 'c' } },
    );
  });

  it('else clause — condition false → else branch', async () => {
    await expectBehavior(script,
      { input: { id: '9', op: '@elseFalse', from: 'c' } },
      { output: { id: '9', 'bv-a': { result: 'Text' }, re: { result: 'non-positive' }, to: 'c' } },
    );
  });

  it('nested if — inner condition true → "big"', async () => {
    await expectBehavior(script,
      { input: { id: '10', op: '@nestedBig', from: 'c' } },
      { output: { id: '10', 'bv-a': { result: 'Text' }, re: { result: 'big' }, to: 'c' } },
    );
  });

  it('nested if — outer true inner false → "small positive"', async () => {
    await expectBehavior(script,
      { input: { id: '11', op: '@nestedSmall', from: 'c' } },
      { output: { id: '11', 'bv-a': { result: 'Text' }, re: { result: 'small positive' }, to: 'c' } },
    );
  });

  it('nested if — outer false → "non-positive"', async () => {
    await expectBehavior(script,
      { input: { id: '12', op: '@nestedNone', from: 'c' } },
      { output: { id: '12', 'bv-a': { result: 'Text' }, re: { result: 'non-positive' }, to: 'c' } },
    );
  });

  it('nested if/else — both positive', async () => {
    await expectBehavior(script,
      { input: { id: '13', op: '@nestedElseTT', from: 'c' } },
      { output: { id: '13', 'bv-a': { result: 'Text' }, re: { result: 'both positive' }, to: 'c' } },
    );
  });

  it('nested if/else — a positive b not', async () => {
    await expectBehavior(script,
      { input: { id: '14', op: '@nestedElseTF', from: 'c' } },
      { output: { id: '14', 'bv-a': { result: 'Text' }, re: { result: 'a positive b not' }, to: 'c' } },
    );
  });

  it('nested if/else — a not positive', async () => {
    await expectBehavior(script,
      { input: { id: '15', op: '@nestedElseFF', from: 'c' } },
      { output: { id: '15', 'bv-a': { result: 'Text' }, re: { result: 'a not positive' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Single-line form — if (cond) -> val  /  else -> val  (no curly braces)
// ═══════════════════════════════════════════════════════════════════════════════

describe('conditional return — single-line form (no curly braces)', () => {
  const script = `
    @lambdaGuard
      =
      fn = (a Integer) {
        if (a > 10) -> "big"
        -> "small"
      }
      big Text = fn(100)
      small Text = fn(1)
      -> :big, :small

    @lambdaIfElse
      =
      fn = (a Integer) {
        if (a > 0) -> "positive"
        else -> "non-positive"
      }
      pos Text = fn(5)
      neg Text = fn(0 - 5)
      -> :pos, :neg

    @linealGuardTrue
      =
      result Text = singleLineGuard(100)
      -> :result

    @linealGuardFalse
      =
      result Text = singleLineGuard(1)
      -> :result

    @linealIfElseTrue
      =
      result Text = singleLineElse(5)
      -> :result

    @linealIfElseFalse
      =
      result Text = singleLineElse(0 - 5)
      -> :result

    singleLineGuard
      =
      a Integer
      =
      if (a > 10) -> "big"
      -> "small"

    singleLineElse
      =
      a Integer
      =
      if (a > 0) -> "positive"
      else -> "non-positive"
  `;

  it('lambda: guard — condition true → early return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@lambdaGuard', from: 'c' } },
      { output: { id: '1', 'bv-a': { big: 'Text', small: 'Text' }, re: { big: 'big', small: 'small' }, to: 'c' } },
    );
  });

  it('lambda: if/else — both branches', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@lambdaIfElse', from: 'c' } },
      { output: { id: '2', 'bv-a': { pos: 'Text', neg: 'Text' }, re: { pos: 'positive', neg: 'non-positive' }, to: 'c' } },
    );
  });

  it('lineal: guard — condition true → early return', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@linealGuardTrue', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'big' }, to: 'c' } },
    );
  });

  it('lineal: guard — condition false → fallthrough', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@linealGuardFalse', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'small' }, to: 'c' } },
    );
  });

  it('lineal: if/else — condition true → if branch', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@linealIfElseTrue', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'positive' }, to: 'c' } },
    );
  });

  it('lineal: if/else — condition false → else branch', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@linealIfElseFalse', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: 'non-positive' }, to: 'c' } },
    );
  });
});
