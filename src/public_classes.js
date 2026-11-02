// Public classes across files. A doc's constructor entry (`W () -> *{ … }`) is
// reached three ways, all sending `#new` with the class as its selector:
//
//   "svc.bv": (:W)    W()        to: `svc.bv @W`
//   "svc.bv": Svc     Svc.W()    to: `Svc @W`
//   s = Svc()         s.W()      to: `<s's address> @W`
//
// The caller's side lowers each to a dependency of its own, which every backend
// already knows how to construct. The receiver's side gains a `new@W` function per
// public class, which `#new` normalizes to the way `set` normalizes to `set@a`.

import * as AST from './ast.js';
import { resolveSuperclassChain } from './subclass.js';

// A constructor entry as the document of what it constructs.
function docOfClass(type) {
  const doc = {};
  for (const f of type.functions || []) (doc[f.name] ||= []).push(f);
  if (type.setters?.length) doc.__setters = Object.fromEntries(type.setters.map(s => [s.name, s]));
  return doc;
}

// `x W = W!()` names the class this construction produces, so nothing needs coercing.
const namesClass = (typeName, remote, local, alias) => {
  const bare = remote.replace(/!$/, '');
  return typeName === bare || typeName === local?.replace(/!$/, '') || typeName === `${alias}::${bare}`;
};

const constructionArgs = (args) => {
  const positional = args.filter(a => a.positional !== false && a.type !== 'NamedArgsBag').map(a => a.expr ?? a);
  const named = args.filter(a => a.positional === false);
  const bag = args.find(a => a.type === 'NamedArgsBag');
  const fields = { ...(bag?.fields || {}), ...Object.fromEntries(named.map(a => [a.name, a.expr ?? AST.identifier(a.name)]))};
  return Object.keys(fields).length ? [...positional, AST.namedArgsBag(fields)] : positional;
};

export function lowerPublicClassCalls(ast, remotesParsed, factoryDecls, dependencyNames) {
  const typesOf = (name) => remotesParsed[name]?.__types;
  const synthetic = new Set();
  // A class's constructor takes its ancestors' params too, wherever they're declared.
  const paramsOf = (type, seen = new Set()) => {
    const inherited = [];
    for (const st of type.supertypes || []) {
      const name = st.supertype ?? st;
      if (seen.has(name)) continue;
      seen.add(name);
      const parent = Object.values(remotesParsed).map(doc => doc.__types?.[name]).find(Boolean);
      if (parent) inherited.push(...paramsOf(parent, seen));
    }
    const own = type.initParams || [];
    return [...inherited.filter(p => !own.some(o => o.name === p.name)), ...own];
  };
  const addDependency = (name, target, type) => {
    if (synthetic.has(name)) return;
    synthetic.add(name);
    ast.dependencies.push({
      ...AST.dependency(name, { path: target, constructorArrow: type.effect === 'write' ? '=>' : '->', constructorParams: paramsOf(type) }),
      wireTarget: target,
    });
    remotesParsed[name] = { ...docOfClass(type), __types: { [name]: type } };
    factoryDecls[name] = paramsOf(type);
    dependencyNames.add(name);
  };

  // `(:W)` names a class: `W()` constructs it.
  for (const d of [...(ast.dependencies || [])]) {
    if (!Array.isArray(d.destructures)) continue;
    for (const entry of d.destructures) {
      const type = typesOf(d.name)?.[entry.remote];
      if (!type || entry.discard || entry.spread) continue;
      // It stays in the list: a template's `<W>` is checked against it.
      entry.isClass = true;
      addDependency(entry.local, `${d.name} @${entry.remote}`, type);
    }
  }

  const doesConstruct = (node, instances) => {
    if (node?.type !== 'DotCallExpr' || node.object?.type !== 'Identifier') return null;
    const name = node.object.name;
    const dep = instances.get(name) ?? (ast.dependencies.some(d => d.name === name) ? name : null);
    const type = dep && typesOf(dep)?.[node.method];
    return type ? { dep, type, viaInstance: instances.has(name) } : null;
  };

  const lower = (value, { dep, type, viaInstance }) => {
    const name = `${dep}.${value.method}`;
    addDependency(name, `${dep} @${value.method}`, type);
    return {
      ...AST.functionCallExpr(AST.identifier(name), constructionArgs(value.args || [])),
      ...(viaInstance ? { viaInstance: value.object.name, viaSelector: `@${value.method}` } : {}),
    };
  };

  const walk = (node, instances) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, instances)); return; }
    const scope = node.type === 'FunctionDecl' || node.type === 'Function' ? new Map(instances) : instances;
    if (['Assign', 'TypedAssign', 'StateAssign'].includes(node.type)) {
      const call = doesConstruct(node.value, scope);
      if (call) {
        const { method, object } = node.value;
        if (call.viaInstance && node.type === 'StateAssign') {
          throw new Error(`Cannot construct '${method}' on '${object.name}' at file level — '${object.name}' has no address yet; do it in a function`);
        }
        if (node.type === 'TypedAssign' && namesClass(node.typeName, method, null, call.dep)) {
          node.type = 'Assign';
          delete node.typeName;
        }
        node.value = lower(node.value, call);
        return;
      }
      if (node.value?.type === 'FunctionCallExpr' && node.value.callee?.type === 'Identifier') {
        const dep = ast.dependencies.find(d => d.name === node.value.callee.name);
        if (dep?.wireTarget && node.type === 'TypedAssign' && namesClass(node.typeName, dep.wireTarget.split(' @')[1], dep.name, dep.wireTarget.split(' @')[0])) {
          node.type = 'Assign';
          delete node.typeName;
        } else if (typesOf(dep?.name) && !dep.wireTarget) {
          scope.set(node.name, dep.name);
        }
      }
    }
    const nested = doesConstruct(node, scope);
    if (nested) throw new Error(`Bind the new '${node.method}' first: 'x = ${node.object.name}.${node.method}(…)'`);
    for (const key of ['constructorBody', ...Object.keys(node)]) {
      const v = node[key];
      if (v && typeof v === 'object') walk(v, scope);
    }
  };
  walk(ast.actors, new Map());

  // The parser marks a file-level construction of a dependency as a reference, but
  // it couldn't tell these apart from calls.
  for (const actor of ast.actors) {
    for (const s of actor.initBody || []) {
      if (s.type !== 'StateAssign' || !synthetic.has(s.value?.callee?.name)) continue;
      s.isRef = true;
      const decl = actor.stateVarDecls?.find(v => v.name === s.name);
      if (decl) Object.assign(decl, { typeName: s.value.callee.name, isRef: true });
    }
  }
}

// `new@W`: constructs the class and answers with the new actor's address.
export function addConstructHandlers(ast) {
  const file = ast.actors.find(a => !a.name);
  if (!file) return;
  const classes = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  for (const cls of classes.values()) {
    if (!cls.isPublic) continue;
    const { selector } = cls;
    const name = `new@${selector}`;
    if (file.functions?.some(f => f.name === name)) continue;
    const { inheritedParams } = resolveSuperclassChain(classes, cls);
    const own = cls.initParams || [];
    const params = [...inheritedParams.filter(p => !own.some(o => o.name === p.name)), ...own]
      .map(p => ({ ...p, accessor: undefined }));
    const positional = params.filter(p => p.positional).map(p => AST.identifier(p.name));
    const named = params.filter(p => !p.positional);
    const args = named.length
      ? [...positional, AST.namedArgsBag(Object.fromEntries(named.map(p => [p.key || p.name, AST.identifier(p.name)])))]
      : positional;
    const fn = AST.functionDecl(name, params, [AST.assign('_inst', AST.functionCallExpr(AST.identifier(cls.name), args))]);
    (file.functions ||= []).push(fn);
  }
}
