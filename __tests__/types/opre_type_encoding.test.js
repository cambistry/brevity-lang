import { encodeParams, encodeEntries, typeScope } from '../../src/opre_types.js';
import { encodeTypeText } from '../../src/parser_types.js';
import { parseTypeTree } from '../../src/parser.js';

// Brevity type notation as an Opre type: notes/opre-type-encoding-2026-11-21.md
// ("Types", "Addresses"). Each type the parser accepts, encoded in a file that
// declares a type `Point`, a type `X` in its class `W`, classes `T` and `@Pub`,
// and uses a service `Svc` ("svc.bv") with a class `C` and a binding `:B` of
// another service's class.

const scope = typeScope({
  types: ['Point', 'W::X'],
  classes: ['T', '@Pub', 'W'],
  services: { Svc: 'svc.bv' },
  serviceClasses: (path, rest) => path === 'svc.bv' && rest.join(':') === 'C',
  bindings: { B: { address: 'other.bv:B', isClass: true } },
});
const enc = (text) => encodeTypeText(text, scope);
const params = (text) => encodeParams(parseTypeTree(text).params, scope);

describe('a type is an address', () => {
  it('a name the file does not declare is the parent\'s', () => {
    expect(enc('Integer')).toEqual('Integer');
    expect(enc('Anything')).toEqual('Anything');
    expect(enc('Actor')).toEqual('Actor');
  });

  it('the file\'s own type has a leading colon', () => {
    expect(enc('Point')).toEqual(':Point');
    expect(enc('W::X')).toEqual(':W:X');
  });

  it('a class in a type position is an instance of it', () => {
    expect(enc('T')).toEqual(':T:*');
    expect(enc('@Pub')).toEqual(':Pub:*');
  });

  it('a type reached through another service', () => {
    expect(enc('Svc')).toEqual('svc.bv');
    expect(enc('Svc::Point')).toEqual('svc.bv:Point');
    expect(enc('Svc::C')).toEqual('svc.bv:C:*');
    expect(enc('B')).toEqual('other.bv:B:*');
  });
});

describe('a generic is its parameters, then a %t entry', () => {
  it('a List holds any number of its element', () => {
    expect(enc('List of Integers')).toEqual([['Integer'], { '%t': 'List' }]);
    expect(enc('List of Texts')).toEqual([['Text'], { '%t': 'List' }]);
    expect(enc('List')).toEqual([['Anything'], { '%t': 'List' }]);
    expect(enc('List of Lists of Integers')).toEqual([[[['Integer'], { '%t': 'List' }]], { '%t': 'List' }]);
  });

  it('a container of one', () => {
    expect(enc('Signed of Point')).toEqual([':Point', { '%t': 'Signed' }]);
    expect(enc('Signed of Integers')).toEqual([['Integer'], { '%t': 'Signed' }]);
  });

  it('a shape is an Object, its named parameters in the %t entry', () => {
    expect(enc('(Text, n: Integer)')).toEqual(['Text', { n: 'Integer', '%t': 'Object' }]);
    expect(enc('(Text)')).toEqual(['Text', { '%t': 'Object' }]);
    expect(enc('(p: Point)')).toEqual([{ p: ':Point', '%t': 'Object' }]);
  });
});

describe('unions', () => {
  it('a union lists its members; null is JSON null', () => {
    expect(enc('Integer | Text')).toEqual({ '%or': ['Integer', 'Text'] });
    expect(enc('Point | null')).toEqual({ '%or': [':Point', null] });
    expect(enc('Integer | Text | null')).toEqual({ '%or': ['Integer', 'Text', null] });
  });
});

describe('a function type is its signature', () => {
  it('the arrow says whether it writes', () => {
    expect(enc('(Integer) -> (Text)')).toEqual({ '%fn': [{ args: ['Integer'], re: ['Text'], writes: false }] });
    expect(enc('(Integer) => (Text)')).toEqual({ '%fn': [{ args: ['Integer'], re: ['Text'], writes: true }] });
    expect(enc('(Integer) ~> (Text)')).toEqual({ '%fn': [{ args: ['Integer'], re: ['Text'] }] });
  });

  it('args and re are entry lists', () => {
    expect(enc('(Integer, k: Text) -> (n: Integer, Text)')).toEqual({ '%fn': [{ args: ['Integer', { k: 'Text' }], re: ['Text', { n: 'Integer' }], writes: false }] });
  });

  it('no args, and a reply carrying nothing', () => {
    expect(enc('() -> ()')).toEqual({ '%fn': [{ re: [], writes: false }] });
  });

  it('a silent function never replies', () => {
    expect(enc('(Text) => .')).toEqual({ '%fn': [{ args: ['Text'], writes: true }] });
  });

  it('a reply that is the receiver', () => {
    expect(enc('() => self')).toEqual({ '%fn': [{ re: [{ '%self': true }], writes: true }] });
  });

  it('a reply that depends on the path', () => {
    expect(enc('(Integer) -> (Integer) | (Text)')).toEqual({ '%fn': [{ args: ['Integer'], re: { '%or': [['Integer'], ['Text']] }, writes: false }] });
    expect(enc('() => (Integer) | self')).toEqual({ '%fn': [{ re: { '%or': [['Integer'], [{ '%self': true }]] }, writes: true }] });
  });

  it('a function of a function', () => {
    expect(enc('(on: (s: Point) => .) => .')).toEqual({ '%fn': [{ args: [{ on: { '%fn': [{ args: [{ s: ':Point' }], writes: true }] } }], writes: true }] });
  });
});

describe('cells, interfaces and constructor profiles', () => {
  it('a cell encodes as its type', () => {
    expect(enc('*Integer')).toEqual('Integer');
    expect(enc('&Point')).toEqual(':Point');
  });

  it('an interface is no type that encodes', () => {
    expect(() => enc('{ get () -> (Integer) }')).toThrow("An interface can't be a type here: '{ get () -> (Integer) }'");
  });

  it('nor is a constructor profile', () => {
    expect(() => enc('(start: Integer) -> *{ get () -> (Integer) }')).toThrow("A constructor profile can't be a type here: '(start: Integer) -> *{ get () -> (Integer) }'");
  });
});

describe('entry lists', () => {
  it('positional entries are items, named entries sit in one object after them', () => {
    expect(encodeEntries([
      { name: 'y', type: parseTypeTree('Integer') },
      { name: null, type: parseTypeTree('Text') },
    ], scope)).toEqual(['Text', { y: 'Integer' }]);
  });

  it('an optional entry, positional or named', () => {
    expect(encodeEntries([
      { name: null, type: parseTypeTree('Boolean'), optional: true },
      { name: 'opts', type: parseTypeTree('List of Texts'), optional: true },
    ], scope)).toEqual([{ '%opt': 'Boolean' }, { opts: { '%opt': [['Text'], { '%t': 'List' }] } }]);
  });

  it('params: positional by position, named by key, defaults optional', () => {
    expect(params('(a Integer, b: Text, c: Boolean = true) -> *{}')).toEqual(['Integer', { b: 'Text', c: { '%opt': 'Boolean' } }]);
  });

  it('function-typed params', () => {
    expect(params('(f (Integer) -> (Text), on: (Point) => .) -> *{}')).toEqual([
      { '%fn': [{ args: ['Integer'], re: ['Text'], writes: false }] },
      { on: { '%fn': [{ args: [':Point'], writes: true }] } },
    ]);
  });

  it('actor-typed params: a class, a service\'s class, a cell, a read-only cell', () => {
    expect(params('(t T, c: Svc::C, n *Integer, r: &Text) -> *{}')).toEqual([':T:*', 'Integer', { c: 'svc.bv:C:*', r: 'Text' }]);
  });
});
