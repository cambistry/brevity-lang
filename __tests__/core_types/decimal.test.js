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
