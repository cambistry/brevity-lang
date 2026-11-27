// `super` in a constructor: builds the base (notes/super-2026-11-19.md).
//
//   U = T ^ *(label Text, n Integer) {
//     super(n * 2)     // T's constructor runs here, on the base
//   }
//
// A subclass with a constructor of its own (params, or a `super` call) takes its own
// params only, and passes what its parent needs through `super`. A parent built that
// way is a layer whose params belong to it alone: in the subclass's actor they are
// cells under names nothing in source can spell, so the parent's `n` and the
// subclass's `n` don't meet. The parent's code is renamed to match (parentView).
//
// The parse leaves a `SuperInit` marker where the parent's constructor body runs,
// after the cells that hold its args are set; the merge (withInheritedState,
// src/subclass.js) puts the body there.
//
// A composition with no constructor of its own (`D = C^`, `M = A ^ B`, `U = T ^ *{ … }`
// with no `super`) still takes its parents' params and runs their bodies first: that
// case is open in the note.

import * as AST from './ast.js';
import { typeFields } from './type_enc.js';
import { orderParamsForDefaults } from './param_defaults.js';

// A public class is `@T` in the parse and `T__pub` (PUBLIC_CLASS_SUFFIX, src/subclass.js)
// once validation renames it: the hidden name is the same either way.
const classPart = (L) => L.name.replace(/^@/, 'P_').replace(/^(\w+)__pub(?=!?$)/, 'P_$1').replace(/[!.]$/, '');
export const hiddenParamName = (name, L) => `${name}__arg__${classPart(L)}`;

const walk = (node, visit, path = []) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit, path)); return; }
  if (node.type === 'Actor' && Array.isArray(node.functions)) return;
  if (visit(node, path) === false) return;
  const next = [...path, node];
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit, next);
};

const shown = (n) => `super${n.layer ? `[${n.layer}]` : ''}${n.args ? '(…)' : ''}`;
const LOOPS = new Set(['WhileStatement', 'OverExpr', 'ReduceExpr']);
const isFunctionNode = (n) => n.type === 'Function' || n.type === 'FunctionDecl';

// Whether a class builds its base with `super`: it has a constructor of its own.
// It's read from the lowered init, which copies of the class (an overload clause's
// synthetic actor) carry along. A parent the constructor never builds has a marker
// with `none`: the class has no base for it.
// A class from another file's document says so with `ownNew`.
// A `SuperInit` is a statement of the constructor block, or of an `if`'s branch there.
const hasSuperInit = (n) => !!n && typeof n === 'object' && (n.type === 'SuperInit' || (Array.isArray(n) ? n.some(hasSuperInit)
  : Object.entries(n).some(([k, v]) => k !== 'loc' && v && typeof v === 'object' && hasSuperInit(v))));
export const buildsBase = (actor) => !!actor?.ownNew || hasSuperInit(actor?.initBody || []);

// ── Renaming a parent layer's params ───────────────────────────────────────────

// Every use of the param `from` in `node`, as `to`. A function whose own params
// include `from` shadows it.
function renameIn(node, from, to) {
  if (Array.isArray(node)) { node.forEach(n => renameIn(n, from, to)); return; }
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Actor' && Array.isArray(node.functions)) return;
  if (isFunctionNode(node) && (node.params || []).some(p => p.name === from)) return;
  if (node.name === from && node.type !== 'FunctionDecl') {
    node.name = to;
    if (node.named) { delete node.named; node.key = from; }
  }
  if (node.objectName === from) node.objectName = to;
  if (node.sigil === from) {
    delete node.sigil;
    node.key = from;
    node.value = AST.identifier(to);
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') renameIn(v, from, to);
}

// A deep copy that keeps what earlier passes left on a node out of sight (its
// non-enumerable properties).
function deepCopy(node, seen = new Map()) {
  if (!node || typeof node !== 'object') return node;
  if (seen.has(node)) return seen.get(node);
  const out = Array.isArray(node) ? [] : Object.create(Object.getPrototypeOf(node));
  seen.set(node, out);
  for (const key of Reflect.ownKeys(node)) {
    if (Array.isArray(node) && key === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(node, key);
    if ('value' in d) d.value = deepCopy(d.value, seen);
    Object.defineProperty(out, key, d);
  }
  return out;
}

// Whether `node` names any of `names`.
function mentions(node, names) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(n => mentions(n, names));
  if (names.has(node.name) || names.has(node.objectName) || names.has(node.sigil)) return true;
  return Object.entries(node).some(([k, v]) => k !== 'loc' && v && typeof v === 'object' && mentions(v, names));
}

// `node` (a list) with each renamed param under its new name: an item that names
// one is a copy. A copied statement remembers the one it came from (`origin`),
// which settleBaseCells looks for.
function renamedCopy(node, renames) {
  if (!renames.size) return node;
  const names = new Set(renames.keys());
  const one = (item) => {
    if (!mentions(item, names)) return item;
    const copy = deepCopy(item);
    for (const [from, to] of renames) renameIn(copy, from, to);
    Object.defineProperty(copy, 'origin', { value: item.origin ?? item, configurable: true });
    return copy;
  };
  return Array.isArray(node) ? node.map(one) : one(node);
}

// ── A parent layer, as a subclass that builds it sees it ───────────────────────

// `chain` is resolveSuperclassChain, passed in to avoid a cycle. Validation lowers
// the parent's code in place, so a view is taken fresh each time, never kept.
// A cell made from a param has its type; an untyped one from a parent's doc,
// `Anything`.
const typeOfParam = (p) => {
  const fields = typeFields(p, 'type', 'typeName');
  return Object.keys(fields).length || p.type === null ? fields : { typeNameEnc: 'Anything' };
};

export function parentView(actorByName, P, chain) {
  const pc = chain(actorByName, P);
  // The params `new` takes: its own when it builds its base or has none, else (a
  // composition) its parents'.
  const params = [...pc.inheritedParams.filter(p => !(P.initParams || []).some(o => o.name === p.name)), ...(P.initParams || [])];
  const renames = new Map(params.map(p => [p.name, hiddenParamName(p.name, P)]));
  const fns = [...pc.inheritedFunctions.filter(f => !(P.functions || []).some(o => o.name === f.name)), ...(P.functions || [])];
  const functions = renamedCopy(fns, renames);
  // A published param is read on the wire as `@name`: the layer keeps answering it.
  for (const p of params) {
    if (!p.accessor || functions.some(f => f.name === '@' + p.accessor)) continue;
    functions.push(AST.functionDecl('@' + p.accessor, [], [{ ...AST.implicitReturn(AST.identifier(renames.get(p.name))), ...typeFields(p, 'type', 'typeName') }]));
  }
  return {
    params: params.map(p => ({
      ...p,
      name: renames.get(p.name),
      key: p.key || p.name,
      ...(p.defaultValue && { defaultValue: renamedCopy(p.defaultValue, renames) }),
    })),
    sourceParams: params,
    functions,
    cells: params.map(p => ({ name: renames.get(p.name), ...typeOfParam(p), isRef: !!p.ref })),
    init: renamedCopy(effectiveInit(actorByName, P, chain), renames),
  };
}

export const hasNoBase = (actor, P) => (actor?.initBody || []).some(s => s.type === 'SuperInit' && s.none && s.layer === P);
export const noBaseParents = (actor) => (actor?.initBody || []).filter(s => s.type === 'SuperInit' && s.none).map(s => s.layer);

// The public interface of `P`: each public function's arities, and its public cells.
function publicInterface(actorByName, P, chain) {
  const pc = chain(actorByName, P);
  const fns = new Map();
  const add = (name, arity) => (fns.get(name) ?? fns.set(name, new Set()).get(name)).add(arity);
  const own = new Set((P.functions || []).map(f => f.name));
  for (const f of [...pc.inheritedFunctions.filter(f => !own.has(f.name)), ...(P.functions || [])]) {
    if (typeof f.name !== 'string' || !f.name.startsWith('@') || f.actorDef || f.emptyOverload || f.baseOf) continue;
    add(f.name, (f.params || []).some(p => p.rest) ? 'any' : (f.params || []).length);
  }
  const params = [...pc.inheritedParams, ...(P.initParams || [])];
  for (const p of params) if (p.accessor) add('@' + p.accessor, 0);
  const cells = new Set([...pc.inheritedState, ...(P.stateVarDecls || [])].filter(d => d.name?.startsWith('@') && !d.baseOf).map(d => d.name));
  return { fns, cells };
}

// What of `P`'s public interface `U` doesn't define, by name and arity. What `U` has
// from the parents it builds counts.
function missingInterface(actorByName, U, P, builtParents, chain) {
  const want = publicInterface(actorByName, P, chain);
  const have = { fns: new Map(), cells: new Set((U.stateVarDecls || []).filter(d => !d.baseOf).map(d => d.name)) };
  const add = (name, arity) => (have.fns.get(name) ?? have.fns.set(name, new Set()).get(name)).add(arity);
  for (const f of U.functions || []) {
    if (typeof f.name === 'string' && !f.actorDef && !f.baseOf) add(f.name, (f.params || []).some(p => p.rest) ? 'any' : (f.params || []).length);
  }
  for (const p of U.initParams || []) if (p.accessor) add('@' + p.accessor, 0);
  for (const B of builtParents) {
    const b = publicInterface(actorByName, B, chain);
    for (const [name, arities] of b.fns) for (const a of arities) add(name, a);
    for (const c of b.cells) have.cells.add(c);
  }
  // A cell is read as a function with no args, and stands in for one.
  const hasArity = (name, a) => have.fns.get(name)?.has(a) || (a === 0 && have.cells.has(name));
  const missing = [];
  for (const [name, arities] of want.fns) {
    if (want.cells.has(name)) continue;
    for (const a of [...arities].sort()) {
      if (!hasArity(name, a)) missing.push(`'${name}' (${a === 'any' ? 'a rest param' : `${a} arg${a === 1 ? '' : 's'}`})`);
    }
  }
  for (const c of want.cells) if (!have.cells.has(c) && !have.fns.get(c)?.has(0)) missing.push(`'${c}' (a cell)`);
  return missing;
}

// What a class's constructor runs, its parents' parts in place: where its `super`
// calls are, or (no constructor of its own) first.
export function effectiveInit(actorByName, A, chain) {
  if (!buildsBase(A)) return [...chain(actorByName, A).inheritedInit, ...(A.initBody || [])];
  return expandSuperInits(actorByName, A, A.initBody || [], chain);
}

// `A`'s init with each `SuperInit` replaced by its parent's constructor body. A cell
// `A` declares itself takes `A`'s initial value only.
export function expandSuperInits(actorByName, A, init, chain) {
  const has = (node) => { let found = false; const look = (n) => { if (found || !n || typeof n !== 'object') return; if (n.type === 'SuperInit') { found = true; return; } for (const v of Object.values(n)) if (v && typeof v === 'object') look(v); }; look(node); return found; };
  if (!has(init)) return init;
  const own = new Set((A.stateVarDecls || []).filter(d => !d.baseOf).map(d => d.name));
  const hiddenOf = new Map((A.stateVarDecls || []).filter(d => d.baseOf).map(d => [d.baseOf, d]));
  // A branch of an 'if' builds the base where it calls 'super': the same, in its
  // body, on a copy of the statement.
  const inBranches = (n) => {
    if (!n || typeof n !== 'object' || !has(n)) return n;
    if (Array.isArray(n)) return n.map(inBranches);
    if (n.type === 'IfBranch' && Array.isArray(n.body)) return { ...n, body: expand(n.body) };
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v && typeof v === 'object' ? inBranches(v) : v]));
  };
  const expand = (list) => list.flatMap((s) => {
    if (s.type !== 'SuperInit') return [inBranches(s)];
    const P = actorByName?.get(s.layer);
    // A backend leaves out a class with nothing in it.
    if (s.none || !P) return [];
    const body = parentView(actorByName, P, chain).init;
    return body.flatMap((t) => {
      if (t.type !== 'StateAssign' || !own.has(t.name)) return [t];
      // `base::name` keeps the parent's initial value in a cell of its own.
      const h = hiddenOf.get(t.name);
      if (!h) return [];
      const copy = { ...t, name: h.name };
      Object.defineProperty(copy, 'origin', { value: t.origin ?? t, configurable: true });
      return [copy];
    });
  });
  return expand(init);
}

// ── `super` in a function: the base's same function ────────────────────────────

// In function `h`, `super(args)` is `base::h(args)`, and in `@h` it's `base.h(args)`:
// the same BaseCall the `base` forms make (src/base_layers.js), which resolves it.
// Bare `super` passes the function's args as received. In a lambda inside `h`,
// `super` is `h`'s.
export function lowerFunctionSupers(actors) {
  for (const U of actors) {
    const parents = (U.supertypes || []).map(st => st.supertype);
    for (const f of U.functions || []) {
      if (f.actorDef || typeof f.name !== 'string') continue;
      walk(f.body, (n, path) => {
        if (n.type !== 'SuperCall') return;
        const written = shown(n);
        const where = U.membersOf ? `the class block of '${U.membersOf}'` : U.singletonOf ? 'a singleton' : U.name ? `'${U.name}'` : 'this file';
        if (f.name.startsWith('#')) throw new Error(`'${written}' in '${f.name}' of ${where}: a private function has no parent layer`);
        if (!n.layer && parents.length > 1) {
          throw new Error(`'${written}' in '${f.name}' of '${U.name}' is ambiguous: '${U.name}' has parents ${parents.map(p => `'${p}'`).join(' and ')} — write ${parents.map(p => `'super[${p}](…)'`).join(' or ')}`);
        }
        let args = n.args;
        if (args === null) {
          // A function inside `h` with a param of the same name hides h's.
          for (const inner of path.filter(isFunctionNode)) {
            const hidden = (inner.params || []).find(q => (f.params || []).some(p => p.name === q.name));
            if (hidden) throw new Error(`Bare 'super' in '${f.name}' of ${where}: the param '${hidden.name}' of a function inside it hides ${f.name}'s — pass the args: 'super(…)'`);
          }
          if ((f.params || []).some(p => p.rest)) throw new Error(`Bare 'super' in '${f.name}' of ${where}: a rest param isn't passed on as received yet — pass the args: 'super(…)'`);
          const positional = (f.params || []).filter(p => p.positional !== false).map(p => AST.identifier(p.name));
          const named = (f.params || []).filter(p => p.positional === false);
          args = named.length
            ? [...positional, AST.namedArgsBag(Object.fromEntries(named.map(p => [p.key || p.name, AST.identifier(p.name)])))]
            : positional;
        }
        const isPublic = f.name.startsWith('@');
        // In a class block, `super[A]` names the class whose block is the parent block.
        let layer = written.match(/^super\[([^\]]+)\]/)?.[1] ?? null;
        if (layer && U.blockParent && !parents.includes(layer)) {
          const cls = actors.find(a => a.name === layer && a.membersClass === U.blockParent);
          if (cls) layer = U.blockParent;
        }
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, { type: 'BaseCall', layer, name: isPublic ? f.name.slice(1) : f.name, isPublic, args, superCall: written, superIn: f.name });
      });
    }
  }
}

// ── The parse: check and lower each constructor's `super` ──────────────────────

export function lowerSuperCalls(actors, chain) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf;
  const where = (a) => a.membersOf ? `the class block of '${a.membersOf}'` : a.singletonOf ? 'a singleton'
    : a.name ? `'${a.name}'` : 'this file';

  // A constructor overload clause (`Sub << Base ^ *(…) { … }`) is a class of its own.
  const clauses = actors.flatMap(a => (a.functions || []).filter(f => f.actorDef && f.name)
    .map(f => ('name' in f.actorDef ? f.actorDef : Object.defineProperty(f.actorDef, 'name', { value: f.name, configurable: true }))));
  for (const U of [...actors, ...clauses]) {
    const parents = (U.supertypes || []).map(st => st.supertype);
    const calls = [];
    walk(U.initBody, (n, path) => { if (n.type === 'SuperCall') calls.push({ n, path }); });
    walk([U.stateVarDecls], (n) => {
      if (n.type === 'SuperCall') throw new Error(`'${shown(n)}' in ${where(U)} isn't a value: it's a statement of the constructor block`);
    });
    if (!calls.length && !(parents.length && isClass(U) && (U.initParams || []).length)) continue;
    if (calls.length && (!isClass(U) || !parents.length)) {
      throw new Error(`'${shown(calls[0].n)}' in ${where(U)}: 'super' builds the base, and ${isClass(U) ? `'${U.name}' has no parent` : 'it has none'}`);
    }

    // Which parent each call builds. A message shows the call as written.
    for (const c of calls) c.shown = shown(c.n);
    for (const { n } of calls) {
      // A parent in another file stands as its placeholder (src/singleton_classes.js).
      if (n.layer && !parents.includes(n.layer)) {
        const st = (U.supertypes || []).find(t => t.sourceName === n.layer && byName.get(t.supertype)?.remoteStub);
        if (st) n.layer = st.supertype;
      }
      if (n.layer) {
        if (!parents.includes(n.layer)) throw new Error(`'${shown(n)}' in '${U.name}': '${n.layer}' isn't a parent of '${U.name}'`);
      } else if (parents.length > 1) {
        throw new Error(`'${shown(n)}' in '${U.name}' is ambiguous: '${U.name}' has parents ${parents.map(p => `'${p}'`).join(' and ')} — write ${parents.map(p => `'super[${p}](…)'`).join(' and ')}`);
      }
      n.layer ??= parents[0];
    }

    const noBase = [];
    // Once on every path: a statement of the constructor block, never in a loop or a
    // function, never twice.
    for (const c of calls) {
      const { n, path, shown: written } = c;
      if (path.some(p => LOOPS.has(p.type) || isFunctionNode(p))) {
        throw new Error(`'${written}' in '${U.name}' runs once: it can't be in a loop or a function`);
      }
      const ifs = path.filter(p => p.type === 'IfExpr');
      if (ifs.length) {
        const top = ifs[0];
        const callsIn = (b) => { let found = false; walk(b, (m) => { if (m.type === 'SuperCall' && m.layer === n.layer) found = true; }); return found; };
        const branches = [];
        for (let b = top; b; b = b.else?.type === 'IfExpr' ? b.else : null) {
          branches.push(b.then, b.else?.type === 'IfExpr' ? undefined : (b.else ?? null));
        }
        if (branches.filter(b => b !== undefined).some(b => !b || !callsIn(b))) {
          throw new Error(`'${written}' in '${U.name}' is called on one branch of an 'if': an 'if' whose branch calls 'super' needs an 'else' that calls it too`);
        }
        // Each branch calls it once, as a statement of its own body: the base is
        // built there, on the branch taken.
        const direct = (b) => (b.body || []).filter(st => (st.type === 'ExprStatement' || st.type === 'ImplicitReturn') && st.expr?.type === 'SuperCall' && st.expr.layer === n.layer);
        const deep = (b) => { let k = 0; walk(b, (m) => { if (m.type === 'SuperCall' && m.layer === n.layer) k++; }); return k; };
        if (ifs.length > 1 || branches.filter(Boolean).some(b => direct(b).length !== 1 || deep(b) !== 1)) {
          throw new Error(`'${written}' in '${U.name}': in an 'if', each branch calls 'super' once, as a statement of the branch`);
        }
        c.branchStmt = path[0];
        c.branch = [...path].reverse().find(p => p.type === 'IfBranch');
      }
    }
    for (const P of parents) {
      const mine = calls.filter(c => c.n.layer === P);
      const named = parents.length > 1 ? `super[${P}](…)` : 'super';
      // The calls on an 'if''s branches are one: one runs.
      if (new Set(mine.map(c => c.branchStmt ?? c.n)).size > 1) throw new Error(`'${named}' in '${U.name}' is called twice: the base is built once`);
      if (!mine.length) noBase.push(P);
    }
    // No `super` for a parent: no base. The subclass stands in for the parent only if
    // it defines the parent's whole public interface.
    const built = parents.filter(P => !noBase.includes(P));
    for (const P of noBase) {
      const named = parents.length > 1 ? `super[${P}](…)` : 'super(…)';
      const missing = missingInterface(byName, U, byName.get(P), built.map(b => byName.get(b)), chain);
      if (missing.length) {
        throw new Error(`'${U.name}' never calls '${named}', so it has no base for '${P}', and must define the whole public interface of '${P}'; missing: ${missing.join(', ')}`);
      }
      const refs = (U.baseRefs || []).filter(r => r.P === P);
      if (refs.length) {
        throw new Error(`'${refs[0].shown}' in ${refs[0].superIn ? `'${refs[0].superIn}' of ` : ''}'${U.name}': '${U.name}' has no base for '${P}' (it never calls '${named}')`);
      }
    }

    // A base name read before its `super` line.
    const ownNames = new Set([
      ...(U.initParams || []).map(p => p.name),
      ...(U.stateVarDecls || []).filter(d => !d.baseOf).map(d => d.name),
      ...(U.functions || []).filter(f => !f.baseOf).map(f => f.name),
    ]);
    const baseNamesOf = (P) => {
      const pc = chain(byName, P);
      const names = new Map();
      for (const d of [...pc.inheritedState, ...(P.stateVarDecls || []), ...pc.inheritedFunctions, ...(P.functions || [])]) {
        if (typeof d.name === 'string' && !ownNames.has(d.name)) names.set(d.name, d.baseOf ? `base::${d.baseOf}` : d.name);
      }
      for (const d of U.stateVarDecls || []) if (d.baseOf) names.set(d.name, `base::${d.baseOf}`);
      return names;
    };
    const init = U.initBody;
    for (const P of built) {
      const branched = calls.filter(c => c.n.layer === P && c.branchStmt);
      const at = branched.length ? init.indexOf(branched[0].branchStmt) : init.findIndex(s => s.type === 'ExprStatement' && s.expr?.type === 'SuperCall' && s.expr.layer === P);
      const names = baseNamesOf(byName.get(P));
      // Called on an 'if''s branches, the base is built on each, at the call: what
      // runs before it is the lines above the 'if', its conditions, and the
      // branch's own lines above the call.
      const ifsOf = (c) => c.path.filter(p => p.type === 'IfExpr');
      const before = branched.length
        ? [...init.slice(0, at), ...ifsOf(branched[0]).flatMap(f => { const cs = []; for (let b = f; b; b = b.else?.type === 'IfExpr' ? b.else : null) cs.push(b.cond); return cs; }),
          ...branched.flatMap(c => { const body = c.branch.body; const k = body.findIndex(st => st.expr === c.n); return [...body.slice(0, k), c.n.args]; })]
        : [...init.slice(0, at), init[at].expr.args];
      walk(before, (m) => {
        if (isFunctionNode(m)) return false;
        const name = m.type === 'FunctionCallExpr' && m.callee?.type === 'Identifier' ? m.callee.name
          : ['Identifier', 'RefRead', 'RefArg', 'FnRef', 'SetStatement', 'StateAssign'].includes(m.type) ? m.name : null;
        if (name && names.has(name)) {
          throw new Error(`'${names.get(name)}' in '${U.name}' is the base's, read before '${parents.length > 1 ? `super[${P}]` : 'super'}': the base is built at that line`);
        }
      });
    }

    // Lower each call: its args into the parent's param cells, then the marker. The
    // constructor block keeps them as typed bindings, which are checked as any are.
    const lowered = new Map();
    const branchLayers = new Map();
    for (const c of calls) if (c.branchStmt) (branchLayers.get(c.branchStmt) ?? branchLayers.set(c.branchStmt, new Set()).get(c.branchStmt)).add(c.n.layer);
    U.initBody = init.flatMap((s) => {
      // A statement whose 'if' calls 'super' on each branch: each branch binds the
      // parent's params and builds the base, at the call.
      if (branchLayers.has(s)) {
        walk(s, (m) => {
          if (m.type !== 'IfBranch' || !Array.isArray(m.body)) return;
          m.body = m.body.flatMap((st) => {
            if ((st.type !== 'ExprStatement' && st.type !== 'ImplicitReturn') || st.expr?.type !== 'SuperCall') return [st];
            const P = byName.get(st.expr.layer);
            if (P.remoteStub) throw new Error(`'${shown(st.expr)}' in '${U.name}': in an 'if', 'super' builds a parent in this file only`);
            return [...bindArgs(U, P, parentView(byName, P, chain), st.expr.args), { type: 'SuperInit', layer: st.expr.layer }];
          });
        });
        return [s];
      }
      if (s.type !== 'ExprStatement' || s.expr?.type !== 'SuperCall') return [s];
      const { layer, args } = s.expr;
      const P = byName.get(layer);
      const view = parentView(byName, P, chain);
      const binds = bindArgs(U, P, view, args);
      lowered.set(s.expr, binds);
      // A parent in another file: its layer is an actor there, built by \`$new\` with
      // \`as\`, which runs its constructor; this line waits for it
      // (notes/opre-extend-and-as-2026-11-20.md, "Instance layers").
      if (P.remoteStub) {
        const byParam = new Map(view.params.map(p => [p.name, p]));
        const passed = binds.map(b => {
          const p = byParam.get(b.name);
          return { key: p.key, positional: p.positional, ...typeFields(p, 'type'), value: b.value };
        });
        return [{ type: 'ExprStatement', expr: { type: 'RemoteNew', layer, address: P.remoteAddress, args: passed } }];
      }
      return [...binds, { type: 'SuperInit', layer }];
    });
    // A parent with no base: none of its layer is merged (resolveSuperclassChain).
    U.initBody.unshift(...noBase.map(layer => ({ type: 'SuperInit', layer, none: true })));
    U.constructorBody = (U.constructorBody || []).flatMap((s) => {
      const binds = s.type === 'ExprStatement' && lowered.get(s.expr);
      if (!binds) return [s];
      const typeOf = new Map(parentView(byName, byName.get(s.expr.layer), chain).cells.map(c => [c.name, c]));
      return binds.map(b => ({ type: 'TypedAssign', name: b.name, ...typeFields(typeOf.get(b.name), 'typeName'), value: b.value }));
    });
  }
}

// `super(args)`'s args, bound to the parent's params as a call to its `new` binds
// them: by key when named, else by place; a param left out takes its default.
// Bare `super` passes the constructor's own args as they came.
function bindArgs(U, P, view, args) {
  const head = `super${(U.supertypes || []).length > 1 ? `[${P.name}]` : ''}`;
  const call = args === null ? `'${head}' in '${U.name}' (its args as received)` : `'${head}(…)' in '${U.name}'`;
  if (args === null) {
    const bag = {};
    const pos = [];
    for (const p of U.initParams || []) {
      if (p.positional) pos.push(AST.identifier(p.name));
      else bag[p.key || p.name] = AST.identifier(p.name);
    }
    args = [...pos, ...(Object.keys(bag).length ? [AST.namedArgsBag(bag)] : [])];
  }
  const bagNode = args.find(a => a?.type === 'NamedArgsBag');
  const fields = { ...(bagNode?.fields || {}) };
  const positional = args.filter(a => a?.type !== 'NamedArgsBag');
  const posParams = view.params.filter(p => p.positional);
  if (positional.length > posParams.length) {
    throw new Error(`${call}: '${P.name}' takes ${posParams.length} positional arg${posParams.length === 1 ? '' : 's'}, got ${positional.length}`);
  }
  const bound = new Map();
  for (const p of view.params) {
    if (p.key in fields) { bound.set(p, fields[p.key]); delete fields[p.key]; continue; }
    const at = posParams.indexOf(p);
    if (at >= 0 && at < positional.length) bound.set(p, positional[at]);
  }
  const extra = Object.keys(fields);
  if (extra.length) throw new Error(`${call}: '${P.name}' has no param '${extra[0]}'`);
  const out = [];
  for (const p of orderParamsForDefaults(view.params)) {
    let value = bound.get(p);
    if (!value) {
      // A param a parent in another file defaults: its own default, there.
      if (p.remoteOptional) continue;
      if (!p.defaultValue) throw new Error(`${call}: '${P.name}' takes '${p.key}', which isn't passed`);
      value = deepCopy(p.defaultValue);
    }
    out.push(AST.stateAssign(p.name, value, { isRef: !!p.ref }));
  }
  return out;
}
