// Types reached through an actor: `A::X`, `A::B::X`. See
// notes/type-keyword-and-actor-scoped-types-2026-11-13.md.
//
// A type belongs to the actor whose constructor block declares it: the file
// actor, or a class (`TypeDecl.owner`, the path of classes from the file down).
// Inside that actor (and anything declared in it) the type is bare. Anywhere
// else it is reached through `::` on something whose class the compiler
// knows: a class or singleton of this file, an injected service, or a local
// holding an actor of a known class.
//
// This pass rewrites every such path, in a construction (`TypeConstruction`
// with a `qualifier`) or a type annotation, to the type's key:
//   - a type of this file → its bare name (`X`), which is unique in the file;
//   - a type of an injected service → `Svc::X` / `Svc::C::X`, registered in
//     `ast.crossModuleTypes` with its authority (the service's path) and its
//     owner classes, so codegen can tag it `svc.bv C X`.
// It also rejects a bare type used outside the actor it belongs to.

const PATH_RE = /(?<![\w:@#])(\w+(?:::\w+)+)/g;

const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPrefix = (prefix, path) => prefix.length <= path.length && prefix.every((x, i) => x === path[i]);

export function resolveTypePaths(ast, remotesParsed = {}, dependencyNames = new Set()) {
  const localTypes = ast.types || [];
  const owned = localTypes.filter(t => t.owner?.length);
  const hasQualified = JSON.stringify(ast).includes('::') || owned.length > 0;
  if (!hasQualified) return;

  const actors = (ast.actors || []).filter(a => a.name);
  const pathOf = (a) => a.classPath ?? [(a.singletonOf ?? a.selector ?? a.name).replace(/^@/, '')];
  // A class (or singleton) of this file, by any name it's written with.
  const classByName = new Map();
  for (const a of actors) {
    const path = pathOf(a);
    for (const n of [a.name, a.sourceName, a.selector, a.singletonOf, path[path.length - 1]]) {
      if (!n) continue;
      const key = n.replace(/^@/, '');
      if (!classByName.has(key)) classByName.set(key, []);
      classByName.get(key).push(path);
    }
  }
  // The class a head names, seen from `scope`: the nearest one declared in an
  // actor enclosing the scope.
  const localClass = (name, scope) => {
    const paths = (classByName.get(name.replace(/^@/, '')) || [])
      .filter(p => isPrefix(p.slice(0, -1), scope));
    if (!paths.length) return null;
    return paths.reduce((best, p) => (p.length > best.length ? p : best));
  };
  const deps = new Map((ast.dependencies || []).map(d => [d.name, d]));
  const isService = (name) => dependencyNames.has(name) && remotesParsed[name];

  // The class of an actor-valued expression, when the compiler can tell.
  const classOfValue = (value, scope) => {
    if (!value || typeof value !== 'object') return null;
    if (value.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier') {
      const p = localClass(value.callee.name, scope);
      return p ? { local: p } : null;
    }
    if (value.type === 'DotCallExpr' && value.object?.type === 'Identifier' && isService(value.object.name)) {
      if (remotesParsed[value.object.name].__types?.[value.method]) {
        return { alias: value.object.name, classes: [value.method] };
      }
    }
    return null;
  };
  const classOfType = (typeName, scope) => {
    if (typeof typeName !== 'string' || !/^@?\w+$/.test(typeName)) return null;
    const p = localClass(typeName, scope);
    return p ? { local: p } : null;
  };

  // Locals holding actors of a known class, per actor (plus what its
  // enclosing actors hold).
  const envOf = new Map();
  const collect = (node, scope, env) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => collect(n, scope, env)); return; }
    if ((node.type === 'Assign' || node.type === 'TypedAssign' || node.type === 'RefDecl') && node.name) {
      const c = classOfValue(node.value, scope) ?? classOfType(node.typeName, scope);
      if (c) env.set(node.name, c);
    }
    if (typeof node.name === 'string' && typeof node.type === 'string' && 'positional' in node) {
      const c = classOfType(node.type, scope);
      if (c) env.set(node.name, c);
    }
    for (const k of Object.keys(node)) if (k !== 'type') collect(node[k], scope, env);
  };
  const scopeOf = (a) => (a.name ? pathOf(a) : []);
  const fileActors = (ast.actors || []).filter(a => !a.name);
  const ordered = [...fileActors, ...actors].sort((x, y) => scopeOf(x).length - scopeOf(y).length);
  for (const a of ordered) {
    const scope = scopeOf(a);
    const outer = [...envOf.entries()].filter(([k]) => isPrefix(k.split(' ').filter(Boolean), scope) && k !== scope.join(' '))
      .sort((x, y) => x[0].length - y[0].length);
    const env = new Map();
    for (const [, e] of outer) for (const [k, v] of e) env.set(k, v);
    collect([a.stateVarDecls, a.initParams, a.initBody, a.constructorBody, a.functions], scope, env);
    envOf.set(scope.join(' '), env);
  }

  // Resolve one path (`A::B::X`), written in `scope`.
  const resolve = (segments, scope, env) => {
    const written = segments.join('::');
    const [head, ...rest] = segments;
    const name = rest[rest.length - 1];
    const between = rest.slice(0, -1);
    let base = env.get(head) ?? null;
    if (!base && isService(head)) base = { alias: head, classes: [] };
    if (!base) {
      const p = localClass(head, scope);
      if (p) base = { local: p };
    }
    if (!base) {
      if (dependencyNames.has(head) || deps.has(head)) return written; // a document that isn't known: left to the dependency checks
      throw new Error(`Can't tell the class of '${head}' in '${written}'`);
    }
    if (base.local) {
      const owner = [...base.local, ...between];
      const decl = localTypes.find(t => t.name === name && samePath(t.owner || [], owner));
      if (!decl) throw new Error(`'${[...segments.slice(0, -1)].join('::')}' has no type '${name}'`);
      return name;
    }
    const classes = [...base.classes, ...between];
    let doc = remotesParsed[base.alias];
    let decls = doc?.__typeDecls;
    for (const c of classes) {
      const cls = doc?.__types?.[c];
      if (cls) { decls = cls.typeDecls; doc = null; continue; }
      const sub = doc?.__services?.[c];
      if (sub) { doc = sub; decls = sub.__typeDecls; continue; }
      throw new Error(`'${base.alias}' has no class '${c}'`);
    }
    if (!decls?.[name]) {
      // `Svc::Point` on its own is checked by validateCrossModuleTypeRefs, which
      // knows whether the document says anything about types.
      if (!classes.length) return written;
      throw new Error(`'${segments.slice(0, -1).join('::')}' has no type '${name}'`);
    }
    const key = [base.alias, ...classes, name].join('::');
    const dep = deps.get(base.alias);
    (ast.crossModuleTypes ||= {})[key] = {
      name, fields: decls[name].fields, path: dep?.path || base.alias, ...(classes.length ? { owner: classes } : {}),
    };
    return key;
  };
  // In an annotation, `Alias::Name` with an alias nobody declared is left for
  // validateCrossModuleTypeRefs to report.
  const knownHead = (head, env, scope) => env.has(head) || dependencyNames.has(head) || deps.has(head) || !!localClass(head, scope);
  const resolveString = (str, scope, env) => (typeof str === 'string' && str.includes('::')
    ? str.replace(PATH_RE, (m) => {
      const segments = m.split('::');
      return segments.length === 2 && !knownHead(segments[0], env, scope) ? m : resolve(segments, scope, env);
    })
    : str);

  // A bare type that belongs to a class is visible only inside it.
  const ownedByName = new Map(owned.map(t => [t.name, t]));
  const checkBare = (name, scope) => {
    const t = ownedByName.get(name);
    if (t && !isPrefix(t.owner, scope)) {
      throw new Error(`'${name}' is a type of '${t.owner.join('::')}' — reach it as '${t.owner.join('::')}::${name}'`);
    }
  };
  const checkBareString = (str, scope) => {
    if (typeof str !== 'string' || !ownedByName.size) return;
    for (const m of str.matchAll(/(?<![\w:@#])\w+(?![\w:])/g)) checkBare(m[0], scope);
  };

  const visit = (node, scope, env) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, scope, env)); return; }
    if (node.type === 'TypeConstruction') {
      if (node.qualifier?.length) {
        node.typeName = resolve([...node.qualifier, node.typeName], scope, env);
        delete node.qualifier;
      } else {
        checkBare(node.typeName, scope);
      }
    }
    if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier') {
      const c = env.get(node.object.name) ?? (localClass(node.object.name, scope) ? { local: localClass(node.object.name, scope) } : null);
      if (c?.local && localTypes.some(t => t.name === node.method && samePath(t.owner || [], c.local))) {
        throw new Error(`'${node.method}' is a type, not a message — '${node.object.name}::${node.method}'`);
      }
    }
    for (const k of ['typeName', 'paramType']) {
      if (typeof node[k] === 'string' && node.type !== 'TypeConstruction') {
        checkBareString(node[k], scope);
        node[k] = resolveString(node[k], scope, env);
      }
    }
    if (typeof node.name === 'string' && typeof node.type === 'string' && 'positional' in node) {
      checkBareString(node.type, scope);
      node.type = resolveString(node.type, scope, env);
    }
    for (const k of Object.keys(node)) if (k !== 'type') visit(node[k], scope, env);
  };
  for (const a of ast.actors || []) {
    const scope = scopeOf(a);
    visit([a.stateVarDecls, a.initParams, a.initBody, a.constructorBody, a.functions, a.asClauses, a.declarationReturn], scope, envOf.get(scope.join(' ')) || new Map());
  }
  // A type's own fields are written where the type is declared.
  for (const t of localTypes) {
    for (const f of t.fields || []) {
      f.paramType = resolveString(f.paramType, t.owner || [], envOf.get((t.owner || []).join(' ')) || new Map());
    }
  }
}

// `type Box` and a class `Box` / `@Box` declared in the same actor conflict.
export function checkTypeClassConflicts(ast) {
  const classPaths = (ast.actors || []).filter(a => a.name)
    .map(a => a.classPath ?? [(a.singletonOf ?? a.selector ?? a.name).replace(/^@/, '')]);
  for (const t of ast.types || []) {
    const path = [...(t.owner || []), t.name];
    if (classPaths.some(p => samePath(p, path))) {
      throw new Error(`'${t.name}' is declared as both a type and a class`);
    }
  }
}
