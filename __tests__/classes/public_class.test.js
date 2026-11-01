import { expectBehavior, compileSource } from '../helpers.js';

// A public class is constructed by its bare name in its own file. The `@` says it's
// part of the file's doc.

describe('public class in its own file', () => {
  it('is constructed by its bare name', async () => {
    await expectBehavior(`
      @Pub = *{
        @one = { return 5 }
      }

      @go = {
        p = Pub()
        n Integer = p.one()
        return n
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [5], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('takes constructor args', async () => {
    await expectBehavior(`
      @Pub = (n Integer) *{
        @get = { return n }
      }

      @go = {
        p = Pub(7)
        v Integer = p.get()
        return v
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('can be a superclass', async () => {
    await expectBehavior(`
      @Base = *{
        @one = { return 1 }
      }

      @Sub = (Base |) *{
        @two = { return 2 }
      }

      @go = {
        s = Sub()
        a Integer = s.one()
        b Integer = s.two()
        return a + b
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('is checked like any class', () => {
    expect(() => compileSource('@Pub = *{\n  @one = { return 5 }\n}\n@go = {\n  p = Pub()\n  n Integer = p.nope()\n  return n\n}\n')).toThrow(/has no method 'nope'/);
  });

  it('can\'t share a name with a private class', () => {
    expect(() => compileSource('@Pub = *{}\nPub = *{}\n@go = { return 1 }\n')).toThrow(/'Pub' is declared more than once/);
  });
});
