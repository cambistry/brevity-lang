import { expectBehavior, compileActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Integer arithmetic: +, -, *, /, %, ^
// All integers are arbitrary-precision. Division truncates toward zero.
// Remainder sign follows the dividend.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
    @add = (a Integer, b Integer) -> result: a + b
    @sub = (a Integer, b Integer) -> result: a - b
    @mul = (a Integer, b Integer) -> result: a * b
    @div = (a Integer, b Integer) -> result: a / b
    @rem = (a Integer, b Integer) -> result: a % b
    @exp = (a Integer, b Integer) -> result: a ^ b

    // identity
    @identity
      =
      a Integer
      b Integer
      =
      quotient Integer = a / b
      remainder Integer = a % b
      reconstructed Integer = quotient * b + remainder
      return matches: reconstructed == a

    // precedence
    @mulBeforeAdd = (a Integer, b Integer, c Integer) -> result: a + b * c
    @mulBeforeSub = (a Integer, b Integer, c Integer) -> result: a - b * c
    @divBeforeAdd = (a Integer, b Integer, c Integer) -> result: a + b / c
    @remBeforeAdd = (a Integer, b Integer, c Integer) -> result: a + b % c
    @parenAdd = (a Integer, b Integer, c Integer) -> result: (a + b) * c
    @parenSub = (a Integer, b Integer, c Integer) -> result: a * (b - c)
    @parenDiv = (a Integer, b Integer, c Integer) -> result: (a + b) / c
    @parenRem = (a Integer, b Integer, c Integer) -> result: (a + b) % c
    @nested = (a Integer, b Integer, c Integer, d Integer) -> result: (a + b) * (c - d)
    @deepNest = (a Integer, b Integer, c Integer, d Integer) -> result: ((a + b) * c) / d
    @expBeforeMul = (a Integer, b Integer, c Integer) -> result: a * b ^ c
    @parenBeforeExp = (a Integer, b Integer, c Integer) -> result: (a * b) ^ c
    @leftAssocSub = (a Integer, b Integer, c Integer) -> result: a - b - c
    @leftAssocDiv = (a Integer, b Integer, c Integer) -> result: a / b / c
    @rightAssocExp = (a Integer, b Integer, c Integer) -> result: a ^ b ^ c
    @mixedChain = (a Integer, b Integer, c Integer, d Integer) -> result: a + b * c - d

    // identity
    @bigDivIdentity
      =
      a Integer
      b Integer
      =
      quotient Integer = a / b
      remainder Integer = a % b
      reconstructed Integer = quotient * b + remainder
      return matches: reconstructed == a

    // compound
    @compute = (a Integer, b Integer) -> result: (a + b) * 3 - a

    // conv
    @toFloat = (x Integer) -> result: Integer.to_float(x)
    @toDecimal = (x Integer) -> result: Integer.to_decimal(x)
    @toSelf = (x Integer) -> result: Integer.to_integer(x)

    // ref
    @refToFloat = { x *Integer = 42; return result: x.to_float }
    @refToDecimal = { x *Integer = 10; return result: x.to_decimal }
`;

async function expectN(script, input, expected) {
  // For tests where BigInt inputs produce results that fit in safe integer range.
  // JS returns BigInt (because inputs are BigInt), Rust returns Number (JSON layer normalizes).
  const actor = await (await compileActor(script)).spawn();
  await actor.sendAsync(input.input);
  const post = actor.posts[0];
  expect(post.id).toBe('1');
  expect(post['ty']).toEqual([{ result: 'Integer' }]);
  expect(Number(post.re[0].result)).toBe(expected);
}

// ─── Addition ────────────────────────────────────────────────────────────────

describe('Integer addition', () => {
  it('adds two positive integers', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 4], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('adds zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0, 5], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('adds negative integers', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3, -7], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -10 }], to: 'c' } });
  });

  it('adds mixed sign', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, -3], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('adds beyond 64-bit range', async () => {
    // 2^53 + 1 — exceeds JS Number.MAX_SAFE_INTEGER
    await expectBehavior(script, { input: { id: '1', op: [[9007199254740992n, 1n], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 9007199254740993n }], to: 'c' } });
  });

  it('adds very large integers', async () => {
    // 10^20 + 10^20 = 2 * 10^20
    await expectBehavior(script, { input: { id: '1', op: [[100000000000000000000n, 100000000000000000000n], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 200000000000000000000n }], to: 'c' } });
  });
});

// ─── Subtraction ─────────────────────────────────────────────────────────────

describe('Integer subtraction', () => {
  it('subtracts two positive integers', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 3], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('subtracts to negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 10], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -7 }], to: 'c' } });
  });

  it('subtracts zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42, 0], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('subtracts negative from negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-5, -3], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -2 }], to: 'c' } });
  });

  it('subtracts beyond 64-bit range', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-9007199254740992n, 1n], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -9007199254740993n }], to: 'c' } });
  });
});

// ─── Multiplication ──────────────────────────────────────────────────────────

describe('Integer multiplication', () => {
  it('multiplies two positive integers', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[6, 7], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('multiplies by zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[999, 0], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('multiplies by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42, 1], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('multiplies negative by positive', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3, 7], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -21 }], to: 'c' } });
  });

  it('multiplies negative by negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-4, -5], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 20 }], to: 'c' } });
  });

  it('multiplies large integers without overflow', async () => {
    // 10^10 * 10^10 = 10^20
    await expectBehavior(script, { input: { id: '1', op: [[10000000000n, 10000000000n], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 100000000000000000000n }], to: 'c' } });
  });

  it('multiplies beyond 64-bit range', async () => {
    // 2^40 * 2^40 = 2^80
    await expectBehavior(script, { input: { id: '1', op: [[1099511627776n, 1099511627776n], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1208925819614629174706176n }], to: 'c' } });
  });
});

// ─── Division (truncates toward zero) ────────────────────────────────────────

describe('Integer division', () => {
  it('divides evenly', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[12, 4], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('truncates toward zero (positive)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, 2], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('truncates toward zero (negative dividend)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7, 2], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -3 }], to: 'c' } });
  });

  it('truncates toward zero (negative divisor)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, -2], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -3 }], to: 'c' } });
  });

  it('truncates toward zero (both negative)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7, -2], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('divides by one', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42, 1], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('zero divided by anything is zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0, 7], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('divides large integers', async () => {
    // 10^20 / 10^10 = 10^10
    await expectN(script, { input: { id: '1', op: [[100000000000000000000n, 10000000000n], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, 10000000000);
  });
});

// ─── Remainder (sign follows dividend) ───────────────────────────────────────

describe('Integer remainder', () => {
  it('basic remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, 3], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('even division has zero remainder', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[9, 3], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('negative dividend — remainder is negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7, 3], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -1 }], to: 'c' } });
  });

  it('negative divisor — remainder sign follows dividend (positive)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, -3], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('both negative — remainder is negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7, -3], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -1 }], to: 'c' } });
  });

  it('zero remainder of anything is zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0, 5], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('remainder by one is always zero', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42, 1], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('remainder with large integers', async () => {
    // 10^20 + 7 mod 10^10 = 7
    await expectN(script, { input: { id: '1', op: [[100000000000000000007n, 10000000000n], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, 7);
  });
});

// ─── Exponentiation ──────────────────────────────────────────────────────────

describe('Integer exponentiation', () => {
  it('basic power: 2 ^ 3 = 8', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 8 }], to: 'c' } });
  });

  it('power of zero: 5 ^ 0 = 1', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5, 0], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('zero to the zero: 0 ^ 0 = 1', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0, 0], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('power of one: 7 ^ 1 = 7', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[7, 1], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } });
  });

  it('zero raised to positive: 0 ^ 5 = 0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0, 5], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('one raised to anything: 1 ^ 100 = 1', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1, 100], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  it('negative base even exponent: (-3) ^ 4 = 81', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3, 4], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 81 }], to: 'c' } });
  });

  it('negative base odd exponent: (-3) ^ 3 = -27', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-3, 3], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: -27 }], to: 'c' } });
  });

  it('large exponent produces arbitrary-precision result: 2 ^ 64', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2n, 64n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 18446744073709551616n }], to: 'c' } });
  });

  it('large base and exponent: 10 ^ 20', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10n, 20n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 100000000000000000000n }], to: 'c' } });
  });
});

// ─── Division + Remainder identity ───────────────────────────────────────────
// For all a, b (b ≠ 0): a == (a / b) * b + (a % b)

describe('Integer division/remainder identity', () => {
  it('identity holds for positive values', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[17, 5], 'identity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });

  it('identity holds for negative dividend', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-17, 5], 'identity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });

  it('identity holds for negative divisor', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[17, -5], 'identity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });

  it('identity holds for both negative', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-17, -5], 'identity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });

  it('identity holds for large integers', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[123456789012345678901n, 987654321n], 'identity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Order of operations and parentheses
// Standard precedence: ^ > * / % > + -
// Parentheses override precedence.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integer order of operations', () => {
  // ─── Precedence ──────────────────────────────────────────────────────────

  it('multiplication before addition: 2 + 3 * 4 = 14', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 4], 'mulBeforeAdd'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 14 }], to: 'c' } });
  });

  it('multiplication before subtraction: 10 - 2 * 3 = 4', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 2, 3], 'mulBeforeSub'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });

  it('division before addition: 1 + 8 / 4 = 3', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1, 8, 4], 'divBeforeAdd'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('remainder before addition: 1 + 7 % 3 = 2', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1, 7, 3], 'remBeforeAdd'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2 }], to: 'c' } });
  });

  // ─── Parentheses ─────────────────────────────────────────────────────────

  it('parentheses override: (2 + 3) * 4 = 20', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 4], 'parenAdd'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 20 }], to: 'c' } });
  });

  it('parentheses on right: 3 * (5 - 2) = 9', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[3, 5, 2], 'parenSub'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 9 }], to: 'c' } });
  });

  it('parentheses with division: (10 + 2) / 4 = 3', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 2, 4], 'parenDiv'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('parentheses with remainder: (10 + 1) % 4 = 3', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 1, 4], 'parenRem'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  // ─── Nested parentheses ──────────────────────────────────────────────────

  it('nested: (2 + 3) * (7 - 4) = 15', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 7, 4], 'nested'], 'ty': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 15 }], to: 'c' } });
  });

  it('deep nest: ((2 + 3) * 4) / 5 = 4', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 4, 5], 'deepNest'], 'ty': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 4 }], to: 'c' } });
  });

  // ─── Exponentiation precedence ─────────────────────────────────────────────

  it('^ binds tighter than *: 2 * 3 ^ 2 = 18 (not 36)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 2], 'expBeforeMul'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 18 }], to: 'c' } });
  });

  it('parens override ^: (2 * 3) ^ 2 = 36', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 2], 'parenBeforeExp'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 36 }], to: 'c' } });
  });

  // ─── Left-to-right associativity ─────────────────────────────────────────

  it('subtraction is left-associative: 10 - 3 - 2 = 5 (not 9)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[10, 3, 2], 'leftAssocSub'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });

  it('division is left-associative: 24 / 4 / 2 = 3 (not 12)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[24, 4, 2], 'leftAssocDiv'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
  });

  it('^ is right-associative: 2 ^ 3 ^ 2 = 512 (not 64)', async () => {
    // 2 ^ (3 ^ 2) = 2 ^ 9 = 512, not (2 ^ 3) ^ 2 = 8 ^ 2 = 64
    await expectBehavior(script, { input: { id: '1', op: [[2, 3, 2], 'rightAssocExp'], 'ty': [['Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 512 }], to: 'c' } });
  });

  // ─── Mixed precedence chain ──────────────────────────────────────────────

  it('mixed: 1 + 2 * 3 - 4 = 3', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[1, 2, 3, 4], 'mixedChain'], 'ty': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } });
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
    await expectBehavior(script, { input: { id: '1', op: [[9007199254740991n, 1n], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 9007199254740992n }], to: 'c' } });
  });

  it('MAX_SAFE_INTEGER + 2 is exact (f64 would round)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[9007199254740991n, 2n], 'add'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 9007199254740993n }], to: 'c' } });
  });

  it('consecutive large integers are distinguishable', async () => {
    // f64 maps both 9007199254740993 and 9007199254740992 to the same value
    await expectBehavior(script,
      { input: { id: '1', op: [[9007199254740993n, 9007199254740992n], 'sub'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } });
  });

  // ─── Multiplication precision ──────────────────────────────────────────────
  // Multiply two large primes: result has ~30 digits, f64 can only hold ~15

  it('product of two large primes is exact', async () => {
    // 999999999999999877 * 999999999999999613 — both 18 digits
    // f64 would lose the low-order digits
    const a = 999999999999999877n;
    const b = 999999999999999613n;
    const expected = a * b; // 999999999999999490000000000000195601n (36 digits)
    await expectBehavior(script, { input: { id: '1', op: [[a, b], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  it('2^100 is exact', async () => {
    // 2^100 = 1267650600228229401496703205376 (31 digits)
    const expected = 2n ** 100n;
    await expectBehavior(script, { input: { id: '1', op: [[2n, 100n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  it('2^200 is exact', async () => {
    const expected = 2n ** 200n;
    await expectBehavior(script, { input: { id: '1', op: [[2n, 200n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  // ─── Division precision ────────────────────────────────────────────────────
  // Large number / small divisor: quotient must be exact

  it('large division is exact', async () => {
    // 10^30 / 7 — truncated integer division
    const a = 10n ** 30n;
    const expected = a / 7n; // 142857142857142857142857142857n
    await expectBehavior(script, { input: { id: '1', op: [[a, 7n], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  it('division of very large numbers', async () => {
    const a = 2n ** 128n;
    const b = 2n ** 64n;
    await expectBehavior(script, { input: { id: '1', op: [[a, b], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 2n ** 64n }], to: 'c' } });
  });

  // ─── Remainder precision ───────────────────────────────────────────────────

  it('remainder of large number is exact', async () => {
    const a = 10n ** 30n + 42n;
    await expectBehavior(script, { input: { id: '1', op: [[a, 100n], 'rem'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } });
  });

  // ─── Exponentiation producing huge numbers ─────────────────────────────────

  it('3^100 is exact (48 digits)', async () => {
    const expected = 3n ** 100n;
    // 515377520732011331036461129765621272702107522001
    await expectBehavior(script, { input: { id: '1', op: [[3n, 100n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  it('10^50 is exact', async () => {
    const expected = 10n ** 50n;
    await expectBehavior(script, { input: { id: '1', op: [[10n, 50n], 'exp'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  // ─── Chain of operations at scale ──────────────────────────────────────────

  it('division-remainder identity at large scale', async () => {
    // a = (a / b) * b + (a % b) for 100+ digit numbers
    const a = 123456789012345678901234567890123456789n;
    const b = 9876543210987654321n;
    await expectBehavior(script, { input: { id: '1', op: [[a, b], 'bigDivIdentity'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ matches: 'Boolean' }], re: [{ matches: true }], to: 'c' } });
  });

  // ─── Negative large numbers ────────────────────────────────────────────────

  it('negative large multiplication', async () => {
    const a = -(10n ** 20n);
    const b = 10n ** 20n;
    const expected = -(10n ** 40n);
    await expectBehavior(script, { input: { id: '1', op: [[a, b], 'mul'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  it('negative large division truncates toward zero', async () => {
    const a = -(10n ** 30n + 1n);
    // -1000000000000000000000000000001 / 3 = -333333333333333333333333333333 (truncated)
    const expected = a / 3n;
    await expectBehavior(script, { input: { id: '1', op: [[a, 3n], 'div'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });

  // ─── Fibonacci-scale test (compound operations) ───────────────────────────

  it('compound arithmetic with huge intermediates', async () => {
    // (2^128 + 2^64) * 3 - 2^128 = 2^128 * 2 + 2^64 * 3
    const a = 2n ** 128n;
    const b = 2n ** 64n;
    const expected = (a + b) * 3n - a; // = 2a + 3b
    await expectBehavior(script, { input: { id: '1', op: [[a, b], 'compute'], 'ty': [['Integer', 'Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: expected }], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integer type conversions: to_float, to_decimal
// Integer.to_float(x) → Float, Integer.to_decimal(x) → Decimal
// Also available as dot methods on *Integer ref cells.
// to_integer on Integer is identity.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integer type conversions', () => {
  it('to_float(42) = 42.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42], 'toFloat'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('to_float(0) = 0.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0], 'toFloat'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_float(-7) = -7.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7], 'toFloat'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: -7 }], to: 'c' } });
  });

  it('to_decimal(42) = 42.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[42], 'toDecimal'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('to_decimal(0) = 0.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[0], 'toDecimal'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 0 }], to: 'c' } });
  });

  it('to_decimal(-7) = -7.0', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[-7], 'toDecimal'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: -7 }], to: 'c' } });
  });

  it('to_integer(5) = 5 (identity)', async () => {
    await expectBehavior(script, { input: { id: '1', op: [[5], 'toSelf'], 'ty': [['Integer']], from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } });
  });
});

describe('Integer conversion via ref cell dot method', () => {
  it('x.to_float on *Integer ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToFloat', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Float' }], re: [{ result: 42 }], to: 'c' } });
  });

  it('x.to_decimal on *Integer ref', async () => {
    await expectBehavior(script, { input: { id: '1', op: 'refToDecimal', from: 'c' } }, { output: { id: '1', 'ty': [{ result: 'Decimal' }], re: [{ result: 10 }], to: 'c' } });
  });
});
