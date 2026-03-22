import { createActor, expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture — actor state serialization via cam: "capture" wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture — single state var', () => {
  it('integer state var', async () => {
    const actor = await createActor(`
      ref x : Integer = 10
      @get = -> :x
    `);
    await expectActorReply({
      actor, receive: { id: '1', cam: 'capture', from: 'parent' },
      reply: { id: '1', re: { x: 10 }, to: 'parent' },
    });
  });
});

describe('capture — multiple state vars', () => {
  it('returns all state vars', async () => {
    const actor = await createActor(`
      ref count : Integer = 42
      ref name : Text = "hello"
      ref flag : Boolean = true
      @noop = -> count : Integer
    `);
    await expectActorReply({
      actor, receive: { id: '1', cam: 'capture', from: 'p' },
      reply: { id: '1', re: { count: 42, name: 'hello', flag: true }, to: 'p' },
    });
  });
});

describe('capture — state after mutation', () => {
  it('reflects mutated state', async () => {
    const actor = await createActor(`
      ref x : Integer = 0
      @inc = x <- x + 1 -> :x
      @noop = -> x : Integer
    `);
    await actor.sendAsync({ id: '1', op: '@inc', from: 'c' });
    await actor.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await actor.sendAsync({ id: '3', op: '@inc', from: 'c' });
    await expectActorReply({
      actor, receive: { id: '4', cam: 'capture', from: 'p' },
      reply: { id: '4', re: { x: 3 }, to: 'p' },
    });
  });
});

describe('capture — decimal and float state', () => {
  it('decimal and float values serialize', async () => {
    const actor = await createActor(`
      ref price : Decimal = 9.99
      ref ratio : Float = 3.14
      @noop = -> price : Decimal
    `);
    await expectActorReply({
      actor, receive: { id: '1', cam: 'capture', from: 'p' },
      reply: { id: '1', re: { price: 9.99, ratio: 3.14 }, to: 'p' },
    });
  });
});

describe('capture — function reference state', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref transform : Function = |x : Integer| x : Integer

      @useDouble
        =
        transform <- |x : Integer| x * 2 : Integer
        .

      @useNegate
        =
        transform <- |x : Integer| 0 - x : Integer
        .

      @apply
        =
        :n : Integer
        =
        result : Integer = transform(n)
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
      actor, receive: { id: '4', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: expect.objectContaining({ re: { result: 10 } }),
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
      actor, receive: { id: '7', op: [{ n: 5 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: expect.objectContaining({ re: { result: -5 } }),
    });
  });
});

describe('capture — null and zero values', () => {
  it('zero/empty/false values serialize correctly', async () => {
    const actor = await createActor(`
      ref a : Integer = 0
      ref b : Text = ""
      ref c : Boolean = false
      @noop = -> a : Integer
    `);
    await expectActorReply({
      actor, receive: { id: '1', cam: 'capture', from: 'p' },
      reply: { id: '1', re: { a: 0, b: '', c: false }, to: 'p' },
    });
  });
});
