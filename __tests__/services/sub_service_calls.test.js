import { compileSource, createActor, expectActorBehavior } from '../helpers.js';

// A call through another file's public singleton (a sub-service): the member path
// is the address. `Svc.s.get()` is `@get` to `Svc @s`; `Svc.s.inner.ping()` is
// `@ping` to `Svc @s @inner`. See notes/classes-as-singletons-2026-11-09.md.

const DOC = '{\n  s {\n    n *Integer\n    get () -> (Integer)\n    add (Integer, by: Integer) -> (Integer)\n    note. () => .\n    inner {\n      ping () -> (Integer)\n    }\n  }\n  Box (Integer) -> *{\n    tally {\n      get () -> (Integer)\n    }\n  }\n  top () -> (Integer)\n}';
const remotes = [{ path: 'svc.bv', service: DOC }];
const header = '*\n  "svc.bv": Svc\n*\n';

const script = `${header}
@one = {
  v Integer = Svc.s.get()
  return v
}

@nested = {
  v Integer = Svc.s.inner.ping()
  return v
}

@args = {
  v Integer = Svc.s.add(2, by: 3)
  return v
}

@silent! = {
  Svc.s.note...
  return 1
}

@bound = {
  x = Svc.s
  v Integer = x.get()
  return v
}

@boundNested = {
  x = Svc.s
  v Integer = x.inner.ping()
  return v
}

@top = {
  v Integer = Svc.top()
  return v
}
`;

describe('a call through a sub-service', () => {
  const run = async (op, ...steps) => {
    const actor = await createActor(script, { compileOptions: { remotes } });
    await expectActorBehavior(actor, { input: { id: 'x', op, from: 'c' } }, ...steps);
  };

  it('is a call to the sub-service\'s address', async () => {
    await run('@one',
      { output: { id: '1', op: '@get', to: 'Svc s' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'Svc s' } },
      { output: { id: 'x', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('nests to any depth', async () => {
    await run('@nested',
      { output: { id: '1', op: '@ping', to: 'Svc s inner' } },
      { input: { id: '1', re: [8], ty: ['Integer'], from: 'Svc s inner' } },
      { output: { id: 'x', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });

  it('carries its args and their types', async () => {
    await run('@args',
      { output: { id: '1', op: [[2, { by: 3 }], '@add'], ty: [['Integer', { by: 'Integer' }]], to: 'Svc s' } },
      { input: { id: '1', re: [5], ty: ['Integer'], from: 'Svc s' } },
      { output: { id: 'x', re: [5], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a silent one doesn\'t wait', async () => {
    await run('@silent!',
      { output: { id: '1', op: '@note.', to: 'Svc s' } },
      { output: { id: 'x', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a dependency\'s own function is still a call to the dependency', async () => {
    await run('@top',
      { output: { id: '1', op: '@top', to: 'Svc' } },
      { input: { id: '1', re: [9], ty: ['Integer'], from: 'Svc' } },
      { output: { id: 'x', re: [9], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('a local bound to a sub-service', () => {
  const run = async (op, ...steps) => {
    const actor = await createActor(script, { compileOptions: { remotes } });
    await expectActorBehavior(actor, { input: { id: 'x', op, from: 'c' } }, ...steps);
  };

  it('holds its address', async () => {
    await run('@bound',
      { output: { id: '1', op: '@get', to: 'Svc s' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'Svc s' } },
      { output: { id: 'x', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('reaches the sub-services under it', async () => {
    await run('@boundNested',
      { output: { id: '1', op: '@ping', to: 'Svc s inner' } },
      { input: { id: '1', re: [8], ty: ['Integer'], from: 'Svc s inner' } },
      { output: { id: 'x', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('a call through a sub-service is checked against the document', () => {
  const compile = (body) => compileSource(`${header}@go = {\n${body}\n  return 1\n}\n`, { remotes });

  it('an unknown sub-service', () => {
    expect(() => compile('  Svc.nope.get()')).toThrow(/'Svc' has no sub-service 'nope'/);
  });

  it('an unknown member of a sub-service', () => {
    expect(() => compile('  Svc.s.nope()')).toThrow(/'Svc.s' has no function 'nope'/);
    expect(() => compile('  Svc.s.inner.nope()')).toThrow(/'Svc.s.inner' has no function 'nope'/);
  });

  it('an unknown member through a bound local', () => {
    expect(() => compile('  x = Svc.s\n  x.nope()')).toThrow(/'Svc.s' has no function 'nope'/);
  });

  it('an arity mismatch', () => {
    expect(() => compile('  Svc.s.get(1)')).toThrow(/'Svc.s.get\(\)' arguments don't match any signature/);
  });

  it('a type mismatch', () => {
    expect(() => compile('  Svc.s.add("a", by: 3)')).toThrow(/'Svc.s.add\(\)' arguments don't match any signature: .*positional arg 1: expected Integer, got Text/);
  });

  it('the result has the type the document gives', () => {
    expect(() => compile('  v Integer = Svc.s.inner.ping()')).not.toThrow();
    expect(() => compile('  v Text = Svc.s.inner.ping()')).toThrow(/Integer/);
    expect(() => compile('  v Text = Svc.s.get()')).toThrow(/Integer/);
  });
});

// In a class, a call on a dependency is made by the file actor; one through a
// sub-service is too.
describe('a call through a sub-service from a class', () => {
  const classScript = `${header}
@Box = (seed Integer) *{
  @get = {
    v Integer = Svc.s.get()
    return v + seed
  }
}
`;

  it('goes to the sub-service\'s address', async () => {
    const actor = await createActor(classScript, { compileOptions: { remotes } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: [[10], '#new'], ty: [['Integer']], to: '. Box', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: '#<. Box 1>' }) },
      { input: { id: '2', op: '@get', to: '. Box 1', from: 'c' } },
      { output: expect.objectContaining({ op: '@get', to: 'Svc s' }) },
    );
  });
});

describe('what a call through a sub-service does to its caller', () => {
  const compile = (source) => compileSource(source, { remotes });

  it('a write through one is named for its path', () => {
    expect(() => compile(`${header}@go = {\n  Svc.s.note...\n  return 1\n}\n`)).toThrow(/'@go' writes \(Svc\.s\.note\.\(…\)\)/);
  });
});

// An actor of a class in the document has its own sub-services (`__types.Box.services`):
// `b.tally.get()` is `@get` to `<b's address> @tally`.
describe('a call through a sub-service of a class\'s actor', () => {
  const instScript = `${header}
box = Svc.Box(5)

@local = {
  b = Svc.Box(1)
  v Integer = b.tally.get()
  return v
}

@cell = {
  v Integer = box.tally.get()
  return v
}
`;

  it('in a local, goes under the actor\'s address', async () => {
    const actor = await createActor(instScript, {
      compileOptions: { remotes },
      expects: [
        { output: expect.objectContaining({ op: [[5], '#new'], to: 'Svc Box' }) },
        { input: { id: '1', re: '#<Svc Box 1>', ty: 'Svc Box', from: 'Svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@local', from: 'c' } },
      { output: expect.objectContaining({ op: [[1], '#new'], to: 'Svc Box' }) },
      { input: { id: '2', re: '#<Svc Box 2>', ty: 'Svc Box', from: 'Svc' } },
      { output: { id: '3', op: '@get', to: 'Svc Box 2 tally' } },
      { input: { id: '3', re: [4], ty: ['Integer'], from: 'Svc Box 2 tally' } },
      { output: { id: 'x', re: [4], ty: ['Integer'], to: 'c' } },
    );
  });

  it('in a cell, goes under the actor\'s address', async () => {
    const actor = await createActor(instScript, {
      compileOptions: { remotes },
      expects: [
        { output: expect.objectContaining({ op: [[5], '#new'], to: 'Svc Box' }) },
        { input: { id: '1', re: '#<Svc Box 1>', ty: 'Svc Box', from: 'Svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: '@cell', from: 'c' } },
      { output: { id: '2', op: '@get', to: 'Svc Box 1 tally' } },
      { input: { id: '2', re: [6], ty: ['Integer'], from: 'Svc Box 1 tally' } },
      { output: { id: 'x', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });

  it('is checked against the class\'s sub-services', () => {
    const compile = (body) => compileSource(`${header}@go = {\n  b = Svc.Box(1)\n${body}\n  return 1\n}\n`, { remotes });
    expect(() => compile('  b.nope.get()')).toThrow(/'b' has no sub-service 'nope'/);
    expect(() => compile('  b.tally.nope()')).toThrow(/'b.tally' has no function 'nope'/);
    expect(() => compile('  v Text = b.tally.get()')).toThrow(/Integer/);
  });
});
