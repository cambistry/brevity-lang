import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// `name = **{ … }` defines an actor and creates it once, when its enclosing
// actor is constructed; `name` holds it. `*{ … }` is run once per new actor;
// `**{ … }` is "define and instantiate". A singleton takes no params: it reads
// the actors it's declared in, as a nested class does.
// See notes/classes-as-singletons-2026-11-09.md.

const script = `
  base *Integer = 100

  counter = **{
    n *Integer = 0
    @bump! = { n <- n + 1 }
    @get = { return n + base }
  }

  @bump! = { counter.bump!() }

  @get = {
    x Integer = counter.get()
    return x
  }

  @Box = (seed Integer) *{
    tally = **{
      n *Integer = 0
      @bump! = { n <- n + 1 }
      @get = { return n + seed }
    }

    @bump! = { tally.bump!() }

    @get = {
      x Integer = tally.get()
      return x
    }
  }

  @Shelf = (seed Integer) *{
    Item = *{
      @get = { return seed }
    }
    item = Item()

    @get = {
      x Integer = item.get()
      return x
    }
  }
`;

const made = (id, seed) => [
  { input: { id, op: [[seed], '#new'], ty: [['Integer']], to: '@Box', from: 'c' } },
  { output: expect.objectContaining({ id, re: expect.stringMatching(/^#<@Box\/\d+>$/) }) },
];

describe('inline singletons', () => {
  it('is built once, so its state outlives each call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', to: 'c' }) },
      { input: { id: '2', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '2', to: 'c' }) },
      { input: { id: '3', op: '@get', from: 'c' } },
      { output: { id: '3', re: [102], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a class, each actor gets its own, which reads the class\'s params', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      ...made('2', 20),
      { input: { id: '3', op: '@bump!', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', to: 'c' }) },
      { input: { id: '4', op: '@get', to: '@Box/1', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [11], to: 'c' }) },
      { input: { id: '5', op: '@get', to: '@Box/2', from: 'c' } },
      { output: expect.objectContaining({ id: '5', re: [20], to: 'c' }) },
    );
  });
});

describe('a class keeps a nested class\'s actor in a cell', () => {
  // The desugared form of a singleton in a class, written out.
  it('each actor constructs its own, which reads the class\'s params', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], '#new'], ty: [['Integer']], to: '@Shelf', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: expect.stringMatching(/^#<@Shelf\/\d+>$/) }) },
      { input: { id: '2', op: [[8], '#new'], ty: [['Integer']], to: '@Shelf', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: expect.stringMatching(/^#<@Shelf\/\d+>$/) }) },
      { input: { id: '3', op: '@get', to: '@Shelf/1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: [7], to: 'c' }) },
      { input: { id: '4', op: '@get', to: '@Shelf/2', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: [8], to: 'c' }) },
    );
  });
});

// A public singleton is addressed by its label in the actor that declares it:
// `@s` in the file is `main @s`, its function `main @s @get`. Its class is
// itself, so its tag is its label too.
const published = `
  @s = **{
    n *Integer = 0
    @get = { return n }
    @bump! = { n <- n + 1 }
  }

  @who = { return @s }

  @viaMain = {
    x Integer = @s.get()
    return x
  }

  @Box = (seed Integer) *{
    @tally = **{
      n *Integer = 0
      @get = { return n + seed }
      @bump! = { n <- n + 1 }
    }

    @who = { return @tally }
  }
`;

describe('public singletons', () => {
  it('is addressed by its label', async () => {
    await expectBehavior(published,
      { input: { id: '1', op: '@bump!', to: '@s', from: 'c' } },
      { output: { id: '1', re: '#<@s>', ty: '@s', to: 'c', from: '@s' } },
      { input: { id: '2', op: '@get', to: '@s', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c', from: '@s' } },
    );
  });

  it('is the same actor its enclosing actor calls', async () => {
    await expectBehavior(published,
      { input: { id: '1', op: '@bump!', to: '@s', from: 'c' } },
      { output: { id: '1', re: '#<@s>', ty: '@s', to: 'c', from: '@s' } },
      { input: { id: '2', op: '@viaMain', from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('leaves its actor as its address, tagged with its label', async () => {
    await expectBehavior(published,
      { input: { id: '1', op: '@who', from: 'c' } },
      { output: { id: '1', re: ['#<@s>'], ty: ['@s'], to: 'c' } },
    );
  });

  it('reading the published cell gives its address', async () => {
    await expectBehavior(published,
      { input: { id: '1', op: '@s', from: 'c' } },
      { output: { id: '1', re: ['#<@s>'], ty: ['@s'], to: 'c' } },
    );
  });

  it('in a class, it is addressed under each actor of the class', async () => {
    await expectBehavior(published,
      { input: { id: '1', op: [[10], '#new'], ty: [['Integer']], to: '@Box', from: 'c' } },
      { output: { id: '1', re: '#<@Box/1>', ty: '@Box', to: 'c' } },
      { input: { id: '2', op: [[20], '#new'], ty: [['Integer']], to: '@Box', from: 'c' } },
      { output: { id: '2', re: '#<@Box/2>', ty: '@Box', to: 'c' } },
      { input: { id: '3', op: '@bump!', to: '@Box/1 @tally', from: 'c' } },
      { output: { id: '3', re: '#<@Box/1 @tally>', ty: '@Box/1 @tally', to: 'c', from: '@Box/1 @tally' } },
      { input: { id: '4', op: '@get', to: '@Box/1 @tally', from: 'c' } },
      { output: { id: '4', re: [11], ty: ['Integer'], to: 'c', from: '@Box/1 @tally' } },
      { input: { id: '5', op: '@get', to: '@Box/2 @tally', from: 'c' } },
      { output: { id: '5', re: [20], ty: ['Integer'], to: 'c', from: '@Box/2 @tally' } },
      { input: { id: '6', op: '@who', to: '@Box/1', from: 'c' } },
      { output: { id: '6', re: ['#<@Box/1 @tally>'], ty: ['@Box/1 @tally'], to: 'c', from: '@Box/1' } },
    );
  });
});

// In the service document a public singleton is a sub-service: `name { members }`.
describe('a public singleton in the service document', () => {
  it('is a sub-service, with its members, nested ones included', () => {
    expect(extract(`
      @s = **{
        @n *Integer = 0
        @get = -> 1
        @inner = **{
          @ping = -> 2
        }
      }
      @empty = **{
      }
    `).interface.service).toBe('{\n  s {\n    n *Integer\n    get () -> (Integer)\n    inner {\n      ping () -> (Integer)\n    }\n  }\n  empty {}\n}');
  });

  it('is a sub-service inside a class', () => {
    expect(extract(`
      @Box = (seed Integer) *{
        @tally = **{
          @get = -> 1
        }
        @read = -> 2
      }
    `).interface.service).toBe('{\n  Box (Integer) -> *{\n    tally {\n      get () -> (Integer)\n    }\n    read () -> (Integer)\n  }\n}');
  });

  it('a private singleton is not in it', () => {
    expect(extract(`
      s = **{
        @get = -> 1
      }
      @go = -> 2
    `).interface.service).toBe('{\n  go () -> (Integer)\n}');
  });

  it('reads back as a document of its own', () => {
    const doc = parseInterface('{\n  s {\n    get () -> (Integer)\n    inner {\n      ping () -> (Integer)\n    }\n  }\n  Box (Integer) -> *{\n    tally {\n      get () -> (Integer)\n    }\n  }\n}');
    expect(doc.__services.s.get).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }], effect: 'read' }]);
    expect(doc.__services.s.__services.inner.ping).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }], effect: 'read' }]);
    expect(doc.__types.Box.services.tally.get).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }], effect: 'read' }]);
  });
});

describe('inline singleton compile errors', () => {
  it('a singleton takes no params', () => {
    expect(() => compileSource(`
      s = (x Integer) **{
        @get = { return x }
      }
    `)).toThrow("Singleton 's' takes no params");
  });

  it('a public singleton takes no params', () => {
    expect(() => compileSource(`
      @s = (x Integer) **{
        @get = { return x }
      }
    `)).toThrow("Singleton '@s' takes no params");
  });

  it('a singleton is not an overload clause', () => {
    expect(() => compileSource(`
      s << **{
        @get = { return 1 }
      }
    `)).toThrow("Singleton 's' can't be an overload clause");
  });
});
