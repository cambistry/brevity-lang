import { expectBehavior, compileActor } from '../helpers.js';

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
async function expectN(script, input, expected) {
  // For tests where BigInt inputs produce results that fit in safe integer range.
  // JS returns BigInt (because inputs are BigInt), Rust returns Number (JSON layer normalizes).
  const actor = await (await compileActor(script)).spawn();
  await actor.sendAsync(input.input);
  const post = actor.posts[0];
  expect(post.id).toBe('1');
  expect(post['bv-a']).toEqual({ result: 'Integer' });
  expect(Number(post.re.result)).toBe(expected);
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
    // 2^53 + 1 — exceeds JS Number.MAX_SAFE_INTEGER
    await expectBehavior(script, inp2('@add', 9007199254740992n, 1n), out(9007199254740993n));
  });

  it('adds very large integers', async () => {
    // 10^20 + 10^20 = 2 * 10^20
    await expectBehavior(script, inp2('@add', 100000000000000000000n, 100000000000000000000n), out(200000000000000000000n));
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
    await expectBehavior(script, inp2('@sub', -9007199254740992n, 1n), out(-9007199254740993n));
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
    // 10^10 * 10^10 = 10^20
    await expectBehavior(script, inp2('@mul', 10000000000n, 10000000000n), out(100000000000000000000n));
  });

  it('multiplies beyond 64-bit range', async () => {
    // 2^40 * 2^40 = 2^80
    await expectBehavior(script, inp2('@mul', 1099511627776n, 1099511627776n), out(1208925819614629174706176n));
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
    // 10^20 / 10^10 = 10^10
    await expectN(script, inp2('@div', 100000000000000000000n, 10000000000n), 10000000000);
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

  it('remainder with large integers', async () => {
    // 10^20 + 7 mod 10^10 = 7
    await expectN(script, inp2('@rem', 100000000000000000007n, 10000000000n), 7);
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
    await expectBehavior(script, inp2('@exp', 2n, 64n), out(18446744073709551616n));
  });

  it('large base and exponent: 10 ** 20', async () => {
    await expectBehavior(script, inp2('@exp', 10n, 20n), out(100000000000000000000n));
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
    await expectBehavior(identityScript, inp2('@identity', 123456789012345678901n, 987654321n), outBool(true));
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

// ═══════════════════════════════════════════════════════════════════════════════
// Arbitrary-precision BigInt: tests that FAIL if integers are f64
// These verify exact results where IEEE 754 would silently lose precision.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Arbitrary-precision integers', () => {
  // ─── Addition precision ─────────────────────────────────────────────────────
  // Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9007199254740991
  // Adding 1 to it must produce 9007199254740992, adding 2 must produce 9007199254740993
  // f64 cannot distinguish 9007199254740992 from 9007199254740993

  it('MAX_SAFE_INTEGER + 1 is exact', async () => {
    await expectBehavior(script, inp2('@add', 9007199254740991n, 1n), out(9007199254740992n));
  });

  it('MAX_SAFE_INTEGER + 2 is exact (f64 would round)', async () => {
    await expectBehavior(script, inp2('@add', 9007199254740991n, 2n), out(9007199254740993n));
  });

  it('consecutive large integers are distinguishable', async () => {
    // f64 maps both 9007199254740993 and 9007199254740992 to the same value
    await expectBehavior(script,
      inp2('@sub', 9007199254740993n, 9007199254740992n), out(1));
  });

  // ─── Multiplication precision ──────────────────────────────────────────────
  // Multiply two large primes: result has ~30 digits, f64 can only hold ~15

  it('product of two large primes is exact', async () => {
    // 999999999999999877 * 999999999999999613 — both 18 digits
    // f64 would lose the low-order digits
    const a = 999999999999999877n;
    const b = 999999999999999613n;
    const expected = a * b; // 999999999999999490000000000000195601n (36 digits)
    await expectBehavior(script, inp2('@mul', a, b), out(expected));
  });

  it('2^100 is exact', async () => {
    // 2^100 = 1267650600228229401496703205376 (31 digits)
    const expected = 2n ** 100n;
    await expectBehavior(script, inp2('@exp', 2n, 100n), out(expected));
  });

  it('2^200 is exact', async () => {
    const expected = 2n ** 200n;
    await expectBehavior(script, inp2('@exp', 2n, 200n), out(expected));
  });

  // ─── Division precision ────────────────────────────────────────────────────
  // Large number / small divisor: quotient must be exact

  it('large division is exact', async () => {
    // 10^30 / 7 — truncated integer division
    const a = 10n ** 30n;
    const expected = a / 7n; // 142857142857142857142857142857n
    await expectBehavior(script, inp2('@div', a, 7n), out(expected));
  });

  it('division of very large numbers', async () => {
    const a = 2n ** 128n;
    const b = 2n ** 64n;
    await expectBehavior(script, inp2('@div', a, b), out(2n ** 64n));
  });

  // ─── Remainder precision ───────────────────────────────────────────────────

  it('remainder of large number is exact', async () => {
    const a = 10n ** 30n + 42n;
    await expectBehavior(script, inp2('@rem', a, 100n), out(42));
  });

  // ─── Exponentiation producing huge numbers ─────────────────────────────────

  it('3^100 is exact (48 digits)', async () => {
    const expected = 3n ** 100n;
    // 515377520732011331036461129765621272702107522001
    await expectBehavior(script, inp2('@exp', 3n, 100n), out(expected));
  });

  it('10^50 is exact', async () => {
    const expected = 10n ** 50n;
    await expectBehavior(script, inp2('@exp', 10n, 50n), out(expected));
  });

  // ─── Chain of operations at scale ──────────────────────────────────────────

  it('division-remainder identity at large scale', async () => {
    // a = (a / b) * b + (a % b) for 100+ digit numbers
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
    const a = 123456789012345678901234567890123456789n;
    const b = 9876543210987654321n;
    await expectBehavior(identityScript, inp2('@identity', a, b), outBool(true));
  });

  // ─── Negative large numbers ────────────────────────────────────────────────

  it('negative large multiplication', async () => {
    const a = -(10n ** 20n);
    const b = 10n ** 20n;
    const expected = -(10n ** 40n);
    await expectBehavior(script, inp2('@mul', a, b), out(expected));
  });

  it('negative large division truncates toward zero', async () => {
    const a = -(10n ** 30n + 1n);
    // -1000000000000000000000000000001 / 3 = -333333333333333333333333333333 (truncated)
    const expected = a / 3n;
    await expectBehavior(script, inp2('@div', a, 3n), out(expected));
  });

  // ─── Fibonacci-scale test (compound operations) ───────────────────────────

  it('compound arithmetic with huge intermediates', async () => {
    // (2^128 + 2^64) * 3 - 2^128 = 2^128 * 2 + 2^64 * 3
    const compoundScript = `
        @compute = |a Integer, b Integer| -> result: (a + b) * 3 - a
    `;
    const a = 2n ** 128n;
    const b = 2n ** 64n;
    const expected = (a + b) * 3n - a; // = 2a + 3b
    await expectBehavior(compoundScript, inp2('@compute', a, b), out(expected));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integer type conversions: to_float, to_decimal
// Integer.to_float(x) → Float, Integer.to_decimal(x) → Decimal
// Also available as dot methods on *Integer ref cells.
// to_integer on Integer is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integer type conversions', () => {
  const convScript = `
      @toFloat = |x Integer| -> result: Integer.to_float(x)
      @toDecimal = |x Integer| -> result: Integer.to_decimal(x)
      @toSelf = |x Integer| -> result: Integer.to_integer(x)
  `;

  function inpI(op, a) {
    return { input: { id: '1', op: [[a], op], 'bv-a': [['Integer']], from: 'c' } };
  }
  function outFloat(result) {
    return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
  }
  function outDecimal(result) {
    return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
  }

  it('to_float(42) = 42.0', async () => {
    await expectBehavior(convScript, inpI('@toFloat', 42), outFloat(42));
  });

  it('to_float(0) = 0.0', async () => {
    await expectBehavior(convScript, inpI('@toFloat', 0), outFloat(0));
  });

  it('to_float(-7) = -7.0', async () => {
    await expectBehavior(convScript, inpI('@toFloat', -7), outFloat(-7));
  });

  it('to_decimal(42) = 42.0', async () => {
    await expectBehavior(convScript, inpI('@toDecimal', 42), outDecimal(42));
  });

  it('to_decimal(0) = 0.0', async () => {
    await expectBehavior(convScript, inpI('@toDecimal', 0), outDecimal(0));
  });

  it('to_decimal(-7) = -7.0', async () => {
    await expectBehavior(convScript, inpI('@toDecimal', -7), outDecimal(-7));
  });

  it('to_integer(5) = 5 (identity)', async () => {
    await expectBehavior(convScript, inpI('@toSelf', 5), out(5));
  });
});

describe('Integer conversion via ref cell dot method', () => {
  const refScript = `
      @toFloat = { x *Integer = 42; -> result: x.to_float }
      @toDecimal = { x *Integer = 10; -> result: x.to_decimal }
  `;

  function outFloat(result) {
    return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
  }
  function outDecimal(result) {
    return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
  }

  it('x.to_float on *Integer ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toFloat', from: 'c' } }, outFloat(42));
  });

  it('x.to_decimal on *Integer ref', async () => {
    await expectBehavior(refScript, { input: { id: '1', op: '@toDecimal', from: 'c' } }, outDecimal(10));
  });
});
