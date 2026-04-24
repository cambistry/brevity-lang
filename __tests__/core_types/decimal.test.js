import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Decimal arithmetic: +, -, *, /, %
// Decimals are exact (scaled BigInt). No floating-point imprecision.
// No ** for Decimal — use Math lib for exponentiation.
// Integer mixed with Decimal promotes to Decimal.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
    @add = |a Decimal, b Decimal| -> result: a + b
    @sub = |a Decimal, b Decimal| -> result: a - b
    @mul = |a Decimal, b Decimal| -> result: a * b
    @div = |a Decimal, b Decimal| -> result: a / b
    @rem = |a Decimal, b Decimal| -> result: a % b
`;

const mixedScript = `
    @addMixed = |a Integer, b Decimal| -> result: a + b
    @subMixed = |a Decimal, b Integer| -> result: a - b
    @mulMixed = |a Integer, b Decimal| -> result: a * b
    @divMixed = |a Decimal, b Integer| -> result: a / b
`;

function inpDD(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Decimal', 'Decimal']], from: 'c' } };
}
function inpID(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Integer', 'Decimal']], from: 'c' } };
}
function inpDI(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Decimal', 'Integer']], from: 'c' } };
}
function out(result) {
  return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
}

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Decimal addition', () => {
  it('adds two decimals', async () => {
    await expectBehavior(script, inpDD('@add', 1.5, 2.3), out(3.8));
  });

  it('adds with zero', async () => {
    await expectBehavior(script, inpDD('@add', 0.0, 5.5), out(5.5));
  });

  it('adds negative decimals', async () => {
    await expectBehavior(script, inpDD('@add', -1.5, -2.5), out(-4.0));
  });

  it('0.1 + 0.2 = 0.3 (no floating-point error)', async () => {
    await expectBehavior(script, inpDD('@add', 0.1, 0.2), out(0.3));
  });

  it('adds decimals with different scales', async () => {
    await expectBehavior(script, inpDD('@add', 1.5, 2.25), out(3.75));
  });

  it('adds large decimals', async () => {
    await expectBehavior(script, inpDD('@add', 999999.99, 0.01), out(1000000.0));
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Decimal subtraction', () => {
  it('subtracts two decimals', async () => {
    await expectBehavior(script, inpDD('@sub', 5.5, 2.3), out(3.2));
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, inpDD('@sub', 1.0, 3.5), out(-2.5));
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, inpDD('@sub', 7.7, 0.0), out(7.7));
  });

  it('0.3 - 0.1 = 0.2 (no floating-point error)', async () => {
    await expectBehavior(script, inpDD('@sub', 0.3, 0.1), out(0.2));
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Decimal multiplication', () => {
  it('multiplies two decimals', async () => {
    await expectBehavior(script, inpDD('@mul', 2.5, 4.0), out(10.0));
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, inpDD('@mul', 99.9, 0.0), out(0.0));
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, inpDD('@mul', 3.14, 1.0), out(3.14));
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, inpDD('@mul', -2.5, 3.0), out(-7.5));
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, inpDD('@mul', -2.0, -3.5), out(7.0));
  });

  it('0.1 * 0.2 = 0.02 (no floating-point error)', async () => {
    await expectBehavior(script, inpDD('@mul', 0.1, 0.2), out(0.02));
  });

  it('multiplies preserving precision', async () => {
    await expectBehavior(script, inpDD('@mul', 1.23, 4.56), out(5.6088));
  });
});

// ─── Division ────────────────────────────────────────────────────────────────
// Decimal division produces exact results when representable.

describe('Decimal division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, inpDD('@div', 10.0, 2.0), out(5.0));
  });

  it('divides with decimal result', async () => {
    await expectBehavior(script, inpDD('@div', 7.0, 2.0), out(3.5));
  });

  it('divides small by large', async () => {
    await expectBehavior(script, inpDD('@div', 1.0, 4.0), out(0.25));
  });

  it('divides negative by positive', async () => {
    await expectBehavior(script, inpDD('@div', -9.0, 2.0), out(-4.5));
  });

  it('divides preserving precision', async () => {
    await expectBehavior(script, inpDD('@div', 1.0, 8.0), out(0.125));
  });

  it('divides by one', async () => {
    await expectBehavior(script, inpDD('@div', 3.14, 1.0), out(3.14));
  });
});

// ─── Remainder ───────────────────────────────────────────────────────────────

describe('Decimal remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, inpDD('@rem', 5.5, 2.0), out(1.5));
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, inpDD('@rem', 6.0, 3.0), out(0.0));
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, inpDD('@rem', -5.5, 2.0), out(-1.5));
  });

  it('remainder with fractional divisor', async () => {
    await expectBehavior(script, inpDD('@rem', 1.0, 0.3), out(0.1));
  });
});

// ─── Mixed Integer + Decimal → Decimal ───────────────────────────────────────

describe('Mixed Integer and Decimal arithmetic', () => {
  it('Integer + Decimal = Decimal', async () => {
    await expectBehavior(mixedScript, inpID('@addMixed', 2, 3.5), out(5.5));
  });

  it('Decimal - Integer = Decimal', async () => {
    await expectBehavior(mixedScript, inpDI('@subMixed', 10.5, 3), out(7.5));
  });

  it('Integer * Decimal = Decimal', async () => {
    await expectBehavior(mixedScript, inpID('@mulMixed', 3, 2.5), out(7.5));
  });

  it('Decimal / Integer = Decimal', async () => {
    await expectBehavior(mixedScript, inpDI('@divMixed', 7.5, 3), out(2.5));
  });
});

// ─── Non-terminating division — runtime error ──────────────────────────────
// Dynamic Decimal division that produces a non-terminating result must error.

describe('Decimal non-terminating division (runtime)', () => {
  it('1.0 / 3.0 → runtime error', async () => {
    await expectBehavior(script,
      inpDD('@div', 1.0, 3.0),
      { output: { id: '1', ex: { '@div': 'error' }, to: 'c' } });
  });

  it('1.0 / 7.0 → runtime error', async () => {
    await expectBehavior(script,
      inpDD('@div', 1.0, 7.0),
      { output: { id: '1', ex: { '@div': 'error' }, to: 'c' } });
  });

  it('2.0 / 6.0 → runtime error (reduces to 1/3)', async () => {
    await expectBehavior(script,
      inpDD('@div', 2.0, 6.0),
      { output: { id: '1', ex: { '@div': 'error' }, to: 'c' } });
  });

  it('1.0 / 5.0 → 0.2 (terminates, factors are only 5)', async () => {
    await expectBehavior(script, inpDD('@div', 1.0, 5.0), out(0.2));
  });

  it('1.0 / 2.5 → 0.4 (terminates)', async () => {
    await expectBehavior(script, inpDD('@div', 1.0, 2.5), out(0.4));
  });
});

// ─── Non-terminating division — compile-time error ─────────────────────────
// When both operands are literals, the compiler can detect non-terminating.

describe('Decimal non-terminating division (compile-time)', () => {
  it('literal 1.0 / 3.0 → compile error', () => {
    expect(() => compileSource(`
      @test = -> result: 1.0 / 3.0
    `)).toThrow();
  });

  it('literal 1.0 / 7.0 → compile error', () => {
    expect(() => compileSource(`
      @test = -> result: 1.0 / 7.0
    `)).toThrow();
  });

  it('literal 1.0 / 4.0 → no error (terminates)', () => {
    expect(() => compileSource(`
      @test = -> result: 1.0 / 4.0
    `)).not.toThrow();
  });

  it('literal 1.0 / 0.3 → compile error (0.3 = 3/10 → after cancel, 3)', () => {
    expect(() => compileSource(`
      @test = -> result: 1.0 / 0.3
    `)).toThrow();
  });
});

// ─── Exponentiation with Integer exponent ───────────────────────────────────
// Decimal ** Integer is allowed. Positive exponent = repeated multiply (exact).
// Negative exponent = 1/(base**|exp|), same termination check as division.

const expScript = `
    @exp = |base Decimal, power Integer| -> result: base ** power
`;
function inpExp(base, power) {
  return { input: { id: '1', op: [[base, power], '@exp'], 'bv-a': [['Decimal', 'Integer']], from: 'c' } };
}

describe('Decimal exponentiation', () => {
  it('2.5 ** 2 = 6.25', async () => {
    await expectBehavior(expScript, inpExp(2.5, 2), out(6.25));
  });

  it('2.5 ** 3 = 15.625', async () => {
    await expectBehavior(expScript, inpExp(2.5, 3), out(15.625));
  });

  it('1.1 ** 0 = 1.0', async () => {
    await expectBehavior(expScript, inpExp(1.1, 0), out(1.0));
  });

  it('0.5 ** 1 = 0.5', async () => {
    await expectBehavior(expScript, inpExp(0.5, 1), out(0.5));
  });

  it('2.5 ** -1 = 0.4 (terminates: 1/2.5 = 2/5)', async () => {
    await expectBehavior(expScript, inpExp(2.5, -1), out(0.4));
  });

  it('0.5 ** -2 = 4.0 (terminates: 1/0.25)', async () => {
    await expectBehavior(expScript, inpExp(0.5, -2), out(4.0));
  });

  it('3.0 ** -1 → runtime error (1/3 non-terminating)', async () => {
    await expectBehavior(expScript,
      inpExp(3.0, -1),
      { output: { id: '1', ex: { '@exp': 'error' }, to: 'c' } });
  });
});

// ─── Compile-time exponentiation error ──────────────────────────────────────

describe('Decimal exponentiation (compile-time)', () => {
  it('literal 2.5 ** 3 → no error (positive exponent always exact)', () => {
    expect(() => compileSource(`
      @test = -> result: 2.5 ** 3
    `)).not.toThrow();
  });
});

// ─── Exact precision at scale ───────────────────────────────────────────────
// Verify no precision loss in chain operations.

describe('Decimal precision at scale', () => {
  it('chain: (0.1 + 0.2) * 10 = 3.0', async () => {
    const chainScript = `
        @calc = |a Decimal, b Decimal, c Decimal| -> result: (a + b) * c
    `;
    const inp = { input: { id: '1', op: [[0.1, 0.2, 10.0], '@calc'], 'bv-a': [['Decimal', 'Decimal', 'Decimal']], from: 'c' } };
    await expectBehavior(chainScript, inp, out(3.0));
  });

  it('many small additions stay exact', async () => {
    // 0.1 * 10 = 1.0 (via repeated addition in actor)
    const sumScript = `
        @sum10 = |v Decimal| -> result: v + v + v + v + v + v + v + v + v + v
    `;
    const inp = { input: { id: '1', op: [[0.1], '@sum10'], 'bv-a': [['Decimal']], from: 'c' } };
    await expectBehavior(sumScript, inp, out(1.0));
  });

  it('multiply then divide round-trips', async () => {
    const rtScript = `
        @roundTrip = |a Decimal, b Decimal| -> result: a * b / b
    `;
    const inp = { input: { id: '1', op: [[3.14, 2.5], '@roundTrip'], 'bv-a': [['Decimal', 'Decimal']], from: 'c' } };
    await expectBehavior(rtScript, inp, out(3.14));
  });
});

// ─── Truly long decimals (exceeds IEEE-754 precision) ──────────────────────
// Pi and e to 500 fractional digits, as source literals, exercised via
// algebraic identities. Outputs are Booleans so nothing long-precision is
// round-tripped through the wire — precision only needs to survive within
// the actor.

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

function outEqual(value) {
  return { output: { id: '1', 'bv-a': { equal: 'Boolean' }, re: { equal: value }, to: 'c' } };
}

describe('Truly long decimals (500 fractional digits)', () => {
  const longScript = `
    @addSelf      = -> equal: ${PI_500} + ${PI_500} == ${PI_500} * 2
    @subInverse   = -> equal: (${PI_500} + ${E_500}) - ${E_500} == ${PI_500}
    @subToZero    = -> equal: ${PI_500} - ${PI_500} == 0.0
    @mulCommute   = -> equal: ${PI_500} * ${E_500} == ${E_500} * ${PI_500}
    @mulByOne     = -> equal: ${PI_500} * 1.0 == ${PI_500}
    @distrib      = -> equal: ${PI_500} * 7 == ${PI_500} * 3 + ${PI_500} * 4
    @divPow2      = -> equal: ${PI_500} * 8 / 8 == ${PI_500}
    @divPow5      = -> equal: ${PI_500} * 25 / 25 == ${PI_500}
    @divMixed     = -> equal: ${PI_500} * 40 / 40 == ${PI_500}
    @pow2         = -> equal: ${PI_500} ** 2 == ${PI_500} * ${PI_500}
    @pow3         = -> equal: ${PI_500} ** 3 == ${PI_500} * ${PI_500} * ${PI_500}
    @pow0         = -> equal: ${PI_500} ** 0 == 1.0
    @remBySelf    = -> equal: ${PI_500} % ${PI_500} == 0.0
    @remBy2Sum    = -> equal: (${PI_500} + ${PI_500} + ${PI_500}) % ${PI_500} == 0.0
    @remPreserved = -> equal: (${PI_500} + 10.0) % ${PI_500} == 10.0 % ${PI_500}
  `;

  function call(op) {
    return { input: { id: '1', op, from: 'c' } };
  }

  it('addition: pi + pi == pi * 2 (500 digits)', async () => {
    await expectBehavior(longScript, call('@addSelf'), outEqual(true));
  });

  it('subtraction inverse: (pi + e) - e == pi (500 digits each)', async () => {
    await expectBehavior(longScript, call('@subInverse'), outEqual(true));
  });

  it('subtraction to zero: pi - pi == 0.0 (500 digits)', async () => {
    await expectBehavior(longScript, call('@subToZero'), outEqual(true));
  });

  it('multiplication commutes: pi * e == e * pi (500 × 500 digits → 1000-digit coeff)', async () => {
    await expectBehavior(longScript, call('@mulCommute'), outEqual(true));
  });

  it('multiply by 1.0 identity (500 digits)', async () => {
    await expectBehavior(longScript, call('@mulByOne'), outEqual(true));
  });

  it('distributive: pi*7 == pi*3 + pi*4 (500 digits)', async () => {
    await expectBehavior(longScript, call('@distrib'), outEqual(true));
  });

  it('division round-trip by 8 (power of 2, 500 digits)', async () => {
    await expectBehavior(longScript, call('@divPow2'), outEqual(true));
  });

  it('division round-trip by 25 (power of 5, 500 digits)', async () => {
    await expectBehavior(longScript, call('@divPow5'), outEqual(true));
  });

  it('division round-trip by 40 (mixed 2·5 factors, 500 digits)', async () => {
    await expectBehavior(longScript, call('@divMixed'), outEqual(true));
  });

  it('pi ** 2 == pi * pi (500 digits → 1000-digit result)', async () => {
    await expectBehavior(longScript, call('@pow2'), outEqual(true));
  });

  it('pi ** 3 == pi * pi * pi (500 digits → 1500-digit result)', async () => {
    await expectBehavior(longScript, call('@pow3'), outEqual(true));
  });

  it('pi ** 0 == 1.0 (500 digits)', async () => {
    await expectBehavior(longScript, call('@pow0'), outEqual(true));
  });

  it('remainder: pi % pi == 0.0 (500 digits)', async () => {
    await expectBehavior(longScript, call('@remBySelf'), outEqual(true));
  });

  it('remainder: 3*pi % pi == 0.0 (500 digits)', async () => {
    await expectBehavior(longScript, call('@remBy2Sum'), outEqual(true));
  });

  it('remainder preserved across added multiple: (pi + 10) % pi == 10 % pi', async () => {
    await expectBehavior(longScript, call('@remPreserved'), outEqual(true));
  });
});

// ─── Digit-rollover edge cases ─────────────────────────────────────────────
// Cases that would silently fail with IEEE-754 but must be exact for
// scaled-BigInt decimal arithmetic.

describe('Decimal digit-rollover precision', () => {
  it('0.' + '0'.repeat(99) + '1 + 0.' + '9'.repeat(100) + ' == 1.0', async () => {
    const tiny = '0.' + '0'.repeat(99) + '1';
    const big  = '0.' + '9'.repeat(100);
    const rollScript = `
      @roll = -> equal: ${tiny} + ${big} == 1.0
    `;
    await expectBehavior(rollScript,
      { input: { id: '1', op: '@roll', from: 'c' } },
      outEqual(true));
  });

  it('a hundred-digit number plus its negation (via subtraction) is zero', async () => {
    const bigNum = '12345678901234567890.' + '1234567890'.repeat(10);
    const s = `
      @zero = -> equal: ${bigNum} - ${bigNum} == 0.0
    `;
    await expectBehavior(s,
      { input: { id: '1', op: '@zero', from: 'c' } },
      outEqual(true));
  });

  it('sum-of-ten small deltas equals ten-times one delta', async () => {
    // Adds a 100-digit small delta 10 times, compares to delta * 10.
    // Tests that repeated additions don't drift.
    const delta = '0.' + '0'.repeat(90) + '1234567890';
    const sum10 = Array(10).fill(delta).join(' + ');
    const s = `
      @sum = -> equal: (${sum10}) == ${delta} * 10
    `;
    await expectBehavior(s,
      { input: { id: '1', op: '@sum', from: 'c' } },
      outEqual(true));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Decimal type conversions: to_integer, to_float
// Decimal.to_integer(x) → Integer (truncates toward zero)
// Decimal.to_float(x) → Float
// Also available as dot methods on Decimal! ref cells.
// to_decimal on Decimal is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Decimal type conversions', () => {
  const convScript = `
      @toInteger = |x Decimal| -> result: Decimal.to_integer(x)
      @toFloat = |x Decimal| -> result: Decimal.to_float(x)
      @toSelf = |x Decimal| -> result: Decimal.to_decimal(x)
  `;

  function inpD(op, a) {
    return { input: { id: '1', op: [[a], op], 'bv-a': [['Decimal']], from: 'c' } };
  }
  function outI(result) {
    return { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result }, to: 'c' } };
  }
  function outF(result) {
    return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
  }

  it('to_integer(3.7) = 3 (truncates toward zero)', async () => {
    await expectBehavior(convScript, inpD('@toInteger', 3.7), outI(3));
  });

  it('to_integer(-3.7) = -3 (truncates toward zero)', async () => {
    await expectBehavior(convScript, inpD('@toInteger', -3.7), outI(-3));
  });

  it('to_integer(0.0) = 0', async () => {
    await expectBehavior(convScript, inpD('@toInteger', 0.0), outI(0));
  });

  it('to_integer(5.0) = 5', async () => {
    await expectBehavior(convScript, inpD('@toInteger', 5.0), outI(5));
  });

  it('to_integer(-10.0) = -10', async () => {
    await expectBehavior(convScript, inpD('@toInteger', -10.0), outI(-10));
  });

  it('to_float(3.14) = 3.14', async () => {
    await expectBehavior(convScript, inpD('@toFloat', 3.14), outF(3.14));
  });

  it('to_float(0.0) = 0.0', async () => {
    await expectBehavior(convScript, inpD('@toFloat', 0.0), outF(0));
  });

  it('to_float(-2.5) = -2.5', async () => {
    await expectBehavior(convScript, inpD('@toFloat', -2.5), outF(-2.5));
  });

  it('to_float(0.1111) = 0.1111', async () => {
    await expectBehavior(convScript, inpD('@toFloat', 0.1111), outF(0.1111));
  });

  it('to_decimal(1.5) = 1.5 (identity)', async () => {
    await expectBehavior(convScript, inpD('@toSelf', 1.5), out(1.5));
  });
});

describe('Decimal conversion via ref cell dot method', () => {
  const refScript = `
      @toInteger = { x Decimal! = 3.7; -> result: x.to_integer }
      @toFloat = { x Decimal! = 2.5; -> result: x.to_float }
  `;

  function outI(result) {
    return { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result }, to: 'c' } };
  }
  function outF(result) {
    return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
  }

  it('x.to_integer on Decimal! ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toInteger', from: 'c' } }, outI(3));
  });

  it('x.to_float on Decimal! ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toFloat', from: 'c' } }, outF(2.5));
  });
});
