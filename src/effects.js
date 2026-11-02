// Whether a function writes, and whether its name says so. A function that writes
// must be `!` or `.`, so a missing suffix is a guarantee. The check is local: a
// callee's effect comes from its name, or from its doc's arrow if it's foreign, and
// the callee's own body answers for that name.
// Design: notes/mutation-suffix-2026-10-31.md.

import { parseInterface } from './codegen/javascript/types.js';
import { resolveSuperclassChain } from './subclass.js';

const isSuffixed = (name) => name.endsWith('!') || name.endsWith('.');

function functionsOf(actor) {
  return (actor.functions || []).filter(f =>
    f.type === 'FunctionDecl' && typeof f.name === 'string' && !f.actorDef && !f.emptyOverload);
}

// Handlers with no caller-facing name to mark, including inline ones like
// `onclick={ … }`, which become functions named `@0`, `@1`.
const isUnnamedHandler = (name) =>
  /^@\d+$/.test(name) || name === 'set' || name === 'update' || name === 'as' || name.startsWith('set@') || name.startsWith('update@') || name.startsWith('subscribe');

// Calls name a class bare, while a public class is declared with its `@`.
const classesByName = (ast) => new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));

const typeNameOf = (type) => (typeof type === 'string' ? type.trim().replace(/^[*&]/, '') : null);

// A function type's own arrow, skipping any inside its params or result.
function functionTypeArrow(type) {
  if (typeof type !== 'string') return null;
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    if ('({'.includes(type[i])) depth++;
    else if (')}'.includes(type[i])) depth--;
    else if (depth === 0 && /^[-=~]>/.test(type.slice(i, i + 2))) return type.slice(i, i + 2);
  }
  return null;
}

export function checkEffects(ast, remotesParsed = {}) {
  const classes = classesByName(ast);
  const dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  const claimedByActor = purportedFunctions(ast, parseInterface);

  // A file constructor's `!` and its doc's arrow must agree.
  for (const d of ast.dependencies || []) {
    if (!d.constructorArrow) continue;
    const writes = d.constructorArrow === '=>';
    if (writes && !d.name.endsWith('!')) throw new Error(`'${d.name}' is declared with '=>', so its alias must be '${d.name}!'`);
    if (!writes && d.name.endsWith('!')) throw new Error(`'${d.name}' is declared with '->', so its alias can't carry '!'`);
  }

  for (const actor of ast.actors) {
    const untrackedNames = new Set(
      [...(actor.stateVarDecls || []), ...(actor.functions || [])].filter(d => d.untracked).map(d => d.name.replace(/^@/, '')),
    );
    const stateNames = new Set((actor.stateVarDecls || []).map(d => d.name.replace(/^@/, '')));
    const functions = functionsOf(actor);
    const claimed = claimedByActor.get(actor);
    const emits = new Set((actor.constructorBody || []).filter(s => s.type === 'EmitDecl').map(s => s.name));
    const inherits = new Set();
    for (const sup of actor.supertypes || []) {
      for (const f of functionsOf(classes.get(sup.supertype) || {})) inherits.add(f.name);
    }

    // A dependency's signature for `obj.method`, by alias or by the alias it was
    // constructed from.
    const instanceOf = new Map();
    for (const s of actor.initBody || []) {
      const callee = s.value?.callee?.name;
      if (s.type === 'StateAssign' && callee) instanceOf.set(s.name.replace(/^@/, ''), callee);
    }
    for (const d of actor.stateVarDecls || []) {
      if (!instanceOf.has(d.name.replace(/^@/, '')) && typeNameOf(d.typeName)) instanceOf.set(d.name.replace(/^@/, ''), typeNameOf(d.typeName));
    }
    for (const p of actor.initParams || []) if (typeNameOf(p.type)) instanceOf.set(p.name, typeNameOf(p.type));
    const docSignatures = (alias, method) => {
      const parsed = remotesParsed[alias];
      if (parsed?.[method]) return parsed[method];
      if (parsed?.['@' + method]) return parsed['@' + method];
      for (const type of Object.values(parsed?.__types || {})) {
        const found = (type.functions || []).filter(f => f.name === method);
        if (found.length) return found;
      }
      return null;
    };
    const depAliasFor = (name, scope) => {
      if (dependencyNames.has(name)) return name;
      const ctor = scope.instances.get(name) ?? instanceOf.get(name);
      return ctor && dependencyNames.has(ctor) ? ctor : null;
    };

    // Reports the first write reached from `node`, by walking in statement order so
    // that a fresh actor stops being fresh once it has escaped.
    const walk = (node, scope) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => walk(n, scope)); return; }
      switch (node.type) {
        case 'SubscribeCall':
          walk(node.target, scope);
          return;
        case 'OnHandler':
          return;
        case 'RefDecl':
          scope.locals.add(node.name);
          walk(node.value, scope);
          return;
        case 'Assign':
        case 'TypedAssign': {
          if (node.value?.type === 'Function') {
            checkLocalFunction(node, scope);
            return;
          }
          walk(node.value, scope);
          const root = receiverRoot(node.value);
          if (isConstruction(root) || (root?.type === 'Identifier' && scope.fresh.has(root.name))) scope.fresh.add(node.name);
          if (node.value?.type === 'FunctionCallExpr' && node.value.callee?.name) scope.instances.set(node.name, node.value.callee.name);
          else if (typeNameOf(node.typeName)) scope.instances.set(node.name, typeNameOf(node.typeName));
          if (node.value?.type === 'Identifier') scope.fresh.delete(node.value.name);
          return;
        }
        case 'Function': {
          // An anonymous function's writes belong to the function defining it.
          const inner = { ...scope, locals: new Set(scope.locals) };
          for (const p of node.params || []) inner.locals.add(p.name);
          walk(node.body, inner);
          return;
        }
        case 'SetStatement':
        case 'ActorSetStatement':
          if (!scope.locals.has(node.name) && !untrackedNames.has(node.name.replace(/^@/, ''))) {
            scope.write(`${node.name} ${node.updateOp || '<-'} …`);
          }
          escapeNames(node.value ?? node.args, scope);
          walk(node.value ?? node.args, scope);
          return;
        case 'ActorFieldSet':
          if (!scope.fresh.has(node.objectName) && !untrackedNames.has(node.objectName.replace(/^@/, ''))) {
            scope.write(`${node.objectName}.${node.fieldName} <- …`);
          }
          walk(node.value, scope);
          return;
        case 'TypeConstruction':
          checkReadOnlySlots(
            ast.types?.find(t => t.name === node.typeName)?.fields?.map(f => ({ name: f.name, type: f.paramType })),
            node.args || [], node.typeName, scope,
          );
          walk(node.args, scope);
          return;
        case 'FunctionCallExpr':
          call(node, scope);
          return;
        case 'DotCallExpr':
          member(node, node.method, scope);
          return;
        case 'DotAccessExpr':
          member(node, node.property, scope);
          return;
        case 'FnRef':
          if (scope.localFunctions.has(node.name) && isSuffixed(node.name)) {
            throw new Error(`'&${node.name}' — a '${node.name.slice(-1)}' function declared in a body can't be passed by reference yet. Declare it at file level`);
          }
          if (refWrites(node, scope)) scope.write(`&${node.name}`);
          return;
        case 'ExprStatement':
          walk(node.expr, scope);
          scope.discard(node);
          return;
        default:
          for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, scope);
      }
    };

    // Whether the named function a `&name` refers to writes.
    const refWrites = (node, scope) =>
      scope.writingParams.has(node.name) || (isSuffixed(node.name) && !untrackedNames.has(node.name));

    const receiverRoot = (node) => {
      let cur = node;
      while (cur?.type === 'DotCallExpr' || cur?.type === 'DotAccessExpr') cur = cur.object;
      return cur;
    };
    const isConstruction = (node) =>
      node?.type === 'FunctionCallExpr' && (classes.has(node.callee?.name) || dependencyNames.has(node.callee?.name));

    const escapeNames = (node, scope) => {
      if (!node || typeof node !== 'object' || node.type === 'Function') return;
      if (Array.isArray(node)) { node.forEach(n => escapeNames(n, scope)); return; }
      if (node.type === 'Identifier') { scope.fresh.delete(node.name); return; }
      if (node.type === 'DotCallExpr' || node.type === 'DotAccessExpr' || node.type === 'FunctionCallExpr') return;
      for (const v of Object.values(node)) if (v && typeof v === 'object') escapeNames(v, scope);
    };

    const call = (node, scope) => {
      const name = node.callee?.type === 'Identifier' ? node.callee.name : null;
      if (name) checkReadOnlySlots(calleeParams(name, scope), node.args || [], name, scope);
      for (const arg of node.args || []) {
        escapeNames(arg, scope);
        walk(arg, scope);
      }
      if (!name) { walk(node.callee, scope); return; }
      if (classes.has(name)) {
        if (classes.get(name).sourceName) scope.write(`${name}!(…)`);
        return;
      }
      if (emits.has(name)) { scope.write(`${name}(…)`); return; }
      const local = scope.localFunctions.get(name);
      if (local) {
        if (local.writesOutside) scope.write(`${name}(…)`);
        return;
      }
      if (scope.writingParams.has(name)) { scope.write(`${name}(…)`); return; }
      if (claimed.has(name)) scope.mightWrite();
      if (isSuffixed(name) && !untrackedNames.has(name.replace(/^@/, ''))) scope.write(`${name}(…)`);
    };

    // Overloads may differ in a slot's arrow, so only a lone signature decides it.
    const loneParams = (sigs) => (sigs?.length === 1 ? sigs[0].params : null);
    const classParams = (cls) => [...resolveSuperclassChain(classes, cls).inheritedParams, ...(cls.initParams || [])];
    const calleeParams = (name, scope) => {
      const local = scope.localFunctions.get(name);
      if (local) return local.params;
      if (classes.has(name)) return classParams(classes.get(name));
      const dependency = ast.dependencies?.find(d => d.name === name);
      if (dependency) return dependency.constructorParams;
      return loneParams(functions.filter(f => f.name === name));
    };
    const methodParams = (object, method, scope) => {
      const rootName = object?.type === 'Identifier' || object?.type === 'RefRead' ? object.name : null;
      const source = object?.type === 'FunctionCallExpr'
        ? object.callee?.name
        : rootName && (scope.instances.get(rootName) ?? instanceOf.get(rootName.replace(/^@/, '')) ?? rootName);
      if (classes.has(source)) return loneParams(classMethods(classes.get(source), method));
      return dependencyNames.has(source) ? loneParams(docSignatures(source, method)) : null;
    };
    // A class's overloads of a method, its own hiding any it inherits.
    const classMethods = (cls, method) => {
      const own = (cls.functions || []).filter(f => f.name === '@' + method);
      return own.length ? own : resolveSuperclassChain(classes, cls).inheritedFunctions.filter(f => f.name === '@' + method);
    };

    // A param typed with `->` requires a read-only function.
    const checkReadOnlySlots = (params, args, calleeLabel, scope) => {
      if (!params) return;
      const slot = (key) => params.find(p => (p.key || p.name) === key)?.type;
      // A member call's args are wrappers with no type of their own.
      const isNamed = (a) => !a.type && a.name && !a.positional;
      const positional = args.filter(a => a.type !== 'NamedArgsBag' && !isNamed(a));
      const passed = [
        ...positional.map((a, i) => [a, params[i]?.type]),
        ...args.filter(isNamed).map(a => [a, slot(a.name)]),
        ...Object.entries(args.find(a => a.type === 'NamedArgsBag')?.fields || {}).map(([k, v]) => [v, slot(k)]),
      ];
      for (const [arg, type] of passed) {
        const value = arg.expr ?? arg;
        if (functionTypeArrow(type) !== '->') continue;
        if (value?.type === 'FnRef' && refWrites(value, scope)) {
          throw new Error(`'${calleeLabel}' takes a read-only function here, but '&${value.name}' writes. Its param type would need '=>'`);
        }
        if (value?.type !== 'Function') continue;
        let why = null;
        const inner = { ...scope, locals: new Set(scope.locals), write: (w) => { why ??= w; }, discard: () => {} };
        walk(value, inner);
        if (why) throw new Error(`'${calleeLabel}' takes a read-only function here, but this one writes (${why}). Its param type would need '=>'`);
      }
    };

    // A doc's `=> (Type) | self` may yield a value, so nothing can be chained on it.
    const checkRemoteChain = (node, scope) => {
      const held = node.object;
      const method = held?.type === 'DotCallExpr' ? held.method : held?.type === 'DotAccessExpr' ? held.property : null;
      if (!method) return;
      const root = receiverRoot(held);
      const alias = root?.type === 'Identifier' || root?.type === 'RefRead' ? depAliasFor(root.name, scope) : null;
      if (alias && docSignatures(alias, method)?.some(s => s.returnsSelf && s.returns)) {
        throw new Error(`'${method}' returns a value here, so nothing can be chained on it — bind it first`);
      }
    };

    const member = (node, name, scope) => {
      checkRemoteChain(node, scope);
      walk(node.object, scope);
      checkReadOnlySlots(methodParams(node.object, name, scope), node.args || [], name, scope);
      for (const a of node.args || []) {
        escapeNames(a.expr ?? a, scope);
        walk(a.expr ?? a, scope);
      }
      const root = receiverRoot(node.object);
      if (isConstruction(root)) return;
      const rootName = root?.type === 'Identifier' || root?.type === 'RefRead' ? root.name : null;
      if (rootName && scope.fresh.has(rootName)) return;
      if (rootName && untrackedNames.has(rootName.replace(/^@/, ''))) return;
      const ownClass = rootName ? classes.get(scope.instances.get(rootName) ?? instanceOf.get(rootName.replace(/^@/, ''))) : null;
      if (ownClass?.functions?.some(f => f.untracked && f.name === '@' + name)) return;
      if (ownClass && claimedByActor.get(ownClass)?.has('@' + name)) scope.mightWrite();
      const alias = node.object === root && rootName ? depAliasFor(rootName, scope) : null;
      if (alias) {
        const sigs = docSignatures(alias, name);
        if (sigs) {
          const untracked = remotesParsed[alias]?.__untracked?.includes(name);
          if (sigs.some(s => s.effect === 'purported')) scope.mightWrite();
          if (!untracked && sigs.some(s => s.effect === 'write')) scope.write(`${rootName}.${name}(…)`);
          return;
        }
        if (!remotesParsed[alias]) { scope.write(`${rootName}.${name}(…)`); return; }
      }
      if (isSuffixed(name)) scope.write(`${rootName ? rootName + '.' : ''}${name}(…)`);
    };

    // A named local function answers for its own name. Calling it counts as a write
    // only if it reaches past the enclosing function's own cells.
    const checkLocalFunction = (node, scope) => {
      const name = node.name;
      const locals = new Set(scope.locals);
      let writesAny = null, writesOutside = null;
      const outerLocals = scope.locals;
      const inner = {
        ...scope,
        locals,
        write: (why) => {
          writesAny ??= why;
          writesOutside ??= why;
        },
        discard: () => {},
      };
      for (const p of node.value.params || []) if (!p.ref) locals.add(p.name);
      const body = node.value.body;
      // Writes to the enclosing function's cells are writes for the name, but not for
      // the caller of the enclosing function.
      const probe = { ...inner, locals: new Set() };
      for (const p of node.value.params || []) if (!p.ref) probe.locals.add(p.name);
      collectOwnRefs(body, probe.locals);
      const outerWrites = [];
      let might = false;
      probe.write = (why) => { outerWrites.push(why); };
      probe.mightWrite = () => { might = true; scope.mightWrite(); };
      // An enclosing function's local functions and fresh actors aren't this one's own.
      probe.localFunctions = new Map([...scope.localFunctions].map(([k, v]) => [k, { ...v, writesOutside: v.writes }]));
      probe.writingParams = new Set([...scope.writingParams, ...writingParamsOf(node.value)]);
      walk(body, { ...probe, fresh: new Set() });
      if (outerWrites.length) writesAny = outerWrites[0];
      const pastLocals = { ...inner };
      for (const n of outerLocals) pastLocals.locals.add(n);
      collectOwnRefs(body, pastLocals.locals);
      walk(body, { ...pastLocals, fresh: new Set(scope.fresh) });
      scope.localFunctions.set(name, { writesOutside: !!writesOutside, writes: !!writesAny, params: node.value.params });
      if (writesOutside) scope.write(`${name}(…)`);
      if (writesAny && !isSuffixed(name)) {
        throw new Error(`'${name}' writes (${writesAny}), so it must be named '${name}!' or '${name}.'`);
      }
      if (!writesAny && !might && name.endsWith('!')) {
        throw new Error(`'${name}' never writes, so it shouldn't be named with '!'`);
      }
    };

    const writingParamsOf = (fn) => (fn.params || []).filter(p => functionTypeArrow(p.type) === '=>').map(p => p.name);

    const collectOwnRefs = (node, into) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => collectOwnRefs(n, into)); return; }
      if (node.type === 'RefDecl') into.add(node.name);
      for (const v of Object.values(node)) if (v && typeof v === 'object') collectOwnRefs(v, into);
    };

    // A function with no value to give back. Discarding a call to it loses nothing.
    const yieldsNothing = (fn) => !fn?.body?.some(st =>
      ((st.type === 'Reply' || st.type === 'Return') && st.fields?.length) || st.type === 'ImplicitReturn'
      || (st === fn.body[fn.body.length - 1] && st.type === 'ExprStatement'));
    const discardedName = (expr) => (expr.type === 'DotCallExpr' ? `.${expr.method}()` : `${expr.callee.name}()`);
    const isReadCall = (expr, scope) => {
      if (expr?.type === 'FunctionCallExpr') {
        const n = expr.callee?.name;
        if (!n || isSuffixed(n)) return false;
        const own = functions.find(f => f.name === n);
        return !!own && !yieldsNothing(own);
      }
      if (expr?.type === 'DotCallExpr' && !isSuffixed(expr.method)) {
        const rootName = expr.object?.type === 'Identifier' || expr.object?.type === 'RefRead' ? expr.object.name : null;
        if (!rootName) return false;
        const ownClass = classes.get(scope.instances.get(rootName) ?? instanceOf.get(rootName.replace(/^@/, '')));
        const own = ownClass && classMethods(ownClass, expr.method)[0];
        if (own) return !yieldsNothing(own);
        const alias = depAliasFor(rootName, scope);
        const sigs = alias && docSignatures(alias, expr.method);
        return !!sigs && sigs.every(sig => sig.effect === 'read' && sig.returns?.length);
      }
      return false;
    };

    for (const fn of functions) {
      if (isUnnamedHandler(fn.name)) continue;
      let why = null;
      let might = false;
      const lastStatement = fn.body?.[fn.body.length - 1];
      const scope = {
        mightWrite: () => { might = true; },
        locals: new Set(),
        fresh: new Set(),
        instances: new Map(),
        localFunctions: new Map(),
        writingParams: new Set(),
        write: (reason) => { why ??= reason; },
        discard: (stmt) => {
          if (stmt !== lastStatement && isReadCall(stmt.expr, scope) && !stmt.ellipsis) {
            throw new Error(`The value of '${discardedName(stmt.expr)}' is discarded in '${fn.name}'`);
          }
        },
      };
      for (const p of fn.params || []) {
        if (!p.ref) scope.locals.add(p.name);
        if (typeNameOf(p.type)) scope.instances.set(p.name, typeNameOf(p.type));
      }
      for (const name of writingParamsOf(fn)) scope.writingParams.add(name);
      walk(fn.body, scope);
      if (fn.untracked) {
        if (why) throw new Error(`'${fn.name}' is untracked, so it can only write untracked state, but it writes (${why})`);
        continue;
      }
      if (why && !isSuffixed(fn.name)) {
        throw new Error(`'${fn.name}' writes (${why}), so it must be named '${fn.name}!' or '${fn.name}.'`);
      }
      // A `~>` call might write, which is reason enough for the name.
      if (!why && !might && fn.name.endsWith('!') && !inherits.has(fn.name)) {
        throw new Error(`'${fn.name}' never writes, so it shouldn't be named with '!'`);
      }
    }

    // A constructor that writes to something else takes `!`. Its own setup doesn't
    // count: initializing its refs, calling its own functions, constructing children.
    if (actor.name) {
      let why = null;
      const scope = {
        locals: new Set([...stateNames, ...(actor.initParams || []).map(p => p.name)]),
        fresh: new Set(),
        instances: new Map(),
        localFunctions: new Map(),
        writingParams: new Set(),
        write: (reason) => { why ??= reason; },
        mightWrite: () => {},
        discard: () => {},
      };
      const ownCalls = new Set([...functions.map(f => f.name), ...functions.map(f => f.name.replace(/^@/, ''))]);
      const saved = untrackedNames.size;
      for (const n of ownCalls) untrackedNames.add(n);
      walk(actor.initBody, scope);
      if (untrackedNames.size !== saved) for (const n of ownCalls) if (!functions.some(f => f.untracked && f.name.replace(/^@/, '') === n)) untrackedNames.delete(n);
      if (!actor.sourceName) {
        const parent = (actor.supertypes || []).find(st => classes.get(st.supertype)?.sourceName
          || Object.values(remotesParsed).some(doc => doc?.__types?.[st.supertype]?.effect === 'write'));
        if (parent) throw new Error(`Class '${actor.name.replace(/^@/, '')}' inherits from '${parent.sourceName ?? parent.supertype}', which writes while constructing, so it must be named '${actor.name.replace(/^@/, '')}!'`);
      }
      if (why && !actor.sourceName) {
        throw new Error(`Class '${actor.name}' writes (${why}) while constructing, so it must be named '${actor.name}!'`);
      }
    }
  }
}

// The functions whose read-only claim rests on a `~>` in an inline doc, directly or
// through any call in this file, per actor. A claim can't become a guarantee on the
// way up, so this follows calls across classes until nothing changes.
export function purportedFunctions(ast, parseDoc) {
  const classes = classesByName(ast);
  const docClaims = new Map();
  for (const d of ast.dependencies || []) {
    if (typeof d.interface !== 'string') continue;
    // A malformed doc is reported by validation, with the context to explain it.
    let doc;
    try { doc = parseDoc(d.interface.replace(/\}\s*\|[^}]*$/, '}')); } catch { continue; }
    const sigs = [
      ...Object.entries(doc).filter(([k]) => !k.startsWith('__')).flatMap(([k, v]) => v.map(sig => [k, sig])),
      ...Object.values(doc.__types || {}).flatMap(t => (t.functions || []).map(f => [f.name, f])),
    ];
    docClaims.set(d.name, new Set(sigs.filter(([, sig]) => sig.effect === 'purported').map(([k]) => k)));
  }

  // What a receiver is: a class in this file or a dependency, by name.
  const sourceOf = (node, known) => {
    if (node?.type === 'FunctionCallExpr') return node.callee?.name ?? null;
    if (node?.type === 'Identifier' || node?.type === 'RefRead') {
      const bare = node.name.replace(/^@/, '');
      return known.get(bare) ?? (classes.has(node.name) ? node.name : docClaims.has(bare) ? bare : null);
    }
    // A chain on a `!` call stays on its receiver.
    if ((node?.type === 'DotCallExpr' && node.method?.endsWith('!')) || (node?.type === 'DotAccessExpr' && node.property?.endsWith('!'))) {
      return sourceOf(node.object, known);
    }
    return null;
  };

  const claimed = new Map(ast.actors.map(a => [a, new Set()]));
  const edges = [];
  for (const actor of ast.actors) {
    const fields = new Map();
    for (const d of actor.stateVarDecls || []) {
      if (typeNameOf(d.typeName)) fields.set(d.name.replace(/^@/, ''), typeNameOf(d.typeName));
    }
    for (const st of actor.initBody || []) {
      if (st.type === 'StateAssign' && st.value?.callee?.name) fields.set(st.name.replace(/^@/, ''), st.value.callee.name);
    }
    for (const p of actor.initParams || []) if (typeNameOf(p.type)) fields.set(p.name, typeNameOf(p.type));
    for (const fn of functionsOf(actor)) {
      const known = new Map(fields);
      for (const p of fn.params || []) if (typeNameOf(p.type)) known.set(p.name, typeNameOf(p.type));
      const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if ((node.type === 'Assign' || node.type === 'TypedAssign') && node.name) {
          const source = sourceOf(node.value, known) ?? typeNameOf(node.typeName);
          if (source) known.set(node.name, source);
        }
        if (node.type === 'FunctionCallExpr' && node.callee?.name) edges.push({ from: [actor, fn.name], to: [actor, node.callee.name] });
        if (node.type === 'DotCallExpr' || node.type === 'DotAccessExpr') {
          const member = node.method ?? node.property;
          const source = sourceOf(node.object, known);
          if (docClaims.get(source)?.has(member)) claimed.get(actor).add(fn.name);
          if (classes.has(source)) edges.push({ from: [actor, fn.name], to: [classes.get(source), '@' + member] });
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
      };
      visit(fn.body);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const { from: [fromActor, fromName], to: [toActor, toName] } of edges) {
      if (claimed.get(toActor)?.has(toName) && !claimed.get(fromActor).has(fromName)) {
        claimed.get(fromActor).add(fromName);
        changed = true;
      }
    }
  }
  return claimed;
}
