import { compileSource, expectBehavior, createActor, expectActorBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `use` — DI as its own declaration
//
//   use target = source [as Shape]   — one binding or destructure
//   use source, source               — shorthands, each binding its last segment
//
// A file that doesn't open with a constructor form is an actor, with no header.
// Every `use` in the file actor's own scope is hoisted into its manifest, which
// the host binds at load. The `**` header and `( DI ) actor { }` are retired.
// See notes/use-di-2026-11-17.md and notes/use-as-binding-2026-11-18.md.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @early = {
    n Integer = Svc.n()
    return n
  }

  use Svc = "svc.bv" as { n () -> (Integer) }
  use Log = "log.bv" as { note. (Text) => . }
  use Svc = "svc.bv" as { n () -> (Integer) }

  count *Integer = 0

  @logged. = { Log.note("hi")... }

  @make = {
    a = new(1)
    b = new(2)
    x Integer = a.ask()
    y Integer = b.ask()
    return x + y
  }

  new =
  *
    seed Integer
  *
  @ask = {
    n Integer = Svc.n()
    return n + seed
  }
`;

describe('use', () => {
  it('a name declared below is visible above it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'early', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'svc.bv' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'svc.bv' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a second binding', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'logged.', from: 'c' } },
      { output: { id: '1', op: [['hi'], 'note.'], ty: [['Text']], to: 'log.bv' } },
    );
  });

  // Each instance's call comes from that instance, not from the file.
  // TODO: every target relays an instance's outgoing call through the file actor,
  // which makes it as its own, so `from` is the file's. Unskip once instances call
  // out from their own address.
  it.skip('instances built by `new =` call it, each from its own address', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'make', from: 'c' } },
      { output: { id: '1', op: 'n', to: 'Svc', from: ':1' } },
      { input: { id: '1', re: [10], ty: ['Integer'], from: 'Svc', to: ':1' } },
      { output: { id: '2', op: 'n', to: 'Svc', from: ':2' } },
      { input: { id: '2', re: [20], ty: ['Integer'], from: 'Svc', to: ':2' } },
      { output: { id: '1', re: [33], ty: ['Integer'], to: 'c' } },
    );
  });
});

const deps = (src) => extract(`${src}\n@get = -> 1\n`).ast.dependencies;
const dep = (name, fields = {}) => ({ type: 'Dependency', name, interface: null, constructorParams: null, path: name, generic: false, ...fields });
const member = (local, remote = local) => ({ local, remote });

describe('use — the manifest', () => {
  it('the same binding twice is one entry', () => {
    expect(extract(script).ast.dependencies.map(d => d.name)).toEqual(['Svc', 'Log']);
  });

  it('a file with no header is an actor', () => {
    expect(extract(script).ast.fileKind).toBe('class');
    expect(extract('@get = -> 1\n').ast.fileKind).toBe('singleton');
    expect(extract('use document\n@get = -> 1\n').ast.fileKind).toBe('singleton');
  });

  it('a file with no header and no `use` has no dependencies', () => {
    expect(extract('@get = -> 1\n').ast.dependencies).toEqual([]);
  });

  it.each([
    ['use HTML', 'use HTML = HTML', [dep('HTML')]],
    ['use HTML::div', 'use div = HTML::div', [dep('HTML', { destructures: [member('div')] })]],
    ['use :div = HTML', 'use HTML::div', [dep('HTML', { destructures: [member('div')] })]],
    ['use "/service"::Widget', 'use Widget = "/service"::Widget', [dep('/service', { destructures: [member('Widget')] })]],
    ['use d = HTML::div', 'use div: d = HTML', [dep('HTML', { destructures: [member('d', 'div')] })]],
    ['use d Div = HTML::div', 'use div: d Div = HTML', [dep('HTML', { destructures: [{ local: 'd', remote: 'div', type: 'Div' }] })]],
    ['use :div, :span, p: para = HTML', 'use (:div, :span, p: para) = HTML',
      [dep('HTML', { destructures: [member('div'), member('span'), member('para', 'p')] })]],
    ['use Svc = "svc.bv"', 'use Svc = \'svc.bv\'', [dep('Svc', { path: 'svc.bv' })]],
    ['use Lib = "lib.bv" as #', 'use Lib # = "lib.bv"', [dep('Lib', { path: 'lib.bv', generic: true })]],
    ['use limit Integer = limit', 'use limit = limit as Integer', [{ type: 'FileParam', name: 'limit', paramType: 'Integer', positional: false }]],
    ['use n Integer = size', 'use n = size as Integer', [{ type: 'FileParam', name: 'n', key: 'size', paramType: 'Integer', positional: false }]],
    ['use slot *Integer = slot', 'use slot Integer = slot', [{ type: 'FileParam', name: 'slot', paramType: 'Integer', positional: false }]],
  ])('%s is %s', (a, b, manifest) => {
    expect(deps(a)).toEqual(manifest);
    expect(deps(b)).toEqual(manifest);
  });

  it('a lone name with no interface is a dependency on that name', () => {
    expect(deps('use limit')).toEqual([dep('limit')]);
  });

  it('several shorthands, and several statements, accumulate', () => {
    const one = deps('use HTML, document');
    expect(one).toEqual([dep('HTML'), dep('document')]);
    expect(deps('use HTML\nuse document')).toEqual(one);
  });

  it('a trailing comma carries the shorthands to the next line', () => {
    expect(deps('use document,\n  HTML')).toEqual([dep('document'), dep('HTML')]);
  });

  it('a destructure may break its line after a comma', () => {
    expect(deps('use :div,\n  :span = HTML')).toEqual(deps('use :div, :span = HTML'));
  });

  it('destructures of one source gather into one entry', () => {
    expect(deps('use :div = HTML\nuse HTML::span\nuse p: para = HTML\nuse HTML::div'))
      .toEqual([dep('HTML', { destructures: [member('div'), member('span'), member('para', 'p')] })]);
  });

  it('the same source under two names is two bindings', () => {
    expect(deps('use A = "svc.bv"\nuse B = "svc.bv"')).toEqual([dep('A', { path: 'svc.bv' }), dep('B', { path: 'svc.bv' })]);
    expect(deps('use a = HTML::div\nuse b = HTML::div')).toEqual([dep('HTML', { destructures: [member('a', 'div'), member('b', 'div')] })]);
  });

  it('quoted segments: a path, a quoted last segment renamed, a chain', () => {
    expect(deps('use Svc = "//host/x"')).toEqual([dep('Svc', { path: '//host/x' })]);
    expect(deps(`use myEl = HTML::"my-el"`)).toEqual([dep('HTML', { destructures: [member('myEl', 'my-el')] })]);
    expect(deps(`use el = 'my-actor'::"my-el"`)).toEqual([dep('my-actor', { destructures: [member('el', 'my-el')] })]);
  });

  it('`as` claims the shape: an interface, `#`, a constructor profile', () => {
    expect(deps('use Svc = "svc.bv" as { n () -> (Integer) }')).toEqual([
      dep('Svc', { path: 'svc.bv', interface: '{\n  n () -> (Integer)\n}' }),
    ]);
    expect(deps('use Svc = "svc.bv" as {\n  n () -> (Integer)\n}')).toEqual(deps('use Svc = "svc.bv" as { n () -> (Integer) }'));
    expect(deps('use Thing = "thing.bv" as (a: Integer) -> *{ get () -> (Integer) }')).toEqual([
      dep('Thing', { path: 'thing.bv', interface: '{\n  get () -> (Integer)\n}', constructorParams: [{ name: 'a', type: 'Integer' }], constructorArrow: '->' }),
    ]);
    expect(deps('use :em, ... = "html.bv" as #')).toEqual([dep('html.bv', { generic: true, destructures: [member('em'), { spread: true }] })]);
  });

  it('a discard in a destructure', () => {
    expect(deps('use div: _, ... = HTML')).toEqual([dep('HTML', { destructures: [{ remote: 'div', discard: true }, { spread: true }] })]);
  });

  it('`use` in a whole-file actor { … }', () => {
    const wrapped = extract('actor {\n  use document\n  use Svc # = "svc.bv"\n  @get = -> 1\n}\n');
    expect(wrapped.ast.fileKind).toBe('singleton');
    expect(wrapped.ast.dependencies).toEqual(deps('use document\nuse Svc # = "svc.bv"'));
  });
});

describe('use — a value', () => {
  it('a typed binding is a value the host supplies at load', async () => {
    const actor = await createActor(`
      use n Integer = limit
      @get = -> n + 1
    `, { constructorArgs: { limit: 41 } });
    await expectActorBehavior(actor,
      { input: { id: '1', op: 'get', from: 'c' } },
      { output: { id: '1', re: [42], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('use — errors', () => {
  it('in a nested actor', () => {
    expect(() => compileSource(`
      inner = actor {
        use document
        @get = -> 1
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a class body', () => {
    expect(() => compileSource(`
      C = (n Integer) *{
        use document
        @get = -> n
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a function body', () => {
    expect(() => compileSource(`
      @get = {
        use document
        return 1
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a conditional', () => {
    expect(() => compileSource(`
      @get = (n Integer) {
        if n > 0 {
          use document
        }
        return 1
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a `new =` constructor body', () => {
    expect(() => compileSource(`
      new =
      *
        seed Integer
      *
      use document
      @n = -> seed
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a factory file', () => {
    expect(() => compileSource(`
      *
        n Integer
      *
      use document
      @get = -> n
    `)).toThrow("'use' in a factory file is not supported yet");
  });

  it('in a delimited factory file', () => {
    expect(() => compileSource(`
      ( n Integer ) *{
        use document
        @get = -> n
      }
    `)).toThrow("'use' in a factory file is not supported yet");
  });

  it('with nothing after it', () => {
    expect(() => compileSource(`
      use
      @get = -> 1
    `)).toThrow(`'use' takes a binding or names: 'use HTML', 'use Svc = "svc.bv"'`);
  });

  it('an accessor', () => {
    expect(() => compileSource(`
      use @count Integer
      @get = -> 1
    `)).toThrow("'use' can't declare an accessor ('@count') — write 'use count Type = count', and publish it with a handler: '@count = -> count'");
  });

  it('a renamed accessor', () => {
    expect(() => compileSource(`
      use @label: l Text
      @get = -> 1
    `)).toThrow("'use' can't declare an accessor ('@label')");
  });

  it('a lone sigil', () => {
    expect(() => compileSource(`
      use :HTML
      @get = -> 1
    `)).toThrow("'use :HTML': a lone ':HTML' destructures nothing — write 'use HTML'");
  });

  it('a typed name with no source', () => {
    expect(() => compileSource(`
      use n Integer
      @get = -> n
    `)).toThrow("'use n Integer' has no source — write 'use n Integer = n'");
  });

  it.each([
    ['"svc.bv": Svc', 'use Svc = "svc.bv"'],
    ['HTML: (:div)', 'use :div = HTML'],
    ['HTML: (:div, span: s)', 'use :div, span: s = HTML'],
    ['HTML: :div', 'use :div = HTML'],
    ['"svc.bv": Svc { n () -> (Integer) }', 'use Svc = "svc.bv" as { … }'],
    ['Svc { n () -> (Integer) }', 'use Svc = Svc as { … }'],
    ['"svc.bv": Svc #', 'use Svc # = "svc.bv"'],
    ['Svc #', 'use Svc # = Svc'],
    ['"thing.bv": Thing (a: Integer) -> *{ get () -> (Integer) }', 'use Thing = "thing.bv" as (…) -> *{ … }'],
    ['Thing (a: Integer) -> *{ get () -> (Integer) }', 'use Thing = Thing as (…) -> *{ … }'],
    ['"service.bv": (:greet) #', 'use :greet = "service.bv" as #'],
    [':limit Integer', 'use limit Integer = limit'],
    ['size: n Integer', 'use n Integer = size'],
    ['slot: *Integer', 'use slot *Integer = slot'],
  ])('a retired header entry: %s', (entry, now) => {
    expect(() => compileSource(`use ${entry}\n@get = -> 1\n`)).toThrow(`'${entry}' is a retired header entry — write '${now}'`);
  });

  it('a retired `name: Type` entry', () => {
    expect(() => compileSource(`use value: Integer\n@get = -> value\n`))
      .toThrow("'value: Integer' is a retired header entry — a typed value is 'use value Integer = value', a rename 'use Integer = value'");
  });

  it('a retired entry after a shorthand', () => {
    expect(() => compileSource(`use document, "svc.bv": Svc\n@get = -> 1\n`)).toThrow(`'"svc.bv": Svc' is a retired header entry — write 'use Svc = "svc.bv"'`);
  });

  it('a shorthand whose last segment is quoted', () => {
    expect(() => compileSource(`use HTML::"my-el"\n@get = -> 1\n`))
      .toThrow(`'use HTML::"my-el"' has nothing to bind: its last segment isn't a name — write 'use myEl = HTML::"my-el"'`);
  });

  it('shorthands and a binding in one statement', () => {
    const both = "a statement is either names ('use HTML, document') or one binding ('use … = source')";
    expect(() => compileSource(`use HTML, d = x\n@get = -> 1\n`)).toThrow(`'use HTML, d = x': ${both}`);
    expect(() => compileSource(`use :div = HTML, span\n@get = -> 1\n`)).toThrow(`'use :div = HTML, span': ${both}, not both`);
  });

  it('a destructure by position', () => {
    expect(() => compileSource(`use a, b = X\n@get = -> 1\n`)).toThrow("a 'use' destructure is by name");
  });

  it('a shape claimed twice', () => {
    expect(() => compileSource(`use Lib # = "lib.bv" as #\n@get = -> 1\n`))
      .toThrow(`'use Lib # = "lib.bv" as #' claims its shape twice`);
  });

  it('a source of three segments', () => {
    expect(() => compileSource(`use x = a::b::c\n@get = -> 1\n`))
      .toThrow("'use x = a::b::c': a source of more than two segments isn't supported yet");
  });

  it('a value from a quoted source', () => {
    expect(() => compileSource(`use n Integer = "a.bv"\n@get = -> n\n`))
      .toThrow(`'use n Integer = "a.bv"': a value's source is a name, not '"a.bv"'`);
  });

  it('a lineal `**` header', () => {
    expect(() => compileSource(`
      **
        :document
      **
      @get = -> 1
    `)).toThrow(/the '\*\*' file header is retired — declare DI with 'use'/);
  });

  it('a lineal `**` header with no entries', () => {
    expect(() => compileSource(`
      **
      @get = -> 1
    `)).toThrow(/the '\*\*' file header is retired — declare DI with 'use'/);
  });

  it('a `( DI ) actor { }` header', () => {
    expect(() => compileSource(`
      ( :document ) actor {
        @get = -> 1
      }
    `)).toThrow(/'\( … \) actor \{ … \}' is retired — declare DI with 'use' inside the braces/);
  });

  it('a whole-file actor { … } after a `use`', () => {
    expect(() => compileSource(`
      use document
      actor {
        @get = -> 1
      }
    `)).toThrow(/a whole-file 'actor \{ … \}' must open the file/);
  });

  it('a dependency entry in a factory\'s params', () => {
    expect(() => compileSource(`
      *
        n Integer
        "svc.bv": Svc
      *
      @get = -> n
    `)).toThrow(`A '*' file header is a factory's params and takes no DI ('"svc.bv"') — DI is declared with 'use', which a factory file doesn't support yet`);
  });
});
