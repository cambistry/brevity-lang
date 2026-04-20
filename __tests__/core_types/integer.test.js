import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Integer arithmetic: +, -, *, /, %, **
// All integers are arbitrary-precision. Division truncates toward zero.
// Remainder sign follows the dividend.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
    @add = |a Integer, b Integer| -> result: a + b
    @sub = |a Integer, b Integer| -> result: a - b
    @mul = |a Integer, b Integer| -> result: a * b
    @div = |a Integer, b Integer| -> result: a / b
    @rem = |a Integer, b Integer| -> result: a % b
    @exp = |a Integer, b Integer| -> result: a ** b
`;

function inp2(op, a, b) {
  return { input: { id: '1', op: [[a, b], op], 'bv-a': [['Integer', 'Integer']], from: 'c' } };
}
function inp3(op, a, b, c) {
  return { input: { id: '1', op: [[a, b, c], op], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'c' } };
}
function inp4(op, a, b, c, d) {
  return { input: { id: '1', op: [[a, b, c, d], op], 'bv-a': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'c' } };
}
function out(result, type = 'Integer') {
  return { output: { id: '1', 'bv-a': { result: type }, re: { result }, to: 'c' } };
}
function outBool(matches) {
  return { output: { id: '1', 'bv-a': { matches: 'Boolean' }, re: { matches }, to: 'c' } };
}

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Integer addition', () => {
  it('adds two positive integers', async () => {
    await expectBehavior(script, inp2('@add', 3, 4), out(7));
  });

  it('adds zero', async () => {
    await expectBehavior(script, inp2('@add', 0, 5), out(5));
  });

  it('adds negative integers', async () => {
    await expectBehavior(script, inp2('@add', -3, -7), out(-10));
  });

  it('adds mixed sign', async () => {
    await expectBehavior(script, inp2('@add', 10, -3), out(7));
  });

  it('adds beyond 64-bit range', async () => {
    await expectBehavior(script, inp2('@add', 9007199254740992, 1), out(9007199254740993));
  });

  it('adds very large integers', async () => {
    await expectBehavior(script, inp2('@add', 100000000000000000000, 100000000000000000000), out(200000000000000000000));
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Integer subtraction', () => {
  it('subtracts two positive integers', async () => {
    await expectBehavior(script, inp2('@sub', 10, 3), out(7));
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, inp2('@sub', 3, 10), out(-7));
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, inp2('@sub', 42, 0), out(42));
  });

  it('subtracts negative from negative', async () => {
    await expectBehavior(script, inp2('@sub', -5, -3), out(-2));
  });

  it('subtracts beyond 64-bit range', async () => {
    await expectBehavior(script, inp2('@sub', -9007199254740992, 1), out(-9007199254740993));
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Integer multiplication', () => {
  it('multiplies two positive integers', async () => {
    await expectBehavior(script, inp2('@mul', 6, 7), out(42));
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, inp2('@mul', 999, 0), out(0));
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, inp2('@mul', 42, 1), out(42));
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, inp2('@mul', -3, 7), out(-21));
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, inp2('@mul', -4, -5), out(20));
  });

  it('multiplies large integers without overflow', async () => {
    await expectBehavior(script, inp2('@mul', 10000000000, 10000000000), out(100000000000000000000));
  });

  it('multiplies beyond 64-bit range', async () => {
    // 2^40 * 2^40 = 2^80
    await expectBehavior(script, inp2('@mul', 1099511627776, 1099511627776), out(1208925819614629174706176));
  });
});

// ─── Division (truncates toward zero) ────────────────────────────────────────

describe('Integer division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, inp2('@div', 12, 4), out(3));
  });

  it('truncates toward zero (positive)', async () => {
    await expectBehavior(script, inp2('@div', 7, 2), out(3));
  });

  it('truncates toward zero (negative dividend)', async () => {
    await expectBehavior(script, inp2('@div', -7, 2), out(-3));
  });

  it('truncates toward zero (negative divisor)', async () => {
    await expectBehavior(script, inp2('@div', 7, -2), out(-3));
  });

  it('truncates toward zero (both negative)', async () => {
    await expectBehavior(script, inp2('@div', -7, -2), out(3));
  });

  it('divides by one', async () => {
    await expectBehavior(script, inp2('@div', 42, 1), out(42));
  });

  it('zero divided by anything is zero', async () => {
    await expectBehavior(script, inp2('@div', 0, 7), out(0));
  });

  it('divides large integers', async () => {
    await expectBehavior(script, inp2('@div', 100000000000000000000, 10000000000), out(10000000000));
  });
});

// ─── Remainder (sign follows dividend) ───────────────────────────────────────

describe('Integer remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, inp2('@rem', 7, 3), out(1));
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, inp2('@rem', 9, 3), out(0));
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, inp2('@rem', -7, 3), out(-1));
  });

  it('negative divisor — remainder sign follows dividend (positive)', async () => {
    await expectBehavior(script, inp2('@rem', 7, -3), out(1));
  });

  it('both negative — remainder is negative', async () => {
    await expectBehavior(script, inp2('@rem', -7, -3), out(-1));
  });

  it('zero remainder of anything is zero', async () => {
    await expectBehavior(script, inp2('@rem', 0, 5), out(0));
  });

  it('remainder by one is always zero', async () => {
    await expectBehavior(script, inp2('@rem', 42, 1), out(0));
  });

  // NOTE: This test requires BigInt support to pass (100000000000000000007 exceeds Number.MAX_SAFE_INTEGER)
  it.skip('remainder with large integers', async () => {
    await expectBehavior(script, inp2('@rem', 100000000000000000007, 10000000000), out(7));
  });
});

// ─── Exponentiation ──────────────────────────────────────────────────────────

describe('Integer exponentiation', () => {
  it('basic power: 2 ** 3 = 8', async () => {
    await expectBehavior(script, inp2('@exp', 2, 3), out(8));
  });

  it('power of zero: 5 ** 0 = 1', async () => {
    await expectBehavior(script, inp2('@exp', 5, 0), out(1));
  });

  it('zero to the zero: 0 ** 0 = 1', async () => {
    await expectBehavior(script, inp2('@exp', 0, 0), out(1));
  });

  it('power of one: 7 ** 1 = 7', async () => {
    await expectBehavior(script, inp2('@exp', 7, 1), out(7));
  });

  it('zero raised to positive: 0 ** 5 = 0', async () => {
    await expectBehavior(script, inp2('@exp', 0, 5), out(0));
  });

  it('one raised to anything: 1 ** 100 = 1', async () => {
    await expectBehavior(script, inp2('@exp', 1, 100), out(1));
  });

  it('negative base even exponent: (-3) ** 4 = 81', async () => {
    await expectBehavior(script, inp2('@exp', -3, 4), out(81));
  });

  it('negative base odd exponent: (-3) ** 3 = -27', async () => {
    await expectBehavior(script, inp2('@exp', -3, 3), out(-27));
  });

  it('large exponent produces arbitrary-precision result: 2 ** 64', async () => {
    await expectBehavior(script, inp2('@exp', 2, 64), out(18446744073709551616));
  });

  it('large base and exponent: 10 ** 20', async () => {
    await expectBehavior(script, inp2('@exp', 10, 20), out(100000000000000000000));
  });
});

// ─── Division + Remainder identity ───────────────────────────────────────────
// For all a, b (b ≠ 0): a == (a / b) * b + (a % b)

describe('Integer division/remainder identity', () => {
  const identityScript = `
      @identity
        =
        a Integer
        b Integer
        =
        quotient Integer = a / b
        remainder Integer = a % b
        reconstructed Integer = quotient * b + remainder
        -> matches: reconstructed == a
  `;

  it('identity holds for positive values', async () => {
    await expectBehavior(identityScript, inp2('@identity', 17, 5), outBool(true));
  });

  it('identity holds for negative dividend', async () => {
    await expectBehavior(identityScript, inp2('@identity', -17, 5), outBool(true));
  });

  it('identity holds for negative divisor', async () => {
    await expectBehavior(identityScript, inp2('@identity', 17, -5), outBool(true));
  });

  it('identity holds for both negative', async () => {
    await expectBehavior(identityScript, inp2('@identity', -17, -5), outBool(true));
  });

  it('identity holds for large integers', async () => {
    await expectBehavior(identityScript, inp2('@identity', 123456789012345678901, 987654321), outBool(true));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Order of operations and parentheses
// Standard precedence: ** > * / % > + -
// Parentheses override precedence.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integer order of operations', () => {
  const precedenceScript = `
      @mulBeforeAdd = |a Integer, b Integer, c Integer| -> result: a + b * c
      @mulBeforeSub = |a Integer, b Integer, c Integer| -> result: a - b * c
      @divBeforeAdd = |a Integer, b Integer, c Integer| -> result: a + b / c
      @remBeforeAdd = |a Integer, b Integer, c Integer| -> result: a + b % c
      @parenAdd = |a Integer, b Integer, c Integer| -> result: (a + b) * c
      @parenSub = |a Integer, b Integer, c Integer| -> result: a * (b - c)
      @parenDiv = |a Integer, b Integer, c Integer| -> result: (a + b) / c
      @parenRem = |a Integer, b Integer, c Integer| -> result: (a + b) % c
      @nested = |a Integer, b Integer, c Integer, d Integer| -> result: (a + b) * (c - d)
      @deepNest = |a Integer, b Integer, c Integer, d Integer| -> result: ((a + b) * c) / d
      @expBeforeMul = |a Integer, b Integer, c Integer| -> result: a * b ** c
      @parenBeforeExp = |a Integer, b Integer, c Integer| -> result: (a * b) ** c
      @leftAssocSub = |a Integer, b Integer, c Integer| -> result: a - b - c
      @leftAssocDiv = |a Integer, b Integer, c Integer| -> result: a / b / c
      @rightAssocExp = |a Integer, b Integer, c Integer| -> result: a ** b ** c
      @mixedChain = |a Integer, b Integer, c Integer, d Integer| -> result: a + b * c - d
  `;

  // ─── Precedence ──────────────────────────────────────────────────────────

  it('multiplication before addition: 2 + 3 * 4 = 14', async () => {
    await expectBehavior(precedenceScript, inp3('@mulBeforeAdd', 2, 3, 4), out(14));
  });

  it('multiplication before subtraction: 10 - 2 * 3 = 4', async () => {
    await expectBehavior(precedenceScript, inp3('@mulBeforeSub', 10, 2, 3), out(4));
  });

  it('division before addition: 1 + 8 / 4 = 3', async () => {
    await expectBehavior(precedenceScript, inp3('@divBeforeAdd', 1, 8, 4), out(3));
  });

  it('remainder before addition: 1 + 7 % 3 = 2', async () => {
    await expectBehavior(precedenceScript, inp3('@remBeforeAdd', 1, 7, 3), out(2));
  });

  // ─── Parentheses ─────────────────────────────────────────────────────────

  it('parentheses override: (2 + 3) * 4 = 20', async () => {
    await expectBehavior(precedenceScript, inp3('@parenAdd', 2, 3, 4), out(20));
  });

  it('parentheses on right: 3 * (5 - 2) = 9', async () => {
    await expectBehavior(precedenceScript, inp3('@parenSub', 3, 5, 2), out(9));
  });

  it('parentheses with division: (10 + 2) / 4 = 3', async () => {
    await expectBehavior(precedenceScript, inp3('@parenDiv', 10, 2, 4), out(3));
  });

  it('parentheses with remainder: (10 + 1) % 4 = 3', async () => {
    await expectBehavior(precedenceScript, inp3('@parenRem', 10, 1, 4), out(3));
  });

  // ─── Nested parentheses ──────────────────────────────────────────────────

  it('nested: (2 + 3) * (7 - 4) = 15', async () => {
    await expectBehavior(precedenceScript, inp4('@nested', 2, 3, 7, 4), out(15));
  });

  it('deep nest: ((2 + 3) * 4) / 5 = 4', async () => {
    await expectBehavior(precedenceScript, inp4('@deepNest', 2, 3, 4, 5), out(4));
  });

  // ─── Exponentiation precedence ─────────────────────────────────────────────

  it('** binds tighter than *: 2 * 3 ** 2 = 18 (not 36)', async () => {
    await expectBehavior(precedenceScript, inp3('@expBeforeMul', 2, 3, 2), out(18));
  });

  it('parens override **: (2 * 3) ** 2 = 36', async () => {
    await expectBehavior(precedenceScript, inp3('@parenBeforeExp', 2, 3, 2), out(36));
  });

  // ─── Left-to-right associativity ─────────────────────────────────────────

  it('subtraction is left-associative: 10 - 3 - 2 = 5 (not 9)', async () => {
    await expectBehavior(precedenceScript, inp3('@leftAssocSub', 10, 3, 2), out(5));
  });

  it('division is left-associative: 24 / 4 / 2 = 3 (not 12)', async () => {
    await expectBehavior(precedenceScript, inp3('@leftAssocDiv', 24, 4, 2), out(3));
  });

  it('** is right-associative: 2 ** 3 ** 2 = 512 (not 64)', async () => {
    // 2 ** (3 ** 2) = 2 ** 9 = 512, not (2 ** 3) ** 2 = 8 ** 2 = 64
    await expectBehavior(precedenceScript, inp3('@rightAssocExp', 2, 3, 2), out(512));
  });

  // ─── Mixed precedence chain ──────────────────────────────────────────────

  it('mixed: 1 + 2 * 3 - 4 = 3', async () => {
    await expectBehavior(precedenceScript, inp4('@mixedChain', 1, 2, 3, 4), out(3));
  });
});
