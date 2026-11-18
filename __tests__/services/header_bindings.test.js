import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A `use` entry is a binding, `target = source`: the target is a local name
// (typed, or `#`), or a destructure (`:div`, `key: local`); the source is a
// `::` path the host resolves, its shape claimed with `as`. A lone source binds
// its last segment. See notes/use-as-binding-2026-11-18.md.
//
// An inline definition (`as { … }` or `as ( … ) -> *{ … }`) is the file's
// statement of what it needs: the compiler checks calls against it and never
// consults the remote's document. A mismatch with the real service fails at runtime.
// ═══════════════════════════════════════════════════════════════════════════════

const deps = (entry) => extract(`use ${entry}\n@go = -> 1\n`).ast.dependencies
  .map(({ name, path, generic, destructures, constructorParams, interface: iface }) =>
    ({ name, path, generic, destructures, constructorParams, iface }));

describe('use bindings — forms', () => {
  it('Name = "path" as # — class dependency bound as Name', () => {
    expect(deps('Thing = "thing.bv" as #')).toEqual([
      expect.objectContaining({ name: 'Thing', path: 'thing.bv', generic: true }),
    ]);
  });

  it('Name # = "path" — the same claim on the target', () => {
    expect(deps('Thing # = "thing.bv"')).toEqual(deps('Thing = "thing.bv" as #'));
  });

  it('Name = "path" — service dependency bound as Name', () => {
    expect(deps('Svc = "svc.bv"')).toEqual([expect.objectContaining({ name: 'Svc', path: 'svc.bv' })]);
  });

  it('Name = "path" as { iface }, and as a constructor profile', () => {
    expect(deps('DB = "/db" as { get (key: Text) -> (value: Text) }')[0])
      .toEqual(expect.objectContaining({ name: 'DB', iface: '{\n  get (key: Text) -> (value: Text)\n}' }));
    expect(deps('Lib = "lib.bv" as (a: Integer) -> *{ ping. () => . }')[0])
      .toEqual(expect.objectContaining({ name: 'Lib', constructorParams: [{ name: 'a', type: 'Integer' }] }));
  });

  it(':member = Source, Source::member and member = Source::member are one binding', () => {
    expect(deps('HTML::div')).toEqual(deps(':div = HTML'));
    expect(deps('div = HTML::div')).toEqual(deps(':div = HTML'));
    expect(deps(':div = "dom.bv"')).toEqual(deps('(:div) = "dom.bv"'));
  });

  it('S = Shapes as # — a bare source with a binding', () => {
    expect(deps('S = Shapes as #')).toEqual([expect.objectContaining({ name: 'S', path: 'Shapes', generic: true })]);
  });

  it('a typed binding is a value supplied at construction', () => {
    const { ast } = extract('use limit Integer = limit\nuse n Integer = size\n@go = -> limit\n');
    expect(ast.dependencies).toEqual([
      expect.objectContaining({ type: 'FileParam', name: 'limit', paramType: 'Integer' }),
      expect.objectContaining({ type: 'FileParam', key: 'size', name: 'n', paramType: 'Integer' }),
    ]);
  });

  it.each([
    ['Html = HTML', { name: 'Html', path: 'HTML' }],
    ['Svc = "svc.bv"', { name: 'Svc', path: 'svc.bv' }],
    ['n = limit', { name: 'n', path: 'limit' }],
    ['limit', { name: 'limit', path: 'limit' }],
  ])('an untyped binding is a dependency resolved by its source: %s', (entry, dep) => {
    expect(deps(entry)).toEqual([expect.objectContaining({ ...dep, generic: false })]);
  });

  it('an untyped binding with no remote document is a compile error', () => {
    expect(() => compile(extract('use Html = HTML\n@go = -> 1\n').ast))
      .toThrow(/'HTML' \(bound as 'Html'\) has no type/);
  });

  it('an untyped binding takes its type from the remote document', () => {
    const src = 'use S = Store\n@go. = { S.ping... }\n';
    expect(() => compile(extract(src).ast, { remotes: [{ path: 'Store', service: '{\n  ping. () => .\n}' }] }))
      .not.toThrow();
  });

  it('a lone name — the whole thing under its own name', () => {
    expect(deps('HTML')).toEqual([expect.objectContaining({ name: 'HTML', path: 'HTML' })]);
  });

  it.each([
    ['"thing.bv": (Thing) #', `'"thing.bv": (Thing) #' is a retired header entry — write 'use Thing = "thing.bv" as #'`],
    ['"/db": DB { get () -> (Text) }', `'"/db": DB { get () -> (Text) }' is a retired header entry — write 'use DB = "/db" as { … }'`],
    ['Lib: L #', `'Lib: L #' is a retired header entry — write 'use L # = Lib'`],
    ['limit: n Integer', `'limit: n Integer' is a retired header entry — write 'use n Integer = limit'`],
  ])('a header entry is retired: %s', (entry, message) => {
    expect(() => deps(entry)).toThrow(message);
  });
});

describe('inline definition wins over the remote document', () => {
  const header = 'use DB = "/db" as { get (key: Text) -> (value: Text) }\n';
  const remotes = [{ path: '/db', service: '{\n  put. (key: Text, value: Text) => .\n}' }];
  const compileWith = (body) => compile(extract(header + body).ast, { remotes });

  it('a declared method compiles even when the remote lacks it', () => {
    expect(() => compileWith('@go = { :value Text = DB.get(key: "a"); return :value }\n')).not.toThrow();
  });

  it('an undeclared method is an error even when the remote has it', () => {
    expect(() => compileWith('@go. = { DB.put(key: "a", value: "b")... }\n')).toThrow(/'DB' has no function 'put\.'/);
  });

  it('an inline constructor profile wins too', () => {
    const src = 'use Lib = "lib.bv" as (a: Integer) -> *{ ping. () => . }\nl = Lib(a: 1)\n@go. = { l.ping... }\n';
    const libRemotes = [{ path: 'lib.bv', params: '(\n  Text\n)', service: '{\n  pong. () => .\n}' }];
    expect(() => compile(extract(src).ast, { remotes: libRemotes })).not.toThrow();
  });

  it('with no inline definition, the remote document is used', () => {
    const src = 'use DB = "/db"\n@go. = { DB.put(key: "a", value: "b")... }\n';
    expect(() => compile(extract(src).ast, { remotes })).not.toThrow();
  });
});
