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
