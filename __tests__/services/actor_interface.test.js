import { extract } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';
import { compileSource } from '../helpers.js';

// ── Single public class — basic actor interfaces ─────────────────────────────

describe('class interface — basic', () => {
  it('no-param class with one method', () => {
    const { interface: iface } = extract(`
      @Greeter = * {
        @hello = -> greeting: "hi"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Greeter () -> *{\n    hello () -> (greeting: Text)\n  }\n}',
    );
  });

  it('single named param', () => {
    const { interface: iface } = extract(`
      @Document = (content: Text) *{
        @body = -> content as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document (content: Text) -> *{\n    body () -> (Text)\n  }\n}',
    );
  });

  it('single positional param', () => {
    const { interface: iface } = extract(`
      @Wrapper = (n Integer) *{
        @get = -> value: n as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Wrapper (Integer) -> *{\n    get () -> (value: Integer)\n  }\n}',
    );
  });

  it('multiple params', () => {
    const { interface: iface } = extract(`
      @Pair = (a Integer, b Integer) *{
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Pair (Integer, Integer) -> *{\n    sum () -> (total: Integer)\n  }\n}',
    );
  });
});

// ── Actor interface — varied method signatures ───────────────────────────────

describe('class interface — actor methods', () => {
  it('method with args', () => {
    const { interface: iface } = extract(`
      @Search = (corpus: Text) *{
        @find = (query: Text) -> result: "found"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Search (corpus: Text) -> *{\n    find (query: Text) -> (result: Text)\n  }\n}',
    );
  });

  it('silent method', () => {
    const { interface: iface } = extract(`
      @Logger = * {
        @log. = (msg: Text) {}
      }
    `);
    expect(iface.service).toBe(
      '{\n  Logger () -> *{\n    log. (msg: Text) => .\n  }\n}',
    );
  });

  it('multiple methods in order', () => {
    const { interface: iface } = extract(`
      @Document = (content: Text) *{
        @title = -> "untitled"
        @body = -> content as Text
        @index_of = (match: Text) -> pos: 0 as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document (content: Text) -> *{\n    title () -> (Text)\n    body () -> (Text)\n    index_of (match: Text) -> (pos: Integer)\n  }\n}',
    );
  });

  it('no-arg method returning inferred type from class param', () => {
    const { interface: iface } = extract(`
      @Box = (value: Integer) *{
        @get = -> value as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Box (value: Integer) -> *{\n    get () -> (Integer)\n  }\n}',
    );
  });
});

// ── Private actor methods excluded ───────────────────────────────────────────

describe('class interface — private methods excluded', () => {
  it('private method does not appear in actor interface', () => {
    const { interface: iface } = extract(`
      @Document = (content: Text) *{
        helper = (t Text) -> r: t as Text
        @title = -> helper(content) as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Document (content: Text) -> *{\n    title () -> (Text)\n  }\n}',
    );
  });
});

// ── Class alongside file-level public functions ──────────────────────────────

describe('class interface — mixed with public functions', () => {
  it('class and public function in same file', () => {
    const { interface: iface } = extract(`
      @Document = (content: Text) *{
        @title = -> "untitled"
        @body = -> content as Text
        @index_of = (match: Text) -> pos: 0 as Integer
      }
      @publish. = (doc: @Document) {}
    `);
    expect(iface.service).toBe(
      '{\n  publish. (doc: Document) => .\n  Document (content: Text) -> *{\n    title () -> (Text)\n    body () -> (Text)\n    index_of (match: Text) -> (pos: Integer)\n  }\n}',
    );
  });

  it('public function before class', () => {
    const { interface: iface } = extract(`
      @ping = -> 1
      @Counter = (start Integer) *{
        @get = -> value: start as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  ping () -> (Integer)\n  Counter (Integer) -> *{\n    get () -> (value: Integer)\n  }\n}',
    );
  });

  it('multiple classes', () => {
    const { interface: iface } = extract(`
      @Point = (x Integer, y Integer) *{
        @sum = -> total: (x + y) as Integer
      }
      @Label = (text: Text) *{
        @get = -> text as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Point (Integer, Integer) -> *{\n    sum () -> (total: Integer)\n  }\n  Label (text: Text) -> *{\n    get () -> (Text)\n  }\n}',
    );
  });
});

// ── Private classes excluded ─────────────────────────────────────────────────

describe('class interface — private classes excluded', () => {
  const { interface: iface } = extract(`
    Helper = (n Integer) *{
      @get = -> value: n as Integer
      @use = -> value: "shadowed"
      @count *Integer = 0
    }
    @Shown = *{
      @show = -> value: 1 as Integer
    }
    @use
      =
      h = Helper(5)
      :value Integer = h.get()
      return :value as Integer
  `);

  it('leaves out a private class and its members, keeping public entries', () => {
    expect(iface.service).toBe(
      '{\n  use () -> (value: Integer)\n  Shown () -> *{\n    show () -> (value: Integer)\n  }\n}',
    );
  });
});

// ── Class interface — optional params ────────────────────────────────────────

describe('class interface — optional params', () => {
  it('positional optional shows ? Type', () => {
    const { interface: iface } = extract(`
      @Counter = (start Integer = 0) *{
        @get = -> value: start as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Counter (? Integer) -> *{\n    get () -> (value: Integer)\n  }\n}',
    );
  });

  it('named optional shows ? name: Type', () => {
    const { interface: iface } = extract(`
      @Config = (label: Text = "default") *{
        @get = -> label as Text
      }
    `);
    expect(iface.service).toBe(
      '{\n  Config (? label: Text) -> *{\n    get () -> (Text)\n  }\n}',
    );
  });

  it('mixed required and optional params', () => {
    const { interface: iface } = extract(`
      @Pair = (a Integer, b Integer = 0) *{
        @sum = -> total: (a + b) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Pair (Integer, ? Integer) -> *{\n    sum () -> (total: Integer)\n  }\n}',
    );
  });

  it('inferred type from default shows in interface', () => {
    const { interface: iface } = extract(`
      @Box = (value=42) *{
        @get = -> value as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Box (? Integer) -> *{\n    get () -> (Integer)\n  }\n}',
    );
  });

  it('actor method with optional arg', () => {
    const { interface: iface } = extract(`
      @Store = * {
        @get = (key: Text, fallback: Text = "none") -> value: "found"
      }
    `);
    expect(iface.service).toBe(
      '{\n  Store () -> *{\n    get (key: Text, ? fallback: Text) -> (value: Text)\n  }\n}',
    );
  });

  it('all-optional class params', () => {
    const { interface: iface } = extract(`
      @Defaults = (x=10, y=20) *{
        @sum = -> total: (x + y) as Integer
      }
    `);
    expect(iface.service).toBe(
      '{\n  Defaults (? Integer, ? Integer) -> *{\n    sum () -> (total: Integer)\n  }\n}',
    );
  });
});

// ── Class interface — imported type address resolution ──────────────────────

describe('class interface — imported type address resolution', () => {
  it('class param of imported type renders as backtick address', () => {
    const { interface: iface } = extract(`
      *
        "/models/item": Item
      *

      @Wrapper = (item: Item) *{
        @get = -> item as Item
      }
    `);
    expect(iface.service).toBe(
      '{\n  Wrapper (item: `/models/item`) -> *{\n    get () -> (`/models/item`)\n  }\n}',
    );
  });

  it('actor method returning imported type', () => {
    const { interface: iface } = extract(`
      *
        "/models/pair": Pair
      *

      @Factory = * {
        @make = -> Pair(key: "a", value: "b") as Pair
      }
    `);
    expect(iface.service).toBe(
      '{\n  Factory () -> *{\n    make () -> (`/models/pair`)\n  }\n}',
    );
  });

  it('actor method accepting imported type as parameter', () => {
    const { interface: iface } = extract(`
      *
        "/models/item": Item
      *

      @Processor = * {
        @handle. = (item: Item) {}
      }
    `);
    expect(iface.service).toBe(
      '{\n  Processor () -> *{\n    handle. (item: `/models/item`) => .\n  }\n}',
    );
  });
});

// ── `!` classes and return paths ─────────────────────────────────────────────

const docOf = (source) => extract(source).interface.service;

describe('class interface — a class named with `!`', () => {
  const source = `
    *
      "Svc": Svc
    *
    @W! = *{
      Svc.ping!()
      @get = { return 1 }
    }
  `;

  it('shows the name callers write, and a writing arrow', () => {
    expect(docOf(source)).toBe('{\n  W! () => *{\n    get () -> (Integer)\n  }\n}');
  });

  it('reads back with its name and effect', () => {
    const W = parseInterface(docOf(source)).__types['W!'];
    expect(W.effect).toBe('write');
    expect(W.functions.map(f => f.name)).toEqual(['get']);
  });

  it('a class without `!` stays a read', () => {
    const doc = docOf('@W = *{\n  @get = { return 1 }\n}\n');
    expect(doc).toBe('{\n  W () -> *{\n    get () -> (Integer)\n  }\n}');
    expect(parseInterface(doc).__types.W.effect).toBe('read');
  });

  it('with no members of its own', () => {
    const doc = docOf('@E! = *{}\n');
    expect(doc).toBe('{\n  E! () => *{}\n}');
    expect(parseInterface(doc).__types['E!'].effect).toBe('write');
  });

  it('a public subclass names its public `!` superclass', () => {
    const doc = docOf('@W! = *{\n  @get = { return 1 }\n}\n@S! = (@W! |) *{\n  @h = { return 2 }\n}\n');
    expect(doc).toBe('{\n  W! () => *{\n    get () -> (Integer)\n  }\n  S! (W! |) => *{\n    ...W!\n    h () -> (Integer)\n  }\n}');
    expect(parseInterface(doc).__types['S!'].supertypes).toEqual([{ supertype: 'W!' }]);
  });

  it('a private `!` superclass is stated in place', () => {
    expect(docOf('W! = *{\n  @get = { return 1 }\n}\n@S! = (W! |) *{\n  @h = { return 2 }\n}\n'))
      .toBe('{\n  S! () => *{\n    get () -> (Integer)\n    h () -> (Integer)\n  }\n}');
  });

  it('a private one isn\'t documented', () => {
    expect(docOf('W! = *{\n  @get = { return 1 }\n}\n@go = { return 1 }\n')).toBe('{\n  go () -> (Integer)\n}');
  });

  it('the annotation is the class name without `!`', () => {
    const body = (type) => `W! = *{\n  @get = { return 1 }\n}\n@go! = {\n  x ${type} = W!()\n  n Integer = x.get()\n  return n\n}\n`;
    expect(() => compileSource(body('W'))).not.toThrow();
    expect(() => compileSource(body('W!'))).toThrow(/a type name takes no '!'/);
  });

  it('the annotation is checked against the class', () => {
    expect(() => compileSource('W! = *{\n  @get = { return 1 }\n}\n@go! = {\n  x W = W!()\n  n Integer = x.nope()\n  return n\n}\n')).toThrow(/'W' has no method 'nope'/);
  });

  it('errors name the class, not an internal identifier', () => {
    expect(() => compileSource('W! = *{\n  @get = { return 1 }\n}\n@go! = {\n  x = W!()\n  n Integer = x.nope()\n  return n\n}\n')).toThrow(/'W' has no method 'nope'/);
  });

  it('a type in a doc is the class name without `!`', () => {
    expect(docOf('W! = *{\n  @get = { return 1 }\n}\n@go = (w W) { return 1 }\n')).toBe('{\n  go (W) -> (Integer)\n}');
  });

  it('is constructed with its `!`', () => {
    expect(() => compileSource('W! = *{\n  @get = { return 1 }\n}\n@go = {\n  x = W()\n  return 1\n}\n')).toThrow(/'W' writes while constructing, so call it 'W!'/);
  });

  it('can\'t share a name with a class without one', () => {
    expect(() => compileSource('W! = *{}\nW = *{}\n@go = { return 1 }\n')).toThrow(/'W' and 'W!' are both declared/);
    expect(() => compileSource('@W! = *{}\n@W = *{}\n')).toThrow(/'@W' and '@W!' are both declared/);
  });

  it('is inherited from with its `!`', () => {
    expect(() => compileSource('W! = *{}\nS! = (W |) *{}\n@go = { return 1 }\n')).toThrow(/'W' is named 'W!'/);
  });

  it('passes its effect to a subclass', () => {
    expect(() => compileSource('W! = *{}\nS = (W! |) *{}\n@go = { return 1 }\n')).toThrow(/Class 'S' inherits from 'W!'.*must be named 'S!'/);
    expect(() => compileSource('W! = *{}\nS! = (W! |) *{}\n@go! = {\n  S!()\n}\n')).not.toThrow();
  });

  it('a doc\'s writing constructor passes its effect too', () => {
    const header = '*\n  "Svc": Svc\n*\n';
    const docs = (entry) => ({ remotes: [{ path: 'Svc', service: `{ ${entry} }` }] });
    expect(() => compileSource(`${header}S = (Base |) *{}\n@go = { return 1 }\n`, docs('Base () => *{}'))).toThrow(/Class 'S' inherits from 'Base'/);
    expect(() => compileSource(`${header}S = (Base |) *{}\n@go = { return 1 }\n`, docs('Base () -> *{}'))).not.toThrow();
  });
});

describe('class interface — return paths', () => {
  const fn = (body) => `n *Integer = 0\n@go! = (b Boolean) {\n  n <- 1\n  ${body}\n}\n`;

  it('a value and self show both, whichever comes first', () => {
    const expected = '{\n  go! (Boolean) => (Integer) | self\n}';
    expect(docOf(fn('if b { return 1 }\n  return self'))).toBe(expected);
    expect(docOf(fn('if b { return self }\n  return 1'))).toBe(expected);
  });

  it('reads back with both outcomes', () => {
    const [sig] = parseInterface(docOf(fn('if b { return 1 }\n  return self')))['go!'];
    expect(sig.effect).toBe('write');
    expect(sig.returnsSelf).toBe(true);
    expect(sig.returns.map(r => r.type)).toEqual(['Integer']);
  });

  it('inside a class', () => {
    const doc = docOf('@C = *{\n  n *Integer = 0\n  @go! = (b Boolean) {\n    n <- 1\n    if b { return 1 }\n    return self\n  }\n}\n');
    expect(doc).toBe('{\n  C () -> *{\n    go! (Boolean) => (Integer) | self\n  }\n}');
    const [sig] = parseInterface(doc).__types.C.functions;
    expect(sig.returnsSelf).toBe(true);
    expect(sig.returns.map(r => r.type)).toEqual(['Integer']);
  });

  it('a value returned only from branches is shown', () => {
    const doc = docOf(fn('if b { return 1 } else { return 2 }'));
    expect(doc).toBe('{\n  go! (Boolean) => (Integer)\n}');
    expect(parseInterface(doc)['go!'][0].returnsSelf).toBeUndefined();
  });

  it('a local in a branch gives the value its type', () => {
    expect(docOf(fn('if b {\n    x = 1\n    return x\n  }\n  return self'))).toBe('{\n  go! (Boolean) => (Integer) | self\n}');
  });

  it('self on every path is self, in branches too', () => {
    const doc = docOf('n *Integer = 0\n@go! = (b Boolean) {\n  if b { n <- 1 } else { n <- 2 }\n}\n');
    expect(doc).toBe('{\n  go! (Boolean) => self\n}');
    const [sig] = parseInterface(doc)['go!'];
    expect(sig.returnsSelf).toBe(true);
    expect(sig.returns).toBeNull();
  });

  it('a nested function\'s return isn\'t one of these paths', () => {
    expect(docOf('n *Integer = 0\n@go! = {\n  f = { return "x" }\n  n <- 1\n}\n')).toBe('{\n  go! () => self\n}');
  });

  it('a read-only function can mix them as well', () => {
    expect(docOf('@go = (b Boolean) {\n  if b { return 1 }\n  return self\n}\n')).toBe('{\n  go (Boolean) -> (Integer) | self\n}');
  });

  it('a silent function stays silent with an early exit', () => {
    expect(docOf('n *Integer = 0\n@fire. = (b Boolean) {\n  if b { return }\n  n <- 1\n}\n')).toBe('{\n  fire. (Boolean) => .\n}');
  });

  it('a hand-written doc writes self last', () => {
    expect(() => parseInterface('{ go! () => self | (Integer) }')).toThrow(/'self' goes last/);
  });

  it('other text after a return is still rejected', () => {
    expect(() => parseInterface('{ go! () => (Integer) | nope }')).toThrow(/unexpected text after return/);
  });

  it('a doc can state several shapes', () => {
    expect(parseInterface('{ go! () => (Integer) | (Text) }')['go!'][0]).toMatchObject({ returnAlternatives: [[{ type: 'Integer' }], [{ type: 'Text' }]] });
  });

  it('a function type can state both', () => {
    expect(docOf('@go = (f () => (Integer) | self) { return 1 }\n')).toBe('{\n  go (() => (Integer) | self) -> (Integer)\n}');
  });
});

describe('class interface — a read-only tail `if`', () => {
  it('shows the value its branches end in', () => {
    const doc = docOf('@f = (b Boolean) {\n  if b { 1 } else { 2 }\n}\n');
    expect(doc).toBe('{\n  f (Boolean) -> (Integer)\n}');
    expect(parseInterface(doc).f[0].returns.map(r => r.type)).toEqual(['Integer']);
  });

  it('through `else if`, with a local in a branch', () => {
    expect(docOf('@f = (b Boolean) {\n  if b {\n    x = 1\n    x\n  } else if b { 2 } else { 3 }\n}\n')).toBe('{\n  f (Boolean) -> (Integer)\n}');
  });

  it('an `if` that isn\'t the tail returns nothing', () => {
    expect(docOf('@f = (b Boolean) {\n  if b { 1 } else { 2 }\n  return "x"\n}\n')).toBe('{\n  f (Boolean) -> (Text)\n}');
  });
});

describe('class interface — chaining on a mixed return', () => {
  const REMOTE = '*\n  "Svc": Svc\n*\n';
  const docs = (service) => ({ remotes: [{ path: 'Svc', service }] });
  const MIXED = docs('{ go! () => (Integer) | self\n next! () => self }');

  it('is an error locally', () => {
    expect(() => compileSource(`C = *{
      n *Integer = 0
      @go! = (b Boolean) {
        n <- 1
        if b { return 1 }
        return self
      }
      @get = { return n }
    }
    @run! = {
      v Integer = C().go!(true).get()
      return v
    }`)).toThrow(/'go!' returns a value here.*bind it first/);
  });

  it('is an error on a remote whose doc states it', () => {
    expect(() => compileSource(`${REMOTE}@run! = { Svc.go!().next!() }\n`, MIXED)).toThrow(/'go!' returns a value here.*bind it first/);
  });

  it('is an error further along a remote chain', () => {
    expect(() => compileSource(`${REMOTE}@run! = { Svc.next!().go!().next!() }\n`, MIXED)).toThrow(/'go!' returns a value here.*bind it first/);
  });

  it('is an error on a member with no call', () => {
    expect(() => compileSource(`${REMOTE}@run! = {\n  v Integer = Svc.go!().total\n  return v\n}\n`, MIXED)).toThrow(/'go!' returns a value here.*bind it first/);
  });

  it('a mixed call can still be bound, or end a chain', () => {
    expect(() => compileSource(`${REMOTE}@run! = {\n  v = Svc.go!()\n  Svc.next!().go!()\n}\n`, MIXED)).not.toThrow();
  });

  it('a remote that only returns self still chains', () => {
    expect(() => compileSource(`${REMOTE}@run! = { Svc.next!().next!() }\n`, MIXED)).not.toThrow();
  });
});
