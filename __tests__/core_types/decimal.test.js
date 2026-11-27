import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Decimal arithmetic: +, -, *, /, %
// Decimals are exact (scaled BigInt). No floating-point imprecision.
// No ^ for Decimal — use Math lib for exponentiation.
// Integer mixed with Decimal promotes to Decimal.
// ═══════════════════════════════════════════════════════════════════════════════

// 500 fractional digits of pi.
const PI_500 =
  '3.' +
  '14159265358979323846264338327950288419716939937510' +
  '58209749445923078164062862089986280348253421170679' +
  '82148086513282306647093844609550582231725359408128' +
  '48111745028410270193852110555964462294895493038196' +
  '44288109756659334461284756482337867831652712019091' +
  '45648566923460348610454326648213393607260249141273' +
  '72458700660631558817488152092096282925409171536436' +
  '78925903600113305305488204665213841469519415116094' +
  '33057270365759591953092186117381932611793105118548' +
  '07446237996274956735188575272489122793818301194912';

// 500 fractional digits of e.
const E_500 =
  '2.' +
  '71828182845904523536028747135266249775724709369995' +
  '95749669676277240766303535475945713821785251664274' +
  '27466391932003059921817413596629043572900334295260' +
  '59563073813232862794349076323382988075319525101901' +
  '15738341879307021540891499348841675092447614606680' +
  '82264800168477411853742345442437107539077744992069' +
  '55170276183860626133138458300075204493382656029760' +
  '67371132007093287091274437470472306969772093101416' +
  '92836819025515108657463772111252389784425056953696' +
  '77078544996996794686445490598793163688923009879312';

const tiny = '0.' + '0'.repeat(99) + '1';
const big  = '0.' + '9'.repeat(100);
const bigNum = '12345678901234567890.' + '1234567890'.repeat(10);
// A 100-digit small delta, added 10 times and compared to delta * 10:
// repeated additions mustn't drift.
const delta = '0.' + '0'.repeat(90) + '1234567890';
const sum10 = Array(10).fill(delta).join(' + ');

const script = `
    // arithmetic
    @add = (a Decimal, b Decimal) -> result: a + b
    @sub = (a Decimal, b Decimal) -> result: a - b
    @mul = (a Decimal, b Decimal) -> result: a * b
    @div = (a Decimal, b Decimal) -> result: a / b
    @rem = (a Decimal, b Decimal) -> result: a % b

    // mixed Integer / Decimal
    @addMixed = (a Integer, b Decimal) -> result: a + b
    @subMixed = (a Decimal, b Integer) -> result: a - b
    @mulMixed = (a Integer, b Decimal) -> result: a * b
    @divMixed = (a Decimal, b Integer) -> result: a / b

    // exponentiation
    @exp = (radix Decimal, power Integer) -> result: radix ^ power

    // precision at scale
    @calc = (a Decimal, b Decimal, c Decimal) -> result: (a + b) * c
    @sum10 = (v Decimal) -> result: v + v + v + v + v + v + v + v + v + v
    @roundTrip = (a Decimal, b Decimal) -> result: a * b / b

    // 500-digit literals
    @addSelf      = () -> equal: ${PI_500} + ${PI_500} == ${PI_500} * 2
    @subInverse   = () -> equal: (${PI_500} + ${E_500}) - ${E_500} == ${PI_500}
    @subToZero    = () -> equal: ${PI_500} - ${PI_500} == 0.0
    @mulCommute   = () -> equal: ${PI_500} * ${E_500} == ${E_500} * ${PI_500}
    @mulByOne     = () -> equal: ${PI_500} * 1.0 == ${PI_500}
    @distrib      = () -> equal: ${PI_500} * 7 == ${PI_500} * 3 + ${PI_500} * 4
    @divPow2      = () -> equal: ${PI_500} * 8 / 8 == ${PI_500}
    @divPow5      = () -> equal: ${PI_500} * 25 / 25 == ${PI_500}
    @divMixedFactors = () -> equal: ${PI_500} * 40 / 40 == ${PI_500}
    @pow2         = () -> equal: ${PI_500} ^ 2 == ${PI_500} * ${PI_500}
    @pow3         = () -> equal: ${PI_500} ^ 3 == ${PI_500} * ${PI_500} * ${PI_500}
    @pow0         = () -> equal: ${PI_500} ^ 0 == 1.0
    @remBySelf    = () -> equal: ${PI_500} % ${PI_500} == 0.0
    @remBy2Sum    = () -> equal: (${PI_500} + ${PI_500} + ${PI_500}) % ${PI_500} == 0.0
    @remPreserved = () -> equal: (${PI_500} + 10.0) % ${PI_500} == 10.0 % ${PI_500}

    // digit rollover
    @roll = () -> equal: ${tiny} + ${big} == 1.0
    @zero = () -> equal: ${bigNum} - ${bigNum} == 0.0
    @sum = () -> equal: (${sum10}) == ${delta} * 10

    // conversions
    @toInteger = (x Decimal) -> result: Decimal.to_integer(x)
    @toFloat = (x Decimal) -> result: Decimal.to_float(x)
    @toSelf = (x Decimal) -> result: Decimal.to_decimal(x)
    @refToInteger = { x *Decimal = 3.7; return result: x.to_integer }
    @refToFloat = { x *Decimal = 2.5; return result: x.to_float }
`;

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Decimal addition', () => {
  it('adds two decimals', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.5, 2.3], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.8 }], to: 'c' } });
  });

  it('adds with zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0, 5.5], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 5.5 }], to: 'c' } });
  });

  it('adds negative decimals', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-1.5, -2.5], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -4.0 }], to: 'c' } });
  });

  it('0.1 + 0.2 = 0.3 (no floating-point error)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.1, 0.2], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.3 }], to: 'c' } });
  });

  it('adds decimals with different scales', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.5, 2.25], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.75 }], to: 'c' } });
  });

  it('adds large decimals', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[999999.99, 0.01], 'add'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 1000000.0 }], to: 'c' } });
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Decimal subtraction', () => {
  it('subtracts two decimals', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5, 2.3], 'sub'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.2 }], to: 'c' } });
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 3.5], 'sub'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -2.5 }], to: 'c' } });
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.7, 0.0], 'sub'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 7.7 }], to: 'c' } });
  });

  it('0.3 - 0.1 = 0.2 (no floating-point error)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.3, 0.1], 'sub'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.2 }], to: 'c' } });
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Decimal multiplication', () => {
  it('multiplies two decimals', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5, 4.0], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 10.0 }], to: 'c' } });
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[99.9, 0.0], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.0 }], to: 'c' } });
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14, 1.0], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.14 }], to: 'c' } });
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.5, 3.0], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -7.5 }], to: 'c' } });
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.0, -3.5], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 7.0 }], to: 'c' } });
  });

  it('0.1 * 0.2 = 0.02 (no floating-point error)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.1, 0.2], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.02 }], to: 'c' } });
  });

  it('multiplies preserving precision', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.23, 4.56], 'mul'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 5.6088 }], to: 'c' } });
  });
});

// ─── Division ────────────────────────────────────────────────────────────────
// Decimal division produces exact results when representable.

describe('Decimal division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10.0, 2.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 5.0 }], to: 'c' } });
  });

  it('divides with decimal result', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.0, 2.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.5 }], to: 'c' } });
  });

  it('divides small by large', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 4.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.25 }], to: 'c' } });
  });

  it('divides negative by positive', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-9.0, 2.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -4.5 }], to: 'c' } });
  });

  it('divides preserving precision', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 8.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.125 }], to: 'c' } });
  });

  it('divides by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14, 1.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.14 }], to: 'c' } });
  });
});

// ─── Remainder ───────────────────────────────────────────────────────────────

describe('Decimal remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.5, 2.0], 'rem'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 1.5 }], to: 'c' } });
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[6.0, 3.0], 'rem'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.0 }], to: 'c' } });
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-5.5, 2.0], 'rem'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -1.5 }], to: 'c' } });
  });

  it('remainder with fractional divisor', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 0.3], 'rem'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.1 }], to: 'c' } });
  });
});

// ─── Mixed Integer + Decimal → Decimal ───────────────────────────────────────

describe('Mixed Integer and Decimal arithmetic', () => {
  it('Integer + Decimal = Decimal', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3.5], 'addMixed'], 'ty': [['Integer', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 5.5 }], to: 'c' } });
  });

  it('Decimal - Integer = Decimal', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10.5, 3], 'subMixed'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 7.5 }], to: 'c' } });
  });

  it('Integer * Decimal = Decimal', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 2.5], 'mulMixed'], 'ty': [['Integer', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 7.5 }], to: 'c' } });
  });

  it('Decimal / Integer = Decimal', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7.5, 3], 'divMixed'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 2.5 }], to: 'c' } });
  });
});

// ─── Non-terminating division — runtime error ──────────────────────────────
// Dynamic Decimal division that produces a non-terminating result must error.

describe('Decimal non-terminating division (runtime)', () => {
  it('1.0 / 3.0 → runtime error', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1.0, 3.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } },
      { output: { id: '1', ex: { 'div': 'error' }, to: 'c' } });
  });

  it('1.0 / 7.0 → runtime error', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1.0, 7.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } },
      { output: { id: '1', ex: { 'div': 'error' }, to: 'c' } });
  });

  it('2.0 / 6.0 → runtime error (reduces to 1/3)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2.0, 6.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } },
      { output: { id: '1', ex: { 'div': 'error' }, to: 'c' } });
  });

  it('1.0 / 5.0 → 0.2 (terminates, factors are only 5)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 5.0], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.2 }], to: 'c' } });
  });

  it('1.0 / 2.5 → 0.4 (terminates)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.0, 2.5], 'div'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.4 }], to: 'c' } });
  });
});

// ─── Non-terminating division — compile-time error ─────────────────────────
// When both operands are literals, the compiler can detect non-terminating.

describe('Decimal non-terminating division (compile-time)', () => {
  it('literal 1.0 / 3.0 → compile error', () => {
    expect(() => compileSource(`
      @test = () -> result: 1.0 / 3.0
    `)).toThrow();
  });

  it('literal 1.0 / 7.0 → compile error', () => {
    expect(() => compileSource(`
      @test = () -> result: 1.0 / 7.0
    `)).toThrow();
  });

  it('literal 1.0 / 4.0 → no error (terminates)', () => {
    expect(() => compileSource(`
      @test = () -> result: 1.0 / 4.0
    `)).not.toThrow();
  });

  it('literal 1.0 / 0.3 → compile error (0.3 = 3/10 → after cancel, 3)', () => {
    expect(() => compileSource(`
      @test = () -> result: 1.0 / 0.3
    `)).toThrow();
  });
});

// ─── Exponentiation with Integer exponent ───────────────────────────────────
// Decimal ^ Integer is allowed. Positive exponent = repeated multiply (exact).
// Negative exponent = 1/(base^(exp) -> ), same termination check as division.

describe('Decimal exponentiation', () => {
  it('2.5 ^ 2 = 6.25', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5, 2], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 6.25 }], to: 'c' } });
  });

  it('2.5 ^ 3 = 15.625', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5, 3], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 15.625 }], to: 'c' } });
  });

  it('1.1 ^ 0 = 1.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.1, 0], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 1.0 }], to: 'c' } });
  });

  it('0.5 ^ 1 = 0.5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.5, 1], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.5 }], to: 'c' } });
  });

  it('2.5 ^ -1 = 0.4 (terminates: 1/2.5 = 2/5)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2.5, -1], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0.4 }], to: 'c' } });
  });

  it('0.5 ^ -2 = 4.0 (terminates: 1/0.25)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.5, -2], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 4.0 }], to: 'c' } });
  });

  it('3.0 ^ -1 → runtime error (1/3 non-terminating)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3.0, -1], 'exp'], 'ty': [['Decimal', 'Integer']], from: 'c' } },
      { output: { id: '1', ex: { 'exp': 'error' }, to: 'c' } });
  });
});

// ─── Compile-time exponentiation error ──────────────────────────────────────

describe('Decimal exponentiation (compile-time)', () => {
  it('literal 2.5 ^ 3 → no error (positive exponent always exact)', () => {
    expect(() => compileSource(`
      @test = () -> result: 2.5 ^ 3
    `)).not.toThrow();
  });
});

// ─── Exact precision at scale ───────────────────────────────────────────────
// Verify no precision loss in chain operations.

describe('Decimal precision at scale', () => {
  it('chain: (0.1 + 0.2) * 10 = 3.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.1, 0.2, 10.0], 'calc'], 'ty': [['Decimal', 'Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.0 }], to: 'c' } });
  });

  it('many small additions stay exact', async () => {
    // 0.1 * 10 = 1.0 (via repeated addition in actor)
    await expectBehavior(script, { input: { id: '1', op: [[0.1], 'sum10'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 1.0 }], to: 'c' } });
  });

  it('multiply then divide round-trips', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14, 2.5], 'roundTrip'], 'ty': [['Decimal', 'Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 3.14 }], to: 'c' } });
  });
});

// ─── Truly long decimals (exceeds IEEE-754 precision) ──────────────────────
// Pi and e to 500 fractional digits, as source literals, exercised via
// algebraic identities. Outputs are Booleans so nothing long-precision is
// round-tripped through the wire — precision only needs to survive within
// the actor.

describe('Truly long decimals (500 fractional digits)', () => {
  it('addition: pi + pi == pi * 2 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'addSelf', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('subtraction inverse: (pi + e) - e == pi (500 digits each)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'subInverse', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('subtraction to zero: pi - pi == 0.0 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'subToZero', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('multiplication commutes: pi * e == e * pi (500 × 500 digits → 1000-digit coeff)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'mulCommute', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('multiply by 1.0 identity (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'mulByOne', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('distributive: pi*7 == pi*3 + pi*4 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'distrib', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('division round-trip by 8 (power of 2, 500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'divPow2', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('division round-trip by 25 (power of 5, 500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'divPow5', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('division round-trip by 40 (mixed 2·5 factors, 500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'divMixedFactors', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('pi ^ 2 == pi * pi (500 digits → 1000-digit result)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'pow2', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('pi ^ 3 == pi * pi * pi (500 digits → 1500-digit result)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'pow3', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('pi ^ 0 == 1.0 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'pow0', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('remainder: pi % pi == 0.0 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'remBySelf', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('remainder: 3*pi % pi == 0.0 (500 digits)', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'remBy2Sum', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('remainder preserved across added multiple: (pi + 10) % pi == 10 % pi', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'remPreserved', from: 'c' } }, { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });
});

// ─── Digit-rollover edge cases ─────────────────────────────────────────────
// Cases that would silently fail with IEEE-754 but must be exact for
// scaled-BigInt decimal arithmetic.

describe('Decimal digit-rollover precision', () => {
  it('0.' + '0'.repeat(99) + '1 + 0.' + '9'.repeat(100) + ' == 1.0', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'roll', from: 'c' } },
      { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('a hundred-digit number plus its negation (via subtraction) is zero', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'zero', from: 'c' } },
      { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });

  it('sum-of-ten small deltas equals ten-times one delta', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'sum', from: 'c' } },
      { output: { id: '1', 'ty': [{ equal: 'Boolean' }], re: [{ equal: true }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Decimal type conversions: to_integer, to_float
// Decimal.to_integer(x) → Integer (truncates toward zero)
// Decimal.to_float(x) → Float
// Also available as dot methods on *Decimal ref cells.
// to_decimal on Decimal is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Decimal type conversions', () => {

  it('to_integer(3.7) = 3 (truncates toward zero)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.7], 'toInteger'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('to_integer(-3.7) = -3 (truncates toward zero)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3.7], 'toInteger'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -3 }], to: 'c' } });
  });

  it('to_integer(0.0) = 0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0], 'toInteger'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_integer(5.0) = 5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5.0], 'toInteger'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('to_integer(-10.0) = -10', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-10.0], 'toInteger'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -10 }], to: 'c' } });
  });

  it('to_float(3.14) = 3.14', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3.14], 'toFloat'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 3.14 }], to: 'c' } });
  });

  it('to_float(0.0) = 0.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.0], 'toFloat'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_float(-2.5) = -2.5', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-2.5], 'toFloat'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -2.5 }], to: 'c' } });
  });

  it('to_float(0.1111) = 0.1111', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0.1111], 'toFloat'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0.1111 }], to: 'c' } });
  });

  it('to_decimal(1.5) = 1.5 (identity)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1.5], 'toSelf'], 'ty': [['Decimal']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 1.5 }], to: 'c' } });
  });
});

describe('Decimal conversion via ref cell dot method', () => {

  it('x.to_integer on *Decimal ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToInteger', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('x.to_float on *Decimal ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToFloat', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 2.5 }], to: 'c' } });
  });
});
