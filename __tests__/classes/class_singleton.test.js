import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';
import { parseInterface } from '../../src/parser_interface.js';

// A class can have members of its own: a singleton, built once where the class is
// declared, that every actor of the class shares.
//
//   Nested:   C = actor { members … new = (params) *{ constructor } }
//   Trailing: C = (params) *{ constructor } ^ { members }
//
// In the nested form the constructor is inside the singleton, so it closes over it,
// private cells included. In the trailing form it isn't, so it reaches the members
// through their public names (`C.count`); after a dot a name is public. Either way an
// actor of the class is `C n` on the wire, under the actor declaring `C`, and its
// `ty` names `C`. A public class's public members are messageable at `C` itself:
// `count` to `. C`. See notes/class-singleton-forms-2026-11-13.md and
// notes/class-scope-and-inheritance-2026-11-16.md (scope in detail:
// __tests__/classes/class_scope.test.js).

const script = `
  @Nested = actor {
    count *Integer = 10
    @total *Integer = 0

    new = (seed Integer) *{
      n Integer = count + seed
      @n = { return n }
      @count = { return count }
      @bump! = { count <- count + 1 }
    }
  }

  @Lineal = **
    count *Integer = 20
    new =
      *
        seed Integer
      *
      n Integer = count + seed
      @n = { return n }

  @Trailing = (seed Integer) *{
    n Integer = @Trailing.count
    @n = { return n + seed }
    @bump! = { @Trailing.bump!() }
  } ^ {
    @count *Integer = 3
    hidden *Integer = 40
    @bump! = { @count <- @count + 1 }
  }

  @Headed = actor {
    @count *Integer = 7
  } ^ (seed Integer) *{
    n Integer = @Headed.count
    @n = { return n + seed }
  }

  @Starred = *{
    n Integer = @Starred.base
    @n = { return n }
  } ^ {
    @base = { return 6 }
  }

  Base = *{ @one = { return 1 } }
  @Stacked = Base ^ *{
    n Integer = @Stacked.two
    @n = {
      x Integer = @one()
      return n + x
    }
  } ^ {
    @two = { return 2 }
  }

  @nested = {
    c = @Nested(5)
    x Integer = c.n()
    return x
  }

  @trailing = {
    t = @Trailing(1)
    x Integer = t.n()
    return x
  }

  Counter = (step Integer) *{ @tick! = { Counter.add!(step) } } ^ { @total *Integer = 0; @add! = (n Integer) { @total <- @total + n } }

  @counted! = {
    a = Counter(2)
    b = Counter(5)
    a.tick!()
    b.tick!()
    a.tick!()
    x Integer = Counter.total
    return x
  }

  @Shelf = (seed Integer) *{
    Slot = (k Integer) *{
      v Integer = Slot.base
      @v = { return v + k }
    } ^ {
      @base = { return seed * 10 }
    }

    @slot = (k Integer) {
      s = Slot(k)
      x Integer = s.v()
      return x
    }
  }
`;

describe('nested class members', () => {
  it('the constructor reads a private cell of the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [11], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('the class\'s actors share its cells, and write them', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: [[2], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '2', re: ['#<:Nested:2>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '3', op: 'bump!', to: ':Nested:1', from: 'c' } },
      { output: { id: '3', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c', from: ':Nested:1' } },
      { input: { id: '4', op: 'count', to: ':Nested:2', from: 'c' } },
      { output: { id: '4', re: [11], ty: ['Integer'], to: 'c', from: ':Nested:2' } },
    );
  });

  it('is built in this process by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'nested', from: 'c' } },
      { output: { id: '1', re: [15], ty: ['Integer'], to: 'c' } },
    );
  });

  it('lineal: the constructor reads a cell of the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2], '$new'], ty: [['Integer']], to: ':Lineal', from: 'c' } },
      { output: { id: '1', re: ['#<:Lineal:1>'], ty: [':Lineal'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Lineal:1', from: 'c' } },
      { output: { id: '2', re: [22], ty: ['Integer'], to: 'c', from: ':Lineal:1' } },
    );
  });
});

describe('trailing class members', () => {
  it('the constructor reads a published cell through the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('an actor calls the class, and a later one sees it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c', from: ':Trailing:1' } },
      { input: { id: '3', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '3', re: ['#<:Trailing:2>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '4', op: 'n', to: ':Trailing:2', from: 'c' } },
      { output: { id: '4', re: [5], ty: ['Integer'], to: 'c', from: ':Trailing:2' } },
    );
  });

  it('is built in this process by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'trailing', from: 'c' } },
      { output: { id: '1', re: [4], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a protected cell isn\'t reached through the class', () => {
    expect(() => compileSource(`
      C = (seed Integer) *{ n Integer = C.hidden } ^ { hidden *Integer = 40 }
    `)).toThrow(/^No public member 'hidden' in 'C'$/);
  });
});

describe('class members as a ^ layer', () => {
  it('a singleton head, then a constructor over it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Headed', from: 'c' } },
      { output: { id: '1', re: ['#<:Headed:1>'], ty: [':Headed'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Headed:1', from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c', from: ':Headed:1' } },
    );
  });

  it('a constructor with no params, then its singleton', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Starred', from: 'c' } },
      { output: { id: '1', re: ['#<:Starred:1>'], ty: [':Starred'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Starred:1', from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c', from: ':Starred:1' } },
    );
  });

  it('a parent, a constructor, then a singleton', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Stacked', from: 'c' } },
      { output: { id: '1', re: ['#<:Stacked:1>'], ty: [':Stacked'], to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Stacked:1', from: 'c' } },
      { output: { id: '2', re: [3], ty: ['Integer'], to: 'c', from: ':Stacked:1' } },
    );
  });

  it('`actor` begins a definition only: not after ^', () => {
    expect(() => compileSource(`
      T = *{ @v = { return 1 } } ^ actor { @c = { return 2 } }
    `)).toThrow();
  });

  it('a singleton layer after ^ takes no keyword', () => {
    expect(() => compileSource(`
      T = *{ @v = { return 1 } } ^ { @c = { return 2 } }
    `)).not.toThrow();
  });

  it('a class has one singleton layer', () => {
    expect(() => compileSource(`
      T = actor { @a = { return 1 } } ^ *{ @v = { return 1 } } ^ { @c = { return 2 } }
    `)).toThrow("In 'T', a class has one singleton layer");
  });

  it('a class has one constructor layer', () => {
    expect(() => compileSource(`
      T = *{ @v = { return 1 } } ^ *{ @w = { return 2 } }
    `)).toThrow("In 'T', a class has one constructor layer");
  });

  it('a parent isn\'t layered over a singleton head', () => {
    expect(() => compileSource(`
      A = *{ @v = { return 1 } }
      T = actor { @c = { return 2 } } ^ A
    `)).toThrow("In 'T', a parent class comes before the constructor and singleton layers");
  });
});

describe('trailing class members — private, one line, and in a class', () => {
  it('a private class on one line: its actors share the members', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'counted!', from: 'c' } },
      { output: { id: '1', re: [9], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a class, each actor of it has its own, which reads its params', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Shelf', from: 'c' } },
      { output: { id: '1', re: ['#<:Shelf:1>'], ty: [':Shelf'], to: 'c' } },
      { input: { id: '2', op: [[2], '$new'], ty: [['Integer']], to: ':Shelf', from: 'c' } },
      { output: { id: '2', re: ['#<:Shelf:2>'], ty: [':Shelf'], to: 'c' } },
      { input: { id: '3', op: [[3], 'slot'], ty: [['Integer']], to: ':Shelf:1', from: 'c' } },
      { output: { id: '3', re: [13], ty: ['Integer'], to: 'c', from: ':Shelf:1' } },
      { input: { id: '4', op: [[3], 'slot'], ty: [['Integer']], to: ':Shelf:2', from: 'c' } },
      { output: { id: '4', re: [23], ty: ['Integer'], to: 'c', from: ':Shelf:2' } },
    );
  });
});

describe('a public class\'s members on the wire', () => {
  it('a public member answers at the class\'s address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'count', to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: [3], ty: ['Integer'], to: 'c', from: ':Trailing' } },
    );
  });

  it('a write there is seen by the class\'s next actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bump!', to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: ['#<:Trailing>'], ty: ['*'], to: 'c', from: ':Trailing' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '2', re: ['#<:Trailing:1>'], ty: [':Trailing'], to: 'c' } },
      { input: { id: '3', op: 'n', to: ':Trailing:1', from: 'c' } },
      { output: { id: '3', re: [5], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('a protected member doesn\'t answer outside the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$get', to: ':Trailing:~hidden', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, to: 'c', from: ':Trailing' } },
    );
  });

  it('nested: a public member answers there too', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: ['#<:Nested:1>'], ty: [':Nested'], to: 'c' } },
      { input: { id: '2', op: 'total', to: ':Nested', from: 'c' } },
      { output: { id: '2', re: [0], ty: ['Integer'], to: 'c', from: ':Nested' } },
    );
  });
});

describe('class members — lineal scope', () => {
  it('a blank line ends the class: members after it are the file\'s', () => {
    const { ast } = extract(`
      C = **
        count *Integer = 0
        new =
          *
            seed Integer
          *
          n Integer = count + seed

      @after = -> 1
    `);
    expect(ast.actors.find(a => !a.name).functions.map(f => f.name)).toContain('@after');
    expect(ast.actors.find(a => a.name === 'C').functions.map(f => f.name)).not.toContain('@after');
  });
});

describe('class members — scope errors', () => {
  it('a trailing constructor can\'t name a member bare', () => {
    expect(() => compileSource(`
      C = (seed Integer) *{ n Integer = count } ^ { count *Integer = 3 }
      @go = -> 1
    `)).toThrow(/^'count' is a member of the class 'C', and a trailing constructor doesn't close over its class block$/);
  });
});

describe('class members — ordering', () => {
  it('nested: built in the class block above a cell its constructor reads is an error', () => {
    expect(() => compileSource(`
      C = actor {
        origin = new(0)
        count *Integer = 0
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).toThrow(/'C' is built in its class block \(by 'origin'\) above 'count', which its constructor reads/);
  });

  it('nested: built below that cell is fine', () => {
    expect(() => compileSource(`
      C = actor {
        count *Integer = 0
        origin = new(0)
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).not.toThrow();
  });

  it('trailing: built in the class block when its constructor reaches the class is an error', () => {
    expect(() => compileSource(`
      C = (seed Integer) *{ n Integer = C.count } ^ {
        @count *Integer = 0
        origin = C(1)
      }
    `)).toThrow(/'C' is built in its class block \(by 'origin'\), and its constructor reaches the class/);
  });

  it('built above its class block is an error', () => {
    expect(() => compileSource(`
      c = C(1)
      C = actor {
        count *Integer = 0
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).toThrow(/'C' is built \(by 'c'\) above its class block/);
  });
});

describe('`new` is reserved', () => {
  it('can\'t be a function', () => {
    expect(() => compileSource(`
      @new = -> 1
    `)).toThrow(/'new' is reserved/);
  });

  it('can\'t be a cell', () => {
    expect(() => compileSource(`
      C = actor {
        new = 5
      }
    `)).toThrow(/'new' makes a singleton a class/);
  });

  it('can\'t be a class outside a singleton', () => {
    expect(() => compileSource(`
      A = *{
        new = (seed Integer) *{ }
      }
    `)).toThrow(/'new' makes a singleton a class/);
  });

  it('`new(…)` outside a singleton with one is an error', () => {
    expect(() => compileSource(`
      @go = { c = new(1) }
    `)).toThrow(/'new\(…\)' builds the class of the singleton it's in/);
  });

  it('can\'t be a local', () => {
    expect(() => compileSource(`
      @go = {
        new Integer = 1
        return new
      }
    `)).toThrow(/new/);
  });
});

describe('class members in the service document', () => {
  it('follow the constructor', () => {
    expect(extract(`
      @C = actor {
        @count *Integer = 0
        new = (seed Integer) *{
          @n = -> 1
        }
      }
    `).interface.service).toEqual({
      ':C': {
        public: {
          $new: [{ args: ['Integer'], re: [':C'], writes: false }],
          count: [{ re: ['Integer'], writes: false }],
        },
        ':count': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
        instance: { public: { n: [{ re: ['Integer'], writes: false }] } },
      },
    });
  });

  it('read back as a document of their own', () => {
    const doc = parseInterface('{\n  C (Integer) -> *{\n    n () -> (Integer)\n  } ^ {\n    count *Integer\n  }\n}');
    expect(doc.__types.C.functions).toEqual([{ name: 'n', effect: 'read', params: [], returns: [{ name: null, type: 'Integer', positional: true }] }]);
    expect(doc.__types.C.members.__fields.count).toEqual({ type: 'Integer', cell: true, readOnly: false });
  });
});

// A subclass with a class block of its own extends its parent's block by delegation
// (notes/class-scope-and-inheritance-2026-11-16.md): the parent block's functions layer
// under its own, late-bound; a cell it doesn't redeclare is the parent block's one cell;
// one it redeclares is its own, and the parent's code running for it uses that.
const delegated = `
  A = *{} ^ {
    count *Integer = 10
    shared *Integer = 5
    @pub *Integer = 1
    @f = { x Integer = count + g(); return x }
    g = -> 1
    @readShared = { return shared }
  }
  B = A ^ {
    count *Integer = 20
    g = -> 100
    @own = { return count }
    @bump! = { shared <- shared + 1 }
  }
  @inherited = { x Integer = B.f(); return x }
  @own = { x Integer = B.own(); return x }
  @parentStill = { x Integer = A.f(); return x }
  @pub = { x Integer = B.pub; return x }
  @shared! = { B.bump!(); x Integer = A.readShared(); return x }
`;

describe('class blocks inherit by delegation', () => {
  it("an inherited function runs for the extending block, late-bound, with the cell it redeclares", async () => {
    await expectBehavior(delegated,
      { input: { id: '1', op: 'inherited', from: 'c' } },
      { output: { id: '1', re: [120], ty: ['Integer'], to: 'c' } },
    );
  });

  it("the block's own function reads its own cell; the parent block is unchanged", async () => {
    await expectBehavior(delegated,
      { input: { id: '1', op: 'own', from: 'c' } },
      { output: { id: '1', re: [20], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'parentStill', from: 'c' } },
      { output: { id: '2', re: [11], ty: ['Integer'], to: 'c' } },
    );
  });

  it("a cell it doesn't redeclare is the parent block's: read, and written", async () => {
    await expectBehavior(delegated,
      { input: { id: '1', op: 'pub', from: 'c' } },
      { output: { id: '1', re: [1], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'shared!', from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });
});
