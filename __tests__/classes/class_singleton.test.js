import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// A class can have members of its own: a singleton, built once where the class is
// declared, that every actor of the class shares.
//
//   Nested:   C = **{ members … new = (params) *{ constructor } }
//   Trailing: C = (params) *{ constructor } **{ members }
//
// In the nested form the constructor is inside the singleton, so it closes over it,
// private cells included. In the trailing form it isn't, so it reaches the members
// through their published interface (`C.count`), as any client does, and, being
// inside the class, through its protected cells too (read only). Either way an
// actor of the class is `C n` on the wire, under the actor declaring `C`, and its
// `ty` names `C`. A public class's public members are messageable at `C` itself:
// `count` to `. C`. See notes/class-singleton-forms-2026-11-13.md.

const script = `
  @Nested = **{
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
    hidden Integer = @Trailing.hidden
    @n = { return n + seed }
    @hidden = { return hidden }
    @bump! = { @Trailing.bump!() }
  } **{
    @count *Integer = 3
    hidden *Integer = 40
    @bump! = { @count <- @count + 1 }
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

  Counter = (step Integer) *{ @tick! = { Counter.add!(step) } } **{ @total *Integer = 0; @add! = (n Integer) { @total <- @total + n } }

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
    } **{
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
      { output: { id: '1', re: '#<:Nested:1>', ty: ':Nested', to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Nested:1', from: 'c' } },
      { output: { id: '2', re: [11], ty: ['Integer'], to: 'c', from: ':Nested:1' } },
    );
  });

  it('the class\'s actors share its cells, and write them', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '1', re: '#<:Nested:1>', ty: ':Nested', to: 'c' } },
      { input: { id: '2', op: [[2], '$new'], ty: [['Integer']], to: ':Nested', from: 'c' } },
      { output: { id: '2', re: '#<:Nested:2>', ty: ':Nested', to: 'c' } },
      { input: { id: '3', op: 'bump!', to: ':Nested:1', from: 'c' } },
      { output: { id: '3', re: '#<:Nested:1>', ty: ':Nested', to: 'c', from: ':Nested:1' } },
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
      { output: { id: '1', re: '#<:Lineal:1>', ty: ':Lineal', to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Lineal:1', from: 'c' } },
      { output: { id: '2', re: [22], ty: ['Integer'], to: 'c', from: ':Lineal:1' } },
    );
  });
});

describe('trailing class members', () => {
  it('the constructor reads a published cell through the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: '#<:Trailing:1>', ty: ':Trailing', to: 'c' } },
      { input: { id: '2', op: 'n', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
  });

  it('an actor calls the class, and a later one sees it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: '#<:Trailing:1>', ty: ':Trailing', to: 'c' } },
      { input: { id: '2', op: 'bump!', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: '#<:Trailing:1>', ty: ':Trailing', to: 'c', from: ':Trailing:1' } },
      { input: { id: '3', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '3', re: '#<:Trailing:2>', ty: ':Trailing', to: 'c' } },
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

  it('the constructor reads a protected cell through the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '1', re: '#<:Trailing:1>', ty: ':Trailing', to: 'c' } },
      { input: { id: '2', op: 'hidden', to: ':Trailing:1', from: 'c' } },
      { output: { id: '2', re: [40], ty: ['Integer'], to: 'c', from: ':Trailing:1' } },
    );
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
      { output: { id: '1', re: '#<:Shelf:1>', ty: ':Shelf', to: 'c' } },
      { input: { id: '2', op: [[2], '$new'], ty: [['Integer']], to: ':Shelf', from: 'c' } },
      { output: { id: '2', re: '#<:Shelf:2>', ty: ':Shelf', to: 'c' } },
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
      { output: { id: '1', re: '#<:Trailing>', ty: ':Trailing', to: 'c', from: ':Trailing' } },
      { input: { id: '2', op: [[1], '$new'], ty: [['Integer']], to: ':Trailing', from: 'c' } },
      { output: { id: '2', re: '#<:Trailing:1>', ty: ':Trailing', to: 'c' } },
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
      { output: { id: '1', re: '#<:Nested:1>', ty: ':Nested', to: 'c' } },
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
      C = (seed Integer) *{ n Integer = count } **{ count *Integer = 3 }
      @go = -> 1
    `)).toThrow(/'count' is a name of 'C_singleton', which 'C' isn't declared in/);
  });
});

describe('class members — ordering', () => {
  it('nested: built in the class block above a cell its constructor reads is an error', () => {
    expect(() => compileSource(`
      C = **{
        origin = new(0)
        count *Integer = 0
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).toThrow(/'C' is built in its class block \(by 'origin'\) above 'count', which its constructor reads/);
  });

  it('nested: built below that cell is fine', () => {
    expect(() => compileSource(`
      C = **{
        count *Integer = 0
        origin = new(0)
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).not.toThrow();
  });

  it('trailing: built in the class block when its constructor reaches the class is an error', () => {
    expect(() => compileSource(`
      C = (seed Integer) *{ n Integer = C.count } **{
        @count *Integer = 0
        origin = C(1)
      }
    `)).toThrow(/'C' is built in its class block \(by 'origin'\), and its constructor reaches the class/);
  });

  it('built above its class block is an error', () => {
    expect(() => compileSource(`
      c = C(1)
      C = **{
        count *Integer = 0
        new = (seed Integer) *{ n Integer = count + seed }
      }
    `)).toThrow(/'C' is built \(by 'c'\) above its class block/);
  });
});

describe('class members — forms that aren\'t', () => {
  it('the leading form is an error', () => {
    expect(() => compileSource(`
      C = **{ count *Integer = 0 } (seed Integer) *{ }
    `)).toThrow(/'C = \*\*\{ … \} \(params\) \*\{ … \}' isn't a class/);
  });

  it('the lineal trailing form is an error', () => {
    expect(() => compileSource(`
      C =
        *
        seed Integer
        *
        @n = -> seed
        **
        @count *Integer = 0
    `)).toThrow(/A lineal class can't take trailing members/);
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
      C = **{
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
      @C = **{
        @count *Integer = 0
        new = (seed Integer) *{
          @n = -> 1
        }
      }
    `).interface.service).toBe('{\n  C (Integer) -> *{\n    n () -> (Integer)\n  } **{\n    count *Integer\n  }\n}');
  });

  it('read back as a document of their own', () => {
    const doc = parseInterface('{\n  C (Integer) -> *{\n    n () -> (Integer)\n  } **{\n    count *Integer\n  }\n}');
    expect(doc.__types.C.functions).toEqual([{ name: 'n', effect: 'read', params: [], returns: [{ name: null, type: 'Integer', positional: true }] }]);
    expect(doc.__types.C.members.__fields.count).toEqual({ type: 'Integer', cell: true, readOnly: false });
  });
});
