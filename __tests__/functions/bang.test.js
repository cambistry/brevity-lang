import { expectBehavior, compileSource, createActor, expectActorBehavior } from '../helpers.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A `!` function writes. Its return paths say what it yields: falling off the end
// returns self, `return v` returns v, and there is no tail return. A self-return
// is `{ re: {}, 'bv-a': '#<>' }`, with the parent promoting the address.
// Design: notes/mutation-suffix-2026-10-31.md.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation and validation ───────────────────────────────────────────────

describe('! function — tail errors', () => {
  const body = (b) => `acc *Integer = 0\n@m! = (i Integer) { ${b} }\n`;

  it('a tail name is an error suggesting return', () => {
    expect(() => compileSource(body('acc <- i\n i'))).toThrow(/Did you mean 'return'/);
  });

  it('a tail operator expression is an error', () => {
    expect(() => compileSource(body('acc <- i\n i + 1'))).toThrow(/Did you mean 'return'/);
  });

  it('a tail literal is an error', () => {
    expect(() => compileSource(body('acc <- i\n 1'))).toThrow(/Did you mean 'return'/);
  });

  it('a bare tail `self` is an error naming the fix', () => {
    expect(() => compileSource(body('acc <- i\n self'))).toThrow(/write 'return self'/);
  });

  it('a value in an arrow body is a tail value', () => {
    expect(() => compileSource('@m! = -> 1\n')).toThrow(/Did you mean 'return'/);
  });

  it('a tail value in an else branch is an error', () => {
    expect(() => compileSource(body('if i == 0 { acc <- 1 } else { 0 }'))).toThrow(/Did you mean 'return'/);
  });

  it('a value on one path and a fall-through on another is an error', () => {
    expect(() => compileSource(body('if i == 0 { return i }\n acc <- i'))).toThrow(/write 'return self'/);
  });
});

describe('self as a value — validation', () => {
  it('is an error outside return position', () => {
    expect(() => compileSource('@go = { x = self\n return 1 }\n')).toThrow(/self/);
  });

  it('cannot be one of several return values', () => {
    expect(() => compileSource('@go = { return self, 7 }\n')).toThrow(/several return values/);
  });
});

describe('! names — validation', () => {
  it('a type name takes no bang in an annotation', () => {
    expect(() => compileSource('a Integer! = 0\n')).toThrow(/takes no '!'/);
  });

  it('a type name takes no bang in a construction', () => {
    expect(() => compileSource('a = Integer!(0)\n')).toThrow(/takes no '!'/);
  });
});

describe('<- as an expression — validation', () => {
  it('`return a <- x` parses, and is reported as not yet supported', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { return a <- 1 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('parens regroup: `a <- (b <- c)` uses a write as a value', () => {
    expect(() => compileSource('a *Integer = 0\nb *Integer = 0\n@go = { a <- (b <- 1)\n return 1 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('a comma in a return list belongs to the list', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { return a <- 1, 2 }\n')).toThrow(/as a value isn't supported yet/);
  });

  it('the left side must be a cell', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { x Integer = 1 + a <- 2\n return x }\n')).toThrow(/left side of '<-' must be a cell/);
  });

  it('a non-cell target is an error', () => {
    expect(() => compileSource('@go = (a Integer) { return a <- 2 }\n')).toThrow(/only '\*Type' variables/);
  });
});

describe('chains — validation', () => {
  const POP = `
    ::Item (name: Text)
    C = *{
      n *Integer = 0
      @pop! = {
        n <- n + 1
        return Item(name: "x")
      }
    }
  `;

  describe('from a call on this actor', () => {
    const body = (lines) => `a *Integer = 0\nbump! = (i Integer) { a <- a + i }\n@add! = (i Integer) { a <- a + i }\n@pop! = {\n  a <- 0\n  return a\n}\nhidden! = { a <- 1 }\n@total = { return a }\n@go! = {\n  ${lines}\n}\n`;

    it.each([
      ['a private head', 'bump!(1).add!(2)'],
      ['a public head', '@add!(1).add!(2)'],
      ['a value at the end', 'v Integer = bump!(1).total()\n  return v'],
      ['a member read at the end', 'v Integer = bump!(1).total\n  return v'],
      ['a returned chain', 'return bump!(1).add!(2).total()'],
    ])('accepts %s', (_, lines) => {
      expect(() => compileSource(body(lines))).not.toThrow();
    });

    it('a head that returns a value can\'t be chained on', () => {
      expect(() => compileSource(body('v Integer = @pop!().total()\n  return v'))).toThrow(/'@pop!' returns a value here.*bind it first/);
    });

    it('a member must be public', () => {
      expect(() => compileSource(body('bump!(1).hidden!()'))).toThrow(/'hidden!' isn't a public function/);
    });

    it('a member must exist', () => {
      expect(() => compileSource(body('bump!(1).nope!()'))).toThrow(/'nope!' isn't a public function/);
    });

    it.each([
      ['an operand', 'v Integer = 1 + bump!(1).total()\n  return v'],
      ['a condition', 'if bump!(1).total() == 1 { a <- 2 }'],
      ['a loop condition', 'repeat while bump!(1).total() == 1 { a <- 2 }'],
    ])('must be a whole value, not %s', (_, lines) => {
      expect(() => compileSource(body(lines))).toThrow(/can't start from 'bump!.*bind it first/);
    });

    it('a local function can\'t start one', () => {
      expect(() => compileSource(body('f! = { a <- 1 }\n  f!().add!(1)'))).toThrow(/can't start from 'f!/);
    });

    it('its effect counts', () => {
      expect(() => compileSource(`a *Integer = 0\n@add! = { a <- 1 }\n@total = { return a }\n@go = { return @add!().total() }\n`)).toThrow(/'@go' writes/);
    });

    it('a discarded read at the end is reported', () => {
      expect(() => compileSource(body('bump!(1).total()'))).toThrow(/The value of '@total\(\)' is discarded/);
    });
  });

  it('a value-returning `!` call on a new actor can\'t be chained on', () => {
    expect(() => compileSource(`${POP}
      @go = {
        n Text = C().pop!().name
        return n
      }
    `)).toThrow(/returns a value here.*bind it first/);
  });

  it('a value-returning `!` call on a held actor can\'t be chained on', () => {
    expect(() => compileSource(`${POP}
      @go = {
        c = C()
        n Text = c.pop!().name
        return n
      }
    `)).toThrow(/returns a value here.*bind it first/);
  });
});

describe('a `!` function by name', () => {
  const FILE = 'x *Integer = 0\nbump! = { x <- 1 }\n';

  it('`&name!` is the reference form', () => {
    expect(() => compileSource(`${FILE}run! = (f () => ()) { f() }\n@go! = {\n  run!(&bump!)\n  return x\n}\n`)).not.toThrow();
  });

  it('a bare name asks for `&`', () => {
    expect(() => compileSource(`${FILE}run! = (f () => ()) { f() }\n@go! = {\n  run!(bump!)\n  return x\n}\n`)).toThrow(/use &bump! to pass by reference/);
  });

  it('a bare name asks for `&` in a return', () => {
    expect(() => compileSource(`${FILE}run = (f () -> ()) { return f() }\n@go = { return run(bump!) }\n`)).toThrow(/use &bump! to pass by reference/);
  });

  it('a bare name asks for `&` in a function named like a builtin', () => {
    expect(() => compileSource(`${FILE}take = (f () -> ()) { f() }\n@go = {\n  take(bump!)\n  return 1\n}\n`)).toThrow(/use &bump! to pass by reference/);
  });

  it('`&a!=b` is still not-equal', () => {
    expect(() => compileSource('f = { return 1 }\n@go = {\n  r Boolean = &f!=&f\n  return r\n}\n')).not.toThrow();
  });

  it('taking a reference to a writer counts as a write', () => {
    expect(() => compileSource('x *Integer = 0\nnext! = (i Integer) {\n  x <- i\n  return i\n}\n@go = {\n  r List of Integers = over([1], &next!)\n  return r\n}\n')).toThrow(/'@go' writes \(&next!\)/);
  });

  it('a `!` function on a `#` name is passed the same way', () => {
    expect(() => compileSource('x *Integer = 0\n#hit! = { x <- 1 }\n@go! = {\n  #hit!()\n  return x\n}\n')).not.toThrow();
  });

  describe('in a `->` slot', () => {
    const rejected = /takes a read-only function here, but '&\S+' writes/;

    it('rejects a `!` function', () => {
      expect(() => compileSource(`${FILE}take = (f () -> ()) { f() }\n@go = {\n  take(&bump!)\n  return 1\n}\n`)).toThrow(rejected);
    });

    it('rejects a silent function', () => {
      expect(() => compileSource(`x *Integer = 0\nfire. = { x <- 1 }\nrun = (f () -> ()) { f() }\n@go = {\n  run(&fire.)\n  return 1\n}\n`)).toThrow(rejected);
    });

    it('rejects a `=>` param passed on', () => {
      expect(() => compileSource('run = (f () -> ()) { f() }\n@go! = (g () => ()) {\n  run(&g)\n  g()\n}\n')).toThrow(rejected);
    });

    it('rejects one on a class method', () => {
      expect(() => compileSource(`${FILE}C = *{\n  @run = (f () -> ()) { return 1 }\n}\n@go! = {\n  c = C()\n  n Integer = c.run(&bump!)\n  return n\n}\n`)).toThrow(rejected);
    });

    it('rejects one on a named param', () => {
      expect(() => compileSource(`${FILE}run = (f: () -> ()) { f() }\n@go = {\n  run(f: &bump!)\n  return 1\n}\n`)).toThrow(rejected);
    });

    it('rejects one in a return', () => {
      expect(() => compileSource(`${FILE}run = (f () -> ()) { return f() }\n@go = { return run(&bump!) }\n`)).toThrow(rejected);
    });

    it('rejects one in a doc param', () => {
      expect(() => compileSource(`*\n  "svc.bv": Svc () -> *{ run (f: () -> ()) -> (n: Integer) }\n*\n${FILE}@go! = {\n  s = Svc()\n  n Integer = s.run(f: &bump!)\n  return n\n}\n`)).toThrow(rejected);
    });

    it('accepts a read-only function', () => {
      expect(() => compileSource('get = { return 1 }\nrun = (f () -> ()) { return f() }\n@go = { return run(&get) }\n')).not.toThrow();
    });

    it('accepts an untracked function', () => {
      expect(() => compileSource('untracked n *Integer = 0\nuntracked note! = { n <- 1 }\nrun = (f () -> ()) { return f() }\n@go = { return run(&note!) }\n')).not.toThrow();
    });
  });

  it('a `!` function declared in a body can\'t be passed by reference yet', () => {
    expect(() => compileSource('run! = (f () => ()) { f() }\n@go! = {\n  m *Integer = 0\n  f! = { m <- 1 }\n  run!(&f!)\n  return m\n}\n')).toThrow(/'&f!' — a '!' function declared in a body can't be passed by reference yet/);
  });
});

describe('a function named like a builtin', () => {
  it('shadows it, before and after its declaration', () => {
    expect(() => compileSource('@a = { return first(1) }\nfirst = (i Integer) { return i + 1 }\n@b = { return first(2) }\n')).not.toThrow();
  });

  it('leaves the method form alone', () => {
    expect(() => compileSource('first = (i Integer) { return i + 1 }\n@a = { return Text.first("abc") }\n')).not.toThrow();
  });

  it('the builtin reports a wrong argument count', () => {
    expect(() => compileSource('@go = { return take("abc") }\n')).toThrow(/'take' takes 2 arguments, got 1/);
    expect(() => compileSource('@go = { return slice("abc") }\n')).toThrow(/'slice' takes 2 to 3 arguments, got 1/);
    expect(() => compileSource('@go = {\n  x Text = take("abc")\n  return x\n}\n')).toThrow(/'take' takes 2 arguments, got 1/);
  });
});

describe('effect arrows in signatures', () => {
  const widget = (entry) => ({ remotes: [{ path: 'Widget', service: `{ ${entry} }` }] });
  const useWidget = '*\n  "Widget": Widget\n*\n@go. = { x Integer = 1 }\n';

  it.each([
    'total () -> (Integer)',
    'me () -> self',
    'total () ~> (Integer)',
    'pop () => (Integer)',
    'sort (Integer) => self',
    'log (Text) => .',
    'log. (Text) => .',
  ])('`%s` is valid', (entry) => {
    expect(() => compileSource(useWidget, widget(entry))).not.toThrow();
  });

  it.each([
    ['log. (Text) -> .', /has nothing to read/],
    ['log. (Text) ~> .', /has nothing to read/],
    ['me () ~> self', /has nothing to read/],
    ['me () -> (self)', /takes no parens/],
    ['log. (Text) => (Integer)', /silent by its name/],
  ])('`%s` is an error', (entry, message) => {
    expect(() => compileSource(useWidget, widget(entry))).toThrow(message);
  });

  it.each([
    ['(Integer) -> self'],
    ['(Integer) => self'],
    ['(Integer) => (Integer)'],
    ['(Integer) ~> (Integer)'],
    ['(Integer) => .'],
  ])('function type `%s` is valid', (type) => {
    expect(() => compileSource(`@a = (cb: ${type}) -> result: 1\n`)).not.toThrow();
  });

  it.each([
    ['(Integer) -> .', /has nothing to read/],
    ['(Integer) ~> .', /has nothing to read/],
    ['(Integer) ~> self', /has nothing to read/],
    ['(Integer) -> (self)', /./],
  ])('function type `%s` is an error', (type, message) => {
    expect(() => compileSource(`@a = (cb: ${type}) -> result: 1\n`)).toThrow(message);
  });

  it('`untracked` prefixes a doc entry', () => {
    const p = parseInterface(`{
      untracked log *Text
      untracked write. (Text) => .
      untracked set label (Text)
      total () -> (Integer)
    }`);
    expect(p.__untracked).toEqual(['log', 'write.', 'label']);
    expect(p['write.'][0].effect).toBe('write');
  });

  it('`untracked` is reserved for locals', () => {
    expect(() => compileSource('@go = {\n  untracked Integer = 1\n  return untracked\n}\n')).toThrow();
    expect(() => compileSource('@go = (untracked Integer) { return 1 }\n')).toThrow();
  });

  it('a local bound by a bare named param `untracked:` can\'t be read', () => {
    expect(() => compileSource('@go = (untracked: Integer) { return untracked }\n')).toThrow();
  });

  it('a function may be named `@untracked` or `#untracked`', () => {
    expect(() => compileSource('@untracked = { return 1 }\n')).not.toThrow();
    expect(() => compileSource('#untracked = { return 1 }\n@go = { return 1 }\n')).not.toThrow();
  });

  it('a doc entry `untracked (…)` is a function with that name', () => {
    const p = parseInterface('{ untracked () -> (Integer) }');
    expect(p.untracked[0].effect).toBe('read');
    expect(p.__untracked).toBeUndefined();
  });

  it('a member named `untracked` can be called', () => {
    expect(() => compileSource('*\n  "Svc": Svc\n*\n@go = {\n  :n Integer = Svc.untracked()\n  return :n\n}\n',
      { remotes: [{ path: 'Svc', service: '{ untracked () -> (n: Integer) }' }] })).not.toThrow();
  });

  it('an effect arrow is only for signatures', () => {
    expect(() => compileSource('@a = (i Integer) => i\n')).toThrow(/only for signatures/);
    expect(() => compileSource('@a = (i Integer) ~> i\n')).toThrow(/only for signatures/);
  });

  it('a generated doc states each function\'s effect', () => {
    const { interface: doc } = compileSource(`
      a *Integer = 0
      @inc! = (i Integer) { a <- a + i }
      @take! = {
        v Integer = a
        a <- 0
        return v
      }
      @ping. = { a <- 1 }
      @me = { self }
      @total = { return a }
    `);
    expect(doc.service).toContain('inc! (Integer) => self');
    expect(doc.service).toMatch(/take! \(\) => \(/);
    expect(doc.service).toContain('ping. () => .');
    expect(doc.service).toContain('me () -> self');
    expect(doc.service).toMatch(/total \(\) -> \(/);
  });

  it('a claim spreads: a function reading a `~>` gets `~>` in its own doc', () => {
    const { interface: doc } = compileSource(`
      *
        "svc.bv": Svc () -> *{ guess () ~> (n: Integer) }
      *
      s = Svc()
      helper = {
        :n Integer = s.guess()
        return :n
      }
      @direct = {
        :n Integer = s.guess()
        return :n
      }
      @indirect = {
        :n Integer = helper()
        return :n
      }
      @plain = { return 1 }
    `);
    expect(doc.service).toMatch(/direct \(\) ~> /);
    expect(doc.service).toMatch(/indirect \(\) ~> /);
    expect(doc.service).toMatch(/plain \(\) -> /);
  });

  it('a foreign silent function needs no dot in its name', () => {
    const { output } = compileSource('*\n  "Logger": Logger\n*\n@go. = { Logger.log("x")... }\n',
      { remotes: [{ path: 'Logger', service: '{ log (Text) => . }' }] });
    expect(output).toBeTruthy();
  });

  it('`...` still needs a silent function', () => {
    expect(() => compileSource('*\n  "Logger": Logger\n*\n@go. = { Logger.get("x")... }\n',
      { remotes: [{ path: 'Logger', service: '{ get (Text) -> (Integer) }' }] })).toThrow(/needs a silent/);
  });
});

describe('effect enforcement', () => {
  const REMOTE = '*\n  "Svc": Svc\n*\n';
  const docs = (service) => ({ remotes: [{ path: 'Svc', service }] });

  it('a function that writes must say so', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { a <- 1\n return 1 }\n')).toThrow(/'@go' writes \(a <- …\), so it must be named '@go!' or '@go\.'/);
  });

  it('a local cell doesn\'t count', () => {
    expect(() => compileSource('@go = {\n  a *Integer = 0\n  a <- 1\n  return a\n}\n')).not.toThrow();
  });

  it('a param cell does', () => {
    expect(() => compileSource('@go = (x *Integer) { x <- 1\n return 1 }\n')).toThrow(/'@go' writes/);
  });

  it('the effect spreads through calls', () => {
    expect(() => compileSource('a *Integer = 0\nbump! = { a <- 1 }\n@go = { bump!()\n return 1 }\n')).toThrow(/'@go' writes \(bump!\(…\)\)/);
  });

  it('a silent call counts', () => {
    expect(() => compileSource('a *Integer = 0\nfire. = { a <- 1 }\n@go = { fire...\n return 1 }\n')).toThrow(/'@go' writes/);
  });

  it('a named local function answers for its name', () => {
    expect(() => compileSource('a *Integer = 0\n@go! = {\n  f = (i Integer) { a <- i }\n  f(1)\n}\n')).toThrow(/'f' writes/);
  });

  it('an anonymous function\'s writes belong to the function defining it', () => {
    expect(() => compileSource('a *Integer = 0\n@go = { x = over([1]) |v| { a <- v }\n return 1 }\n')).toThrow();
  });

  it('a public parent is found: overriding its `!` needs no write', () => {
    expect(() => compileSource('@P = *{\n  n *Integer = 0\n  @g! = { n <- 1 }\n}\n@U = (P |) *{ @g! = { return self } }\n')).not.toThrow();
  });

  it('a public class is found: writing a fresh actor of it is no write', () => {
    expect(() => compileSource('@C = *{\n  n *Integer = 0\n  @g! = { n <- 1 }\n}\n@go = {\n  c = C()\n  c.g!()\n  return 1\n}\n')).not.toThrow();
  });

  describe('discarded reads on typed receivers', () => {
    const CLASSES = `
      C = *{
        @g = { return 1 }
        @quiet = { b Integer = 1 }
      }
      U = (C |) *{}
    `;

    it('a typed param', () => {
      expect(() => compileSource(`${CLASSES}\n@go = (c C) {\n  c.g()\n  return 1\n}\n`)).toThrow(/The value of '\.g\(\)' is discarded/);
    });

    it('a write-capability param', () => {
      expect(() => compileSource(`${CLASSES}\n@go = (c *C) {\n  c.g()\n  return 1\n}\n`)).toThrow(/The value of '\.g\(\)' is discarded/);
    });

    it('a class param', () => {
      expect(() => compileSource(`${CLASSES}\nD = (c C) *{\n  @go = {\n    c.g()\n    return 1\n  }\n}\n`)).toThrow(/The value of '\.g\(\)' is discarded/);
    });

    it('a member inherited by the param\'s class', () => {
      expect(() => compileSource(`${CLASSES}\n@go = (u U) {\n  u.g()\n  return 1\n}\n`)).toThrow(/The value of '\.g\(\)' is discarded/);
    });

    it('nothing to lose: a function with no value', () => {
      expect(() => compileSource(`${CLASSES}\n@go = (c C) {\n  c.quiet()\n  return 1\n}\n`)).not.toThrow();
    });
  });

  it('a `!` function that never writes is an error', () => {
    expect(() => compileSource('@go! = { return 1 }\n')).toThrow(/'@go!' never writes/);
  });

  it('an override may be purer than the function it overrides', () => {
    expect(() => compileSource(`
      Base = *{
        a *Integer = 0
        @go! = { a <- 1 }
      }
      Sub = (Base |) *{
        @go! = { return 1 }
      }
      @t = { return 1 }
    `)).not.toThrow();
  });

  it('discarding a read is an error', () => {
    expect(() => compileSource('get = { return 1 }\n@go = {\n  get()\n  return 2\n}\n')).toThrow(/The value of 'get\(\)' is discarded/);
  });

  it('writes to an actor created here don\'t count', () => {
    expect(() => compileSource(`
      C = *{
        a *Integer = 0
        @inc! = { a <- 1 }
      }
      @make = {
        c = C()
        c.inc!().inc!()
        return c
      }
    `)).not.toThrow();
  });

  it('passing it on first makes a later write count', () => {
    expect(() => compileSource(`
      C = *{
        a *Integer = 0
        @inc! = { a <- 1 }
      }
      keep = (c C) { return 1 }
      @make = {
        c = C()
        n Integer = keep(c)
        c.inc!()
        return n
      }
    `)).toThrow(/'@make' writes/);
  });

  it('a held actor\'s write counts', () => {
    expect(() => compileSource(`
      C = *{
        a *Integer = 0
        @inc! = { a <- 1 }
      }
      c = C()
      @go = { c.inc!()\n return 1 }
    `)).toThrow(/'@go' writes/);
  });

  it('a foreign writer counts, by its arrow', () => {
    expect(() => compileSource(`${REMOTE}@go = { Svc.sort(1)\n return 1 }\n`, docs('{ sort (Integer) => self }'))).toThrow(/'@go' writes/);
  });

  it('a foreign read doesn\'t count, even with a bang in its name', () => {
    expect(() => compileSource(`${REMOTE}@go = {\n  :n Integer = Svc.uniq!()\n  return :n\n}\n`, docs('{ uniq! () -> (n: Integer) }'))).not.toThrow();
  });

  it('a purported read counts as a read', () => {
    expect(() => compileSource(`${REMOTE}@go = {\n  :n Integer = Svc.get()\n  return :n\n}\n`, docs('{ get () ~> (n: Integer) }'))).not.toThrow();
  });

  describe('calling a `~>`', () => {
    const SVC = '*\n  "svc.bv": Svc () -> *{ guess () ~> (n: Integer) }\n*\ns = Svc()\n';
    const reads = '  :n Integer = s.guess()\n  x Integer = n\n';

    it('a `!` function may rest on it alone', () => {
      expect(() => compileSource(`${SVC}@a! = {\n${reads}}\n`)).not.toThrow();
    });

    it('a `!` function may rest on an own function that calls it', () => {
      expect(() => compileSource(`${SVC}helper = {\n  :n Integer = s.guess()\n  return :n\n}\n@a! = {\n  :n Integer = helper()\n  x Integer = n\n}\n`)).not.toThrow();
    });

    it('a silent function may rest on it alone', () => {
      expect(() => compileSource(`${SVC}@a. = {\n${reads}}\n`)).not.toThrow();
    });

    it('a claim crosses classes and locals, until nothing changes', () => {
      const { interface: doc } = compileSource(`
        *
          "svc.bv": Svc () -> *{
            guess () ~> (n: Integer)
            sure () -> (n: Integer)
          }
        *
        @C = *{
          s = Svc()
          @g = {
            :n Integer = s.guess()
            return :n
          }
          @h = {
            :n Integer = s.sure()
            return :n
          }
        }
        D = *{
          c = C()
          @viaField = {
            :n Integer = c.g()
            return :n
          }
        }
        @viaLocal = {
          c = C()
          :n Integer = c.g()
          return :n
        }
        @viaFresh = {
          :n Integer = C().g()
          return :n
        }
        @viaTwoClasses = {
          d = D()
          :n Integer = d.viaField()
          return :n
        }
        @viaParam = (c C) {
          :n Integer = c.g()
          return :n
        }
        @direct = {
          s = Svc()
          :n Integer = s.guess()
          return :n
        }
        @certain = {
          c = C()
          :n Integer = c.h()
          return :n
        }
      `);
      for (const name of ['g', 'viaLocal', 'viaFresh', 'viaTwoClasses', 'viaParam', 'direct']) {
        expect(doc.service).toMatch(new RegExp(`${name} \\(.*\\) ~> `));
      }
      expect(doc.service).toMatch(/\bh \(\) -> /);
      expect(doc.service).toMatch(/certain \(\) -> /);
    });

    it('a claim shows on a public class\'s members', () => {
      const { interface: doc } = compileSource(`${SVC}
        @Pub = *{
          t = Svc()
          @g = {
            :n Integer = t.guess()
            return :n
          }
        }
      `);
      expect(doc.service).toMatch(/g \(\) ~> /);
    });

    it('a claim through a class is reason enough for `!`', () => {
      expect(() => compileSource(`${SVC}
        C = *{
          t = Svc()
          @g = {
            :n Integer = t.guess()
            return :n
          }
        }
        c = C()
        @a! = {
          :n Integer = c.g()
          x Integer = n
        }
      `)).not.toThrow();
    });

    it('functions calling each other settle', () => {
      const { interface: doc } = compileSource(`${SVC}
        p = (i Integer) {
          if i == 0 {
            :n Integer = s.guess()
            return n
          }
          return q(i)
        }
        q = (i Integer) { return p(i - 1) }
        @go = {
          v Integer = q(1)
          return v
        }
      `);
      expect(doc.service).toMatch(/go \(\) ~> /);
    });

    it('`!` and `.` keep `=>` in their docs', () => {
      const { interface: doc } = compileSource(`${SVC}@a! = {\n${reads}}\n@b. = {\n${reads}}\n`);
      expect(doc.service).toContain('a! () => self');
      expect(doc.service).toContain('b. () => .');
    });
  });

  it('a `->` param rejects a writing function', () => {
    expect(() => compileSource(`
      a *Integer = 0
      run = (f (Integer) -> (Integer)) { return f(1) }
      @go! = {
        n Integer = run((i Integer) { a <- i\n return i })
        return n
      }
    `)).toThrow(/takes a read-only function/);
  });

  describe('`->` slots', () => {
    const WRITER = '() -> { a <- 1 }';
    const CLASSES = `
      ::R (f: () -> (), g: () => ())
      a *Integer = 0
      C = (f: () -> ()) *{
        @take = (f () -> ()) { return 1 }
        @give! = (f () => ()) { f() }
      }
      D = (C |) *{}
    `;
    const body = (lines) => `${CLASSES}\n@go! = (c C) {\n  a <- 0\n  ${lines}\n}\n`;
    const service = '{ take (f: () -> ()) -> (n: Integer)\n pos (() -> ()) -> (n: Integer)\n give (f: () => ()) => self }';
    const remote = (lines) => `*\n  "svc.bv": Svc () -> *${service}\n*\na *Integer = 0\n@go! = {\n  a <- 0\n  s = Svc()\n  ${lines}\n}\n`;

    it.each([
      ['a type field', `r = R(f: ${WRITER}, g: () -> { a <- 2 })`],
      ['a class method', `n Integer = c.take(${WRITER})`],
      ['a class param', `x = C(f: ${WRITER})`],
      ['an inherited class param', `x = D(f: ${WRITER})`],
    ])('rejects a writing function in %s', (_, lines) => {
      expect(() => compileSource(body(lines))).toThrow(/takes a read-only function/);
    });

    it.each([
      ['named', `n Integer = s.take(f: ${WRITER})`],
      ['positional', `n Integer = s.pos(${WRITER})`],
    ])('rejects a writing function in a %s doc param', (_, lines) => {
      expect(() => compileSource(remote(lines))).toThrow(/takes a read-only function/);
    });

    it('accepts a writing function in a `=>` slot', () => {
      expect(() => compileSource(body(`r = R(f: () -> { b Integer = 1 }, g: ${WRITER})`))).not.toThrow();
      expect(() => compileSource(body(`c.give!(${WRITER})`))).not.toThrow();
      expect(() => compileSource(remote(`s.give(f: ${WRITER})`))).not.toThrow();
    });

    it('accepts a reading function in a `->` slot', () => {
      expect(() => compileSource(body('n Integer = c.take(() -> { b Integer = 1 })'))).not.toThrow();
    });

    it('reads the slot\'s own arrow, not one inside its params', () => {
      expect(() => compileSource(`
        a *Integer = 0
        run! = (f () => (g: () -> ())) { f() }
        @go! = { run!(() -> { a <- 1 }) }
      `)).not.toThrow();
    });
  });

  describe('`!` functions declared in a body', () => {
    const inBody = (lines) => `n *Integer = 0\n@go! = {\n  n <- 0\n  ${lines}\n}\n`;

    it('a tail value is an error', () => {
      expect(() => compileSource(inBody('f! = {\n    n <- 1\n    n\n  }\n  f!()'))).toThrow(/'f!' is a '!' function, which has no tail return/);
    });

    it('a bare tail `self` is an error', () => {
      expect(() => compileSource(inBody('f! = {\n    n <- 1\n    self\n  }\n  f!()'))).toThrow(/'f!' returns self by falling off the end/);
    });

    it('a value on one path and a fall-through on another is an error', () => {
      expect(() => compileSource(inBody('f! = (b Boolean) {\n    n <- 1\n    if b { return 1 }\n  }\n  f!(true)'))).toThrow(/'f!' returns a value on one path/);
    });

    it('never writing is an error', () => {
      expect(() => compileSource(inBody('f! = { return 1 }\n  v Integer = f!()'))).toThrow(/'f!' never writes/);
    });

    it('writing through a `=>` param, a sibling, or a held actor is a write', () => {
      expect(() => compileSource(inBody('f! = (g () => ()) { g() }'))).not.toThrow();
      expect(() => compileSource('@go = {\n  m *Integer = 0\n  f! = { m <- 1 }\n  h! = { f!() }\n  h!()\n  return m\n}\n')).not.toThrow();
      expect(() => compileSource('C = *{\n  k *Integer = 0\n  @g! = { k <- 1 }\n}\n@go = {\n  c = C()\n  f! = { c.g!() }\n  f!()\n  return 1\n}\n')).not.toThrow();
    });

    it('a write to the enclosing function\'s own cell needs `!` on the name, but not on the enclosing function', () => {
      expect(() => compileSource('@go = {\n  m *Integer = 0\n  f! = { m <- 1 }\n  f!()\n  return m\n}\n')).not.toThrow();
      expect(() => compileSource('@go = {\n  m *Integer = 0\n  f = { m <- 1 }\n  f()\n  return m\n}\n')).toThrow(/'f' writes/);
    });

    it('a write past the enclosing function makes it a writer too', () => {
      expect(() => compileSource('n *Integer = 0\n@go = {\n  f! = { n <- 1 }\n  f!()\n  return 1\n}\n')).toThrow(/'@go' writes/);
    });
  });

  it('a `=>` param accepts one, and calling it counts as a write', () => {
    expect(() => compileSource(`
      a *Integer = 0
      run! = (f (Integer) => (Integer)) { return f(1) }
      @go! = {
        n Integer = run!((i Integer) { a <- i\n return i })
        return n
      }
    `)).not.toThrow();
    expect(() => compileSource('run = (f (Integer) => (Integer)) { return f(1) }\n@go = { return 1 }\n')).toThrow(/'run' writes/);
  });

  it('a class that writes while constructing must be `!`', () => {
    const source = (name) => `${REMOTE}${name} = *{\n  Svc.ping!()\n  @get = { return 1 }\n}\n@go = { return 1 }\n`;
    expect(() => compileSource(source('W'), docs('{ ping! () => self }'))).toThrow(/Class 'W' writes/);
  });

  it('a file constructor\'s alias and arrow must agree', () => {
    expect(() => compileSource('*\n  "w.bv": Widget (a: Integer) => *{ get () -> (n: Integer) }\n*\n@go = { return 1 }\n')).toThrow(/alias must be 'Widget!'/);
    expect(() => compileSource('*\n  "w.bv": Widget! (a: Integer) -> *{ get () -> (n: Integer) }\n*\n@go = { return 1 }\n')).toThrow(/can't carry '!'/);
  });
});

describe('untracked', () => {
  it('a write to an untracked cell doesn\'t count', () => {
    expect(() => compileSource('untracked hits *Integer = 0\n@go = { hits <- 1\n return 1 }\n')).not.toThrow();
  });

  it('a call to an untracked function doesn\'t count', () => {
    expect(() => compileSource('untracked log *Integer = 0\nuntracked write. = (m Integer) { log <- m }\n@go = { write.(1)...\n return 1 }\n')).not.toThrow();
  });

  it('a call to an untracked nested actor doesn\'t count', () => {
    expect(() => compileSource(`
      Logger = *{
        n *Integer = 0
        @add! = { n <- 1 }
      }
      untracked audit = Logger()
      @go = { audit.add!()\n return 1 }
    `)).not.toThrow();
  });

  it('an untracked function can only write untracked state', () => {
    expect(() => compileSource('a *Integer = 0\nuntracked @write. = { a <- 1 }\n')).toThrow(/is untracked, so it can only write untracked state/);
  });

  it('an untracked member in a foreign doc doesn\'t count', () => {
    expect(() => compileSource('*\n  "Svc": Svc\n*\n@go = { Svc.write.(1)...\n return 1 }\n',
      { remotes: [{ path: 'Svc', service: '{ untracked write. (Integer) => . }' }] })).not.toThrow();
  });

  it('crosses actor borders in the generated doc', () => {
    const { interface: doc } = compileSource('untracked @log *Text = ""\nuntracked hidden *Text = ""\nuntracked @write. = (m Text) { hidden <- m }\n');
    expect(doc.service).toContain('untracked log *Text');
    expect(doc.service).toContain('untracked write. (Text) => .');
  });

  it('is an error before anything but a declaration', () => {
    expect(() => compileSource('untracked 1\n')).toThrow(/must come before a declaration/);
  });
});

// ── Runtime ──────────────────────────────────────────────────────────────────

describe('! function — return paths', () => {
  const script = `
    ::Flag (untracked: Boolean)

    acc *Integer = 0
    a *Integer = 0
    b *Integer = 5
    log *Integer = 0

    bump! = (i Integer) { acc <- acc + i }

    next! = (v Integer) {
      log <- log * 10 + v
      return v
    }

    @inc! = (i Integer) { acc <- acc + i }

    @explicit! = (i Integer) {
      acc <- acc + i
      return self
    }

    @take! = {
      v Integer = acc
      acc <- 0
      return v
    }

    @guarded! = (i Integer) {
      if i == 0 { return }
      acc <- acc + i
    }

    @every! = (c Boolean) {
      if c {
        acc <- 1
        return self
      }
      return self
    }

    @either! = (c Boolean) {
      acc <- 1
      if c { return acc }
      return self
    }

    @tailIf! = (c Boolean) {
      if c {
        acc <- 1
        bump!(2)
      }
    }

    @branches! = (c Integer) {
      if c == 1 {
        acc <- 10
      } else if c == 2 {
        acc <- 20
      } else {
        acc <- 30
      }
    }

    @arrow! = (i Integer) -> acc <- acc + i

    @lineal!
      =
      acc <- acc + 1

    @valueBranch! = (c Boolean) {
      if c {
        acc <- 1
        return acc
      }
      return 0
    }

    @total = { return acc }

    @viaPrivate! = {
      bump!(1)
      bump!(2)
      return acc
    }

    @me = { self }
    @meExplicit = { return self }

    @same = { return 1 }
    @same! = { acc <- 2 }

    @notEqual = (n Integer) {
      r Boolean = n!=1
      return r
    }

    @keyReply = { return untracked: 1 }

    @keyParam = (untracked: u Integer) { return u }

    keyed = (untracked: u Integer) { return u }

    @keyArg = {
      v Integer = keyed(untracked: 2)
      return v
    }

    @keyField = {
      f Flag = Flag(untracked: true)
      v Boolean = f.untracked
      return v
    }

    @stays! = {
      a <- b <- 9
      return a, b
    }

    @ordered! = {
      a <- next!(1) <- next!(2)
      return log
    }

    @whole! = {
      a <- a + 1 * 3
      return a
    }

    run! = (f (Integer) => ()) { f(2) }

    @passes! = {
      run!(&bump!)
      return acc
    }

    @localCell = {
      m *Integer = 0
      m <- 2
      return m
    }

    @passesToOver! = {
      r List of Integers = over([1, 2], &next!)
      return r, log
    }

    @selfCalls! = {
      @inc!(1)
      @inc!(2)
      return acc as Integer
    }

    @selfCallValue! = {
      @inc!(4)
      v Integer = @take!()
      return v, acc
    }

    @selfCallRead = {
      v Integer = @total()
      return v
    }

    @selfCallReturned = { return @total() as Integer }

    #hit! = (i Integer) { acc <- acc + i }

    @hashCall! = {
      #hit!(2)
      #hit!(3)
      return acc
    }

    #plain = { return 8 }

    @hashReturned = { return #plain() as Integer }

    @builtinReturned = { return upper("hi") as Text }

    @selfChain! = {
      @inc!(1).explicit!(2)
      return acc
    }

    @privateChain! = {
      bump!(1).inc!(2)
      return acc
    }

    @chainValue! = {
      v Integer = bump!(4).total()
      return v
    }

    @chainMember! = {
      v Integer = bump!(5).total
      return v
    }

    @chainReturned! = { return @inc!(1).inc!(2).total() as Integer }

    @chainTail! = { @inc!(1).inc!(2) }

    @barePublic! = {
      inc!(6)
      v Integer = total()
      return v
    }

    @shadowsEarly = { return first(1) as Integer }

    first = (i Integer) { return i + 10 }

    @shadowsLate = { return first(2) as Integer }
  `;

  it('falling off the end returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('the write takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: [[2], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '3', op: '@total', from: 'c' } },
      { output: { id: '3', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`return self` returns self, even when it is the only path', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], '@explicit!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`return v` returns v', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@take!', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bare `return` exits as falling off the end does', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[0], '@guarded!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [0], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('every path may return self explicitly, and a write in a returning branch takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@every!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('value on one path, explicit self on another', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@either!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[false], '@either!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('a write and a call in a tail `if` take effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@tailIf!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a tail `if` not taken returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@tailIf!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [0], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it.each([[1, 10], [2, 20], [3, 30]])('a tail `if`/`else if`/`else` takes one branch: %i', async (c, expected) => {
    await expectBehavior(script,
      { input: { id: '1', op: [[c], '@branches!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [expected], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a final write in arrow form is a statement', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2], '@arrow!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a lineal `!` function returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@lineal!', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('a write in a value-returning branch takes effect', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@valueBranch!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a private `!` function runs, called with its bang', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@viaPrivate!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bare tail `self` in a read-only function is an ordinary tail return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@me', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`return self` in a read-only function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@meExplicit', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`foo` and `foo!` are distinct', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@same', from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: '@same!', from: 'c' } },
      { output: { id: '2', re: {}, 'bv-a': '#<>', to: 'c' } },
    );
  });

  it('`!=` is still not-equal', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2], '@notEqual'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: [true], 'bv-a': ['Boolean'], to: 'c' } },
    );
  });

  it('`untracked` works as a reply key', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@keyReply', from: 'c' } },
      { output: { id: '1', re: { untracked: 1 }, 'bv-a': { untracked: 'Integer' }, to: 'c' } },
    );
  });

  it('`untracked` works as a param key', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ untracked: 3 }, '@keyParam'], 'bv-a': [{ untracked: 'Integer' }], from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`untracked` works as a named argument', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@keyArg', from: 'c' } },
      { output: { id: '1', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`untracked` works as a type field', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@keyField', from: 'c' } },
      { output: { id: '1', re: [true], 'bv-a': ['Boolean'], to: 'c' } },
    );
  });

  it('a `<-` chain stays on its target: a ends up holding c, b is only read', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@stays!', from: 'c' } },
      { output: { id: '1', re: [9, 5], 'bv-a': ['Integer', 'Integer'], to: 'c' } },
    );
  });

  it('every link of a `<-` chain runs, in order', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@ordered!', from: 'c' } },
      { output: { id: '1', re: [12], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('the right side of `<-` takes a whole expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@whole!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`&name!` passes a `!` function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@passes!', from: 'c' } },
      { output: { id: '1', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`return` on a local cell returns its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@localCell', from: 'c' } },
      { output: { id: '1', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`&name!` works with `over`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@passesToOver!', from: 'c' } },
      { output: { id: '1', re: [[1, 2], 12], 'bv-a': ['List of Integers', 'Integer'], to: 'c' } },
    );
  });

  it('`#x!(…)` self-calls run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@hashCall!', from: 'c' } },
      { output: { id: '1', re: [5], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`return #x()` returns its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@hashReturned', from: 'c' } },
      { output: { id: '1', re: [8], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('`return` takes a bare builtin', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@builtinReturned', from: 'c' } },
      { output: { id: '1', re: ['HI'], 'bv-a': ['Text'], to: 'c' } },
    );
  });

  it('`@x(…)` self-calls run in order', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@selfCalls!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a `@x!(…)` self-call yields its value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@selfCallValue!', from: 'c' } },
      { output: { id: '1', re: [4, 0], 'bv-a': ['Integer', 'Integer'], to: 'c' } },
    );
  });

  it('a `@x(…)` self-call reads', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], '@inc!'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@selfCallRead', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '3', op: '@selfCallReturned', from: 'c' } },
      { output: { id: '3', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it.each([
    ['@selfChain!', 3],
    ['@privateChain!', 3],
    ['@chainValue!', 4],
    ['@chainMember!', 5],
    ['@chainReturned!', 3],
  ])('a chain from a call on this actor: %s', async (op, expected) => {
    await expectBehavior(script,
      { input: { id: '1', op, from: 'c' } },
      { output: { id: '1', re: [expected], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bare name reaches a public function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@barePublic!', from: 'c' } },
      { output: { id: '1', re: [6], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a chain in tail position returns self', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@chainTail!', from: 'c' } },
      { output: { id: '1', re: {}, 'bv-a': '#<>', to: 'c' } },
      { input: { id: '2', op: '@total', from: 'c' } },
      { output: { id: '2', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a function named like a builtin shadows it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@shadowsEarly', from: 'c' } },
      { output: { id: '1', re: [11], 'bv-a': ['Integer'], to: 'c' } },
      { input: { id: '2', op: '@shadowsLate', from: 'c' } },
      { output: { id: '2', re: [12], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
});

describe('chained calls', () => {
  const script = `
    ::Item (name: Text)

    C = *{
      acc *Integer = 0
      @inc! = (i Integer) { acc <- acc + i }
      @branch! = (c Boolean) {
        if c {
          acc <- 1
          return self
        }
        return self
      }
      @pop! = {
        acc <- acc + 1
        return Item(name: "x")
      }
      @total = { return acc }
      @twice! = (i Integer) {
        @inc!(i)
        @inc!(i)
      }
      @chainTwice! = (i Integer) { @inc!(i).inc!(i) }
      @chainTotal! = (i Integer) { return @inc!(i).total() }
    }

    W! = *{
      a *Integer = 0
      @add! = (i Integer) { a <- a + i }
      @get = { return a }
    }

    @onHeld = {
      c = C()
      v Integer = c.inc!(5).inc!(2).total()
      return v
    }

    @onFresh = {
      v Integer = C().inc!(5).inc!(2).total
      return v
    }

    @bindsReceiver = {
      c = C()
      d = c.inc!(5)
      d.inc!(2)
      v Integer = c.total()
      return v
    }

    @branchInChild = {
      v Integer = C().branch!(true).total()
      return v
    }

    @boundValue = {
      i Item = C().pop!()
      n Text = i.name
      return n
    }

    @bangClass! = {
      v Integer = W!().add!(2).get()
      return v
    }

    @bangClassAnnotated! = {
      w W = W!()
      w.add!(3)
      v Integer = w.get()
      return v
    }

    Base! = *{
      @one = { return 1 }
    }

    S! = (Base! |) *{
      @more = { return 10 }
    }

    @bangSuper! = {
      s = S!()
      a Integer = s.one()
      b Integer = s.more()
      return a + b
    }

    @selfCallInChild = {
      v Integer = C().twice!(2).total()
      return v
    }

    @selfChainInChild = {
      v Integer = C().chainTwice!(3).total()
      return v
    }

    @selfChainValueInChild = {
      c = C()
      v Integer = c.chainTotal!(4)
      return v
    }

    P = *{
      @one = { return 1 }
    }

    D = (P |) *{
      @two = {
        v Integer = @one()
        return v + 1
      }
    }

    @selfCallInherited = {
      d = D()
      v Integer = d.two()
      return v
    }

    @childrenApart = {
      a = C()
      b = C()
      a.twice!(1)
      b.twice!(5)
      x Integer = a.total()
      y Integer = b.total()
      return x, y
    }
  `;

  it('chains on a child held in a local', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onHeld', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('chains on a fresh construction', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@onFresh', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a bang call binds the receiver', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bindsReceiver', from: 'c' } },
      { output: { id: '1', re: [7], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a write in a returning branch takes effect in a child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@branchInChild', from: 'c' } },
      { output: { id: '1', re: [1], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a value-returning `!` call yields its value once bound', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@boundValue', from: 'c' } },
      { output: { id: '1', re: ['x'], 'bv-a': ['Text'], to: 'c' } },
    );
  });

  it('an actor of a class named with `!` is annotated without the `!`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bangClassAnnotated!', from: 'c' } },
      { output: { id: '1', re: [3], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a subclass inherits from a class named with `!`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bangSuper!', from: 'c' } },
      { output: { id: '1', re: [11], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('a class named with `!` is constructed and chains on the new actor', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@bangClass!', from: 'c' } },
      { output: { id: '1', re: [2], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it.each([
    ['@selfCallInChild', 4],
    ['@selfChainInChild', 6],
    ['@selfChainValueInChild', 4],
    ['@selfCallInherited', 2],
  ])('self-calls in a child: %s', async (op, expected) => {
    await expectBehavior(script,
      { input: { id: '1', op, from: 'c' } },
      { output: { id: '1', re: [expected], 'bv-a': ['Integer'], to: 'c' } },
    );
  });

  it('self-calls stay on their own child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@childrenApart', from: 'c' } },
      { output: { id: '1', re: [2, 10], 'bv-a': ['Integer', 'Integer'], to: 'c' } },
    );
  });
});

describe('chained calls through a remote', () => {
  const source = `
    *
      "thing.bv": Thing (a: Integer) -> *{
        inc! (Integer) => self
        total () -> (value: Integer)
      }
    *
    t = Thing(a: 5)
    @go! = {
      :value Integer = t.inc!(2).total()
      return :value
    }
  `;

  it('the next call goes to the address in `bv-a`', async () => {
    const actor = await createActor(source, {
      expects: [{ output: expect.objectContaining({ op: [{ a: 5 }, '#new'], to: 'Thing' }) }],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Thing/1>', 'bv-a': '#<Thing>', from: 'Thing' } },
      { input: { id: '99', op: '@go!', from: 'caller' } },
      { output: expect.objectContaining({ op: [[2], '@inc!'], to: 'Thing/1' }) },
      { input: { id: '2', re: {}, 'bv-a': '#<Thing/9>' } },
      { output: expect.objectContaining({ op: '@total', to: '#<Thing/9>' }) },
      { input: { id: '3', re: { value: 7 } } },
      { output: expect.objectContaining({ id: '99', re: { value: 7 }, to: 'caller' }) },
    );
  });
});

describe('a public class named with `!`', () => {
  it('is constructed by that name in its own file', async () => {
    await expectBehavior(`
      @Pub! = *{
        @one = { return 5 }
      }

      @go! = {
        p = Pub!()
        n Integer = p.one()
        return n
      }
    `,
      { input: { id: '1', op: '@go!', from: 'c' } },
      { output: { id: '1', re: [5], 'bv-a': ['Integer'], to: 'c' } },
    );
  });
});
