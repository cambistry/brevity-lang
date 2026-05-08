import { createActor } from '../helpers.js';

// Slice 10 of types-implementation-plan-2026-04-27: shape-type actorization.
// `*Name` cells participate in the parent's state-slot protocol just like
// built-in scalars: they store a tagged value, support whole-cell mutation
// via `<-` inside handlers, and trigger re-emission to any subscribed `@fn`
// that reads them. Wire flow goes through slices 12+13 (positional/named
// payload + `::Name` bv-a annotation).
//
// Capability sigil is prefix `*Type` per notes/capability-sigils-2026-05-06.md.

describe('shape actorization — *Point state cell', () => {
  const script = `
    ::Point = (x Integer, y Integer)

    coords *Point = Point(0, 0)

    @get = -> coords: coords

    @shift = (x Integer, y Integer) {
      coords <- Point(coords.x + x, coords.y + y)
      -> coords: coords
    }

    @reset = {
      coords <- Point(0, 0)
      -> coords: coords
    }
  `;

  it('@get returns wire-formatted Point with ::Point bv-a', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@get', from: 'c' } },
        { output: { id: '1', 'bv-a': { coords: '::Point' }, re: { coords: [0, 0] }, to: 'c' } },
      ],
    });
  });

  it('@shift mutates the cell via `coords <- Point(...)`; reply reflects new value', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: [[3, 4], '@shift'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
        { output: { id: '1', 'bv-a': { coords: '::Point' }, re: { coords: [3, 4] }, to: 'c' } },
        { input: { id: '2', op: '@get', from: 'c' } },
        { output: { id: '2', 'bv-a': { coords: '::Point' }, re: { coords: [3, 4] }, to: 'c' } },
      ],
    });
  });

  it('subscribe@get re-emits when coords changes', async () => {
    await createActor(script, {
      expects: [
        { input: { id: 'sub-1', op: '@subscribe', to: '@get', from: 'c' } },
        { output: { id: 'sub-1', 'bv-a': { coords: '::Point' }, re: { coords: [0, 0] }, to: 'c' } },
        { input: { id: '2', op: [[1, 2], '@shift'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
        // Handler-body re-emit fires before the handler's own reply.
        { output: { id: 'sub-1', 'bv-a': { coords: '::Point' }, re: { coords: [1, 2] }, to: 'c' } },
        { output: { id: '2', 'bv-a': { coords: '::Point' }, re: { coords: [1, 2] }, to: 'c' } },
      ],
    });
  });

  it('whole-cell replace via `coords <- Point(0, 0)` resets the slot', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: [[5, 6], '@shift'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
        { output: { id: '1', 'bv-a': { coords: '::Point' }, re: { coords: [5, 6] }, to: 'c' } },
        { input: { id: '2', op: '@reset', from: 'c' } },
        { output: { id: '2', 'bv-a': { coords: '::Point' }, re: { coords: [0, 0] }, to: 'c' } },
      ],
    });
  });
});
