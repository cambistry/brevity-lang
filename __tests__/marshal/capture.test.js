import { createActor, expectBehavior, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture — actor state serialization via cam: "capture" wire message
// ═══════════════════════════════════════════════════════════════════════════════

// ── Fixture 1: initial capture of various state var types ───────────────────

const initialCapture = `
    x Integer! = 10
    count Integer! = 42
    name Text! = "hello"
    flag Boolean! = true
    price Decimal! = 9.99
    ratio Float! = 3.14
    a Integer! = 0
    b Text! = ""
    c Boolean! = false
    @noop = -> x
`;

describe('capture — single state var', () => {
  it('integer state var', async () => {
    await expectBehavior(initialCapture,
      { input: { id: '1', cam: 'capture', from: 'parent' } },
      { output: expect.objectContaining({ id: '1', re: expect.objectContaining({ x: 10 }), to: 'parent' }) },
    );
  });
});

describe('capture — multiple state vars', () => {
  it('returns all state vars', async () => {
    await expectBehavior(initialCapture,
      { input: { id: '1', cam: 'capture', from: 'p' } },
      { output: expect.objectContaining({ id: '1', re: expect.objectContaining({ count: 42, name: 'hello', flag: true }), to: 'p' }) },
    );
  });
});

describe('capture — decimal and float state', () => {
  it('decimal and float values serialize', async () => {
    await expectBehavior(initialCapture,
      { input: { id: '1', cam: 'capture', from: 'p' } },
      { output: expect.objectContaining({ id: '1', re: expect.objectContaining({ price: 9.99, ratio: 3.14 }), to: 'p' }) },
    );
  });
});

describe('capture — null and zero values', () => {
  it('zero/empty/false values serialize correctly', async () => {
    await expectBehavior(initialCapture,
      { input: { id: '1', cam: 'capture', from: 'p' } },
      { output: expect.objectContaining({ id: '1', re: expect.objectContaining({ a: 0, b: '', c: false }), to: 'p' }) },
    );
  });
});

// ── Fixture 2: capture after mutation ───────────────────────────────────────

const mutationCapture = `
    x Integer! = 0
    @inc = { x <- x + 1; -> :x }
    @noop = -> x
`;

describe('capture — state after mutation', () => {
  it('reflects mutated state', async () => {
    await expectBehavior(mutationCapture,
      { input: { id: '1', op: '@inc', from: 'c' } },
      { input: { id: '2', op: '@inc', from: 'c' } },
      { input: { id: '3', op: '@inc', from: 'c' } },
      { input: { id: '4', cam: 'capture', from: 'p' } },
      { output: expect.objectContaining({ id: '1', re: { x: 1 } }) },
      { output: expect.objectContaining({ id: '2', re: { x: 2 } }) },
      { output: expect.objectContaining({ id: '3', re: { x: 3 } }) },
      { output: { id: '4', re: { x: 3 }, to: 'p' } },
    );
  });
});

// ── Fixture 3: function reference state ─────────────────────────────────────

describe('capture — function reference state', () => {
  const script = `
    transform Function! = (x Integer) ->  x as Integer

    @useDouble
      =
      transform <- (x Integer) ->  x * 2 as Integer
      .

    @useNegate
      =
      transform <- (x Integer) ->  0 - x as Integer
      .

    @apply
      =
      :n Integer
      =
      result Integer = transform(n)
      -> :result
  `;

  it('initial capture has identity function label', async () => {
    const actor = await createActor(script);
    await actor.sendAsync({ id: '1', cam: 'capture', from: 'p' });
    const re = actor.posts.find(o => o.id === '1').re;
    expect(typeof re.transform).toBe('string');
    expect(re.transform).toMatch(/^_lambda_/);
  });

  it('capture after @useDouble has a different label', async () => {
    const actor = await createActor(script);
    await actor.sendAsync({ id: '1', cam: 'capture', from: 'p' });
    const before = actor.posts.find(o => o.id === '1').re.transform;
    await actor.sendAsync({ id: '2', op: '@useDouble', from: 'c' });
    await actor.sendAsync({ id: '3', cam: 'capture', from: 'p' });
    const after = actor.posts.find(o => o.id === '3').re.transform;
    expect(after).toMatch(/^_lambda_/);
    expect(after).not.toBe(before);
  });

  it('@apply calls the current function reference after @useDouble', async () => {
    const actor = await createActor(script);
    await actor.sendAsync({ id: '1', op: '@useDouble', from: 'c' });
    await expectActorBehavior(actor,
      { input: { id: '2', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: expect.objectContaining({ re: { result: 10 } }) },
    );
  });

  it('capture after @useNegate has a different label than @useDouble', async () => {
    const actor = await createActor(script);
    await actor.sendAsync({ id: '1', op: '@useDouble', from: 'c' });
    await actor.sendAsync({ id: '2', cam: 'capture', from: 'p' });
    const doubleLabel = actor.posts.find(o => o.id === '2').re.transform;
    await actor.sendAsync({ id: '3', op: '@useNegate', from: 'c' });
    await actor.sendAsync({ id: '4', cam: 'capture', from: 'p' });
    const negateLabel = actor.posts.find(o => o.id === '4').re.transform;
    expect(negateLabel).toMatch(/^_lambda_/);
    expect(negateLabel).not.toBe(doubleLabel);
  });

  it('@apply reflects the latest behavior after @useNegate', async () => {
    const actor = await createActor(script);
    await actor.sendAsync({ id: '1', op: '@useNegate', from: 'c' });
    await expectActorBehavior(actor,
      { input: { id: '2', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: expect.objectContaining({ re: { result: -5 } }) },
    );
  });
});
