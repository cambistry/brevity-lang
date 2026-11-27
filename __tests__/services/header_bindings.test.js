import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A `use` entry is a binding, `target = source`: the target is a local name
// (typed or not), or a destructure (`:div`, `key: local`); the source is a
// `::` path the host resolves, its shape claimed with `as`. A lone source binds
// its last segment. See notes/use-as-binding-2026-11-18.md.
//
// An inline definition (`as { … }` or `as ( … ) -> *{ … }`) is the file's
// statement of what it needs: the compiler checks calls against it and never
// consults the remote's document. A mismatch with the real service fails at runtime.
// ═══════════════════════════════════════════════════════════════════════════════

const deps = (entry) => extract(`use ${entry}\n@go = () -> 1\n`).ast.dependencies
  .map(({ name, path, destructures, constructorParams, interface: iface }) =>
    ({ name, path, destructures, constructorParams, iface }));

describe('use bindings — forms', () => {
  it('Name = "path" — service dependency bound as Name', () => {
    expect(deps('Svc = "svc.bv"')).toEqual([expect.objectContaining({ name: 'Svc', path: 'svc.bv' })]);
  });

  it('Name = "path" as { iface }, and as a constructor profile', () => {
    expect(deps('DB = "/db" as { get (key: Text) -> (value: Text) }')[0])
      .toEqual(expect.objectContaining({ name: 'DB', iface: '{\n  get (key: Text) -> (value: Text)\n}' }));
    expect(deps('Lib = "lib.bv" as (a: Integer) -> *{ ping. () => . }')[0])
      .toEqual(expect.objectContaining({ name: 'Lib', constructorParams: [{ name: 'a', typeEnc: 'Integer', positional: false }] }));
  });

  it(':member = Source, Source::member and member = Source::member are one binding', () => {
    expect(deps('HTML::div')).toEqual(deps(':div = HTML'));
    expect(deps('div = HTML::div')).toEqual(deps(':div = HTML'));
    expect(deps(':div = "dom.bv"')).toEqual(deps('(:div) = "dom.bv"'));
  });

  it('S = Shapes — a bare source with a binding', () => {
    expect(deps('S = Shapes')).toEqual([expect.objectContaining({ name: 'S', path: 'Shapes' })]);
  });

  it('a typed binding is a value supplied at construction', () => {
    const { ast } = extract('use limit Integer = limit\nuse n Integer = size\n@go = () -> limit\n');
    expect(ast.dependencies).toEqual([
      expect.objectContaining({ type: 'FileParam', name: 'limit', paramTypeEnc: 'Integer' }),
      expect.objectContaining({ type: 'FileParam', key: 'size', name: 'n', paramTypeEnc: 'Integer' }),
    ]);
  });

  it.each([
    ['Html = HTML', { name: 'Html', path: 'HTML' }],
    ['Svc = "svc.bv"', { name: 'Svc', path: 'svc.bv' }],
    ['n = limit', { name: 'n', path: 'limit' }],
    ['limit', { name: 'limit', path: 'limit' }],
  ])('an untyped binding is a dependency resolved by its source: %s', (entry, dep) => {
    expect(deps(entry)).toEqual([expect.objectContaining(dep)]);
  });

  it('an untyped binding with no remote document is a compile error', () => {
    expect(() => compile(extract('use Html = HTML\n@go = () -> 1\n').ast))
      .toThrow(/'HTML' \(bound as 'Html'\) has no type/);
  });

  it('an untyped binding takes its type from the remote document', () => {
    const src = 'use S = Store\n@go. = { S.ping... }\n';
    expect(() => compile(extract(src).ast, { remotes: [{ path: 'Store', service: { public: { 'ping.': [{ writes: true }] } } }] }))
      .not.toThrow();
  });

  it('a lone name — the whole thing under its own name', () => {
    expect(deps('HTML')).toEqual([expect.objectContaining({ name: 'HTML', path: 'HTML' })]);
  });

});

describe('inline definition wins over the remote document', () => {
  const header = 'use DB = "/db" as { get (key: Text) -> (value: Text) }\n';
  const remotes = [{ path: '/db', service: { public: { 'put.': [{ args: [{ key: 'Text', value: 'Text' }], writes: true }] } } }];
  const compileWith = (body) => compile(extract(header + body).ast, { remotes });

  it('a declared method compiles even when the remote lacks it', () => {
    expect(() => compileWith('@go = { :value Text = DB.get(key: "a"); return :value }\n')).not.toThrow();
  });

  it('an undeclared method is an error even when the remote has it', () => {
    expect(() => compileWith('@go. = { DB.put(key: "a", value: "b")... }\n')).toThrow(/'DB' has no function 'put\.'/);
  });

  it('an inline constructor profile wins too', () => {
    const src = 'use Lib = "lib.bv" as (a: Integer) -> *{ ping. () => . }\nl = Lib(a: 1)\n@go. = { l.ping... }\n';
    const libRemotes = [{ path: 'lib.bv', params: '(\n  Text\n)', service: { public: { 'pong.': [{ writes: true }] } } }];
    expect(() => compile(extract(src).ast, { remotes: libRemotes })).not.toThrow();
  });

  it('with no inline definition, the remote document is used', () => {
    const src = 'use DB = "/db"\n@go. = { DB.put(key: "a", value: "b")... }\n';
    expect(() => compile(extract(src).ast, { remotes })).not.toThrow();
  });
});
