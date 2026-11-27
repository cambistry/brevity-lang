import { createActor, expectActorBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `use` in a `*` factory file
//
// A factory file (the lineal `*` header, `*{ … }`, `( params ) *{ … }`) may
// declare `use` in its constructor body, as a singleton does: hoisted into the
// file's manifest, one entry per binding, granted at load. Each instance is its
// own actor, so a call its code makes goes out from that instance (the host
// stamps `from` on the way out, as for any actor it holds).
// See notes/use-di-2026-11-17.md ("Factory files and the trailing `*` section").
// ═══════════════════════════════════════════════════════════════════════════════

const N = '{ n () -> (Integer) }';

const call = (k, reply) => [
  { input: { id: '1', op: 'get', from: 'c' } },
  { output: { id: '1', op: 'n', to: 'svc.bv' } },
  { input: { id: '1', re: [reply], ty: ['Integer'], from: 'svc.bv' } },
  { output: { id: '1', re: [reply + k], ty: ['Integer'], to: 'c' } },
];

describe('use in a factory file — instances call the dependency', () => {
  it('the lineal `*` header, with `use` after the handler that calls it', async () => {
    const actor = await createActor(`
*
  k Integer
*
@get = {
  x Integer = Svc.n()
  return x + k
}
use Svc = "svc.bv" as ${N}
`, { constructorArgs: [5] });
    await expectActorBehavior(actor, ...call(5, 2));
  });

  it('`*{ … }`', async () => {
    const actor = await createActor(`
*{
  @get = {
    x Integer = Svc.n()
    return x
  }
  use Svc = "svc.bv" as ${N}
}
`);
    await expectActorBehavior(actor, ...call(0, 3));
  });

  it('`( params ) *{ … }`', async () => {
    const actor = await createActor(`
( k Integer ) *{
  use Svc = "svc.bv" as ${N}
  @get = {
    x Integer = Svc.n()
    return x + k
  }
}
`, { constructorArgs: [10] });
    await expectActorBehavior(actor, ...call(10, 1));
  });

  it('an inner `use`, in a handler body', async () => {
    const actor = await createActor(`
*
  k Integer
*
@get = {
  use Svc = "svc.bv" as ${N}
  x Integer = Svc.n()
  return x + k
}
`, { constructorArgs: [4] });
    await expectActorBehavior(actor, ...call(4, 4));
  });
});

describe('use in a factory file — two instances', () => {
  const source = `
*
  k Integer
*
use Svc = "svc.bv" as ${N}
@get = {
  x Integer = Svc.n()
  return x + k
}
`;

  it('each instance calls the dependency itself, and gets its own reply', async () => {
    const one = await createActor(source, { constructorArgs: [1] });
    const two = await createActor(source, { constructorArgs: [2] });
    await expectActorBehavior(one, { input: { id: '1', op: 'get', from: 'c' } }, { output: { id: '1', op: 'n', to: 'svc.bv' } });
    await expectActorBehavior(two, { input: { id: '1', op: 'get', from: 'c' } }, { output: { id: '1', op: 'n', to: 'svc.bv' } });
    await expectActorBehavior(two,
      { input: { id: '1', re: [20], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [22], ty: ['Integer'], to: 'c' } },
    );
    await expectActorBehavior(one,
      { input: { id: '1', re: [10], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [11], ty: ['Integer'], to: 'c' } },
    );
  });
});

const deps = (src) => extract(src).ast.dependencies;

describe('use in a factory file — the manifest', () => {
  it('its entries join the params', () => {
    expect(deps(`*\n  k Integer\n*\nuse Svc = "svc.bv" as ${N}\n@get = () -> k\n`)).toEqual([
      expect.objectContaining({ type: 'FileParam', name: 'k' }),
      expect.objectContaining({ type: 'Dependency', name: 'Svc', path: 'svc.bv' }),
    ]);
  });

  it('the same entry twice is one', () => {
    const src = `( k Integer ) *{\n  use Svc = "svc.bv" as ${N}\n  use Svc = "svc.bv" as ${N}\n  @get = () -> k\n}\n`;
    expect(deps(src).filter(d => d.type === 'Dependency')).toHaveLength(1);
  });

  it('an inner `use` of a top-level source shares its entry', () => {
    const src = `*\n  k Integer\n*\nuse Svc = "svc.bv" as ${N}\n@get = {\n  use S = "svc.bv"\n  x Integer = S.n()\n  return x\n}\n`;
    expect(deps(src).filter(d => d.type === 'Dependency').map(d => [d.name, d.path])).toEqual([['Svc', 'svc.bv']]);
  });

  it('a dependency entry in the factory\'s params is an error that points to `use`', () => {
    expect(() => extract('*\n  k Integer\n  "svc.bv": Svc\n*\n@get = () -> k\n'))
      .toThrow(`A '*' file header is a factory's params and takes no DI ('"svc.bv"') — declare DI with 'use' in the constructor body`);
    expect(() => extract('( "svc.bv": Svc, k Integer ) *{\n  @get = () -> k\n}\n'))
      .toThrow(`A '*' file header is a factory's params and takes no DI ('"svc.bv"') — declare DI with 'use' in the constructor body`);
  });
});
