import { compileSource, expectBehavior } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File singleton header — `**`
//
// A file is a singleton, built once by its host at load. Its header is its DI:
//   **\n entries\n **\n body          — lineal (each `**` alone on its line)
//   **\n entries\n ** { body }         — lineal header, delimited body
//   ( entries ) actor { body }            — delimited
//   **\n body  |  actor { body }          — no DI
// Entries use the same grammar as the `*` header. Only the head of a file
// takes one: an inline singleton (`name = actor { … }`) has nobody to fill it.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  **
    "Remote": Remote { get () -> (Integer) }
    name: Text
    n Integer
  **
  @get = -> name
`;

describe('file singleton header — forms', () => {
  it('lineal: **\\n entries\\n **\\n body', () => {
    expect(() => compileSource(script)).not.toThrow();
  });

  it('lineal header, delimited body: ** { body }', () => {
    expect(() => compileSource(`
      **
        value Integer
      ** {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it('delimited: ( entries ) actor { body }', () => {
    expect(() => compileSource(`
      ( value: Integer ) actor {
        @get = -> value
      }
    `)).not.toThrow();
  });

  it('no DI, lineal: **\\n body', () => {
    expect(() => compileSource(`
      **
      @hello = -> greeting: "hi"
    `)).not.toThrow();
  });

  it('no DI, delimited: actor { body }', () => {
    expect(() => compileSource(`
      actor {
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('lineal and delimited headers yield identical dependencies', () => {
    const lineal = extract(script);
    const delimited = extract(`
      ( "Remote": Remote { get () -> (Integer) }, name: Text, n Integer ) actor {
        @get = -> name
      }
    `);
    expect(lineal.ast.dependencies).toEqual(delimited.ast.dependencies);
    expect(lineal.interface.params).toBe(delimited.interface.params);
  });

  it('params are the same entries as in a `*` header', () => {
    const params = `
      **
        name: Text
        n Integer
      **
      @get = -> name
    `;
    expect(extract(params).ast.dependencies).toEqual(extract(params.replace(/\*\*/g, '*')).ast.dependencies);
  });
});

describe('file singleton header — kind', () => {
  it('a `**` header makes a singleton', () => {
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
    'a constructor (#)': '"svc.bv": Svc #',
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

  it('names the entry and points to `**`', () => {
    expect(() => extract('*\n  n Integer\n  "svc.bv": Svc\n*\n@get = -> n\n'))
      .toThrow(`A '*' file header is a factory's params and takes no DI ('"svc.bv"') — inject it in a '**' header`);
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

  it('the same DI is fine in a `**` header', () => {
    for (const entry of Object.values(entries)) {
      expect(() => extract(`**\n  ${entry}\n**\n@get = -> 1\n`)).not.toThrow();
    }
  });
});

describe('file singleton header — the retired \'**{\'', () => {
  it('no DI', () => {
    expect(() => compileSource(`
      **{
        @get = -> 1
      }
    `)).toThrow("'**{ … }' is now 'actor { … }'");
  });

  it('delimited entries', () => {
    expect(() => compileSource(`
      ( value: Integer ) **{
        @get = -> value
      }
    `)).toThrow("'**{ … }' is now 'actor { … }'");
  });
});

describe('file singleton header — only at the head of a file', () => {
  it('after a declaration, actor { body } is an error', () => {
    expect(() => compileSource(`
      x = 1
      actor {
        @get = -> 1
      }
    `)).toThrow(/a file header must open the file/);
  });

  it('after a type, a lineal ** header is an error', () => {
    expect(() => compileSource(`
      type Point (x Integer)
      **
        value Integer
      **
      @get = -> value
    `)).toThrow(/a file header must open the file/);
  });

  it('a second header is an error', () => {
    expect(() => compileSource(`
      **
        value Integer
      **
      actor {
        @get = -> value
      }
    `)).toThrow(/Multiple file headers|must open the file/);
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

  it('is a class after a `**` header too', () => {
    expect(extract(`**\n${classFile}`).ast.fileKind).toBe('class');
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
      { output: { id: '1', re: '#<:1>', ty: ':', to: 'c' } },
      { input: { id: '2', op: [[6], '$new'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: '#<:2>', ty: ':', to: 'c' } },
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
  const section = /a singleton's constructor is declared with 'new ='/;

  it('the retired trailing `*` section', () => {
    expect(() => extract('count *Integer = 0\n*\n  seed Integer\n*\n@n = -> seed\n')).toThrow(section);
  });

  it('the retired trailing `*` section, after a `**` header', () => {
    expect(() => extract('**\ncount *Integer = 0\n*\n  seed Integer\n*\n@n = -> seed\n')).toThrow(section);
  });

  const di = /a constructor's params take no DI \(.*\) — declare it with 'use'/;
  const entries = {
    'a path': '"svc.bv": Svc',
    'a service': '"svc.bv": Svc { get () -> (Integer) }',
    'a constructor (#)': '"svc.bv": Svc #',
    'a path shorthand': ':document',
    'a destructure': 'HTML: (:div)',
  };
  for (const [label, entry] of Object.entries(entries)) {
    it(`refuses ${label} in its params`, () => {
      expect(() => extract(`count *Integer = 0\nnew =\n*\n  seed Integer\n  ${entry}\n*\n@n = -> seed\n`)).toThrow(di);
    });
  }

  it('refuses DI in delimited params', () => {
    expect(() => extract('new = ( "svc.bv": Svc, n Integer ) *{\n  @n = -> n\n}\n'))
      .toThrow(`a constructor's params take no DI ('"svc.bv"') — declare it with 'use'`);
  });

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
