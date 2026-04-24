import { createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture → Hydrate round-trip
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture/hydrate round-trip — integer counter', () => {
  const source = `
    count Integer! = 0
    @inc = { count <- count + 1; -> :count }
  `;

  async function buildRestoredActor() {
    const original = await createActor(source);
    await original.sendAsync({ id: '1', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '3', op: '@inc', from: 'c' });
    await original.sendAsync({ id: '4', cam: 'capture', from: 'p' });
    const snapshot = original.posts.find(o => o.id === '4').re;
    const restored = await createActor(source);
    await restored.sendAsync({ id: '1', cam: [snapshot, 'hydrate'], from: 'p' });
    return restored;
  }

  it('hydrated actor has captured state', async () => {
    const restored = await buildRestoredActor();
    await expectActorBehavior(restored,
      { input: { id: '2', test: { get: 'count' }, from: 't' } },
      { output: { id: '2', 'bv-a': 'Integer', re: 3, to: 't' } },
    );
  });

  it('hydrated actor continues from captured state', async () => {
    const restored = await buildRestoredActor();
    await restored.sendAsync({ id: '2', op: '@inc', from: 'c' });
    await expectActorBehavior(restored,
      { input: { id: '3', test: { get: 'count' }, from: 't' } },
      { output: { id: '3', 'bv-a': 'Integer', re: 4, to: 't' } },
    );
  });
});

describe('capture/hydrate round-trip — multiple types', () => {
  let restored;

  beforeAll(async () => {
    const source = `
      label Text! = ""
      score Integer! = 0
      active Boolean! = false

      @setLabel
        =
        :val Text
        =
        label <- val
        -> :val

      @setScore
        =
        :val Integer
        =
        score <- val
        active <- true
        -> :val

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
    await expectActorBehavior(restored,
      { input: { id: '2', test: { get: 'label' }, from: 't' } },
      { output: { id: '2', 'bv-a': 'Text', re: 'player1', to: 't' } },
      { input: { id: '3', test: { get: 'score' }, from: 't' } },
      { output: { id: '3', 'bv-a': 'Integer', re: 42, to: 't' } },
      { input: { id: '4', test: { get: 'active' }, from: 't' } },
      { output: { id: '4', 'bv-a': 'Boolean', re: true, to: 't' } },
    );
  });
});

describe('capture/hydrate round-trip — clone divergence', () => {
  let cloneA, cloneB;

  beforeAll(async () => {
    const source = `
      x Integer! = 0
      @inc = { x <- x + 1; -> :x }
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
    await expectActorBehavior(cloneA,
      { input: { id: '4', test: { get: 'x' }, from: 't' } },
      { output: { id: '4', 'bv-a': 'Integer', re: 5, to: 't' } },
    );
  });

  it('clone B stays at snapshot', async () => {
    await expectActorBehavior(cloneB,
      { input: { id: '2', test: { get: 'x' }, from: 't' } },
      { output: { id: '2', 'bv-a': 'Integer', re: 3, to: 't' } },
    );
  });
});

describe('capture/hydrate round-trip — function reference', () => {
  let restored;

  beforeAll(async () => {
    const source = `
      transform Function! = |x Integer| x as Integer

      @useDouble
        =
        transform <- |x Integer| x * 2 as Integer
        .

      @apply
        =
        :n Integer
        =
        result Integer = transform(n)
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
    await expectActorBehavior(restored,
      { input: { id: '2', op: [{ n: 3 }, '@apply'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: expect.objectContaining({ re: { result: 6 } }) },
    );
  });
});
