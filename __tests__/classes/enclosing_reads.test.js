import { compileSource, expectBehavior } from '../helpers.js';

// A class declared inside a class closes over the actors it's declared in: the
// class around it, that class's enclosing class, and so on out to the file. A
// name resolves to its innermost declaration. The chain is made of actors, so an
// Inner that the Outer actor o1 constructs reads o1's cells.
// See notes/session-2026-11-07-enclosing-actor-chain.md.

const script = `
  total *Integer = 1
  label *Text = "file"

  @Outer = (n Integer) *{
    count *Integer = n
    label *Text = "outer"

    Inner = *{
      @get = { return count + total }
      @param = { return n }
      @label = { return label }
    }

    Middle = *{
      depth *Integer = 100

      Deep = *{
        @get = { return depth + count + total }
      }

      @deep = {
        d = Deep()
        x Integer = d.get()
        return x
      }
    }

    @bump! = { count <- count + 1 }

    @get = {
      i = Inner()
      x Integer = i.get()
      return x
    }

    @param = {
      i = Inner()
      x Integer = i.param()
      return x
    }

    @label = {
      i = Inner()
      x Text = i.label()
      return x
    }

    @deep = {
      m = Middle()
      x Integer = m.deep()
      return x
    }
  }
`;

const made = (id, n) => [
  { input: { id, op: [[n], '#new'], ty: [['Integer']], to: '@Outer', from: 'c' } },
  { output: expect.objectContaining({ id, re: expect.stringMatching(/^#<@Outer\/\d+>$/) }) },
];
const reply = (id, value) => expect.objectContaining({ id, re: [value], to: 'c' });

describe('a class reads the actors it is declared in', () => {
  it('reads its enclosing class\'s cell and the file\'s', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      { input: { id: '2', op: '@get', to: '@Outer/1', from: 'c' } },
      { output: reply('2', 11) },
    );
  });

  it('reads its enclosing class\'s param', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      { input: { id: '2', op: '@param', to: '@Outer/1', from: 'c' } },
      { output: reply('2', 10) },
    );
  });

  it('reads a cell two classes up', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      { input: { id: '2', op: '@deep', to: '@Outer/1', from: 'c' } },
      { output: reply('2', 111) },
    );
  });

  it('takes the innermost of two names', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      { input: { id: '2', op: '@label', to: '@Outer/1', from: 'c' } },
      { output: reply('2', 'outer') },
    );
  });

  it('reads the actor that constructed it, so two Outers give different values', async () => {
    await expectBehavior(script,
      ...made('1', 10),
      ...made('2', 20),
      { input: { id: '3', op: '@bump!', to: '@Outer/1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: '#<@Outer/1>' }) },
      { input: { id: '4', op: '@get', to: '@Outer/1', from: 'c' } },
      { output: reply('4', 12) },
      { input: { id: '5', op: '@get', to: '@Outer/2', from: 'c' } },
      { output: reply('5', 21) },
      { input: { id: '6', op: '@deep', to: '@Outer/2', from: 'c' } },
      { output: reply('6', 121) },
    );
  });
});

describe('a class reaches only the actors it is declared in', () => {
  it('a sibling\'s cell is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        x *Integer = 1
      }

      B = *{
        @get = { return x }
      }
    `)).toThrow(/'x' is a name of 'A', which 'B' isn't declared in/);
  });

  it('a cell of a class nested in a sibling is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        In = *{
          y *Integer = 1
        }
      }

      B = *{
        Near = *{
          @get = { return y }
        }
      }
    `)).toThrow(/'y' is a name of 'In', which 'Near' isn't declared in/);
  });

  it('a cell of a class nested inside it is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        In = *{
          y *Integer = 1
        }

        @get = { return y }
      }
    `)).toThrow(/'y' is a name of 'In', which 'A' isn't declared in/);
  });

  it('constructing a class nested in a sibling is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        In = *{}
      }

      B = *{
        @make = { i = In() }
      }
    `)).toThrow(/'In' is declared inside 'A', so only that class and the classes inside it can construct it/);
  });

  it('constructing a nested class from the file is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        In = *{}
      }

      @make = { i = In() }
    `)).toThrow(/'In' is declared inside 'A', so only that class and the classes inside it can construct it/);
  });

  it('a public class declared in a class is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        @In = *{}
      }
    `)).toThrow(/'@In' is declared inside 'A', and a class declared in a class can't be public yet/);
  });

  it('calling an enclosing class\'s function is a compile error', () => {
    expect(() => compileSource(`
      A = *{
        #f = { return 1 }

        In = *{
          @get = { return #f() }
        }
      }
    `)).toThrow(/'#f' is a function of 'A', and a class can't call it yet/);
  });
});
