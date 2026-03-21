import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Capture → Hydrate round-trip
//
// Exercises the full cycle: init → mutate → capture → hydrate into fresh actor → verify
// ═══════════════════════════════════════════════════════════════════════════════

describe('capture/hydrate round-trip — integer counter', () => {
  let restored;

  beforeAll(async () => {
    // Phase 1: build up state
    const original = await runActor({
      source: `
        ref count : Integer = 0

        @inc
          =
          count <- count + 1
          -> :count

        @get
          =
          -> :count
      `,
      receive: [
        { id: '1', op: '@inc', from: 'c' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', cam: 'capture', from: 'p' },
      ],
    });

    const snapshot = original[3].re;

    // Phase 2: hydrate into fresh actor, continue
    restored = await runActor({
      source: `
        ref count : Integer = 0

        @inc
          =
          count <- count + 1
          -> :count

        @get
          =
          -> :count
      `,
      receive: [
        { id: '1', cam: [snapshot, 'hydrate'], from: 'p' },
        { id: '2', op: '@get', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', op: '@get', from: 'c' },
      ],
    });
  });

  it('hydrated actor has captured state', () => {
    expect(restored[1]).toEqual(expect.objectContaining({ re: { count: 3 } }));
  });

  it('hydrated actor continues from captured state', () => {
    expect(restored[3]).toEqual(expect.objectContaining({ re: { count: 4 } }));
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

    const original = await runActor({
      source,
      receive: [
        { id: '1', op: [{ val: 'player1' }, '@setLabel'], 'bv-a': [{ val: 'Text' }], from: 'c' },
        { id: '2', op: [{ val: 42 }, '@setScore'], 'bv-a': [{ val: 'Integer' }], from: 'c' },
        { id: '3', cam: 'capture', from: 'p' },
      ],
    });

    const snapshot = original[2].re;

    restored = await runActor({
      source,
      receive: [
        { id: '1', cam: [snapshot, 'hydrate'], from: 'p' },
        { id: '2', op: '@get', from: 'c' },
      ],
    });
  });

  it('all types survive the round-trip', () => {
    expect(restored[1]).toEqual(expect.objectContaining({
      re: { label: 'player1', score: 42, active: true },
    }));
  });
});

describe('capture/hydrate round-trip — clone divergence', () => {
  let cloneA, cloneB;

  beforeAll(async () => {
    const source = `
      ref x : Integer = 0

      @inc
        =
        x <- x + 1
        -> :x

      @get
        =
        -> :x
    `;

    // Build shared state
    const original = await runActor({
      source,
      receive: [
        { id: '1', op: '@inc', from: 'c' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', cam: 'capture', from: 'p' },
      ],
    });

    const snapshot = original[3].re;

    // Clone A: inc twice
    cloneA = await runActor({
      source,
      receive: [
        { id: '1', cam: [snapshot, 'hydrate'], from: 'p' },
        { id: '2', op: '@inc', from: 'c' },
        { id: '3', op: '@inc', from: 'c' },
        { id: '4', op: '@get', from: 'c' },
      ],
    });

    // Clone B: no inc
    cloneB = await runActor({
      source,
      receive: [
        { id: '1', cam: [snapshot, 'hydrate'], from: 'p' },
        { id: '2', op: '@get', from: 'c' },
      ],
    });
  });

  it('clone A diverges from snapshot', () => {
    expect(cloneA[3]).toEqual(expect.objectContaining({ re: { x: 5 } }));
  });

  it('clone B stays at snapshot', () => {
    expect(cloneB[1]).toEqual(expect.objectContaining({ re: { x: 3 } }));
  });
});
