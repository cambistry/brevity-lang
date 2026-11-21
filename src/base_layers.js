// `base::name`, `base.name`, `base[T]::name`: the parent layer's definition of a name,
// reached within the same actor (notes/class-scope-and-inheritance-2026-11-16.md).
//
// Inheritance is merged and late-bound: a subclass and its parents are one actor, and a
// bare name means the bottom-most definition. `base` is how a layer reaches the one
// below the override.
//
// - A function: the parent layer's clauses are kept under a name nothing in source can
//   spell, in the class that declares them, so they run with that class's scope. The
//   call goes to that name. Calls inside them stay late-bound.
// - A cell: the parent layer's own cell. It is a cell of its own only in an actor whose
//   class (or a class between) redeclares the name; otherwise it is the one cell.
//   That depends on the actor's class, so the parse leaves a hidden cell declared in the
//   class whose code reaches it, and the merge (withInheritedState, src/subclass.js)
//   keeps it, with the parent's initializer, or folds it back into the name.

const BASE_TYPES = new Set(['BaseCall', 'BaseMember', 'BaseSet']);

const walk = (node, visit, parent = null, key = null) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n, i) => walk(n, visit, node, i)); return; }
  if ((node.type === 'Actor' && Array.isArray(node.functions))) return;
  visit(node, parent, key);
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit, node, k);
};
const bodies = (a) => [a.functions, a.initBody, a.constructorBody, a.initParams, a.declarationReturn, a.stateVarDecls];

// A hidden name for layer `L`'s definition of `name`. `@` and a trailing `!`/`.` are
// moved so the result is still a plain identifier with the same suffix.
const classPart = (L) => L.name.replace(/^@/, 'P_').replace(/[!.]$/, '');
export function hiddenName(name, L) {
  const pub = name.startsWith('@');
  const bare = name.replace(/^@/, '');
  const suffix = /[!.]$/.test(bare) ? bare.slice(-1) : '';
  return `${suffix ? bare.slice(0, -1) : bare}__base${pub ? '_pub' : ''}__${classPart(L)}${suffix}`;
}

// A `super` in a function is shown as written (src/super_calls.js).
const shown = (n) => {
  if (n.superCall) return n.superCall;
  const head = n.layer ? `base[${n.layer}]` : 'base';
  return `${head}${n.isPublic ? '.' : '::'}${n.name}`;
};

export function lowerBaseLayers(actors) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf;
  const shownName = (name) => (byName.get(name)?.sourceName ?? name ?? '').replace(/^@/, '').replace(/__pub$/, '').replace(/[!.]$/, '');
  // A parent block by its actor's name, or a class whose block it would be.
  const blockOf = (name) => `the class block of '${shownName(byName.get(name)?.membersOf ?? name)}'`;
  const where = (a) => a.membersOf ? `the class block of '${shownName(a.membersOf)}'` : a.singletonOf ? 'a singleton'
    : a.name ? `'${a.name}'` : 'this file';

  // A name in class `C`'s view: `C`'s own declaration, else its parents', the later
  // parent winning. Returns the class that declares it and what it is.
  const declarer = (C, name, seen = new Set()) => {
    if (!C || seen.has(C)) return null;
    seen.add(C);
    if ((C.functions || []).some(f => f.name === name && !f.actorDef)) return { L: C, kind: 'function' };
    if ((C.stateVarDecls || []).some(d => d.name === name)) return { L: C, kind: 'cell' };
    for (const st of [...(C.supertypes || [])].reverse()) {
      const found = declarer(byName.get(st.supertype), name, seen);
      if (found) return found;
    }
    return null;
  };

  const copied = new Set();
  for (const U of actors) {
    // A node can be reached twice: the constructor block and the init share values.
    const refs = new Set();
    for (const b of bodies(U)) walk(b, (n) => { if (BASE_TYPES.has(n.type)) refs.add(n); });
    if (!refs.size) continue;
    const parents = (U.supertypes || []).map(st => st.supertype);
    // A subclass's class block always has a base: its parent's block, empty when the
    // parent has none. Nothing is in an empty one.
    const emptyBase = !U.blockParent && U.membersOf && (byName.get(U.membersOf)?.supertypes || []).map(st => st.supertype);
    if (emptyBase?.length) {
      const n = [...refs][0];
      const P = n.layer ?? emptyBase[0];
      throw new Error(`'${shown(n)}' in ${n.superIn ? `'${n.superIn}' of ` : ''}${where(U)}: ${blockOf(P)} has no ${n.isPublic ? 'public' : 'protected'} '${n.name}' — '${shownName(P)}' has no class block`);
    }
    // A class block that extends its parent's has that block as its parent layer.
    if (!(isClass(U) || U.blockParent) || !parents.length) {
      const n = [...refs][0];
      const what = n.superCall ? `'super' calls '${n.superIn}' one layer up` : `'base' names a parent layer`;
      throw new Error(`'${shown(n)}' in ${n.superIn ? `'${n.superIn}' of ` : ''}${where(U)}: ${what}, and ${isClass(U) ? `'${U.name}' has no parent` : 'it has none'}`);
    }
    for (const n of refs) {
      if (n.name.startsWith('@') || n.name.startsWith('#')) throw new Error(`'${shown(n)}': after '::' or '.' a name is written bare`);
      const name = n.isPublic ? '@' + n.name : n.name;
      if (n.layer && !parents.includes(n.layer)) {
        throw new Error(`'${shown(n)}' in '${U.name}': '${n.layer}' isn't a direct parent of '${U.name}' — only a direct parent's layer can be named for now`);
      }
      const candidates = n.layer ? [n.layer] : parents;
      const found = [];
      for (const P of candidates) {
        const d = declarer(byName.get(P), name);
        if (d && !found.some(f => f.L === d.L)) found.push({ ...d, P });
      }
      if (!found.length) {
        const what = `${n.isPublic ? 'public' : 'protected'} '${n.name}'`;
        const whose = n.layer || parents.length === 1 ? `${U.blockParent ? blockOf(n.layer ?? parents[0]) : `'${n.layer ?? parents[0]}'`} has no ${what}` : `no parent of '${U.name}' has a ${what}`;
        throw new Error(`'${shown(n)}' in ${n.superIn ? `'${n.superIn}' of ` : ''}${U.blockParent ? where(U) : `'${U.name}'`}: ${whose}`);
      }
      if (found.length > 1) {
        const sep = n.isPublic ? '.' : '::';
        const call = n.type === 'BaseCall' ? '()' : '';
        throw new Error(`'${shown(n)}' in '${U.name}' is ambiguous: ${found.map(f => `'${f.P}'`).join(' and ')} both define '${n.name}' — write ${found.map(f => `'base[${f.P}]${sep}${n.name}${call}'`).join(' or ')}`);
      }
      const { L, kind } = found[0];
      // Which parent each reaches, kept for the check that the class has a base for
      // it (src/super_calls.js).
      if (!Object.hasOwn(U, 'baseRefs')) Object.defineProperty(U, 'baseRefs', { value: [], configurable: true });
      U.baseRefs.push({ P: found[0].P, shown: shown(n), superIn: n.superIn });
      const hidden = hiddenName(name, L);
      if (kind === 'function') {
        // `base.a` is a message, as `x.a` is: a call with no args. `base::h` isn't a value.
        if (n.type === 'BaseSet') throw new Error(`'${shown(n)}' in '${U.name}' is a function, not a cell`);
        if (n.type !== 'BaseCall' && !n.isPublic) throw new Error(`'${shown(n)}' in '${U.name}' is a function: call it, '${shown(n)}()'`);
        // A parent block is a live actor: its function runs there, for this block
        // (a delegated call, src/singleton_classes.js), as `super` there does.
        if (U.blockParent || L.remoteStub) {
          const args = n.args ?? [];
          for (const k of Object.keys(n)) delete n[k];
          Object.assign(n, { type: 'FunctionCallExpr', callee: { type: 'Identifier', name }, args, inheritedCall: 'direct', inheritedFrom: L.name });
          continue;
        }
        if (!copied.has(hidden)) {
          copied.add(hidden);
          const clauses = L.functions.filter(f => f.name === name && !f.actorDef);
          // A copy of a public function is protected: it isn't on the wire.
          L.functions.push(...clauses.map(f => ({ ...structuredClone(f), name: hidden, baseOf: name })));
        }
        const args = n.args ?? [];
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, { type: 'FunctionCallExpr', callee: { type: 'Identifier', name: hidden }, args });
        continue;
      }
      // A cell.
      if (n.type === 'BaseCall') throw new Error(`'${shown(n)}' in '${U.name}' is a cell, not a function`);
      // A parent block's cell is in that block, a live actor: read and written there.
      // So is a cell of a parent layer in another file.
      if (U.blockParent || L.remoteStub) {
        const rest = Object.fromEntries(Object.entries(n).filter(([k]) => !['layer', 'isPublic', 'name', 'type', 'value', 'updateOp', 'superCall', 'superIn'].includes(k)));
        const { value, updateOp } = n;
        const set = n.type === 'BaseSet';
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, set ? { type: 'SetStatement', name, value, ...(updateOp && { updateOp }), viaClass: L.name } : { type: 'Identifier', name, viaClass: L.name, ...rest });
        continue;
      }
      const decl = L.stateVarDecls.find(d => d.name === name);
      Object.defineProperty(decl, 'declaredIn', { value: L.name, configurable: true });
      for (const C of actors) for (const d of C.stateVarDecls || []) {
        if (d.name === name && !d.declaredIn) Object.defineProperty(d, 'declaredIn', { value: C.name, configurable: true });
      }
      if (!(U.stateVarDecls || []).some(d => d.name === hidden)) {
        const h = { ...decl, name: hidden };
        delete h.ingest;
        Object.defineProperty(h, 'baseOf', { value: name });
        Object.defineProperty(h, 'baseLayer', { value: L.name });
        Object.defineProperty(h, 'baseInit', { value: (L.initBody || []).find(s => s.type === 'StateAssign' && s.name === name) ?? null });
        (U.stateVarDecls ??= []).push(h);
      }
      if (n.type === 'BaseMember') {
        const rest = Object.fromEntries(Object.entries(n).filter(([k]) => !['layer', 'isPublic', 'name', 'type'].includes(k)));
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, { type: 'RefRead', name: hidden, ...rest });
      } else {
        const { value, updateOp } = n;
        for (const k of Object.keys(n)) delete n[k];
        Object.assign(n, { type: 'SetStatement', name: hidden, value, ...(updateOp && { updateOp }) });
      }
    }
  }
}

// At the merge: for each hidden cell in an actor's state, whether the parent layer's cell
// is its own (some class at or below the layer's child redeclares the name) or the
// actor's one cell of that name. Returns the decls and init kept, and the renames.
export function settleBaseCells(stateVarDecls, combinedInit) {
  const renames = new Map();
  const kept = [];
  let init = combinedInit;
  for (const d of stateVarDecls) {
    if (!d.baseOf) { kept.push(d); continue; }
    const eff = stateVarDecls.find(e => e.name === d.baseOf);
    if (!eff || eff.declaredIn === d.baseLayer) { renames.set(d.name, d.baseOf); continue; }
    kept.push(d);
    // A parent's body spliced in at a `super` line is a renamed copy: look for it too.
    if (d.baseInit && !init.some(s => s.type === 'StateAssign' && s.name === d.name)) {
      let at = init.indexOf(d.baseInit);
      if (at < 0) at = init.findIndex(s => s.origin === d.baseInit);
      if (at >= 0 && init[at] !== d.baseInit) {
        const copy = { ...structuredClone(init[at]), name: d.name };
        init = [...init.slice(0, at + 1), copy, ...init.slice(at + 1)];
        continue;
      }
      const copy = { ...structuredClone(d.baseInit), name: d.name };
      init = at < 0 ? [copy, ...init] : [...init.slice(0, at + 1), copy, ...init.slice(at + 1)];
    }
  }
  return { stateVarDecls: kept, initBody: init, renames };
}

// A copy of `node` with every string equal to a renamed hidden name replaced.
export function renameHidden(node, renames) {
  if (!renames.size) return node;
  const has = (n) => {
    if (typeof n === 'string') return renames.has(n);
    if (!n || typeof n !== 'object') return false;
    return Array.isArray(n) ? n.some(has) : Object.values(n).some(has);
  };
  const copy = (n) => {
    if (typeof n === 'string') return renames.get(n) ?? n;
    if (!n || typeof n !== 'object' || !has(n)) return n;
    if (Array.isArray(n)) return n.map(copy);
    const out = {};
    for (const [k, v] of Object.entries(n)) out[k] = copy(v);
    return out;
  };
  return copy(node);
}
