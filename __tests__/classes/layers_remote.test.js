import { compileSource, createActor, expectActorBehavior, runActors } from '../helpers.js';
import { extract } from '../../index.js';

// Instance layers with a parent in another file (`U = T ^ *(…) { super(…) … }`, `T`
// from `use`). Each file is tested alone, the other's side played by the test:
// - the child's class registers with the parent class as the file starts (`$extend`,
//   its `instance` section); `super(args)` sends `$new` there, `as` the instance,
//   which builds the instance's layer; a name the instance doesn't define, `super` and
//   `base::` are delegated calls to the layer; the layer's late-bound names come back
//   to the instance as callbacks; inherited cells are `~` ops at the layer;
// - the parent class records its extender classes, builds a layer for an actor under
//   one, runs its code there in that actor's context, and answers only that actor.
// One test runs the two together. See notes/opre-extend-and-as-2026-11-20.md
// ("Instance layers").

const DOC = {
  ':G': {
    public: { $new: [{ re: [':G'], writes: false }] },
    instance: { protected: { '~g': [{ re: ['Integer'], writes: false }] } },
  },
  ':T': {
    extends: [':G'],
    public: { $new: [{ args: [{ n: 'Integer' }], re: [':T'], writes: false }] },
    instance: {
      public: {
        n: [{ re: ['Integer'], writes: false }],
        get: [{ re: ['Integer'], writes: false }],
        gee: [{ re: ['Integer'], writes: false }],
        'bump!': [{ re: [':*'], writes: true }],
      },
      protected: {
        '~count': [{ re: ['Integer'], writes: false }],
        '~g': [{ re: ['Integer'], writes: false }],
        '~step': [{ re: ['Integer'], writes: false }],
      },
      ':~count': {
        public: { $get: [{ re: ['Integer'], writes: false }], $set: [{ args: ['Integer'], writes: true }] },
      },
    },
  },
  ':A': {
    public: { $new: [{ args: ['Integer'], re: [':A'], writes: false }] },
    instance: {
      public: { ha: [{ re: ['Integer'], writes: false }] },
      protected: { '~h': [{ re: ['Anything'], writes: false }] },
    },
  },
  ':B': {
    public: { $new: [{ args: ['Integer'], re: [':B'], writes: false }] },
    instance: { public: { hb: [{ re: ['Integer'], writes: false }] } },
  },
};

const child = `
  use :T = "svc"
  use :A = "svc"
  use :B = "svc"
  @U = T ^ *(k Integer) {
    super(n: k * 2)
    step = () -> 10
    g = () -> 7
    @cnt = () -> count
    @poke! = { count <- count + 1 }
  }
  @Bare = T ^ *(n: Integer) {
    super
  }
  @R = T ^ *(k Integer) {
    count *Integer = 100
    super(n: k)
    step = { x Integer = super() + 5; return x }
    @viaBase = { x Integer = base::step() * 100; return x }
  }
  @AB = A ^ B ^ *(k Integer) {
    super[A](k)
    super[B](k + 1)
    h = () -> 9
  }
  @get = { u = @U(5); x Integer = u.get(); return x }
  @cells = { u = @U(5); u.poke!(); u.bump!(); a Integer = u.cnt(); b Integer = u.get(); return a * 100 + b }
  @levels = { u = @U(5); x Integer = u.gee(); return x }
  @param = { u = @U(5); x Integer = u.n(); return x }
  @bare = { u = @Bare(n: 5); x Integer = u.get(); return x }
  @redeclared = { u = @R(5); x Integer = u.get(); return x }
  @viaBase = { u = @R(5); x Integer = u.viaBase(); return x }
  @parents = { u = @AB(3); a Integer = u.ha(); b Integer = u.hb(); return a * 100 + b }
`;

describe('the child of a parent class in another file', () => {
  it('registers each class with its parent class there as the file starts', async () => {
    await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
  });

  it("super(args) builds its layer there; a call it inherits runs at the layer, calling back for its override", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'get', from: 'c' } },
      { output: { id: '6', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':U:1', to: 'svc:T', from: ':U:1' } },
      { input: { id: '6', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':U:1', from: 'svc' } },
      { output: { id: '7', op: 'get', as: ':U:1', to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '1', op: '~step', as: ':U:1', to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '7', re: [20], ty: ['Integer'], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [20], ty: ['Integer'], to: 'c' } },
    );
  });

  it("a cell it inherits is read and written at the layer; the parent's code there writes it too", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'cells', from: 'c' } },
      { output: { id: '6', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':U:1', to: 'svc:T', from: ':U:1' } },
      { input: { id: '6', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':U:1', from: 'svc' } },
      { output: { id: '7', op: '$get', to: 'svc:T:1:~count', from: ':U:1' } },
      { input: { id: '7', re: [10], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '8', op: [[11], '$set'], ty: [['Anything']], to: 'svc:T:1:~count', from: ':U:1' } },
      { output: { id: '9', op: 'bump!', as: ':U:1', to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '9', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '10', op: '$get', to: 'svc:T:1:~count', from: ':U:1' } },
      { input: { id: '10', re: [12], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '11', op: 'get', as: ':U:1', to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '1', op: '~step', as: ':U:1', to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '11', re: [22], ty: ['Integer'], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [1222], ty: ['Integer'], to: 'c' } },
    );
  });

  it("an override of the parent's own parent's, and a published param, answered at the layer", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'levels', from: 'c' } },
      { output: { id: '6', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':U:1', to: 'svc:T', from: ':U:1' } },
      { input: { id: '6', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':U:1', from: 'svc' } },
      { output: { id: '7', op: 'gee', as: ':U:1', to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '1', op: '~g', as: ':U:1', to: ':U:1', from: 'svc:T:1' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'svc:T:1', from: ':U:1' } },
      { input: { id: '7', re: [7], ty: ['Integer'], to: ':U:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [7], ty: ['Integer'], to: 'c' } },
      { input: { id: 'y', op: 'param', from: 'c' } },
      { output: { id: '8', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':U:2', to: 'svc:T', from: ':U:2' } },
      { input: { id: '8', re: ['#<svc:T:2>'], ty: ['svc:T'], to: ':U:2', from: 'svc' } },
      { output: { id: '9', op: 'n', as: ':U:2', to: 'svc:T:2', from: ':U:2' } },
      { input: { id: '9', re: [10], to: ':U:2', from: 'svc:T:2' } },
      { output: { id: 'y', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });

  it('bare super forwards its own args', async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'bare', from: 'c' } },
      { output: { id: '6', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':Bare:1', to: 'svc:T', from: ':Bare:1' } },
      { input: { id: '6', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':Bare:1', from: 'svc' } },
      { output: { id: '7', op: 'get', as: ':Bare:1', to: 'svc:T:1', from: ':Bare:1' } },
      { input: { id: '7', re: [6], ty: ['Integer'], to: ':Bare:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });

  it("a redeclared cell is the instance's, read by the layer's callback; super and base:: run the parent's", async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'redeclared', from: 'c' } },
      { output: { id: '6', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':R:1', to: 'svc:T', from: ':R:1' } },
      { input: { id: '6', re: ['#<svc:T:1>'], ty: ['svc:T'], to: ':R:1', from: 'svc' } },
      { output: { id: '7', op: 'get', as: ':R:1', to: 'svc:T:1', from: ':R:1' } },
      { input: { id: '1', op: '$get', as: ':R:1', to: ':R:1:~count', from: 'svc:T:1' } },
      { output: { id: '1', re: [100], to: 'svc:T:1', from: ':R:1' } },
      { input: { id: '2', op: '~step', as: ':R:1', to: ':R:1', from: 'svc:T:1' } },
      { output: { id: '8', op: '~step', as: ':R:1', to: 'svc:T:1', from: ':R:1' } },
      { input: { id: '8', re: [1], ty: ['Integer'], to: ':R:1', from: 'svc:T:1' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'svc:T:1', from: ':R:1' } },
      { input: { id: '7', re: [106], ty: ['Integer'], to: ':R:1', from: 'svc:T:1' } },
      { output: { id: 'x', re: [106], ty: ['Integer'], to: 'c' } },
      { input: { id: 'y', op: 'viaBase', from: 'c' } },
      { output: { id: '9', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: ':R:2', to: 'svc:T', from: ':R:2' } },
      { input: { id: '9', re: ['#<svc:T:2>'], ty: ['svc:T'], to: ':R:2', from: 'svc' } },
      { output: { id: '10', op: '~step', as: ':R:2', to: 'svc:T:2', from: ':R:2' } },
      { input: { id: '10', re: [1], ty: ['Integer'], to: ':R:2', from: 'svc:T:2' } },
      { output: { id: 'y', re: [100], ty: ['Integer'], to: 'c' } },
    );
  });

  it('two parents, a layer each', async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', re: [], to: ':U', from: 'svc' } },
        { output: { id: '2', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:T', from: ':Bare' } },
        { input: { id: '2', re: [], to: ':Bare', from: 'svc' } },
        { output: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: 'svc:T', from: ':R' } },
        { input: { id: '3', re: [], to: ':R', from: 'svc' } },
        { output: { id: '4', op: [[{ block: [], instance: ['~h'] }], '$extend'], to: 'svc:A', from: ':AB' } },
        { input: { id: '4', re: [], to: ':AB', from: 'svc' } },
        { output: { id: '5', op: [[{ block: [], instance: [] }], '$extend'], to: 'svc:B', from: ':AB' } },
        { input: { id: '5', re: [], to: ':AB', from: 'svc' } },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: 'x', op: 'parents', from: 'c' } },
      { output: { id: '6', op: [[3], '$new'], ty: [['Integer']], as: ':AB:1', to: 'svc:A', from: ':AB:1' } },
      { input: { id: '6', re: ['#<svc:A:1>'], ty: ['svc:A'], to: ':AB:1', from: 'svc' } },
      { output: { id: '7', op: [[4], '$new'], ty: [['Integer']], as: ':AB:1', to: 'svc:B', from: ':AB:1' } },
      { input: { id: '7', re: ['#<svc:B:1>'], ty: ['svc:B'], to: ':AB:1', from: 'svc' } },
      { output: { id: '8', op: 'ha', as: ':AB:1', to: 'svc:A:1', from: ':AB:1' } },
      { input: { id: '1', op: '~h', as: ':AB:1', to: ':AB:1', from: 'svc:A:1' } },
      { output: { id: '1', re: [9], ty: ['Integer'], to: 'svc:A:1', from: ':AB:1' } },
      { input: { id: '8', re: [9], ty: ['Integer'], to: ':AB:1', from: 'svc:A:1' } },
      { output: { id: '9', op: 'hb', as: ':AB:1', to: 'svc:B:1', from: ':AB:1' } },
      { input: { id: '9', re: [40], ty: ['Integer'], to: ':AB:1', from: 'svc:B:1' } },
      { output: { id: 'x', re: [940], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a parent class that refuses the registration fails the build', async () => {
    const actor = await createActor(child, {
      compileOptions: { remotes: [{ path: 'svc', service: DOC }] },
      expects: [
        { output: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: 'svc:T', from: ':U' } },
        { input: { id: '1', ex: { $extend: 'unknown_name' }, to: ':U', from: 'svc' } },
      ],
    });
    await expect(actor.sendAsync({ id: 'x', op: 'get', from: 'c' })).rejects.toThrow();
  });
});

const parent = `
  @G = *{
    g = () -> 100
  }
  @T = @G ^ *(@n: Integer) {
    super()
    count *Integer = n
    step = () -> 1
    @get = { x Integer = count + step(); return x }
    @gee = { x Integer = g(); return x }
    @bump! = { count <- count + 1 }
  }
  @A = *(a Integer) {
    h = () -> a
    @ha = { x Integer = h(); return x }
  }
  @B = *(b Integer) {
    @hb = { x Integer = b * 10; return x }
  }
`;

describe('the parent class, extended from another file', () => {
  it("builds a layer for an actor under a recorded extender, and runs its code there in that actor's context", async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: '1', op: [[{ block: [], instance: ['~step', '~g'] }], '$extend'], to: ':T', from: 'main:U' } },
      { output: { id: '1', re: [], to: 'main:U' } },
      { input: { id: '6', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:U:1', to: ':T', from: 'main:U:1' } },
      { output: { id: '6', re: ['#<:T:1>'], ty: [':T'], to: 'main:U:1' } },
      { input: { id: '7', op: 'get', as: 'main:U:1', to: ':T:1', from: 'main:U:1' } },
      { output: { id: '1', op: '~step', as: 'main:U:1', to: 'main:U:1', from: ':T:1' } },
      { input: { id: '1', re: [10], ty: ['Integer'], to: ':T:1', from: 'main:U:1' } },
      { output: { id: '7', re: [20], ty: ['Integer'], to: 'main:U:1', from: ':T:1' } },
      // Its own parent's code, merged here, resolves through the same table.
      { input: { id: '8', op: 'gee', as: 'main:U:1', to: ':T:1', from: 'main:U:1' } },
      { output: { id: '2', op: '~g', as: 'main:U:1', to: 'main:U:1', from: ':T:1' } },
      { input: { id: '2', re: [7], ty: ['Integer'], to: ':T:1', from: 'main:U:1' } },
      { output: { id: '8', re: [7], ty: ['Integer'], to: 'main:U:1', from: ':T:1' } },
      { input: { id: '9', op: 'n', as: 'main:U:1', to: ':T:1', from: 'main:U:1' } },
      { output: { id: '9', re: [10], to: 'main:U:1', from: ':T:1' } },
      { input: { id: '10', op: '$get', to: ':T:1:~count', from: 'main:U:1' } },
      { output: { id: '10', re: [10], to: 'main:U:1', from: ':T:1' } },
      { input: { id: '11', op: [[11], '$set'], ty: [['Anything']], to: ':T:1:~count', from: 'main:U:1' } },
      { input: { id: '12', op: 'bump!', as: 'main:U:1', to: ':T:1', from: 'main:U:1' } },
      { output: { id: '12', re: ['#<:T:1>'], ty: [':T'], to: 'main:U:1', from: ':T:1' } },
      { input: { id: '13', op: '$get', to: ':T:1:~count', from: 'main:U:1' } },
      { output: { id: '13', re: [12], to: 'main:U:1', from: ':T:1' } },
    );
  });

  it("a cell the extender redeclares is read there; another actor under it gets its own layer", async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: '3', op: [[{ block: [], instance: ['~count', '~step'] }], '$extend'], to: ':T', from: 'main:R' } },
      { output: { id: '3', re: [], to: 'main:R' } },
      { input: { id: '6', op: [[{ n: 5 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:R:1', to: ':T', from: 'main:R:1' } },
      { output: { id: '6', re: ['#<:T:1>'], ty: [':T'], to: 'main:R:1' } },
      { input: { id: '7', op: 'get', as: 'main:R:1', to: ':T:1', from: 'main:R:1' } },
      { output: { id: '1', op: '$get', as: 'main:R:1', to: 'main:R:1:~count', from: ':T:1' } },
      { input: { id: '1', re: [100], to: ':T:1', from: 'main:R:1' } },
      { output: { id: '2', op: '~step', as: 'main:R:1', to: 'main:R:1', from: ':T:1' } },
      { input: { id: '2', re: [6], ty: ['Integer'], to: ':T:1', from: 'main:R:1' } },
      { output: { id: '7', re: [106], ty: ['Integer'], to: 'main:R:1', from: ':T:1' } },
      { input: { id: '8', op: [[{ n: 1 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:R:2', to: ':T', from: 'main:R:2' } },
      { output: { id: '8', re: ['#<:T:2>'], ty: [':T'], to: 'main:R:2' } },
      { input: { id: '9', op: [[3], '$new'], ty: [['Integer']], as: 'main:AB:1', to: ':A', from: 'main:AB:1' } },
      { output: { id: '9', ex: { $new: 'unknown_context' }, to: 'main:AB:1' } },
    );
  });

  it("refuses a table naming what its instances lack, and a layer is its builder's alone", async () => {
    const actor = await createActor(parent);
    await expectActorBehavior(actor,
      { input: { id: '1', op: [[{ block: [], instance: ['~nope'] }], '$extend'], to: ':T', from: 'main:U' } },
      { output: { id: '1', ex: { $extend: 'unknown_name' }, to: 'main:U' } },
      { input: { id: '2', op: [[{ block: [], instance: ['~step'] }], '$extend'], to: ':T', from: 'main:U' } },
      { output: { id: '2', re: [], to: 'main:U' } },
      { input: { id: '3', op: [[{ n: 10 }], '$new'], ty: [[{ n: 'Integer' }]], as: 'main:U:1', to: ':T', from: 'main:U:1' } },
      { output: { id: '3', re: ['#<:T:1>'], ty: [':T'], to: 'main:U:1' } },
      { input: { id: '4', op: 'get', to: ':T:1', from: 'c' } },
      { output: { id: '4', ex: { get: 'unhandled' }, to: 'c' } },
      { input: { id: '5', op: 'get', as: 'c', to: ':T:1', from: 'c' } },
      { output: { id: '5', ex: { get: 'unhandled' }, to: 'c' } },
      { input: { id: '6', op: '$get', to: ':T:1:~count', from: 'c' } },
      { output: { id: '6', ex: { $get: 'unhandled' }, to: 'c' } },
    );
  });
});

describe('the two files together', () => {
  it("the parent's code, run at the child's layer, with the child's override and the inherited cell", async () => {
    const net = await runActors({
      svc: { source: parent },
      main: { source: child, compileOptions: { remotes: [{ path: 'svc', service: extract(parent).interface.service }] } },
    });
    await net.send('main', { id: 'x', op: 'cells', from: 'c' });
    expect(net.external).toEqual([{ id: 'x', re: [1222], ty: ['Integer'], to: 'c' }]);
  });
});

describe('instance layers in another file — compile errors', () => {
  it('a diamond of instance layers', () => {
    expect(() => compileSource(`
      use :P = "lib"
      use :Q = "lib"
      R = P ^ Q ^ *{
        super[P]()
        super[Q]()
      }
      @go = () -> 1
    `, {
      remotes: [{ path: 'lib', service: {
        ':S': {
          public: { $new: [{ re: [':S'], writes: false }] },
          instance: { protected: { '~s': [{ re: ['Integer'], writes: false }] } },
        },
        ':P': {
          extends: [':S'],
          public: { $new: [{ re: [':P'], writes: false }] },
          instance: { protected: { '~s': [{ re: ['Integer'], writes: false }] } },
        },
        ':Q': {
          extends: [':S'],
          public: { $new: [{ re: [':Q'], writes: false }] },
          instance: { protected: { '~s': [{ re: ['Integer'], writes: false }] } },
        },
      } }],
    })).toThrow("'R' extends 'P' and 'Q', which both extend 'S': a diamond of instance layers isn't supported yet");
  });
});
