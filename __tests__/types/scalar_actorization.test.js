import { createActor } from '../helpers.js';

// Scalar-type actorization — the cell-as-state-slot protocol for `*Integer`,
// `*Text`, `*Boolean` mirrors `*Point` type actorization (type_actorization.test.js)
// and `*List of Self` collection actorization (classes/peer_list.test.js):
// the `*Type` cell stores a value, supports whole-cell mutation via `<-`,
// and triggers re-emission to subscribers when the slot changes.
//
// The handler-level mechanics for scalar refs are exercised in
// __tests__/operators/ref.test.js. This file focuses on the wire-protocol
// view: ty annotation, re-payload shape, and subscribe re-emission.
//
// Capability sigil is prefix `*Type` per notes/capability-sigils-2026-05-06.md.

describe('scalar actorization — *Integer state cell', () => {
  const script = `
    n *Integer = 0

    @get = -> n: n

    @inc! = (delta Integer) {
      n <- n + delta
      return n: n
    }

    @reset! = {
      n <- 0
      return n: n
    }
  `;

  it('@get returns wire-formatted Integer with ty annotation', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'get', from: 'c' } },
        { output: { id: '1', 'ty': { n: 'Integer' }, re: { n: 0 }, to: 'c' } },
      ],
    });
  });

  it('@inc! mutates the cell via `n <- n + delta`; reply reflects new value', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: [[5], 'inc!'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', 'ty': { n: 'Integer' }, re: { n: 5 }, to: 'c' } },
        { input: { id: '2', op: 'get', from: 'c' } },
        { output: { id: '2', 'ty': { n: 'Integer' }, re: { n: 5 }, to: 'c' } },
      ],
    });
  });

  it('subscribe@get re-emits when n changes', async () => {
    await createActor(script, {
      expects: [
        { input: { id: 'sub-1', op: '$subscribe', to: '. get', from: 'c' } },
        { output: { id: 'sub-1', 'ty': { n: 'Integer' }, re: { n: 0 }, to: 'c' } },
        { input: { id: '2', op: [[3], 'inc!'], 'ty': [['Integer']], from: 'c' } },
        // Cell-mutation re-emit fires before the handler's own reply.
        { output: { id: 'sub-1', 'ty': { n: 'Integer' }, re: { n: 3 }, to: 'c' } },
        { output: { id: '2', 'ty': { n: 'Integer' }, re: { n: 3 }, to: 'c' } },
      ],
    });
  });

  it('whole-cell replace via `n <- 0` resets the slot', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: [[7], 'inc!'], 'ty': [['Integer']], from: 'c' } },
        { output: { id: '1', 'ty': { n: 'Integer' }, re: { n: 7 }, to: 'c' } },
        { input: { id: '2', op: 'reset!', from: 'c' } },
        { output: { id: '2', 'ty': { n: 'Integer' }, re: { n: 0 }, to: 'c' } },
      ],
    });
  });
});

describe('scalar actorization — *Text state cell', () => {
  const script = `
    label *Text = "ready"

    @get = -> label: label

    @set_label! = (s Text) {
      label <- s
      return label: label
    }
  `;

  it('@get returns wire-formatted Text with ty annotation', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'get', from: 'c' } },
        { output: { id: '1', 'ty': { label: 'Text' }, re: { label: 'ready' }, to: 'c' } },
      ],
    });
  });

  it('subscribe@get re-emits when label changes', async () => {
    await createActor(script, {
      expects: [
        { input: { id: 'sub-1', op: '$subscribe', to: '. get', from: 'c' } },
        { output: { id: 'sub-1', 'ty': { label: 'Text' }, re: { label: 'ready' }, to: 'c' } },
        { input: { id: '2', op: [['done'], 'set_label!'], 'ty': [['Text']], from: 'c' } },
        { output: { id: 'sub-1', 'ty': { label: 'Text' }, re: { label: 'done' }, to: 'c' } },
        { output: { id: '2', 'ty': { label: 'Text' }, re: { label: 'done' }, to: 'c' } },
      ],
    });
  });
});

describe('scalar actorization — *Boolean state cell', () => {
  const script = `
    flag *Boolean = false

    @get = -> flag: flag

    @set_flag! = (b Boolean) {
      flag <- b
      return flag: flag
    }
  `;

  it('@get returns wire-formatted Boolean with ty annotation', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'get', from: 'c' } },
        { output: { id: '1', 'ty': { flag: 'Boolean' }, re: { flag: false }, to: 'c' } },
      ],
    });
  });

  it('subscribe@get re-emits when flag flips', async () => {
    await createActor(script, {
      expects: [
        { input: { id: 'sub-1', op: '$subscribe', to: '. get', from: 'c' } },
        { output: { id: 'sub-1', 'ty': { flag: 'Boolean' }, re: { flag: false }, to: 'c' } },
        { input: { id: '2', op: [[true], 'set_flag!'], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: 'sub-1', 'ty': { flag: 'Boolean' }, re: { flag: true }, to: 'c' } },
        { output: { id: '2', 'ty': { flag: 'Boolean' }, re: { flag: true }, to: 'c' } },
      ],
    });
  });
});
