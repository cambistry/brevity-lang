import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// `use` — DI as its own declaration
//
//   use <entries>     — one or more header entries, comma-separated
//
// A file that doesn't open with a constructor form is an actor, with no header.
// Every `use` in the file actor's own scope is hoisted into its manifest, which
// the host binds at load. The `**` header and `( DI ) actor { }` are retired.
// See notes/use-di-2026-11-17.md.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  @early = {
    n Integer = Svc.n()
    return n
  }

  use "svc.bv": Svc { n () -> (Integer) }, "log.bv": Log { note. (Text) => . }
  use "svc.bv": Svc { n () -> (Integer) }

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
      { output: { id: '1', op: 'n', to: 'Svc' } },
      { input: { id: '1', re: [7], ty: ['Integer'], from: 'Svc' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a second entry in one statement', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'logged.', from: 'c' } },
      { output: { id: '1', op: [['hi'], 'note.'], ty: [['Text']], to: 'Log' } },
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

describe('use — the manifest', () => {
  it('the same entry twice is one entry', () => {
    expect(extract(script).ast.dependencies.map(d => d.name)).toEqual(['Svc', 'Log']);
  });

  it('a file with no header is an actor', () => {
    expect(extract(script).ast.fileKind).toBe('class');
    expect(extract('@get = -> 1\n').ast.fileKind).toBe('singleton');
    expect(extract('use :document\n@get = -> 1\n').ast.fileKind).toBe('singleton');
  });

  it('a file with no header and no `use` has no dependencies', () => {
    expect(extract('@get = -> 1\n').ast.dependencies).toEqual([]);
  });

  it('several statements and several entries yield the same manifest', () => {
    const one = extract('use :document, HTML: (:div), "svc.bv": Svc #\n@get = -> 1\n');
    const many = extract('use :document\nuse HTML: (:div)\n\n@get = -> 1\nuse "svc.bv": Svc #\n');
    expect(many.ast.dependencies).toEqual(one.ast.dependencies);
  });

  it('a trailing comma carries the entries to the next line', () => {
    const { ast } = extract('use :document,\n  "svc.bv": Svc #\n@get = -> 1\n');
    expect(ast.dependencies.map(d => d.name)).toEqual(['document', 'Svc']);
  });

  it('takes every entry form', () => {
    const { ast } = extract(`
      use :document
      use "svc.bv": Svc
      use "lib.bv": Lib #
      use "remote.bv": Remote { get () -> (Integer) }
      use "thing.bv": Thing (a: Integer) -> *{ get () -> (Integer) }
      use HTML: (:div, span: s, :p)
      use "html.bv": (:em)
      @get = -> 1
    `);
    expect(ast.dependencies).toEqual([
      expect.objectContaining({ type: 'Dependency', name: 'document', path: 'document' }),
      expect.objectContaining({ type: 'Dependency', name: 'Svc', path: 'svc.bv', generic: false }),
      expect.objectContaining({ type: 'Dependency', name: 'Lib', path: 'lib.bv', generic: true }),
      expect.objectContaining({ type: 'Dependency', name: 'Remote', path: 'remote.bv', interface: expect.stringContaining('get () -> (Integer)') }),
      expect.objectContaining({ type: 'Dependency', name: 'Thing', path: 'thing.bv', constructorParams: [expect.objectContaining({ name: 'a', type: 'Integer' })] }),
      expect.objectContaining({ type: 'Dependency', name: 'HTML', destructures: [{ local: 'div', remote: 'div' }, { local: 's', remote: 'span' }, { local: 'p', remote: 'p' }] }),
      expect.objectContaining({ type: 'Dependency', path: 'html.bv', destructures: [{ local: 'em', remote: 'em' }] }),
    ]);
  });

  it('takes a typed param as a destructure, `:name Type`, or renamed, `key: local Type`', () => {
    const { ast } = extract('use :limit Integer, size: n Integer, :slot *Integer\n@get = -> limit + n\n');
    expect(ast.dependencies).toEqual([
      { type: 'FileParam', name: 'limit', paramType: 'Integer', positional: false },
      { type: 'FileParam', name: 'n', key: 'size', paramType: 'Integer', positional: false },
      { type: 'FileParam', name: 'slot', paramType: 'Integer', positional: false },
    ]);
  });

  it('`use` in a whole-file actor { … }', () => {
    const wrapped = extract('actor {\n  use :document, "svc.bv": Svc #\n  @get = -> 1\n}\n');
    expect(wrapped.ast.fileKind).toBe('singleton');
    expect(wrapped.ast.dependencies).toEqual(extract('use :document, "svc.bv": Svc #\n@get = -> 1\n').ast.dependencies);
  });
});

describe('use — errors', () => {
  it('in a nested actor', () => {
    expect(() => compileSource(`
      inner = actor {
        use :document
        @get = -> 1
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a class body', () => {
    expect(() => compileSource(`
      C = (n Integer) *{
        use :document
        @get = -> n
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a function body', () => {
    expect(() => compileSource(`
      @get = {
        use :document
        return 1
      }
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a conditional', () => {
    expect(() => compileSource(`
      @get = (n Integer) {
        if n > 0 {
          use :document
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
      use :document
      @n = -> seed
    `)).toThrow("'use' in inner scopes is not supported yet");
  });

  it('in a factory file', () => {
    expect(() => compileSource(`
      *
        n Integer
      *
      use :document
      @get = -> n
    `)).toThrow("'use' in a factory file is not supported yet");
  });

  it('in a delimited factory file', () => {
    expect(() => compileSource(`
      ( n Integer ) *{
        use :document
        @get = -> n
      }
    `)).toThrow("'use' in a factory file is not supported yet");
  });

  it('with no entries', () => {
    expect(() => compileSource(`
      use
      @get = -> 1
    `)).toThrow(/'use' takes one or more entries/);
  });

  it('an accessor', () => {
    expect(() => compileSource(`
      use @count Integer
      @get = -> 1
    `)).toThrow("'use' can't declare an accessor ('@count') — write ':count Type', and publish it with a handler: '@count = -> count'");
  });

  it('a renamed accessor', () => {
    expect(() => compileSource(`
      use @label: l Text
      @get = -> 1
    `)).toThrow("'use' can't declare an accessor ('@label')");
  });

  it('a positional entry', () => {
    expect(() => compileSource(`
      use n Integer
      @get = -> n
    `)).toThrow("'use' takes no positional entry ('n …') — write ':n Type'");
  });

  it('a bare name', () => {
    expect(() => compileSource(`
      use HTML
      @get = -> 1
    `)).toThrow(`'use HTML': a dependency is ':HTML' (or '"HTML": HTML')`);
  });

  it('a typed entry written `name: Type`', () => {
    expect(() => compileSource(`
      use value: Integer
      @get = -> value
    `)).toThrow("In 'use', 'value: Integer' reads as a rename (key: local), not a type — a typed entry is ':value Integer'");
  });

  it('a cell entry written `name: *Type`', () => {
    expect(() => compileSource(`
      use slot: *Integer
      @get = -> slot
    `)).toThrow("In 'use', 'slot: *Integer' reads as a rename (key: local), not a type — a typed entry is ':slot *Integer'");
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
      use :document
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
