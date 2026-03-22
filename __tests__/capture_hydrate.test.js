import { createActor, expectActorReply } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture → Hydrate round-trip
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture/hydrate round-trip — integer counter', () => {
  let restored;

  beforeAll(async () => {
    const source = `
      ref count : Integer = 0
      @inc = count <- count + 1 -> :count
      @get = -> :count
    `;

    // Phase 1: build up state
    const original = await createActor(source);
    await original.sendAsync({ id: '1', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '3', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '4', cam: 'capture', from: 'p' });
    const snapshot = original.posts.find(o => o.id === '4').re;

    // Phase 2: hydrate into fresh actor
    restored = await createActor(source);
    await restored.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
  });

  it('hydrated actor has captured state', async () => {
    await expectActorReply({ actor: restored, receive: { id: '2', op: '@get', from: 'c' }, reply: expect.objectContaining({ re: { count: 3 } }) });
  });

  it('hydrated actor continues from captured state', async () => {
    await restored.sendAsync({ id: '3', op: '@inc', from: 'c' });
    await expectActorReply({ actor: restored, receive: { id: '4', op: '@get', from: 'c' }, reply: expect.objectContaining({ re: { count: 4 } }) });
  });
});

describe('capture/hydrate round-trip — multiple types', () => {
  let restored;

  beforeAll(async () => {
    const source = `
      ref label : Text = ""
      ref score : Integer = 0
      ref active : Boolean = false

      @setLabel
        =
        :val : Text
        =
        label <- val
        -> :val

      @setScore
        =
        :val : Integer
        =
        score <- val
        active <- true
        -> :val

      @get
        =
        -> :label, :score, :active
    `;

    const original = await createActor(source);
    await original.sendAsync({ id: '1', op: [{ val: 'player1' }, '@setLabel'], 'bv-a': [{ val: 'Text' }], from: 'c' });
    await original.sendAsync({ id: '2', op: [{ val: 42 }, '@setScore'], 'bv-a': [{ val: 'Integer' }], from: 'c' });
    await original.sendAsync({ id: '3', cam: 'capture', from: 'p' });
    const snapshot = original.posts.find(o => o.id === '3').re;

    restored = await createActor(source);
    await restored.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
  });

  it('all types survive the round-trip', async () => {
    await expectActorReply({
      actor: restored, receive: { id: '2', op: '@get', from: 'c' },
      reply: expect.objectContaining({ re: { label: 'player1', score: 42, active: true } }),
    });
  });
});

describe('capture/hydrate round-trip — clone divergence', () => {
  let cloneA, cloneB;

  beforeAll(async () => {
    const source = `
      ref x : Integer = 0
      @inc = x <- x + 1 -> :x
      @get = -> :x
    `;

    const original = await createActor(source);
    await original.sendAsync({ id: '1', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '3', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '4', cam: 'capture', from: 'p' });
    const snapshot = original.posts.find(o => o.id === '4').re;

    // Clone A: inc twice
    cloneA = await createActor(source);
    await cloneA.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
    await cloneA.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await cloneA.sendAsync({ id: '3', op: '@inc', from: 'c' });

    // Clone B: no inc
    cloneB = await createActor(source);
    await cloneB.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
  });

  it('clone A diverges from snapshot', async () => {
    await expectActorReply({ actor: cloneA, receive: { id: '4', op: '@get', from: 'c' }, reply: expect.objectContaining({ re: { x: 5 } }) });
  });

  it('clone B stays at snapshot', async () => {
    await expectActorReply({ actor: cloneB, receive: { id: '2', op: '@get', from: 'c' }, reply: expect.objectContaining({ re: { x: 3 } }) });
  });
});

describe('capture/hydrate round-trip — function reference', () => {
  let restored;

  beforeAll(async () => {
    const source = `
      ref transform : Function = |x : Integer| x : Integer

      @useDouble
        =
        transform <- |x : Integer| x * 2 : Integer
        .

      @apply
        =
        :n : Integer
        =
        result : Integer = transform(n)
        -> :result
    `;

    const original = await createActor(source);
    await original.sendAsync({ id: '1', op: '@useDouble', from: 'c' });
    await original.sendAsync({ id: '2', op: [{ n: 7 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' });
    // Verify double is active (useDouble is silent, no output)
    expect(original.posts.find(o => o.id === '2')).toEqual(expect.objectContaining({ re: { result: 14 } }));

    await original.sendAsync({ id: '3', cam: 'capture', from: 'p' });
    const snapshot = original.posts.find(o => o.id === '3').re;

    restored = await createActor(source);
    await restored.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
  });

  it('hydrated actor uses the captured behavior', async () => {
    await expectActorReply({
      actor: restored, receive: { id: '2', op: [{ n: 3 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: expect.objectContaining({ re: { result: 6 } }),
    });
  });
});
