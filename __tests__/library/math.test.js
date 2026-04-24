import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Math library: built-in math functions available via Math.method() or .method()
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared script: consolidate all behaviors to reduce compilation count ─────

const script = `
    @ceilF = |x Float| -> result: Math.ceil(x)
    @ceilD = |x Decimal| -> result: Math.ceil(x)
    @floorF = |x Float| -> result: Math.floor(x)
    @floorD = |x Decimal| -> result: Math.floor(x)
    @roundF = |x Float| -> result: Math.round(x)
    @roundD = |x Decimal| -> result: Math.round(x)
    @truncF = |x Float| -> result: Math.trunc(x)
    @truncD = |x Decimal| -> result: Math.trunc(x)
    @absI = |x Integer| -> result: Math.abs(x)
    @absF = |x Float| -> result: Math.abs(x)
    @absD = |x Decimal| -> result: Math.abs(x)
    @signI = |x Integer| -> result: Math.sign(x)
    @signF = |x Float| -> result: Math.sign(x)
    @signD = |x Decimal| -> result: Math.sign(x)
    @minI = |a Integer, b Integer| -> result: Math.min(a, b)
    @maxI = |a Integer, b Integer| -> result: Math.max(a, b)
    @minF = |a Float, b Float| -> result: Math.min(a, b)
    @maxF = |a Float, b Float| -> result: Math.max(a, b)
    @minD = |a Decimal, b Decimal| -> result: Math.min(a, b)
    @maxD = |a Decimal, b Decimal| -> result: Math.max(a, b)
    @min3I = |a Integer, b Integer, c Integer| -> result: Math.min(a, b, c)
    @max3I = |a Integer, b Integer, c Integer| -> result: Math.max(a, b, c)
    @min1I = |a Integer| -> result: Math.min(a)
    @sqrtF = |x Float| -> result: Math.sqrt(x)
    @sqrtI = |x Integer| -> result: Math.sqrt(x)
    @sqrtD = |x Decimal| -> result: Math.sqrt(x)
    @expF = |x Float| -> result: Math.exp(x)
    @expI = |x Integer| -> result: Math.exp(x)
    @expD = |x Decimal| -> result: Math.exp(x)
    @logF = |x Float| -> result: Math.log(x)
    @logI = |x Integer| -> result: Math.log(x)
    @logD = |x Decimal| -> result: Math.log(x)
    @logBase = |x Float, base Float| -> result: Math.log(x, base)
    @logBaseI = |x Integer, base Integer| -> result: Math.log(x, base)
    @logBaseD = |x Decimal, base Decimal| -> result: Math.log(x, base)
    @sinF  = |x Float| -> result: Math.sin(x)
    @sinI  = |x Integer| -> result: Math.sin(x)
    @sinD  = |x Decimal| -> result: Math.sin(x)
    @cosF  = |x Float| -> result: Math.cos(x)
    @cosI  = |x Integer| -> result: Math.cos(x)
    @cosD  = |x Decimal| -> result: Math.cos(x)
    @tanF  = |x Float| -> result: Math.tan(x)
    @tanI  = |x Integer| -> result: Math.tan(x)
    @tanD  = |x Decimal| -> result: Math.tan(x)
    @asinF = |x Float| -> result: Math.asin(x)
    @asinI = |x Integer| -> result: Math.asin(x)
    @asinD = |x Decimal| -> result: Math.asin(x)
    @acosF = |x Float| -> result: Math.acos(x)
    @acosI = |x Integer| -> result: Math.acos(x)
    @acosD = |x Decimal| -> result: Math.acos(x)
    @atanF = |x Float| -> result: Math.atan(x)
    @atanI = |x Integer| -> result: Math.atan(x)
    @atanD = |x Decimal| -> result: Math.atan(x)
    @atan2F = |y Float, x Float| -> result: Math.atan2(y, x)
    @atan2I = |y Integer, x Integer| -> result: Math.atan2(y, x)
    @atan2D = |y Decimal, x Decimal| -> result: Math.atan2(y, x)
    @powII = |a Integer, b Integer| -> result: Math.pow(a, b)
    @powFF = |a Float, b Float| -> result: Math.pow(a, b)
    @powDI = |a Decimal, b Integer| -> result: Math.pow(a, b)
    @powFI = |a Float, b Integer| -> result: Math.pow(a, b)
    @powIF = |a Integer, b Float| -> result: Math.pow(a, b)
    @powDF = |a Decimal, b Float| -> result: Math.pow(a, b)
    @sinhF = |x Float| -> result: Math.sinh(x)
    @sinhI = |x Integer| -> result: Math.sinh(x)
    @sinhD = |x Decimal| -> result: Math.sinh(x)
    @coshF = |x Float| -> result: Math.cosh(x)
    @coshI = |x Integer| -> result: Math.cosh(x)
    @coshD = |x Decimal| -> result: Math.cosh(x)
    @tanhF = |x Float| -> result: Math.tanh(x)
    @tanhI = |x Integer| -> result: Math.tanh(x)
    @tanhD = |x Decimal| -> result: Math.tanh(x)
    @asinhF = |x Float| -> result: Math.asinh(x)
    @asinhI = |x Integer| -> result: Math.asinh(x)
    @asinhD = |x Decimal| -> result: Math.asinh(x)
    @acoshF = |x Float| -> result: Math.acosh(x)
    @acoshI = |x Integer| -> result: Math.acosh(x)
    @acoshD = |x Decimal| -> result: Math.acosh(x)
    @atanhF = |x Float| -> result: Math.atanh(x)
    @atanhD = |x Decimal| -> result: Math.atanh(x)
    @divD = |a Decimal, b Decimal, p Integer| -> result: Math.divide(a, b, p)
`;

function inp(op, args, types) {
  return { input: { id: '1', op: [args, op], 'bv-a': [types], from: 'c' } };
}
function inp0(op) {
  return { input: { id: '1', op, from: 'c' } };
}
function outF(result) {
  return { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result }, to: 'c' } };
}
function outI(result) {
  return { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result }, to: 'c' } };
}
function outD(result) {
  return { output: { id: '1', 'bv-a': { result: 'Decimal' }, re: { result }, to: 'c' } };
}

// ─── ceil ────────────────────────────────────────────────────────────────

describe('Math.ceil', () => {
  it('ceil(2.3) = 3', async () => {
    await expectBehavior(script, inp('@ceilF', [2.3e0], ['Float']), outI(3));
  });

  it('ceil(-2.3) = -2', async () => {
    await expectBehavior(script, inp('@ceilF', [-2.3e0], ['Float']), outI(-2));
  });

  it('ceil(3.0) = 3', async () => {
    await expectBehavior(script, inp('@ceilF', [3.0e0], ['Float']), outI(3));
  });

  it('ceil(Decimal 2.7) = 3', async () => {
    await expectBehavior(script, inp('@ceilD', [2.7], ['Decimal']), outI(3));
  });

  it('ceil(Decimal -1.2) = -1', async () => {
    await expectBehavior(script, inp('@ceilD', [-1.2], ['Decimal']), outI(-1));
  });

  it('ceil(Integer) is a compile error', () => {
    expect(() => compileSource(`
      @test = -> result: Math.ceil(5)
    `)).toThrow();
  });
});

// ─── floor ──────────────────────────────────────────────────────────────

describe('Math.floor', () => {
  it('floor(2.7) = 2', async () => {
    await expectBehavior(script, inp('@floorF', [2.7e0], ['Float']), outI(2));
  });

  it('floor(-2.3) = -3', async () => {
    await expectBehavior(script, inp('@floorF', [-2.3e0], ['Float']), outI(-3));
  });

  it('floor(3.0) = 3', async () => {
    await expectBehavior(script, inp('@floorF', [3.0e0], ['Float']), outI(3));
  });

  it('floor(Decimal 2.7) = 2', async () => {
    await expectBehavior(script, inp('@floorD', [2.7], ['Decimal']), outI(2));
  });

  it('floor(Decimal -1.2) = -2', async () => {
    await expectBehavior(script, inp('@floorD', [-1.2], ['Decimal']), outI(-2));
  });
});

// ─── round (half away from zero) ────────────────────────────────────────

describe('Math.round', () => {
  it('round(2.3) = 2', async () => {
    await expectBehavior(script, inp('@roundF', [2.3e0], ['Float']), outI(2));
  });

  it('round(2.5) = 3', async () => {
    await expectBehavior(script, inp('@roundF', [2.5e0], ['Float']), outI(3));
  });

  it('round(-2.5) = -3 (half away from zero)', async () => {
    await expectBehavior(script, inp('@roundF', [-2.5e0], ['Float']), outI(-3));
  });

  it('round(2.7) = 3', async () => {
    await expectBehavior(script, inp('@roundF', [2.7e0], ['Float']), outI(3));
  });

  it('round(-0.5) = -1 (NOT 0, unlike JS Math.round)', async () => {
    await expectBehavior(script, inp('@roundF', [-5.0e-1], ['Float']), outI(-1));
  });

  it('round(Decimal 2.5) = 3', async () => {
    await expectBehavior(script, inp('@roundD', [2.5], ['Decimal']), outI(3));
  });

  it('round(Decimal -2.5) = -3', async () => {
    await expectBehavior(script, inp('@roundD', [-2.5], ['Decimal']), outI(-3));
  });
});

// ─── trunc ──────────────────────────────────────────────────────────────

describe('Math.trunc', () => {
  it('trunc(2.7) = 2', async () => {
    await expectBehavior(script, inp('@truncF', [2.7e0], ['Float']), outI(2));
  });

  it('trunc(-2.7) = -2', async () => {
    await expectBehavior(script, inp('@truncF', [-2.7e0], ['Float']), outI(-2));
  });

  it('trunc(Decimal 2.7) = 2', async () => {
    await expectBehavior(script, inp('@truncD', [2.7], ['Decimal']), outI(2));
  });

  it('trunc(Decimal -2.7) = -2', async () => {
    await expectBehavior(script, inp('@truncD', [-2.7], ['Decimal']), outI(-2));
  });
});

// ─── abs ─────────────────────────────────────────────────────────────────

describe('Math.abs', () => {
  it('abs(-5) = 5 (Integer)', async () => {
    await expectBehavior(script, inp('@absI', [-5], ['Integer']), outI(5));
  });

  it('abs(5) = 5 (Integer)', async () => {
    await expectBehavior(script, inp('@absI', [5], ['Integer']), outI(5));
  });

  it('abs(0) = 0 (Integer)', async () => {
    await expectBehavior(script, inp('@absI', [0], ['Integer']), outI(0));
  });

  it('abs(-3.14) = 3.14 (Float)', async () => {
    await expectBehavior(script, inp('@absF', [-3.14e0], ['Float']), outF(3.14));
  });

  it('abs(-2.5) = 2.5 (Decimal)', async () => {
    await expectBehavior(script, inp('@absD', [-2.5], ['Decimal']), outD(2.5));
  });
});

// ─── sign ────────────────────────────────────────────────────────────────

describe('Math.sign', () => {
  it('sign(42) = 1', async () => {
    await expectBehavior(script, inp('@signI', [42], ['Integer']), outI(1));
  });

  it('sign(-7) = -1', async () => {
    await expectBehavior(script, inp('@signI', [-7], ['Integer']), outI(-1));
  });

  it('sign(0) = 0', async () => {
    await expectBehavior(script, inp('@signI', [0], ['Integer']), outI(0));
  });

  it('sign(3.14) = 1 (Float)', async () => {
    await expectBehavior(script, inp('@signF', [3.14e0], ['Float']), outI(1));
  });

  it('sign(-2.0) = -1 (Float)', async () => {
    await expectBehavior(script, inp('@signF', [-2.0e0], ['Float']), outI(-1));
  });

  it('sign(2.5) = 1 (Decimal)', async () => {
    await expectBehavior(script, inp('@signD', [2.5], ['Decimal']), outI(1));
  });

  it('sign(-3.7) = -1 (Decimal)', async () => {
    await expectBehavior(script, inp('@signD', [-3.7], ['Decimal']), outI(-1));
  });

  it('sign(0.0) = 0 (Decimal)', async () => {
    await expectBehavior(script, inp('@signD', [0.0], ['Decimal']), outI(0));
  });
});

// ─── min / max ──────────────────────────────────────────────────────────

describe('Math.min / Math.max', () => {
  it('min(3, 7) = 3', async () => {
    await expectBehavior(script, inp('@minI', [3, 7], ['Integer', 'Integer']), outI(3));
  });

  it('max(3, 7) = 7', async () => {
    await expectBehavior(script, inp('@maxI', [3, 7], ['Integer', 'Integer']), outI(7));
  });

  it('min(-1, 1) = -1', async () => {
    await expectBehavior(script, inp('@minI', [-1, 1], ['Integer', 'Integer']), outI(-1));
  });

  it('min(2.5, 3.5) = 2.5 (Float)', async () => {
    await expectBehavior(script, inp('@minF', [2.5e0, 3.5e0], ['Float', 'Float']), outF(2.5));
  });

  it('max(2.5, 3.5) = 3.5 (Float)', async () => {
    await expectBehavior(script, inp('@maxF', [2.5e0, 3.5e0], ['Float', 'Float']), outF(3.5));
  });

  it('min(1.5, 2.5) = 1.5 (Decimal)', async () => {
    await expectBehavior(script, inp('@minD', [1.5, 2.5], ['Decimal', 'Decimal']), outD(1.5));
  });

  it('max(1.5, 2.5) = 2.5 (Decimal)', async () => {
    await expectBehavior(script, inp('@maxD', [1.5, 2.5], ['Decimal', 'Decimal']), outD(2.5));
  });

  it('min(a) = a (single arg identity)', async () => {
    await expectBehavior(script, inp('@min1I', [42], ['Integer']), outI(42));
  });

  it('min(5, 2, 8) = 2 (variadic)', async () => {
    await expectBehavior(script, inp('@min3I', [5, 2, 8], ['Integer', 'Integer', 'Integer']), outI(2));
  });

  it('max(5, 2, 8) = 8 (variadic)', async () => {
    await expectBehavior(script, inp('@max3I', [5, 2, 8], ['Integer', 'Integer', 'Integer']), outI(8));
  });
});

// ─── sqrt ────────────────────────────────────────────────────────────────

describe('Math.sqrt', () => {
  it('sqrt(4.0) = 2.0', async () => {
    await expectBehavior(script, inp('@sqrtF', [4.0e0], ['Float']), outF(2.0));
  });

  it('sqrt(2.0) ≈ 1.4142...', async () => {
    await expectBehavior(script, inp('@sqrtF', [2.0e0], ['Float']), outF(Math.sqrt(2)));
  });

  it('sqrt(9) = 3.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@sqrtI', [9], ['Integer']), outF(3.0));
  });

  it('sqrt(Decimal 4.0) = 2.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@sqrtD', [4.0], ['Decimal']), outF(2.0));
  });
});

// ─── exp / log ──────────────────────────────────────────────────────────

describe('Math.exp / Math.log', () => {
  it('exp(0.0) = 1.0', async () => {
    await expectBehavior(script, inp('@expF', [0.0e0], ['Float']), outF(1.0));
  });

  it('exp(1.0) = e', async () => {
    await expectBehavior(script, inp('@expF', [1.0e0], ['Float']), outF(Math.E));
  });

  it('exp(0) = 1.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@expI', [0], ['Integer']), outF(1.0));
  });

  it('exp(Decimal 1.0) = e (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@expD', [1.0], ['Decimal']), outF(Math.E));
  });

  it('log(1.0) = 0.0', async () => {
    await expectBehavior(script, inp('@logF', [1.0e0], ['Float']), outF(0.0));
  });

  it('log(e) = 1.0', async () => {
    await expectBehavior(script, inp('@logF', [Math.E], ['Float']), outF(1.0));
  });

  it('log(1) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@logI', [1], ['Integer']), outF(0.0));
  });

  it('log(Decimal 1.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@logD', [1.0], ['Decimal']), outF(0.0));
  });

  it('log(8.0, 2.0) ≈ 3.0 (log base 2)', async () => {
    await expectBehavior(script, inp('@logBase', [8.0e0, 2.0e0], ['Float', 'Float']), outF(Math.log(8) / Math.log(2)));
  });

  it('log(100.0, 10.0) ≈ 2.0 (log base 10)', async () => {
    await expectBehavior(script, inp('@logBase', [1.0e2, 1.0e1], ['Float', 'Float']), outF(Math.log(100) / Math.log(10)));
  });

  it('log(8, 2) ≈ 3.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@logBaseI', [8, 2], ['Integer', 'Integer']), outF(Math.log(8) / Math.log(2)));
  });

  it('log(Decimal 100.0, Decimal 10.0) ≈ 2.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@logBaseD', [100.0, 10.0], ['Decimal', 'Decimal']), outF(Math.log(100) / Math.log(10)));
  });
});

// ─── Trigonometry ────────────────────────────────────────────────────────

describe('Math trigonometry', () => {
  it('sin(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@sinF', [0.0e0], ['Float']), outF(0.0));
  });

  it('sin(0) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@sinI', [0], ['Integer']), outF(0.0));
  });

  it('sin(Decimal 0.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@sinD', [0.0], ['Decimal']), outF(0.0));
  });

  it('cos(0.0) = 1.0', async () => {
    await expectBehavior(script, inp('@cosF', [0.0e0], ['Float']), outF(1.0));
  });

  it('cos(0) = 1.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@cosI', [0], ['Integer']), outF(1.0));
  });

  it('cos(Decimal 0.0) = 1.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@cosD', [0.0], ['Decimal']), outF(1.0));
  });

  it('tan(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@tanF', [0.0e0], ['Float']), outF(0.0));
  });

  it('tan(0) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@tanI', [0], ['Integer']), outF(0.0));
  });

  it('tan(Decimal 0.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@tanD', [0.0], ['Decimal']), outF(0.0));
  });

  it('sin(pi/2) ≈ 1.0', async () => {
    const halfPi = Math.PI / 2;
    await expectBehavior(script, inp('@sinF', [halfPi], ['Float']), outF(Math.sin(halfPi)));
  });

  it('cos(pi) ≈ -1.0', async () => {
    await expectBehavior(script, inp('@cosF', [Math.PI], ['Float']), outF(Math.cos(Math.PI)));
  });

  it('asin(1.0) ≈ pi/2', async () => {
    await expectBehavior(script, inp('@asinF', [1.0e0], ['Float']), outF(Math.asin(1.0)));
  });

  it('asin(1) ≈ pi/2 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@asinI', [1], ['Integer']), outF(Math.asin(1.0)));
  });

  it('asin(Decimal 1.0) ≈ pi/2 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@asinD', [1.0], ['Decimal']), outF(Math.asin(1.0)));
  });

  it('acos(1.0) = 0.0', async () => {
    await expectBehavior(script, inp('@acosF', [1.0e0], ['Float']), outF(0.0));
  });

  it('acos(1) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@acosI', [1], ['Integer']), outF(0.0));
  });

  it('acos(Decimal 1.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@acosD', [1.0], ['Decimal']), outF(0.0));
  });

  it('atan(1.0) ≈ pi/4', async () => {
    await expectBehavior(script, inp('@atanF', [1.0e0], ['Float']), outF(Math.atan(1.0)));
  });

  it('atan(0) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@atanI', [0], ['Integer']), outF(0.0));
  });

  it('atan(Decimal 1.0) ≈ pi/4 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@atanD', [1.0], ['Decimal']), outF(Math.atan(1.0)));
  });

  it('atan2(1.0, 1.0) ≈ pi/4', async () => {
    await expectBehavior(script, inp('@atan2F', [1.0e0, 1.0e0], ['Float', 'Float']), outF(Math.atan2(1.0, 1.0)));
  });

  it('atan2(0.0, -1.0) ≈ pi', async () => {
    await expectBehavior(script, inp('@atan2F', [0.0e0, -1.0e0], ['Float', 'Float']), outF(Math.PI));
  });

  it('atan2(1, 1) ≈ pi/4 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@atan2I', [1, 1], ['Integer', 'Integer']), outF(Math.atan2(1, 1)));
  });

  it('atan2(Decimal 1.0, Decimal 1.0) ≈ pi/4 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@atan2D', [1.0, 1.0], ['Decimal', 'Decimal']), outF(Math.atan2(1, 1)));
  });
});

// ─── pow ────────────────────────────────────────────────────────────────

describe('Math.pow', () => {
  it('pow(2, 10) = 1024 (Integer^Integer → Integer)', async () => {
    await expectBehavior(script, inp('@powII', [2, 10], ['Integer', 'Integer']), outI(1024));
  });

  it('pow(3, 0) = 1 (Integer^0 → Integer)', async () => {
    await expectBehavior(script, inp('@powII', [3, 0], ['Integer', 'Integer']), outI(1));
  });

  it('pow(2.0, 3.0) = 8.0 (Float^Float → Float)', async () => {
    await expectBehavior(script, inp('@powFF', [2.0e0, 3.0e0], ['Float', 'Float']), outF(8.0));
  });

  it('pow(4.0, 0.5) = 2.0 (Float fractional exp)', async () => {
    await expectBehavior(script, inp('@powFF', [4.0e0, 5.0e-1], ['Float', 'Float']), outF(2.0));
  });

  it('pow(2.0, -1.0) = 0.5 (Float negative exp)', async () => {
    await expectBehavior(script, inp('@powFF', [2.0e0, -1.0e0], ['Float', 'Float']), outF(0.5));
  });

  it('pow(Decimal 2.5, Integer 2) = 6.25 (Decimal^Integer → Decimal)', async () => {
    await expectBehavior(script, inp('@powDI', [2.5, 2], ['Decimal', 'Integer']), outD(6.25));
  });

  it('pow(Float 2.0, Integer 3) = 8.0 (Float^Integer → Float)', async () => {
    await expectBehavior(script, inp('@powFI', [2.0e0, 3], ['Float', 'Integer']), outF(8.0));
  });

  it('pow(Integer 2, Float 0.5) = √2 (Integer^Float → Float)', async () => {
    await expectBehavior(script, inp('@powIF', [2, 5.0e-1], ['Integer', 'Float']), outF(Math.sqrt(2)));
  });

  it('pow(Decimal 4.0, Float 0.5) = 2.0 (Decimal^Float → Float)', async () => {
    await expectBehavior(script, inp('@powDF', [4.0, 5.0e-1], ['Decimal', 'Float']), outF(2.0));
  });
});

// ─── Constants ──────────────────────────────────────────────────────────

const constScript = `
    @getPi = -> result: Math.pi
    @getE  = -> result: Math.e
    @usePi = |x Float| -> result: Math.sin(Math.pi / x)
`;

describe('Math constants', () => {
  it('Math.pi ≈ 3.14159...', async () => {
    await expectBehavior(constScript, inp0('@getPi'), outF(Math.PI));
  });

  it('Math.e ≈ 2.71828...', async () => {
    await expectBehavior(constScript, inp0('@getE'), outF(Math.E));
  });

  it('Math.sin(Math.pi / 2.0) ≈ 1.0 (used in expression)', async () => {
    await expectBehavior(constScript, inp('@usePi', [2.0e0], ['Float']), outF(Math.sin(Math.PI / 2)));
  });
});

// ─── Hyperbolic ─────────────────────────────────────────────────────────

describe('Math hyperbolic', () => {
  it('sinh(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@sinhF', [0.0e0], ['Float']), outF(0.0));
  });

  it('sinh(1.0) ≈ 1.1752...', async () => {
    await expectBehavior(script, inp('@sinhF', [1.0e0], ['Float']), outF(Math.sinh(1.0)));
  });

  it('sinh(0) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@sinhI', [0], ['Integer']), outF(0.0));
  });

  it('sinh(Decimal 1.0) (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@sinhD', [1.0], ['Decimal']), outF(Math.sinh(1.0)));
  });

  it('cosh(0.0) = 1.0', async () => {
    await expectBehavior(script, inp('@coshF', [0.0e0], ['Float']), outF(1.0));
  });

  it('cosh(0) = 1.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@coshI', [0], ['Integer']), outF(1.0));
  });

  it('cosh(Decimal 0.0) = 1.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@coshD', [0.0], ['Decimal']), outF(1.0));
  });

  it('tanh(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@tanhF', [0.0e0], ['Float']), outF(0.0));
  });

  it('tanh(0) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@tanhI', [0], ['Integer']), outF(0.0));
  });

  it('tanh(Decimal 0.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@tanhD', [0.0], ['Decimal']), outF(0.0));
  });

  it('asinh(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@asinhF', [0.0e0], ['Float']), outF(0.0));
  });

  it('asinh(1) = 0.881... (Integer → Float)', async () => {
    await expectBehavior(script, inp('@asinhI', [1], ['Integer']), outF(Math.asinh(1)));
  });

  it('asinh(Decimal 1.0) (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@asinhD', [1.0], ['Decimal']), outF(Math.asinh(1)));
  });

  it('acosh(1.0) = 0.0', async () => {
    await expectBehavior(script, inp('@acoshF', [1.0e0], ['Float']), outF(0.0));
  });

  it('acosh(1) = 0.0 (Integer → Float)', async () => {
    await expectBehavior(script, inp('@acoshI', [1], ['Integer']), outF(0.0));
  });

  it('acosh(Decimal 1.0) = 0.0 (Decimal → Float)', async () => {
    await expectBehavior(script, inp('@acoshD', [1.0], ['Decimal']), outF(0.0));
  });

  it('atanh(0.0) = 0.0', async () => {
    await expectBehavior(script, inp('@atanhF', [0.0e0], ['Float']), outF(0.0));
  });

  it('atanh(Decimal 0.5) ≈ 0.5493...', async () => {
    await expectBehavior(script, inp('@atanhD', [0.5], ['Decimal']),
      { output: { id: '1', 'bv-a': { result: 'Float' }, re: { result: expect.closeTo(Math.atanh(0.5), 14) }, to: 'c' } });
  });
});

// ─── Dot-method syntax on ref cells ─────────────────────────────────────

const dotScript = `
    @dotSin = { x Float! = 0.0e0; -> result: x.sin }
    @dotSqrt = { x Float! = 4.0e0; -> result: x.sqrt }
    @dotRound = { x Float! = 2.7e0; -> result: x.round }
`;

describe('Dot-method syntax on ref cells', () => {
  it('x.sin works on Float! ref', async () => {
    await expectBehavior(dotScript, inp0('@dotSin'), outF(0.0));
  });

  it('x.sqrt() works on Float! ref', async () => {
    await expectBehavior(dotScript, inp0('@dotSqrt'), outF(2.0));
  });

  it('x.round() works on Float! ref', async () => {
    await expectBehavior(dotScript, inp0('@dotRound'), outI(3));
  });
});

// ─── Math.divide (Decimal with explicit precision) ──────────────────────

describe('Math.divide', () => {
  it('divide(1.0, 3.0, 4) = 0.3333', async () => {
    await expectBehavior(script,
      inp('@divD', [1.0, 3.0, 4], ['Decimal', 'Decimal', 'Integer']),
      outD(0.3333));
  });

  it('divide(1.0, 3.0, 2) = 0.33', async () => {
    await expectBehavior(script,
      inp('@divD', [1.0, 3.0, 2], ['Decimal', 'Decimal', 'Integer']),
      outD(0.33));
  });

  it('divide(10.0, 3.0, 6) = 3.333333', async () => {
    await expectBehavior(script,
      inp('@divD', [10.0, 3.0, 6], ['Decimal', 'Decimal', 'Integer']),
      outD(3.333333));
  });
});

// ─── Literal syntax: Math.method(literal) in source ─────────────────────

const literalScript = `
    @litSqrt = -> result: Math.sqrt(4.0e0)
    @litLog  = -> result: Math.log(1.0e0)
`;

describe('Math with literals in source', () => {
  it('Math.sqrt(4.0e0) in source compiles and returns 2.0', async () => {
    await expectBehavior(literalScript, inp0('@litSqrt'), outF(2.0));
  });

  it('Math.log(1.0e0) in source returns 0.0', async () => {
    await expectBehavior(literalScript, inp0('@litLog'), outF(0.0));
  });
});
