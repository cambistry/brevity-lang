import { compileSource, compileActor, expectBehavior, createActor, expectActorBehavior } from '../helpers.js';
import { extract } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// A function's return paths can differ. Its doc shows them all, and a caller's annotation
// has to hold for every one.

const doc = (source) => extract(source).interface.service;

describe('generated docs', () => {
  const sig = (body, params = 'b Boolean') => doc(`@f = (${params}) {\n${body}\n}\n`).split('\n')[1].trim();

  it('merges paths with the same slots', () => {
    expect(sig('if b { return 1 }\nreturn "x"')).toBe('f (Boolean) -> (Integer | Text)');
    expect(sig('if b { return 1 }\nreturn 2')).toBe('f (Boolean) -> (Integer)');
    expect(sig('if b { return n: 1 }\nreturn n: "x"')).toBe('f (Boolean) -> (n: Integer | Text)');
    expect(sig('if b { return 1, n: 2 }\nreturn "x", n: "y"')).toBe('f (Boolean) -> (Integer | Text, n: Integer | Text)');
  });

  it('merges a union it finds, without repeating a member', () => {
    expect(sig('if b { return x }\nreturn 1', 'b Boolean, x Integer | Text')).toBe('f (Boolean, Integer | Text) -> (Integer | Text)');
  });

  it('alternates paths with different slots', () => {
    expect(sig('if b { return a: 1, c: 2 }\nreturn 3, n: "x"')).toBe('f (Boolean) -> (a: Integer, c: Integer) | (Integer, n: Text)');
    expect(sig('if b { return 1, 2 }\nreturn 3')).toBe('f (Boolean) -> (Integer, Integer) | (Integer)');
  });

  it('keeps self last', () => {
    expect(doc('@a *Integer = 0\n@f! = (b Boolean, c Boolean) {\n  @a <- 1\n  if b { return 1 }\n  if c { return "x" }\n  return self\n}\n')).toContain('f! (Boolean, Boolean) => (Integer | Text) | self');
    expect(doc('@a *Integer = 0\n@f! = (b Boolean, c Boolean) {\n  @a <- 1\n  if b { return self }\n  if c { return p: 1 }\n  return 2\n}\n')).toContain('f! (Boolean, Boolean) => (p: Integer) | (Integer) | self');
  });

  it('a path it can\'t infer widens to Anything, positionally', () => {
    const source = '@g = (b Boolean) {\n  x = other(b)\n  if b { return x }\n  return 3\n}\nother = (b) { return b }\n';
    expect(doc(source)).toContain('g (Boolean) -> (Anything)');
    expect(doc(source)).not.toContain('arg1');
  });
});

describe('reading a doc', () => {
  it('states every shape', () => {
    const { f, g } = parseInterface('{ f () -> (Integer) | (a: Text)\n g () => (Integer) | (Text) | self }');
    expect(f[0].returnAlternatives).toEqual([
      [expect.objectContaining({ type: 'Integer', positional: true })],
      [expect.objectContaining({ name: 'a', type: 'Text' })],
    ]);
    expect(f[0].returns).toEqual(f[0].returnAlternatives[0]);
    expect(g[0].returnsSelf).toBe(true);
    expect(g[0].returnAlternatives).toHaveLength(2);
  });

  it('a function type can state them too', () => {
    expect(() => compileSource('run = (f: () -> (Integer) | (Text)) {\n  return 1\n}\n@go = { return 1 }\n')).not.toThrow();
  });

  it('round-trips a generated doc', () => {
    const service = doc('@f = (b Boolean) {\n  if b { return a: 1 }\n  return 2\n}\n');
    expect(parseInterface(service).f[0].returnAlternatives).toHaveLength(2);
  });

  it('self still goes last', () => {
    expect(() => parseInterface('{ f () => self | (Integer) }')).toThrow(/'self' goes last/);
    expect(() => parseInterface('{ f () => (Integer) | self | (Text) }')).toThrow(/unexpected text/);
  });
});

describe('a caller\'s annotation', () => {
  const MIXED = '@f = (b Boolean) {\n  if b { return 1 }\n  return "x"\n}\n';
  const accepts = (source, options) => expect(() => compileSource(source, options)).not.toThrow();
  const rejects = (source, pattern, options) => expect(() => compileSource(source, options)).toThrow(pattern);

  it('has to cover every path', () => {
    rejects(`${MIXED}@g = {\n  x Integer = @f(true)\n  return x\n}\n`, /Cannot bind 'x Integer' to '@f\(\)' — it can return Integer \| Text.*'x Integer \| Text'.*as Integer/);
    accepts(`${MIXED}@g = {\n  x Integer | Text = @f(true)\n  return x\n}\n`);
    accepts(`${MIXED}@g = {\n  x Anything = @f(true)\n  return x\n}\n`);
  });

  it('accepts a coercion', () => {
    accepts(`${MIXED}@g = {\n  x Integer = @f(true) as Integer\n  return x\n}\n`);
    accepts(`${MIXED}@g = {\n  y = @f(true) as Integer\n  return y\n}\n`);
  });

  it('catches a single shape that doesn\'t match', () => {
    rejects('@f = { return "x" }\n@g = {\n  t Integer = @f()\n  return t\n}\n', /'t Integer' to '@f\(\)' — it can return Text/);
    accepts('@f = { return 1 }\n@g = {\n  t Integer = @f()\n  return t\n}\n');
  });

  it('checks a class\'s method', () => {
    const cls = 'C = *{\n  @f = (b Boolean) {\n    if b { return 1 }\n    return "x"\n  }\n}\n';
    rejects(`${cls}@g = {\n  c = C()\n  x Integer = c.f(true)\n  return x\n}\n`, /'c\.f\(\)' — it can return Integer \| Text/);
    accepts(`${cls}@g = {\n  c = C()\n  x Integer | Text = c.f(true)\n  return x\n}\n`);
  });

  it('checks a doc', () => {
    const h = '*\n  "s.bv": Svc\n*\n';
    const docs = (service) => ({ remotes: [{ path: 's.bv', service }] });
    rejects(`${h}@g = {\n  x Text = Svc.f()\n  return x\n}\n`, /'x Text' to 'Svc\.f\(\)' — it can return Integer/, docs('{ f () -> (Integer) }'));
    rejects(`${h}@g = {\n  x Integer = Svc.f()\n  return x\n}\n`, /it can return Integer \| Text/, docs('{ f () -> (Integer | Text) }'));
    rejects(`${h}@g = {\n  x Integer = Svc.f()\n  return x\n}\n`, /it can return Integer \| Text/, docs('{ f () -> (Integer) | (Text) }'));
    accepts(`${h}@g = {\n  x Integer | Text = Svc.f()\n  return x\n}\n`, docs('{ f () -> (Integer) | (Text) }'));
    accepts(`${h}@g = {\n  x Integer = Svc.f()\n  return x\n}\n`, docs('{ f () -> (Anything) }'));
  });

  it('a destructured key has to be in every shape', () => {
    const named = '@f = (b Boolean) {\n  if b { return a: 1 }\n  return a: 2, c: "x"\n}\n';
    rejects(`${named}@g = {\n  :c Text = @f(true)\n  return :c\n}\n`, /'c' from '@f\(\)' — only some of its paths return it/);
    accepts(`${named}@g = {\n  :a Integer = @f(true)\n  return :a\n}\n`);
    rejects(`${named}@g = {\n  :a Text = @f(true)\n  return :a\n}\n`, /'a Text' to '@f\(\)' — it can return Integer/);
  });

  it('nothing binds to a path that returns only names', () => {
    rejects('@f = (b Boolean) {\n  if b { return a: 1 }\n  return 2\n}\n@g = {\n  x Integer = @f(true)\n  return x\n}\n', /one of its paths returns only named fields \(a\)/);
  });

  it('nothing binds to a path that returns self', () => {
    rejects('@a *Integer = 0\n@f! = (b Boolean) {\n  @a <- 1\n  if b { return 1 }\n  return self\n}\n@g! = {\n  x Integer = @f!(true)\n  return x\n}\n', /some of its paths return self/);
  });

  it('checks a function with params', () => {
    rejects('h = (b Boolean) { return "a" }\n@g = {\n  x Integer = h(true)\n  return x\n}\n', /'x Integer' to 'h\(\)' — it can return Text/);
  });
});

describe('a caller\'s annotation on a value that isn\'t a call', () => {
  const accepts = (source) => expect(() => compileSource(source)).not.toThrow();
  const rejects = (source, pattern) => expect(() => compileSource(source)).toThrow(pattern);

  it('checks a name', () => {
    rejects('@g = (y Text) {\n  x Integer = y\n  return x\n}\n', /Cannot bind 'x Integer' to 'y', which is Text.*'x Integer = y as Integer'/);
    rejects('n *Text = "a"\n@g = {\n  x Integer = n\n  return x\n}\n', /'x Integer' to 'n', which is Text/);
    rejects('@g = {\n  m = "s"\n  x Integer = m\n  return x\n}\n', /'x Integer' to 'm', which is Text/);
    accepts('@g = (y Integer) {\n  x Integer | Text = y\n  return x\n}\n');
  });

  it('checks a literal', () => {
    rejects('@g = {\n  x Integer = "a"\n  return x\n}\n', /'x Integer' to a value that is Text/);
    rejects('@g = {\n  x Integer = true\n  return x\n}\n', /'x Integer' to a value that is Boolean/);
  });

  it('a literal takes the form its annotation asks for', () => {
    accepts('@g = {\n  b Blob = "hi"\n  d Decimal = 0\n  e Float = 1 + 2\n  return 1\n}\n');
  });

  it('a union name may have been narrowed, so one member that fits is enough', () => {
    accepts('@g = (y Integer | null) {\n  if y == null { return 0 }\n  x Integer = y\n  return x\n}\n');
    accepts('@g = (y Integer | null) {\n  x Integer = y ?? 0\n  return x\n}\n');
    rejects('@g = (y Text | null) {\n  x Integer = y\n  return x\n}\n', /'x Integer' to 'y', which can be Text \| null/);
  });

  it('leaves an actor to its `as` at run time', () => {
    accepts('T = (x Integer) *{ @a = -> v: x as Integer }\n@g = {\n  t = T(1)\n  n Integer = t\n  return 1\n}\n');
  });

  it('checks a call inside an expression', () => {
    rejects('f = { return 1 }\n@g = {\n  x Text = f() + 1\n  return x\n}\n', /'x Text' to a value that is Integer/);
    rejects('f = { return 1 }\n@g = {\n  x Integer = f() < 3\n  return x\n}\n', /'x Integer' to a value that is Boolean/);
    accepts('f = { return 1 }\n@g = {\n  x Integer = f() + 1\n  return x\n}\n');
  });

  it('a pair with no rule is left alone', () => {
    accepts('f = { return "a" }\n@g = {\n  x Integer = f() + 1\n  return x\n}\n');
  });
});

describe('a caller\'s annotation on an overload', () => {
  const accepts = (source, options) => expect(() => compileSource(source, options)).not.toThrow();
  const rejects = (source, pattern, options) => expect(() => compileSource(source, options)).toThrow(pattern);
  const PICK = 'pick = (n Integer) { return "a" }\npick << (n Text) { return 1 }\n';

  it('holds for the clause the args select', () => {
    rejects(`${PICK}@g = {\n  x Integer = pick(1)\n  return x\n}\n`, /'x Integer' to 'pick\(\)' — it can return Text/);
    accepts(`${PICK}@g = (v Text) {\n  x Integer = pick(v)\n  return x\n}\n`);
  });

  it('holds for every clause when the args can\'t decide', () => {
    rejects(`${PICK}@g = (v Integer | Text) {\n  x Integer = pick(v)\n  return x\n}\n`, /it can return Text \| Integer/);
    accepts(`${PICK}@g = (v Integer | Text) {\n  x Integer | Text = pick(v)\n  return x\n}\n`);
  });

  it('an earlier clause that takes anything wins', () => {
    rejects('pick = (n) { return "a" }\npick << (n Text) { return 1 }\n@g = {\n  x Integer = pick("q")\n  return x\n}\n', /it can return Text/);
  });

  it('selects by arity', () => {
    const pick = 'pick = (n Integer) { return "a" }\npick << (a Integer, b Integer) { return 1 }\n';
    accepts(`${pick}@g = {\n  x Integer = pick(1, 2)\n  return x\n}\n`);
    rejects(`${pick}@g = {\n  x Text = pick(1, 2)\n  return x\n}\n`, /'x Text' to 'pick\(\)' — it can return Integer/);
  });

  it('checks a public handler', () => {
    rejects('@pick = (n Integer) { return "a" }\n@pick << (n Text) { return 1 }\n@g = {\n  x Integer = @pick(1)\n  return x\n}\n', /'x Integer' to '@pick\(\)' — it can return Text/);
  });

  it('checks a doc', () => {
    const h = '*\n  "s.bv": Svc\n*\n';
    const docs = { remotes: [{ path: 's.bv', service: '{ f (Integer) -> (Text)\n f (Text) -> (Integer) }' }] };
    rejects(`${h}@g = {\n  x Integer = Svc.f(1)\n  return x\n}\n`, /'x Integer' to 'Svc\.f\(\)' — it can return Text/, docs);
    accepts(`${h}@g = {\n  x Integer = Svc.f("a")\n  return x\n}\n`, docs);
  });
});

describe('a dependency instance held in a handler\'s local', () => {
  const h = '*\n  "thing.bv": Thing (a: Integer) -> *{ get () -> (Text) }\n*\n';

  it('checks its members', () => {
    expect(() => compileSource(`${h}@g = {\n  t = Thing(a: 5)\n  t.nope()\n  return 1\n}\n`)).toThrow(/'Thing' has no function 'nope'/);
  });

  it('checks a caller\'s annotation', () => {
    expect(() => compileSource(`${h}@g = {\n  t = Thing(a: 5)\n  x Integer = t.get()\n  return x\n}\n`)).toThrow(/'x Integer' to 't\.get\(\)' — it can return Text/);
  });

  it('can be annotated with its own class', () => {
    expect(() => compileSource(`${h}@g = {\n  t Thing = Thing(a: 5)\n  x Text = t.get()\n  return x\n}\n`)).not.toThrow();
  });
});

describe('at runtime', () => {
  const SOURCE = `
    @f = (b Boolean) {
      if b { return 1 }
      return "x"
    }
    @union = (b Boolean) {
      x Integer | Text = @f(b)
      return x
    }
  `;

  it('each path returns its own value', async () => {
    await expectBehavior(SOURCE,
      { input: { id: '1', op: [[true], 'f'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1] }) },
      { input: { id: '2', op: [[false], 'f'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['x'] }) },
    );
  });

  it('a union annotation holds either', async () => {
    await expectBehavior(SOURCE,
      { input: { id: '1', op: [[true], 'union'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1] }) },
      { input: { id: '2', op: [[false], 'union'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['x'] }) },
    );
  });

  it('a typed bind waits for a service\'s reply', async () => {
    const actor = await createActor('*\n  "s.bv": Svc\n*\n@go = {\n  x Integer = Svc.f()\n  return x + 1\n}\n', { compileOptions: { remotes: [{ path: 's.bv', service: '{ f () -> (Integer) }' }] } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'go', from: 'c' } },
      { output: expect.objectContaining({ op: 'f', to: 'Svc' }) },
      { input: { id: '1', re: [4], 'ty': ['Integer'], from: 'Svc' } },
      { output: expect.objectContaining({ id: 'x', re: [5] }) },
    );
  });

  it('a remote\'s shapes reach the caller', async () => {
    const actor = await createActor('*\n  "s.bv": Svc\n*\n@go = {\n  x Integer | Text = Svc.f()\n  return x\n}\n', { compileOptions: { remotes: [{ path: 's.bv', service: '{ f () -> (Integer) | (Text) }' }] } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'go', from: 'c' } },
      { output: expect.objectContaining({ op: 'f', to: 'Svc' }) },
      { input: { id: '1', re: ['y'], 'ty': ['Text'], from: 'Svc' } },
      { output: expect.objectContaining({ id: 'x', re: ['y'] }) },
    );
  });
});

describe('a reply\'s tag', () => {
  const bodies = `
      @positional = (b Boolean) {
        if b { return "x" }
        return 9
      }
      @named = (b Boolean) {
        if b { return n: "x" }
        return n: 9
      }
      @elseBranch = (b Boolean) {
        if b { return "x" } else { return 9 }
      }
      @nested = (b Boolean) {
        if b {
          if b { return "x" }
        }
        return 9
      }
      @inLoop = (b Boolean) {
        n *Integer = 0
        repeat while n < 1 {
          if b { return "x" }
          n <- n + 1
        }
        return 9
      }
      @fromParam = (b Boolean, t Text, i Integer) {
        if b { return t }
        return i
      }
  `;
  const script = `${bodies}
    @Box = *{${bodies}}
  `;
  const newBox = [
    { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
    { output: { id: '1', re: '#<. Box 1>', 'ty': '. Box', to: 'c' } },
  ];

  const paths = [
    ['positional', ['x'], ['Text'], [9], ['Integer']],
    ['named', { n: 'x' }, { n: 'Text' }, { n: 9 }, { n: 'Integer' }],
    ['elseBranch', ['x'], ['Text'], [9], ['Integer']],
    ['nested', ['x'], ['Text'], [9], ['Integer']],
    ['inLoop', ['x'], ['Text'], [9], ['Integer']],
  ];

  describe.each(paths)('%s', (op, earlyRe, earlyTag, lateRe, lateTag) => {
    it('tags each path in a file handler', async () => {
      await expectBehavior(script,
        { input: { id: '1', op: [[true], op], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '1', re: earlyRe, 'ty': earlyTag, to: 'c' } },
        { input: { id: '2', op: [[false], op], 'ty': [['Boolean']], from: 'c' } },
        { output: { id: '2', re: lateRe, 'ty': lateTag, to: 'c' } },
      );
    });
    it('tags each path in a class', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[true], op], 'ty': [['Boolean']], to: '. Box 1', from: 'c' } },
        { output: { id: '2', re: earlyRe, 'ty': earlyTag, to: 'c', from: '. Box 1' } },
        { input: { id: '3', op: [[false], op], 'ty': [['Boolean']], to: '. Box 1', from: 'c' } },
        { output: { id: '3', re: lateRe, 'ty': lateTag, to: 'c', from: '. Box 1' } },
      );
    });
  });

  it('tags a path by the type of the param it returns', async () => {
    await expectBehavior(script, ...newBox,
      { input: { id: '2', op: [[true, 'x', 9], 'fromParam'], 'ty': [['Boolean', 'Text', 'Integer']], to: '. Box 1', from: 'c' } },
      { output: { id: '2', re: ['x'], 'ty': ['Text'], to: 'c', from: '. Box 1' } },
      { input: { id: '3', op: [[false, 'x', 9], 'fromParam'], 'ty': [['Boolean', 'Text', 'Integer']], to: '. Box 1', from: 'c' } },
      { output: { id: '3', re: [9], 'ty': ['Integer'], to: 'c', from: '. Box 1' } },
    );
  });
});

// A bind with no annotation takes its callee's return type when the callee has just
// one, as if annotated with it, so a reply carrying the name is tagged with it.
describe('an unannotated bind of a call', () => {
  const script = `
    *
      "svc.bv": Svc {
        count () => (Integer)
      }
    *
    @seed = { return 9 }
    e = @seed()

    C = *{
      k = @four()
      @four = { return 4 }
      @get = { return k }
      @double = (i Integer) { return i * 2 }
    }

    @later = {
      y = @local()
      return y
    }
    @local = {
      x = @seed()
      return x
    }
    @block = { return e }
    @method = {
      c = C()
      v = c.get()
      w = c.double(3)
      return v, w
    }
    @remote! = {
      n = Svc.count()
      return n
    }
  `;

  it('takes an own function\'s, in a handler', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'local', from: 'c' } },
      { output: { id: '1', re: [9], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('takes one a bind gave its callee', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'later', from: 'c' } },
      { output: { id: '1', re: [9], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('takes an own function\'s, in a constructor block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'block', from: 'c' } },
      { output: { id: '1', re: [9], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('takes a class method\'s, and one from the class\'s constructor block', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'method', from: 'c' } },
      { output: { id: '1', re: [4, 6], 'ty': ['Integer', 'Integer'], to: 'c' } },
    );
  });

  // The call goes out under an id that varies by target, so the reply takes the id
  // the call went out with.
  it('takes a doc entry\'s', async () => {
    const actor = await (await compileActor(script)).spawn();
    await actor.sendAsync({ id: '1', op: 'remote!', from: 'c' });
    const call = actor.posts.find(p => p.op === 'count');
    await actor.sendAsync({ id: call.id, re: [5], 'ty': ['Integer'], from: 'Svc' });
    expect(actor.posts.filter(p => p.to === 'c')).toEqual([{ id: '1', re: [5], 'ty': ['Integer'], to: 'c' }]);
  });
});
