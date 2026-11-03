import { createActor, expectActorBehavior, expectBehavior } from '../helpers.js';

// A typed value travels in wire form with a tag in `ty`. Inbound requests have
// always decoded it; a reply is decoded the same way, for a caller that declares
// the type. In process, a child's reply reaches its parent decoded as well.

describe('a typed reply from a class in the same file', () => {
  const script = `
    ::Item (name: Text)
    ::Game (turn: Integer, ? note: Text)

    C = *{
      n *Integer = 0
      @pop = {
        return Item(name: "x")
      }
      @popBang! = {
        n <- n + 1
        return Item(name: "b")
      }
      @maybe = (c Boolean) {
        if c { return Item(name: "early") }
        return Item(name: "late")
      }
      @pair = {
        return item: Item(name: "n")
      }
      @game = {
        return Game(turn: 3)
      }
    }

    @held = {
      c = C()
      i Item = c.pop()
      n Text = i.name
      return n
    }

    @fresh = {
      i Item = C().pop()
      n Text = i.name
      return n
    }

    @early = {
      c = C()
      i Item = c.maybe(true)
      n Text = i.name
      return n
    }

    @named = {
      c = C()
      :item Item = c.pair()
      n Text = item.name
      return n
    }

    @onward = {
      c = C()
      i Item = c.pop()
      return i
    }

    @optional = {
      c = C()
      g Game = c.game()
      t Integer = g.turn
      return t
    }

    @bang = {
      c = C()
      i Item = c.popBang!()
      n Text = i.name
      return n
    }
  `;

  it('reads a field, on a held child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@held', from: 'c' } },
      { output: { id: '1', re: ['x'], 'ty': ['Text'], to: 'c' } },
    );
  });

  it('reads a field, on a fresh child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@fresh', from: 'c' } },
      { output: { id: '1', re: ['x'], 'ty': ['Text'], to: 'c' } },
    );
  });

  it('decodes on an early return path', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@early', from: 'c' } },
      { output: { id: '1', re: ['early'], 'ty': ['Text'], to: 'c' } },
    );
  });

  it('decodes a named slot', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@named', from: 'c' } },
      { output: { id: '1', re: ['n'], 'ty': ['Text'], to: 'c' } },
    );
  });

  it('re-encodes when returned onward', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onward', from: 'c' } },
      { output: { id: '1', re: [['x']], 'ty': ['#<::Item>'], to: 'c' } },
    );
  });

  it('decodes a type with optional fields, which travels as a map', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@optional', from: 'c' } },
      { output: { id: '1', re: [3], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('a `!` call yields its typed value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bang', from: 'c' } },
      { output: { id: '1', re: ['b'], 'ty': ['Text'], to: 'c' } },
    );
  });
});

describe('a typed reply from a remote', () => {
  const source = `
    *
      "thing.bv": Thing (a: Integer) -> *{
        pop () -> (Item)
      }
    *
    ::Item (name: Text)
    t = Thing(a: 5)
    @go = {
      i Item = t.pop()
      n Text = i.name
      return n
    }
  `;

  it('decodes by the tag, whatever authority it names', async () => {
    const actor = await createActor(source, {
      expects: [{ output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) }],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'ty': '#<Thing>', from: 'Thing' } },
      { input: { id: '99', op: '@go', from: 'caller' } },
      { output: expect.objectContaining({ op: '@pop', to: 'Thing/1' }) },
      { input: { id: '2', re: [['x']], 'ty': ['#<thing.bv ::Item>'] } },
      { output: expect.objectContaining({ id: '99', re: ['x'], to: 'caller' }) },
    );
  });
});
