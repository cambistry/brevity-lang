import { expectBehavior, expectActorBehavior, createActor, compileSource } from '../helpers.js';
import { extract } from '../../index.js';

// A type belongs to the actor whose constructor block declares it. Inside that
// actor it is bare; elsewhere it is reached through `::` on the actor or its
// class. Its tag names the class path after the authority: `. W X`.
// See notes/type-keyword-and-actor-scoped-types-2026-11-13.md.

describe('a type declared in a class', () => {
  const script = `
    W = *{
      type X (n Integer)
      @make = -> X(1)
    }
    S = **{
      type Widget (a Text, b Text)
    }
    A = *{
      B = *{
        type Y (n Integer)
      }
    }
    @byClass = -> result: W::X(2)
    @byActor = {
      w = W()
      return result: w::X(3)
    }
    @bySingleton = -> result: S::Widget("a", "b")
    @nested = -> result: A::B::Y(4)
    @inside = {
      w = W()
      p W::X = w.make()
      return result: p.n as Integer
    }
    @read = (p: W::X) -> result: p.n as Integer
  `;

  it('is constructed through its class, and tagged with the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'byClass', from: 'c' } },
      { output: { id: '1', ty: { result: '. W X' }, re: { result: [2] }, to: 'c' } },
    );
  });

  it('is constructed through an actor of the class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'byActor', from: 'c' } },
      { output: { id: '1', ty: { result: '. W X' }, re: { result: [3] }, to: 'c' } },
    );
  });

  it('is constructed through a singleton', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bySingleton', from: 'c' } },
      { output: { id: '1', ty: { result: '. S Widget' }, re: { result: ['a', 'b'] }, to: 'c' } },
    );
  });

  it('is reached through nested classes', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'nested', from: 'c' } },
      { output: { id: '1', ty: { result: '. A B Y' }, re: { result: [4] }, to: 'c' } },
    );
  });

  it('is bare inside the class, and comes back to the file as the class\'s type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'inside', from: 'c' } },
      { output: { id: '1', re: { result: 1 }, ty: { result: 'Integer' }, to: 'c' } },
    );
  });

  it('decodes a param annotated with the class\'s type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ p: [5] }, 'read'], ty: [{ p: '. W X' }], from: 'c' } },
      { output: { id: '1', re: { result: 5 }, ty: { result: 'Integer' }, to: 'c' } },
    );
  });

  it('goes in the class\'s entry in the service document', () => {
    const { interface: iface } = extract(`
      type P (x Integer)
      @W = *{
        type X (n Integer)
        @get = -> X(1)
      }
      @S = **{
        type Widget (a Text, b Text)
      }
      Q = *{
        type Hidden (n Integer)
      }
    `);
    expect(iface.service).toBe(`{
  type P (x Integer)
  S {
    type Widget (a Text, b Text)
  }
  W () -> *{
    type X (n Integer)
    get () -> (X)
  }
}`);
  });
});

describe('a type of another file, reached through the service', () => {
  const DOC = '{\n  type Point (x Integer, y Integer)\n  W () -> *{\n    type X (n Integer)\n    get () -> (X)\n  }\n}';
  const remotes = [{ path: 'svc.bv', service: DOC }];
  const script = `
    *
      "svc.bv": Svc
    *
    @point = -> result: Svc::Point(1, 2)
    @classType = -> result: Svc::W::X(4)
    @got = {
      w = Svc.W()
      p w::X = w.get()
      return result: p.n as Integer
    }
  `;
  const compileOptions = { remotes };

  it('is constructed without importing it', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'point', from: 'c' } },
      { output: { id: '1', ty: { result: 'svc.bv Point' }, re: { result: [1, 2] }, to: 'c' } },
    );
  });

  it('declared in one of its classes, is tagged with that class', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'classType', from: 'c' } },
      { output: { id: '1', ty: { result: 'svc.bv W X' }, re: { result: [4] }, to: 'c' } },
    );
  });

  it('is decoded from a reply, reached through the actor', async () => {
    const actor = await createActor(script, { compileOptions });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'got', from: 'c' } },
      { output: expect.objectContaining({ op: [[], '$new'], to: 'Svc W' }) },
      { input: { id: '1', re: '#<Svc W 1>', ty: 'Svc W', from: 'Svc' } },
      { output: expect.objectContaining({ op: 'get', to: 'Svc W 1' }) },
      { input: { id: '2', re: [[7]], ty: ['Svc W X'], from: 'Svc W 1' } },
      { output: { id: 'x', re: { result: 7 }, ty: { result: 'Integer' }, to: 'c' } },
    );
  });
});

describe('reaching a type: errors', () => {
  const W = 'W = *{\n  type X (n Integer)\n  @get = -> 1\n}\n';

  it('a type and a class of the same name in one actor', () => {
    expect(() => compileSource('type Box (n Integer)\n@Box = *{}\n@go = -> 1\n')).toThrow(/^'Box' is declared as both a type and a class$/);
  });

  it('a class\'s type, bare outside the class', () => {
    expect(() => compileSource(`${W}@go = -> X(1)\n`)).toThrow(/^'X' is a type of 'W' — reach it as 'W::X'$/);
  });

  it('a type reached with a dot', () => {
    expect(() => compileSource(`${W}@go = {\n  w = W()\n  return w.X(1)\n}\n`)).toThrow(/^'X' is a type, not a message — 'w::X'$/);
  });

  it('a type annotation with a dot', () => {
    expect(() => compileSource(`${W}@go = (p W.X) -> 1\n`)).toThrow(/^Unexpected '\.' in type 'W\.X'$/);
  });

  it('a type as a value', () => {
    expect(() => compileSource(`${W}@go = {\n  t = W::X\n  return 1\n}\n`)).toThrow(/^'W::X' is a type, not a value$/);
  });

  it('an actor whose class is not known', () => {
    expect(() => compileSource(`${W}f = (a) {\n  return a::X(1)\n}\n@go = -> f(1)\n`)).toThrow(/^Can't tell the class of 'a' in 'a::X'$/);
  });

  it('a class without that type', () => {
    expect(() => compileSource(`${W}@go = -> W::Nope(1)\n`)).toThrow(/^'W' has no type 'Nope'$/);
  });

  it('two types of one name in a file, in different classes', () => {
    expect(() => compileSource(`${W}V = *{\n  type X (n Integer)\n}\n@go = -> 1\n`)).toThrow(/Duplicate type declaration: 'X'/);
  });

  it('`::Name (…)` in a class body', () => {
    expect(() => compileSource('W = *{\n  ::X (n Integer)\n}\n')).toThrow(/^Unexpected '::'$/);
  });
});
