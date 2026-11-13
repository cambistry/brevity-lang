import { createActor, expectBehavior } from '../helpers.js';

// What a member is decides which built-ins apply to it:
//
//               $get   $set   $subscribe
//   cell, &     yes    no     yes
//   cell, *     yes    yes    yes
//   function    no     no     yes
//   prop        not an address
//
// A cell is an address: `$get`, `$set` and `$subscribe` go to `. cell`. A
// function is an op, and an address only to `$subscribe`. A prop (a published
// param) is read as an op, `{op: 'prop'}`. A built-in that doesn't apply answers
// unhandled. See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.

describe('a * cell', () => {
  const script = `
    @val *Integer = 3
  `;

  it('answers $get', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$get', to: '. val', from: 'c' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
    );
  });

  it('answers $set', async () => {
    await expectBehavior(script,
      { input: { op: [[5], '$set'], ty: [['Integer']], to: '. val', from: 'c' } },
      { input: { id: '1', op: '$get', to: '. val', from: 'c' } },
      { output: { id: '1', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('answers $subscribe, first with its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$subscribe', to: '. val', from: 'c' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
      { input: { op: [[5], '$set'], ty: [['Integer']], to: '. val', from: 'c' } },
      { output: { id: '1', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('a & cell', () => {
  const script = `
    @ratio *Float = 0.5
  `;

  it('answers $get', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$get', to: '. ratio', from: 'c' } },
      { output: { id: '1', re: [0.5], ty: ['Float'], to: 'c' } },
    );
  });

  it('doesn\'t answer $set', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2.5], '$set'], ty: [['Float']], to: '. ratio', from: 'c' } },
      { output: { id: '1', ex: { $set: 'unhandled' }, to: 'c' } },
      { input: { id: '2', op: '$get', to: '. ratio', from: 'c' } },
      { output: { id: '2', re: [0.5], ty: ['Float'], to: 'c' } },
    );
  });

  it('answers $subscribe, first with its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$subscribe', to: '. ratio', from: 'c' } },
      { output: { id: '1', re: [0.5], ty: ['Float'], to: 'c' } },
    );
  });
});

describe('a function', () => {
  const script = `
    @val *Integer = 3
    @double = { return @val * 2 }
  `;

  it('doesn\'t answer $get', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$get', to: '. double', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, to: 'c' } },
    );
  });

  it('doesn\'t answer $set', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], '$set'], ty: [['Integer']], to: '. double', from: 'c' } },
      { output: { id: '1', ex: { $set: 'unhandled' }, to: 'c' } },
    );
  });

  it('answers $subscribe at its address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$subscribe', to: '. double', from: 'c' } },
      { output: { id: '1', re: [6], ty: ['Integer'], to: 'c' } },
      { input: { op: [[5], '$set'], ty: [['Integer']], to: '. val', from: 'c' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('a prop', () => {
  const script = `
    @Box = (@start Integer) *{}
  `;

  const made = [
    { input: { id: '0', op: [[7], '$new'], ty: [['Integer']], to: '. Box', from: 'c' } },
    { output: expect.objectContaining({ id: '0', re: '#<. Box 1>' }) },
  ];

  it('is read as an op', async () => {
    await expectBehavior(script,
      ...made,
      { input: { id: '1', op: 'start', to: '. Box 1', from: 'c' } },
      { output: { id: '1', re: [7], from: '. Box 1', to: 'c' } },
    );
  });

  it('isn\'t an address: $get is unhandled', async () => {
    await expectBehavior(script,
      ...made,
      { input: { id: '1', op: '$get', to: '. Box 1 start', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, from: '. Box 1', to: 'c' } },
    );
  });

  it('isn\'t an address: $subscribe is unhandled', async () => {
    await expectBehavior(script,
      ...made,
      { input: { id: '1', op: '$subscribe', to: '. Box 1 start', from: 'c' } },
      { output: { id: '1', ex: { $subscribe: 'unhandled' }, from: '. Box 1', to: 'c' } },
    );
  });
});

describe('a protected cell', () => {
  const script = `
    val *Integer = 3
    @read = -> val
  `;

  it('answers $get from inside', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: '$get', to: '. ~val' }, from: 't' } },
      { output: { id: '1', re: [3], to: 't' } },
    );
  });

  it('doesn\'t answer $get from outside', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$get', to: '. ~val', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, to: 'c' } },
    );
  });
});

// The caller's side: source reads every member as `Remote.x`, and the compiler
// picks the wire form from the service document.
describe('a caller reads, subscribes to and sets what the document declares', () => {
  const script = `
    *
      "remote.bv": Remote {
        count Integer
        seen &Integer
        slot *Integer
        sum (a: Integer) -> (Integer)
      }
    *
    last *Integer = 0

    @readProp = { n Integer = Remote.count(); return n }
    @readSeen = { n Integer = Remote.seen(); return n }
    @readSlot = { n Integer = Remote.slot(); return n }
    @watchSeen. = { Remote.seen.subscribe (v) { last <- v } }
    @watchSlot. = { Remote.slot.subscribe (v) { last <- v } }
    @watchSum. = { Remote.sum.subscribe(a: 2) (v) { last <- v } }
    @setSlot. = { Remote.slot <- 5 }
  `;

  it('a prop is read as an op', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'readProp', from: 'c' } },
        { output: expect.objectContaining({ op: 'count', to: 'Remote' }) },
      ],
    });
  });

  it('a & cell is read with $get to the cell', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'readSeen', from: 'c' } },
        { output: expect.objectContaining({ op: '$get', to: 'Remote seen' }) },
      ],
    });
  });

  it('a * cell is read with $get to the cell', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'readSlot', from: 'c' } },
        { output: expect.objectContaining({ op: '$get', to: 'Remote slot' }) },
      ],
    });
  });

  it('a & cell is subscribed to at its address', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'watchSeen.', from: 'c' } },
        { output: expect.objectContaining({ op: '$subscribe', to: '#<Remote seen>' }) },
      ],
    });
  });

  it('a * cell is subscribed to at its address', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'watchSlot.', from: 'c' } },
        { output: expect.objectContaining({ op: '$subscribe', to: '#<Remote slot>' }) },
      ],
    });
  });

  it('a function is subscribed to at its address, with its args', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'watchSum.', from: 'c' } },
        { output: expect.objectContaining({ op: [{ a: 2 }, '$subscribe'], to: '#<Remote sum>' }) },
      ],
    });
  });

  it('a * cell is set with $set to the cell', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'setSlot.', from: 'c' } },
        { output: expect.objectContaining({ op: [[5], '$set'], to: '#<Remote slot>' }) },
      ],
    });
  });
});
