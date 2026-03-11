import { expectReply } from './helpers.js';

// ── 1. Function literal as positional callable arg ────────────────────────────

describe('callable params — function literal as positional arg', () => {
  it('applies a function literal passed as positional arg', async () => {
    const source = `
      on go()
        apply = (n, f) { r : Integer = f(n) }
        result : Integer = apply(5, (x : Integer) x * 2)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 10 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 2. Function literal as named callable arg ─────────────────────────────────

describe('callable params — function literal as named arg', () => {
  it('applies a function literal passed as named arg', async () => {
    const source = `
      on go()
        compute = (:n : Integer, :transform) { r : Integer = transform(n) }
        result : Integer = compute(n: 3, transform: (x : Integer) x + 7)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 10 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 3. Proc reference &name as callable ──────────────────────────────────────

describe('callable params — proc reference &name as callable', () => {
  it('passes &proc as a callable arg', async () => {
    const source = `
      proc double(n : Integer)
        reply(n * 2 : Integer)

      on go()
        apply = (n, f) { r : Integer = f(n) }
        result : Integer = apply(5, &double)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 10 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 4. Callable-typed local variable ─────────────────────────────────────────

describe('callable params — Callable-typed local variable', () => {
  it('assigns a function literal to a Callable-typed local and calls it', async () => {
    const source = `
      on go()
        fn : Callable = (x : Integer) x + 1
        r : Integer = fn(9)
        reply :r
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ r: 'Integer' }], re: [{ r: 10 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 5. Function variable passed by reference with & ───────────────────────────

describe('callable params — &fnVar passes a local function variable by reference', () => {
  it('passes a local function variable by reference using &', async () => {
    const source = `
      on go()
        double = (x : Integer) x * 2
        apply = (n, f) { r : Integer = f(n) }
        result : Integer = apply(5, &double)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 10 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 6. Proc defined after the handler that references it ─────────────────────

describe('callable params — forward proc reference', () => {
  it('&proc works when proc is defined after the referencing handler', async () => {
    const source = `
      on go()
        apply = (n, f) { r : Integer = f(n) }
        result : Integer = apply(5, &triple)
        reply :result

      proc triple(n : Integer)
        reply(n * 3 : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 15 }, 'go'], to: 'caller',
      },
    });
  });
});

// ── 7. Proc returning a callable (ImplicitReturn in proc) ─────────────────────

describe('callable params — proc returning a callable via ImplicitReturn', () => {
  it('proc body ImplicitReturn returns a function literal as callable', async () => {
    const source = `
      proc constant(n : Integer)
        fn = () n : Integer
        reply(fn : Callable)

      on go()
        getConst = constant(42)
        result : Integer = getConst()
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 42 }, 'go'], to: 'caller',
      },
    });
  });
});
