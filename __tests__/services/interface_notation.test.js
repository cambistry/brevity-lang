import { extract, compile } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// Service-document notation: every entry is a name, a space, and a
// definition — no entry colon, no `=` on types, one line per overload.
//
//   ::Point (x Integer, y Integer)        type declaration
//   my_func (Type) -> (Type)              function
//   Counter (k: Type) -> *{ … }           constructor (body always written)
//   set name (Type)                       settable field
//   cell *Type                            ref cell
//   name Type                             read-only field

const compileSrc = (src, opts = {}) => compile(extract(src).ast, opts);

describe('service document — entry forms', () => {
  it('function: name (params) -> (returns)', () => {
    const p = parseInterface('{\n  add (a: Integer, b: Integer) -> (sum: Integer)\n}');
    expect(p.add).toEqual([{
      params: [
        { name: 'a', type: 'Integer', positional: false },
        { name: 'b', type: 'Integer', positional: false },
      ],
      returns: [{ name: 'sum', type: 'Integer', positional: false }],
      effect: 'read',
    }]);
  });

  it('silent function: name. (params) => .', () => {
    const p = parseInterface('{ log! (Text) => . }');
    expect(p['log!']).toEqual([{ params: [{ name: null, type: 'Text', positional: true }], returns: null, effect: 'write' }]);
  });

  it('the -> before a return is optional on input', () => {
    const withArrow = parseInterface('{ f (Integer) -> (Text)\n  g. () => . }');
    const without = parseInterface('{ f (Integer) (Text)\n  g. () . }');
    expect(without).toEqual(withArrow);
  });

  it('overloads: one line per overload, repeating the name', () => {
    const p = parseInterface('{\n  clone () -> (Node)\n  clone (deep: Boolean) -> (Node)\n}');
    expect(p.clone).toHaveLength(2);
    expect(p.clone[1].params).toEqual([{ name: 'deep', type: 'Boolean', positional: false }]);
  });

  it('constructor: Name (params) -> *{ members }', () => {
    const p = parseInterface(`{
      Counter (start: Integer) -> *{
        inc! () => .
        get () -> (value: Integer)
      }
    }`);
    expect(p.__types.Counter.initParams).toEqual([{ name: 'start', type: 'Integer', positional: false }]);
    expect(p.__types.Counter.functions.map(f => f.name)).toEqual(['inc!', 'get']);
  });

  it('constructor: the -> before *{ is optional on input', () => {
    const p = parseInterface('{ Box (Integer) *{ get () -> (Integer) } }');
    expect(p.__types.Box.functions.map(f => f.name)).toEqual(['get']);
  });

  it('constructor with no members of its own: -> *{}', () => {
    const p = parseInterface('{ Text (Node++) -> *{} }');
    expect(p.__types.Text).toEqual({ effect: 'read', supertypes: [{ supertype: 'Node' }], initParams: [], functions: [], setters: [] });
  });

  it('type declaration: ::Name (fields)', () => {
    const p = parseInterface('{ ::Point (x Integer, y: Integer) }');
    expect(p.__typeDecls.Point.fields).toEqual([
      { type: 'TypeField', name: 'x', paramType: 'Integer' },
      { type: 'TypeField', name: 'y', paramType: 'Integer', named: true },
    ]);
  });

  it('setter: set name (Type)', () => {
    const p = parseInterface('{ set label (Text) }');
    expect(p.__setters).toEqual([{ name: 'label', type: 'Text' }]);
    expect(p.label).toBeUndefined();
  });

  it('writable cell: name *Type — readable and settable', () => {
    const p = parseInterface('{ count *Integer }');
    expect(p.__fields.count).toEqual({ type: 'Integer', cell: true, readOnly: false });
    expect(p.count).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }] }]);
  });

  it('read-only cell: name &Type — readable, not settable', () => {
    const p = parseInterface('{ count &Integer\n  names &List of Texts }');
    expect(p.__fields).toEqual({
      count: { type: 'Integer', cell: true, readOnly: true },
      names: { type: 'List of Texts', cell: true, readOnly: true },
    });
    expect(p.count).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }] }]);
  });

  it('prop: name Type — an attribute, not a cell', () => {
    const p = parseInterface('{ count Integer\n  names List of Texts\n  parent Node | null }');
    expect(p.__fields).toEqual({
      count: { type: 'Integer', cell: false, readOnly: true },
      names: { type: 'List of Texts', cell: false, readOnly: true },
      parent: { type: 'Node | null', cell: false, readOnly: true },
    });
    expect(p.count).toEqual([{ params: [], returns: [{ name: null, type: 'Integer', positional: true }] }]);
  });

  it('setter: set name (Type) is a write-only cell', () => {
    const p = parseInterface('{ set label (Text) }');
    expect(p.__fields.label).toEqual({ type: 'Text', cell: true, writeOnly: true });
  });

  it('fields inside a constructor: getter, plus setter for a * cell', () => {
    const p = parseInterface('{ Box () -> *{\n  total Integer\n  seen &Integer\n  slot *Integer\n  set label (Text)\n} }');
    expect(p.__types.Box.functions.map(f => f.name)).toEqual(['total', 'seen', 'slot']);
    expect(p.__types.Box.setters).toEqual([{ name: 'slot', type: 'Integer' }, { name: 'label', type: 'Text' }]);
    expect(p.__types.Box.fields).toEqual({
      total: { type: 'Integer', cell: false, readOnly: true },
      seen: { type: 'Integer', cell: true, readOnly: true },
      slot: { type: 'Integer', cell: true, readOnly: false },
      label: { type: 'Text', cell: true, writeOnly: true },
    });
  });

  it('entries may be comma-separated', () => {
    const p = parseInterface('{ val *Integer, get () -> (Integer), set name (Text) }');
    expect(Object.keys(p).sort()).toEqual(['__fields', '__setters', 'get', 'val']);
    expect(Object.keys(p.__fields).sort()).toEqual(['name', 'val']);
  });

  it('names may end in ? or !', () => {
    const p = parseInterface('{ empty? () -> (Boolean)\n  clear! () => . }');
    expect(p['empty?']).toHaveLength(1);
    expect(p['clear!']).toHaveLength(1);
  });

  it('...Parent spread markers are ignored', () => {
    const p = parseInterface('{ U (T++) -> *{\n  ...T\n  b () -> (Integer)\n} }');
    expect(p.__types.U.functions.map(f => f.name)).toEqual(['b']);
  });

  it('whitespace between name and definition is free', () => {
    expect(parseInterface('{ f(Integer) -> (Text) }')).toEqual(parseInterface('{ f   (Integer) -> (Text) }'));
  });
});

describe('service document — retired forms are rejected', () => {
  it('entry colon', () => {
    expect(() => parseInterface('{ f: (Integer) -> (Text) }')).toThrow(/entry colon is retired/);
    expect(() => parseInterface('{ val: *Integer }')).toThrow(/entry colon is retired/);
    expect(() => parseInterface('{ set label: (Text) }')).toThrow(/entry colon is retired/);
  });

  it('::Name = (…)', () => {
    expect(() => parseInterface('{ ::Point = (x Integer) }')).toThrow(/'=' is retired/);
  });

  it('*( … ) -> { … } constructor', () => {
    expect(() => parseInterface('{ Box: *() -> { get: () -> (Integer) } }')).toThrow(/entry colon is retired/);
  });

  it('| between overloads', () => {
    expect(() => parseInterface('{ f (Integer) -> (Text) | (Text) -> (Text) }')).toThrow(/overloads go on separate lines/);
  });

  it('unparenthesized return', () => {
    expect(() => parseInterface('{ size () -> Integer }')).toThrow(/return must be parenthesized/);
  });

  it('constructor without a body', () => {
    expect(() => parseInterface('{ Text (Node++) }')).toThrow(/missing return.*'-> \*\{\}'/);
  });

  it('duplicate constructor', () => {
    expect(() => parseInterface('{ A () -> *{}\n  A (Integer) -> *{} }')).toThrow(/more than once/);
  });
});

describe('service document — emitted form', () => {
  it('constructor with no members emits -> *{}', () => {
    const { interface: iface } = extract('@Empty = (x: Integer) *{}\n');
    expect(iface.service).toBe('{\n  Empty (x: Integer) -> *{}\n}');
  });

  it('overloads emit one line each', () => {
    const { interface: iface } = extract(`
      @notify. = (msg: Integer) {}
      @notify = (msg: Text) -> ack: "ok"
    `);
    expect(iface.service).toBe('{\n  notify. (msg: Integer) => .\n  notify (msg: Text) -> (ack: Text)\n}');
  });

  it('emitted document parses back', () => {
    const { interface: iface } = extract(`
      ::Point (x Integer, y Integer)
      @val *Integer = 0
      @Counter = (start: Integer) *{
        @get = -> value: start as Integer
      }
      @add = (a: Integer, b: Integer) -> sum: (a + b) as Integer
    `);
    const p = parseInterface(iface.service);
    expect(Object.keys(p.__typeDecls)).toEqual(['Point']);
    expect(p.__fields.val).toEqual({ type: 'Integer', cell: true, readOnly: false });
    expect(p.__types.Counter.functions.map(f => f.name)).toEqual(['get']);
    expect(p.add[0].returns).toEqual([{ name: 'sum', type: 'Integer', positional: false }]);
  });

  it('a public cell with no setter emits &, and round-trips', () => {
    const { interface: iface } = extract(`
      @names *List of Texts = []
      @val *Integer = 0
    `);
    expect(iface.service).toBe('{\n  names &List of Texts\n  val *Integer\n}');
    expect(parseInterface(iface.service).__fields).toEqual({
      names: { type: 'List of Texts', cell: true, readOnly: true },
      val: { type: 'Integer', cell: true, readOnly: false },
    });
  });

  it('a class\'s public cells emit as cells, and its published params as props', () => {
    const { interface: iface } = extract(`
      @Box = (@start Integer) *{
        @slot *Integer = 0
        @names *List of Texts = []
        @get = -> value: start as Integer
      }
    `);
    expect(iface.service).toBe('{\n  Box (Integer) -> *{\n    start Integer\n    slot *Integer\n    names &List of Texts\n    get () -> (value: Integer)\n  }\n}');
    expect(parseInterface(iface.service).__types.Box.fields).toEqual({
      start: { type: 'Integer', cell: false, readOnly: true },
      slot: { type: 'Integer', cell: true, readOnly: false },
      names: { type: 'List of Texts', cell: true, readOnly: true },
    });
  });
});

describe('props and cells — validation', () => {
  const remote = (iface, body) => compileSrc(`*\n  "remote.bv": Remote ${iface}\n*\n${body}\n`);

  it('a prop can be read', () => {
    expect(() => remote('{ count Integer }', '@go = { n Integer = Remote.count(); return n }')).not.toThrow();
  });

  it('a prop cannot be subscribed to', () => {
    expect(() => remote('{ count Integer }', '@go. = { Remote.count.subscribe (v) { . } }'))
      .toThrow(/'Remote.count' is a prop, not an address, so it can't be subscribed to \(a live read-only member is a cell: 'count &Integer'\)/);
  });

  it('a prop cannot be set', () => {
    expect(() => remote('{ count Integer }', '@go. = { Remote.count <- 5 }'))
      .toThrow(/'Remote.count' is a prop, not an address, so it can't be set/);
  });

  it('a & cell can be read and subscribed to', () => {
    expect(() => remote('{ count &Integer }', '@go. = { Remote.count.subscribe (v) { . } }')).not.toThrow();
    expect(() => remote('{ count &Integer }', '@go = { n Integer = Remote.count(); return n }')).not.toThrow();
  });

  it('a & cell cannot be set', () => {
    expect(() => remote('{ count &Integer }', '@go. = { Remote.count <- 5 }'))
      .toThrow(/'Remote.count' is a read-only cell \('count &Integer'\)/);
  });

  it('a * cell can be read, subscribed to and set', () => {
    expect(() => remote('{ count *Integer }', '@go. = { Remote.count <- 5 }')).not.toThrow();
    expect(() => remote('{ count *Integer }', '@go. = { Remote.count.subscribe (v) { . } }')).not.toThrow();
    expect(() => remote('{ count *Integer }', '@go = { n Integer = Remote.count(); return n }')).not.toThrow();
  });

  it('a write-only cell can be set, not subscribed to', () => {
    expect(() => remote('{ set label (Text) }', '@go. = { Remote.label <- "x" }')).not.toThrow();
    expect(() => remote('{ set label (Text) }', '@go. = { Remote.label.subscribe (v) { . } }'))
      .toThrow(/'Remote.label' is a write-only cell, so it can't be subscribed to/);
  });

  const shapes = `{
    Box () -> *{
      total Integer
      slot *Integer
      set label (Text)
    }
  }`;
  const withBox = (body) => compileSrc(`*\n  Shapes: (:Box)\n*\n${body}\n`, {
    remotes: [{ path: 'Shapes', service: shapes }],
  });

  it('a read-only class field can be read', () => {
    expect(() => withBox('@go = { b = Box(); n Integer = b.total(); return n }')).not.toThrow();
  });

  it('a read-only class field cannot be set', () => {
    expect(() => withBox('@go. = { b = Box(); b.total <- 5 }'))
      .toThrow(/'Box' has no settable field 'total' \(available: label, slot\)/);
  });

  it('ref-cell and set-declared class fields can be set', () => {
    expect(() => withBox('@go. = { b = Box(); b.slot <- 5 }')).not.toThrow();
    expect(() => withBox('@go. = { b = Box(); b.label <- "x" }')).not.toThrow();
  });
});

describe('constructor profiles in source', () => {
  it('header dependency: (Alias) (params) -> *{ iface }, arrow optional', () => {
    for (const arrow of ['-> ', '']) {
      const { ast } = extract(`*\n  "thing.bv": Thing (a: Integer) ${arrow}*{ get () -> (value: Integer) }\n*\n@go = -> 1\n`);
      const dep = ast.dependencies[0];
      expect(dep.constructorParams).toEqual([expect.objectContaining({ name: 'a', type: 'Integer' })]);
      expect(parseInterface(dep.interface).get).toHaveLength(1);
    }
  });

  it('header dependency in a delimited ( … ) *{ … } header', () => {
    expect(() => compileSrc(`( "thing.bv": Thing (a: Integer) -> *{ get () -> (value: Integer) } ) *{
  t = Thing(a: 1)
  @go = { :value Integer = t.get(); return :value }
}
`)).not.toThrow();
  });

  it('header dependency: multi-line iface with a nested constructor body', () => {
    const { ast } = extract(`*
  "lib.bv": Lib {
    ::Point (x Integer, y Integer)
    Counter (start: Integer) -> *{
      get () -> (value: Integer)
      slot *Integer
    }
    ping. () => .
  }
*
@go = -> 1
`);
    const p = parseInterface(ast.dependencies[0].interface);
    expect(Object.keys(p.__typeDecls)).toEqual(['Point']);
    expect(p.__types.Counter.functions.map(f => f.name)).toEqual(['get', 'slot']);
    expect(p['ping.']).toHaveLength(1);
  });

  it('retired: Alias *( … ) -> { … }', () => {
    expect(() => extract('*\n  "thing.bv": Thing *(a: Integer) -> { get: () -> (value: Integer) }\n*\n@go = -> 1\n'))
      .toThrow(/retired/);
  });

  it('coercion: x = Dep as (params) -> *{ iface }', () => {
    expect(() => compileSrc(`*
  "thing.bv": Thing #
*
Coerced = Thing as (a: Integer) -> *{ get () -> (value: Integer) }
@go = -> 1
`)).not.toThrow();
  });

  it('retired: as *( … ) -> { … }', () => {
    expect(() => extract(`*
  "thing.bv": Thing #
*
Coerced = Thing as *(a: Integer) -> { get: () -> (value: Integer) }
@go = -> 1
`)).toThrow(/retired/);
  });

  it('service constraint entries drop the colon', () => {
    expect(() => extract(`*
  "store.bv": Store { get (key: Text) -> (value: Text) }
*
db = Store as { @get: (key: Text) -> (value: Text) }
@go = -> 1
`)).toThrow(/entry colon is retired/);
  });

  it('retired: ::Name = (…) in source', () => {
    expect(() => extract('::Point = (x Integer, y Integer)\n')).toThrow(/'=' is retired; write '::Point \(fields\)'/);
  });

  it('lineal type declaration: ::Name then fields', () => {
    const { ast } = extract('::Point\n  x Integer\n  y Integer\n\n@go = -> 1\n');
    expect(ast.types[0].fields.map(f => f.name)).toEqual(['x', 'y']);
  });
});

describe('file-level params — function-typed', () => {
  it('named: cb: (s: Integer) => .', () => {
    const { ast } = extract('*\n  cb: (s: Integer) => .\n*\n@go. = { cb(s: 1) }\n');
    expect(ast.dependencies).toEqual([
      { type: 'FileParam', name: 'cb', paramType: '(s: Integer) => .', positional: false },
    ]);
  });

  it('positional: cb (s: Integer) => .', () => {
    const { ast } = extract('*\n  cb (s: Integer) => .\n*\n@go. = { cb(s: 1) }\n');
    expect(ast.dependencies).toEqual([
      { type: 'FileParam', name: 'cb', paramType: '(s: Integer) => .', positional: true },
    ]);
  });
});

describe('service document — param and return fields', () => {
  it('a :: qualifier in a positional type is not a label', () => {
    const p = parseInterface('{ make () -> (Geom::Point)\n  move. (p: Geom::Point) => . }');
    expect(p.make[0].returns).toEqual([{ name: null, type: 'Geom::Point', positional: true }]);
    expect(p['move.'][0].params).toEqual([{ name: 'p', type: 'Geom::Point', positional: false }]);
  });

  it('retired: prefix-colon fields', () => {
    expect(() => parseInterface('{ first (:selector Text) -> (Element) }')).toThrow(/Prefix-colon field ':selector' is retired/);
  });
});
