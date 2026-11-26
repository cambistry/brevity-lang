import { createActor, expectActorBehavior, runActors } from '../helpers.js';
import { extract } from '../../index.js';

// A parent class in another file with a class block of its own (`T = (…) *{ … } ^ { … }`).
// The child class has a class block too, empty if it writes none, whose base is the
// parent's block: its `$extend` there speaks for the class, carrying the `instance`
// section, and the parent class builds a layer only for an actor under a block it
// recorded. Each file is tested alone, the other's side played by the test, then the
// two together. See notes/opre-extend-and-as-2026-11-20.md ("Instance layers", "A
// subclass's class block always has a base").

const DOC = {
  ':T': {
    public: {
      $new: [{ args: [{ n: 'Integer' }], re: [':T'], writes: false }],
      all: [{ re: ['Integer'], writes: false }],
    },
    protected: {
      '~total': [{ re: ['Integer'], writes: false }],
      '~step': [{ re: ['Integer'], writes: false }],
    },
    ':~total': {
      public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
    },
    instance: {
      public: { n: [{ re: ['Integer'], writes: false }], get: [{ re: ['Integer'], writes: false }] },
      protected: {
        '~count': [{ re: ['Integer'], writes: false }],
        '~step': [{ re: ['Integer'], writes: false }],
      },
      ':~count': {
        public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
      },
    },
  },
};

const child = `
  use :T = "svc"
  @U = T ^ (k Integer) *{
    super(n: k)
    step = -> 10
  }
  @get = { u = @U(5); x Integer = u.get(); return x }
  @all = { x Integer = @U.all(); return x }
`;

describe('the child of a parent class with a block, in another file', () => {
  it("registers its block, which speaks for the class; its layer and its block's calls run there", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc:T' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'get', from: 'c' } },
      { output: { id: '2', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':U:1', to: 'svc:T', from: ':U:1' } },
      { input: { id: '2', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':U:1', from: 'svc' } },
      { output: { id: '3', op: 'get', as: ':U:1', to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '1', op: '~step', as: ':U:1', to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '3', re: [15], ty: ['Integer'], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [15], ty: ['Integer'], to: 'c' } },
      { input: { id: 'y', op: 'all', from: 'c' } },
      { output: { id: '4', op: 'all', as: ':U', to: 'svc:T', from: ':U' } },
      { input: { id: '4', re: [31], ty: ['Integer'], to: ':U', from: 'svc:T' } },
      { output: { id: 'y', re: [31], ty: ['Integer'], to: 'c' } },
    );
  });
});

const parent = `
  @T = (@n: Integer) *{
    count *Integer = n
    step = -> 1
    @get = { x Integer = count + step(); return x }
  } ^ {
    total *Integer = 3
    @all = { x Integer = total * 10 + step(); return x }
    step = -> 1
  }
`;

describe('the parent class with a block, extended from another file', () => {
  it("its block records the extender and its section; a layer for an actor under it resolves through that", async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: '1', op: [[{ block: [], instance: ['~step'] }], '$extend'], to: ':T', from: 'main:U' } },
      { output: { id: '1', re: [], to: 'main:U', from: ':T' } },
      { input: { id: '2', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:U:1', to: ':T', from: 'main:U:1' } },
      { output: { id: '2', re: ['#<:T:1>'], ty: [':T'], to: 'main:U:1' } },
      { input: { id: '3', op: 'get', as: 'main:U:1', to: ':T:1', from: 'main:U:1' } },
      { output: { id: '1', op: '~step', as: 'main:U:1', to: 'main:U:1', from: ':T:1' } },
      { input: { id: '1', re: [10], ty: ['Integer'], to: ':T:1', from: 'main:U:1' } },
      { output: { id: '3', re: [15], ty: ['Integer'], to: 'main:U:1', from: ':T:1' } },
      { input: { id: '4', op: 'all', as: 'main:U', to: ':T', from: 'main:U' } },
      { output: { id: '4', re: [31], ty: ['Integer'], to: 'main:U', from: ':T' } },
    );
  });

  it('refuses a layer for an actor under no recorded block, and a section naming what its instances lack', async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: '1', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:U:1', to: ':T', from: 'main:U:1' } },
      { output: { id: '1', ex: { $new: 'unknown_context' }, to: 'main:U:1' } },
      { input: { id: '2', op: [[{ block: [], instance: ['~nope'] }], '$extend'], to: ':T', from: 'main:U' } },
      { output: { id: '2', ex: { $extend: 'unknown_name' }, to: 'main:U', from: ':T' } },
    );
  });
});

describe('the two files together', () => {
  it("the parent's code at the child's layer, and the parent block's for the child's block", async () => {
    const net = await runActors({
      svc: { source: parent },
      main: { source: child, compileOptions: { remotes: [{ path: 'svc', service: extract(parent).interface.service }] } },
    });
    await net.send('main', { id: 'x', op: 'get', from: 'c' });
    await net.send('main', { id: 'y', op: 'all', from: 'c' });
    expect(net.external).toEqual([
      { id: 'x', re: [15], ty: ['Integer'], to: 'c' },
      { id: 'y', re: [31], ty: ['Integer'], to: 'c' },
    ]);
  });
});
