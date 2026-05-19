import { createActor, expectActorBehavior } from '../helpers.js';

// Param-capability sigils on class parameters — write-cap (*Type) for
// scalars, shapes, and collections delivered at the file-level class header.
// Inside the body, the bound name acts like a host cell and supports `<-`
// mutation.
//
// Cross-actor cell handoff between two user-defined classes (A passing a
// scalar/shape *Type to B's class header and B mutating A's cell) is covered
// for collection-typed cells under classes/peer_list.test.js. Extending that
// pattern to scalars/shapes requires additional codegen plumbing and is
// scoped to a follow-up commit.
//
// Actor references are out of scope for the cap-sigil convention — bare
// names work as today (see classes/peer.test.js).
//
// Read-only (&Type) ref params land in a follow-up commit.
// Per notes/capability-sigils-2026-05-06.md.

// ── File-level *Integer header param ─────────────────────────────────────────

describe('class params — file-level *Integer write-cap', () => {
  it('file-level *Integer param exposes a writable cell binding', async () => {
    const actor = await createActor(
      `
      *( slot: *Integer )
      =

      @bump = { slot <- slot + 1 . }
      @get = -> :slot
    `,
      { constructorArgs: { slot: 100 } },
    );

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@get', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: { slot: 100 }, to: 'caller' }) },
      { input: { id: '2', op: '@bump', from: 'caller' } },
      { input: { id: '3', op: '@get', from: 'caller' } },
      { output: expect.objectContaining({ id: '3', re: { slot: 101 }, to: 'caller' }) },
    );
  });
});

// ── File-level *Point header param ───────────────────────────────────────────

describe('class params — file-level *Point write-cap', () => {
  it('file-level *Point param supports whole-cell replacement', async () => {
    const actor = await createActor(
      `
      *( coords: *Point )
      =

      ::Point = (x Integer, y Integer)

      @shift = (dx Integer, dy Integer) {
        coords <- Point(coords.x + dx, coords.y + dy) .
      }
      @get = -> :coords
    `,
      { constructorArgs: { coords: { __type: 'Point', x: 0, y: 0 } } },
    );

    await expectActorBehavior(actor,
      { input: { id: '1', op: [[3, 4], '@shift'], 'bv-a': [['Integer', 'Integer']], from: 'caller' } },
      { input: { id: '2', op: '@get', from: 'caller' } },
      { output: expect.objectContaining({
        id: '2',
        'bv-a': { coords: '::Point' },
        re: { coords: [3, 4] },
        to: 'caller',
      }) },
    );
  });
});

// ── File-level *List header param ────────────────────────────────────────────

describe('class params — file-level *List write-cap', () => {
  it('file-level *List param supports whole-cell replacement', async () => {
    const actor = await createActor(
      `
      *( ns: *List of Integers )
      =

      @reset = { ns <- [9, 8, 7] . }
      @get = -> :ns
    `,
      { constructorArgs: { ns: [1, 2, 3] } },
    );

    await expectActorBehavior(actor,
      { input: { id: '1', op: '@reset', from: 'caller' } },
      { input: { id: '2', op: '@get', from: 'caller' } },
      { output: expect.objectContaining({
        id: '2',
        'bv-a': { ns: 'List of Integers' },
        re: { ns: [9, 8, 7] },
        to: 'caller',
      }) },
    );
  });
});

// ── Inline class with collection cell — peer-list pattern is covered by
//    classes/peer_list.test.js (the canonical *List-of-Self example).
