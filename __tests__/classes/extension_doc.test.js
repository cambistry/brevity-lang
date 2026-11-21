import { compileSource } from '../helpers.js';
import { extract, overrideTables } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// Every actor is extensible for now, so a class block's doc lists what an extender may
// use and override beside its public members: protected functions (`~h (…) -> (…)`)
// and protected cells (`~count *Integer`; `&` for one that isn't `*`). A block that
// extends another presents the composite. A child block's override table is computed
// from its parent block's doc: the parent's names it overrides or redeclares.
// See notes/opre-extend-and-as-2026-11-20.md ("The extension doc", "$extend").

const parent = `
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
`;

describe('the extension section', () => {
  it("lists a block's protected functions and cells, never its private ones", () => {
    expect(extract(`${parent}@go = -> 1\n`).interface.service).toBe([
      '{',
      '  go () -> (Integer)',
      '  A (Integer) -> *{',
      '    n () -> (Anything)',
      '  } ^ {',
      '    total *Integer',
      '    f () -> (Integer)',
      '    ~count *Integer',
      '    ~limit &Integer',
      '    ~h (Integer) -> (Integer)',
      '  }',
      '}',
    ].join('\n'));
  });

  it('a block that extends another presents the composite', () => {
    const doc = extract(`${parent}@B = @A ^ {\n  count *Integer = 20\n  k = -> 5\n}\n@go = -> 1\n`).interface.service;
    expect(doc).toContain('  B A ^ -> *{\n    ...A\n  } ^ {\n    total *Integer\n    f () -> (Integer)\n    ~count *Integer\n    ~limit &Integer\n    ~k () -> (Integer)\n    ~h (Integer) -> (Integer)\n  }');
  });

  it('reads back: protected entries apart from what a caller sees', () => {
    const doc = parseInterface('{\n  A (Integer) -> *{\n  } ^ {\n    f () -> (Integer)\n    ~count *Integer\n    ~limit &Integer\n    ~h (Integer) -> (Integer)\n  }\n}');
    const members = doc.__types.A.members;
    expect(Object.keys(members).filter(k => !k.startsWith('__'))).toEqual(['f']);
    expect(members.__protected).toEqual({
      '~count': [{ params: [], returns: [{ name: null, type: 'Integer', positional: true }] }],
      '~limit': [{ params: [], returns: [{ name: null, type: 'Integer', positional: true }] }],
      '~h': [{ params: [{ name: null, type: 'Integer', positional: true }], returns: [{ name: null, type: 'Integer', positional: true }], effect: 'read' }],
      __fields: {
        '~count': { type: 'Integer', cell: true, readOnly: false },
        '~limit': { type: 'Integer', cell: true, readOnly: true },
      },
    });
  });

  it('only a function or a cell is protected', () => {
    expect(() => parseInterface('{\n  ~type P (x Integer)\n}')).toThrow("Interface entry '~type P (x Integer)': only a function or a cell is protected");
  });
});

describe('the override table', () => {
  const tables = (source) => overrideTables(`${source}@go = -> 1\n`);
  const A = 'A = *{} ^ {\n  count *Integer = 10\n  @total *Integer = 0\n  h = (x Integer) -> x\n  @f = -> 1\n  k = -> 2\n}\n';

  it("the parent's names the block overrides or redeclares, in the parent's terms", () => {
    expect(tables(`${A}B = A ^ {\n  count *Integer = 20\n  @total *Integer = 5\n  h = (x Integer) -> x + 1\n  @f = -> 3\n  @g = -> 5\n}\n`))
      .toEqual({ B: { block: ['total', 'f', '~count', '~h'] } });
  });

  it("a name new to the block isn't in it, nor is a parent's name it only uses", () => {
    expect(tables(`${A}B = A ^ {\n  @g = -> h(count)\n  j = -> 1\n}\n`)).toEqual({ B: { block: [] } });
  });

  it("names the parent block inherits are the parent's", () => {
    expect(tables(`${A}B = A ^ {\n  h = (x Integer) -> x + 1\n}\nC = B ^ {\n  k = -> 9\n  count *Integer = 1\n}\n`))
      .toEqual({ B: { block: ['~h'] }, C: { block: ['~count', '~k'] } });
  });

  it('an empty block between two others is transparent', () => {
    expect(tables(`${A}V = A ^ *{}\nW = V ^ *{} ^ {\n  k = -> 9\n}\n`)).toEqual({ W: { block: ['~k'] } });
  });

  it('a root block has none', () => {
    expect(tables(A)).toEqual({});
  });
});

describe('the override table — compile errors', () => {
  const compile = (source) => () => compileSource(`A = *{} ^ {\n  count *Integer = 10\n  h = (x Integer) -> x\n  @f = -> 1\n}\n${source}@go = -> 1\n`);

  it('another arity', () => {
    expect(compile('B = A ^ {\n  h = (x Integer, y Integer) -> x + y\n}\n'))
      .toThrow("'h' in the class block of 'B' takes 2 args, and in the class block of 'A', which it extends, 1");
  });

  it("another param's type", () => {
    expect(compile('B = A ^ {\n  h = (x Text) -> 1\n}\n'))
      .toThrow("'h' in the class block of 'B': its arg 1 is a Text, and in the class block of 'A', which it extends, a Integer");
  });

  it('another reply type', () => {
    expect(compile('B = A ^ {\n  @f = -> "one"\n}\n'))
      .toThrow("'@f' in the class block of 'B' replies (Text), and in the class block of 'A', which it extends, (Integer)");
  });

  it('a cell redeclared as a function, or a function as a cell', () => {
    expect(compile('B = A ^ {\n  count = -> 1\n}\n'))
      .toThrow("'count' in the class block of 'B' is a function, and in the class block of 'A', which it extends, 'count' is a cell");
    expect(compile('B = A ^ {\n  h *Integer = 1\n}\n'))
      .toThrow("'h' in the class block of 'B' is a cell, and in the class block of 'A', which it extends, 'h' is a function");
  });

  it('a cell of another type', () => {
    expect(compile('B = A ^ {\n  count *Text = "x"\n}\n'))
      .toThrow("'count' in the class block of 'B' is a Text, and in the class block of 'A', which it extends, a Integer");
  });
});

// A subclass's block always has a base: its parent's, empty when the parent has none.
describe('an empty base — compile errors', () => {
  const compile = (source) => () => compileSource(`T = *{}\n${source}@go = -> 1\n`);

  it("super in it names nothing the parent block defines", () => {
    expect(compile('U = T ^ *{} ^ {\n  @f = -> super\n}\n'))
      .toThrow("'super' in '@f' of the class block of 'U': the class block of 'T' has no public 'f' — 'T' has no class block");
  });

  it('nor does base::', () => {
    expect(compile('U = T ^ *{} ^ {\n  @f = -> base::k\n}\n'))
      .toThrow("'base::k' in the class block of 'U': the class block of 'T' has no protected 'k' — 'T' has no class block");
  });

  it("as super in a block that doesn't define the name", () => {
    expect(compile('A = *{} ^ {\n  @f = -> 1\n}\nB = A ^ {\n  @g = -> super\n}\n'))
      .toThrow("'super' in '@g' of the class block of 'B': the class block of 'A' has no public 'g'");
  });
});

// The instance section: a class's instances' protected members, inline in its
// `*{ … }`, composite; published params are public members. The child's `instance`
// table is computed from it, per parent, the later parent winning.
const instances = `
  @T = (@n: Integer) *{
    count *Integer = 0
    step = -> 1
    @f = -> 2
    #p = -> 3
  }
`;

describe('the instance section', () => {
  it("lists a class's instances' protected functions and cells, never private ones", () => {
    expect(extract(`${instances}@go = -> 1\n`).interface.service).toContain(
      '  T (n: Integer) -> *{\n    n Integer\n    f () -> (Integer)\n    ~count *Integer\n    ~step () -> (Integer)\n  }');
  });

  it('a class that extends another presents the composite', () => {
    expect(extract(`${instances}@U = @T ^ (k Integer) *{\n  super(n: k)\n  j = -> 5\n}\n@go = -> 1\n`).interface.service).toContain(
      '  U T ^ (Integer) -> *{\n    ...T\n    ~count *Integer\n    ~step () -> (Integer)\n    ~j () -> (Integer)\n  }');
  });

  it('reads back: protected entries apart from what a caller sees', () => {
    const doc = parseInterface('{\n  T (n: Integer) -> *{\n    n Integer\n    f () -> (Integer)\n    ~count *Integer\n    ~step () -> (Integer)\n  }\n}');
    const T = doc.__types.T;
    expect(T.functions.map(f => f.name)).toEqual(['n', 'f']);
    expect(Object.keys(T.instanceProtected)).toEqual(['~count', '__fields', '~step']);
    expect(T.instanceProtected.__fields).toEqual({ '~count': { type: 'Integer', cell: true, readOnly: false } });
  });
});

describe('the instance table', () => {
  const tables = (source) => overrideTables(`${source}@go = -> 1\n`);

  it("the parent's names the class overrides or redeclares", () => {
    expect(tables(`${instances}@U = @T ^ (k Integer) *{\n  super(n: k)\n  step = -> 2\n  count *Integer = 3\n  @f = -> 9\n  j = -> 1\n}\n`))
      .toEqual({ U: { instance: { T: ['f', '~count', '~step'] } } });
  });

  it("with two parents, a name the later one supplies is in the earlier one's table", () => {
    const A = 'A = *{\n  h = -> 1\n  g = -> 0\n}\n';
    const B = 'B = *{\n  h = -> 2\n  k = -> 0\n}\n';
    expect(tables(`${A}${B}C = A ^ B ^ *{\n  super[A]()\n  super[B]()\n  g = -> 7\n}\n`))
      .toEqual({ C: { instance: { A: ['~g', '~h'] } } });
  });

  it('a class block carries its class\'s section', () => {
    const P = 'P = *{\n  step = -> 1\n} ^ {\n  h = -> 1\n}\n';
    expect(tables(`${P}Q = P ^ *{\n  super()\n  step = -> 2\n} ^ {\n  h = -> 3\n}\n`))
      .toEqual({ Q: { block: ['~h'], instance: { P: ['~step'] } } });
  });
});

describe('the instance table — compile errors', () => {
  const compile = (source) => () => compileSource(`T = *{\n  count *Integer = 0\n  step = (x Integer) -> x\n}\n${source}@go = -> 1\n`);

  it('another arity', () => {
    expect(compile('U = T ^ *{\n  super()\n  step = (x Integer, y Integer) -> x\n}\n'))
      .toThrow("'step' in 'U' takes 2 args, and in 'T', which it extends, 1");
  });

  it("another param's type", () => {
    expect(compile('U = T ^ *{\n  super()\n  step = (x Text) -> 1\n}\n'))
      .toThrow("'step' in 'U': its arg 1 is a Text, and in 'T', which it extends, a Integer");
  });

  it('a cell redeclared as a function', () => {
    expect(compile('U = T ^ *{\n  super()\n  count = -> 1\n}\n'))
      .toThrow("'count' in 'U' is a function, and in 'T', which it extends, 'count' is a cell");
  });

  it('a cell of another type', () => {
    expect(compile('U = T ^ *{\n  super()\n  count *Text = "x"\n}\n'))
      .toThrow("'count' in 'U' is a Text, and in 'T', which it extends, a Integer");
  });
});
