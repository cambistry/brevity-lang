import { expectLocalAndRemote } from '../helpers.js';

// A parent in another file behaves as one in the same file: each case runs both ways,
// the child's code the same in both. Class blocks (`V = K ^ { … }`) and instance
// layers (`U = T ^ *(…) { super(…) … }`): overrides, a redeclared cell, `super`,
// `base::`, a parent named explicitly, two parents, a parent class with a block. See
// notes/opre-extend-and-as-2026-11-20.md ("The semantics are layers, local parents
// included").

const parents = `
  K = *{} ^ {
    timeout *Integer = 30
    h = () -> 1
    @connect = { x Integer = timeout * 10 + h(); return x }
    @bump! = { timeout <- timeout + 1 }
    @read = { x Integer = timeout; return x }
  }
  G = *{
    g = () -> 100
  }
  T = G ^ *(@n: Integer) {
    super()
    count *Integer = n
    step = () -> 1
    @get = { x Integer = count + step(); return x }
    @gee = { x Integer = g(); return x }
    @bump! = { count <- count + 1 }
  }
  A = *(a Integer) {
    h = () -> a
    @ha = { x Integer = h(); return x }
  }
  B = *(b Integer) {
    @hb = { x Integer = b * 10; return x }
  }
  C = *(@n: Integer) {
    count *Integer = n
    step = () -> 1
    @get = { x Integer = count + step(); return x }
  } ^ {
    total *Integer = 3
    @all = { x Integer = total * 10 + step(); return x }
    step = () -> 1
  }
`;

const children = `
  @V = K ^ {
    h = () -> 2
    @viaBase = { x Integer = base::h() * 100 + h(); return x }
    @asParent = { x Integer = K.connect(); return x }
  }
  @W = @V ^ {
    timeout *Integer = 5
  }
  @X = @W ^ {
    h = () -> 3
    @read = { x Integer = super() + 1000; return x }
  }
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
  @Y = C ^ *(k Integer) {
    super(n: k)
    step = () -> 10
  }
  @AB = A ^ B ^ *(k Integer) {
    super[A](k)
    super[B](k + 1)
    h = () -> 9
  }
  @v = { x Integer = @V.connect(); return x }
  @w = { x Integer = @W.connect(); return x }
  @x = { x Integer = @X.connect(); return x }
  @blockBase = { x Integer = @V.viaBase(); return x }
  @blockSuper = { x Integer = @X.read(); return x }
  @asParent = { x Integer = @V.asParent(); return x }
  @bumpW! = { @W.bump!(); a Integer = @W.read(); return a }
  @get = { u = @U(5); x Integer = u.get(); return x }
  @cells = { u = @U(5); u.poke!(); u.bump!(); a Integer = u.cnt(); b Integer = u.get(); return a * 100 + b }
  @levels = { u = @U(5); x Integer = u.gee(); return x }
  @param = { u = @U(5); x Integer = u.n(); return x }
  @bare = { u = @Bare(n: 5); x Integer = u.get(); return x }
  @redeclared = { u = @R(5); x Integer = u.get(); return x }
  @layerBase = { u = @R(5); x Integer = u.viaBase(); return x }
  @yGet = { y = @Y(5); x Integer = y.get(); return x }
  @yAll = { x Integer = @Y.all(); return x }
  @parents = { u = @AB(3); a Integer = u.ha(); b Integer = u.hb(); return a * 100 + b }
`;

// The same two, the parents in another file.
const parent = `
  @K = *{} ^ {
    timeout *Integer = 30
    h = () -> 1
    @connect = { x Integer = timeout * 10 + h(); return x }
    @bump! = { timeout <- timeout + 1 }
    @read = { x Integer = timeout; return x }
  }
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
  @C = *(@n: Integer) {
    count *Integer = n
    step = () -> 1
    @get = { x Integer = count + step(); return x }
  } ^ {
    total *Integer = 3
    @all = { x Integer = total * 10 + step(); return x }
    step = () -> 1
  }
`;

const pair = {
  local: parents + children,
  parent,
  child: `
  use :K = "svc"
  use :T = "svc"
  use :A = "svc"
  use :B = "svc"
  use :C = "svc"
` + children,
};

describe('a parent here, and in another file', () => {
  it("class blocks: an inherited function runs with the child's override, at each level", async () => {
    await expectLocalAndRemote(pair,
      { input: { id: '1', op: 'v', from: 'c' } },
      { output: { id: '1', re: [302], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'w', from: 'c' } },
      { output: { id: '2', re: [52], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: 'x', from: 'c' } },
      { output: { id: '3', re: [53], ty: ['Integer'], to: 'c' } },
    );
  });

  it("class blocks: base::, super, the parent named explicitly, and the parent's code writing the child's cell", async () => {
    await expectLocalAndRemote(pair,
      { input: { id: '1', op: 'blockBase', from: 'c' } },
      { output: { id: '1', re: [102], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'blockSuper', from: 'c' } },
      { output: { id: '2', re: [1005], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: 'asParent', from: 'c' } },
      { output: { id: '3', re: [301], ty: ['Integer'], to: 'c' } },
      { input: { id: '4', op: 'bumpW!', from: 'c' } },
      { output: { id: '4', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });

  it("instance layers: the parent's code with the instance's override, its parent's parent's too, and inherited cells", async () => {
    await expectLocalAndRemote(pair,
      { input: { id: '1', op: 'get', from: 'c' } },
      { output: { id: '1', re: [20], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'cells', from: 'c' } },
      { output: { id: '2', re: [1222], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: 'levels', from: 'c' } },
      { output: { id: '3', re: [7], ty: ['Integer'], to: 'c' } },
      { input: { id: '4', op: 'param', from: 'c' } },
      { output: { id: '4', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });

  it('instance layers: bare super, a redeclared cell, super and base::, two parents', async () => {
    await expectLocalAndRemote(pair,
      { input: { id: '1', op: 'bare', from: 'c' } },
      { output: { id: '1', re: [6], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'redeclared', from: 'c' } },
      { output: { id: '2', re: [106], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: 'layerBase', from: 'c' } },
      { output: { id: '3', re: [100], ty: ['Integer'], to: 'c' } },
      { input: { id: '4', op: 'parents', from: 'c' } },
      { output: { id: '4', re: [940], ty: ['Integer'], to: 'c' } },
    );
  });

  it("a parent class with a block: the instance's layer, and the parent block's code for the child's block", async () => {
    await expectLocalAndRemote(pair,
      { input: { id: '1', op: 'yGet', from: 'c' } },
      { output: { id: '1', re: [15], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'yAll', from: 'c' } },
      { output: { id: '2', re: [31], ty: ['Integer'], to: 'c' } },
    );
  });
});
