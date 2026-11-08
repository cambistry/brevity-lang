import { createActor, expectActorBehavior } from '../helpers.js';

// The canonical wire shape of an Object payload, in `op` and in `re`:
//   empty        → []
//   named only   → {k: v}
//   mixed        → [p1, p2, {k: v}]
// `{}`, `[{}]` and `[{k: v}]` are consumable but never generated.

const source = `
  *
      "thing.bv": Thing (a: Integer) -> *{
      put (k: Integer) -> (value: Integer)
      ping. (k: Integer) => .
      mix. (Integer, k: Integer) => .
      add (Integer, k: Integer) -> (value: Integer)
    }
  *

  t = Thing(a: 5)

  @go = { :value Integer = t.put(k: 1); return :value }
  @note. = { t.ping(k: 2)... }
  @both. = { t.mix(7, k: 8)... }
  @sum = { :value Integer = t.add(7, k: 8); return :value }
  @echo = (k: Integer) { return (k: k) }
  @self = { :k Integer = @echo(k: 3); return :k }
`;

describe('payload shape — named only is {k: v}', () => {
  it('a construction', async () => {
    await createActor(source, {
      expects: [
        { output: { id: '1', op: [{ a: 5 }, '#new'], to: 'Thing' } },
      ],
    });
  });

  it('a call on a remote actor', async () => {
    const actor = await createActor(source);
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': 'Thing', from: 'Thing' } },
      { input: { id: '90', op: '@go', from: 'c' } },
      { output: { id: '2', op: [{ k: 1 }, '@put'], to: 'Thing/1' } },
      { input: { id: '2', re: { value: 42 } } },
      { output: { id: '90', re: { value: 42 }, 'ty': { value: 'Integer' }, to: 'c' } },
    );
  });

  it('a silent call on a remote actor', async () => {
    const actor = await createActor(source);
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': 'Thing', from: 'Thing' } },
      { input: { id: '91', op: '@note.', from: 'c' } },
      { output: expect.objectContaining({ op: [{ k: 2 }, '@ping.'], to: 'Thing/1' }) },
    );
  });

  it('a reply', async () => {
    const actor = await createActor(source);
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': 'Thing', from: 'Thing' } },
      { input: { id: '92', op: '@self', from: 'c' } },
      { output: { id: '92', re: { k: 3 }, 'ty': { k: 'Integer' }, to: 'c' } },
    );
  });
});

describe('payload shape — mixed is [p, {k: v}]', () => {
  it('a call on a remote actor', async () => {
    const actor = await createActor(source);
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': 'Thing', from: 'Thing' } },
      { input: { id: '94', op: '@sum', from: 'c' } },
      { output: expect.objectContaining({ op: [[7, { k: 8 }], '@add'], to: 'Thing/1' }) },
    );
  });

  it('a silent call on a remote actor', async () => {
    const actor = await createActor(source);
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': 'Thing', from: 'Thing' } },
      { input: { id: '93', op: '@both.', from: 'c' } },
      { output: expect.objectContaining({ op: [[7, { k: 8 }], '@mix.'], to: 'Thing/1' }) },
    );
  });
});
