import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Float arithmetic: +, -, *, /, %, ^
// Floats are IEEE-754 double-precision. Division is normal floating-point
// division (no termination check). Exponentiation is supported.
// Mixed Float+Integer or Float+Decimal promotes to Float per-operation.
// All three numeric types are comparable: <, >, <=, >=, ==.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
    @add = (a Float, b Float) -> result: a + b
    @sub = (a Float, b Float) -> result: a - b
    @mul = (a Float, b Float) -> result: a * b
    @div = (a Float, b Float) -> result: a / b
    @rem = (a Float, b Float) -> result: a % b
    @exp = (a Float, b Float) -> result: a ^ b

    // rassoc
    @rassoc = (a Float, b Float, c Float) -> result: a ^ b ^ c

    // mixedFI
    @addFI = (a Float, b Integer) -> result: a + b
    @subIF = (a Integer, b Float) -> result: a - b
    @mulFI = (a Float, b Integer) -> result: a * b
    @divIF = (a Integer, b Float) -> result: a / b
    @remFI = (a Float, b Integer) -> result: a % b
    @expFI = (a Float, b Integer) -> result: a ^ b
    @expIF = (a Integer, b Float) -> result: a ^ b

    // mixedFD
    @addFD = (a Float, b Decimal) -> result: a + b
    @subDF = (a Decimal, b Float) -> result: a - b
    @mulFD = (a Float, b Decimal) -> result: a * b
    @divDF = (a Decimal, b Float) -> result: a / b
    @remFD = (a Float, b Decimal) -> result: a % b
    @expFD = (a Float, b Decimal) -> result: a ^ b

    // perOp
    @chain = (a Integer, b Float, c Integer) -> result: (a + b) * c

    // perOp2
    @chain2 = (a Decimal, b Float, c Decimal) -> result: (a + b) * c

    // precedence
    @mulBeforeAdd = (a Float, b Float, c Float) -> result: a + b * c
    @parenAdd = (a Float, b Float, c Float) -> result: (a + b) * c
    @expBeforeMul = (a Float, b Float, c Float) -> result: a * b ^ c
    @leftAssocSub = (a Float, b Float, c Float) -> result: a - b - c
    @leftAssocDiv = (a Float, b Float, c Float) -> result: a / b / c
    @rightAssocExp = (a Float, b Float, c Float) -> result: a ^ b ^ c

    // cmp
    @lt  = (a Float, b Float) -> result: a < b
    @gt  = (a Float, b Float) -> result: a > b
    @lte = (a Float, b Float) -> result: a <= b
    @gte = (a Float, b Float) -> result: a >= b
    @eq  = (a Float, b Float) -> result: a == b

    // cmpFI
    @ltFI  = (a Float, b Integer) -> result: a < b
    @gtIF  = (a Integer, b Float) -> result: a > b
    @lteFI = (a Float, b Integer) -> result: a <= b
    @gteIF = (a Integer, b Float) -> result: a >= b
    @eqFI  = (a Float, b Integer) -> result: a == b

    // cmpFD
    @ltFD  = (a Float, b Decimal) -> result: a < b
    @gtDF  = (a Decimal, b Float) -> result: a > b
    @lteFD = (a Float, b Decimal) -> result: a <= b
    @gteDF = (a Decimal, b Float) -> result: a >= b
    @eqFD  = (a Float, b Decimal) -> result: a == b

    // conv
    @toInteger = (x Float) -> result: Float.to_integer(x)
    @toDecimal = (x Float) -> result: Float.to_decimal(x)
    @toSelf = (x Float) -> result: Float.to_float(x)

    // ref
    @refToInteger = { x *Float = 3.7e0; return result: x.to_integer }
    @refToDecimal = { x *Float = 2.5e0; return result: x.to_decimal }
`;

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Float addition', () => {
  it('adds two positive floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.5e0, 2.5e0], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 4.0 }], to: 'c' } });
  });

  it('adds with zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0e0, 5.5e0], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 5.5 }], to: 'c' } });
  });

  it('adds negative floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-1.5e0, -2.5e0], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -4.0 }], to: 'c' } });
  });

  it('adds mixed sign', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e1, -3.0e0], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 7.0 }], to: 'c' } });
  });

  it('adds very small floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e-10, 2.0e-10], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.0e-10 }], to: 'c' } });
  });

  it('adds very large floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e100, 2.0e100], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.0e100 + 2.0e100 }], to: 'c' } });
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Float subtraction', () => {
  it('subtracts two positive floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5e0, 2.3e0], 'sub'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 5.5 - 2.3 }], to: 'c' } });
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e0, 3.5e0], 'sub'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -2.5 }], to: 'c' } });
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.7e0, 0.0e0], 'sub'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 7.7 }], to: 'c' } });
  });

  it('subtracts negative from negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-5.0e0, -3.0e0], 'sub'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -2.0 }], to: 'c' } });
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Float multiplication', () => {
  it('multiplies two positive floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 4.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 10.0 }], to: 'c' } });
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[9.9e1, 0.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0.0 }], to: 'c' } });
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14e0, 1.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.14 }], to: 'c' } });
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.5e0, 3.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -7.5 }], to: 'c' } });
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.0e0, -3.5e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 7.0 }], to: 'c' } });
  });

  it('multiplies very large floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e150, 2.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.0e150 }], to: 'c' } });
  });

  it('multiplies very small floats', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e-150, 2.0e0], 'mul'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.0e-150 }], to: 'c' } });
  });
});

// ─── Division ────────────────────────────────────────────────────────────────

describe('Float division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e1, 2.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 5.0 }], to: 'c' } });
  });

  it('divides with fractional result', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.0e0, 2.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.5 }], to: 'c' } });
  });

  it('divides 1/3 (no error, IEEE-754 approximation)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e0, 3.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1 / 3 }], to: 'c' } });
  });

  it('divides negative by positive', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-9.0e0, 2.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -4.5 }], to: 'c' } });
  });

  it('divides by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14e0, 1.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.14 }], to: 'c' } });
  });

  it('divides small by large', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e0, 1.0e6], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.0e-6 }], to: 'c' } });
  });
});

// ─── Remainder ───────────────────────────────────────────────────────────────

describe('Float remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5e0, 2.0e0], 'rem'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.5 }], to: 'c' } });
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[6.0e0, 3.0e0], 'rem'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0.0 }], to: 'c' } });
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-5.5e0, 2.0e0], 'rem'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -1.5 }], to: 'c' } });
  });

  it('remainder with fractional divisor', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e0, 3.0e-1], 'rem'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.0 % 0.3 }], to: 'c' } });
  });
});

// ─── Exponentiation ──────────────────────────────────────────────────────────

describe('Float exponentiation', () => {
  it('basic power: 2.0 ^ 3.0 = 8.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 3.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 8.0 }], to: 'c' } });
  });

  it('power of zero: 5.0 ^ 0.0 = 1.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0e0, 0.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.0 }], to: 'c' } });
  });

  it('power of one: 7.0 ^ 1.0 = 7.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.0e0, 1.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 7.0 }], to: 'c' } });
  });

  it('fractional exponent: 4.0 ^ 0.5 = 2.0 (square root)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4.0e0, 5.0e-1], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.0 }], to: 'c' } });
  });

  it('negative exponent: 2.0 ^ -1.0 = 0.5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, -1.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0.5 }], to: 'c' } });
  });

  it('fractional base and exponent: 2.5 ^ 2.0 = 6.25', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 2.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 6.25 }], to: 'c' } });
  });

  it('right-associative: 2.0 ^ 3.0 ^ 2.0 = 512.0', async () => {
    const inp = { input: { id: '1', op: [[2.0e0, 3.0e0, 2.0e0], 'rassoc'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } };
    await expectBehavior(script, inp, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 512.0 }], to: 'c' } });
  });

  it('negative base even exponent: (-3.0) ^ 2.0 = 9.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3.0e0, 2.0e0], 'exp'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 9.0 }], to: 'c' } });
  });
});

// ─── Mixed Float + Integer → Float ──────────────────────────────────────────

describe('Mixed Float and Integer arithmetic', () => {
  it('Float + Integer = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 3], 'addFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 5.5 }], to: 'c' } });
  });

  it('Integer - Float = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 3.5e0], 'subIF'], 'ty': [['Integer', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 6.5 }], to: 'c' } });
  });

  it('Float * Integer = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 4], 'mulFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 10.0 }], to: 'c' } });
  });

  it('Integer / Float = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, 2.0e0], 'divIF'], 'ty': [['Integer', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.5 }], to: 'c' } });
  });

  it('Float % Integer = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5e0, 2], 'remFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.5 }], to: 'c' } });
  });

  it('Float ^ Integer = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 2], 'expFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 6.25 }], to: 'c' } });
  });

  it('Integer ^ Float = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4, 5.0e-1], 'expIF'], 'ty': [['Integer', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.0 }], to: 'c' } });
  });
});

// ─── Mixed Float + Decimal → Float ──────────────────────────────────────────

describe('Mixed Float and Decimal arithmetic', () => {
  it('Float + Decimal = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 3.5], 'addFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 6.0 }], to: 'c' } });
  });

  it('Decimal - Float = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10.5, 3.0e0], 'subDF'], 'ty': [['Decimal', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 7.5 }], to: 'c' } });
  });

  it('Float * Decimal = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 4.0], 'mulFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 10.0 }], to: 'c' } });
  });

  it('Decimal / Float = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.5, 2.0e0], 'divDF'], 'ty': [['Decimal', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.75 }], to: 'c' } });
  });

  it('Float % Decimal = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5e0, 2.0], 'remFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.5 }], to: 'c' } });
  });

  it('Float ^ Decimal = Float', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4.0e0, 0.5], 'expFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.0 }], to: 'c' } });
  });
});

// ─── Per-operation promotion (not whole-expression) ─────────────────────────
// Each operation promotes independently: (Int + Float) * Int
// The first op promotes to Float, the second op promotes that Float + Int → Float.

describe('Per-operation type promotion', () => {
  it('(Integer + Float) * Integer → Float (per-op promotion)', async () => {
    const inp = { input: { id: '1', op: [[2, 1.5e0, 4], 'chain'], 'ty': [['Integer', 'Float', 'Integer']], from: 'c' } };
    await expectBehavior(script, inp, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 14.0 }], to: 'c' } });
  });

  it('(Decimal + Float) * Decimal → Float (per-op promotion)', async () => {
    const inp = { input: { id: '1', op: [[2.0, 1.5e0, 4.0], 'chain2'], 'ty': [['Decimal', 'Float', 'Decimal']], from: 'c' } };
    await expectBehavior(script, inp, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 14.0 }], to: 'c' } });
  });
});

// ─── Order of operations ────────────────────────────────────────────────────

describe('Float order of operations', () => {
  it('multiplication before addition: 2.0 + 3.0 * 4.0 = 14.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 3.0e0, 4.0e0], 'mulBeforeAdd'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 14.0 }], to: 'c' } });
  });

  it('parentheses override: (2.0 + 3.0) * 4.0 = 20.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 3.0e0, 4.0e0], 'parenAdd'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 20.0 }], to: 'c' } });
  });

  it('^ binds tighter than *: 2.0 * 3.0 ^ 2.0 = 18.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 3.0e0, 2.0e0], 'expBeforeMul'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 18.0 }], to: 'c' } });
  });

  it('subtraction is left-associative: 10.0 - 3.0 - 2.0 = 5.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e1, 3.0e0, 2.0e0], 'leftAssocSub'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 5.0 }], to: 'c' } });
  });

  it('division is left-associative: 24.0 / 4.0 / 2.0 = 3.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.4e1, 4.0e0, 2.0e0], 'leftAssocDiv'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.0 }], to: 'c' } });
  });

  it('^ is right-associative: 2.0 ^ 3.0 ^ 2.0 = 512.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 3.0e0, 2.0e0], 'rightAssocExp'], 'ty': [['Float', 'Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 512.0 }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-type comparisons: Float, Integer, Decimal
// All three numeric types are comparable with <, >, <=, >=, ==.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Float-Float comparisons', () => {
  it('3.0 < 4.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 4.0e0], 'lt'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('4.0 < 3.0 is false', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4.0e0, 3.0e0], 'lt'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });

  it('5.0 > 2.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0e0, 2.0e0], 'gt'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('2.0 > 5.0 is false', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.0e0, 5.0e0], 'gt'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });

  it('3.0 <= 3.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 3.0e0], 'lte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 <= 4.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 4.0e0], 'lte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('4.0 <= 3.0 is false', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4.0e0, 3.0e0], 'lte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });

  it('5.0 >= 5.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0e0, 5.0e0], 'gte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('5.0 >= 4.0 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0e0, 4.0e0], 'gte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('4.0 >= 5.0 is false', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[4.0e0, 5.0e0], 'gte'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });

  it('3.14 == 3.14 is true', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14e0, 3.14e0], 'eq'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.14 == 3.15 is false', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14e0, 3.15e0], 'eq'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });
});

describe('Float-Integer comparisons', () => {
  it('2.5 < 3 is true (Float < Integer)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 3], 'ltFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3 > 2.5 is true (Integer > Float)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 2.5e0], 'gtIF'], 'ty': [['Integer', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 <= 3 is true (Float <= Integer)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 3], 'lteFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3 >= 3.0 is true (Integer >= Float)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 3.0e0], 'gteIF'], 'ty': [['Integer', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 == 3 is true (Float == Integer)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 3], 'eqFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.1 == 3 is false (Float == Integer)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.1e0, 3], 'eqFI'], 'ty': [['Float', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });
});

describe('Float-Decimal comparisons', () => {
  it('2.5 < 3.0 is true (Float < Decimal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 3.0], 'ltFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 > 2.5 is true (Decimal > Float)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0, 2.5e0], 'gtDF'], 'ty': [['Decimal', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 <= 3.0 is true (Float <= Decimal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0e0, 3.0], 'lteFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('3.0 >= 3.0 is true (Decimal >= Float)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.0, 3.0e0], 'gteDF'], 'ty': [['Decimal', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('2.5 == 2.5 is true (Float == Decimal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 2.5], 'eqFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: true }], to: 'c' } });
  });

  it('2.5 == 2.6 is false (Float == Decimal)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5e0, 2.6], 'eqFD'], 'ty': [['Float', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ ['result']: 'Boolean' }], re: [{ ['result']: false }], to: 'c' } });
  });
});

// ─── IEEE-754 behavior (Float is NOT exact) ─────────────────────────────────
// These tests document that Float intentionally has floating-point imprecision,
// in contrast to Decimal which is exact.

describe('Float IEEE-754 behavior', () => {
  it('0.1 + 0.2 != 0.3 (expected IEEE-754 imprecision)', async () => {
    // This is the classic floating-point example — Float does NOT fix this.
    await expectBehavior(script, { input: { id: '1', op: [[1.0e-1, 2.0e-1], 'add'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0.1 + 0.2 }], to: 'c' } });
  });

  it('1/3 is representable (approximate)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0e0, 3.0e0], 'div'], 'ty': [['Float', 'Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1 / 3 }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Float type conversions: to_integer, to_decimal
// Float.to_integer(x) → Integer (truncates toward zero)
// Float.to_decimal(x) → Decimal
// Also available as dot methods on *Float ref cells.
// to_float on Float is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Float type conversions', () => {
  it('to_integer(3.7) = 3 (truncates toward zero)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.7e0], 'toInteger'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('to_integer(-3.7) = -3 (truncates toward zero)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3.7e0], 'toInteger'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -3 }], to: 'c' } });
  });

  it('to_integer(0.0) = 0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0e0], 'toInteger'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_integer(5.0) = 5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0e0], 'toInteger'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('to_decimal(3.14) = 3.14', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14e0], 'toDecimal'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.14 }], to: 'c' } });
  });

  it('to_decimal(0.0) = 0.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0e0], 'toDecimal'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_decimal(-2.5) = -2.5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.5e0], 'toDecimal'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -2.5 }], to: 'c' } });
  });

  it('to_float(1.5) = 1.5 (identity)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.5e0], 'toSelf'], 'ty': [['Float']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 1.5 }], to: 'c' } });
  });
});

describe('Float conversion via ref cell dot method', () => {
  it('x.to_integer on *Float ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToInteger', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('x.to_decimal on *Float ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToDecimal', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 2.5 }], to: 'c' } });
  });
});
