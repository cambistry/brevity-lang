import { compileSource } from '../helpers.js';
import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// File singleton header — `**`
//
// A file is a singleton, built once by its host at load. Its header is its DI:
//   **\n entries\n **\n body          — lineal (each `**` alone on its line)
//   **\n entries\n ** { body }         — lineal header, delimited body
//   ( entries ) **{ body }            — delimited
//   **\n body  |  **{ body }          — no DI
// Entries use the same grammar as the `*` header. Only the head of a file
// takes one: an inline singleton (`name = **{ … }`) has nobody to fill it.
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

  it('delimited: ( entries ) **{ body }', () => {
    expect(() => compileSource(`
      ( value: Integer ) **{
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

  it('no DI, delimited: **{ body }', () => {
    expect(() => compileSource(`
      **{
        @hello = -> greeting: "hi"
      }
    `)).not.toThrow();
  });

  it('lineal and delimited headers yield identical dependencies', () => {
    const lineal = extract(script);
    const delimited = extract(`
      ( "Remote": Remote { get () -> (Integer) }, name: Text, n Integer ) **{
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

describe('file singleton header — only at the head of a file', () => {
  it('after a declaration, ** { body } is an error', () => {
    expect(() => compileSource(`
      x = 1
      **{
        @get = -> 1
      }
    `)).toThrow(/a '\*\*' file header must open the file/);
  });

  it('after a type, a lineal ** header is an error', () => {
    expect(() => compileSource(`
      type Point (x Integer)
      **
        value Integer
      **
      @get = -> value
    `)).toThrow(/a '\*\*' file header must open the file/);
  });

  it('a second header is an error', () => {
    expect(() => compileSource(`
      **
        value Integer
      **
      **{
        @get = -> value
      }
    `)).toThrow(/Multiple file headers|must open the file/);
  });
});
