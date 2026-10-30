import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A header entry is `key: binding [type]`. The key is a path; the binding is a
// local name, one member (`:div`), or a destructure group (`(:div, :span)`).
// No parens around a single name: `"thing.bv": Thing #`, not `(Thing)`.
//
// An inline definition (`{ … }` or `( … ) -> *{ … }`) is the file's statement
// of what it needs: the compiler checks calls against it and never consults
// the remote's document. A mismatch with the real service fails at runtime.
// ═══════════════════════════════════════════════════════════════════════════════

const deps = (header) => extract(`*\n  ${header}\n*\n@go = -> 1\n`).ast.dependencies
  .map(({ name, path, generic, destructures, constructorParams, interface: iface }) =>
    ({ name, path, generic, destructures, constructorParams, iface }));

describe('header bindings — forms', () => {
  it('"path": Name # — class dependency bound as Name', () => {
    expect(deps('"thing.bv": Thing #')).toEqual([
      expect.objectContaining({ name: 'Thing', path: 'thing.bv', generic: true }),
    ]);
  });

  it('"path": Name — service dependency bound as Name', () => {
    expect(deps('"svc.bv": Svc')).toEqual([expect.objectContaining({ name: 'Svc', path: 'svc.bv' })]);
  });

  it('"path": Name { iface } and a constructor profile', () => {
    expect(deps('"/db": DB { get (key: Text) -> (value: Text) }')[0])
      .toEqual(expect.objectContaining({ name: 'DB', iface: '{\n  get (key: Text) -> (value: Text)\n}' }));
    expect(deps('"lib.bv": Lib (a: Integer) -> *{ ping () -> . }')[0])
      .toEqual(expect.objectContaining({ name: 'Lib', constructorParams: [{ name: 'a', type: 'Integer' }] }));
  });

  it('Key: :member — one member, no parens', () => {
    expect(deps('HTML: :div')).toEqual(deps('HTML: (:div)'));
    expect(deps('"dom.bv": :div')).toEqual(deps('"dom.bv": (:div)'));
  });

  it('Key: Name # — a bare key with a binding', () => {
    expect(deps('Shapes: S #')).toEqual([expect.objectContaining({ name: 'S', path: 'Shapes', generic: true })]);
  });

  it('a typed keyed entry is a param supplied at construction', () => {
    const { ast } = extract('*\n  limit: Integer\n  size: n Integer\n*\n@go = -> limit\n');
    expect(ast.dependencies).toEqual([
      expect.objectContaining({ type: 'FileParam', name: 'limit', paramType: 'Integer' }),
      expect.objectContaining({ type: 'FileParam', key: 'size', name: 'n', paramType: 'Integer' }),
    ]);
  });

  it.each([
    ['HTML: Html', { name: 'Html', path: 'HTML' }],
    ['"svc.bv": Svc', { name: 'Svc', path: 'svc.bv' }],
    ['limit: n', { name: 'n', path: 'limit' }],
    ['limit:', { name: 'limit', path: 'limit' }],
  ])('an untyped keyed entry is a dependency resolved by its key: %s', (header, dep) => {
    expect(deps(header)).toEqual([expect.objectContaining({ ...dep, generic: false })]);
  });

  it('an untyped keyed entry with no remote document is a compile error', () => {
    expect(() => compile(extract('*\n  HTML: Html\n*\n@go = -> 1\n').ast))
      .toThrow(/'HTML' \(bound as 'Html'\) has no type/);
  });

  it('an untyped keyed entry takes its type from the remote document', () => {
    const src = '*\n  Store: S\n*\n@go = { S.ping() . }\n';
    expect(() => compile(extract(src).ast, { remotes: [{ path: 'Store', service: '{\n  ping () -> .\n}' }] }))
      .not.toThrow();
  });

  it(':Key — the whole thing under its own name', () => {
    expect(deps(':HTML')).toEqual([expect.objectContaining({ name: 'HTML', path: 'HTML' })]);
  });

  it.each([
    ['"thing.bv": (Thing) #', `'"thing.bv": (Thing)' is retired — write '"thing.bv": Thing #'`],
    ['"/db": (DB) { get () -> (Text) }', `'"/db": (DB)' is retired — write '"/db": DB { … }'`],
    ['Lib: (L) #', `'Lib: (L)' is retired — write 'Lib: L #'`],
    ['limit: (n) Integer', `'limit: (n)' is retired — write 'limit: n Integer'`],
  ])('single name in parens is retired: %s', (header, message) => {
    expect(() => deps(header)).toThrow(message);
  });
});

describe('inline definition wins over the remote document', () => {
  const header = '*\n  "/db": DB { get (key: Text) -> (value: Text) }\n*\n';
  const remotes = [{ path: '/db', service: '{\n  put (key: Text, value: Text) -> .\n}' }];
  const compileWith = (body) => compile(extract(header + body).ast, { remotes });

  it('a declared method compiles even when the remote lacks it', () => {
    expect(() => compileWith('@go = { :value Text = DB.get(key: "a"); return :value }\n')).not.toThrow();
  });

  it('an undeclared method is an error even when the remote has it', () => {
    expect(() => compileWith('@go = { DB.put(key: "a", value: "b") . }\n')).toThrow(/'DB' has no function 'put'/);
  });

  it('an inline constructor profile wins too', () => {
    const src = '*\n  "lib.bv": Lib (a: Integer) -> *{ ping () -> . }\n*\nl = Lib(a: 1)\n@go = { l.ping() . }\n';
    const libRemotes = [{ path: 'lib.bv', params: '(\n  Text\n)', service: '{\n  pong () -> .\n}' }];
    expect(() => compile(extract(src).ast, { remotes: libRemotes })).not.toThrow();
  });

  it('with no inline definition, the remote document is used', () => {
    const src = '*\n  "/db": DB\n*\n@go = { DB.put(key: "a", value: "b") . }\n';
    expect(() => compile(extract(src).ast, { remotes })).not.toThrow();
  });
});
