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
//   - a type of this file → its name in the program: its path (`W::X`), or its
//     bare name for a type of the file actor (`Point`);
//   - a type of an injected service → `Svc::X` / `Svc::C::X`, registered in
//     `ast.crossModuleTypes` with its authority (the service's path) and its
//     owner classes, so codegen can tag it `svc.bv:C:X`.
// A bare type becomes the one declared nearest the scope it's written in, and is
// rejected outside the actor it belongs to.

import { _opre_quote as quote } from './codegen/opre_tokens.js';
import { intern } from './type_enc.js';

const PATH_RE = /(?<![\w:@#])(\w+(?:::\w+)+)/g;

// A type's address: its authority ('' for this file), then the classes that own
// it and its name (src/codegen/type_table.js).
const addressOf = (authority, owner, name) => [authority, ...[...(owner || []), name].map(quote)].join(':');

// `t` with each address `from` maps rewritten.
const rewrite = (t, from) => {
  const walk = (v) => {
    if (typeof v === 'string') return from.get(v) ?? v;
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === '%names' ? x : walk(x)]));
  };
  return intern(walk(t));
};

const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPrefix = (prefix, path) => prefix.length <= path.length && prefix.every((x, i) => x === path[i]);

export function resolveTypePaths(ast, remotesParsed = {}, dependencyNames = new Set()) {
  const localTypes = ast.types || [];
  const bareOf = (t) => t.bareName ?? t.name;
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

  // The address each path resolves to, by how it's written: the parser could only
  // guess one reached through a local (`w::X`), whose class it can't know.
  const resolvedAddress = new Map();
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
      const decl = localTypes.find(t => bareOf(t) === name && samePath(t.owner || [], owner));
      if (!decl) throw new Error(`'${[...segments.slice(0, -1)].join('::')}' has no type '${name}'`);
      resolvedAddress.set(written, addressOf('', decl.ownerTokens ?? decl.owner, bareOf(decl)));
      return decl.name;
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
    resolvedAddress.set(written, addressOf(quote(dep?.path || base.alias), classes, name));
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

  // A bare type is the one declared in the nearest actor enclosing the scope. A
  // class's type is visible only inside the class. Its name in the program is
  // its path (`W::X`).
  const bareNames = new Set(owned.map(bareOf));
  const bareToName = (name, scope) => {
    if (!bareNames.has(name)) return name;
    const seen = localTypes.filter(t => bareOf(t) === name && isPrefix(t.owner || [], scope));
    if (seen.length) return seen.reduce((best, t) => ((t.owner || []).length > (best.owner || []).length ? t : best)).name;
    const t = owned.find(o => bareOf(o) === name);
    throw new Error(`'${name}' is a type of '${t.owner.join('::')}' — reach it as '${t.owner.join('::')}::${name}'`);
  };
  const bareString = (str, scope) => (typeof str === 'string' && bareNames.size
    ? str.replace(/(?<![\w:@#])\w+(?![\w:])/g, (m) => bareToName(m, scope))
    : str);

  // A type's text, rewritten to its key for the code generators, and its encoding,
  // with each path it reaches through a local at the address it resolved to.
  const settle = (node, k, scope, env) => {
    const text = node[k];
    node[k] = resolveString(bareString(text, scope), scope, env);
    const enc = node[`${k}Enc`];
    if (enc === undefined || !text.includes('::')) return;
    const fix = new Map();
    for (const m of text.match(PATH_RE) || []) {
      const address = resolvedAddress.get(m);
      if (address) fix.set(m.split('::').map(quote).join(':'), address);
    }
    if (fix.size) node[`${k}Enc`] = rewrite(enc, fix);
  };

  const visit = (node, scope, env) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, scope, env)); return; }
    if (node.type === 'TypeConstruction') {
      if (node.qualifier?.length) {
        const segments = [...node.qualifier, node.typeName];
        node.typeName = resolve(segments, scope, env);
        const address = resolvedAddress.get(segments.join('::'));
        if (address) node.typeNameEnc = intern(address);
        delete node.qualifier;
      } else {
        node.typeName = bareToName(node.typeName, scope);
      }
    }
    if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier') {
      const c = env.get(node.object.name) ?? (localClass(node.object.name, scope) ? { local: localClass(node.object.name, scope) } : null);
      if (c?.local && localTypes.some(t => bareOf(t) === node.method && samePath(t.owner || [], c.local))) {
        throw new Error(`'${node.method}' is a type, not a message — '${node.object.name}::${node.method}'`);
      }
    }
    for (const k of ['typeName', 'paramType']) {
      if (typeof node[k] === 'string' && node.type !== 'TypeConstruction') settle(node, k, scope, env);
    }
    if (typeof node.name === 'string' && typeof node.type === 'string' && 'positional' in node) settle(node, 'type', scope, env);
    for (const k of Object.keys(node)) if (k !== 'type') visit(node[k], scope, env);
  };
  for (const a of ast.actors || []) {
    const scope = scopeOf(a);
    visit([a.stateVarDecls, a.initParams, a.initBody, a.constructorBody, a.functions, a.asClauses, a.declarationReturn], scope, envOf.get(scope.join(' ')) || new Map());
  }
  // A type's own fields are written where the type is declared.
  for (const t of localTypes) {
    for (const f of t.fields || []) settle(f, 'paramType', t.owner || [], envOf.get((t.owner || []).join(' ')) || new Map());
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
