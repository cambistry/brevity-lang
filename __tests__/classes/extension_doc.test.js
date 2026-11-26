import { compileSource, createActor, expectActorBehavior } from '../helpers.js';
import { extract } from '../../index.js';
import { documentShape } from '../../src/service_doc.js';

// Every actor is extensible for now, so a class's doc lists what an extender may use
// and override beside its public members: protected functions (`~h (…) -> (…)`) and
// protected cells (`~count *Integer`; `&` for one that isn't `*`), in its class block's
// `^ { … }` and in its instances' `*{ … }`, composite. A child block's override table
// is computed from its parent's doc, and is what its `$extend` carries.
// See notes/opre-extend-and-as-2026-11-20.md ("The extension doc", "$extend").

describe('the extension section', () => {
  it("lists a block's protected functions and cells, never its private ones", () => {
    expect(extract(`
      @A = (n Integer) *{
        @n = -> n
      } ^ {
        count *Integer = 10
        limit Integer = 3
        @total *Integer = 0
        h = (x Integer) -> x
        @f = -> 1
        #p = -> 2
      }
      @go = -> 1
    `).interface.service).toEqual({
      public: { go: [{ re: ['Integer'], writes: false }] },
      ':A': {
        public: {
          $new: [{ args: ['Integer'], re: [':A'], writes: false }],
          total: [{ re: ['Integer'], writes: false }],
          f: [{ re: ['Integer'], writes: false }],
        },
        protected: {
          '~count': [{ re: ['Integer'], writes: false }],
          '~limit': [{ re: ['Integer'], writes: false }],
          '~h': [{ args: ['Integer'], re: ['Integer'], writes: false }],
        },
        ':total': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
        ':~count': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
        ':~limit': { public: { $get: [{ re: ['Integer'], writes: false }] } },
        instance: { public: { n: [{ re: ['Anything'], writes: false }] } },
      },
    });
  });

  it('a block that extends another presents the composite', () => {
    expect(extract(`
      @A = *{} ^ {
        count *Integer = 10
        limit Integer = 3
        @total *Integer = 0
        h = (x Integer) -> x
        @f = -> 1
      }
      @B = @A ^ {
        count *Integer = 20
        k = -> 5
      }
      @go = -> 1
    `).interface.service[':B']).toEqual({
      extends: [':A'],
      public: {
        $new: [{ re: [':B'], writes: false }],
        total: [{ re: ['Integer'], writes: false }],
        f: [{ re: ['Integer'], writes: false }],
      },
      protected: {
        '~count': [{ re: ['Integer'], writes: false }],
        '~limit': [{ re: ['Integer'], writes: false }],
        '~k': [{ re: ['Integer'], writes: false }],
        '~h': [{ args: ['Integer'], re: ['Integer'], writes: false }],
      },
      ':total': {
        public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
      },
      ':~count': {
        public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
      },
      ':~limit': { public: { $get: [{ re: ['Integer'], writes: false }] } },
      instance: {},
    });
  });

  it("lists a class's instances' protected functions and cells, never private ones", () => {
    expect(extract(`
      @T = (@n: Integer) *{
        count *Integer = 0
        step = -> 1
        @f = -> 2
        #p = -> 3
      }
      @go = -> 1
    `).interface.service[':T']).toEqual({
      public: { $new: [{ args: [{ n: 'Integer' }], re: [':T'], writes: false }] },
      instance: {
        public: { n: [{ re: ['Integer'], writes: false }], f: [{ re: ['Integer'], writes: false }] },
        protected: {
          '~count': [{ re: ['Integer'], writes: false }],
          '~step': [{ re: ['Integer'], writes: false }],
        },
        ':~count': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
      },
    });
  });

  it('a class that extends another presents the composite', () => {
    expect(extract(`
      @T = (@n: Integer) *{
        count *Integer = 0
        step = -> 1
      }
      @U = @T ^ (k Integer) *{
        super(n: k)
        j = -> 5
      }
      @go = -> 1
    `).interface.service[':U']).toEqual({
      extends: [':T'],
      public: { $new: [{ args: ['Integer'], re: [':U'], writes: false }] },
      instance: {
        public: { n: [{ re: ['Integer'], writes: false }] },
        protected: {
          '~count': [{ re: ['Integer'], writes: false }],
          '~step': [{ re: ['Integer'], writes: false }],
          '~j': [{ re: ['Integer'], writes: false }],
        },
        ':~count': {
          public: {
            $get: [{ re: ['Integer'], writes: false }],
            $set: [{ args: ['Integer'], writes: true }],
          },
        },
      },
    });
  });

  it('reads back: protected entries apart from what a caller sees', () => {
    const cell = { public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] } };
    const doc = documentShape({
      ':A': {
        public: {
          $new: [{ args: [{ n: 'Integer' }], re: [':A'], writes: false }],
          g: [{ re: ['Integer'], writes: false }],
        },
        protected: {
          '~count': [{ re: ['Integer'], writes: false }],
          '~h': [{ args: ['Integer'], re: ['Integer'], writes: false }],
        },
        ':~count': cell,
        instance: {
          public: { n: [{ re: ['Integer'], writes: false }], f: [{ re: ['Integer'], writes: false }] },
          protected: { '~step': [{ re: ['Integer'], writes: false }] },
        },
      },
    });
    expect(doc.__types.A.functions.map(f => f.name)).toEqual(['n', 'f']);
    expect(doc.__types.A.instanceProtected).toEqual({
      '~step': [{ params: [], returns: [{ name: null, typeEnc: 'Integer', positional: true }], effect: 'read' }],
    });
    expect(Object.keys(doc.__types.A.members).filter(k => !k.startsWith('__'))).toEqual(['g']);
    expect(doc.__types.A.members.__protected).toEqual({
      '~count': [{ params: [], returns: [{ name: null, typeEnc: 'Integer', positional: true }] }],
      '~h': [{ params: [{ name: null, typeEnc: 'Integer', positional: true }], returns: [{ name: null, typeEnc: 'Integer', positional: true }], effect: 'read' }],
      __fields: { '~count': { typeEnc: 'Integer', cell: true, readOnly: false } },
    });
  });
});

// A child of a parent block in another file, alone: the parent's side is the test's.
// Its block's `$extend` carries the parent's names it overrides or redeclares, in the
// parent's terms; a block that extends it is registered `as` that block.
const DOC = {
  ':A': {
    public: {
      $new: [{ re: [':A'], writes: false }],
      total: [{ re: ['Integer'], writes: false }],
      f: [{ re: ['Integer'], writes: false }],
    },
    protected: {
      '~count': [{ re: ['Integer'], writes: false }],
      '~h': [{ args: ['Integer'], re: ['Integer'], writes: false }],
      '~k': [{ re: ['Integer'], writes: false }],
    },
    ':total': {
      public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
    },
    ':~count': {
      public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
    },
    instance: {},
  },
};
const child = `
  use :A = "svc"
  @B = A ^ {
    count *Integer = 20
    @total *Integer = 5
    h = (x Integer) -> x + 1
    @f = -> 3
    @g = { x Integer = h(count) + k(); return x }
  }
  @C = @B ^ {
    k = -> 9
  }
`;

describe('the override table, as the child sends it', () => {
  it("names the parent's names a block overrides or redeclares, and registers a block extending it", async () => {
    await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: ['total', 'f', '~count', '~h'] }], '$extend'], to: 'svc:A', from: ':B' } },
        { input: { id: '1', re: [], to: ':B', from: 'svc:A' } },
        { output: { id: '2', op: [[{ block: ['total', 'f', '~count', '~h', '~k'] }], '$extend'], as: ':C', to: 'svc:A', from: ':B' } },
        { input: { id: '2', re: [], to: ':B', from: 'svc:A' } },
      ],
    });
  });

  it("a function both blocks hold runs here, with the lower block's override", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: ['total', 'f', '~count', '~h'] }], '$extend'], to: 'svc:A', from: ':B' } },
        { input: { id: '1', re: [], to: ':B', from: 'svc:A' } },
        { output: { id: '2', op: [[{ block: ['total', 'f', '~count', '~h', '~k'] }], '$extend'], as: ':C', to: 'svc:A', from: ':B' } },
        { input: { id: '2', re: [], to: ':B', from: 'svc:A' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '3', op: 'g', to: ':C', from: 'c' } },
      { output: { id: '3', re: [30], ty: ['Integer'], to: 'c', from: ':C' } },
    );
  });
});

describe('the override table — compile errors', () => {
  it('another arity', () => {
    expect(() => compileSource(`
      A = *{} ^ {
        h = (x Integer) -> x
      }
      B = A ^ {
        h = (x Integer, y Integer) -> x + y
      }
      @go = -> 1
    `)).toThrow("'h' in the class block of 'B' takes 2 args, and in the class block of 'A', which it extends, 1");
  });

  it("another param's type", () => {
    expect(() => compileSource(`
      A = *{} ^ {
        h = (x Integer) -> x
      }
      B = A ^ {
        h = (x Text) -> 1
      }
      @go = -> 1
    `)).toThrow("'h' in the class block of 'B': its arg 1 is a Text, and in the class block of 'A', which it extends, a Integer");
  });

  it('another reply type', () => {
    expect(() => compileSource(`
      A = *{} ^ {
        @f = -> 1
      }
      B = A ^ {
        @f = -> "one"
      }
      @go = -> 1
    `)).toThrow("'@f' in the class block of 'B' replies (Text), and in the class block of 'A', which it extends, (Integer)");
  });

  it('a cell redeclared as a function', () => {
    expect(() => compileSource(`
      A = *{} ^ {
        count *Integer = 10
      }
      B = A ^ {
        count = -> 1
      }
      @go = -> 1
    `)).toThrow("'count' in the class block of 'B' is a function, and in the class block of 'A', which it extends, 'count' is a cell");
  });

  it('a function redeclared as a cell', () => {
    expect(() => compileSource(`
      A = *{} ^ {
        h = (x Integer) -> x
      }
      B = A ^ {
        h *Integer = 1
      }
      @go = -> 1
    `)).toThrow("'h' in the class block of 'B' is a cell, and in the class block of 'A', which it extends, 'h' is a function");
  });

  it('a cell of another type', () => {
    expect(() => compileSource(`
      A = *{} ^ {
        count *Integer = 10
      }
      B = A ^ {
        count *Text = "x"
      }
      @go = -> 1
    `)).toThrow("'count' in the class block of 'B' is a Text, and in the class block of 'A', which it extends, a Integer");
  });

  it("an instance's override with another arity", () => {
    expect(() => compileSource(`
      T = *{
        step = (x Integer) -> x
      }
      U = T ^ *{
        super()
        step = (x Integer, y Integer) -> x
      }
      @go = -> 1
    `)).toThrow("'step' in 'U' takes 2 args, and in 'T', which it extends, 1");
  });

  it("an instance's override with another param type", () => {
    expect(() => compileSource(`
      T = *{
        step = (x Integer) -> x
      }
      U = T ^ *{
        super()
        step = (x Text) -> 1
      }
      @go = -> 1
    `)).toThrow("'step' in 'U': its arg 1 is a Text, and in 'T', which it extends, a Integer");
  });

  it("an instance's cell redeclared as a function", () => {
    expect(() => compileSource(`
      T = *{
        count *Integer = 0
      }
      U = T ^ *{
        super()
        count = -> 1
      }
      @go = -> 1
    `)).toThrow("'count' in 'U' is a function, and in 'T', which it extends, 'count' is a cell");
  });

  it("an instance's cell of another type", () => {
    expect(() => compileSource(`
      T = *{
        count *Integer = 0
      }
      U = T ^ *{
        super()
        count *Text = "x"
      }
      @go = -> 1
    `)).toThrow("'count' in 'U' is a Text, and in 'T', which it extends, a Integer");
  });
});

// A subclass's block always has a base: its parent's, empty when the parent has none.
describe('an empty base — compile errors', () => {
  it('super in it names nothing the parent block defines', () => {
    expect(() => compileSource(`
      T = *{}
      U = T ^ *{} ^ {
        @f = -> super
      }
      @go = -> 1
    `)).toThrow("'super' in '@f' of the class block of 'U': the class block of 'T' has no public 'f' — 'T' has no class block");
  });

  it('nor does base::', () => {
    expect(() => compileSource(`
      T = *{}
      U = T ^ *{} ^ {
        @f = -> base::k
      }
      @go = -> 1
    `)).toThrow("'base::k' in the class block of 'U': the class block of 'T' has no protected 'k' — 'T' has no class block");
  });

  it("as super in a block that doesn't define the name", () => {
    expect(() => compileSource(`
      A = *{} ^ {
        @f = -> 1
      }
      B = A ^ {
        @g = -> super
      }
      @go = -> 1
    `)).toThrow("'super' in '@g' of the class block of 'B': the class block of 'A' has no public 'g'");
  });
});
