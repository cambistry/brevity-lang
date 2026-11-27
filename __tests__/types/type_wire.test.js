import { expectBehavior, createActor } from '../helpers.js';

// Wire serialization and ty annotation for typed payloads. A typed value goes
// on the wire as a list (notes/positional-type-fields-2026-11-26.md): its
// positional values, then its present named values in one trailing object:
// `Point(1, 2)` → `[1, 2]`, `Game(true, turn: 5)` → `[true, { turn: 5 }]`.
// The positional values given are a prefix; none given, none sent:
// `Game(turn: 3)` → `[{ turn: 3 }]`.
//
// The ty channel carries the type tag (`. Name`) per slot, distinguishing
// type values from primitives (Integer/Boolean/Text). The receiving end
// uses the tag to reconstruct the tagged object from the wire payload.

describe('type wire — outbound payload + ty', () => {
  it('all-required type → positional payload + type tag', async () => {
    await expectBehavior(`
      type Point(Integer, Integer)
      @coords = () -> result: Point(1, 2)
    `,
      { input: { id: '1', op: 'coords', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: ':Point' }], re: [{ result: [1, 2] }], to: 'c' } },
    );
  });

  it('all-required type with mixed scalar fields', async () => {
    await expectBehavior(`
      type Mixed(Integer, Text, Boolean)
      @go = () -> result: Mixed(3, "hi", true)
    `,
      { input: { id: '2', op: 'go', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: ':Mixed' }], re: [{ result: [3, 'hi', true] }], to: 'c' } },
    );
  });

  it('absent positionals are not sent; absent named fields are omitted', async () => {
    await expectBehavior(`
      type Game(? Boolean, ? turn: Integer)
      @go = () -> result: Game(turn: 3)
    `,
      { input: { id: '3', op: 'go', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: ':Game' }], re: [{ result: [{ turn: 3 }] }], to: 'c' } },
    );
  });

  it('type with optional fields, all present → positional values, then the named object', async () => {
    await expectBehavior(`
      type Game(? Boolean, ? turn: Integer)
      @go = () -> result: Game(true, turn: 5)
    `,
      { input: { id: '4', op: 'go', from: 'c' } },
      { output: { id: '4', 'ty': [{ result: ':Game' }], re: [{ result: [true, { turn: 5 }] }], to: 'c' } },
    );
  });

  it('an absent trailing positional is not sent ahead of the named object', async () => {
    await expectBehavior(`
      type Game(Integer, ? Boolean, ? turn: Integer)
      @go = () -> result: Game(1, turn: 5)
    `,
      { input: { id: '5', op: 'go', from: 'c' } },
      { output: { id: '5', 'ty': [{ result: ':Game' }], re: [{ result: [1, { turn: 5 }] }], to: 'c' } },
    );
  });
});

describe('type wire — inbound payload reconstruction', () => {
  it('all-required type: positional payload + type tag rebuilds the tagged value', async () => {
    await expectBehavior(`
      type Point(Integer, Integer)
      @get_x = (p: Point) {
        (x) = p
        return result: x
      }
    `,
      { input: { id: '1', op: [[{ p: [1, 2] }], 'get_x'], 'ty': [[{ p: ':Point' }]], from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 1 }], to: 'c' } },
    );
  });

  it('optional-bearing type: a named field reads directly', async () => {
    await expectBehavior(`
      type Game(? Boolean, ? turn: Integer)
      @get_turn = (g: Game) -> result: (g.turn ?? 0)
    `,
      { input: { id: '2', op: [[{ g: [{ turn: 7 }] }], 'get_turn'], 'ty': [[{ g: ':Game' }]], from: 'c' } },
      { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } },
    );
  });

  it('positional values, then the named object, rebuild both kinds of field', async () => {
    await expectBehavior(`
      type Game(? Boolean, ? turn: Integer)
      @read = (g: Game) {
        (started) = g
        return s: started ?? false, t: g.turn ?? 0
      }
    `,
      { input: { id: '4', op: [[{ g: [true, { turn: 7 }] }], 'read'], 'ty': [[{ g: ':Game' }]], from: 'c' } },
      { output: { id: '4', 'ty': [{ s: 'Boolean', t: 'Integer' }], re: [{ s: true, t: 7 }], to: 'c' } },
    );
  });

  it('optional-bearing type: absent optional reads as null via ??', async () => {
    await expectBehavior(`
      type Game(? Boolean, ? turn: Integer)
      @get_turn = (g: Game) -> result: (g.turn ?? 99)
    `,
      { input: { id: '3', op: [[{ g: [] }], 'get_turn'], 'ty': [[{ g: ':Game' }]], from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 99 }], to: 'c' } },
    );
  });
});

describe('type wire — outbound argument payload + ty', () => {
  // A type value forwarded as a *call argument* serializes to wire form and
  // carries its authority-address tag, exactly like a reply/param slot — not
  // the raw runtime `{__type,…}` object with a bare/null tag. This closes the
  // arg-slot follow-up in notes/type-authority-address-tags-2026-10-26.
  it('forwarded type value → positional payload + authority tag', async () => {
    const actor = await createActor(`
      use Sink = "Sink" as {
        take (p: Point) -> ()
      }
      type Point(Integer, Integer)
      @fwd
        =
        p: Point
        =
        Sink.take(:p)
        return ()
    `);
    await actor.sendAsync({ id: '1', op: [[{ p: [3, 4] }], 'fwd'], from: 'Tester', 'ty': [[{ p: ':Point' }]] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [[{ p: [3, 4] }], 'take'],
      to: 'Sink',
      'ty': [[{ p: ':Point' }]],
    }));
  });

  it('optional-bearing type arg → list payload + authority tag', async () => {
    const actor = await createActor(`
      use Sink = "Sink" as {
        take (g: Game) -> ()
      }
      type Game(? Boolean, ? turn: Integer)
      @fwd
        =
        g: Game
        =
        Sink.take(:g)
        return ()
    `);
    await actor.sendAsync({ id: '1', op: [[{ g: [{ turn: 5 }] }], 'fwd'], from: 'Tester', 'ty': [[{ g: ':Game' }]] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [[{ g: [{ turn: 5 }] }], 'take'],
      to: 'Sink',
      'ty': [[{ g: ':Game' }]],
    }));
  });

  it('primitive args keep bare tags; type arg carries authority tag (mixed)', async () => {
    const actor = await createActor(`
      use Sink = "Sink" as {
        take (n: Integer, p: Point) -> ()
      }
      type Point(Integer, Integer)
      @fwd
        =
        p: Point
        =
        Sink.take(n: 7, :p)
        return ()
    `);
    await actor.sendAsync({ id: '1', op: [[{ p: [3, 4] }], 'fwd'], from: 'Tester', 'ty': [[{ p: ':Point' }]] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [[{ n: 7, p: [3, 4] }], 'take'],
      to: 'Sink',
      'ty': [[{ n: 'Integer', p: ':Point' }]],
    }));
    // The primitive slot stays a bare tag; only the type slot is an address.
    expect(actor.posts[0]['ty'][0][0].n).toBe('Integer');
  });
});

// Positional values are always a prefix of the positional fields (positional
// args fill in order), so the wire never pads a positional slot: no `null`
// stands in for an absent positional ahead of the named object.
describe('type wire — no padding for absent positionals', () => {
  const script = `
    type Opts(? Boolean, ? Integer, ? k: Integer)
    @namedOnly = () -> result: Opts(k: 1)
    @oneOfTwo = () -> result: Opts(true, k: 1)
    @none = () -> result: Opts()
    @read = (o: Opts) {
      (flag, n) = o
      return f: (flag)?, n: (n)?, k: o.k ?? 0
    }
  `;

  it('named values alone: the list holds only the named object', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'namedOnly', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: ':Opts' }], re: [{ result: [{ k: 1 }] }], to: 'c' } },
    );
  });

  it('one positional of two: only it, then the named object', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'oneOfTwo', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: ':Opts' }], re: [{ result: [true, { k: 1 }] }], to: 'c' } },
    );
  });

  it('nothing given: an empty list', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'none', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: ':Opts' }], re: [{ result: [] }], to: 'c' } },
    );
  });

  it('a lone named object decodes as named values, its positionals absent', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[{ o: [{ k: 7 }] }], 'read'], 'ty': [[{ o: ':Opts' }]], from: 'c' } },
      { output: { id: '4', 'ty': [{ f: 'Boolean', n: 'Boolean', k: 'Integer' }], re: [{ f: false, n: false, k: 7 }], to: 'c' } },
    );
  });

  it('one positional, then the named object, decodes each to its own field', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[{ o: [true, { k: 7 }] }], 'read'], 'ty': [[{ o: ':Opts' }]], from: 'c' } },
      { output: { id: '5', 'ty': [{ f: 'Boolean', n: 'Boolean', k: 'Integer' }], re: [{ f: true, n: false, k: 7 }], to: 'c' } },
    );
  });
});
