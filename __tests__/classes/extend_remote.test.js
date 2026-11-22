import { createActor, expectActorBehavior, runActors } from '../helpers.js';
import { extract } from '../../index.js';

// A class block whose parent block is in another file (`V = T ^ { … }`, `T` from
// `use`). Each file is tested alone, the other's side played by the test: the child
// compiles against the parent's published extension doc, registers with `$extend`,
// delegates with `as`, and answers the parent's callbacks; the parent records its
// extenders and runs its code for them, calling back for their overrides. One test runs
// the two together. See notes/opre-extend-and-as-2026-11-20.md and
// notes/remote-superclass-2026-11-16.md.

const DOC = `{
  T () -> *{} ^ {
    connect () -> (Integer)
    bump! () => self
    read () -> (Integer)
    ~timeout *Integer
    ~h () -> (Integer)
  }
}`;

// The same, as a JSON document (notes/opre-type-encoding-2026-11-21.md).
const DOC_JSON = {
  ':T': {
    public: {
      $new: [{ re: [':T:*'], writes: false }],
      connect: [{ re: ['Integer'], writes: false }],
      'bump!': [{ re: [{ '%self': true }], writes: true }],
      read: [{ re: ['Integer'], writes: false }],
    },
    protected: {
      '~timeout': [{ re: ['Integer'], writes: false }],
      '~h': [{ re: ['Integer'], writes: false }],
    },
    ':~timeout': {
      public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
    },
    ':*': {},
  },
};

// Each case runs against the doc text and the JSON document.
const FORMS = [['doc text', DOC, 'service'], ['JSON document', DOC_JSON, 'document']];

const child = `
  use :T = "svc"
  @V = T ^ {
    h = -> 2
    @viaBase = { x Integer = base::h() * 100 + h(); return x }
    @asParent = { x Integer = T.connect(); return x }
  }
  @W = @V ^ {
    timeout *Integer = 5
  }
  @X = @W ^ {
    h = -> 3
    @read = { x Integer = super() + 1000; return x }
  }
`;

describe.each(FORMS)('with the %s', (_, doc) => {
  describe('the child of a parent block in another file', () => {
    it('registers its block, and each block extending it, as it is built', async () => {
      await createActor(child, {
        compileOptions: { remotes: [{ path: 'svc', service: doc }] },
        expects: [
          { output: { id: '1', op: [[{ block: ['~h'] }], '$extend'], to: 'svc:T', from: ':V' } },
          { input: { id: '1', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '2', op: [[{ block: ['~h', '~timeout'] }], '$extend'], as: ':W', to: 'svc:T', from: ':V' } },
          { input: { id: '2', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '3', op: [[{ block: ['~h', '~timeout', 'read'] }], '$extend'], as: ':X', to: 'svc:T', from: ':V' } },
          { input: { id: '3', re: [], to: ':V', from: 'svc:T' } },
        ],
      });
    });

    it('delegates a name it inherits, and answers the callbacks for its overrides', async () => {
      const actor = await createActor(child, {
        compileOptions: { remotes: [{ path: 'svc', service: doc }] },
        expects: [
          { output: { id: '1', op: [[{ block: ['~h'] }], '$extend'], to: 'svc:T', from: ':V' } },
          { input: { id: '1', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '2', op: [[{ block: ['~h', '~timeout'] }], '$extend'], as: ':W', to: 'svc:T', from: ':V' } },
          { input: { id: '2', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '3', op: [[{ block: ['~h', '~timeout', 'read'] }], '$extend'], as: ':X', to: 'svc:T', from: ':V' } },
          { input: { id: '3', re: [], to: ':V', from: 'svc:T' } },
        ],
      });
      await expectActorBehavior(actor,
        { input: { id: 'x', op: 'connect', to: ':V', from: 'c' } },
        { output: { id: '4', op: 'connect', as: ':V', to: 'svc:T', from: ':V' } },
        { input: { id: '1', op: '~h', as: ':V', to: ':V', from: 'svc:T' } },
        { output: { id: '1', re: [2], ty: ['Integer'], to: 'svc:T', from: ':V' } },
        { input: { id: '4', re: [302], ty: ['Integer'], to: ':V', from: 'svc:T' } },
        { output: { id: 'x', re: [302], ty: ['Integer'], to: 'c', from: ':V' } },
        // Two levels down: the cell is the lower block's, the override the middle's.
        { input: { id: 'y', op: 'connect', to: ':W', from: 'c' } },
        { output: { id: '5', op: 'connect', as: ':W', to: 'svc:T', from: ':V' } },
        { input: { id: '2', op: '$get', as: ':W', to: ':V:~timeout', from: 'svc:T' } },
        { output: { id: '2', re: [5], to: 'svc:T', from: ':V' } },
        { input: { id: '3', op: '~h', as: ':W', to: ':V', from: 'svc:T' } },
        { output: { id: '3', re: [2], ty: ['Integer'], to: 'svc:T', from: ':V' } },
        { input: { id: '5', re: [52], ty: ['Integer'], to: ':V', from: 'svc:T' } },
        { output: { id: 'y', re: [52], ty: ['Integer'], to: 'c', from: ':W' } },
        // Three levels, an override at each.
        { input: { id: 'z', op: 'connect', to: ':X', from: 'c' } },
        { output: { id: '6', op: 'connect', as: ':X', to: 'svc:T', from: ':V' } },
        { input: { id: '4', op: '$get', as: ':X', to: ':V:~timeout', from: 'svc:T' } },
        { output: { id: '4', re: [5], to: 'svc:T', from: ':V' } },
        { input: { id: '5', op: '~h', as: ':X', to: ':V', from: 'svc:T' } },
        { output: { id: '5', re: [3], ty: ['Integer'], to: 'svc:T', from: ':V' } },
        { input: { id: '6', re: [53], ty: ['Integer'], to: ':V', from: 'svc:T' } },
        { output: { id: 'z', re: [53], ty: ['Integer'], to: 'c', from: ':X' } },
      );
    });

    it("base:: and super are delegated calls of the parent's own; T.f() is a plain call", async () => {
      const actor = await createActor(child, {
        compileOptions: { remotes: [{ path: 'svc', service: doc }] },
        expects: [
          { output: { id: '1', op: [[{ block: ['~h'] }], '$extend'], to: 'svc:T', from: ':V' } },
          { input: { id: '1', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '2', op: [[{ block: ['~h', '~timeout'] }], '$extend'], as: ':W', to: 'svc:T', from: ':V' } },
          { input: { id: '2', re: [], to: ':V', from: 'svc:T' } },
          { output: { id: '3', op: [[{ block: ['~h', '~timeout', 'read'] }], '$extend'], as: ':X', to: 'svc:T', from: ':V' } },
          { input: { id: '3', re: [], to: ':V', from: 'svc:T' } },
        ],
      });
      await expectActorBehavior(actor,
        { input: { id: 'z', op: 'viaBase', to: ':V', from: 'c' } },
        { output: { id: '4', op: '~h', as: ':V', to: 'svc:T', from: ':V' } },
        { input: { id: '4', re: [1], ty: ['Integer'], to: ':V', from: 'svc:T' } },
        { output: { id: 'z', re: [102], ty: ['Integer'], to: 'c', from: ':V' } },
        { input: { id: 's', op: 'read', to: ':X', from: 'c' } },
        { output: { id: '5', op: 'read', as: ':X', to: 'svc:T', from: ':V' } },
        { input: { id: '1', op: '$get', as: ':X', to: ':V:~timeout', from: 'svc:T' } },
        { output: { id: '1', re: [5], to: 'svc:T', from: ':V' } },
        { input: { id: '5', re: [5], ty: ['Integer'], to: ':V', from: 'svc:T' } },
        { output: { id: 's', re: [1005], ty: ['Integer'], to: 'c', from: ':X' } },
        { input: { id: 'w', op: 'asParent', to: ':V', from: 'c' } },
        { output: { id: '6', op: 'connect', to: 'svc:T' } },
        { input: { id: '6', re: [301], ty: ['Integer'], from: 'svc:T' } },
        { output: { id: 'w', re: [301], ty: ['Integer'], to: 'c', from: ':V' } },
      );
    });

    it('a parent whose doc is newer than the one it compiled against fails its build at $extend', async () => {
      const actor = await createActor(child, {
        compileOptions: { remotes: [{ path: 'svc', service: doc }] },
        expects: [
          { output: { id: '1', op: [[{ block: ['~h'] }], '$extend'], to: 'svc:T', from: ':V' } },
          { input: { id: '1', ex: { $extend: 'unknown_name' }, to: ':V', from: 'svc:T' } },
        ],
      });
      await expect(actor.sendAsync({ id: 'x', op: 'connect', to: ':V', from: 'c' })).rejects.toThrow();
    });
  });
});

const parent = `
  @T = *{} ^ {
    timeout *Integer = 30
    h = -> 1
    @connect = { x Integer = timeout * 10 + h(); return x }
    @bump! = { timeout <- timeout + 1 }
    @read = { x Integer = timeout; return x }
  }
`;

describe('the parent block, extended from another file', () => {
  it('runs its code for an extender, calling back for its override', async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: 'e1', op: [[{ block: ['~h'] }], '$extend'], to: ':T', from: 'main:V' } },
      { output: { id: 'e1', re: [], to: 'main:V', from: ':T' } },
      { input: { id: 'c1', op: 'connect', as: 'main:V', to: ':T', from: 'main:V' } },
      { output: { id: '1', op: '~h', as: 'main:V', to: 'main:V', from: ':T' } },
      { input: { id: '1', re: [2], ty: ['Integer'], to: ':T', from: 'main:V' } },
      { output: { id: 'c1', re: [302], ty: ['Integer'], to: 'main:V', from: ':T' } },
    );
  });

  it("an extender's extender: its redeclared cell, read and written there; its own unchanged", async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: 'e1', op: [[{ block: ['~h', '~timeout'] }], '$extend'], as: 'main:W', to: ':T', from: 'main:V' } },
      { output: { id: 'e1', re: [], to: 'main:V', from: ':T' } },
      { input: { id: 'c1', op: 'connect', as: 'main:W', to: ':T', from: 'main:V' } },
      { output: { id: '1', op: '$get', as: 'main:W', to: 'main:V:~timeout', from: ':T' } },
      { input: { id: '1', re: [5], to: ':T', from: 'main:V' } },
      { output: { id: '2', op: '~h', as: 'main:W', to: 'main:V', from: ':T' } },
      { input: { id: '2', re: [2], ty: ['Integer'], to: ':T', from: 'main:V' } },
      { output: { id: 'c1', re: [52], ty: ['Integer'], to: 'main:V', from: ':T' } },
      { input: { id: 'b1', op: 'bump!', as: 'main:W', to: ':T', from: 'main:V' } },
      { output: { id: '3', op: '$get', as: 'main:W', to: 'main:V:~timeout', from: ':T' } },
      { input: { id: '3', re: [5], to: ':T', from: 'main:V' } },
      { output: { id: '4', op: [[6], '$set'], as: 'main:W', to: 'main:V:~timeout', from: ':T' } },
      { output: { id: 'b1', re: ['#<:T>'], ty: ['*'], to: 'main:V', from: ':T' } },
      { input: { id: 'r1', op: 'read', to: ':T', from: 'c' } },
      { output: { id: 'r1', re: [30], ty: ['Integer'], to: 'c', from: ':T' } },
    );
  });

  it('a delegated call from an actor that never extended fails, as does a table naming what it lacks', async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: 'u1', op: 'connect', as: 'c', to: ':T', from: 'c' } },
      { output: { id: 'u1', ex: { connect: 'unknown_context' }, to: 'c', from: ':T' } },
      { input: { id: 'u2', op: [[{ block: ['~nope'] }], '$extend'], to: ':T', from: 'c' } },
      { output: { id: 'u2', ex: { $extend: 'unknown_name' }, to: 'c', from: ':T' } },
    );
  });
});

describe.each(FORMS)('with the %s', (_, _doc, key) => {
  describe('the two files together', () => {
    it("the parent's code, run for the child three levels down", async () => {
      const net = await runActors({
        svc: { source: parent },
        main: { source: child, compileOptions: { remotes: [{ path: 'svc', service: extract(parent).interface[key] }] } },
      });
      await net.send('main', { id: 'z', op: 'connect', to: ':X', from: 'c' });
      expect(net.external).toEqual([{ id: 'z', re: [53], ty: ['Integer'], to: 'c', from: ':X' }]);
    });
  });
});
