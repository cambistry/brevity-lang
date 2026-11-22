import { compileSource, expectBehavior, createActor, expectActorBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `use("source")` — `use` in value position
//
//   svc = use("svc.bv")                     an actor ref
//   :div, p: para = use("HTML")             a destructure
//   n Integer = use("svc.bv").n()           used directly
//
// The expression is the dependency the host supplies for its source. It is
// hoisted into the file's manifest, one entry per source (shared with a `use`
// statement's), and binds nothing itself: its binding is the ordinary `=` it
// stands in, scoped where that is written. A body-form destructure of a `use`
// statement's dependency (`:div = HTML`) is scoped the same way.
// See notes/use-as-binding-2026-11-18.md.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @viaDestructure = {
    :n = use("svc.bv")
    x Integer = n()
    return x
  }

  @viaAlias = {
    s = use("svc.bv")
    x Integer = s.n()
    return x
  }

  @direct = {
    x Integer = use('svc.bv').n()
    return x
  }

  use Svc = "svc.bv" as { n () -> (Integer) }
`;

describe('use("…") — calls reach the dependency', () => {
  it('through a destructure in a function body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaDestructure', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('through an alias in a function body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaAlias', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [8], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });

  it('used directly', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'direct', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [9], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [9], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('use("…") — in a constructor block', () => {
  it('constructs through an alias bound in the file actor', async () => {
    const actor = await createActor(`
      Thing = use("thing.bv") as (a: Integer) -> *{ get () -> (value: Integer) }
      t = Thing(a: 5)
      @go = { :value Integer = t.get(); return :value }
    `, {
      expects: [
        { output: expect.objectContaining({ op: [[{ a: 5 }], '$new'], to: 'thing.bv' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: ['#<Thing/1>'], ty: ['thing.bv'], from: 'thing.bv' } },
      { input: { id: '99', op: 'go', from: 'caller' } },
      { output: expect.objectContaining({ op: 'get', to: 'Thing/1' }) },
      { input: { id: '2', re: [{ value: 42 }] } },
      { output: expect.objectContaining({ id: '99', re: [{ value: 42 }], to: 'caller' }) },
    );
  });
});

const deps = (src) => extract(`${src}\n@get = -> 1\n`).ast.dependencies;
const hidden = (name, path, fields = {}) => ({ type: 'Dependency', name, interface: null, constructorParams: null, path, hidden: true, ...fields });

describe('use("…") — the manifest', () => {
  it.each([
    ['svc = use("svc.bv")', 'svc.bv'],
    ['svc = use("svc.bv") as { n () -> (Integer) }', 'svc.bv'],
    [':div = use("HTML")', 'HTML'],
    [':div, :span, p: para = use("HTML")', 'HTML'],
    ['n Integer = use("svc.bv").n()', 'svc.bv'],
  ])('%s has one entry, for its source', (line, path) => {
    expect(deps(`@go = {\n  ${line}\n  return 1\n}`).map(d => d.path)).toEqual([path]);
  });

  it('at the file\'s level, too', () => {
    expect(deps('svc = use("svc.bv")').map(d => d.path)).toEqual(['svc.bv']);
  });

  it('an entry is hidden: it binds no name of its own', () => {
    expect(deps('@a = -> use("svc.bv")')).toEqual([hidden('__use_svcBv', 'svc.bv')]);
  });

  it('`as` on the expression claims the entry\'s shape', () => {
    expect(deps('@a = {\n  s = use("svc.bv") as { n () -> (Integer) }\n  return 1\n}')).toEqual([
      hidden('__use_svcBv', 'svc.bv', { interface: '{\n  n () -> (Integer)\n}', interfaceEnc: { '%node': { public: { n: [{ re: ['Integer'], writes: false }] } } } }),
    ]);
  });

  it('two `use("HTML")` are one entry', () => {
    expect(deps('@a = -> use("HTML")\n@b = -> use("HTML")')).toEqual([hidden('__use_HTML', 'HTML')]);
  });

  it('with a `use` statement for the same source, before or after, one entry: the statement\'s', () => {
    expect(deps('use HTML\n@a = -> use("HTML")').map(d => d.name)).toEqual(['HTML']);
    expect(deps('@a = -> use("HTML")\nuse HTML').map(d => d.name)).toEqual(['HTML']);
  });
});

describe('use("…") — scope', () => {
  const remotes = [{ path: 'HTML', service: { public: { div: [{ re: ['Integer'], writes: false }] } } }];

  it('a destructure binds in its function only', () => {
    expect(() => compileSource(`
      @a = {
        :div = use("HTML")
        x Integer = div()
        return x
      }
      @b = {
        x Integer = div()
        return x
      }
    `, { remotes })).toThrow(`'div' is unknown here — ':div = use("HTML")' binds it only in the scope where it's written`);
  });

  it('so does a destructure of a `use` statement\'s dependency', () => {
    expect(() => compileSource(`
      use HTML
      @a = {
        :div = HTML
        x Integer = div()
        return x
      }
      @b = {
        x Integer = div()
        return x
      }
    `, { remotes })).toThrow(`'div' is unknown here — ':div = HTML' binds it only in the scope where it's written`);
  });

  it('and an alias', () => {
    expect(() => compileSource(`
      @a = {
        h = use("HTML")
        x Integer = h.div()
        return x
      }
      @b = {
        x Integer = h.div()
        return x
      }
    `, { remotes })).toThrow(`'h' is unknown here — 'h = use("HTML")' binds it only in the scope where it's written`);
  });

  it('the same name bound in two functions is two bindings', () => {
    expect(() => compileSource(`
      @a = {
        :div = use("HTML")
        x Integer = div()
        return x
      }
      @b = {
        :div = use("HTML")
        x Integer = div()
        return x
      }
    `, { remotes })).not.toThrow();
  });

  it('at the file\'s level, an alias is the file\'s', () => {
    expect(() => compileSource(`
      h = use("HTML")
      @a = {
        x Integer = h.div()
        return x
      }
    `, { remotes })).not.toThrow();
  });
});

describe('use("…") — the claimed interface', () => {
  it('calls are checked against it', () => {
    expect(() => compileSource(`
      @a = {
        s = use("svc.bv") as { n () -> (Integer) }
        x Integer = s.m()
        return x
      }
    `)).toThrow(`'use("svc.bv")' has no function 'm'. Available: n`);
  });

  it('with no claim and no document, the source has no type', () => {
    expect(() => compileSource(`
      @a = {
        s = use("svc.bv")
        x Integer = s.n()
        return x
      }
    `)).toThrow(`'use("svc.bv")' has no type — claim one with 'as { … }', or supply its document via options.remotes`);
  });

  it('claimed twice, differently, is an error', () => {
    expect(() => extract(`
      use Svc = "svc.bv" as { n () -> (Integer) }
      @a = {
        s = use("svc.bv") as { m () -> (Integer) }
        return 1
      }
    `)).toThrow(`'use("svc.bv")' claims a shape its source already has — claim it once, on one 'use'`);
  });
});

describe('use("…") — errors', () => {
  it.each([
    ['a bare name', '@a = -> use(HTML)', `a 'use' source in an expression is a string: 'use("HTML")'`],
    ['a `::` path', '@a = -> use(HTML::div)', `'use(HTML::div)' reaches a member: write ':div = use("HTML")'`],
    ['a member reach on the result', '@a = -> use("HTML")::div', `'use("HTML")::div' isn't supported: write ':div = use("HTML")'`],
    ['interpolation', 'x = 1\n@a = -> use("/svc/#{x}")', `A 'use' source is static: it takes no interpolation`],
    ['no argument', '@a = -> use()', `'use(…)' takes one source, a string: 'use("HTML")'`],
    ['more than one', '@a = -> use("a", "b")', `'use(…)' takes one source, a string: 'use("HTML")'`],
    ['no parens, in value position', '@a = {\n  x = use "svc.bv"\n  return x\n}', `'use' in an expression takes its source in parens: write 'use("svc.bv")'`],
  ])('%s', (_, src, message) => {
    expect(() => extract(src)).toThrow(message);
  });
});
