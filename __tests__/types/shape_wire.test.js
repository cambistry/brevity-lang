import { expectBehavior } from '../helpers.js';

// Slices 12 + 13 of types-implementation-plan-2026-04-27: wire serialization
// and bv-a annotation for typed payloads.
//
// All-required types serialize positionally: `Point(1, 2)` → `[1, 2]`.
// Types with any optional fields serialize as a name-keyed map; absent
// fields are omitted: `Game(turn: 3)` → `{ turn: 3 }`.
//
// The bv-a channel carries the type tag (`::Name`) per slot, distinguishing
// shape values from primitives (Integer/Boolean/Text). The receiving end
// uses the tag to reconstruct the tagged structure from the wire payload.

describe('shape wire — outbound payload + bv-a', () => {
  it('all-required type → positional payload + ::Tag annotation', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @coords = -> result: Point(1, 2)
    `,
      { input: { id: '1', op: '@coords', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: '::Point' }, re: { result: [1, 2] }, to: 'c' } },
    );
  });

  it('all-required type with mixed scalar fields', async () => {
    await expectBehavior(`
      ::Mixed = (count Integer, label Text, ok Boolean)
      @go = -> result: Mixed(3, "hi", true)
    `,
      { input: { id: '2', op: '@go', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: '::Mixed' }, re: { result: [3, 'hi', true] }, to: 'c' } },
    );
  });

  it('type with optional field → named map; absent fields omitted', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: Game(turn: 3)
    `,
      { input: { id: '3', op: '@go', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: '::Game' }, re: { result: { turn: 3 } }, to: 'c' } },
    );
  });

  it('type with optional field, all present → named map', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = -> result: Game(true, 5)
    `,
      { input: { id: '4', op: '@go', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: '::Game' }, re: { result: { started: true, turn: 5 } }, to: 'c' } },
    );
  });
});

describe('shape wire — inbound payload reconstruction', () => {
  it('all-required type: positional payload + ::Tag annotation rebuilds the tagged value', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @get_x = |:p Point| -> result: p.x as Integer
    `,
      { input: { id: '1', op: [{ p: [1, 2] }, '@get_x'], 'bv-a': [{ p: '::Point' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('optional-bearing type: named map payload reads field directly', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @get_turn = |:g Game| -> result: (g.turn ?? 0)
    `,
      { input: { id: '2', op: [{ g: { turn: 7 } }, '@get_turn'], 'bv-a': [{ g: '::Game' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('optional-bearing type: absent optional reads as null via ??', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @get_turn = |:g Game| -> result: (g.turn ?? 99)
    `,
      { input: { id: '3', op: [{ g: {} }, '@get_turn'], 'bv-a': [{ g: '::Game' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });
});
