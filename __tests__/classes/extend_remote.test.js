import { runActors } from '../helpers.js';
import { extract } from '../../index.js';

// A class block whose parent block is in another file (`B = A ^ { … }`, `A` from
// `use`): the child compiles against the parent's published extension doc, sends
// `$extend` across, and delegates to it as to a local parent. The parent is a separate
// actor here, run with the child in one network. See
// notes/opre-extend-and-as-2026-11-20.md and notes/remote-superclass-2026-11-16.md.

const svc = `
  @T = *{} ^ {
    timeout *Integer = 30
    h = -> 1
    @connect = { x Integer = timeout * 10 + h(); return x }
    @bump! = { timeout <- timeout + 1 }
    @timeout = -> timeout
  }
  @t = { x Integer = @T.connect(); return x }
`;

const main = `
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
    @timeout = { x Integer = super() + 1000; return x }
  }
  @v = { x Integer = @V.connect(); return x }
  @w = { x Integer = @W.connect(); return x }
  @x = { x Integer = @X.connect(); return x }
  @asParent = { x Integer = @V.asParent(); return x }
  @viaBase = { x Integer = @V.viaBase(); return x }
  @viaSuper = { x Integer = @X.timeout(); return x }
  @bumpW! = { @W.bump!(); a Integer = @W.timeout(); return a }
`;

const network = (svcSource = svc, docSource = svc) => runActors({
  svc: { source: svcSource },
  main: { source: main, compileOptions: { remotes: [{ path: 'svc', service: extract(docSource).interface.service }] } },
});

const ask = async (op) => {
  const net = await network();
  await net.send('main', { id: '1', op, from: 'c' });
  return net.external;
};

describe('a parent block in another file', () => {
  it("an inherited function run for the child sees the child's override", async () => {
    expect(await ask('v')).toEqual([{ id: '1', re: [302], ty: ['Integer'], to: 'c' }]);
  });

  it('two levels: a redeclared cell below, an override in the middle', async () => {
    expect(await ask('w')).toEqual([{ id: '1', re: [52], ty: ['Integer'], to: 'c' }]);
  });

  it('three levels, an override at each', async () => {
    expect(await ask('x')).toEqual([{ id: '1', re: [53], ty: ['Integer'], to: 'c' }]);
  });

  it("the parent's code writes the cell the child redeclares", async () => {
    expect(await ask('bumpW!')).toEqual([{ id: '1', re: [6], ty: ['Integer'], to: 'c' }]);
  });

  it("base::h() runs the parent's own h for the child", async () => {
    expect(await ask('viaBase')).toEqual([{ id: '1', re: [102], ty: ['Integer'], to: 'c' }]);
  });

  it("super runs the parent's same function for the child, with the cell it inherits", async () => {
    expect(await ask('viaSuper')).toEqual([{ id: '1', re: [1005], ty: ['Integer'], to: 'c' }]);
  });

  it('T.f() named explicitly from the child runs as the parent', async () => {
    expect(await ask('asParent')).toEqual([{ id: '1', re: [301], ty: ['Integer'], to: 'c' }]);
  });

  it("the parent's own actors are unchanged", async () => {
    const net = await network();
    await net.send('main', { id: '1', op: 'w', from: 'c' });
    await net.send('svc', { id: '2', op: 't', from: 'c' });
    expect(net.external).toEqual([
      { id: '1', re: [52], ty: ['Integer'], to: 'c' },
      { id: '2', re: [301], ty: ['Integer'], to: 'c' },
    ]);
  });
});

describe('a parent block in another file — skew', () => {
  it('a parent whose doc is newer than the one the child compiled against fails the $extend', async () => {
    const renamed = svc.replace('h = -> 1', 'k = -> 1').replace('+ h()', '+ k()');
    const net = await network(renamed, svc);
    expect(net.actors.svc.posts).toContainEqual({ id: '1', ex: { $extend: 'unknown_name' }, to: 'main:V', from: ':T' });
    // The child's build fails with it.
    await expect(net.send('main', { id: '1', op: 'v', from: 'c' })).rejects.toThrow();
  });
});
