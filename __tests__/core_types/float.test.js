import { expectBehavior, compileActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Float arithmetic: +, -, *, /, %, **
// Floats are IEEE-754 double-precision. Division is normal floating-point
// division (no termination check). Exponentiation is supported.
// Mixed Float+Integer or Float+Decimal promotes to Float per-operation.
// All three numeric types are comparable: <, >, <=, >=, ==.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
    @add = |a Float, b Float| -> result: a + b
    @sub = |a Float, b Float| -> result: a - b
    @mul = |a Float, b Float| -> result: a * b
    @div = |a Float, b Float| -> result: a / b
    @rem = |a Float, b Float| -> result: a % b
    @exp = |a Float, b Float| -> result: a ** b
`;

function inpFF(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Float', 'Float']], from: 'c' } };
}
function inpFI(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Float', 'Integer']], from: 'c' } };
}
function inpIF(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Integer', 'Float']], from: 'c' } };
}
function inpFD(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Float', 'Decimal']], from: 'c' } };
}
function inpDF(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Decimal', 'Float']], from: 'c' } };
}
function out(result) {
  return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
}
function outBool(field, value) {
  return { output: { id: '1', 'bv-a': { [field]: 'Boolean' }, re: { [field]: value }, to: 'c' } };
}

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Float addition', () => {
  it('adds two positive floats', async () => {
    await expectBehavior(script, inpFF('@add', 1.5e0, 2.5e0), out(4.0));
  });

  it('adds with zero', async () => {
    await expectBehavior(script, inpFF('@add', 0.0e0, 5.5e0), out(5.5));
  });

  it('adds negative floats', async () => {
    await expectBehavior(script, inpFF('@add', -1.5e0, -2.5e0), out(-4.0));
  });

  it('adds mixed sign', async () => {
    await expectBehavior(script, inpFF('@add', 1.0e1, -3.0e0), out(7.0));
  });

  it('adds very small floats', async () => {
    await expectBehavior(script, inpFF('@add', 1.0e-10, 2.0e-10), out(3.0e-10));
  });

  it('adds very large floats', async () => {
    await expectBehavior(script, inpFF('@add', 1.0e100, 2.0e100), out(1.0e100 + 2.0e100));
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Float subtraction', () => {
  it('subtracts two positive floats', async () => {
    await expectBehavior(script, inpFF('@sub', 5.5e0, 2.3e0), out(5.5 - 2.3));
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, inpFF('@sub', 1.0e0, 3.5e0), out(-2.5));
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, inpFF('@sub', 7.7e0, 0.0e0), out(7.7));
  });

  it('subtracts negative from negative', async () => {
    await expectBehavior(script, inpFF('@sub', -5.0e0, -3.0e0), out(-2.0));
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Float multiplication', () => {
  it('multiplies two positive floats', async () => {
    await expectBehavior(script, inpFF('@mul', 2.5e0, 4.0e0), out(10.0));
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, inpFF('@mul', 9.9e1, 0.0e0), out(0.0));
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, inpFF('@mul', 3.14e0, 1.0e0), out(3.14));
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, inpFF('@mul', -2.5e0, 3.0e0), out(-7.5));
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, inpFF('@mul', -2.0e0, -3.5e0), out(7.0));
  });

  it('multiplies very large floats', async () => {
    await expectBehavior(script, inpFF('@mul', 1.0e150, 2.0e0), out(2.0e150));
  });

  it('multiplies very small floats', async () => {
    await expectBehavior(script, inpFF('@mul', 1.0e-150, 2.0e0), out(2.0e-150));
  });
});

// ─── Division ────────────────────────────────────────────────────────────────

describe('Float division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, inpFF('@div', 1.0e1, 2.0e0), out(5.0));
  });

  it('divides with fractional result', async () => {
    await expectBehavior(script, inpFF('@div', 7.0e0, 2.0e0), out(3.5));
  });

  it('divides 1/3 (no error, IEEE-754 approximation)', async () => {
    await expectBehavior(script, inpFF('@div', 1.0e0, 3.0e0), out(1 / 3));
  });

  it('divides negative by positive', async () => {
    await expectBehavior(script, inpFF('@div', -9.0e0, 2.0e0), out(-4.5));
  });

  it('divides by one', async () => {
    await expectBehavior(script, inpFF('@div', 3.14e0, 1.0e0), out(3.14));
  });

  it('divides small by large', async () => {
    await expectBehavior(script, inpFF('@div', 1.0e0, 1.0e6), out(1.0e-6));
  });
});

// ─── Remainder ───────────────────────────────────────────────────────────────

describe('Float remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, inpFF('@rem', 5.5e0, 2.0e0), out(1.5));
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, inpFF('@rem', 6.0e0, 3.0e0), out(0.0));
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, inpFF('@rem', -5.5e0, 2.0e0), out(-1.5));
  });

  it('remainder with fractional divisor', async () => {
    await expectBehavior(script, inpFF('@rem', 1.0e0, 3.0e-1), out(1.0 % 0.3));
  });
});

// ─── Exponentiation ──────────────────────────────────────────────────────────

describe('Float exponentiation', () => {
  it('basic power: 2.0 ** 3.0 = 8.0', async () => {
    await expectBehavior(script, inpFF('@exp', 2.0e0, 3.0e0), out(8.0));
  });

  it('power of zero: 5.0 ** 0.0 = 1.0', async () => {
    await expectBehavior(script, inpFF('@exp', 5.0e0, 0.0e0), out(1.0));
  });

  it('power of one: 7.0 ** 1.0 = 7.0', async () => {
    await expectBehavior(script, inpFF('@exp', 7.0e0, 1.0e0), out(7.0));
  });

  it('fractional exponent: 4.0 ** 0.5 = 2.0 (square root)', async () => {
    await expectBehavior(script, inpFF('@exp', 4.0e0, 5.0e-1), out(2.0));
  });

  it('negative exponent: 2.0 ** -1.0 = 0.5', async () => {
    await expectBehavior(script, inpFF('@exp', 2.0e0, -1.0e0), out(0.5));
  });

  it('fractional base and exponent: 2.5 ** 2.0 = 6.25', async () => {
    await expectBehavior(script, inpFF('@exp', 2.5e0, 2.0e0), out(6.25));
  });

  it('right-associative: 2.0 ** 3.0 ** 2.0 = 512.0', async () => {
    const rassocScript = `
        @rassoc = |a Float, b Float, c Float| -> result: a ** b ** c
    `;
    const inp = { input: { id: '1', op: [[2.0e0, 3.0e0, 2.0e0], '@rassoc'], 'bv-a': [['Float', 'Float', 'Float']], from: 'c' } };
    await expectBehavior(rassocScript, inp, out(512.0));
  });

  it('negative base even exponent: (-3.0) ** 2.0 = 9.0', async () => {
    await expectBehavior(script, inpFF('@exp', -3.0e0, 2.0e0), out(9.0));
  });
});

// ─── Mixed Float + Integer → Float ──────────────────────────────────────────

describe('Mixed Float and Integer arithmetic', () => {
  const mixedFIScript = `
      @addFI = |a Float, b Integer| -> result: a + b
      @subIF = |a Integer, b Float| -> result: a - b
      @mulFI = |a Float, b Integer| -> result: a * b
      @divIF = |a Integer, b Float| -> result: a / b
      @remFI = |a Float, b Integer| -> result: a % b
      @expFI = |a Float, b Integer| -> result: a ** b
      @expIF = |a Integer, b Float| -> result: a ** b
  `;

  it('Float + Integer = Float', async () => {
    await expectBehavior(mixedFIScript, inpFI('@addFI', 2.5e0, 3), out(5.5));
  });

  it('Integer - Float = Float', async () => {
    await expectBehavior(mixedFIScript, inpIF('@subIF', 10, 3.5e0), out(6.5));
  });

  it('Float * Integer = Float', async () => {
    await expectBehavior(mixedFIScript, inpFI('@mulFI', 2.5e0, 4), out(10.0));
  });

  it('Integer / Float = Float', async () => {
    await expectBehavior(mixedFIScript, inpIF('@divIF', 7, 2.0e0), out(3.5));
  });

  it('Float % Integer = Float', async () => {
    await expectBehavior(mixedFIScript, inpFI('@remFI', 5.5e0, 2), out(1.5));
  });

  it('Float ** Integer = Float', async () => {
    await expectBehavior(mixedFIScript, inpFI('@expFI', 2.5e0, 2), out(6.25));
  });

  it('Integer ** Float = Float', async () => {
    await expectBehavior(mixedFIScript, inpIF('@expIF', 4, 5.0e-1), out(2.0));
  });
});

// ─── Mixed Float + Decimal → Float ──────────────────────────────────────────

describe('Mixed Float and Decimal arithmetic', () => {
  const mixedFDScript = `
      @addFD = |a Float, b Decimal| -> result: a + b
      @subDF = |a Decimal, b Float| -> result: a - b
      @mulFD = |a Float, b Decimal| -> result: a * b
      @divDF = |a Decimal, b Float| -> result: a / b
      @remFD = |a Float, b Decimal| -> result: a % b
      @expFD = |a Float, b Decimal| -> result: a ** b
  `;

  it('Float + Decimal = Float', async () => {
    await expectBehavior(mixedFDScript, inpFD('@addFD', 2.5e0, 3.5), out(6.0));
  });

  it('Decimal - Float = Float', async () => {
    await expectBehavior(mixedFDScript, inpDF('@subDF', 10.5, 3.0e0), out(7.5));
  });

  it('Float * Decimal = Float', async () => {
    await expectBehavior(mixedFDScript, inpFD('@mulFD', 2.5e0, 4.0), out(10.0));
  });

  it('Decimal / Float = Float', async () => {
    await expectBehavior(mixedFDScript, inpDF('@divDF', 7.5, 2.0e0), out(3.75));
  });

  it('Float % Decimal = Float', async () => {
    await expectBehavior(mixedFDScript, inpFD('@remFD', 5.5e0, 2.0), out(1.5));
  });

  it('Float ** Decimal = Float', async () => {
    await expectBehavior(mixedFDScript, inpFD('@expFD', 4.0e0, 0.5), out(2.0));
  });
});

// ─── Per-operation promotion (not whole-expression) ─────────────────────────
// Each operation promotes independently: (Int + Float) * Int
// The first op promotes to Float, the second op promotes that Float + Int → Float.

describe('Per-operation type promotion', () => {
  const perOpScript = `
      @chain = |a Integer, b Float, c Integer| -> result: (a + b) * c
  `;

  it('(Integer + Float) * Integer → Float (per-op promotion)', async () => {
    const inp = { input: { id: '1', op: [[2, 1.5e0, 4], '@chain'], 'bv-a': [['Integer', 'Float', 'Integer']], from: 'c' } };
    await expectBehavior(perOpScript, inp, out(14.0));
  });

  const perOpScript2 = `
      @chain2 = |a Decimal, b Float, c Decimal| -> result: (a + b) * c
  `;

  it('(Decimal + Float) * Decimal → Float (per-op promotion)', async () => {
    const inp = { input: { id: '1', op: [[2.0, 1.5e0, 4.0], '@chain2'], 'bv-a': [['Decimal', 'Float', 'Decimal']], from: 'c' } };
    await expectBehavior(perOpScript2, inp, out(14.0));
  });
});

// ─── Order of operations ────────────────────────────────────────────────────

describe('Float order of operations', () => {
  const precedenceScript = `
      @mulBeforeAdd = |a Float, b Float, c Float| -> result: a + b * c
      @parenAdd = |a Float, b Float, c Float| -> result: (a + b) * c
      @expBeforeMul = |a Float, b Float, c Float| -> result: a * b ** c
      @leftAssocSub = |a Float, b Float, c Float| -> result: a - b - c
      @leftAssocDiv = |a Float, b Float, c Float| -> result: a / b / c
      @rightAssocExp = |a Float, b Float, c Float| -> result: a ** b ** c
  `;
  function inpF3(op, a, b, c) {
    return { input: { id: '1', op: [[a, b, c], op], 'bv-a': [['Float', 'Float', 'Float']], from: 'c' } };
  }

  it('multiplication before addition: 2.0 + 3.0 * 4.0 = 14.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@mulBeforeAdd', 2.0e0, 3.0e0, 4.0e0), out(14.0));
  });

  it('parentheses override: (2.0 + 3.0) * 4.0 = 20.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@parenAdd', 2.0e0, 3.0e0, 4.0e0), out(20.0));
  });

  it('** binds tighter than *: 2.0 * 3.0 ** 2.0 = 18.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@expBeforeMul', 2.0e0, 3.0e0, 2.0e0), out(18.0));
  });

  it('subtraction is left-associative: 10.0 - 3.0 - 2.0 = 5.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@leftAssocSub', 1.0e1, 3.0e0, 2.0e0), out(5.0));
  });

  it('division is left-associative: 24.0 / 4.0 / 2.0 = 3.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@leftAssocDiv', 2.4e1, 4.0e0, 2.0e0), out(3.0));
  });

  it('** is right-associative: 2.0 ** 3.0 ** 2.0 = 512.0', async () => {
    await expectBehavior(precedenceScript, inpF3('@rightAssocExp', 2.0e0, 3.0e0, 2.0e0), out(512.0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-type comparisons: Float, Integer, Decimal
// All three numeric types are comparable with <, >, <=, >=, ==.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Float-Float comparisons', () => {
  const cmpScript = `
      @lt  = |a Float, b Float| -> result: a < b
      @gt  = |a Float, b Float| -> result: a > b
      @lte = |a Float, b Float| -> result: a <= b
      @gte = |a Float, b Float| -> result: a >= b
      @eq  = |a Float, b Float| -> result: a == b
  `;

  it('3.0 < 4.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@lt', 3.0e0, 4.0e0), outBool('result', true));
  });

  it('4.0 < 3.0 is false', async () => {
    await expectBehavior(cmpScript, inpFF('@lt', 4.0e0, 3.0e0), outBool('result', false));
  });

  it('5.0 > 2.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@gt', 5.0e0, 2.0e0), outBool('result', true));
  });

  it('2.0 > 5.0 is false', async () => {
    await expectBehavior(cmpScript, inpFF('@gt', 2.0e0, 5.0e0), outBool('result', false));
  });

  it('3.0 <= 3.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@lte', 3.0e0, 3.0e0), outBool('result', true));
  });

  it('3.0 <= 4.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@lte', 3.0e0, 4.0e0), outBool('result', true));
  });

  it('4.0 <= 3.0 is false', async () => {
    await expectBehavior(cmpScript, inpFF('@lte', 4.0e0, 3.0e0), outBool('result', false));
  });

  it('5.0 >= 5.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@gte', 5.0e0, 5.0e0), outBool('result', true));
  });

  it('5.0 >= 4.0 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@gte', 5.0e0, 4.0e0), outBool('result', true));
  });

  it('4.0 >= 5.0 is false', async () => {
    await expectBehavior(cmpScript, inpFF('@gte', 4.0e0, 5.0e0), outBool('result', false));
  });

  it('3.14 == 3.14 is true', async () => {
    await expectBehavior(cmpScript, inpFF('@eq', 3.14e0, 3.14e0), outBool('result', true));
  });

  it('3.14 == 3.15 is false', async () => {
    await expectBehavior(cmpScript, inpFF('@eq', 3.14e0, 3.15e0), outBool('result', false));
  });
});

describe('Float-Integer comparisons', () => {
  const cmpFIScript = `
      @ltFI  = |a Float, b Integer| -> result: a < b
      @gtIF  = |a Integer, b Float| -> result: a > b
      @lteFI = |a Float, b Integer| -> result: a <= b
      @gteIF = |a Integer, b Float| -> result: a >= b
      @eqFI  = |a Float, b Integer| -> result: a == b
  `;

  it('2.5 < 3 is true (Float < Integer)', async () => {
    await expectBehavior(cmpFIScript, inpFI('@ltFI', 2.5e0, 3), outBool('result', true));
  });

  it('3 > 2.5 is true (Integer > Float)', async () => {
    await expectBehavior(cmpFIScript, inpIF('@gtIF', 3, 2.5e0), outBool('result', true));
  });

  it('3.0 <= 3 is true (Float <= Integer)', async () => {
    await expectBehavior(cmpFIScript, inpFI('@lteFI', 3.0e0, 3), outBool('result', true));
  });

  it('3 >= 3.0 is true (Integer >= Float)', async () => {
    await expectBehavior(cmpFIScript, inpIF('@gteIF', 3, 3.0e0), outBool('result', true));
  });

  it('3.0 == 3 is true (Float == Integer)', async () => {
    await expectBehavior(cmpFIScript, inpFI('@eqFI', 3.0e0, 3), outBool('result', true));
  });

  it('3.1 == 3 is false (Float == Integer)', async () => {
    await expectBehavior(cmpFIScript, inpFI('@eqFI', 3.1e0, 3), outBool('result', false));
  });
});

describe('Float-Decimal comparisons', () => {
  const cmpFDScript = `
      @ltFD  = |a Float, b Decimal| -> result: a < b
      @gtDF  = |a Decimal, b Float| -> result: a > b
      @lteFD = |a Float, b Decimal| -> result: a <= b
      @gteDF = |a Decimal, b Float| -> result: a >= b
      @eqFD  = |a Float, b Decimal| -> result: a == b
  `;

  it('2.5 < 3.0 is true (Float < Decimal)', async () => {
    await expectBehavior(cmpFDScript, inpFD('@ltFD', 2.5e0, 3.0), outBool('result', true));
  });

  it('3.0 > 2.5 is true (Decimal > Float)', async () => {
    await expectBehavior(cmpFDScript, inpDF('@gtDF', 3.0, 2.5e0), outBool('result', true));
  });

  it('3.0 <= 3.0 is true (Float <= Decimal)', async () => {
    await expectBehavior(cmpFDScript, inpFD('@lteFD', 3.0e0, 3.0), outBool('result', true));
  });

  it('3.0 >= 3.0 is true (Decimal >= Float)', async () => {
    await expectBehavior(cmpFDScript, inpDF('@gteDF', 3.0, 3.0e0), outBool('result', true));
  });

  it('2.5 == 2.5 is true (Float == Decimal)', async () => {
    await expectBehavior(cmpFDScript, inpFD('@eqFD', 2.5e0, 2.5), outBool('result', true));
  });

  it('2.5 == 2.6 is false (Float == Decimal)', async () => {
    await expectBehavior(cmpFDScript, inpFD('@eqFD', 2.5e0, 2.6), outBool('result', false));
  });
});

// ─── IEEE-754 behavior (Float is NOT exact) ─────────────────────────────────
// These tests document that Float intentionally has floating-point imprecision,
// in contrast to Decimal which is exact.

describe('Float IEEE-754 behavior', () => {
  it('0.1 + 0.2 != 0.3 (expected IEEE-754 imprecision)', async () => {
    // This is the classic floating-point example — Float does NOT fix this.
    await expectBehavior(script, inpFF('@add', 1.0e-1, 2.0e-1), out(0.1 + 0.2));
  });

  it('1/3 is representable (approximate)', async () => {
    await expectBehavior(script, inpFF('@div', 1.0e0, 3.0e0), out(1 / 3));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Float type conversions: to_integer, to_decimal
// Float.to_integer(x) → Integer (truncates toward zero)
// Float.to_decimal(x) → Decimal
// Also available as dot methods on Float! ref cells.
// to_float on Float is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Float type conversions', () => {
  const convScript = `
      @toInteger = |x Float| -> result: Float.to_integer(x)
      @toDecimal = |x Float| -> result: Float.to_decimal(x)
      @toSelf = |x Float| -> result: Float.to_float(x)
  `;

  function inpF(op, a) {
    return { input: { id: '1', op: [[a], op], 'bv-a': [['Float']], from: 'c' } };
  }
  function outI(result) {
    return { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result }, to: 'c' } };
  }
  function outD(result) {
    return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
  }

  it('to_integer(3.7) = 3 (truncates toward zero)', async () => {
    await expectBehavior(convScript, inpF('@toInteger', 3.7e0), outI(3));
  });

  it('to_integer(-3.7) = -3 (truncates toward zero)', async () => {
    await expectBehavior(convScript, inpF('@toInteger', -3.7e0), outI(-3));
  });

  it('to_integer(0.0) = 0', async () => {
    await expectBehavior(convScript, inpF('@toInteger', 0.0e0), outI(0));
  });

  it('to_integer(5.0) = 5', async () => {
    await expectBehavior(convScript, inpF('@toInteger', 5.0e0), outI(5));
  });

  it('to_decimal(3.14) = 3.14', async () => {
    await expectBehavior(convScript, inpF('@toDecimal', 3.14e0), outD(3.14));
  });

  it('to_decimal(0.0) = 0.0', async () => {
    await expectBehavior(convScript, inpF('@toDecimal', 0.0e0), outD(0));
  });

  it('to_decimal(-2.5) = -2.5', async () => {
    await expectBehavior(convScript, inpF('@toDecimal', -2.5e0), outD(-2.5));
  });

  it('to_float(1.5) = 1.5 (identity)', async () => {
    await expectBehavior(convScript, inpF('@toSelf', 1.5e0), out(1.5));
  });
});

describe('Float conversion via ref cell dot method', () => {
  const refScript = `
      @toInteger = { x Float! = 3.7e0; -> result: x.to_integer }
      @toDecimal = { x Float! = 2.5e0; -> result: x.to_decimal }
  `;

  function outI(result) {
    return { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result }, to: 'c' } };
  }
  function outD(result) {
    return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
  }

  it('x.to_integer on Float! ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toInteger', from: 'c' } }, outI(3));
  });

  it('x.to_decimal on Float! ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toDecimal', from: 'c' } }, outD(2.5));
  });
});
