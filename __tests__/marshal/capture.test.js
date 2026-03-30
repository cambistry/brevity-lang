import { createActor, expectBehavior, expectActorReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture — actor state serialization via cam: "capture" wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture — single state var', () => {
  it('integer state var', async () => {
    const script = `
      ref x Integer = 10
      @get = -> :x
    `;
    await expectBehavior(script, {
      input: { id: '1', cam: 'capture', from: 'parent' },
      output: { id: '1', re: { x: 10 }, to: 'parent' },
    });
  });
});

describe('capture — multiple state vars', () => {
  it('returns all state vars', async () => {
    const script = `
      ref count Integer = 42
      ref name Text = "hello"
      ref flag Boolean = true
      @noop = -> count as Integer
    `;
    await expectBehavior(script, {
      input: { id: '1', cam: 'capture', from: 'p' },
      output: { id: '1', re: { count: 42, name: 'hello', flag: true }, to: 'p' },
    });
  });
});

describe('capture — state after mutation', () => {
  it('reflects mutated state', async () => {
    const script = `
      ref x Integer = 0
      @inc = { x <- x + 1; -> :x }
      @noop = -> x as Integer
    `;
    await expectBehavior(script, {
      input: [
        { id: '1', op: '@inc', from: 'c' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', cam: 'capture', from: 'p' },
      ],
      output: [
        expect.objectContaining({ id: '1', re: { x: 1 } }),
        expect.objectContaining({ id: '2', re: { x: 2 } }),
        expect.objectContaining({ id: '3', re: { x: 3 } }),
        { id: '4', re: { x: 3 }, to: 'p' },
      ],
    });
  });
});

describe('capture — decimal and float state', () => {
  it('decimal and float values serialize', async () => {
    const script = `
      ref price Decimal = 9.99
      ref ratio Float = 3.14
      @noop = -> price as Decimal
    `;
    await expectBehavior(script, {
      input: { id: '1', cam: 'capture', from: 'p' },
      output: { id: '1', re: { price: 9.99, ratio: 3.14 }, to: 'p' },
    });
  });
});

describe('capture — function reference state', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref transform Function = |x Integer| x as Integer

      @useDouble
        =
        transform <- |x Integer| x * 2 as Integer
        .

      @useNegate
        =
        transform <- |x Integer| 0 - x as Integer
        .

      @apply
        =
        n: Integer
        =
        result Integer = transform(n)
        -> :result
    `);
  });

  it('initial capture has identity function label', async () => {
    await actor.sendAsync({ id: '1', cam: 'capture', from: 'p' });
    const re = actor.posts.find(o => o.id === '1').re;
    expect(typeof re.transform).toBe('string');
    expect(re.transform).toMatch(/^_lambda_/);
  });

  it('capture after @useDouble has a different label', async () => {
    const before = actor.posts.find(o => o.id === '1').re.transform;
    await actor.sendAsync({ id: '2', op: '@useDouble', from: 'c' });
    await actor.sendAsync({ id: '3', cam: 'capture', from: 'p' });
    const after = actor.posts.find(o => o.id === '3').re.transform;
    expect(after).toMatch(/^_lambda_/);
    expect(after).not.toBe(before);
  });

  it('@apply calls the current function reference', async () => {
    await expectActorReply({
      actor, input: { id: '4', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      output: expect.objectContaining({ re: { result: 10 } }),
    });
  });

  it('capture after @useNegate has a third label', async () => {
    const doubleLabel = actor.posts.find(o => o.id === '3').re.transform;
    await actor.sendAsync({ id: '5', op: '@useNegate', from: 'c' });
    await actor.sendAsync({ id: '6', cam: 'capture', from: 'p' });
    const negateLabel = actor.posts.find(o => o.id === '6').re.transform;
    expect(negateLabel).toMatch(/^_lambda_/);
    expect(negateLabel).not.toBe(doubleLabel);
  });

  it('@apply reflects the latest behavior', async () => {
    await expectActorReply({
      actor, input: { id: '7', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      output: expect.objectContaining({ re: { result: -5 } }),
    });
  });
});

describe('capture — null and zero values', () => {
  it('zero/empty/false values serialize correctly', async () => {
    const script = `
      ref a Integer = 0
      ref b Text = ""
      ref c Boolean = false
      @noop = -> a as Integer
    `;
    await expectBehavior(script, {
      input: { id: '1', cam: 'capture', from: 'p' },
      output: { id: '1', re: { a: 0, b: '', c: false }, to: 'p' },
    });
  });
});
