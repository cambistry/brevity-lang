import { hasInterface } from './actor_interface.js';
// Shared semantic validation pass — runs between parse() and codegen.
// Every target (JS, Erlang, Rust) gets the same checks.

import { checkEffects } from './effects.js';
import { readDocument } from './service_doc.js';
import { readParamsDocument } from './parser_types.js';
import { isFn, fnReply, fnSignature, isList, listElement, listOf, show, members as encMembers, isUnion, isInstance, ownPath, ownNames, addressesIn } from './type_enc.js';
import { _opre_split as splitAddress, _opre_quote as quoteToken } from './codegen/opre_tokens.js';
import { inferType, typesCompatible as typesCompatibleEnc, binaryResultType as binaryResultTypeEnc, ANY_LIST } from './type_infer.js';
import { lowerAs } from './as_check.js';
import { buildTypeTable } from './codegen/type_table.js';
import { addressShown, dependencyAliases } from './type_shown.js';
import { renderType } from './type_tree.js';
import { lowerBranchOrder } from './branch_order.js';
import { lowerParamScope } from './param_scope.js';
import { lowerPublicClassCalls, addConstructHandlers } from './public_classes.js';
import { resolveTypePaths, checkTypeClassConflicts } from './type_paths.js';
import { lowerOwnCellWrites } from './published_cells.js';
import { markOuterReads } from './outer_reads.js';
import { resolveNames } from './names.js';
import { resolveTypeNames } from './type_names.js';
import { markCallResultTypes } from './call_types.js';
import { checkInitOrder } from './init_order.js';
import { returnShapes, docReturnShapes, fieldAcrossReturns, mergeShapes, mergeTypesEnc } from './return_shapes.js';
import { parseDecimalLiteral, isTerminatingDivision } from './codegen/decimal_utils.js';
import { MATH_METHODS } from './math_methods.js';
import { BUILTIN_TYPE_NAMES, launchStatement } from './ast.js';
import { LIST_METHODS } from './list_methods.js';
import { resolveSuperclassChain, PUBLIC_CLASS_SUFFIX } from './subclass.js';
import { buildsBase } from './super_calls.js';
import { lowerBareCalls, lowerBareMemberCalls } from './bare_calls.js';
import { lowerRemoteCalls, resolveLoweredCall, receiverDoc, receiverLabel, remoteMember } from './opre.js';


// Only a class subscribes to its param: it does so once, when it's made, and
// the subscription lives as long as it does. A function's call ends, so
// nothing would own the subscription; until that's designed, it's refused.
function checkParamSubscribes(ast) {
  const visit = (node, fn, name) => {
    if (Array.isArray(node)) { node.forEach(n => visit(n, fn)); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDecl' || node.type === 'Function') {
      fn = { name: node.name ?? name, params: new Set((node.params || []).map(p => p?.name).filter(Boolean)) };
    }
    // A lambda's name is the one it's bound to.
    if ((node.type === 'Assign' || node.type === 'TypedAssign') && node.value?.type === 'Function') {
      visit(node.value, fn, node.name);
      return;
    }
    if (node.type === 'SubscribeCall' && fn && node.target?.type === 'Identifier' && fn.params.has(node.target.name)) {
      const where = fn.name ? `'${fn.name}'` : 'a function';
      throw new Error(`'${node.target.name}' is a param of ${where}, and a function can't subscribe to its param — take it as a class param and subscribe in the class`);
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'loc') continue;
      if (v && typeof v === 'object') visit(v, fn);
    }
  };
  for (const actor of ast.actors || []) {
    for (const f of actor.functions || []) visit(f, null);
    // A class's own block subscribes to its params; only functions in it are checked.
    visit(actor.initBody, null);
    visit(actor.constructorBody, null);
  }
}

// Validation messages show a `use("…")` entry and a scoped binding as written,
// not by the hidden names they lower to.
export function validate(ast, options = {}) {
  try {
    return validateProgram(ast, options);
  } catch (e) {
    const hidden = (ast.dependencies || []).filter(d => d.hidden);
    if (e instanceof Error && (hidden.length > 0 || e.message.includes('__scoped'))) {
      for (const d of hidden.sort((a, b) => b.name.length - a.name.length)) e.message = e.message.split(d.name).join(`use(${JSON.stringify(d.path)})`);
      e.message = e.message.replace(/__scoped\d+_(\w+)/g, '$1');
    }
    throw e;
  }
}

// An `if` used as a value gives a value from each branch, so a branch can't
// `return`: leaving the function is the statement `if (c) return v`. An `if` that is
// a whole statement, and the `else if`s of its chain, aren't values; a nested
// function's `return` is its own.
function checkValueIfReturns(ast) {
  const walk = (n, inValue) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(x => walk(x, inValue)); return; }
    if (n.type === 'Function') { walk(n.body ?? n.expr, false); return; }
    if (n.type === 'Return' && inValue) {
      throw new Error("A branch of an 'if' used as a value can't return: write 'if (c) return v' as its own statement");
    }
    const statementIf = (n.type === 'ExprStatement' || n.type === 'ImplicitReturn') && n.expr?.type === 'IfExpr';
    if (statementIf) {
      for (let b = n.expr; b; b = b.else?.type === 'IfExpr' ? b.else : null) {
        walk(b.cond, inValue);
        walk(b.then, inValue);
        if (b.else?.type !== 'IfExpr') walk(b.else, inValue);
      }
      return;
    }
    if (n.type === 'IfExpr') {
      walk(n.cond, inValue);
      walk(n.then, true);
      walk(n.else, true);
      return;
    }
    for (const k in n) if (k !== 'type') walk(n[k], inValue);
  };
  walk(ast.actors, false);
}

// `c.m` with no parens on a cell that holds an actor reads its member by message, as
// `c.m()` does: it lowers to that call when `m` is a function of the cell's class.
// A cell of a value type (`p.x` of a Point) is a field read, and is left alone.
function lowerCellMemberReads(ast) {
  const classOf = (t) => {
    if (!isInstance(t)) return null;
    const names = ownNames(t);
    return names?.length === 1 ? ast.actors.find(a => a.name === names[0]) : null;
  };
  const cells = new Map();
  for (const a of ast.actors || []) {
    for (const v of a.stateVarDecls || []) {
      const cls = classOf(v.typeNameEnc);
      cells.set(v.name, cells.has(v.name) && cells.get(v.name) !== cls ? null : cls);
    }
  }
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((x, i) => { walk(x); n[i] = lowered(x); }); return; }
    for (const k in n) {
      if (k === 'type' || !n[k] || typeof n[k] !== 'object') continue;
      walk(n[k]);
      n[k] = lowered(n[k]);
    }
  };
  const lowered = (n) => {
    if (n?.type !== 'DotAccessExpr' || n.object?.type !== 'RefRead') return n;
    const cls = cells.get(n.object.name);
    if (!cls || !(cls.functions || []).some(f => f.name === '@' + n.property || f.name === n.property)) return n;
    return { type: 'DotCallExpr', object: n.object, method: n.property, args: [], ...(n.loc && { loc: n.loc }) };
  };
  walk(ast.actors);
}

// A function that ends in an `if` replies with the value its path ends in:
// `if (b) { "x" } else { 9 }` replies "x" or 9, each as its own type. When every
// path ends in a value or a `return`, each path's value becomes its `return`, as
// `if (b) { return "x" } else { return 9 }` is written, so every target replies
// and tags it as it does a `return`. An `if` with a path that gives no value (no
// `else`) is left as it is. A value after a guard (`if (b) return "x"` then `9`)
// is the reply on the path past the guard, so it becomes the function's `return`.
function lowerTailIfValues(ast) {
  const ret = (expr) => ({ type: 'Return', fields: [{ expr, type: null, positional: true }] });
  const isTailIf = (e) => e?.type === 'IfExpr' && !e.boolOp;
  // Whether every path of an `if` ends in a value or a return.
  const ends = (node) => {
    if (!isTailIf(node) || !node.else) return false;
    const branchEnds = (b) => {
      if (!b) return false;
      if (b.type === 'IfExpr') return ends(b);
      if (b.expr) return b.expr.type !== 'LabelInvoke' && (!isTailIf(b.expr) || ends(b.expr));
      const last = b.body?.[b.body.length - 1];
      if (last?.type === 'Return') return true;
      if (last?.type !== 'ImplicitReturn' || last.typeName || last.typeNameEnc !== undefined) return false;
      return isTailIf(last.expr) ? ends(last.expr) : last.expr?.type !== 'LabelInvoke';
    };
    return branchEnds(node.then) && branchEnds(node.else);
  };
  // Each path's value, its return, in place; a nested `if` is a path's last statement.
  const lower = (node) => {
    for (const k of ['then', 'else']) {
      const b = node[k];
      if (b.type === 'IfExpr') { lower(b); continue; }
      if (b.expr) {
        if (isTailIf(b.expr)) { lower(b.expr); b.body = [{ type: 'ImplicitReturn', expr: b.expr, typeName: null }]; } else b.body = [ret(b.expr)];
        delete b.expr;
        continue;
      }
      const i = b.body.length - 1;
      const last = b.body[i];
      if (last.type !== 'ImplicitReturn') continue;
      if (isTailIf(last.expr)) lower(last.expr); else b.body[i] = ret(last.expr);
    }
  };
  // A guard: an `if` statement with a `return` in it, ahead of the tail.
  const isGuard = (st) => (st?.type === 'ImplicitReturn' || st?.type === 'ExprStatement') && isTailIf(st.expr)
    && JSON.stringify(st.expr).includes('"type":"Return"');
  const visitFns = (fns) => {
    for (const fn of fns || []) {
      if (fn.actorDef) visitFns(fn.actorDef.functions);
      if (typeof fn.name !== 'string' || fn.name.endsWith('.') || !Array.isArray(fn.body)) continue;
      const i = fn.body.length - 1;
      const last = fn.body[i];
      // A trailing call is a braced body's reply too, as each target reads one.
      const tailCall = last?.type === 'ExprStatement' && ['FunctionCallExpr', 'DotCallExpr'].includes(last.expr?.type);
      if (tailCall && fn.body.slice(0, i).some(isGuard)) {
        fn.body[i] = { type: 'Reply', fields: [{ expr: last.expr, type: null, positional: true }] };
        continue;
      }
      if (last?.type !== 'ImplicitReturn' || last.typeName || last.typeNameEnc !== undefined) continue;
      if (ends(last.expr)) { lower(last.expr); continue; }
      // A value after a guard is the function's reply on the path past it: its return.
      if (!isTailIf(last.expr) && last.expr?.type !== 'LabelInvoke' && last.expr?.type !== 'CatchExpr' && fn.body.slice(0, i).some(isGuard)) {
        fn.body[i] = { type: 'Reply', fields: [{ expr: last.expr, type: null, positional: true }] };
      }
    }
  };
  for (const actor of ast.actors || []) visitFns(actor.functions);
}

function validateProgram(ast, options = {}) {
  run.ast = ast;
  checkValueIfReturns(ast);
  lowerTailIfValues(ast);
  lowerCellMemberReads(ast);
  run.classEncByName = new Map();
  lowerBareCalls(ast);
  spreadObjectReturns(ast);
  lowerFunctionAs(ast);
  checkParamSubscribes(ast);

  // Build actor info map for cross-actor as-clause checking
  const actorInfo = new Map();
  for (const actor of ast.actors) {
    if (actor.name && actor.asClauses && actor.asClauses.length > 0) {
      actorInfo.set(actor.name, { asClauses: actor.asClauses });
    }
  }

  // Build remote interfaces and constructor params from declarations.
  // Order: remotesParsed first (needed to expand spread `...` in destructures),
  // then destructure expansion, then the destructuredMembers/dependencyNames
  // index built from the final (expanded) lists.
  const dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  const remotesParsed = {};
  const factoryDecls = {};
  for (const d of (ast.dependencies || [])) {
    // The parser read it, its types encoded (src/parser_types.js).
    if (d.interface) remotesParsed[d.name] = d.interfaceDoc;
    if (d.constructorParams) factoryDecls[d.name] = d.constructorParams;
  }
  // Collect dep names whose manifest is provided inline by a constructor
  // coercion (`Coerced = Dep as *(ctor params) -> { iface }`). These are exempt from
  // the bare-* / # interface check below.
  const coercedDeps = new Set();
  for (const actor of ast.actors) {
    for (const s of (actor.constructorBody || [])) {
      if (s.type === 'ServiceCoercion' && s.constructorParams) {
        const refName = s.ref?.name || s.ref;
        if (refName) coercedDeps.add(refName);
      }
    }
  }
  if (options.remotes) {
    // Build path → alias map from declarations for resolving path-keyed remotes
    const pathToAlias = new Map();
    for (const d of (ast.dependencies || [])) {
      if (d.path) pathToAlias.set(d.path, d.name);
    }
    // An inline definition preempts the remote's document: the compiler takes
    // the file's own statement of what it needs; a mismatch with the real
    // service fails at runtime.
    const inlineDefined = new Set((ast.dependencies || [])
      .filter(d => d.interface || d.constructorParams)
      .map(d => d.name));
    const ingestRemote = (alias, service, params) => {
      if (inlineDefined.has(alias)) return;
      const path = (ast.dependencies || []).find(d => d.name === alias)?.path ?? null;
      const { doc, ctorParams } = readRemote(service, { path, params });
      remotesParsed[alias] = doc;
      if (ctorParams) factoryDecls[alias] = ctorParams;
    };
    if (Array.isArray(options.remotes)) {
      // New format: [{ path, params?, service }, ...]
      for (const { path, service, params } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) ingestRemote(alias, service, params);
      }
    } else {
      for (const [name, iface] of Object.entries(options.remotes)) {
        ingestRemote(name, iface);
        // A `use("…")` entry has a hidden name: its document is keyed by source.
        for (const d of (ast.dependencies || [])) if (d.hidden && d.path === name) ingestRemote(d.name, iface);
      }
    }
  }

  // Check that all bare * / # dependencies have an interface (inline, via
  // options.remotes, or supplied by a constructor coercion).
  for (const d of (ast.dependencies || [])) {
    if (d.path && !d.interface && !remotesParsed[d.name] && !coercedDeps.has(d.name)) {
      if (d.hidden) throw new Error(`'use(${JSON.stringify(d.path)})' has no type — claim one with 'as { … }', or supply its document via options.remotes`);
      throw new Error(`'${d.path}' (bound as '${d.name}') has no type — declare one in the header, or supply its document via options.remotes`);
    }
  }

  // ── DI bindings in body form are lexical ────────────────────────────────
  // `(:div, p: para, ...) = HTML` (parens optional) with `HTML` a dependency, and
  // `:div = use("HTML")` (src/parser.js lowers `use(…)` to a reference to its
  // manifest entry, marked `fromUse`), bind where they're written: the rest of
  // their block, and what's lexically inside it. In a class's constructor block
  // that is the class (its methods, and classes nested in it); at the file's own
  // level it is the file. An alias, `svc = use("svc.bv")`, binds the same way.
  //
  // The names are routed by the dependency's destructures list (→
  // destructuredMembers → codegen), so codegen keeps one picture: a binding at
  // the file's level adds its names as written; one in an inner scope adds a
  // hidden name per binding and renames its uses in scope to it. An alias
  // renames its uses to the entry itself. The binding statement is dropped.
  const depByName = new Map();
  for (const d of (ast.dependencies || [])) depByName.set(d.name, d);

  const translatePatternEntry = (entry) => {
    if (entry.spread) return { spread: true };
    if (entry.discard) {
      if (!entry.key) return null;
      return { remote: entry.key, discard: true };
    }
    if (entry.named) {
      return { local: entry.name, remote: entry.name, ...(entry.typeEnc !== undefined && { typeEnc: entry.typeEnc }) };
    }
    if (entry.key) {
      return { local: entry.name, remote: entry.key, ...(entry.typeEnc !== undefined && { typeEnc: entry.typeEnc }) };
    }
    return null;
  };

  const isDIBodyDestructure = (node) => (
    node && typeof node === 'object' &&
    node.type === 'DestructureAssign' &&
    node.source?.type === 'Identifier' &&
    depByName.has(node.source.name)
  );
  const isUseAlias = (node) => (
    node && typeof node === 'object' &&
    (node.type === 'Assign' || node.type === 'StateAssign' || (node.type === 'TypedAssign' && node.typeNameEnc === undefined)) &&
    node.value?.type === 'Identifier' && node.value.fromUse
  );
  // Does `arr` (a block, or a constructor body) bind `name` with a scoped DI
  // binding of its own? Then it is an inner scope that rebinds the name.
  const bindsIn = (arr, name) => Array.isArray(arr) && arr.some(n => (isUseAlias(n) && n.name === name)
    || (isDIBodyDestructure(n) && (n.pattern || []).some(e => e.name === name)));
  // Rename the uses of `from` in `scope` to `to`. A nested scope that rebinds
  // `from` keeps its own (the inner binding wins there). With `guard` (a `use`
  // statement's binding, shown as `guard.shown`), binding or assigning the name
  // again in scope is an error, and so is a param of that name.
  const renameIn = (scope, from, to, guard = null) => {
    const again = () => new Error(`'${from}' is bound by '${guard.shown}' in this scope, so it can't be bound or assigned again here`);
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        if (node !== scope && bindsIn(node, from)) return;
        for (const n of node) walk(n);
        return;
      }
      if ((node.type === 'Actor' && Array.isArray(node.functions)) && bindsIn(node.constructorBody, from)) return;
      if (guard) {
        if (['Assign', 'TypedAssign', 'SetStatement', 'StateAssign', 'RefDecl'].includes(node.type) && node.name === from) throw again();
        if (node.type === 'DestructureAssign' && (node.pattern || []).some(e => e.name === from)) throw again();
        if (Array.isArray(node.params) && node.params.some(p => p?.name === from)) throw again();
      }
      if (node.type === 'Identifier' && node.name === from) node.name = to;
      if (node.typeNameEnc === from) node.typeNameEnc = classEnc(to);
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    walk(scope);
  };
  const pushEntry = (dep, e) => {
    if (!Array.isArray(dep.destructures)) dep.destructures = [];
    const json = JSON.stringify(e);
    if (!dep.destructures.some(x => JSON.stringify(x) === json)) dep.destructures.push(e);
  };
  // Names bound in an inner scope, for the out-of-scope check below.
  const scopedNames = new Map(); // local → source shown
  const hiddenFor = new Map(); // scope key + local → hidden name
  let hiddenCount = 0;
  let blockCount = 0;
  const shownSource = (dep) => (dep.hidden ? `use(${JSON.stringify(dep.path)})` : dep.name);
  // A destructure at the file's level: its names, as written, are the file's.
  const foldIntoDep = (node) => {
    const dep = depByName.get(node.source.name);
    for (const entry of (node.pattern || [])) {
      const translated = translatePatternEntry(entry);
      if (translated) pushEntry(dep, translated);
    }
  };
  // A destructure in an inner scope: each name hidden, its uses in `scope` renamed.
  const bindInScope = (node, scope, scopeKey, guard = null) => {
    const dep = depByName.get(node.source.name);
    const entries = (node.pattern || []).map(translatePatternEntry).filter(Boolean);
    if (entries.some(e => e.spread)) {
      const manifest = remotesParsed[dep.name];
      if (!manifest) {
        throw new Error(`Dependency '${shownSource(dep)}' uses spread '...' but no manifest is available to expand it — supply an interface inline or via options.remotes`);
      }
      const consumed = new Set(entries.filter(e => e.remote && !e.spread).map(e => e.remote));
      const names = [...Object.keys(manifest).filter(k => !k.startsWith('__')), ...Object.keys(manifest.__types || {})];
      const at = entries.findIndex(e => e.spread);
      entries.splice(at, 1, ...names.filter(n => !consumed.has(n)).map(n => ({ local: n, remote: n })));
    }
    for (const e of entries) {
      if (e.discard) continue;
      const key = `${scopeKey}\0${dep.name}\0${e.local}`;
      let hidden = hiddenFor.get(key);
      if (!hidden) {
        hidden = `__scoped${++hiddenCount}_${e.local}`;
        hiddenFor.set(key, hidden);
      }
      renameIn(scope, e.local, hidden, guard && { shown: guard.shown });
      scopedNames.set(e.local, guard?.shown ?? `${e.remote === e.local ? ':' + e.local : `${e.remote}: ${e.local}`} = ${shownSource(dep)}`);
      pushEntry(dep, { ...e, local: hidden });
    }
  };
  // The classes lexically inside `actor` (hoisted to the top level by the parser).
  const enclosedBy = (actor) => {
    const out = [];
    const names = new Set([actor.name]);
    for (let grew = true; grew;) {
      grew = false;
      for (const a of (ast.actors || [])) {
        if (a.enclosing && names.has(a.enclosing) && !out.includes(a)) { out.push(a); names.add(a.name); grew = true; }
      }
    }
    return out;
  };
  // `arr[i]` is a body-form binding: bind it in `scope()`, and drop it.
  // `arr[i]` is a body-form binding: bind it in `scope()`, and drop it. A `use`
  // statement's binding (`useStatement`) is guarded: the name is the
  // dependency's throughout its scope. `params` are the enclosing function's, for
  // a binding at the top of its body; `actor` the class, at the top of its body.
  const takeBinding = (arr, i, { scope, scopeKey, fileLevel, actor, params = [] }) => {
    const node = arr[i];
    arr.splice(i, 1);
    const guard = node.useStatement ? { shown: node.useShown } : null;
    const names = isDIBodyDestructure(node) ? (node.pattern || []).map(e => e.name).filter(Boolean) : [node.name];
    if (guard) {
      const taken = new Set([
        ...params.map(p => p?.name),
        ...(actor ? [...(actor.stateVarDecls || []).map(v => v.name), ...(actor.functions || []).map(f => f.name?.replace(/^@/, '')), ...(actor.initParams || []).map(p => p.name)] : []),
      ]);
      for (const n of names) if (taken.has(n)) throw new Error(`'${n}' is bound by '${guard.shown}' in this scope, so it can't be bound or assigned again here`);
    }
    if (isDIBodyDestructure(node)) {
      if (fileLevel) foldIntoDep(node);
      else bindInScope(node, scope(), scopeKey, guard);
    } else {
      const target = node.value.name;
      const dep = depByName.get(target);
      renameIn(scope(), node.name, target, guard);
      if (!fileLevel) scopedNames.set(node.name, guard?.shown ?? `${node.name} = ${dep ? shownSource(dep) : target}`);
      if (actor) actor.stateVarDecls = (actor.stateVarDecls || []).filter(v => v.name !== node.name);
    }
  };
  // A function's own params, for the block that is its body.
  const paramsOf = new WeakMap();
  const rewriteBody = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (isDIBodyDestructure(node[i]) || isUseAlias(node[i])) {
          const arr = node;
          const at = i;
          // A `use` statement binds its whole block; an inline binding, what follows it.
          const hoisted = node[i].useStatement;
          takeBinding(node, i, { scope: () => (hoisted ? arr : arr.slice(at)), scopeKey: `b${++blockCount}`, params: paramsOf.get(arr) || [] });
          i--;
        } else {
          rewriteBody(node[i]);
        }
      }
      return;
    }
    if (Array.isArray(node.body) && Array.isArray(node.params)) paramsOf.set(node.body, node.params);
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      rewriteBody(node[k]);
    }
  };
  const actorList = [...(ast.actors || [])];
  for (const actor of actorList) {
    // The constructor block's own statements (`initBody` repeats them).
    const fileLevel = actor.name === null;
    const scope = () => (fileLevel ? ast.actors : [actor, ...enclosedBy(actor)]);
    for (const key of ['constructorBody', 'initBody']) {
      const arr = actor[key] || [];
      for (let i = 0; i < arr.length; i++) {
        if (isDIBodyDestructure(arr[i]) || isUseAlias(arr[i])) {
          takeBinding(arr, i, { scope, scopeKey: `a:${actor.name}`, fileLevel, actor });
          i--;
        }
      }
    }
    rewriteBody(actor);
  }
  // A name bound in an inner scope, used where nothing else binds it.
  if (scopedNames.size > 0) {
    const fileNames = new Set();
    for (const d of (ast.dependencies || [])) {
      fileNames.add(d.name);
      for (const e of (d.destructures || [])) if (e.local) fileNames.add(e.local);
    }
    for (const t of (ast.types || [])) fileNames.add(t.name);
    const strip = (n) => n.replace(/^[@#]/, '').replace(/[.!]$/, '');
    // Every name declared anywhere in `node` (any node's or entry's `name` but a reference's).
    const declaredIn = (node, into) => {
      if (!node || typeof node !== 'object') return into;
      if (Array.isArray(node)) { for (const n of node) declaredIn(n, into); return into; }
      if (node.type !== 'Identifier' && typeof node.name === 'string') into.add(strip(node.name));
      for (const k of Object.keys(node)) if (k !== 'type') declaredIn(node[k], into);
      return into;
    };
    const actorNames = new Set();
    for (const a of (ast.actors || [])) {
      if (a.name) actorNames.add(strip(a.name));
      if (a.singletonOf) actorNames.add(strip(a.singletonOf));
      for (const v of (a.stateVarDecls || [])) actorNames.add(strip(v.name));
      for (const f of (a.functions || [])) if (f.name) actorNames.add(strip(f.name));
      for (const p of (a.params || [])) if (p.name) actorNames.add(strip(p.name));
    }
    const check = (node, declared) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) check(n, declared); return; }
      if (node.type === 'Identifier' && scopedNames.has(node.name) && !declared.has(node.name) && !fileNames.has(node.name) && !actorNames.has(node.name)) {
        throw new Error(`'${node.name}' is unknown here — '${scopedNames.get(node.name)}' binds it only in the scope where it's written`);
      }
      for (const k of Object.keys(node)) if (k !== 'type') check(node[k], declared);
    };
    for (const a of (ast.actors || [])) {
      for (const f of (a.functions || [])) check(f, declaredIn(f, new Set()));
      check(a.constructorBody, declaredIn(a.constructorBody, new Set()));
    }
  }

  // ── Expand spread `...` and drop discards in DI destructure lists ───────
  // `<Name: (...)>` and `<Name: (remote: local, other: _, ...)>` flatten the
  // module's remote manifest into local scope. Explicit entries before `...`
  // consume their remote name; `...` then supplies every remaining manifest
  // op as `{ local: op, remote: op }`. Discards (`_`) finish by dropping out
  // of the list — they existed only to keep `...` from picking their name
  // up; leaving them behind would pollute codegen's destructuredMembers map
  // with `local: undefined` entries.
  for (const d of (ast.dependencies || [])) {
    if (!Array.isArray(d.destructures)) continue;
    // Every name a destructure takes from a dependency with a known manifest
    // must be one that manifest exports — op, class (tags included) or type.
    // Without this a typo compiles: a tag routes to an element factory the
    // service never declared, and a type import that misses `__typeDecls`
    // falls through to an actor construction.
    const doc = remotesParsed[d.name];
    if (doc) {
      const exported = new Set([
        ...Object.keys(doc).filter(k => !k.startsWith('__')),
        ...Object.keys(doc.__types || {}),
        ...Object.keys(doc.__typeDecls || {}),
      ]);
      for (const e of d.destructures) {
        if (e.spread || !e.remote || exported.has(e.remote)) continue;
        const available = [...exported].sort().join(', ') || '(none)';
        throw new Error(`'${e.remote}' is not exported by '${d.name}' (available: ${available})`);
      }
    }
    const spreadIdx = d.destructures.findIndex(e => e.spread);
    if (spreadIdx !== -1) {
      const manifest = remotesParsed[d.name];
      if (!manifest) {
        throw new Error(`Dependency '${d.name}' uses spread '...' but no manifest is available to expand it — supply an interface inline or via options.remotes`);
      }
      const consumed = new Set();
      for (const e of d.destructures) {
        if (e.spread) continue;
        if (e.remote) consumed.add(e.remote);
      }
      const expanded = [];
      const allNames = [
        ...Object.keys(manifest).filter(k => !k.startsWith('__')),
        ...Object.keys(manifest.__types || {}),
      ];
      for (const name of allNames) {
        if (consumed.has(name)) continue;
        expanded.push({ local: name, remote: name });
      }
      d.destructures.splice(spreadIdx, 1, ...expanded);
    }
    if (d.destructures.some(e => e.discard)) {
      d.destructures = d.destructures.filter(e => !e.discard);
    }
  }

  // ── Types reached through an actor (`A::X`), and where a bare type is seen ──
  checkTypeClassConflicts(ast);
  resolveTypePaths(ast, remotesParsed, dependencyNames);
  lowerPublicClassCalls(ast, remotesParsed, factoryDecls, dependencyNames);

  // ── Destructured-member index + name-collision check ────────────────────
  // After spread expansion, build the local→{service, remote} map used by
  // codegen and infer routing. A `local` name appearing in two different
  // dependencies' destructure lists is a compile error.
  // destructuredMembers: localName → { service: depName, remote: remoteName }
  const destructuredMembers = new Map();
  const suppliers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (!Array.isArray(d.destructures)) continue;
    for (const entry of d.destructures) {
      if (entry.discard || entry.spread || !entry.local) continue;
      const existing = suppliers.get(entry.local);
      if (existing && existing !== d.name) {
        throw new Error(`DI name collision: '${entry.local}' is supplied by both '${existing}' and '${d.name}' — alias or discard one side`);
      }
      suppliers.set(entry.local, d.name);
      if (entry.isClass) continue;
      destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
      dependencyNames.add(entry.local);
    }
  }

  // ── Every name in value position is bound (src/names.js) ───────────────
  resolveNames(ast);

  // ── Imported-type binding (slice 15) ────────────────────────────────────
  // A destructured-imported name whose remote names a type declared in the
  // source service's interface (`__typeDecls`) binds locally as a type.
  // Construction sites (`Local(...)` / aliased `P(...)`) compile to a typed
  // Object with the canonical (remote) wire tag, regardless of any local
  // rename — `(Point: P)` keeps `Point` on the wire.
  //
  // Stored on the AST as `ast.importedTypes`:
  //   { localName: { remote, sourceAlias, decl: { fields } } }
  // so downstream passes (TypeConstruction rewrite, type checks, codegen
  // wire registry) can treat imported types alongside locally-declared ones.
  const importedTypes = {};
  const localTypeNames = new Set((ast.types || []).map(t => t.name));
  for (const d of (ast.dependencies || [])) {
    if (!Array.isArray(d.destructures)) continue;
    const iface = remotesParsed[d.name];
    const declMap = iface?.__typeDecls;
    if (!declMap) continue;
    for (const entry of d.destructures) {
      if (entry.discard || entry.spread || !entry.local) continue;
      const decl = declMap[entry.remote];
      if (!decl) continue;
      if (localTypeNames.has(entry.local)) {
        throw new Error(`Imported type '${entry.remote}' from '${d.name}' collides with local '${entry.local}' — rename one side`);
      }
      importedTypes[entry.local] = { remote: entry.remote, sourceAlias: d.name, decl };
    }
  }
  if (Object.keys(importedTypes).length > 0) {
    ast.importedTypes = importedTypes;
    rewriteImportedTypeConstructions(ast, importedTypes);
  }

  // ── Cross-module type references (Service::Name) ────────────────────────
  // Slice 15: where a type annotation contains `Alias::Name`, validate that
  // `Alias` is a declared dep, and (when the iface is parsed) that `Name`
  // is exported as a type. Loud failures here keep `ty` annotations and
  // codegen from silently routing to a missing target.
  validateCrossModuleTypeRefs(ast, dependencyNames, remotesParsed);
  // ── Every name in type position is a type (src/type_names.js) ──────────
  resolveTypeNames(ast, remotesParsed);

  // ── Template tags must be imported as destructured elements from a service ──
  // An XML `<tag>…</tag>` is a service-agnostic language form: it lowers to a
  // `#new` CAM message to the element-factory address of whichever service the
  // tag was destructured from (`<Scene: (:node)>` → `Scene @node`). No service
  // name is privileged — the host is the author's DI import (the browser's DOM
  // service is just one such service, imported as `<HTML: (:div, …)>`). Using a
  // tag that was never imported is a compile error, so the wire never routes
  // against a constructor the actor didn't import, and codegen always has a host.
  //
  // The tag is matched against `remote` (the element op) rather than `local`, so
  // aliasing (`div: D`) doesn't break `<div>` templates — `D` is the call-site
  // binding; the tag is the manifest op. A whole-namespace spread import `(...)`
  // admits any tag (resolved by that spread host at codegen).
  {
    // Tags admitted by DI imports (spread `(...)` is already expanded above into
    // explicit manifest entries), and the services that admit them — named in the
    // error so the diagnostic reflects the actual host, not a privileged `HTML`.
    const admitted = new Set();
    const services = new Set();
    for (const d of (ast.dependencies || [])) {
      if (!Array.isArray(d.destructures)) continue;
      let contributed = false;
      for (const e of d.destructures) {
        if (e.remote && !e.discard) { admitted.add(e.remote); contributed = true; }
      }
      if (contributed) services.add(d.name);
    }
    // When no import admits any tag, the check is skipped: the ambient live-page
    // flow (the browser runtime provides the element service) and other no-import
    // flows stay intact. When some service does admit tags, every `<tag>` must be
    // one it admits — so a typo routes nowhere and codegen always has a host.
    if (admitted.size > 0) {
      const hosts = [...services].join(', ');
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const n of node) walk(n); return; }
        if (node.type === 'DomConstructor' && !admitted.has(node.tag)) {
          throw new Error(`<${node.tag}> template used but ':${node.tag}' is not imported (imported from: ${hosts}) — add ':${node.tag}' to the service's destructure list to use this tag`);
        }
        for (const k of Object.keys(node)) {
          if (k === 'type') continue;
          walk(node[k]);
        }
      };
      for (const actor of (ast.actors || [])) walk(actor);
    }
  }

  // ── Overload validation ──────────────────────────────────────────────────
  // Check: duplicate = (create) on same name is a redefinition error.
  // Check: << / >> without prior = (create) is an error.
  // Applies to functions within each actor and to actors (constructors) at top level.
  // Collect all constructor names created at top level (actors with = create)
  const topLevelActorCreates = new Set();
  for (const actor of ast.actors) {
    if (actor.name && (!actor.overloadMode || actor.overloadMode === 'create')) {
      topLevelActorCreates.add(actor.name);
    }
  }
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    const fnCreated = new Set();
    // Seed with constructor names — a constructor = create satisfies << on functions
    if (!actor.name) { // anonymous file-level actor
      for (const n of topLevelActorCreates) fnCreated.add(n);
    }
    for (const fn of actor.functions) {
      if (!fn.name) continue;
      const mode = fn.overloadMode || 'create';
      if (mode === 'create') {
        if (fnCreated.has(fn.name) && !topLevelActorCreates.has(fn.name)) {
          throw new Error(`Duplicate definition of '${fn.name}' — use '<< (params) body' to add an overload clause`);
        }
        fnCreated.add(fn.name);
      } else {
        if (!fnCreated.has(fn.name)) {
          throw new Error(`'${fn.name}' << used before '${fn.name}' is defined with '='`);
        }
      }
    }
  }
  {
    const ctorCreated = new Set();
    for (const actor of ast.actors) {
      if (!actor.name) continue;
      const mode = actor.overloadMode || 'create';
      if (mode === 'create') {
        if (ctorCreated.has(actor.name)) {
          throw new Error(`Duplicate definition of '${actor.name}' — use '<< *(params) { body }' to add an overload clause`);
        }
        ctorCreated.add(actor.name);
      } else {
        if (!ctorCreated.has(actor.name)) {
          throw new Error(`'${actor.name}' << used before '${actor.name}' is defined with '='`);
        }
      }
    }
  }

  // ── Optional arg ordering: required positionals must precede optional ones ──
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (!fn.params) continue;
      const posParams = fn.params.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
    // Check constructor params too
    if (actor.initParams) {
      const posParams = actor.initParams.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
  }

  // Build actor public method map and ref-param requirements for * validation
  const actorMethods = new Map(); // actorName → Set of public method names
  const actorMethodSigs = new Map(); // actorName → Map(methodName → params[])
  const actorRefRequirements = new Map(); // actorName → { params, requirements, callSites }
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    // Collect public methods and their signatures (params + returns)
    const methods = new Set();
    const sigs = new Map();
    for (const fn of actor.functions) {
      if (fn.name?.startsWith('@')) {
        methods.add(fn.name);
        // Extract return type info from Reply nodes
        const reply = fn.body?.find(s => s.type === 'Reply');
        const returns = reply ? reply.fields.map(f => ({ name: f.key || f.name, typeEnc: f.typeEnc })).filter(f => f.typeEnc !== undefined) : null;
        sigs.set(fn.name, { params: fn.params || [], returns });
      }
    }
    actorMethods.set(actor.name, methods);
    actorMethodSigs.set(actor.name, sigs);

    // Collect ref param names, what methods the actor calls on them, and the call args
    const refParams = (actor.initParams || []).filter(p => p.ref);
    if (refParams.length > 0) {
      const refParamNames = new Set(refParams.map(p => p.name));
      const requirements = new Map(); // paramName → Set of called methods
      const callSites = []; // { paramName, method, args, fnParams }
      for (const pName of refParamNames) requirements.set(pName, new Set());
      // Walk all functions to find DotCallExpr on ref params
      for (const fn of actor.functions) {
        collectRefCalls(fn.body, refParamNames, requirements, callSites, fn.params);
      }
      actorRefRequirements.set(actor.name, { params: actor.initParams, requirements, callSites });
    }
  }

  const actorByName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));

  // ── Manifest-declared classes: synthesise actor-shaped nodes ───────────────
  // `parseInterface` collects `Name *([Sup |] params) -> { body }` entries
  // under `parsed.__types`. We materialise them as actor-shaped records so
  // resolveSuperclassChain / isAssignable can walk cross-service inheritance
  // (e.g. HTML.Div → HTML.Element) without special-casing remote types.
  // Local actors win on collision — a manifest declaration cannot shadow a
  // real one. Functions get an `@`-prefixed name and a reconstructed Reply
  // node so the existing addSig path picks up their return types.
  const manifestActors = [];
  for (const remoteName of Object.keys(remotesParsed)) {
    const types = remotesParsed[remoteName].__types;
    if (!types) continue;
    for (const typeName of Object.keys(types)) {
      if (actorByName.has(typeName)) continue;
      const t = types[typeName];
      const functions = (t.functions || []).map(f => ({
        name: '@' + f.name,
        params: f.params || [],
        // Positional returns carry no `key` — a defined key reads as a named field.
        body: f.returns ? (f.returnAlternatives ?? [f.returns]).map(alt => ({
          type: 'Reply',
          fields: alt.map(r => (r.positional
            ? { name: r.name, typeEnc: r.typeEnc, positional: true }
            : { key: r.name, name: r.name, typeEnc: r.typeEnc, positional: r.positional })),
        })) : [],
      }));
      const synthetic = {
        name: typeName,
        supertypes: t.supertypes || [],
        initParams: t.initParams || [],
        functions,
        setters: t.setters || [],
        stateVarDecls: [],
        __remote: remoteName,
        ...(t.ownNew && { ownNew: true }),
      };
      actorByName.set(typeName, synthetic);
      manifestActors.push(synthetic);
      // Its instances' address, as the document gives it. A class reached as a
      // dependency of its own (src/public_classes.js) is at that dependency's address.
      const dep = (ast.dependencies || []).find(d => d.name === remoteName);
      const at = dep?.wireTarget ?? `${quoteToken(dep?.path ?? remoteName)}:${quoteToken(typeName)}`;
      run.classEncByName.set(typeName, at);
      run.ast?.instanceTypes?.add(at);
    }
  }

  // ── Text-only templates: an element child is a compile error ──────────────
  // A tag whose `children` slot is `List[Text]` (a TextElement: <style>,
  // <textarea>, …) takes text, `{{ }}` and `#{ }` children only. A nested
  // element there would otherwise be sent and dropped by the runtime.
  {
    const childrenType = (tag) => {
      const cls = actorByName.get(tag);
      if (!cls) return null;
      const own = (cls.initParams || []).find(p => p.name === 'children');
      if (own) return own.typeEnc ?? own.typeNameEnc;
      const { inheritedParams } = resolveSuperclassChain(actorByName, cls);
      const p = inheritedParams.find(q => q.name === 'children');
      return p ? (p.typeEnc ?? p.typeNameEnc) : undefined;
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (node.type === 'DomConstructor' && childrenType(node.tag) === listOf('Text')) {
        const el = (node.children || []).find(c => c?.type === 'DomConstructor');
        if (el) throw new Error(`<${node.tag}> takes text only — <${el.tag}> can't be its child`);
      }
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    for (const actor of (ast.actors || [])) walk(actor);
  }

  // ── Flattened method sets per actor: own + inherited, including auto-accessors ──
  // Names include the '@' prefix, matching entries in actorMethods.
  // Accessors are synthesised from `@`-published initParams (`@name Type`): each
  // produces a `@{name}` getter.
  const accessorsFor = (params) => {
    const names = [];
    for (const sp of (params || [])) {
      if (sp.accessor) names.push('@' + sp.accessor);
    }
    return names;
  };
  const actorMethodsFlat = new Map();
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    const own = actorMethods.get(actor.name) || new Set();
    const flat = new Set(own);
    for (const n of accessorsFor(actor.initParams)) flat.add(n);
    const { inheritedFunctions, inheritedParams } = resolveSuperclassChain(actorByName, actor);
    for (const fn of inheritedFunctions) {
      if (fn.name?.startsWith('@')) flat.add(fn.name);
    }
    for (const n of accessorsFor(inheritedParams)) flat.add(n);
    // A class block answers what it inherits, by delegating it (src/singleton_classes.js).
    for (const n of actor.forwardFns || []) if (n.startsWith('@')) flat.add(n);
    actorMethodsFlat.set(actor.name, flat);
  }
  // Fold in methods and accessors from overload clauses (`Name << *(..) {}` / `Name >> *(..) {}`).
  // Each clause lives as a FunctionDecl with an actorDef attached; its methods are
  // reachable at runtime via dispatch, so union them into the base type's method set.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      const flat = actorMethodsFlat.get(fn.name);
      if (!flat) continue;
      for (const mfn of (fn.actorDef.functions || [])) {
        if (mfn.name?.startsWith('@')) flat.add(mfn.name);
      }
      for (const n of accessorsFor(fn.actorDef.initParams)) flat.add(n);
    }
  }

  // ── Constructor clause signatures per actor ──────────────────────────
  // Each actor has one "base" clause (its declared initParams merged with
  // inherited params via the superclass chain) plus zero or more overload
  // clauses (`Name << *(..) {}` / `Name >> *(..) {}`). A call matches the type if it
  // fits AT LEAST ONE clause's required-params and positional arity.
  const mergeInheritedParams = (actor) => {
    const own = actor.initParams || [];
    const ownNames = new Set(own.map(p => p.name));
    const { inheritedParams } = resolveSuperclassChain(actorByName, actor);
    return [...inheritedParams.filter(p => !ownNames.has(p.name)), ...own];
  };
  const actorConstructorSigs = new Map(); // name → [{ params }]
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    actorConstructorSigs.set(actor.name, [{ params: mergeInheritedParams(actor) }]);
  }
  // Overload clauses (Name << *(..)) — append to the base entry. If no named
  // actor exists (Function() pattern: `Name = Function(); Name << *(..) {}`),
  // start the entry fresh so the name still resolves as a constructor.
  // An overload clause may itself inherit: `Sub << Base ^ *(...) {}`, so its params
  // also need merging with its own superclass chain.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      let sigs = actorConstructorSigs.get(fn.name);
      if (!sigs) {
        sigs = [];
        actorConstructorSigs.set(fn.name, sigs);
      }
      sigs.push({ params: mergeInheritedParams(fn.actorDef) });
    }
  }

  // ── Flattened method signatures per actor class ──────────────────────
  // typeName → @methodName → [{ params, returns }], one entry per clause.
  // Includes own + inherited via superclass chain + clauses from overload
  // constructors. A layer's clauses for a name replace the earlier layer's,
  // together — subclass overrides superclass, and an overloaded method keeps
  // all its clauses (matches resolveSuperclassChain).
  const actorMethodSigsFlat = new Map();
  const addSigLayer = (sigMap, fns) => {
    const layer = new Map();
    for (const fn of fns) {
      if (!fn.name?.startsWith('@')) continue;
      const reply = fn.body?.find(s => s.type === 'Reply');
      const returns = reply ? reply.fields.map(f => ({ name: f.key || f.name, typeEnc: f.typeEnc })).filter(f => f.typeEnc !== undefined) : null;
      layer.set(fn.name, [...(layer.get(fn.name) || []), { params: fn.params || [], returns }]);
    }
    for (const [name, clauses] of layer) sigMap.set(name, clauses);
  };
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    const sigs = new Map();
    const { inheritedFunctions } = resolveSuperclassChain(actorByName, actor);
    addSigLayer(sigs, inheritedFunctions);
    addSigLayer(sigs, actor.functions || []);
    actorMethodSigsFlat.set(actor.name, sigs);
  }
  // Fold in overload-clause methods — they add to the base type's method set.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      const sigs = actorMethodSigsFlat.get(fn.name);
      if (!sigs) continue;
      addSigLayer(sigs, fn.actorDef.functions || []);
    }
  }

  // ── Top-level (non-constructor) function signatures ────────────────
  // fnName → [{ params }]. Built from every FunctionDecl in every actor that
  // isn't a constructor (no actorDef) and isn't itself a public @-method
  // (those live under methods). Used to type-check bare-name function calls.
  functionsByName = new Map();
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.name || fn.actorDef || fn.emptyOverload) continue;
      functionOwners.set(fn, actor);
      functionsByName.set(fn.name, [...(functionsByName.get(fn.name) || []), fn]);
    }
  }

  const localFunctionSigs = new Map();
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (fn.actorDef || fn.emptyOverload) continue;
      if (!fn.name) continue;
      if (fn.name.startsWith('@') || fn.name.startsWith('set@') || fn.name.startsWith('set.') || fn.name.startsWith('#')) continue;
      if (actorConstructorSigs.has(fn.name)) continue; // constructor, not a plain fn
      // Lineal form stashes params inside body (BareTypeDecl etc.), leaving
      // fn.params empty. Skip: we'd false-positive on the sig check.
      if ((fn.params || []).length === 0) continue;
      const existing = localFunctionSigs.get(fn.name) || [];
      existing.push({ params: fn.params || [], fn });
      localFunctionSigs.set(fn.name, existing);
    }
  }

  // Populate derived maps for manifest-declared classes. Done after the
  // local-actor passes so resolveSuperclassChain can reach across local and
  // manifest entries (a local actor extending a manifest class, or vice
  // versa, would walk through both).
  //
  // Manifest fields use an explicit `? ` prefix on the slot to mark it
  // optional; that flag is carried as `param.optional` and read by
  // clauseAccepts. `Type | null` is just a nullable value type and does
  // NOT imply optionality on its own.
  for (const synth of manifestActors) {
    const flat = new Set();
    for (const fn of synth.functions) flat.add(fn.name);
    for (const n of accessorsFor(synth.initParams)) flat.add(n);
    const { inheritedFunctions, inheritedParams } = resolveSuperclassChain(actorByName, synth);
    for (const fn of inheritedFunctions) flat.add(fn.name);
    for (const n of accessorsFor(inheritedParams)) flat.add(n);
    actorMethodsFlat.set(synth.name, flat);

    actorConstructorSigs.set(synth.name, [{ params: mergeInheritedParams(synth) }]);

    const sigs = new Map();
    addSigLayer(sigs, inheritedFunctions);
    addSigLayer(sigs, synth.functions);
    actorMethodSigsFlat.set(synth.name, sigs);
  }

  // Flattened settable-field sets per manifest class. Only manifest-declared
  // types currently surface settable fields (via `set <name>: (Type)`); local
  // actors expose all fields settable through ActorFieldSet semantics, so we
  // only populate this map for types that opt-in. Used by validateBody to
  // reject `obj.bogus <- v` against a manifest class's declared surface.
  const actorSettersFlat = new Map();
  for (const synth of manifestActors) {
    const own = new Map();
    const { inheritedSetters } = resolveSuperclassChain(actorByName, synth);
    for (const s of inheritedSetters) own.set(s.name, s.typeEnc);
    for (const s of (synth.setters || [])) own.set(s.name, s.typeEnc);
    actorSettersFlat.set(synth.name, own);
  }

  // Set of names that denote an actor constructor — used by expression-type
  // inference to resolve `x = T(...)` → x : T.
  const actorNameSet = new Set(actorConstructorSigs.keys());

  // ── Subclass validation ──────────────────────────────────────────────────
  // A parent must be a class: local, or a constructor in a dependency's
  // interface. A type or an unknown name is an error, not a dropped parent.
  const localTypes = new Set([...(ast.types || []).map(t => t.name), ...Object.keys(ast.importedTypes || {})]);
  const isRemoteClass = (name) => Object.values(remotesParsed).some(doc => doc?.__types?.[name]);
  const subclassActors = [...ast.actors, ...(ast.functions || []).map(f => f.actorDef && { ...f.actorDef, name: f.name }).filter(Boolean)];
  for (const actor of subclassActors) {
    const shown = (actor.name || '').replace(/^@/, '');
    for (const st of actor.supertypes || []) {
      const name = st.sourceName ?? st.supertype;
      if (actorByName.has(st.supertype) || isRemoteClass(name)) continue;
      if (localTypes.has(name) || BUILTIN_TYPE_NAMES.has(name)) throw new Error(`In '${shown}', '${name}' is a type, not a class`);
      throw new Error(`In '${shown}', '${name}' is not a class in scope`);
    }
  }

  for (const actor of ast.actors) {
    if (!actor.supertypes || actor.supertypes.length === 0) continue;
    for (const st of actor.supertypes) {
      const superActor = actorByName.get(st.supertype);
      if (!superActor) continue;

      // Arg type override rejection: subclass params with same name must have same type.
      // A class that builds its base with `super` takes none of its parent's params.
      const superParams = new Map((buildsBase(actor) ? [] : superActor.initParams || []).map(p => [p.name, p]));
      for (const p of (actor.initParams || [])) {
        const sp = superParams.get(p.name);
        if (sp && sp.typeEnc !== undefined && p.typeEnc !== undefined && sp.typeEnc !== p.typeEnc) {
          throw new Error(`Subclass '${actor.name}' cannot change type of inherited arg '${p.name}' from '${tyShown(sp.typeEnc)}' to '${tyShown(p.typeEnc)}'`);
        }
      }

      // Public function return type rejection: overridden functions must return same type
      // Compare both explicit Reply returns and implicit returns
      for (const fn of actor.functions) {
        if (!fn.name?.startsWith('@')) continue;
        const superFn = superActor.functions.find(f => f.name === fn.name);
        if (!superFn) continue;

        // Get return type from super function (Reply or ImplicitReturn)
        const superReply = superFn.body?.find(s => s.type === 'Reply');
        const superImplicit = superFn.body?.find(s => s.type === 'ImplicitReturn');
        const ownReply = fn.body?.find(s => s.type === 'Reply');
        const ownImplicit = fn.body?.find(s => s.type === 'ImplicitReturn');

        // Compare implicit return types
        if (superImplicit && ownImplicit) {
          const superType = superImplicit.typeNameEnc ?? inferType(superImplicit.expr, new Map());
          const ownType = ownImplicit.typeNameEnc ?? inferType(ownImplicit.expr, new Map());
          if (superType !== undefined && ownType !== undefined && superType !== ownType) {
            throw new Error(`Subclass '${actor.name}' cannot change return type of '${fn.name}' from '${tyShown(superType)}' to '${tyShown(ownType)}'`);
          }
        }

        // Compare Reply returns
        if (superReply && ownReply) {
          for (const sf of superReply.fields) {
            const of2 = ownReply.fields.find(f => (f.key || f.name) === (sf.key || sf.name));
            if (of2 && of2.typeEnc !== undefined && sf.typeEnc !== undefined && of2.typeEnc !== sf.typeEnc) {
              throw new Error(`Subclass '${actor.name}' cannot change return type of '${fn.name}' field '${sf.key || sf.name}' from '${tyShown(sf.typeEnc)}' to '${tyShown(of2.typeEnc)}'`);
            }
          }
        }
      }

      // Accessor type rejection: subclass function overriding an auto-accessor must preserve type
      for (const sp of (superActor.initParams || [])) {
        if (!sp.accessor) continue;
        const accessorName = sp.accessor;
        const overrideFn = actor.functions.find(f => f.name === '@' + accessorName);
        if (overrideFn) {
          const reply = overrideFn.body?.find(s => s.type === 'Reply');
          const implicitReturn = overrideFn.body?.find(s => s.type === 'ImplicitReturn');
          if (reply) {
            for (const f of reply.fields) {
              if (f.typeEnc !== undefined && f.typeEnc !== sp.typeEnc) {
                throw new Error(`Subclass '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${tyShown(sp.typeEnc)}' to '${tyShown(f.typeEnc)}'`);
              }
            }
          } else if (implicitReturn) {
            const irType = implicitReturn.typeNameEnc ?? inferType(implicitReturn.expr, new Map());
            if (irType !== undefined && irType !== sp.typeEnc) {
              throw new Error(`Subclass '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${tyShown(sp.typeEnc)}' to '${tyShown(irType)}'`);
            }
          }
        }
      }

      // Private function access: subclass cannot reference superclass's # functions
      const superPrivates = new Set(superActor.functions.filter(f => f.name?.startsWith('#')).map(f => f.name));
      if (superPrivates.size > 0) {
        for (const fn of actor.functions) {
          checkPrivateAccess(fn.body, superPrivates, actor.name);
        }
      }
    }
  }

  // Collect all named actor (constructor) names for silent-function exclusion
  // Include names from actorDef FunctionDecls (Function() + << constructor clauses)
  const constructorNames = new Set(ast.actors.filter(a => a.name).map(a => a.name));
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (fn.actorDef) constructorNames.add(fn.name);
    }
  }

  checkPublishedParams(ast);
  settleElidedDots(ast, remotesParsed);
  lowerBareMemberCalls(ast, remotesParsed);
  // Every remote call's address, worked out once for every target.
  lowerRemoteCalls(ast, remotesParsed);

  inferCallBinds(ast, {
    actorInfo, dependencyNames, remotesParsed, factoryDecls,
    rest: [actorMethods, actorMethodSigs, actorRefRequirements, new Map(), actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat],
  });

  for (const actor of ast.actors) {
    validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames, actorByName, destructuredMembers, actorMethodsFlat, actorConstructorSigs, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
  }

  // ── Reply grounding check ────────────────────────────────────────────
  // Reject reply fields whose type depends entirely on remote inference.
  if (Object.keys(remotesParsed).length > 0) {
    for (const actor of ast.actors) {
      for (const fn of (actor.functions || [])) {
        const reply = fn.body?.find(s => s.type === 'Reply');
        if (!reply) continue;
        const remoteInferred = new Set();
        for (const s of fn.body) {
          if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr') {
            const actorName = s.source.object?.name;
            const methodName = s.source.method;
            const iface = remotesParsed[actorName];
            if (!iface) continue;
            const sig = iface[methodName]?.[0] || iface['@' + methodName]?.[0];
            if (!sig?.returns) continue;
            for (const item of s.pattern) {
              if (item.discard || !item.name || item.typeEnc !== undefined) continue;
              if (fieldAcrossReturns(sig, item.name)) {
                remoteInferred.add(item.name);
              }
            }
          }
        }
        if (remoteInferred.size === 0) continue;
        for (const field of reply.fields) {
          if ('sigil' in field && field.typeEnc === undefined && remoteInferred.has(field.sigil)) {
            throw new Error(`Reply type for ':${field.sigil}' cannot be inferred from local declarations — annotate explicitly`);
          }
          if (field.key !== undefined && field.typeEnc === undefined) {
            const expr = field.value;
            if (expr?.type === 'Identifier' && remoteInferred.has(expr.name)) {
              throw new Error(`Reply type for ':${expr.name}' cannot be inferred from local declarations — annotate explicitly`);
            }
          }
        }
      }
    }
  }

  // ── Decimal division / exponentiation termination checks ──────────────
  checkDecimalTermination(ast);
  // ── List method element-type compat ────────────────────────────────────
  checkListMethodArgs(ast);
  // ── Type declarations: canonical declaration site per file ─────────────
  checkTypeDecls(ast);
  // ── Service-method callback-lambda param inference (C3) ─────────────────
  inferRemoteCallbackLambdas(ast, remotesParsed, dependencyNames);
  // ── Type constructions: arg count vs declared field count ──────────────
  checkTypeConstructions(ast, remotesParsed);
  // ── Field access on typed structures: property must be a declared field ─
  checkTypeFieldAccess(ast);
  // ── Destructure on typed values: arity + declared-field checks ─────────
  checkTypeDestructure(ast);
  // ── Silent reference calls must precede the first reply-awaiting send ──
  checkSilentRefOrdering(ast);
  checkSilentCallForm(ast, remotesParsed);
  // ── A function that writes says so in its name ────────────────────────
  checkEffects(ast, remotesParsed);
  // A `new@` handler's params are a function's: they get their own names too.
  addConstructHandlers(ast);
  lowerParamScope(ast);
  lowerOwnCellWrites(ast);
  markOuterReads(ast);
  markCallResultTypes(ast);
  // ── A constructor block reads a cell only below its declaration ──────
  checkInitOrder(ast);
  // Last, so every check above reads `as` as written.
  lowerAs(ast);
  lowerBranchOrder(ast);
  // The file's actor answers something (src/actor_interface.js); one with only
  // private names reaches no one. After the other checks, so theirs come first.
  const fileActor = (ast.actors || []).find(a => !a.name);
  if (fileActor && !hasInterface(fileActor, ast)) {
    throw new Error('This actor has nothing anyone can reach: give it a public or protected name');
  }
}

// A `...` call never writes the silent dot, so the parser supplies it
// (`elidedDot`). Two callees are silent under a plain name, and get it back:
// a foreign function its doc marks silent (`write (Text) => .`, called
// `Log.write(m)...`), and a local or param holding a silent function value.
function settleElidedDots(ast, remotesParsed) {
  const strip = (call) => {
    if (call.type === 'DotCallExpr') call.method = call.method.slice(0, -1);
    else call.callee = { ...call.callee, name: call.callee.name.slice(0, -1) };
    delete call.elidedDot;
  };
  for (const actor of ast.actors || []) {
    const fnNames = new Set((actor.functions || []).map(f => f.name).filter(Boolean));
    const visit = (node, locals) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, locals)); return; }
      if (node.elidedDot) {
        if (node.type === 'DotCallExpr') {
          const doc = receiverDoc(node, remotesParsed);
          const plain = node.method.slice(0, -1);
          if (doc && !doc[node.method] && doc[plain]) strip(node);
        } else if (node.type === 'FunctionCallExpr') {
          const name = node.callee.name;
          if (!fnNames.has(name) && locals.has(name.slice(0, -1))) strip(node);
        }
      }
      if (node.type === 'Function' || node.type === 'FunctionDecl') {
        const inner = new Set(locals);
        for (const p of node.params || []) if (p?.name) inner.add(p.name);
        collectLocals(node.body, inner);
        for (const [k, v] of Object.entries(node)) if (k !== 'params' && v && typeof v === 'object') visit(v, inner);
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, locals);
    };
    const collectLocals = (body, into) => {
      for (const s of Array.isArray(body) ? body : []) {
        if ((s?.type === 'Assign' || s?.type === 'TypedAssign' || s?.type === 'RefDecl') && s.name) into.add(s.name);
      }
    };
    const top = new Set((actor.initParams || []).map(p => p.name).filter(Boolean));
    visit(actor.functions, top);
    visit(actor.initBody, top);
    visit(actor.constructorBody, top);
  }
}

// Silence is in the name, so the call form is checked by name alone: a call
// to a silent name (`x.ping.()`) is fire-and-forget (`...`), and a
// `...` call names a silent (or bang) member.
function checkSilentCallForm(ast, remotesParsed = {}) {
  const calleeName = (call) => call.type === 'DotCallExpr' ? call.method
    : call.callee?.type === 'Identifier' ? call.callee.name : null;
  const shown = (call) => call.type === 'DotCallExpr'
    ? `${receiverLabel(call) ? receiverLabel(call) + '.' : ''}${call.method}` : calleeName(call);
  const visit = (node, launched) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, false)); return; }
    if (node.type === 'LaunchStatement' || ((node.type === 'ExprStatement' || node.type === 'ImplicitReturn') && node.ellipsis)) {
      const call = node.type === 'LaunchStatement' ? node.call : node.expr;
      const name = calleeName(call);
      // A foreign function's name is literal, so its doc can say it's silent instead.
      const docSilent = call.type === 'DotCallExpr' && receiverDoc(call, remotesParsed)?.[call.method]?.some?.(sig => sig.silent);
      if (name && !call.silentField && !docSilent && !name.endsWith('.') && !name.endsWith('!')) {
        throw new Error(`'${shown(call)}' returns a value; '...' needs a silent '${name}.'`);
      }
      // A launched call doesn't wait for a reply, whatever made it silent.
      if (call.type === 'DotCallExpr') call.launched = true;
      visit(call, true);
      return;
    }
    if (node.type === 'DotCallExpr' && node.method?.endsWith('.') && !launched) {
      throw new Error(`'${shown(node)}' is silent — call it '${shown(node).replace(/\.$/, '')}(…)...' (fire-and-forget)`);
    }
    // A doc can make a foreign function silent without the dot: `log (Text) => .`.
    // Nothing would answer a wait for it either.
    if (node.type === 'DotCallExpr' && !launched && receiverDoc(node, remotesParsed)?.[node.method]?.some?.(sig => sig.silent)) {
      throw new Error(`'${shown(node)}' is silent — call it '${shown(node).replace(/\.$/, '')}(…)...' (fire-and-forget)`);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, false);
  };
  for (const actor of ast.actors || []) {
    visit(actor.functions, false);
    visit(actor.initBody, false);
  }
}

// ── Type declaration registry checks ──────────────────────────────────────
// Slice 2 of types-implementation-plan-2026-04-27: a declared type is the canonical
// home for that name within its file. Enforce uniqueness and basic shape so
// downstream slices can rely on `ast.types` having one well-formed entry per
// declared name.
function checkTypeDecls(ast) {
  const seen = new Set();
  for (const decl of (ast.types || [])) {
    if (seen.has(decl.name)) {
      throw new Error(`Duplicate type declaration: '${decl.name}' is declared more than once in this file`);
    }
    seen.add(decl.name);

    const fieldNames = new Set();
    for (const field of (decl.fields || [])) {
      if (fieldNames.has(field.name)) {
        throw new Error(`Duplicate field '${field.name}' in '${decl.name}'`);
      }
      fieldNames.add(field.name);
    }
  }
}

// A record's encoded type at `key` (`paramType` → `paramTypeEnc`).
const encAt = (record, key) => record?.[`${key}Enc`];

// A field's call discipline from its declared type: 'value' (not behavioral,
// cannot be invoked), 'silent' (it never replies), 'callback' (a function that
// replies).
function fieldDisciplineOf(field) {
  const t = encAt(field, 'paramType');
  if (!isFn(t)) return 'value';
  return fnReply(t) === 'silent' ? 'silent' : 'callback';
}

// A function type's inputs, as encoded types: by name, and positional in order.
function callbackInputsEnc(t) {
  const args = fnSignature(t)?.args || [];
  const last = args[args.length - 1];
  const isNamed = last && typeof last === 'object' && !Array.isArray(last) && !Object.keys(last).some(k => k.startsWith('%'));
  const unwrap = (x) => (x && typeof x === 'object' && '%opt' in x ? x['%opt'] : x);
  return {
    positional: (isNamed ? args.slice(0, -1) : args).map(unwrap),
    named: Object.fromEntries(Object.entries(isNamed ? last : {}).map(([k, v]) => [k, unwrap(v)])),
  };
}

// The name, when an encoded type is a single name this file didn't resolve and
// isn't a built-in: neither declared nor imported (a declared or imported one is
// an address). Otherwise null.
function unknownBareType(t) {
  if (typeof t !== 'string' || t.includes(':') || BUILTIN_TYPE_NAMES.has(t)) return null;
  return t;
}

// Infer a lambda's untyped params from a callback signature (encoded): param i
// takes the signature's input i, its positional inputs then its named ones.
// `resolve(t)` is told each input type a param takes (a service-hosted one is
// registered for the code generators there). An explicit annotation is never
// overwritten. When `nameable` is provided, an explicit bare type that is not
// declared/imported is rejected (naming a type requires an explicit import;
// implicit import is inference-only). Sets `fnNode.params[i].typeEnc` in place.
// Returns the types applied.
function inferLambdaParamsFromCallbackType(fnNode, paramTypeEnc, resolve = (t) => t, nameable = null) {
  if (!fnNode || fnNode.type !== 'Function' || !Array.isArray(fnNode.params)) return [];
  if (!isFn(paramTypeEnc)) return [];
  const inputsEnc = callbackInputsEnc(paramTypeEnc);
  const inputs = [...inputsEnc.positional, ...Object.values(inputsEnc.named)];
  // A lambda filling a silent slot (`-> .`) is itself silent: it yields no
  // reply, so the synthesized dispatch arm must not produce one. Without this
  // the arm sets `re` and routes a spurious reply, which on local self-dispatch
  // re-enters dispatch as an op-less message. The slot is authoritative here.
  if (fnReply(paramTypeEnc) === 'silent') fnNode.returnType = '.';
  const applied = [];
  for (let i = 0; i < fnNode.params.length; i++) {
    const p = fnNode.params[i];
    if (!p || p.rest) continue;
    if (p.typeEnc !== undefined || p.typeUnencoded) {
      // Explicit annotation: honored, never overwritten — but a bare,
      // undeclared/unimported type name is an error.
      if (nameable) {
        const u = unknownBareType(encAt(p, 'type'));
        if (u) {
          throw new Error(
            `Lambda parameter type '${u}' is not declared or imported — ` +
            `import it (e.g. '(:${u})') or qualify it ('Alias::${u}')`,
          );
        }
      }
      continue;
    }
    const input = inputs[i];
    if (input === undefined) continue;
    p.typeEnc = resolve(input);
    applied.push(p.typeEnc);
  }
  return applied;
}

// Given a type construction's field list and its args, call `onCallbackLambda`
// for each callback-typed field (`paramType` is a function signature) that a
// lambda (`Function` node) fills — positional by index, or named by field name.
function forEachCallbackLambdaArg(node, fields, onCallbackLambda) {
  const positional = node.args.filter(a => a?.type !== 'NamedArgsBag');
  const namedBag = node.args.find(a => a?.type === 'NamedArgsBag');
  const named = namedBag?.fields || {};
  const asFunction = (a) => (a?.type === 'Function' ? a : (a?.expr?.type === 'Function' ? a.expr : null));
  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    if (!isFn(encAt(field, 'paramType'))) continue;
    const arg = field.named ? named[field.name] : positional[fi];
    const fn = asFunction(arg);
    if (fn) onCallbackLambda(fn, field.paramTypeEnc, field);
  }
}

// C3: infer callback-lambda params passed to a service METHOD whose declared
// parameter is a callback. Runs after per-actor validation (so call shapes are
// settled) and before the field-access checks (so inferred params + their scoped
// decls are in place). Mirrors the construction-side inference, sourcing method
// signatures from the parsed remote interface. Named callback params only (the
// `onclick:` shape); positional function-type params hit a separate interface
// split limitation.
function inferRemoteCallbackLambdas(ast, remotesParsed, dependencyNames) {
  if (!remotesParsed || Object.keys(remotesParsed).length === 0) return;
  const nameable = new Set([
    ...(ast.types || []).map(t => t.name),
    ...Object.keys(ast.importedTypes || {}),
  ]);
  const resolverFor = (alias) => serviceTypesIn(ast, remotesParsed, alias);
  const aliasOf = (obj, env) => {
    if (!obj || (obj.type !== 'Identifier' && obj.type !== 'RefRead')) return null;
    if (dependencyNames.has(obj.name)) return obj.name;
    return depOfEnc(env.get(obj.name), dependencyNames);
  };
  const inferCall = (call, env) => {
    const alias = aliasOf(call.object, env);
    if (!alias) return;
    const sigs = remotesParsed[alias]?.[call.method];
    if (!Array.isArray(sigs)) return;
    const positional = call.args.filter(a => a.positional !== false && a.type !== 'NamedArgsBag');
    const named = {};
    for (const a of call.args) {
      if (a.type === 'NamedArgsBag') Object.assign(named, a.fields);
      else if (a.positional === false && a.name) named[a.name] = a.expr;
    }
    const asFn = (a) => (a?.type === 'Function' ? a : (a?.expr?.type === 'Function' ? a.expr : null));
    const resolve = resolverFor(alias);
    for (const sig of sigs) {
      let pi = 0;
      for (const p of (sig.params || [])) {
        const argExpr = p.name ? named[p.name] : positional[pi++];
        if (isFn(encAt(p, 'type'))) {
          const fn = asFn(argExpr);
          if (fn) inferLambdaParamsFromCallbackType(fn, p.typeEnc, resolve, nameable);
        }
      }
    }
  };
  const walk = (node, env) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, env); return; }
    if (node.type === 'DotCallExpr') inferCall(node, env);
    for (const k of Object.keys(node)) { if (k === 'type') continue; walk(node[k], env); }
  };
  for (const actor of (ast.actors || [])) {
    for (const fn of (actor.functions || [])) {
      walk(fn.body, buildTypeEnv(fn.params || [], fn.body || [], null));
    }
    if (actor.constructorBody) walk(actor.constructorBody, buildTypeEnv([], actor.constructorBody, null));
    if (actor.initBody) walk(actor.initBody, buildTypeEnv([], actor.initBody, null));
  }
}

// Each type a value can have, by its address: this file's, an imported one (under
// the address of the name it's imported as), and one reached through a service.
function typesByAddress(ast) {
  return new Map([...buildTypeTable(ast).values()].map(e => [e.key, e]));
}

// The types of the service `alias` that `t` names, registered in
// `ast.crossModuleTypes` for the code generators; `t` itself.
function serviceTypesIn(ast, remotesParsed, alias) {
  const declMap = remotesParsed?.[alias]?.__typeDecls;
  const dep = (ast.dependencies || []).find(d => d.name === alias);
  const nameable = new Set([...(ast.types || []).map(t => t.name), ...Object.keys(ast.importedTypes || {})]);
  return (t) => {
    if (!declMap || !dep?.path) return t;
    for (const a of addressesIn(t)) {
      const tokens = a.startsWith(':') ? [] : splitAddress(a);
      if (tokens.length !== 2 || tokens[0] !== dep.path || nameable.has(tokens[1]) || !declMap[tokens[1]]) continue;
      (ast.crossModuleTypes ||= {})[`${alias}::${tokens[1]}`] = { name: tokens[1], fields: declMap[tokens[1]].fields, path: dep.path };
    }
    return t;
  };
}

// Slice 3 of types-implementation-plan-2026-04-27: validate `Name(args)` call
// sites against the declared type: positional and named args against its fields.
function checkTypeConstructions(ast, remotesParsed = {}) {
  const declByAddress = typesByAddress(ast);
  if (declByAddress.size === 0) return;

  // File-scope nameable types: locally declared types plus explicitly
  // imported names. An *explicit* lambda-param annotation naming a bare type
  // outside this set is an error — implicit (inferred) import is inference-only
  // and never widens this set.
  const nameable = new Set([
    ...(ast.types || []).map(t => t.name),
    ...Object.keys(ast.importedTypes || {}),
  ]);

  // Resolver for callback-param inference, selected per host construction.
  //  - Local host type → the input type name is used as-is (it is in the local
  //    or imported namespace already).
  //  - Service-hosted host type (imported) → map the bare input type to its
  //    authority `Alias::Name` and register a *scoped* cross-module decl so the
  //    lambda body can resolve the type's fields WITHOUT the bare name ever
  //    becoming nameable at file scope.
  function resolveCallbackParamType(hostTypeName) {
    const hostImport = Object.values(ast.importedTypes || {}).find(i => i.remote === hostTypeName);
    return hostImport ? serviceTypesIn(ast, remotesParsed, hostImport.sourceAlias) : (t) => t;
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type === 'TypeConstruction') {
      const decl = declByAddress.get(node.typeNameEnc);
      if (!decl) {
        throw new Error(`Type '${shown(node.typeNameEnc)}' is referenced but not declared`);
      }
      // Its name as the message writes it: an imported type by its name there.
      const label = node.typeNameEnc?.startsWith?.(':') ? shown(node.typeNameEnc) : node.typeName;
      // Args follow FunctionCallExpr's calling convention: bare expressions
      // fill the positional fields in order, and a trailing `NamedArgsBag`
      // fills the named fields by name. Neither reaches the other's fields
      // (notes/positional-type-fields-2026-11-26.md).
      const fields = decl.fields;
      const posFields = fields.filter(f => !f.named);
      const namedFields = fields.filter(f => f.named);
      const positional = node.args.filter(a => a?.type !== 'NamedArgsBag');
      const namedBag = node.args.find(a => a?.type === 'NamedArgsBag');
      // A silent field's key carries its silent `.` (`onpress.: …`); the field
      // is stored without it.
      if (namedBag?.fields) {
        const isSilent = (n) => { const f = namedFields.find(x => x.name === n); return !!f && fieldDisciplineOf(f) === 'silent'; };
        for (const key of Object.keys(namedBag.fields)) {
          const plain = key.endsWith('.') ? key.slice(0, -1) : key;
          if (key.endsWith('.') && namedFields.some(f => f.name === plain) && !isSilent(plain)) {
            throw new Error(`Type construction '${label}(...)': field '${plain}' is not silent — write '${plain}:'`);
          }
          if (!key.endsWith('.') && isSilent(key)) {
            throw new Error(`Type construction '${label}(...)': field '${key}.' is silent — write '${key}.:'`);
          }
          if (plain !== key) {
            namedBag.fields = Object.fromEntries(Object.entries(namedBag.fields).map(([k, v]) => [k === key ? plain : k, v]));
          }
        }
      }
      const namedKeys = Object.keys(namedBag?.fields || {});
      const firstOptional = posFields.findIndex(f => f.optional);
      const requiredCount = firstOptional === -1 ? posFields.length : firstOptional;
      if (positional.length < requiredCount || positional.length > posFields.length) {
        const n = posFields.length;
        const range = requiredCount === n ? `${n}` : `${requiredCount}–${n}`;
        throw new Error(`Type construction '${label}(...)' expects ${range} positional argument${range === '1' ? '' : 's'}, got ${positional.length}`);
      }
      for (const key of namedKeys) {
        if (!namedFields.some(f => f.name === key)) {
          throw new Error(`Type construction '${label}(...)' has no field named '${key}'`);
        }
      }
      const missing = namedFields.filter(f => !f.optional && !namedKeys.includes(f.name)).map(f => f.name);
      if (missing.length > 0) {
        throw new Error(
          `Type construction '${label}(...)' is missing required ` +
          `field${missing.length === 1 ? '' : 's'} ${missing.map(m => `'${m}'`).join(', ')}`,
        );
      }
      // Contextual inference: a callback field (`paramType` is a function sig)
      // filled by a lambda gets its untyped params typed from that signature.
      // For a locally-declared host type the input type name is used as-is; a
      // service-hosted host resolves the name to its authority (see C2).
      const resolve = resolveCallbackParamType(node.typeName);
      forEachCallbackLambdaArg(node, fields, (fn, sigEnc) => {
        inferLambdaParamsFromCallbackType(fn, sigEnc, resolve, nameable);
      });
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      walk(node[k]);
    }
  }
  walk(ast);
}

// Slice 5 of types-implementation-plan-2026-04-27: when `obj.field` is read
// and `obj` is statically a typed object (a TypeConstruction directly, or
// an identifier whose typeEnv binding is a user-declared type), the
// property must be one of that type's declared fields.
function checkTypeFieldAccess(ast) {
  const typesByName = typesByAddress(ast);
  if (typesByName.size === 0) return;

  function objStaticType(obj, env) {
    if (!obj) return null;
    if (obj.type === 'TypeConstruction') return obj.typeNameEnc;
    if (obj.type === 'Identifier' && env.has(obj.name)) return env.get(obj.name);
    return null;
  }

  // A field's call discipline from its declared type: 'value' (not behavioral,
  // cannot be invoked), 'silent' (`() -> .`, fire-and-forget, no reply),
  // 'callback' (any other `->` output, reply-awaiting), or null (no such field).
  function fieldDiscipline(decl, name) {
    const f = decl.fields.find(ff => ff.named && ff.name === name);
    return f ? fieldDisciplineOf(f) : null;
  }

  // Is `expr` the invocation of a silent reference field? (bang DotAccess, or a
  // DotCall onto a silent field.) Such a call yields no value.
  function isSilentRefCall(expr, env) {
    let obj, name;
    if (expr?.type === 'DotAccessExpr' && expr.property.endsWith('!')) { obj = expr.object; name = expr.property.slice(0, -1); }
    else if (expr?.type === 'DotCallExpr') { obj = expr.object; name = expr.method.endsWith('!') ? expr.method.slice(0, -1) : expr.method; }
    else return false;
    const decl = typesByName.get(objStaticType(obj, env));
    return !!decl && fieldDiscipline(decl, name) === 'silent';
  }

  function walkExpr(expr, env) {
    if (!expr || typeof expr !== 'object') return;
    if (Array.isArray(expr)) { for (const e of expr) walkExpr(e, env); return; }
    // A nested lambda opens a new scope: its params (typed by contextual
    // inference upstream) must enter the env before its body is checked, so a
    // field access on a lambda param resolves against the inferred type.
    if (expr.type === 'Function') {
      const childEnv = new Map(env);
      for (const [k, v] of buildTypeEnv(expr.params || [], expr.body || [], typesByName)) childEnv.set(k, v);
      if (Array.isArray(expr.body)) walkBody(expr.body, childEnv);
      if (expr.expr) walkExpr(expr.expr, childEnv);
      return;
    }
    // Field access / invocation on a typed value. The bang (`v.ref!`) rides in
    // the property name; a DotCall carries the field as `method`.
    if (expr.type === 'DotAccessExpr' || expr.type === 'DotCallExpr') {
      const t = objStaticType(expr.object, env);
      const decl = typesByName.get(t);
      if (decl) {
        const tname = shown(t);
        const raw = expr.type === 'DotAccessExpr' ? expr.property : expr.method;
        const bang = raw.endsWith('!');
        const dotted = raw.endsWith('.');
        // A writing field keeps its `!`: `run!` is its whole name.
        if (bang && fieldDiscipline(decl, raw) === 'callback') return walkChildren(expr, env);
        const name = bang || dotted ? raw.slice(0, -1) : raw;
        const disc = fieldDiscipline(decl, name);
        if (disc === null && !bang && !dotted && fieldDiscipline(decl, name + '!')) {
          throw new Error(`Field '${name}!' on '${tname}' writes — call it '.${name}!(…)'`);
        }
        if (disc === null) {
          throw new Error(`Type '${tname}' has no field '${name}'`);
        }
        // A silent reference field is named `name.` (stored without the dot):
        // read or launched as `.name.` / `.name...`, never called as `.name()`.
        if (dotted && disc !== 'silent') {
          throw new Error(`Field '${name}' on '${tname}' is not silent — it is '.${name}', not '.${raw}'`);
        }
        if (!dotted && !bang && disc === 'silent') {
          throw new Error(`Reference field '${name}.' on '${tname}' is silent — call it '.${name}...' (fire-and-forget), or read it as '.${name}.'`);
        }
        if (dotted) {
          if (expr.type === 'DotAccessExpr') expr.property = name; else expr.method = name;
          expr.silentField = true;
        }
        // A trailing '!' is part of a member's name and may appear only on a
        // function member declared with it. A writing field declared `foo!` was
        // found above, so a '!' here names a member that doesn't exist:
        // `.foo!` and `.foo` are distinct members, and only `.foo` exists.
        if (bang) {
          throw new Error(
            disc === 'value'
              ? `Field '${name}' on '${tname}' is a value, not a function — it cannot be invoked with '!'`
              : `Reference field '${name}' on '${tname}' is declared without '!' — invoke it as '.${name}(...)' ('!' names a distinct member, not a call-site marker)`,
          );
        }
        // Invoking a plain value field is an error; a bare read of it is fine.
        if (expr.type === 'DotCallExpr' && disc === 'value') {
          throw new Error(`Field '${name}' on '${tname}' is not a reference and cannot be invoked`);
        }
      }
    }
    walkChildren(expr, env);
  }

  function walkChildren(expr, env) {
    for (const k of Object.keys(expr)) {
      if (k === 'type') continue;
      walkExpr(expr[k], env);
    }
  }

  function walkBody(body, env) {
    for (const s of (body || [])) {
      // A silent reference call yields no value, so it cannot be bound.
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && isSilentRefCall(s.value, env)) {
        throw new Error(`Silent reference call has no value to bind`);
      }
      walkExpr(s, env);
    }
  }

  for (const actor of (ast.actors || [])) {
    for (const fn of (actor.functions || [])) {
      const env = buildTypeEnv(fn.params || [], fn.body || [], typesByName);
      walkBody(fn.body, env);
    }
    walkBody(actor.constructorBody, buildTypeEnv([], actor.constructorBody || [], typesByName));
    walkBody(actor.initBody, buildTypeEnv([], actor.initBody || [], typesByName));
  }
}

// A silent reference call (`v.endpoint!`) must honor the native frame it may be
// running in: it must lexically precede the handler's first reply-awaiting
// send, because any await thereafter yields off that frame. Reads and other
// silent calls before it are fine. Lexical (source-order) position is the sound
// first approximation — an await in an earlier branch is lexically earlier, so
// a silent call after it is rejected without control-flow dominance analysis.
//
// v1 barrier: a callback-discipline reference invocation (the reply-awaiting
// reference call). Broadening the barrier to every awaited send (remote/child
// method calls) is future work — see the design note.
function checkSilentRefOrdering(ast) {
  const typesByName = typesByAddress(ast);
  if (typesByName.size === 0) return;

  const objStaticType = (obj, env) => {
    if (!obj) return null;
    if (obj.type === 'TypeConstruction') return obj.typeNameEnc;
    if (obj.type === 'Identifier' && env.has(obj.name)) return env.get(obj.name);
    return null;
  };
  const fieldDiscipline = (decl, name) => {
    const f = decl.fields.find(ff => ff.named && ff.name === name);
    return f ? fieldDisciplineOf(f) : null;
  };
  // Classify an invocation node as 'silent' | 'callback' (barrier) | null.
  const classify = (node, env) => {
    let obj, raw;
    if (node?.type === 'DotCallExpr') { obj = node.object; raw = node.method; }
    else if (node?.type === 'DotAccessExpr' && node.property.endsWith('!')) { obj = node.object; raw = node.property; }
    else return null;
    const name = raw.endsWith('!') ? raw.slice(0, -1) : raw;
    const decl = typesByName.get(objStaticType(obj, env));
    return decl ? fieldDiscipline(decl, name) : null;
  };

  // Pre-order, source-order walk. Statement/children arrays are visited in
  // order and a node is fully descended before its next sibling, so a call in
  // an earlier branch counts as lexically earlier.
  const walk = (node, env, state) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, env, state); return; }
    // A nested lambda runs in its own frame: open a child scope (its inferred
    // params enter the env) with a FRESH ordering state, so its silent calls are
    // ordered against the lambda's own awaited sends, not the enclosing handler's.
    if (node.type === 'Function') {
      const childEnv = new Map([...env, ...buildTypeEnv(node.params || [], node.body || [], typesByName)]);
      const body = Array.isArray(node.body) ? node.body : (node.expr ? [node.expr] : []);
      walk(body, childEnv, { sawAwaited: false });
      return;
    }
    const disc = classify(node, env);
    if (disc === 'callback') state.sawAwaited = true;
    else if (disc === 'silent' && state.sawAwaited) {
      throw new Error(`Silent reference call must precede the first awaited send`);
    }
    for (const k of Object.keys(node)) { if (k === 'type') continue; walk(node[k], env, state); }
  };

  for (const actor of (ast.actors || [])) {
    for (const fn of (actor.functions || [])) {
      const env = buildTypeEnv(fn.params || [], fn.body || [], typesByName);
      walk(fn.body, env, { sawAwaited: false });
    }
  }
}

// Spec section "Destructuring" of types-implementation-plan-2026-04-27:
// destructuring a typed value is permissive selection (a subset of fields
// may be pulled) but strict existence (referencing an undeclared field is an
// error). Positional destructure may take at most N fields where N is the
// count of positional fields; named destructure reaches named fields only.
function checkTypeDestructure(ast) {
  const typesByName = typesByAddress(ast);
  if (typesByName.size === 0) return;

  function sourceTypeName(src, env) {
    if (!src) return null;
    if (src.type === 'TypeConstruction') return src.typeNameEnc;
    if (src.type === 'Identifier' && env.has(src.name)) return env.get(src.name);
    return null;
  }

  function checkOne(s, env) {
    const t = sourceTypeName(s.source, env);
    const decl = typesByName.get(t);
    if (!decl) return;
    const tname = shown(t);
    const posCount = (decl.fields || []).filter(f => !f.named).length;
    const named = (decl.fields || []).filter(f => f.named);
    for (const item of s.pattern) {
      if (item.discard || item.spread) continue;
      if (item.positional) {
        if (item.idx >= posCount) {
          throw new Error(`Type '${tname}' has ${posCount} positional field${posCount === 1 ? '' : 's'}; positional destructure requested ${item.idx + 1}`);
        }
      } else if (item.named) {
        if (!named.find(f => f.name === item.name)) {
          throw new Error(`Type '${tname}' has no field '${item.name}'`);
        }
      } else if (item.key !== undefined) {
        if (!named.find(f => f.name === item.key)) {
          throw new Error(`Type '${tname}' has no field '${item.key}'`);
        }
      }
    }
  }

  function walkBody(body, env) {
    for (const s of (body || [])) {
      if (s?.type === 'DestructureAssign') checkOne(s, env);
    }
  }

  for (const actor of (ast.actors || [])) {
    for (const fn of (actor.functions || [])) {
      walkBody(fn.body, buildTypeEnv(fn.params || [], fn.body || [], typesByName));
    }
    walkBody(actor.constructorBody, buildTypeEnv([], actor.constructorBody || [], typesByName));
    walkBody(actor.initBody, buildTypeEnv([], actor.initBody || [], typesByName));
  }
}

// ── Imported-type call-site rewrite (slice 15) ─────────────────────────────
// `extract` runs `rewriteTypeConstructions` against `ast.types` only — at
// that point the destructure→type binding from `options.remotes` is unknown.
// Once validate has parsed the remote interfaces and built `importedTypes`,
// rewrite any `FunctionCallExpr` whose callee is an imported-type local name
// into a `TypeConstruction` whose typeName is the *canonical* (remote) name.
// This keeps the wire tag invariant under local renames: `(Point: P)` still
// produces `Point` annotations.
function rewriteImportedTypeConstructions(ast, importedTypes) {
  const isImportedTypeCall = (n) =>
    n && n.type === 'FunctionCallExpr' &&
    n.callee?.type === 'Identifier' &&
    importedTypes[n.callee.name] || null;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i]);
        const child = node[i];
        const info = isImportedTypeCall(child);
        if (info) node[i] = { type: 'TypeConstruction', typeName: info.remote, typeNameEnc: ast.typeNamed([child.callee.name]), args: child.args };
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      const child = node[k];
      walk(child);
      const info = isImportedTypeCall(child);
      if (info) node[k] = { type: 'TypeConstruction', typeName: info.remote, typeNameEnc: ast.typeNamed([child.callee.name]), args: child.args };
    }
  }
  walk(ast);
}

// ── Cross-module type ref validation (slice 15) ────────────────────────────
// `Service::Name` may appear in any type-annotation slot (field paramType,
// param type, BareTypeDecl, etc.). Validate the alias side: `Service` must
// be a declared dep, and — when the source iface is parsed and exports
// types — `Name` must be one of those types.
function validateCrossModuleTypeRefs(ast, dependencyNames, remotesParsed) {
  const checked = new Set();
  // A service's address head, by the alias the file writes it with.
  const aliasOf = new Map((ast.dependencies || []).filter(d => d.type === 'Dependency' && d.path && !d.destructures).map(d => [d.path, d.name]));
  // A type that is a name reached through another actor, `A::B` (or `A::B | null`):
  // an address relative to this file, of two tokens.
  const check = (t) => {
    if (t === undefined || checked.has(t)) return;
    checked.add(t);
    const named = encMembers(t).filter(m => m !== null);
    if (named.length !== 1 || (isUnion(t) && encMembers(t).length !== 2)) return;
    const [a] = named;
    if (typeof a !== 'string' || a.startsWith(':') || isInstance(a) || !a.includes(':')) return;
    const tokens = splitAddress(a);
    if (tokens.length !== 2) return;
    const alias = aliasOf.get(tokens[0]) ?? tokens[0];
    const remoteName = tokens[1];
    if (!dependencyNames.has(alias)) {
      throw new Error(`Cross-module type '${alias}::${remoteName}' references unknown dependency alias '${alias}'`);
    }
    const iface = remotesParsed[alias];
    if (!iface || !iface.__typeDecls) return;
    if (!iface.__typeDecls[remoteName]) {
      throw new Error(`Type '${remoteName}' is not exported by '${alias}'`);
    }
    // Stash the resolved decl so codegen can treat `Alias::Name` as a known
    // type (field access, reference-field dispatch, wire reconstruction). The
    // authority is the dependency PATH (stable), not the local alias.
    const dep = (ast.dependencies || []).find(d => d.name === alias);
    (ast.crossModuleTypes ||= {})[`${alias}::${remoteName}`] = {
      name: remoteName,
      fields: iface.__typeDecls[remoteName].fields,
      path: dep?.path || alias,
    };
  };
  for (const decl of (ast.types || [])) {
    for (const f of (decl.fields || [])) check(f.paramTypeEnc);
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    check(node.typeNameEnc);
    check(node.paramTypeEnc);
    // A param: `{ name, typeEnc, positional, ... }`.
    if (typeof node.name === 'string' && 'positional' in node) check(node.typeEnc);
    for (const k of Object.keys(node)) {
      if (k === 'type' || k.endsWith('Enc')) continue;
      walk(node[k]);
    }
  }
  walk(ast);
}

// ── Decimal termination check ────────────────────────────────────────────
// Walk the AST looking for DecimalLiteral / DecimalLiteral or
// DecimalLiteral ** negative-IntLiteral where the result is non-terminating.

function checkDecimalTermination(ast) {
  function walkExpr(expr) {
    if (!expr || typeof expr !== 'object') return;
    if (expr.type === 'BinaryExpr') {
      walkExpr(expr.left);
      walkExpr(expr.right);
      if (expr.op === '/') {
        const lDec = expr.left.type === 'DecimalLiteral';
        const rDec = expr.right.type === 'DecimalLiteral';
        const lInt = expr.left.type === 'IntLiteral';
        const rInt = expr.right.type === 'IntLiteral';
        if ((lDec || lInt) && (rDec || rInt) && (lDec || rDec)) {
          const lv = parseDecimalLiteral(expr.left.value);
          const rv = parseDecimalLiteral(expr.right.value);
          if (!isTerminatingDivision(lv.coeff, lv.scale, rv.coeff, rv.scale)) {
            throw new Error(`Non-terminating decimal division: ${expr.left.value} / ${expr.right.value}`);
          }
        }
      }
      // Note: negative exponent (e.g. 3.0 ** -1) is checked at runtime only,
      // because the parser does not support unary minus / negative literals.
      return;
    }
    // ── Math method compile-time checks ─────────────────────────────────
    if (expr.type === 'MathMethodExpr') {
      const meta = MATH_METHODS.get(expr.method);
      if (meta && meta.accepts === 'float-decimal' && expr.args.length >= 1) {
        const arg = expr.args[0];
        if (arg.type === 'IntLiteral') {
          throw new Error(`Math.${expr.method}() does not accept Integer — value is already whole`);
        }
        // Also catch typed Integer parameters (known from the type environment at the actor level)
      }
      for (const a of expr.args) walkExpr(a);
      return;
    }
    for (const val of Object.values(expr)) {
      if (Array.isArray(val)) {
        for (const item of val) walkExpr(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkExpr(val);
      }
    }
  }

  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      for (const s of (fn.body || [])) walkExpr(s);
    }
    for (const s of (actor.constructorBody || [])) walkExpr(s);
    for (const s of (actor.initBody || [])) walkExpr(s);
    for (const d of (actor.stateVarDecls || [])) {
      if (d.value) walkExpr(d.value);
    }
  }
}

// ── List method element-type compatibility ────────────────────────────────
// Reject e.g. `List.contains(List[Integer], "x")` at compile time, because
// the runtime equality helper would fall through to identity and return false
// silently. Also restricts `join` to `List[Text]`.
//
// Argument-position semantics by method:
//   • element-position (contains, index_of, before, after, append, prepend,
//                       replace*):
//       arg should be Element type (or Anything wildcard).
//       append/prepend take a single element — for list+list use concat.
//   • list-position (starts_with, ends_with, concat):
//       arg should be List of compatible Element
//   • Integer-position (at, slice, take, from, repeat): arg must be Integer
//   • join: receiver must be List[Text]; sep must be Text
//   • flatten: receiver must be List[List]
//
// Element checks pass when either side is 'Anything' / 'List[Anything]', or
// when the type can't be inferred (typeEnv miss). The only hard rejections are
// confidently-known mismatches.
function checkListMethodArgs(ast) {
  const ELEMENT_ARG_METHODS = new Set(['contains', 'index_of', 'before', 'after', 'append', 'prepend']);
  const LIST_ARG_METHODS = new Set(['starts_with', 'ends_with', 'concat']);
  const INT_ARG_METHODS = new Set(['at', 'take', 'from', 'repeat']);

  function checkOne(expr, typeEnv) {
    if (expr.type !== 'ListMethodExpr') return;
    const meta = LIST_METHODS.get(expr.method);
    if (!meta) return;
    // Types here are encoded; a message shows them as Brevity writes them.
    const recvType = inferType(expr.args[0], typeEnv);
    const elemType = listElement(recvType);
    const known = (t) => t !== undefined;
    const scalarIs = (t, want) => !known(t) || t === want || t === 'Anything';

    if (ELEMENT_ARG_METHODS.has(expr.method)) {
      const argType = inferType(expr.args[1], typeEnv);
      if (!typesCompatibleEnc(argType, elemType)) {
        throw new Error(`List.${expr.method} on ${show(recvType)}: argument type ${show(argType)} is not compatible with element type ${show(elemType)}`);
      }
    } else if (expr.method === 'replace' || expr.method === 'replace_first') {
      // (list, old, new): both old and new must match element type.
      const oldType = inferType(expr.args[1], typeEnv);
      const newType = inferType(expr.args[2], typeEnv);
      if (!typesCompatibleEnc(oldType, elemType)) {
        throw new Error(`List.${expr.method} on ${show(recvType)}: needle type ${show(oldType)} is not compatible with element type ${show(elemType)}`);
      }
      if (!typesCompatibleEnc(newType, elemType)) {
        throw new Error(`List.${expr.method} on ${show(recvType)}: replacement type ${show(newType)} is not compatible with element type ${show(elemType)}`);
      }
    } else if (LIST_ARG_METHODS.has(expr.method)) {
      // concat is variadic — every arg after the receiver must be a
      // compatible List. starts_with / ends_with take exactly one.
      for (let i = 1; i < expr.args.length; i++) {
        const argType = inferType(expr.args[i], typeEnv);
        const argElem = listElement(argType);
        if (!isList(argType)) {
          if (known(argType) && argType !== null) throw new Error(`List.${expr.method} on ${show(recvType)}: argument must be a List, got ${show(argType)}`);
        } else if (!typesCompatibleEnc(argElem, elemType)) {
          throw new Error(`List.${expr.method} on ${show(recvType)}: argument's element type ${show(argElem)} is not compatible with ${show(elemType)}`);
        }
      }
    } else if (INT_ARG_METHODS.has(expr.method)) {
      const argType = inferType(expr.args[1], typeEnv);
      if (!scalarIs(argType, 'Integer')) {
        throw new Error(`List.${expr.method} requires an Integer index, got ${show(argType)}`);
      }
    } else if (expr.method === 'slice') {
      const start = inferType(expr.args[1], typeEnv);
      if (!scalarIs(start, 'Integer')) {
        throw new Error(`List.slice requires an Integer start, got ${show(start)}`);
      }
      if (expr.args[2]) {
        const end = inferType(expr.args[2], typeEnv);
        if (!scalarIs(end, 'Integer')) {
          throw new Error(`List.slice requires an Integer end, got ${show(end)}`);
        }
      }
    } else if (expr.method === 'join') {
      // receiver must be List[Text]; sep must be Text.
      if (known(recvType) && recvType !== ANY_LIST && recvType !== listOf('Text')) {
        throw new Error(`List.join is only valid on List[Text], got ${show(recvType)}`);
      }
      const sepType = inferType(expr.args[1], typeEnv);
      if (!scalarIs(sepType, 'Text')) {
        throw new Error(`List.join separator must be Text, got ${show(sepType)}`);
      }
    } else if (expr.method === 'flatten') {
      // receiver must be List[List] (any element type for the inner list).
      if (known(recvType) && recvType !== ANY_LIST && !isList(elemType)) {
        throw new Error(`List.flatten is only valid on a List[List], got ${show(recvType)}`);
      }
    }
  }

  // `over`, `reduce` and `List.sort(xs) fn` go through a List. A value known to be
  // something else (`over(n)` of an Integer) is an error where it's met.
  function checkIterated(expr, typeEnv) {
    const coll = expr.type === 'SortByExpr' ? expr.list : expr.collection;
    const t = inferType(coll, typeEnv);
    if (t === undefined || t === null || t === 'Anything' || isList(t)) return;
    if (isUnion(t) && t['%or'].some(m => m === null || m === 'Anything' || isList(m))) return;
    const what = expr.type === 'OverExpr' ? 'over' : expr.type === 'ReduceExpr' ? 'reduce' : 'List.sort';
    throw new Error(`'${what}' goes through a List, got ${show(t)}`);
  }

  function walkBody(body, typeEnv) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'ListMethodExpr') checkOne(node, typeEnv);
      if (node.type === 'OverExpr' || node.type === 'ReduceExpr' || node.type === 'SortByExpr') checkIterated(node, typeEnv);
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    walk(body);
  }

  for (const actor of (ast.actors || [])) {
    // State-var types visible to all functions.
    const stateEnv = new Map();
    for (const d of (actor.stateVarDecls || [])) {
      if (d.name && d.typeNameEnc !== undefined) stateEnv.set(d.name, d.typeNameEnc);
    }
    for (const fn of (actor.functions || [])) {
      const typeEnv = buildTypeEnvEnc(fn.params || [], fn.body || []);
      for (const [k, v] of stateEnv) if (!typeEnv.has(k)) typeEnv.set(k, v);
      walkBody(fn.body || [], typeEnv);
    }
    walkBody(actor.constructorBody || [], stateEnv);
    walkBody(actor.initBody || [], stateEnv);
  }
}

// ── Constructor manifest parsing ──────────────────────────────────────────
//
// A # dependency's manifest from options.remotes has the shape
//   <:p Type, ...> -> { method: sig, ... }
// matching the inline form. This helper splits it into ctor params + the
// inner service interface string. Returns null if the input isn't shaped
// like a constructor manifest (so the caller can fall back to a plain service).

// A remote's document as `options.remotes` gives it, a JSON document
// (notes/opre-type-encoding-2026-11-21.md), from the service at `path`: its
// interface, as the compiler reads one, and the params of its `new` when it is a
// constructor document, a service whose own `$new` replies `:`, an instance of itself.
export function readRemote(service, { path = null, params = null } = {}) {
  const { $new, ...rest } = service?.public || {};
  if ($new?.[0]?.re?.[0] !== ':' || Object.keys(rest).length) return { doc: readDocument(service, path), ctorParams: params ? readParamsDocument(params) : null };
  const ctorParams = readDocument({ public: { $new } }, path).$new[0].params.map(p => ({ name: p.name, ...(p.name && { key: p.name }), typeEnc: p.typeEnc }));
  // An instance's own addresses are under the instance; its interface is the service's `instance`.
  return { doc: readDocument(service.instance || {}, path), ctorParams };
}

// ── Private function access check ──────────────────────────────────────────

function checkPrivateAccess(body, superPrivates, subclassName) {
  if (!body) return;
  for (const node of body) {
    walkForPrivateAccess(node, superPrivates, subclassName);
  }
}

function walkForPrivateAccess(node, superPrivates, subclassName) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier' && superPrivates.has(node.name)) {
    throw new Error(`Subclass '${subclassName}' cannot access private function '${node.name}' from superclass`);
  }
  if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && superPrivates.has(node.callee.name)) {
    throw new Error(`Subclass '${subclassName}' cannot access private function '${node.callee.name}' from superclass`);
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) walkForPrivateAccess(item, superPrivates, subclassName);
    } else if (val && typeof val === 'object' && val.type) {
      walkForPrivateAccess(val, superPrivates, subclassName);
    }
  }
}

// ── Ref param method collection ────────────────────────────────────────────

function collectRefCalls(body, refParamNames, requirements, callSites, fnParams) {
  for (const s of body) {
    collectRefCallsInNode(s, refParamNames, requirements, callSites, fnParams, body);
  }
}

function collectRefCallsInNode(node, refParamNames, requirements, callSites, fnParams, body) {
  if (!node || typeof node !== 'object') return;
  // DotCallExpr on a ref param: p.method()
  if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier' && refParamNames.has(node.object.name)) {
    const method = node.method.startsWith('@') ? node.method : '@' + node.method;
    requirements.get(node.object.name).add(method);
    callSites.push({ paramName: node.object.name, method, args: node.args || [], fnParams, body });
  }
  // Recurse into all object values
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) collectRefCallsInNode(item, refParamNames, requirements, callSites, fnParams, body);
    } else if (val && typeof val === 'object' && val.type) {
      collectRefCallsInNode(val, refParamNames, requirements, callSites, fnParams, body);
    }
  }
}

// ── Actor-level checks ─────────────────────────────────────────────────────

function validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames = new Set(), actorByName = new Map(), destructuredMembers = new Map(), actorMethodsFlat = new Map(), actorConstructorSigs = new Map(), actorMethodSigsFlat = new Map(), localFunctionSigs = new Map(), actorNameSet = new Set(), actorSettersFlat = new Map()) {
  checkNamespaceConflict(actor);
  checkSilentTopLevelUsage(actor, constructorNames);
  checkSilentFunctionUsage(actor, constructorNames);
  checkVoidFunctionUsage(actor, constructorNames);
  checkXmlConstructorCalls(actor, constructorNames, actorByName);
  checkAsClauses(actor);

  // ── Per-actor augmented dep sets ────────────────────────────────────────
  const { localDepNames, localRemotes, localFactoryDecls } = actorDeps(actor, dependencyNames, remotesParsed, factoryDecls);

  // Validate constructor calls in constructorBody (top-level init)
  const initTypeEnv = buildTypeEnv([], actor.constructorBody || []);
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      const depName = s.value.callee.name;
      // For destructured members, skip constructor validation — these are
      // function calls routed to the source service, not dep constructor calls
      if (destructuredMembers.has(depName)) continue;
      if (localFactoryDecls[depName]) {
        validateConstructorCall(s.value, localFactoryDecls, initTypeEnv);
      } else {
        throw new Error(
          `Cannot construct '${depName}' — its dependency declaration has no constructor signature. ` +
          `Use '*( "path": ${depName} # ) { ... }' with a manifest in options.remotes, ` +
          `or '*( "path": ${depName} *(param: Type) -> { ... } ) { ... }' inline.`,
        );
      }
    }
  }

  // State var types from constructorBody, for use in function validation
  const stateTypeEnv = actorStateTypes(actor, localDepNames);

  // Collect service coercion constraints: alias → { constraint, refName }
  const coercionConstraints = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion') {
      coercionConstraints.set(s.name, { constraint: s.constraint, refName: s.ref?.name || s.ref });
    }
  }

  // The file's `use` bindings (a source's name, a destructured member, a value) are
  // names of its scope: the file doesn't bind them again, and nor does anything
  // inside it. An inner scope's `use` is hidden (`__use_…`) and checked where it is.
  const useNames = actor.name ? new Set() : new Set([...dependencyNames, ...destructuredMembers.keys()]
    .filter(n => typeof n === 'string' && !n.startsWith('__')));
  for (const d of [...(actor.stateVarDecls || []), ...actor.functions]) {
    if (useNames.has(d.name)) throw new Error(`'${d.name}' is bound by 'use' in this file, so it can't be bound or assigned again here`);
  }
  const actorNames = new Set([
    ...(actor.stateVarDecls || []).map(d => d.name),
    ...(actor.initParams || []).map(p => p.name),
    ...actor.functions.map(f => f.name),
    ...useNames,
  ].filter(Boolean));
  checkNestedBlocks(actor.constructorBody || [], actorNames);

  // The constructor block gets the same body checks as a function body: its
  // calls, method names and args are checked against the same declarations.
  if (actor.constructorBody?.length) {
    const ctorTypeEnv = buildTypeEnv(actor.initParams || [], actor.constructorBody, null, localDepNames);
    for (const [k, v] of ctorTypeEnv) if (v === undefined) ctorTypeEnv.delete(k);
    for (const [k, v] of stateTypeEnv) if (!ctorTypeEnv.has(k)) ctorTypeEnv.set(k, v);
    validateBody(actor.constructorBody, actorInfo, localDepNames, localRemotes, localFactoryDecls, ctorTypeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
  }

  for (const fn of actor.functions) {
    checkFunctionBinds(fn, actorNames);
    const typeEnv = buildTypeEnv(fn.params, fn.body, null, localDepNames);
    // Merge state var types so actor-reference variables are visible
    for (const [k, v] of stateTypeEnv) {
      if (!typeEnv.has(k)) typeEnv.set(k, v);
    }
    validateBody(fn.body, actorInfo, localDepNames, localRemotes, localFactoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
  }
}

// The deps an actor's validation sees. Constructor coercions
// (`Coerced = Thing as <ctor> -> { iface }`) introduce synthetic local deps. They are
// construction-capable and have a service interface, so they join per-actor copies
// of dependencyNames / remotesParsed / factoryDecls.
function actorDeps(actor, dependencyNames, remotesParsed, factoryDecls) {
  const localDepNames = new Set(dependencyNames);
  const localRemotes = { ...remotesParsed };
  const localFactoryDecls = { ...factoryDecls };
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && s.constructorParams) {
      localDepNames.add(s.name);
      localFactoryDecls[s.name] = s.constructorParams;
      // parseServiceConstraint produces { method: { params, returns } }, but
      // remotesParsed is { method: [{ params, returns }, ...] } (array of
      // overloads). Wrap each entry in an array.
      const wrapped = {};
      for (const [m, sig] of Object.entries(s.constraint)) wrapped[m] = [sig];
      localRemotes[s.name] = wrapped;
    }
  }
  return { localDepNames, localRemotes, localFactoryDecls };
}

function actorStateTypes(actor, localDepNames) {
  const stateTypeEnv = new Map();
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && s.typeNameEnc !== undefined) {
      stateTypeEnv.set(s.name, s.typeNameEnc);
    }
    // Infer actor type from class calls against declared dependencies
    // (or against class coercions, which are in localDepNames):
    //   t = Thing(args)    →  t : Thing
    //   t = Coerced(args)  →  t : Coerced
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && s.typeNameEnc === undefined &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      stateTypeEnv.set(s.name, classEnc(s.value.callee.name));
    }
  }
  for (const d of (actor.stateVarDecls || [])) {
    if (d.typeNameEnc !== undefined) stateTypeEnv.set(d.name, d.typeNameEnc);
  }
  return stateTypeEnv;
}

// Gives each unannotated bind of a call the callee's return type, when it has one:
// `x = f()` in a function body, `e = f()` in a constructor block. Before the checks,
// so they and every backend see `x T = f()`. A bind's type can make another callee's
// return known, so this goes until nothing changes.
function inferCallBinds(ast, args) {
  const { actorInfo, dependencyNames, remotesParsed, factoryDecls, rest } = args;
  const scopes = ast.actors.map(actor => ({ actor, ...actorDeps(actor, dependencyNames, remotesParsed, factoryDecls) }));
  // Each round binds at least one more name, so it ends.
  for (let inferred = 1; inferred > 0;) {
    inferred = 0;
    for (const { actor, localDepNames, localRemotes, localFactoryDecls } of scopes) {
      const infer = (body, typeEnv) => validateBody(body, actorInfo, localDepNames, localRemotes, localFactoryDecls, typeEnv, ...rest, true);
      // A constructor block's unannotated `e = f()` is a decl the parser left as Anything.
      const decls = new Map((actor.stateVarDecls || []).map(d => [d.name, d]));
      const binds = (actor.constructorBody || [])
        .filter(s => s.type === 'TypedAssign' && s.typeNameEnc === undefined && !s.rhsType && decls.get(s.name)?.typeNameEnc === 'Anything'
          && (s.value?.type === 'FunctionCallExpr' || s.value?.type === 'DotCallExpr'))
        .map(stmt => ({ type: 'Assign', name: stmt.name, value: stmt.value, stmt }));
      if (binds.length) {
        inferred += infer(binds, actorStateTypes(actor, localDepNames));
        for (const b of binds) {
          if (b.type !== 'TypedAssign') continue;
          b.stmt.typeNameEnc = decls.get(b.name).typeNameEnc = b.typeNameEnc;
        }
      }
      const stateTypeEnv = actorStateTypes(actor, localDepNames);
      for (const fn of actor.functions || []) {
        if (!fn.body) continue;
        const typeEnv = buildTypeEnv(fn.params || [], fn.body, null, localDepNames);
        for (const [k, v] of stateTypeEnv) if (!typeEnv.has(k)) typeEnv.set(k, v);
        inferred += infer(fn.body, typeEnv);
      }
    }
  }
}

function checkAsClauses(actor) {
  const clauses = actor.asClauses || [];
  if (clauses.length === 0) return;
  const seen = new Set();
  for (const c of clauses) {
    if (c.negated) continue;
    if (seen.has(c.targetTypeEnc)) {
      throw new Error(`Duplicate 'as ${nodeShown(c, 'targetType')}' clause in actor '${actor.name}'`);
    }
    seen.add(c.targetTypeEnc);
  }
}

function checkAsClauseMatch(targetType, actorName, actorInfo) {
  const info = actorInfo.get(actorName);
  if (!info) return; // no as clauses — normal actor construction
  if (targetType === classEnc(actorName)) return; // identity — no cast needed
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetTypeEnc === targetType) return; // positive match
    if (clause.negated && clause.targetTypeEnc !== targetType) return; // negated catch-all
  }
  throw new Error(`No matching 'self-as' clause in actor '${actorName}' for type '${shown(targetType)}'`);
}

function checkNamespaceConflict(actor) {
  const publicNames = new Set();
  const privateNames = new Set();
  for (const fn of actor.functions) {
    if (!fn.name) continue;
    if (fn.name.startsWith('@')) {
      publicNames.add(fn.name);
    } else {
      privateNames.add(fn.name);
    }
  }
  for (const name of publicNames) {
    if (privateNames.has(name)) {
      throw new Error(`Duplicate function name '${name}'`);
    }
  }
}

function checkXmlConstructorCalls(actor, constructorNames, actorByName) {
  // Walk all function bodies looking for xmlConstructor calls
  function walkExpr(expr) {
    if (!expr) return;
    if (expr.type === 'FunctionCallExpr' && expr.xmlConstructor) {
      const name = expr.callee?.name;
      if (!name) return;
      if (!constructorNames.has(name)) {
        throw new Error(`XML tag <${name} /> can only be used with constructors, not functions`);
      }
      // Check that the constructor doesn't have positional params
      const targetActor = actorByName.get(name);
      if (targetActor) {
        const posParams = (targetActor.initParams || []).filter(p => p.positional);
        if (posParams.length > 0) {
          throw new Error(`XML tag <${name} /> cannot be used with constructors that have positional params — use named params (name: Type) instead`);
        }
      }
    }
    // Recurse into sub-expressions
    if (expr.args) for (const a of expr.args) walkExpr(a.expr || a);
    if (expr.fields) for (const k of Object.keys(expr.fields)) walkExpr(expr.fields[k]);
    if (expr.left) walkExpr(expr.left);
    if (expr.right) walkExpr(expr.right);
    if (expr.object) walkExpr(expr.object);
    if (expr.callee) walkExpr(expr.callee);
    if (expr.collection) walkExpr(expr.collection);
    if (expr.fn) walkExpr(expr.fn);
    if (expr.cond) walkExpr(expr.cond);
    if (expr.then) walkExpr(expr.then?.expr);
    if (expr.else) walkExpr(expr.else?.expr);
  }
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if (s.value) walkExpr(s.value);
      if (s.expr) walkExpr(s.expr);
    }
  }
}

function checkSilentTopLevelUsage(actor, constructorNames = new Set()) {
  const silentFns = new Set();
  // Collect names that have overload clauses — empty Function() initializers aren't silent
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    // Skip constructor overload clauses and constructor names
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (fn.name.endsWith('.') || (hasSilent && !hasReply && !hasImplicit)) silentFns.add(fn.name);
  }
  // A public function is silent by its name: `@write.`.
  for (const fn of actor.functions) if (fn.name?.startsWith('@') && fn.name.endsWith('.')) silentFns.add(fn.name);
  // `call...` launches without waiting, so its callee must be silent. A
  // value-returning `fn` reached by `fn...` names it. A launch of one of this
  // actor's own functions becomes a LaunchStatement.
  const fnNames = new Set(actor.functions.map(f => f.name).filter(Boolean));
  const checkEllipsis = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const s = node[i];
        if (s?.ellipsis && (s.type === 'ExprStatement' || s.type === 'ImplicitReturn') &&
            s.expr?.type === 'FunctionCallExpr' && s.expr.callee?.type === 'Identifier') {
          const name = s.expr.callee.name;
          const plain = name.endsWith('.') ? name.slice(0, -1) : name;
          if (fnNames.has(name) || fnNames.has(plain)) {
            node[i] = launchStatement(s.expr);
          }
        }
      }
      node.forEach(checkEllipsis);
      return;
    }
    if (node.type === 'LaunchStatement') {
      const name = node.call.callee?.name;
      const plain = name?.endsWith('.') ? name.slice(0, -1) : name;
      if (name && !fnNames.has(name) && fnNames.has(plain)) {
        throw new Error(`'${plain}' returns a value; '...' needs a silent '${plain}.'`);
      }
      if (name && fnNames.has(name) && !silentFns.has(name) && !constructorNames.has(name)) {
        throw new Error(`'${name}' returns a value; '...' needs a silent function`);
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') checkEllipsis(v);
  };
  for (const fn of actor.functions) {
    checkEllipsis(fn.body);
  }
  if (silentFns.size === 0) return;

  const requiresFaf = (name) => new Error(`'${name}' is silent — call it '${name.replace(/\.$/, '')}(…)...' (fire-and-forget)`);
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentFns.has(s.value.callee.name)) {
        throw requiresFaf(s.value.callee.name);
      }
      if (s.type === 'ExprStatement' && s.expr?.type === 'FunctionCallExpr' && s.expr.callee?.name && silentFns.has(s.expr.callee.name)) {
        throw requiresFaf(s.expr.callee.name);
      }
    }
  }
}

// Walk an expression tree looking for calls to silent functions
function findSilentCallInExpr(expr, silentNames) {
  if (!expr) return null;
  if (expr.type === 'FunctionCallExpr' && expr.callee?.name && silentNames.has(expr.callee.name)) {
    return expr.callee.name;
  }
  // Recurse into sub-expressions
  if (expr.type === 'BinaryExpr') {
    return findSilentCallInExpr(expr.left, silentNames) || findSilentCallInExpr(expr.right, silentNames);
  }
  if (expr.type === 'FunctionCallExpr') {
    for (const a of (expr.args || [])) {
      const found = findSilentCallInExpr(a, silentNames) || findSilentCallInExpr(a.expr, silentNames);
      if (found) return found;
    }
  }
  if (expr.type === 'IfExpr') {
    return findSilentCallInExpr(expr.cond, silentNames)
      || findSilentCallInExpr(expr.then?.expr, silentNames)
      || findSilentCallInExpr(expr.else?.expr, silentNames);
  }
  return null;
}

// Walk an expression tree looking for calls to void-returning functions.
// Mirrors findSilentCallInExpr — same recursion shape, different name set.
function findVoidCallInExpr(expr, voidNames) {
  return findSilentCallInExpr(expr, voidNames);
}

function checkVoidFunctionUsage(actor, constructorNames = new Set()) {
  // Collect void-returning private functions (lineal): body is empty, OR
  // body has a single Reply with no fields (the explicit `() ` / `-> ()` form).
  const voidNames = new Set();
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode || fn.actorDef) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (hasSilent) continue;
    const replyNodes = fn.body.filter(s => s.type === 'Reply');
    const isVoidReply = replyNodes.length === 1 && replyNodes[0].fields.length === 0
      && fn.body.every(s => s.type === 'Reply' || s.type === 'BareTypeDecl');
    const isEmpty = fn.body.length === 0;
    if (isVoidReply || isEmpty) voidNames.add(fn.name);
  }

  // Collect void-returning lambdas (`x = () { }`, `x = () -> ()`, etc.)
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'Function' && s.value.returnType === '()') {
        voidNames.add(s.name);
      }
    }
  }
  if (voidNames.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      // Direct assignment: x = void()
      if ((s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'DestructureAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && voidNames.has(s.value.callee.name)) {
        throw new Error(`Cannot bind result of '${s.value.callee.name}' — '()' is not a value`);
      }

      // Used in expression: x = 1 + void()
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value) {
        if (s.value.type !== 'FunctionCallExpr') {
          const found = findVoidCallInExpr(s.value, voidNames);
          if (found) throw new Error(`Cannot use result of '${found}' in an expression — '()' is not a value`);
        }
      }

      // Used as argument: double(void())
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && !voidNames.has(s.value.callee?.name)) {
        for (const a of (s.value.args || [])) {
          const arg = a.expr || a;
          const found = findVoidCallInExpr(arg, voidNames);
          if (found) throw new Error(`Cannot use result of '${found}' as an argument — '()' is not a value`);
        }
      }

      // Used as return value: -> void()
      if (s.type === 'Reply') {
        for (const f of s.fields) {
          const found = findVoidCallInExpr(f.expr || f.value, voidNames);
          if (found) throw new Error(`Cannot use result of '${found}' as a return value — '()' is not a value`);
        }
      }
    }
  }
}

function checkSilentFunctionUsage(actor, constructorNames = new Set()) {
  // Collect silent private functions (lineal)
  const silentNames = new Set();
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode || fn.actorDef) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    // Skip empty Function() initializers that have overload clauses
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (fn.name.endsWith('.') || (hasSilent && !hasReply && !hasImplicit)) silentNames.add(fn.name);
  }

  // Collect silent lambdas
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'Function' && s.value.returnType === '.') {
        silentNames.add(s.name);
      }
    }
  }
  if (silentNames.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      // Direct assignment: x = silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'DestructureAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentNames.has(s.value.callee.name)) {
        throw new Error(`Cannot assign result of silent function '${s.value.callee.name}' — it has no return value`);
      }

      // Used in expression: x = 1 + silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value) {
        // Skip direct call (caught above), check sub-expressions
        if (s.value.type !== 'FunctionCallExpr') {
          const found = findSilentCallInExpr(s.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used in an expression — it has no return value`);
        }
      }

      // Used as argument: double(silent())
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && !silentNames.has(s.value.callee?.name)) {
        for (const a of (s.value.args || [])) {
          const arg = a.expr || a;
          const found = findSilentCallInExpr(arg, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as an argument — it has no return value`);
        }
      }

      // Used as return value: -> silent()
      if (s.type === 'Reply') {
        for (const f of s.fields) {
          const found = findSilentCallInExpr(f.expr || f.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as a return value — it has no return value`);
        }
      }
    }
  }
}

// ── Scope name collection (mirrors buildTypeEnv in codegen.js) ──────────

// A scope's names by their encoded types. `depNames`: a local constructed from one
// of these, `t = Thing()`, is a Thing, as it is for the file's own cells.
function buildTypeEnv(params, body, _typeDecls = null, depNames = null) {
  return buildTypeEnvEnc(params, body, { decls: typesByAddress(run.ast), depNames, typeOfName: classEnc });
}

// The same scope's names by their encoded types (src/type_enc.js). `decls`, by a
// type's address; `typeOfName` encodes a dependency's name, for a local it
// constructs.
function buildTypeEnvEnc(params, body, { decls = null, depNames = null, typeOfName = null } = {}) {
  const env = new Map();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.typeEnc !== undefined) env.set(p.name, p.typeEnc);
  }
  for (const s of body) {
    if ((s.type === 'TypedAssign' || s.type === 'BareTypeDecl' || s.type === 'RefDecl') && s.typeNameEnc !== undefined) {
      env.set(s.name, s.typeNameEnc);
    } else if (s.type === 'Assign') {
      const lit = inferLiteralTypeEnc(s.value);
      const t = lit !== undefined ? lit
        : (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier'
          && depNames?.has(s.value.callee.name) && typeOfName ? typeOfName(s.value.callee.name) : undefined);
      if (t !== undefined) env.set(s.name, t);
    } else if (s.type === 'DestructureAssign' && decls) {
      const src = s.source;
      const srcType = src?.type === 'TypeConstruction' ? src.typeNameEnc
        : src?.type === 'Identifier' ? env.get(src.name) : undefined;
      const srcDecl = srcType !== undefined ? decls.get(srcType) : null;
      if (srcDecl) {
        const fields = srcDecl.fields || [];
        for (const item of s.pattern) {
          if (item.discard || !item.name || env.has(item.name)) continue;
          if (item.typeEnc !== undefined) { env.set(item.name, item.typeEnc); continue; }
          let field;
          if (item.named) field = fields.find(f => f.name === item.name);
          else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
          else if (item.positional) field = fields[item.idx];
          if (field?.paramTypeEnc !== undefined && !field.optional) env.set(item.name, field.paramTypeEnc);
        }
      }
    }
  }
  return env;
}

// `into`'s encoded twin takes what `from`'s has that it doesn't.
function inferLiteralTypeEnc(expr) {
  switch (expr?.type) {
    case 'IntLiteral': return 'Integer';
    case 'StringLiteral': case 'InterpolatedString': return 'Text';
    case 'DecimalLiteral': return 'Decimal';
    case 'FloatLiteral': return 'Float';
    case 'BoolLiteral': return 'Boolean';
    case 'NullLiteral': return null;
    case 'TypeConstruction': return expr.typeNameEnc;
    default: return undefined;
  }
}

// Best-effort type of an expression given the current scope's type env and
// locally-tracked actor-constructor bindings, encoded: `env` by encoded types,
// `localActorTypes` by class name. Unknown when ambiguous — callers skip rather
// than false-positive.
function inferExpressionTypeEnc(expr, env, localActorTypes, actorNameSet) {
  if (!expr) return undefined;
  const lit = inferLiteralTypeEnc(expr);
  if (lit !== undefined) return lit;
  if (expr.type === 'Identifier') {
    if (localActorTypes?.has(expr.name)) return classEnc(localActorTypes.get(expr.name));
    return env?.get(expr.name);
  }
  if (expr.type === 'RefRead') return env?.get(expr.name);
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && actorNameSet?.has(expr.callee.name)) return classEnc(expr.callee.name);
  if (expr.type === 'TypedValue') return expr.typeNameEnc;
  if (expr.type === 'AsClause') return expr.targetTypeEnc;
  return undefined;
}

function inferArgType(expr, typeEnv) {
  if (!expr) return undefined;
  const lit = inferLiteralTypeEnc(expr);
  if (lit !== undefined) return lit;
  // Resolve identifiers from the type environment
  if (expr.type === 'Identifier') return typeEnv?.get(expr.name);
  return undefined;
}

// The dependency an encoded type names (an actor of it), by its name here; null if none.
function depOfEnc(t, dependencyNames) {
  if (t === undefined || t === null) return null;
  for (const n of dependencyNames || []) if (classEnc(n) === t) return n;
  return null;
}

// ── Body-level checks ───────────────────────────────────────────────────────

function validateBody(body, actorInfo, dependencyNames, remotesParsed, factoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat = new Map(), actorConstructorSigs = new Map(), actorByName = new Map(), actorMethodSigsFlat = new Map(), localFunctionSigs = new Map(), actorNameSet = new Set(), actorSettersFlat = new Map(), inferOnly = false) {
  if (!inferOnly) checkTypeConsistency(body);

  // Build a local map of variable → actor class from assignments like: a = A().
  // Both locally-defined actors (in `actorMethods`) and manifest-declared classes
  // (in `actorNameSet`) participate; the latter covers destructured remote tags
  // like `(:div) = HTML` so `d = div()` typechecks `d` as `div`.
  const localActorTypes = new Map();
  const soleRemoteClass = (call) => soleRemoteClassOf(call, remotesParsed, typeEnv, dependencyNames);
  for (const s of body) {
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        (actorMethods?.has(s.value.callee.name) || actorNameSet?.has(s.value.callee.name))) {
      localActorTypes.set(s.name, s.value.callee.name);
    }
    // A constructor block's unannotated bind is a TypedAssign with no typeName.
    const unannotated = s.type === 'Assign' || (s.type === 'TypedAssign' && s.typeNameEnc === undefined && !s.rhsType);
    if (!unannotated || (typeEnv.get(s.name) !== undefined && typeEnv.get(s.name) !== 'Anything')) continue;
    // An unannotated bind whose class is certain types its name, so calls on it
    // are checked like calls on an annotated one: `el = <div>…</div>` is a
    // `div`, and `b = document.body()` is whatever class every clause returns.
    const cls = s.value?.type === 'DomConstructor' ? s.value.tag : soleRemoteClass(s.value);
    if (cls && actorNameSet?.has(cls)) {
      localActorTypes.set(s.name, cls);
      typeEnv.set(s.name, classEnc(cls));
    }
  }

  // Method-existence check: every `obj.method()` must name a method defined on
  // obj's declared actor class (own or inherited). Skips when the type is a
  // dependency (remote calls validated elsewhere) or cannot be determined.
  // A TypedAssign's declared type takes precedence — `x T = U(...)` resolves
  // to T, so calling a U-only method on x is rejected (Liskov).
  const resolveObjType = (objName) => {
    const typed = typeEnv.get(objName);
    if (typed !== undefined) return classOfEnc(typed, actorByName) ?? (typeof typed === 'string' && !typed.includes(':') ? typed : null);
    return localActorTypes.get(objName) || null;
  };
  const checkMethodCall = (call) => {
    const obj = call.object;
    if (obj?.type !== 'Identifier' && obj?.type !== 'RefRead') return;
    const objName = obj.name;
    if (dependencyNames?.has(objName)) return;
    const typeName = resolveObjType(objName);
    if (!typeName) return;
    // Manifest tag locals (`b = br()` after `(:br) = HTML`) appear in
    // `dependencyNames` because their constructor was destructured from
    // the dependency. We still want to validate methods against the
    // manifest's declared surface — the membership in `actorMethodsFlat`
    // is what determines whether we have method info to check against.
    if (!actorMethodsFlat.has(typeName)) return;
    const methodName = call.method.startsWith('@') ? call.method : '@' + call.method;
    const methods = actorMethodsFlat.get(typeName);
    if (methods.has(methodName)) return;
    const available = [...methods].map(m => m.replace(/^@/, '')).sort();
    throw new Error(
      `'${typeName}' has no method '${call.method}' (available: ${available.length ? available.join(', ') : '(none)'})`,
    );
  };
  // Field-set discipline (`obj.field <- value`): when obj's type names a
  // manifest class with declared setters, reject any field name not in the
  // declared set. Local actors aren't gated here — `actorSettersFlat` is
  // populated only for manifest types.
  const checkFieldSet = (s) => {
    const objName = s.objectName;
    if (dependencyNames?.has(objName)) {
      // Tag locals (`b = br()` after destructuring HTML) appear in
      // dependencyNames but still resolve to a manifest class; the type
      // lookup below handles them. A service's own read-only field
      // (`name Type` in its document) is not settable.
      const field = remotesParsed?.[objName]?.__fields?.[s.fieldName];
      if (field && !field.cell) {
        throw new Error(`'${objName}.${s.fieldName}' is a prop, not an address, so it can't be set (a settable member is a cell: '${s.fieldName} *${shown(field.typeEnc)}')`);
      }
      if (field?.readOnly) {
        throw new Error(`'${objName}.${s.fieldName}' is a read-only cell ('${s.fieldName} &${shown(field.typeEnc)}')`);
      }
    }
    const typeName = resolveObjType(objName);
    if (!typeName) return;
    if (!actorSettersFlat.has(typeName)) return;
    const setters = actorSettersFlat.get(typeName);
    if (setters.has(s.fieldName)) return;
    const available = [...setters.keys()].sort();
    throw new Error(
      `'${typeName}' has no settable field '${s.fieldName}' (available: ${available.length ? available.join(', ') : '(none)'})`,
    );
  };
  // `.subscribe` needs an address: a cell or a function. A prop is an attribute
  // of its actor, and a write-only cell (`set name (Type)`) answers only `$set`.
  const checkSubscribeTarget = (sub) => {
    const m = remoteMember(sub.target, remotesParsed || {});
    if (!m || !dependencyNames?.has(m.root) || !m.field) return;
    if (!m.field.cell) {
      throw new Error(`'${m.label}' is a prop, not an address, so it can't be subscribed to (a live read-only member is a cell: '${m.name} &${shown(m.field.typeEnc)}')`);
    }
    if (m.field.writeOnly) throw new Error(`'${m.label}' is a write-only cell, so it can't be subscribed to`);
  };
  const walkForMethodChecks = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Function') return; // function literal: validated by recursive validateBody
    if (node.type === 'DotCallExpr') checkMethodCall(node);
    if (node.type === 'ActorFieldSet') checkFieldSet(node);
    if (node.type === 'SubscribeCall') checkSubscribeTarget(node);
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walkForMethodChecks(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkForMethodChecks(val);
      }
    }
  };
  if (!inferOnly) for (const s of body) walkForMethodChecks(s);

  // Constructor call validation: at every `T(...)` where T names a local actor
  // constructor, verify the call matches at least one clause's arity and required
  // param set (positional count in range, all required named args present, no
  // unexpected named keys). Extracted args share shape with validateConstructorCall
  // above. Type compatibility is handled in task 4.
  const extractCallArgs = (expr) => {
    const named = new Map();
    const positional = [];
    for (const a of (expr.args || [])) {
      if (a.type === 'NamedArgsBag') {
        for (const [k, v] of Object.entries(a.fields)) named.set(k, v);
      } else if (a.positional === false && a.name) {
        named.set(a.name, a.expr);
      } else {
        positional.push(a);
      }
    }
    return { named, positional };
  };
  const clauseArity = (clause) => {
    const sigPos = clause.params.filter(p => p.positional && !p.rest);
    const sigPosRest = clause.params.some(p => p.positional && p.rest);
    const sigNamed = clause.params.filter(p => !p.positional && !p.rest);
    const sigNamedRest = clause.params.some(p => !p.positional && p.rest);
    return { sigPos, sigPosRest, sigNamed, sigNamedRest };
  };
  const isOptional = (p) => p.defaultValue || p.optional;
  const clauseAccepts = (clause, call) => {
    const { sigPos, sigPosRest, sigNamed, sigNamedRest } = clauseArity(clause);
    const requiredPosCount = sigPos.filter(p => !isOptional(p)).length;
    const requiredNamed = new Set(sigNamed.filter(p => !isOptional(p)).map(p => p.key || p.name));
    const allowedNamed = new Set(sigNamed.map(p => p.key || p.name));
    if (call.positional.length < requiredPosCount) return false;
    if (!sigPosRest && call.positional.length > sigPos.length) return false;
    for (const req of requiredNamed) if (!call.named.has(req)) return false;
    if (!sigNamedRest) {
      for (const k of call.named.keys()) if (!allowedNamed.has(k)) return false;
    }
    return true;
  };
  // Types here are encoded. `class` in a param's type is the class it's declared
  // in, as the parser encoded it. A class of another file constructed through its
  // service (`Svc.Counter(…)`) fits a param typed with its name there (`Counter`).
  const argTypeOf = (expr) => inferExpressionTypeEnc(expr, typeEnv, localActorTypes, actorNameSet);
  const remoteName = (t) => (typeof t === 'string' && t.includes(':') ? splitAddress(t).filter(x => x !== '*').at(-1) : null);
  const acceptsArg = (argType, expected) => assignableEnc(argType, expected, actorByName)
    || (remoteName(argType) !== null && remoteName(argType) === expected);
  // Check arg-to-param type compatibility for a call that already matched
  // `clause`. Throws with a locating message on first mismatch.
  const checkClauseTypes = (clause, call, label) => {
    const { sigPos, sigNamed } = clauseArity(clause);
    for (let i = 0; i < call.positional.length && i < sigPos.length; i++) {
      const sp = sigPos[i];
      if (sp.typeEnc === undefined) continue;
      const argExpr = call.positional[i]?.expr || call.positional[i];
      const argType = argTypeOf(argExpr);
      if (argType === undefined) continue;
      if (!acceptsArg(argType, sp.typeEnc)) {
        throw new Error(`${label} positional arg ${i + 1}: '${shown(argType)}' is not assignable to '${shown(sp.typeEnc)}'`);
      }
    }
    for (const sp of sigNamed) {
      const key = sp.key || sp.name;
      const argExpr = call.named.get(key);
      if (!argExpr || sp.typeEnc === undefined) continue;
      const argType = argTypeOf(argExpr);
      if (argType === undefined) continue;
      if (!acceptsArg(argType, sp.typeEnc)) {
        throw new Error(`${label} named arg '${key}': '${shown(argType)}' is not assignable to '${shown(sp.typeEnc)}'`);
      }
    }
  };
  // A typed local, a typed cell and every write to a cell take an instance as a
  // param does: its class or a subclass. A name's value is judged where it's
  // bound (a guard may have narrowed it), so only other values are judged here.
  // A cell's type: declared in this body, or the state cell's (`<-` writes only cells).
  const cellTypes = new Map();
  const cellType = (name) => (cellTypes.has(name) ? cellTypes.get(name) : typeEnv?.get(name));
  const checkInstanceFits = (name, declared, value, verb, sigil) => {
    if (declared === undefined || !value || value.type === 'Identifier' || value.type === 'RefRead') return;
    const valueType = argTypeOf(value);
    if (!classOfEnc(valueType, actorByName)) return;
    if (!canJudgeEnc(declared, actorByName) || !canJudgeEnc(valueType, actorByName)) return;
    if (acceptsArg(valueType, declared)) return;
    throw new Error(`Cannot ${verb} '${name} ${sigil}${shown(declared)}' to a value that is ${shown(valueType)}: '${shown(valueType)}' is not assignable to '${shown(declared)}'`);
  };
  const walkForInstanceFits = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Function') return; // function literal: validated by recursive validateBody
    if (node.type === 'TypedAssign') checkInstanceFits(node.name, node.typeNameEnc, node.value, 'bind', '');
    if (node.type === 'RefDecl' && node.typeNameEnc !== undefined) {
      cellTypes.set(node.name, node.typeNameEnc);
      checkInstanceFits(node.name, node.typeNameEnc, node.value, 'bind', '*');
    }
    if (node.type === 'SetStatement' || (node.type === 'StateAssign' && node.isRef)) {
      checkInstanceFits(node.name, cellType(node.name), node.value, node.type === 'SetStatement' ? 'set' : 'bind', '*');
    }
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walkForInstanceFits(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkForInstanceFits(val);
      }
    }
  };
  if (!inferOnly) for (const s of body) walkForInstanceFits(s);
  const formatSig = (params) => {
    const parts = params.map(p => {
      const opt = isOptional(p) ? '? ' : '';
      const nm = p.positional ? '' : `:${p.key || p.name} `;
      const ty = nodeShown(p);
      const rest = p.rest ? '*' : '';
      return `${opt}${nm}${ty}${rest}`;
    });
    return `<${parts.join(', ')}>`;
  };
  const checkConstructorCall = (callExpr) => {
    if (callExpr.callee?.type !== 'Identifier') return;
    const name = callExpr.callee.name;
    const clauses = actorConstructorSigs.get(name);
    if (!clauses || clauses.length === 0) return;
    const call = extractCallArgs(callExpr);
    const accepting = clauses.filter(cl => clauseAccepts(cl, call));
    if (accepting.length === 0) {
      const sigStrs = clauses.map(cl => formatSig(cl.params)).join(' | ');
      const argDesc = [];
      if (call.positional.length) argDesc.push(`${call.positional.length} positional`);
      if (call.named.size) argDesc.push(`named: ${[...call.named.keys()].join(', ')}`);
      throw new Error(
        `'${name}()' call doesn't match any constructor clause: ${sigStrs}. ` +
        `Got ${argDesc.join(', ') || 'no args'}.`,
      );
    }
    // Only narrow types when exactly one clause fits — otherwise we'd have to
    // pick and risk false positives on the non-chosen clauses.
    if (accepting.length === 1) checkClauseTypes(accepting[0], call, `'${name}()' constructor`);
  };
  const checkLocalFunctionCall = (callExpr) => {
    if (callExpr.callee?.type !== 'Identifier') return;
    const name = callExpr.callee.name;
    if (actorConstructorSigs.has(name)) return; // handled by constructor check
    if (dependencyNames?.has(name)) return; // dep factory handled elsewhere
    const clauses = localFunctionSigs.get(name);
    if (!clauses || clauses.length === 0) return;
    const call = extractCallArgs(callExpr);
    const accepting = clauses.filter(cl => clauseAccepts(cl, call));
    if (accepting.length === 0) {
      const sigStrs = clauses.map(cl => formatSig(cl.params)).join(' | ');
      const argDesc = [];
      if (call.positional.length) argDesc.push(`${call.positional.length} positional`);
      if (call.named.size) argDesc.push(`named: ${[...call.named.keys()].join(', ')}`);
      throw new Error(
        `'${name}()' call doesn't match any function signature: ${sigStrs}. ` +
        `Got ${argDesc.join(', ') || 'no args'}.`,
      );
    }
    if (accepting.length === 1) checkClauseTypes(accepting[0], call, `'${name}()'`);
  };
  const checkMethodCallArgs = (call) => {
    const obj = call.object;
    if (obj?.type !== 'Identifier' && obj?.type !== 'RefRead') return;
    const objName = obj.name;
    if (dependencyNames?.has(objName)) return;
    const typeName = resolveObjType(objName);
    if (!typeName || dependencyNames?.has(typeName)) return;
    const sigs = actorMethodSigsFlat.get(typeName);
    if (!sigs) return;
    const methodName = call.method.startsWith('@') ? call.method : '@' + call.method;
    const clauses = sigs.get(methodName);
    if (!clauses) return; // missing-method error raised elsewhere
    const callArgs = extractCallArgs(call);
    const accepting = clauses.filter(cl => clauseAccepts(cl, callArgs));
    if (accepting.length === 0) {
      throw new Error(
        `'${typeName}.${call.method}()' call doesn't match any signature: ${clauses.map(cl => formatSig(cl.params)).join(' | ')}. ` +
        `Got ${callArgs.positional.length} positional, named: ${[...callArgs.named.keys()].join(', ') || '(none)'}.`,
      );
    }
    // The call is well-typed when its args type-check against any clause that
    // accepts its shape; when none does, the first one reports the mismatch.
    const label = `'${typeName}.${call.method}()'`;
    const errors = [];
    for (const cl of accepting) {
      try { checkClauseTypes(cl, callArgs, label); return; } catch (e) { errors.push(e); }
    }
    throw errors[0];
  };
  // The names this body binds to a List.
  const listLocals = new Set((Array.isArray(body) ? body : []).filter(st => (st?.type === 'Assign' || st?.type === 'TypedAssign')
    && (st.value?.type === 'ListLiteral' || /^List\b/.test(typeof st.typeNameEnc === 'string' ? st.typeNameEnc : ''))).map(st => st.name));
  const walkForCallChecks = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Function') return;
    if (node.type === 'FunctionCallExpr') {
      checkConstructorCall(node);
      checkLocalFunctionCall(node);
      // A List isn't a function: only a clause list (or `Function()`) is called.
      if (node.callee?.type === 'Identifier') {
        const t = argTypeOf(node.callee);
        if (listLocals.has(node.callee.name) || (typeof t === 'string' && /^List\b/.test(t))) throw new Error(`'${node.callee.name}' is a List, which isn't called: a clause list is written 'head -> value' per entry`);
      }
      // A clause list with a pattern clause matches its input; under a Boolean every
      // Boolean head would be a condition, so the clauses wouldn't mean what they say.
      const matches = node.matchesInput || (node.callee?.type === 'Identifier' && localFunctionSigs.get(node.callee.name)?.some(s => s.fn.matchesInput));
      if (matches) {
        for (const a of node.args.filter(x => x.type !== 'NamedArgsBag')) {
          const t = argTypeOf(a);
          if (t === 'Boolean' || (typeof t === 'string' && t.split('|').some(m => m.trim() === 'Boolean'))) {
            throw new Error('A Boolean is matched with if/else, not a clause list');
          }
        }
      }
    }
    if (node.type === 'DotCallExpr') checkMethodCallArgs(node);
    // `and`, `or`, `not` take Booleans: an operand of another known type is an error.
    if (node.type === 'IfExpr' && node.boolOp) {
      const operands = node.boolOp === 'and' ? [node.cond, node.then.expr] : node.boolOp === 'or' ? [node.cond, node.else.expr] : [node.cond];
      for (const operand of operands) {
        const t = argTypeOf(operand);
        if (t !== undefined && t !== null && t !== 'Anything' && !acceptsArg(t, 'Boolean')) {
          throw new Error(`'${node.boolOp}' takes Booleans: this operand is '${shown(t)}'`);
        }
      }
    }
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walkForCallChecks(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkForCallChecks(val);
      }
    }
  };
  if (!inferOnly) for (const s of body) walkForCallChecks(s);

  // A call to something in this file: its label, the shape of its returns for
  // the named-field checks, and the definitions it can reach (`fns`).
  const shadowed = (name) => body.some(b => (b.type === 'Assign' || b.type === 'TypedAssign') && b.name === name);
  const resolveCall = (callSrc) => {
    if (callSrc.type === 'FunctionCallExpr' && callSrc.callee?.type === 'Identifier') {
      const name = callSrc.callee.name;
      if (dependencyNames?.has(name) || shadowed(name)) return null;
      const fns = functionsByName.get(name);
      const clauses = localFunctionSigs.get(name);
      if (clauses) return { label: name, shape: knownReturnShape(clauses.map(c => c.fn)), fns };
      if (fns?.length === 1) return { label: name, shape: null, fns };
      // Overloads without params of their own, `f = { … }` then `f << (a) { … }`.
      if (fns?.length) return { label: name, shape: null, fns };
    } else if (callSrc.type === 'DotCallExpr' && (callSrc.object?.type === 'Identifier' || callSrc.object?.type === 'RefRead')
        && !dependencyNames?.has(callSrc.object.name)) {
      const typeName = resolveObjType(callSrc.object.name);
      const method = callSrc.method.startsWith('@') ? callSrc.method : '@' + callSrc.method;
      // The class that declares the method: the receiver's class, else the
      // nearest ancestor (later supertypes win, as in resolveSuperclassChain).
      // Its own state/param types decide what its returns can carry.
      const declares = (c) => (c.functions || []).some(f => f.name === method && !f.emptyOverload);
      const definingClass = (c, seen = new Set()) => {
        if (!c || seen.has(c)) return null;
        seen.add(c);
        if (declares(c)) return c;
        const sups = c.supertypes || [];
        for (let i = sups.length - 1; i >= 0; i--) {
          const found = definingClass(actorByName.get(sups[i].supertype), seen);
          if (found) return found;
        }
        return null;
      };
      const cls = typeName ? definingClass(actorByName.get(typeName)) : null;
      const fns = (cls?.functions || []).filter(f => f.name === method && !f.emptyOverload);
      if (fns.length > 0) {
        const classTypes = new Map();
        for (const v of (cls.stateVarDecls || [])) if (v.typeNameEnc !== undefined) classTypes.set(v.name, v.typeNameEnc);
        for (const p of (cls.initParams || [])) if (p.typeEnc !== undefined) classTypes.set(p.key || p.name, p.typeEnc);
        return { label: `${callSrc.object.name}.${callSrc.method}`, shape: knownReturnShape(fns, classTypes), fns };
      }
      // An auto-accessor replies with its param's value, positionally.
      const hasAccessor = (c, seen = new Set()) => {
        if (!c || seen.has(c)) return false;
        seen.add(c);
        if ((c.initParams || []).some(p => p.accessor && '@' + p.accessor === method)) return true;
        return (c.supertypes || []).some(sup => hasAccessor(actorByName.get(sup.supertype), seen));
      };
      if (typeName && hasAccessor(actorByName.get(typeName))) {
        return { label: `${callSrc.object.name}.${callSrc.method}`, shape: { keys: new Set(), hasPositional: true } };
      }
    }
    return null;
  };

  // The clauses of an overload a call could select. Clauses match in order, so a
  // clause the args certainly fit ends the list; one they might fit joins it and
  // the search goes on; one they can't fit is passed over. Empty when none fits.
  const argFit = (argExpr, param) => {
    const expected = param?.typeEnc;
    if (expected === undefined || expected === 'Anything') return 'yes';
    const argType = argTypeOf(argExpr);
    if (argType === undefined) return 'maybe';
    if (param.rest) return 'maybe';
    if (acceptsArg(argType, expected)) return 'yes';
    if (!canJudgeEnc(argType, actorByName) || !canJudgeEnc(expected, actorByName)) return 'maybe';
    // A union arg, or a class that a subclass value could fill, might still fit.
    const could = encMembers(argType).some(m => assignableEnc(m, expected, actorByName) || assignableEnc(expected, m, actorByName));
    return could ? 'maybe' : 'no';
  };
  const clauseFit = (params, call) => {
    const { sigPos, sigNamed } = clauseArity({ params });
    const restPos = params.find(p => p.positional && p.rest);
    const fits = [
      ...call.positional.map((a, i) => argFit(a?.expr || a, sigPos[i] ?? restPos)),
      ...sigNamed.filter(p => call.named.has(p.key || p.name)).map(p => argFit(call.named.get(p.key || p.name), p)),
    ];
    return fits.includes('no') ? 'no' : fits.includes('maybe') ? 'maybe' : 'yes';
  };
  const selectClauses = (clauses, callExpr, paramsOf) => {
    if (clauses.length === 1) return clauses;
    const call = extractCallArgs(callExpr);
    const chosen = [];
    for (const clause of clauses) {
      const params = paramsOf(clause) || [];
      if (!clauseAccepts({ params }, call)) continue;
      const fit = clauseFit(params, call);
      if (fit === 'no') continue;
      chosen.push(clause);
      if (fit === 'yes') break;
    }
    return chosen;
  };

  // What a call gives back, across every clause it could select: `{ label, shapes }`,
  // or null when that can't be known.
  const callReturns = (callSrc, resolved = resolveCall(callSrc)) => {
    const fns = resolved?.fns;
    if (fns?.length) {
      if (new Set(fns.map(fn => functionOwners.get(fn))).size !== 1) return null;
      const chosen = selectClauses(fns, callSrc, fn => fn.params);
      if (chosen.length === 0) return null;
      return { label: resolved.label, shapes: mergeShapes(chosen.map(fn => returnShapes(fn, fnOuterTypes(fn)))) };
    }
    return remoteReturnShapes(callSrc, remotesParsed, typeEnv, dependencyNames,
      (sigs) => selectClauses(sigs, callSrc, sig => sig.params));
  };

  // The type of a value that isn't a call, for `x T = value`. `narrowable` marks
  // one that a name's declared type flows into: a guard earlier in the body may
  // have narrowed that name, so only a type no member of could fit is wrong.
  // `literal` marks one a literal flows into, which takes its annotation's form.
  const isCall = (e) => e?.type === 'FunctionCallExpr' || e?.type === 'DotCallExpr';
  const mentions = (test) => {
    const walk = (node) => !!node && typeof node === 'object'
      && (test(node) || Object.values(node).some(v => (Array.isArray(v) ? v.some(walk) : v?.type && walk(v))));
    return walk;
  };
  const mentionsName = mentions(n => n.type === 'Identifier' || n.type === 'RefRead');
  const mentionsCall = mentions(n => isCall(n) || n.type === 'Function');
  const mentionsLiteral = mentions(n => LITERAL_FORMS.has(inferLiteralTypeEnc(n)) && n.type !== 'TypeConstruction');
  const valueType = (expr) => {
    if (!expr) return null;
    if (isCall(expr)) {
      if (expr.attestedAsEnc !== undefined) return null;
      const shapes = callReturns(expr)?.shapes;
      if (!shapes || shapes.opaque || shapes.orSelf || shapes.alternatives.length === 0) return null;
      const slots = shapes.alternatives.map(alt => alt.find(slot => slot.name === null));
      if (slots.some(slot => !slot)) return null;
      const type = slots.map(slot => slot.typeEnc).reduce(mergeTypesEnc);
      return type === undefined ? null : { type, narrowable: false, literal: false };
    }
    if (expr.type === 'ParenExpr') return valueType(expr.expr);
    if (expr.type === 'Identifier' || expr.type === 'RefRead') {
      if (dependencyNames?.has(expr.name)) return null;
      const type = typeEnv.get(expr.name) ?? (localActorTypes.has(expr.name) ? classEnc(localActorTypes.get(expr.name)) : undefined);
      return type !== undefined ? { type, narrowable: true, literal: false } : null;
    }
    if (expr.type === 'BinaryExpr') {
      const l = valueType(expr.left);
      const r = valueType(expr.right);
      if (!l || !r) return null;
      const flags = { narrowable: l.narrowable || r.narrowable, literal: l.literal || r.literal };
      if (expr.op === '??') {
        const all = encMembers(l.type);
        const present = all.filter(m => m !== null);
        if (present.length === all.length) return l;
        return { type: present.length ? mergeTypesEnc(present.reduce(mergeTypesEnc), r.type) : r.type, ...flags };
      }
      const type = binaryResultTypeEnc(expr.op, l.type, r.type);
      return type !== undefined ? { type, ...flags } : null;
    }
    if (expr.type === 'UnaryExpr' && expr.op === '-') return valueType(expr.operand ?? expr.arg);
    if (mentionsCall(expr)) return null;
    const type = inferType(expr, typeEnv);
    return type !== undefined ? { type, narrowable: mentionsName(expr), literal: mentionsLiteral(expr) } : null;
  };

  // An unannotated bind of a call takes the callee's return type when the callee has
  // just one: every return is a single positional value, of one type that isn't a
  // union, an Object, a function or an actor. `x = f()` is then `x T = f()`.
  const singleReturnType = (call) => {
    if (call.attestedAsEnc !== undefined) return null;
    const shapes = callReturns(call)?.shapes;
    if (!shapes || shapes.opaque || shapes.orSelf || shapes.alternatives.length === 0) return null;
    if (shapes.alternatives.some(alt => alt.length !== 1 || alt[0].name !== null)) return null;
    const enc = shapes.alternatives.map(alt => alt[0].typeEnc).reduce(mergeTypesEnc);
    if (enc === undefined || enc === null || mentionsAnythingEnc(enc) || isUnion(enc) || enc === 'Object' || isFn(enc)) return null;
    // Nor an actor: a class here or in another file, or a dependency itself.
    if (isInstance(enc) || classOfEnc(enc, actorByName) || [...actorNameSet].some(n => classEnc(n) === enc)
      || [...dependencyNames].some(n => classEnc(n) === enc)) return null;
    return enc;
  };
  // An unannotated bind of a value whose type is known (arithmetic, a comparison,
  // interpolated text, a core function, an `if` whose branches agree) takes it.
  const COMPUTED = new Set(['BinaryExpr', 'InterpolatedString', 'TextMethodExpr', 'ListMethodExpr', 'BlobMethodExpr', 'GraphemeTextMethodExpr', 'SizeExpr', 'MathMethodExpr', 'IfExpr']);
  const boundType = (e) => {
    if (!e) return undefined;
    if (e.type === 'IfExpr') {
      if (!e.else) return undefined;
      const tail = (b) => b?.type === 'IfExpr' ? b : (b?.expr ?? b?.body?.findLast(st => st.type === 'ImplicitReturn')?.expr);
      const types = [tail(e.then), tail(e.else)].map(x => boundType(x) ?? inferType(x, typeEnv));
      return types[0] !== undefined && types.every(t => t === types[0]) ? types[0] : undefined;
    }
    if (e.type === 'BinaryExpr') return valueType(e)?.type ?? inferType(e, typeEnv);
    return inferType(e, typeEnv);
  };
  const computedType = (e) => {
    if (!COMPUTED.has(e?.type)) return null;
    const enc = boundType(e);
    if (enc === undefined || enc === null || mentionsAnythingEnc(enc) || isUnion(enc) || enc === 'Object' || isFn(enc)) return null;
    return enc;
  };
  if (inferOnly) {
    let inferred = 0;
    for (const s of body) {
      if (s.type !== 'Assign') continue;
      const type = isCall(s.value) ? singleReturnType(s.value) : computedType(s.value);
      if (!type) continue;
      s.type = 'TypedAssign';
      s.typeNameEnc = type;
      typeEnv.set(s.name, type);
      inferred++;
    }
    return inferred;
  }

  const isRemoteSend = (expr) =>
    expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && dependencyNames.has(expr.object.name);

  // Treat `t.method()` as a remote send when `t` is a local actor of a declared dep:
  //   t = Thing(args)  →  t : Thing  →  t.method() routes to a Thing actor
  // Returns the dep name (so callers can look up parsed remotes), or null.
  const instanceDepName = (expr) => {
    if (expr?.type !== 'DotCallExpr' || expr.object?.type !== 'Identifier') return null;
    const objName = expr.object.name;
    if (dependencyNames.has(objName)) return null; // already a direct dep
    return depOfEnc(typeEnv.get(objName), dependencyNames);
  };

  // Wraps an actor method call into a direct-dep-shaped expr so the
  // existing remote-call validators can use it without further changes.
  const asDepCall = (expr) => {
    if (isRemoteSend(expr)) return expr;
    const dep = instanceDepName(expr);
    if (!dep) return null;
    return { ...expr, object: { type: 'Identifier', name: dep } };
  };

  for (const s of body) {
    // ── Ref param validation at construction site ──────────────────
    // When b = B(a) and B has * ref params, check that a has the required methods
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        actorRefRequirements?.has(s.value.callee.name)) {
      const targetActor = s.value.callee.name;
      const { params, requirements, callSites } = actorRefRequirements.get(targetActor);
      // Resolve positional and named args to their corresponding ref params
      const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
      const namedFields = namedBag?.fields || {};
      let posIdx = 0;
      for (const p of params) {
        let argExpr = null;
        if (p.ref) {
          const lookupKey = p.key || p.name;
          if (namedFields[lookupKey]) {
            argExpr = namedFields[lookupKey];
          } else if (p.positional && posIdx < positionalArgs.length) {
            argExpr = positionalArgs[posIdx];
          }
        }
        if (p.positional) posIdx++;
        if (!argExpr || !requirements.has(p.name)) continue;
        // Resolve the arg to an actor class
        const argActorName = argExpr.type === 'Identifier' ? localActorTypes.get(argExpr.name) : null;
        if (!argActorName || !actorMethods.has(argActorName)) continue;
        const availableMethods = actorMethods.get(argActorName);
        const requiredMethods = requirements.get(p.name);
        const missing = [...requiredMethods].filter(m => !availableMethods.has(m));
        if (missing.length > 0) {
          throw new Error(
            `'${targetActor}' requires ${missing.map(m => `'${m}'`).join(', ')} on ref param '${p.name}', ` +
            `but '${argActorName}' does not have ${missing.length === 1 ? 'it' : 'them'}`,
          );
        }
        // ── Arg type checking on ref param call sites ────────────────
        const targetSigs = actorMethodSigs.get(argActorName);
        if (!targetSigs) continue;
        for (const site of callSites) {
          if (site.paramName !== p.name) continue;
          const methodSig = targetSigs.get(site.method);
          if (!methodSig) continue;
          // Build type env for the wrapper function scope to resolve variable types
          const siteTypeEnv = buildTypeEnv(site.fnParams || [], site.body || []);
          // Match call args to method params by name
          for (const callArg of site.args) {
            const argName = callArg.name;
            const argType = inferArgType(callArg.expr, siteTypeEnv);
            if (argType === undefined) continue; // can't infer — skip, no false positives
            const methodParam = methodSig.params.find(mp => mp.name === argName);
            if (!methodParam || methodParam.typeEnc === undefined) continue;
            if (argType !== methodParam.typeEnc) {
              throw new Error(
                `Type mismatch in '${targetActor}': ref param '${p.name}' calls '${site.method}' ` +
                `with '${argName}: ${shown(argType)}', but '${argActorName}.${site.method}' expects '${argName}: ${shown(methodParam.typeEnc)}'`,
              );
            }
          }
        }
        // ── Inline constraint validation ─────────────────────────────
        if (p.constraint) {
          for (const [methodName, spec] of Object.entries(p.constraint)) {
            // Check method exists
            if (!availableMethods.has(methodName)) {
              throw new Error(
                `'${targetActor}' constraint on '${p.name}' requires '${methodName}', ` +
                `but '${argActorName}' does not have it`,
              );
            }
            // Check param types
            const sig = targetSigs.get(methodName);
            if (sig && spec.params) {
              for (const cp of spec.params) {
                const ap = sig.params.find(sp => sp.name === cp.name);
                if (ap && cp.typeEnc !== undefined && ap.typeEnc !== undefined && cp.typeEnc !== ap.typeEnc) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' param '${cp.name}' is '${shown(ap.typeEnc)}', ` +
                    `but constraint on '${p.name}' expects '${shown(cp.typeEnc)}'`,
                  );
                }
              }
            }
            // Check return types
            if (sig && spec.returns && sig.returns && !sig.returnAlternatives) {
              for (const cr of spec.returns) {
                const ar = sig.returns.find(sr => sr.name === cr.name);
                if (ar && cr.typeEnc !== undefined && ar.typeEnc !== undefined && cr.typeEnc !== ar.typeEnc) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' returns '${cr.name}: ${shown(ar.typeEnc)}', ` +
                    `but constraint on '${p.name}' expects '${cr.name}: ${shown(cr.typeEnc)}'`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // Object arity check on plain Assign
    if (s.type === 'Assign' && s.value?.type === 'ObjectConstructor') {
      const positionals = s.value.args.filter(a => a.positional);
      if (positionals.length > 1) {
        throw new Error(`Cannot assign ${positionals.length}-arity Object to '${s.name}' — use ': Object' type annotation`);
      }
    }

    // Named-field check on DestructureAssign
    // Call-result shape checks: `:x = f()` needs a named `x`; `x T = f()`
    // needs a positional. Only where f's returns are statically known.
    const callSrc = s.type === 'DestructureAssign' ? s.source
      : (s.type === 'TypedAssign' && s.typeNameEnc !== 'Object' ? s.value : null);
    if (s.type === 'DestructureAssign') checkNamedFields(s.pattern, s.source);
    const callShape = callSrc ? resolveCall(callSrc) : null;
    if (callShape) {
      if (s.type === 'DestructureAssign') checkNamedReturns(s.pattern, callShape.label, callShape.shape);
      else checkPositionalReturn(s, callShape.label, callShape.shape);
    }
    if (callSrc && callSrc.attestedAsEnc === undefined) {
      const called = callReturns(callSrc, callShape);
      if (called && s.type === 'DestructureAssign') checkPositionalCount(s.pattern, called.label, called.shapes);
      if (called) checkAnnotationCovers(s, called.label, called.shapes, actorByName);
      else if (s.type === 'TypedAssign' && !isCall(callSrc)) checkAnnotationValue(s, valueType(callSrc), actorByName);
    }

    // A dependency's construction anywhere in the statement: its value, a reply, an arg.
    const constructs = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(constructs); return; }
      if (n.type === 'Function') return;
      if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier'
          && dependencyNames.has(n.callee.name) && factoryDecls[n.callee.name]) {
        validateConstructorCall(n, factoryDecls, typeEnv);
      }
      for (const k in n) constructs(n[k]);
    };
    constructs(s);

    // as-clause type check on TypedAssign + FunctionCallExpr (actor construction)
    if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && actorInfo) {
      checkAsClauseMatch(s.typeNameEnc, s.value.callee.name, actorInfo);
    }
    // as-type check for dependency typed assign: n Integer = Dep or n Integer = Dep()
    if (s.type === 'TypedAssign' && s.typeNameEnc !== undefined) {
      const depName = s.value?.type === 'Identifier' ? s.value.name
        : (s.value?.type === 'FunctionCallExpr' ? s.value.callee?.name : null);
      // A dependency's own class is no conversion: `t Thing = Thing()`.
      if (depName && classEnc(depName) !== s.typeNameEnc && dependencyNames.has(depName) && remotesParsed[depName]) {
        const asTypes = remotesParsed[depName].__asTypesEnc;
        if (asTypes && !asTypes.includes(s.typeNameEnc)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${shown(s.typeNameEnc)}'`);
        } else if (!asTypes && !actorInfo?.has(depName)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${shown(s.typeNameEnc)}'`);
        }
      }
    }

    // ── Service coercion constraint checking ──────────────────────────
    // Check DotCallExpr on coercion aliases against the cast's constraint
    if (coercionConstraints?.size > 0) {
      const coercionDot = s.type === 'DestructureAssign' ? s.source : (s.type === 'ExprStatement' ? s.expr : s.value);
      if (coercionDot?.type === 'DotCallExpr') {
        const objName = (coercionDot.object?.type === 'Identifier' || coercionDot.object?.type === 'RefRead') ? coercionDot.object.name : null;
        if (objName && coercionConstraints.has(objName)) {
          const { constraint } = coercionConstraints.get(objName);
          const methodName = '@' + coercionDot.method;
          const spec = constraint[methodName] || constraint[coercionDot.method];
          if (spec && spec.params) {
            for (const callArg of coercionDot.args) {
              const argName = callArg.name;
              const argType = inferArgType(callArg.expr, typeEnv);
              if (argType === undefined) continue;
              const specParam = spec.params.find(sp => sp.name === argName);
              if (specParam && specParam.typeEnc !== undefined && argType !== specParam.typeEnc) {
                throw new Error(
                  `Type mismatch: cast '${objName}' constrains '${methodName}' param '${argName}' to '${shown(specParam.typeEnc)}', ` +
                  `but got '${shown(argType)}'`,
                );
              }
            }
          }
        }
      }
    }

    // ── Remote call validation ──────────────────────────────────────
    // Check DotCallExpr on declared dependencies or actor-reference variables
    const dotCall = s.type === 'ExprStatement' ? s.expr
      : s.type === 'DestructureAssign' ? s.source
      : s.value;
    if (dotCall?.type === 'DotCallExpr') {
      const objName = (dotCall.object?.type === 'Identifier' || dotCall.object?.type === 'RefRead') ? dotCall.object.name : null;
      // Direct dependency call: Remote.call()
      if (isRemoteSend(dotCall)) {
        validateRemoteCall(dotCall, remotesParsed, typeEnv, actorByName);
      } else if (dotCall.opre?.address.kind === 'static' || dotCall.opre?.address.path?.length) {
        // Through a sub-service, or a local bound to one.
        validateLoweredCall(dotCall, typeEnv, actorByName);
      }
      // Actor call: view.open() where view is typed as a dependency name
      if (objName && !dependencyNames.has(objName)) {
        const objType = depOfEnc(typeEnv.get(objName), dependencyNames);
        if (objType && remotesParsed[objType]) {
          // Validate against the actor interface
          const instanceExpr = { ...dotCall, object: { type: 'Identifier', name: objType } };
          validateRemoteCall(instanceExpr, remotesParsed, typeEnv, actorByName);
        }
      }
    }

    // Reject returning result of remote send when silent or no interface
    if (s.type === 'Reply') {
      for (const f of s.fields) {
        const dep = asDepCall(f.expr);
        if (dep) checkRemoteSendAssignable(dep, remotesParsed);
      }
    }
    if (s.type === 'ImplicitReturn') {
      const dep = asDepCall(s.expr);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Reject assigning result of remote send when not allowed
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr') {
      const dep = asDepCall(s.value);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }
    if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr') {
      const dep = asDepCall(s.source);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Function literal validation
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function' && s.value.body) {
      checkWhileReturnType(s.value);
      const fnTypeEnv = buildTypeEnv(s.value.params || [], s.value.body, null, dependencyNames);
      validateBody(s.value.body, actorInfo, dependencyNames, remotesParsed, factoryDecls, fnTypeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
    }
  }
}

// ── Type consistency ────────────────────────────────────────────────────────

function checkTypeConsistency(body) {
  const typeMap = new Map();
  function checkAndSet(name, t) {
    if (typeMap.has(name) && typeMap.get(name) !== t) {
      throw new Error(`Conflicting type declarations for '${name}': '${shown(typeMap.get(name))}' vs '${shown(t)}'`);
    }
    typeMap.set(name, t);
  }
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      checkAndSet(s.name, s.typeNameEnc);
    } else if (s.type === 'TypedAssign') {
      checkAndSet(s.name, s.typeNameEnc);
    } else if (s.type === 'RefDecl' && s.typeNameEnc !== undefined) {
      checkAndSet(s.name, s.typeNameEnc);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.typeEnc !== undefined) checkAndSet(item.name, item.typeEnc);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && !item.rest && item.name && item.typeEnc !== undefined) checkAndSet(item.name, item.typeEnc);
      }
    }
  }
}

// ── Named-field check ───────────────────────────────────────────────────────

function checkNamedFields(pattern, source) {
  if (source.type !== 'ObjectConstructor') return;
  const literalKeys = new Set(source.args.filter(a => a.key !== undefined).map(a => a.key));
  for (const item of pattern) {
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key !== null && !literalKeys.has(key)) {
      throw new Error(`Field '${key}' not found in Object literal`);
    }
  }
}

// The shape of a callee's returns, unioned over its overloads and return
// sites: the named fields they carry and whether any carries a positional.
// Null when that can't be told statically: no return to inspect, or a
// positional value that might be an Object (which spreads its own names into
// the reply).
function knownReturnShape(fns, outerTypes = new Map()) {
  const keys = new Set();
  let hasPositional = false;
  for (const fn of fns) {
    const types = new Map(outerTypes);
    for (const p of (fn.params || [])) if (p.typeEnc !== undefined) types.set(p.key || p.name, p.typeEnc);
    const returns = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'Function') return;
      if (node.type === 'TypedAssign' && node.typeNameEnc !== undefined) types.set(node.name, node.typeNameEnc);
      if (node.type === 'Reply' || node.type === 'Return' || node.type === 'ImplicitReturn') returns.push(node);
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
    };
    walk(fn.body);
    if (returns.length === 0) return null;
    const mayCarryNames = (e) => {
      if (!e) return true;
      if (/Literal$/.test(e.type) && e.type !== 'ObjectLiteral') return false;
      if (e.type === 'BinaryExpr' || e.type === 'UnaryExpr') return false;
      if (e.type === 'Identifier' || e.type === 'RefRead') {
        // A sole Object return was already lowered to a spread
        // (spreadObjectReturns); one still positional is one value of several.
        const t = types.get(e.name);
        return t === undefined || encMembers(t).includes('Anything');
      }
      return true;
    };
    for (const r of returns) {
      if (r.type === 'ImplicitReturn') {
        if (mayCarryNames(r.expr)) return null;
        hasPositional = true;
        continue;
      }
      for (const f of (r.fields || [])) {
        if (f.spread || f.rest) return null;
        if (f.sigil !== undefined) keys.add(f.sigil);
        else if (f.key !== undefined) keys.add(f.key);
        else if (mayCarryNames(f.expr || f.value || (f.name ? { type: 'Identifier', name: f.name } : null))) return null;
        else hasPositional = true;
      }
    }
  }
  return { keys, hasPositional };
}

// Returning a sole Object-typed value returns it as the reply: `return r` and
// a tail `r` lower to `return ...r`, so its positional and named fields spread.
// `r Object = f(); return r` then forwards f's reply unchanged — the mirror of
// a typed Object bind taking the whole reply. Several values (`return r, 7`)
// keep r as one value.
// `top as Function` on one of the file's functions is a reference to it: `&top`.
function lowerFunctionAs(ast) {
  for (const actor of ast.actors) {
    const walk = (node, fns) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => walk(n, fns)); return; }
      if (node.type === 'Identifier' && node.attestedAsEnc === 'Function' && fns.has(node.name)) {
        node.type = 'FnRef';
        delete node.attestedAsEnc;
        return;
      }
      const params = Array.isArray(node.params) ? node.params.map(p => p?.name) : [];
      const inner = params.some(p => fns.has(p)) ? new Set([...fns].filter(f => !params.includes(f))) : fns;
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, inner);
    };
    walk(actor, new Set((actor.functions || []).map(f => f.name)));
  }
}

function spreadObjectReturns(ast) {
  // A lambda's return node is `Return`; a handler's / function's is `Reply`.
  // A param's tags came with the request. A local's didn't, so it forwards none.
  const locals = new Set();
  const walk = (node, types, retType) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, types, retType)); return; }
    if (Array.isArray(node.params) && Array.isArray(node.body)) {
      const inner = new Map(types);
      for (const p of node.params) if (p?.name) { inner.set(p.key || p.name, p.typeEnc); locals.delete(p.name); }
      walk(node.body, inner, node.type === 'Function' ? 'Return' : 'Reply');
      return;
    }
    if (node.type === 'TypedAssign' && node.name) { types.set(node.name, node.typeNameEnc); locals.add(node.name); }
    const isObject = (name) => types.get(name) === 'Object';
    if ((node.type === 'Reply' || node.type === 'Return') && node.fields?.length === 1) {
      const f = node.fields[0];
      if (f.positional && f.name && !f.expr && f.typeEnc === undefined && isObject(f.name)) {
        node.fields = [{ spread: true, name: f.name, localObject: locals.has(f.name) }];
      }
    } else if (node.type === 'ImplicitReturn' && node.expr?.type === 'Identifier' && isObject(node.expr.name)) {
      const name = node.expr.name;
      for (const k of Object.keys(node)) delete node[k];
      Object.assign(node, { type: retType, fields: [{ spread: true, name, localObject: locals.has(name) }] });
      return;
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') walk(v, types, retType);
  };
  walk(ast.actors, new Map(), 'Reply');
}

// `:x = f()` (or `x: v = f()`) needs f to return a named `x`. A sole positional
// does not bind into a named pattern item — bind it by position: `x T = f()`.
// A destructure names no more positional slots than the call returns, on any path.
function checkPositionalCount(pattern, calleeLabel, shapes) {
  if (!shapes || shapes.opaque || shapes.orSelf || !shapes.alternatives.length) return;
  const names = pattern.filter(item => item.positional && !item.rest).length;
  const most = Math.max(...shapes.alternatives.map(alt => alt.filter(slot => slot.name === null).length));
  if (names > most) {
    throw new Error(`'${calleeLabel}()' returns ${most} positional value${most === 1 ? '' : 's'}; this destructure names ${names}`);
  }
}

function checkNamedReturns(pattern, calleeLabel, shape) {
  if (!shape) return;
  const { keys } = shape;
  for (const item of pattern) {
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key !== null && !keys.has(key)) {
      const typed = item.typeEnc !== undefined ? `${item.name} ${nodeShown(item)}` : item.name;
      throw new Error(`Cannot destructure '${key}' from '${calleeLabel}()' — it returns no named '${key}' (to bind a positional result, write '${typed} = ${calleeLabel}()')`);
    }
  }
}

// ── A caller's annotation against what comes back ────────────────────────────
// `x T = f()` has to hold for every path of f. A slot typed `Anything` can't be
// judged, and neither can a type this file knows nothing about.
const functionOwners = new WeakMap();
let functionsByName = new Map();
const COMPARABLE_SCALARS = new Set(['Integer', 'Text', 'Boolean', 'Decimal', 'Float', 'Blob', 'null']);

// ── Encoded types (src/type_enc.js) ──────────────────────────────────────────
//
// What one run of validation needs to read encoded types: the program, for the
// encoding a name has in it.
const run = { ast: null, classEncByName: new Map() };
// A type as a message shows it (`shown`).
const tyShown = (t) => shown(t);
// The type a node holds under `key`, as a message shows it: one with no encoding
// (a constructor profile, an interface) from its type tree.
const nodeShown = (node, key = 'type') => (node?.[`${key}Tree`] ? renderType(node[`${key}Tree`]) : shown(node?.[`${key}Enc`]));

// A class, by its name here (a public one is `C__pub` while validation runs), as an
// encoded type: an instance of it, as an annotation naming it would be encoded.
function classEnc(name) {
  if (typeof name !== 'string' || !run.ast?.typeNamed) return undefined;
  if (run.classEncByName.has(name)) return run.classEncByName.get(name);
  const written = name.endsWith(PUBLIC_CLASS_SUFFIX) ? `@${name.slice(0, -PUBLIC_CLASS_SUFFIX.length)}` : name;
  return run.ast.typeNamed(written.includes('.') ? written.split('.') : [written]);
}

// The class an encoded type is an instance of, by its name here, or null.
const classesByEnc = new WeakMap();
function classOfEnc(t, actorByName) {
  if (!isInstance(t) || !actorByName) return null;
  if (!classesByEnc.has(actorByName)) {
    classesByEnc.set(actorByName, new Map([...actorByName.keys()].map(n => [classEnc(n), n])));
  }
  return classesByEnc.get(actorByName).get(t) ?? null;
}

// How a message writes an encoded type: as the source names it. A public class is
// its name while validation runs (`C__pub`, shown as `@C`); a type of another
// service, by its name there.
function shown(t) {
  const aliases = dependencyAliases(run.ast);
  return show(t, (a) => {
    const own = ownPath(a);
    if (own) {
      const names = ownNames(a);
      return own.length === 1 && isInstance(a) && !own[0].startsWith('~') ? `${names[0]}${PUBLIC_CLASS_SUFFIX}` : names.join('::');
    }
    return addressShown(a, aliases);
  }, { bareList: true });
}

const comparable = (m) => m === null || (typeof m === 'string' && COMPARABLE_SCALARS.has(m));

// Whether validation can judge an encoded type: built-in scalars and classes of
// this file whose actors have no `as` clauses.
function canJudgeEnc(t, actorByName) {
  if (t === undefined) return false;
  return encMembers(t).every(m => m === 'Anything' || comparable(m)
    || (classOfEnc(m, actorByName) && !actorByName.get(classOfEnc(m, actorByName)).asClauses?.length));
}

// Is `from` assignable to `to`, both encoded? The same type, `Anything` on either
// side, a union (the target takes any member; a union source, only if each member
// fits), or a class whose superclasses include the target's. Unknown → null.
function assignableEnc(from, to, actorByName) {
  if (from === undefined || to === undefined) return null;
  if (from === to) return true;
  if (from === 'Anything' || to === 'Anything') return true;
  if (isUnion(to)) {
    if (isUnion(from)) return encMembers(from).every(fm => assignableEnc(fm, to, actorByName));
    return encMembers(to).some(tm => assignableEnc(from, tm, actorByName));
  }
  if (isUnion(from)) return false; // a union can't narrow to a single type without a guard
  const start = classOfEnc(from, actorByName);
  if (!start) return false;
  const visited = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const st of actorByName.get(cur)?.supertypes || []) {
      if (classEnc(st.supertype) === to) return true;
      stack.push(st.supertype);
    }
  }
  return false;
}

// Whether an encoded type says `Anything` anywhere in it.
const mentionsAnythingEnc = (t) => t === 'Anything' || (Array.isArray(t) ? t.some(mentionsAnythingEnc)
  : t && typeof t === 'object' ? Object.values(t).some(mentionsAnythingEnc) : false);

// The encoded types of the names a function's owner gives it, as
// src/return_shapes.js reads an outer scope.
function fnOuterTypes(fn) {
  const owner = functionOwners.get(fn);
  const env = new Map();
  for (const v of (owner?.stateVarDecls || [])) if (v.typeNameEnc !== undefined) env.set(v.name, v.typeNameEnc);
  for (const p of (owner?.initParams || [])) if (p.typeEnc !== undefined) env.set(p.name, p.typeEnc);
  return env;
}

// `select` narrows a doc's signatures to those the call could select.
// The one class a dependency call returns on every clause (`document.body()` →
// `body`), or null.
function soleRemoteClassOf(call, remotesParsed, typeEnv, dependencyNames) {
  if (call?.attestedAsEnc !== undefined) return null;
  const shapes = remoteReturnShapes(call, remotesParsed, typeEnv, dependencyNames, sigs => sigs)?.shapes;
  if (!shapes || shapes.opaque || shapes.orSelf || shapes.alternatives.length === 0) return null;
  if (shapes.alternatives.some(alt => alt.length !== 1 || alt[0].name !== null)) return null;
  const types = new Set(shapes.alternatives.map(alt => alt[0].typeEnc));
  if (types.size !== 1) return null;
  // The class by its name in the document: an instance's last token.
  const [t] = types;
  if (typeof t !== 'string') return null;
  const tokens = t.startsWith(':') ? ownNames(t) ?? [] : splitAddress(t).filter(x => x !== '*');
  return tokens.length ? tokens[tokens.length - 1] : null;
}

function remoteReturnShapes(call, remotesParsed, typeEnv, dependencyNames, select) {
  if (call.type !== 'DotCallExpr') return null;
  // Through a sub-service: its own document says what it returns.
  const lowered = call.object?.type === 'Identifier' && dependencyNames?.has(call.object.name) ? null : resolveLoweredCall(call);
  if (lowered?.sigs?.length) {
    const chosen = select(lowered.sigs);
    if (chosen.length === 0) return null;
    return { label: `${lowered.label}.${call.method}`, shapes: mergeShapes(chosen.map(docReturnShapes)) };
  }
  if (call.object?.type !== 'Identifier') return null;
  const name = call.object.name;
  const dep = dependencyNames?.has(name) ? name : depOfEnc(typeEnv?.get(name), dependencyNames);
  const doc = remotesParsed[dep];
  if (!doc) return null;
  const sigs = doc[call.method] ?? doc.__types?.[dep]?.functions?.filter(f => f.name === call.method);
  if (!sigs?.length) return null;
  const chosen = select(sigs);
  if (chosen.length === 0) return null;
  return { label: `${name}.${call.method}`, shapes: mergeShapes(chosen.map(docReturnShapes)) };
}

function checkAnnotationCovers(s, label, { alternatives, orSelf, opaque }, actorByName) {
  if (opaque || alternatives.length === 0) return;
  const mismatch = (declared, actual) => canJudgeEnc(declared, actorByName) && canJudgeEnc(actual, actorByName)
    && assignableEnc(actual, declared, actorByName) === false;

  if (s.type === 'TypedAssign') {
    const declaredEnc = s.typeNameEnc;
    if (declaredEnc === undefined || declaredEnc === 'Anything') return;
    const declared = shown(declaredEnc);
    const slots = alternatives.map(alt => alt.find(slot => slot.name === null));
    const missing = alternatives.find((alt, i) => alt.length > 0 && !slots[i]);
    if (missing) {
      const names = missing.map(slot => slot.name).join(', ');
      if (alternatives.length === 1) {
        throw new Error(`Cannot bind '${s.name}' to '${label}()' — it returns only named fields (${names}); destructure instead: '${missing[0].name}: ${s.name} ${declared} = ${label}()'`);
      }
      throw new Error(`Cannot bind '${s.name}' to '${label}()' — one of its paths returns only named fields (${names}); handle its shapes separately`);
    }
    if (orSelf) throw new Error(`Cannot bind '${s.name} ${declared}' to '${label}()' — some of its paths return self, not a value`);
    const known = slots.filter(Boolean).map(slot => slot.typeEnc).filter(t => t !== undefined);
    const bad = known.find(type => mismatch(declaredEnc, type));
    if (bad !== undefined) {
      const all = [...new Set(known.flatMap(encMembers))].map(shown).join(' | ');
      throw new Error(`Cannot bind '${s.name} ${declared}' to '${label}()' — it can return ${all}. Annotate '${s.name} ${all}', or coerce: '${s.name} ${declared} = ${label}() as ${declared}'`);
    }
    return;
  }

  for (const item of s.pattern || []) {
    if (item.discard) continue;
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key === null) continue;
    for (const alt of alternatives) {
      const slot = alt.find(c => c.name === key);
      if (!slot) throw new Error(`Cannot destructure '${key}' from '${label}()' — only some of its paths return it`);
      if (item.typeEnc !== undefined && slot.typeEnc !== undefined && mismatch(item.typeEnc, slot.typeEnc)) {
        throw new Error(`Cannot bind '${key} ${shown(item.typeEnc)}' to '${label}()' — it can return ${shown(slot.typeEnc)} there`);
      }
    }
    if (orSelf) throw new Error(`Cannot destructure '${key}' from '${label}()' — some of its paths return self`);
  }
}

// `x T = value` for a value that isn't a call: a name, a literal, an expression.
// A narrowable value is wrong only when no member of its type could hold a T;
// any other, when some member can't.
// A literal takes the form its annotation asks for: `d Decimal = 0`, `b Blob = "hi"`.
const NUMERIC_FORMS = ['Integer', 'Decimal', 'Float'];
const LITERAL_FORMS = new Map([
  ['Integer', NUMERIC_FORMS], ['Decimal', NUMERIC_FORMS], ['Float', NUMERIC_FORMS], ['Text', ['Text', 'Blob']],
]);

function checkAnnotationValue(s, value, actorByName) {
  const declaredEnc = s.typeNameEnc;
  if (!value || declaredEnc === undefined || declaredEnc === 'Anything') return;
  const declared = shown(declaredEnc);
  const { type, narrowable, literal } = value;
  if (!canJudgeEnc(declaredEnc, actorByName) || !canJudgeEnc(type, actorByName)) return;
  const members = encMembers(type);
  // A name holding an actor is asked for `as` at run time, and may hold a
  // subclass that has clauses: that's the runtime's to judge.
  const holds = (m) => assignableEnc(m, declaredEnc, actorByName)
    || (literal && typeof m === 'string' && LITERAL_FORMS.get(m)?.includes(declaredEnc))
    || (narrowable && !!classOfEnc(m, actorByName));
  const wrong = narrowable ? !members.some(holds) : !members.every(holds);
  if (!wrong) return;
  const is = members.length > 1 ? 'can be' : 'is';
  const named = s.value?.type === 'Identifier' || s.value?.type === 'RefRead' ? s.value.name : null;
  const shownType = shown(type);
  if (named) {
    throw new Error(`Cannot bind '${s.name} ${declared}' to '${named}', which ${is} ${shownType}. Annotate '${s.name} ${shownType}', or coerce: '${s.name} ${declared} = ${named} as ${declared}'`);
  }
  throw new Error(`Cannot bind '${s.name} ${declared}' to a value that ${is} ${shownType}. Annotate '${s.name} ${shownType}', or coerce it with 'as ${declared}'`);
}

// `x T = f()` binds f's positional result. When f returns only named fields,
// pull them out explicitly: `:x T = f()` or `x: v T = f()`.
function checkPositionalReturn(s, calleeLabel, shape) {
  if (!shape || shape.hasPositional || shape.keys.size === 0) return;
  const named = [...shape.keys].sort();
  const declared = nodeShown(s, 'typeName');
  const hint = named.includes(s.name) ? `:${s.name} ${declared} = ${calleeLabel}()` : `${named[0]}: ${s.name} ${declared} = ${calleeLabel}()`;
  throw new Error(`Cannot bind '${s.name}' to '${calleeLabel}()' — it returns only named fields (${named.join(', ')}); destructure instead: '${hint}'`);
}

// ── Published params ────────────────────────────────────────────────────────
// `@name` publishes a class / file param. A function or handler has no
// surface to publish on, and a published param and a handler can't share a
// name.
function checkPublishedParams(ast) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if ((node.type === 'Function' || (node.type === 'FunctionDecl' && !node.actorDef)) && Array.isArray(node.params)) {
      const p = node.params.find(pp => pp.accessor);
      if (p) {
        const where = node.type === 'FunctionDecl' && node.name ? `'${node.name}'` : 'a function';
        throw new Error(`Cannot publish param '${p.accessor}' of ${where} — '@' marks class and file params only`);
      }
    }
    for (const k in node) if (k !== 'type') walk(node[k]);
  };
  walk(ast.actors);
  for (const actor of ast.actors) {
    for (const p of (actor.initParams || [])) {
      if (p.accessor && (actor.functions || []).some(f => f.name === '@' + p.accessor && !f.actorDef)) {
        throw new Error(`'@${p.accessor}' is both a published param and a handler of ${actor.name ? `'${actor.name}'` : 'this file'} — drop the '@' on the param or remove the handler`);
      }
    }
  }
}

// ── Re-bind guards ──────────────────────────────────────────────────────────

// Inside a block, a name from the enclosing scope always means that name. A body's
// names are all it binds at its own level, wherever in the body, so order doesn't
// change what a block may bind. Separate branches enclose nothing of each other.
// Function params are the one exception: a param may reuse an outer name, for that
// function's body only.

const BLOCK_LABELS = {
  IfBranch: 'an if block',
  WhileStatement: 'a while block',
  CatchExpr: 'a catch block',
};

function boundNames(s) {
  if (s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'BareTypeDecl' || s.type === 'RefDecl') {
    return [s.name];
  }
  if (s.type === 'DestructureAssign' || s.type === 'ListDestructure') {
    return (s.pattern || []).filter(item => !item.discard && item.name).map(item => item.name);
  }
  return [];
}

function checkBlockBinds(body, outer, label, params = []) {
  const names = body.flatMap(boundNames);
  const hit = names.find(name => outer.has(name) && !params.includes(name));
  if (hit) {
    throw new Error(`Cannot re-bind '${hit}' inside ${label} — it's bound in the enclosing scope, so use a new name`);
  }
  checkNestedBlocks(body, new Set([...outer, ...params, ...names]));
}

function checkFunctionBinds(fn, outer) {
  const params = (fn.params || []).map(p => p.name).filter(Boolean);
  if (fn.body) checkBlockBinds(fn.body, outer, 'a function', params);
  else checkNestedBlocks(fn.expr, new Set([...outer, ...params]));
}

function checkNestedBlocks(node, visible) {
  if (Array.isArray(node)) {
    node.forEach(item => checkNestedBlocks(item, visible));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Function' || node.type === 'SubscribeCall') {
    checkFunctionBinds(node, visible);
    return;
  }
  const label = BLOCK_LABELS[node.type];
  for (const [key, value] of Object.entries(node)) {
    if (label && key === 'body' && Array.isArray(value)) checkBlockBinds(value, visible, label);
    else checkNestedBlocks(value, visible);
  }
}

// ── While-null return type check ────────────────────────────────────────────

// ── Constructor call validation ─────────────────────────────────────────

function validateConstructorCall(expr, factoryDecls, _typeEnv) {
  const name = expr.callee.name;
  const declaredParams = factoryDecls[name];
  if (!declaredParams) return;

  // Build a single signature from the constructor params
  const sig = { params: declaredParams.map(p => ({ name: p.key || p.name, typeEnc: p.typeEnc, ...(p.optional && { optional: true }) })) };

  // Extract call args — may come from parseCallArgs (NamedArgsBag) or parseSendArgs (direct)
  const callNamed = new Map();
  const callPositional = [];
  for (const a of expr.args) {
    if (a.type === 'NamedArgsBag') {
      for (const [k, v] of Object.entries(a.fields)) {
        callNamed.set(k, { expr: v });
      }
    } else if (a.positional === false && a.name) {
      callNamed.set(a.name, { expr: a.expr, typeNameEnc: a.typeNameEnc });
    } else {
      callPositional.push(a);
    }
  }

  const sigPositional = sig.params.filter(p => !p.name);
  const sigNamed = sig.params.filter(p => p.name);
  const requiredPositional = sigPositional.filter(p => !p.optional).length;

  // Check positional count (accounting for optional params)
  if (callPositional.length < requiredPositional || callPositional.length > sigPositional.length) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${shown(p.typeEnc)}` : shown(p.typeEnc)).join(', ')})`;
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. Expected ${requiredPositional === sigPositional.length ? sigPositional.length : requiredPositional + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
  }

  // Check named args match (optional named args don't need to be provided)
  const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
  const allNamedKeys = new Set(sigNamed.map(p => p.name));
  const callNamedKeys = new Set(callNamed.keys());
  const missing = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
  const extra = [...callNamedKeys].filter(k => !allNamedKeys.has(k));
  if (missing.length > 0 || extra.length > 0) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${shown(p.typeEnc)}` : shown(p.typeEnc)).join(', ')})`;
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(', ')}`);
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. ${parts.join('; ')}`);
  }

  // Check types
  const argType = (a) => {
    if (a.typeNameEnc !== undefined) return a.typeNameEnc;
    if (a.expr) return inferLiteralTypeEnc(a.expr);
    return undefined;
  };

  for (const sp of sigNamed) {
    const ca = callNamed.get(sp.name);
    if (!ca) continue;
    const ct = argType(ca);
    if (ct !== undefined && sp.typeEnc !== undefined && !encMembers(sp.typeEnc).some(m => m === ct || m === 'Anything')) {
      throw new Error(`'${name}()' constructor arg '${sp.name}': expected ${shown(sp.typeEnc)}, got ${shown(ct)}`);
    }
  }
}

// ── Remote call validation ────────────────────────────────────────────────

function validateRemoteCall(expr, remotesParsed, typeEnv, actorByName) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) return; // no interface — no arg validation
  const methodName = expr.method;
  let sigs = parsed[methodName];
  // Type-form fallback: when the dep alias names a type in `__types` (e.g.
  // `document: <> -> { title: ... }`), look up methodName in that type's
  // function table. The synthetic actor in actorByName carries the methods
  // with `@`-prefixed names and Reply-shaped bodies for return extraction.
  if (!sigs && parsed.__types?.[actorName] && actorByName) {
    const typeActor = actorByName.get(actorName);
    // Every clause of an overloaded method: a call matches if any one does.
    let fns = typeActor?.functions?.filter(f => f.name === '@' + methodName) || [];
    // Walk the superclass chain for inherited methods. Lets a typed remote
    // singleton (e.g. `document`, a Document, whose parent is Node) pick
    // up methods declared on its ancestors — even when those ancestors live
    // in a different remote service, since actorByName is shared.
    if (fns.length === 0 && typeActor) {
      const { inheritedFunctions } = resolveSuperclassChain(actorByName, typeActor);
      fns = inheritedFunctions.filter(f => f.name === '@' + methodName);
    }
    if (fns.length > 0) {
      sigs = fns.map(fn => {
        const reply = fn.body?.find(s => s.type === 'Reply');
        const returns = reply ? reply.fields.map(f => ({
          name: f.key || f.name, typeEnc: f.typeEnc, positional: f.positional,
        })) : null;
        return { params: fn.params || [], returns };
      });
    }
  }
  // A class's own members (its class block's doc, `^ { … }`): `T.f()` on a class
  // from another file is a call to its block.
  if (!sigs) sigs = parsed.__types?.[actorName]?.members?.[methodName] ?? null;
  if (!sigs) {
    const opNames = Object.keys(parsed).filter(k => !k.startsWith('__'));
    const typeMethods = parsed.__types?.[actorName]?.functions?.map(f => f.name) || [];
    const classes = Object.keys(parsed.__types || {});
    const available = [...opNames, ...typeMethods, ...classes].join(', ') || 'none';
    throw new Error(`'${actorName}' has no function '${methodName}'. Available: ${available}`);
  }
  matchRemoteSigs(expr, sigs, actorName, actorName, typeEnv, actorByName);
}

// A call through a sub-service (`Svc.s.get()`), checked against the document its
// lowered address leads to (src/opre.js).
function validateLoweredCall(expr, typeEnv, actorByName) {
  const resolved = resolveLoweredCall(expr);
  if (!resolved) return;
  if (resolved.error) throw new Error(resolved.error);
  const { doc, label, sigs } = resolved;
  if (!sigs) {
    const opNames = Object.keys(doc).filter(k => !k.startsWith('__'));
    const subs = Object.keys(doc.__services || {});
    throw new Error(`'${label}' has no function '${expr.method}'. Available: ${[...opNames, ...subs].join(', ') || 'none'}`);
  }
  matchRemoteSigs(expr, sigs, label, expr.opre.address.dep ?? null, typeEnv, actorByName);
}

// Whether a call's args fit one of a document's signatures. `label` names the
// receiver in messages; `dep` is the alias whose doc names its types bare.
function matchRemoteSigs(expr, sigs, label, dep, typeEnv, actorByName) {
  const methodName = expr.method;
  const callPositional = expr.args.filter(a => a.positional !== false && a.type !== 'NamedArgsBag');
  const callNamed = expr.args.filter(a => a.positional === false || a.type === 'NamedArgsBag');
  const callNamedKeys = new Set();
  for (const a of callNamed) {
    if (a.type === 'NamedArgsBag') {
      for (const k of Object.keys(a.fields || {})) callNamedKeys.add(k);
    } else if (a.name) {
      callNamedKeys.add(a.name);
    }
  }
  // Types are encoded: a document's are in this file's terms as it's read
  // (src/service_doc.js, readDocument), so `Svc::Point` here is its `:Point`.
  const argType = (a) => {
    if (a.typeNameEnc !== undefined) return a.typeNameEnc;
    if (a.expr?.type === 'Identifier') return typeEnv?.get(a.expr.name);
    if (a.expr) return inferLiteralTypeEnc(a.expr);
    return undefined;
  };
  const errors = [];
  for (const sig of sigs) {
    const sigPositional = sig.params.filter(p => !p.name);
    const sigNamed = sig.params.filter(p => p.name);
    const requiredPos = sigPositional.filter(p => !p.optional).length;
    if (callPositional.length < requiredPos || callPositional.length > sigPositional.length) {
      errors.push(`expected ${requiredPos === sigPositional.length ? sigPositional.length : requiredPos + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
      continue;
    }
    const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
    const sigNamedKeys = new Set(sigNamed.map(p => p.name));
    const missingNamed = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
    const extraNamed = [...callNamedKeys].filter(k => !sigNamedKeys.has(k));
    if (missingNamed.length > 0 || extraNamed.length > 0) {
      const parts = [];
      if (missingNamed.length) parts.push(`missing: ${missingNamed.join(', ')}`);
      if (extraNamed.length) parts.push(`unexpected: ${extraNamed.join(', ')}`);
      errors.push(parts.join('; '));
      continue;
    }
    let typeMismatch = false;
    for (let i = 0; i < callPositional.length; i++) {
      const callType = argType(callPositional[i]);
      const sigType = sigPositional[i]?.typeEnc;
      if (callType !== undefined && sigType !== undefined && assignableEnc(callType, sigType, actorByName) === false) {
        errors.push(`positional arg ${i + 1}: expected ${shown(sigType)}, got ${shown(callType)}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    for (const a of callNamed) {
      const aName = a.name;
      if (!aName) continue;
      const callType = argType(a);
      const sigParam = sigNamed.find(p => p.name === aName);
      if (callType !== undefined && sigParam?.typeEnc !== undefined && assignableEnc(callType, sigParam.typeEnc, actorByName) === false) {
        errors.push(`named arg '${aName}': expected ${shown(sigParam.typeEnc)}, got ${shown(callType)}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    return; // match found
  }
  const sigStrs = sigs.map(s => {
    const parts = s.params.map(p => p.name ? `${p.name}: ${shown(p.typeEnc)}` : shown(p.typeEnc));
    return `(${parts.join(', ')})`;
  });
  throw new Error(`'${label}.${methodName}()' arguments don't match any signature: ${sigStrs.join(' | ')}. ${errors[0]}`);
}

function checkRemoteSendAssignable(expr, remotesParsed) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — '${actorName}' has no declared interface.`);
  }
  const sigs = parsed[expr.method];
  if (sigs && sigs.every(s => s.returns === null)) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — it is declared as silent (return .).`);
  }
}

// ── Tail-repeat return type check ───────────────────────────────────────────
//
// A function whose tail is `repeat …` returns Void (`()`) — loops yield no
// value. The parser already collapses such bodies to `returnType = '()'`.
// If the user instead annotated a non-void return type, that's a contract
// the loop cannot satisfy: reject with a hint.

function checkWhileReturnType(fnNode) {
  if (!fnNode.body || fnNode.body.length === 0) return;
  // Find the last non-BareTypeDecl statement (matches codegen.js _lastIsWhile tracking)
  let last = null;
  for (const s of fnNode.body) {
    if (s.type !== 'BareTypeDecl') last = s;
  }
  if (!last || last.type !== 'WhileStatement') return;
  if (fnNode.returnType === '()' || (fnNode.returnType === undefined && fnNode.returnTypeEnc === undefined)) return;
  const declared = fnNode.returnTypeEnc !== undefined ? shown(fnNode.returnTypeEnc) : fnNode.returnType;
  throw new Error(
    `tail \`repeat\` makes this function Void — declared return '${declared}' cannot be satisfied by a loop`,
  );
}
