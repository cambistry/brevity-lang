// Public classes across files. A doc's constructor entry (`W () -> *{ … }`) is
// reached three ways, all sending `#new` with the class as its selector:
//
//   "svc.bv": (:W)    W()        to: `svc.bv W`
//   "svc.bv": Svc     Svc.W()    to: `Svc W`
//   s = Svc()         s.W()      to: `<s's address> W`
//
// The caller's side lowers each to a dependency of its own, which every backend
// already knows how to construct. The receiver's side gains a `new@W` function per
// public class, which `#new` normalizes to the way `set` normalizes to `set@a`.

import * as AST from './ast.js';
import { lowerConstructionChains } from './chains.js';
import { resolveSuperclassChain } from './subclass.js';
import { _opre_join as joinAddress, _opre_quote as quoteToken } from './codegen/opre_tokens.js';

// A constructor entry as the document of what it constructs.
function docOfClass(type) {
  const doc = {};
  for (const f of type.functions || []) (doc[f.name] ||= []).push(f);
  if (type.setters?.length) doc.__setters = Object.fromEntries(type.setters.map(s => [s.name, s]));
  // A public singleton in the class: `b.tally.get()` for a `b = Svc.Box(1)`.
  if (type.services) doc.__services = type.services;
  return doc;
}

// `x W = W!()` names the class this construction produces, so nothing needs coercing.
const namesClass = (typeName, remote, local) => {
  const bare = remote.replace(/!$/, '');
  return typeName === bare || typeName === local?.replace(/!$/, '');
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
  // A class of a dependency is reached at the dependency's address and the
  // class's token: `Svc Counter`.
  const addDependency = (name, dep, cls, type) => {
    if (synthetic.has(name)) return;
    synthetic.add(name);
    const target = joinAddress([dep, cls]);
    ast.dependencies.push({
      ...AST.dependency(name, { path: target, constructorArrow: type.effect === 'write' ? '=>' : '->', constructorParams: paramsOf(type) }),
      wireTarget: target,
      wireClass: cls,
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
      addDependency(entry.local, d.name, entry.remote, type);
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
    addDependency(name, dep, value.method, type);
    return {
      ...AST.functionCallExpr(AST.identifier(name), constructionArgs(value.args || [])),
      ...(viaInstance ? { viaInstance: value.object.name, viaSelector: quoteToken(value.method) } : {}),
    };
  };

  // A bare entry is an actor to talk to. `#` or a declared constructor is something to
  // construct one from. An entry with no document might be a type, so it isn't checked.
  const depNamed = (name) => ast.dependencies.find(d => d.name === name && !d.wireTarget);
  const constructsActors = (dep) => Boolean(dep.generic || dep.constructorParams);
  const checkHeaderKind = (node) => {
    if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier') {
      const dep = depNamed(node.callee.name);
      if (dep && !constructsActors(dep) && (dep.interface || remotesParsed[dep.name])) {
        throw new Error(`'${dep.name}' is already an actor, with no constructor signature, so there's nothing to construct — message it, or to construct one, import it as '"${dep.path}": ${dep.name} #'`);
      }
    }
    if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier') {
      const dep = depNamed(node.object.name);
      if (dep && constructsActors(dep)) {
        throw new Error(`'${dep.name}' isn't an actor yet, so it can't be messaged — construct one first: 'x = ${dep.name}(…)'`);
      }
    }
  };

  // `Svc::Point` names a type in Svc's document. A class has no `::` form.
  const checkQualifiedType = (node) => {
    if (node.type !== 'TypedAssign' || typeof node.typeName !== 'string') return;
    for (const [written, alias, member] of node.typeName.matchAll(/(\w+)::(\w+)/g)) {
      const dep = depNamed(alias);
      if (!dep) throw new Error(`'${alias}' in '${written}' isn't in the header`);
      const doc = remotesParsed[alias];
      if (!doc) continue;
      if (doc.__types?.[member]) {
        throw new Error(`'${written}' names a class, and '::' is for types — annotate it '${node.name} ${member}'`);
      }
      if (!doc.__typeDecls?.[member]) throw new Error(`'${alias}' has no type '${member}'`);
    }
  };

  const walk = (node, instances, inFunction = false) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, instances, inFunction)); return; }
    const isFunction = node.type === 'FunctionDecl' || node.type === 'Function';
    const scope = isFunction ? new Map(instances) : instances;
    const inside = inFunction || isFunction;
    checkHeaderKind(node);
    checkQualifiedType(node);
    if (['Assign', 'TypedAssign', 'StateAssign'].includes(node.type)) {
      if (node.value && typeof node.value === 'object') checkHeaderKind(node.value);
      const call = doesConstruct(node.value, scope);
      if (call) {
        const { method, object } = node.value;
        if (call.viaInstance && node.type === 'StateAssign') {
          throw new Error(`Cannot construct '${method}' on '${object.name}' at file level — '${object.name}' has no address yet; do it in a function`);
        }
        if (node.type === 'TypedAssign' && namesClass(node.typeName, method, null)) {
          node.type = 'Assign';
          delete node.typeName;
        }
        node.value = lower(node.value, call);
        return;
      }
      if (node.value?.type === 'FunctionCallExpr' && node.value.callee?.type === 'Identifier') {
        const dep = ast.dependencies.find(d => d.name === node.value.callee.name);
        if (dep?.wireTarget && node.type === 'TypedAssign' && namesClass(node.typeName, dep.wireClass, dep.name)) {
          node.type = 'Assign';
          delete node.typeName;
        } else if (typesOf(dep?.name) && !dep.wireTarget) {
          scope.set(node.name, dep.name);
        }
      }
    }
    const nested = doesConstruct(node, scope);
    if (nested) {
      // Nothing outside a function can wait for the reply mid-expression.
      if (!inside) throw new Error(`Bind the new '${node.method}' first: 'x = ${node.object.name}.${node.method}(…)'`);
      const lowered = lower(node, nested);
      for (const key of Object.keys(node)) delete node[key];
      Object.assign(node, lowered);
    }
    for (const key of ['constructorBody', ...Object.keys(node)]) {
      const v = node[key];
      if (v && typeof v === 'object') walk(v, scope, inside);
    }
  };
  walk(ast.actors, new Map());

  // A param can be typed as a class from another file, which holds that actor's address.
  ast.remoteClassNames = new Set(Object.values(remotesParsed)
    .flatMap(doc => Object.keys(doc?.__types || {}))
    .map(name => name.replace(/!$/, '')));

  inferActorParams(ast);

  // A call on a new actor needs its address first.
  lowerConstructionChains(
    { actors: ast.actors },
    new Set(ast.dependencies.filter(d => d.wireTarget || constructsActors(d)).map(d => d.name)),
  );

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

// An untyped param of a private function can hold an actor of this file. Rust and Erlang
// have to know that at compile time, unlike an address, and a private function's callers
// are all here: when they agree on one class, that's the param's type.
function inferActorParams(ast) {
  const classNames = new Set(ast.actors.map(a => a.name).filter(Boolean));
  for (const actor of ast.actors) {
    const functions = (actor.functions || []).filter(f => f.type === 'FunctionDecl' && typeof f.name === 'string' && !/^[@#]/.test(f.name));
    const candidates = new Map();
    for (const f of functions) {
      const untyped = (f.params || []).map((p, i) => ({ p, i })).filter(({ p }) => p.positional && (!p.type || p.type === 'Anything') && !p.rest);
      if (untyped.length && functions.filter(o => o.name === f.name).length === 1) candidates.set(f.name, { untyped, seen: new Map() });
    }
    if (!candidates.size) continue;

    const classOfArg = (arg, locals) => {
      if (arg?.type === 'FunctionCallExpr' && classNames.has(arg.callee?.name)) return arg.callee.name;
      if (arg?.type === 'Identifier') return locals.get(arg.name) ?? null;
      return null;
    };
    const visit = (node, locals) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, locals)); return; }
      if (node.type === 'Assign' && node.name) {
        const cls = classOfArg(node.value, locals);
        if (cls) locals.set(node.name, cls);
      }
      const target = node.type === 'FunctionCallExpr' && candidates.get(node.callee?.name);
      if (target) {
        for (const { p, i } of target.untyped) {
          const cls = classOfArg(node.args?.[i], locals);
          const previous = target.seen.get(p);
          target.seen.set(p, previous === undefined || previous === cls ? cls : null);
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, locals);
    };
    for (const f of actor.functions || []) visit(f.body, new Map());
    for (const { seen } of candidates.values()) {
      for (const [p, cls] of seen) if (cls) p.type = cls;
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
