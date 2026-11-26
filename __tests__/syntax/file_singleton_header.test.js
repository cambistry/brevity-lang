import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// The file actor
//
// A file that doesn't open with a constructor form is an actor, built once by its
// host at load. It needs no header; its DI is its `use` statements
// (__tests__/syntax/use.test.js). It may open with `actor {` and close with `}`.
// The `**` header and `( DI ) actor { }` are retired.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  use Remote = "Remote" as { get () -> (Integer) }
  use name Text = name
  use n Integer = size
  @get = -> name
`;

describe('file actor — forms', () => {
  it('no header', () => {
    expect(() => compileSource(script)).not.toThrow();
  });

  it('delimited: actor { body }', () => {
    expect(() => compileSource(`
      actor {
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('no header and actor { body } yield identical dependencies', () => {
    const bare = extract(script);
    const delimited = extract(`
      actor {
        use Remote = "Remote" as { get () -> (Integer) }
        use name Text = name
        use n Integer = size
        @get = -> name
      }
    `);
    expect(bare.ast.dependencies).toEqual(delimited.ast.dependencies);
    expect(bare.interface.params).toBe(delimited.interface.params);
  });

  it('a named param in `use` is the same entry as in a `*` header', () => {
    expect(extract('use name Text = name\nuse n Integer = size\n@get = -> name\n').ast.dependencies)
      .toEqual(extract('*\n  name: Text\n  size: n Integer\n*\n@get = -> name\n').ast.dependencies);
  });
});

describe('file singleton header — kind', () => {
  it('a file with `use` is a singleton', () => {
    expect(extract(script).ast.fileKind).toBe('singleton');
  });

  it('a headerless file is a singleton', () => {
    expect(extract('@get = -> 1\n').ast.fileKind).toBe('singleton');
  });

  it('a `*` header makes a factory', () => {
    expect(extract('*\n  n Integer\n*\n@get = -> n\n').ast.fileKind).toBe('factory');
  });
});

// A `*` header is a factory: its entries are `new`'s params. DI is the host
// filling in a singleton at load, so a factory takes none.
describe('factory header — no DI', () => {
  const refused = /A '\*' file header is a factory's params and takes no DI/;
  const entries = {
    'a service': '"svc.bv": Svc { get () -> (Integer) }',
    'a bare path': '"svc.bv": Svc',
    'a declared constructor': '"svc.bv": Svc (a: Integer) -> *{ get () -> (Integer) }',
    'a destructure': 'HTML: (:div)',
    'a path shorthand': ':document',
    'an untyped key': 'HTML: Html',
  };

  for (const [label, entry] of Object.entries(entries)) {
    it(`refuses ${label} in a lineal header`, () => {
      expect(() => extract(`*\n  ${entry}\n*\n@get = -> 1\n`)).toThrow(refused);
    });
  }

  it('refuses DI in a delimited header', () => {
    expect(() => extract('( "svc.bv": Svc, n Integer ) *{\n  @get = -> n\n}\n')).toThrow(refused);
  });

  it('names the entry and points to `use`', () => {
    expect(() => extract('*\n  n Integer\n  "svc.bv": Svc\n*\n@get = -> n\n'))
      .toThrow(`A '*' file header is a factory's params and takes no DI ('"svc.bv"') — declare DI with 'use' in the constructor body`);
  });

  it('accepts params of every kind', () => {
    expect(() => compileSource(`
      *
        n Integer
        name: Text
        port: p Integer
        @label: Text
        limit: Integer = 5
      *
      @get = -> name
    `)).not.toThrow();
  });

  it('the same DI is fine in a `use`', () => {
    const bindings = [
      'Svc = "svc.bv" as { get () -> (Integer) }',
      'Svc = "svc.bv"',
      'Svc = "svc.bv" as (a: Integer) -> *{ get () -> (Integer) }',
      ':div = HTML',
      'document',
      'Html = HTML',
    ];
    for (const entry of bindings) {
      expect(() => extract(`use ${entry}\n@get = -> 1\n`)).not.toThrow();
    }
  });
});

describe('file actor — actor { } only at the head of a file', () => {
  it('after a declaration', () => {
    expect(() => compileSource(`
      x = 1
      actor {
        @get = -> 1
      }
    `)).toThrow(/a whole-file 'actor \{ … \}' must open the file/);
  });

  it('after a type', () => {
    expect(() => compileSource(`
      type Point (Integer)
      actor {
        @get = -> 1
      }
    `)).toThrow(/a whole-file 'actor \{ … \}' must open the file/);
  });

  it('twice', () => {
    expect(() => compileSource(`
      actor {
        @get = -> 1
      }
      actor {
        @put = -> 1
      }
    `)).toThrow(/body must be the entire file|must open the file/);
  });
});

// A singleton file that declares `new` is a class, as any singleton is. Its `new =`
// closes over the file's members. Its lineal body is an ordinary one: it ends at the
// first blank line, unless a `--` holds it open.
// See notes/use-di-2026-11-17.md and notes/class-singleton-forms-2026-11-13.md.
const classFile = `
  count *Integer = 10
  @total = -> count

  @make = {
    c = new(5)
    x Integer = c.n()
    return x
  }

  @viaLate = {
    c = new(1)
    x Integer = c.late()
    return x
  }

  new =
  *
    seed Integer
  *
  n Integer = count + seed
  @n = { return n }
  --
  @late = { return seed }

  @after = -> count
`;

describe('file with `new =`', () => {
  it('is a class', () => {
    expect(extract(classFile).ast.fileKind).toBe('class');
  });

  it('is a class with a `use` too', () => {
    expect(extract(`use document\n${classFile}`).ast.fileKind).toBe('class');
  });

  it('its actor closes over the file\'s members', async () => {
    await expectBehavior(classFile,
      { input: { id: '1', op: 'make', from: 'c' } },
      { output: { id: '1', re: [15], ty: ['Integer'], to: 'c' } },
    );
  });

  it('`$new` to the file builds one, at `n` under it, of class `:`', async () => {
    await expectBehavior(classFile,
      { input: { id: '1', op: [[5], '$new'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: ['#<:1>'], ty: [':'], to: 'c' } },
      { input: { id: '2', op: [[6], '$new'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: ['#<:2>'], ty: [':'], to: 'c' } },
      { input: { id: '3', op: 'n', to: ':2', from: 'c' } },
      { output: { id: '3', re: [16], ty: ['Integer'], to: 'c', from: ':2' } },
    );
  });

  it('a `--` holds its body open', async () => {
    await expectBehavior(classFile,
      { input: { id: '1', op: 'viaLate', from: 'c' } },
      { output: { id: '1', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a blank line ends its body', async () => {
    const file = extract(classFile).ast.actors.find(a => !a.name);
    expect(file.functions.map(f => f.name)).toEqual(expect.arrayContaining(['@total', '@make', '@viaLate', '@after']));
    expect(file.functions.map(f => f.name)).not.toContain('@late');
    await expectBehavior(classFile,
      { input: { id: '1', op: 'after', from: 'c' } },
      { output: { id: '1', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });

  it('delimited: `new = (params) *{ … }`', async () => {
    await expectBehavior(`
      count *Integer = 10
      new = (seed Integer) *{
        @n = -> count + seed

        @seed = -> seed
      }
      @make = {
        c = new(2)
        x Integer = c.n()
        return x
      }
    `,
      { input: { id: '1', op: 'make', from: 'c' } },
      { output: { id: '1', re: [12], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a file declares `new` once', () => {
    expect(() => extract('new = (a Integer) *{\n  @a = -> a\n}\nnew = (b Integer) *{\n  @b = -> b\n}\n'))
      .toThrow("A file declares 'new' once");
  });
});

describe('factory files are unchanged', () => {
  const forms = {
    'lineal `*` header': '*\n  n Integer\n*\n@get = -> n\n',
    '`*{ … }`': '*{\n  @get = -> 1\n}\n',
    '`( params ) *{ … }`': '( n Integer ) *{\n  @get = -> n\n}\n',
    '`( params ) -> *{ … }`': '( n Integer ) -> *{\n  @get = -> n\n}\n',
  };
  for (const [label, src] of Object.entries(forms)) {
    it(`${label} is a factory`, () => {
      expect(extract(src).ast.fileKind).toBe('factory');
      expect(() => compileSource(src)).not.toThrow();
    });
  }
});

describe('file with `new =` — errors', () => {
  it('accepts params of every kind', () => {
    expect(() => compileSource(`
      new =
      *
        n Integer
        name: Text
        port: p Integer
        limit: Integer = 5
      *
      @get = -> name
    `)).not.toThrow();
  });
});
