import { compileSource, expectBehavior, createActor, expectActorBehavior } from '../helpers.js';
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
    rejects(`${MIXED}@g = {\n  x Integer = f(true)\n  return x\n}\n`, /Cannot bind 'x Integer' to 'f\(\)' — it can return Integer \| Text.*'x Integer \| Text'.*as Integer/);
    accepts(`${MIXED}@g = {\n  x Integer | Text = f(true)\n  return x\n}\n`);
    accepts(`${MIXED}@g = {\n  x Anything = f(true)\n  return x\n}\n`);
  });

  it('accepts a coercion', () => {
    accepts(`${MIXED}@g = {\n  x Integer = f(true) as Integer\n  return x\n}\n`);
    accepts(`${MIXED}@g = {\n  y = f(true) as Integer\n  return y\n}\n`);
  });

  it('catches a single shape that doesn\'t match', () => {
    rejects('@f = { return "x" }\n@g = {\n  t Integer = f()\n  return t\n}\n', /'t Integer' to 'f\(\)' — it can return Text/);
    accepts('@f = { return 1 }\n@g = {\n  t Integer = f()\n  return t\n}\n');
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
    rejects(`${named}@g = {\n  :c Text = f(true)\n  return :c\n}\n`, /'c' from 'f\(\)' — only some of its paths return it/);
    accepts(`${named}@g = {\n  :a Integer = f(true)\n  return :a\n}\n`);
    rejects(`${named}@g = {\n  :a Text = f(true)\n  return :a\n}\n`, /'a Text' to 'f\(\)' — it can return Integer/);
  });

  it('nothing binds to a path that returns only names', () => {
    rejects('@f = (b Boolean) {\n  if b { return a: 1 }\n  return 2\n}\n@g = {\n  x Integer = f(true)\n  return x\n}\n', /one of its paths returns only named fields \(a\)/);
  });

  it('nothing binds to a path that returns self', () => {
    rejects('@a *Integer = 0\n@f! = (b Boolean) {\n  @a <- 1\n  if b { return 1 }\n  return self\n}\n@g! = {\n  x Integer = f!(true)\n  return x\n}\n', /some of its paths return self/);
  });
});

describe('at runtime', () => {
  const SOURCE = `
    @f = (b Boolean) {
      if b { return 1 }
      return "x"
    }
    @union = (b Boolean) {
      x Integer | Text = f(b)
      return x
    }
  `;

  it('each path returns its own value', async () => {
    await expectBehavior(SOURCE,
      { input: { id: '1', op: [[true], '@f'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1] }) },
      { input: { id: '2', op: [[false], '@f'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['x'] }) },
    );
  });

  it('a union annotation holds either', async () => {
    await expectBehavior(SOURCE,
      { input: { id: '1', op: [[true], '@union'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1] }) },
      { input: { id: '2', op: [[false], '@union'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: ['x'] }) },
    );
  });

  it('a typed bind waits for a service\'s reply', async () => {
    const actor = await createActor('*\n  "s.bv": Svc\n*\n@go = {\n  x Integer = Svc.f()\n  return x + 1\n}\n', { compileOptions: { remotes: [{ path: 's.bv', service: '{ f () -> (Integer) }' }] } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@go', from: 'c' } },
      { output: expect.objectContaining({ op: '@f', to: 'Svc' }) },
      { input: { id: '1', re: [4], 'bv-a': ['Integer'], from: 'Svc' } },
      { output: expect.objectContaining({ id: 'x', re: [5] }) },
    );
  });

  it('a remote\'s shapes reach the caller', async () => {
    const actor = await createActor('*\n  "s.bv": Svc\n*\n@go = {\n  x Integer | Text = Svc.f()\n  return x\n}\n', { compileOptions: { remotes: [{ path: 's.bv', service: '{ f () -> (Integer) | (Text) }' }] } });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@go', from: 'c' } },
      { output: expect.objectContaining({ op: '@f', to: 'Svc' }) },
      { input: { id: '1', re: ['y'], 'bv-a': ['Text'], from: 'Svc' } },
      { output: expect.objectContaining({ id: 'x', re: ['y'] }) },
    );
  });
});
