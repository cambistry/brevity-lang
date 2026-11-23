// A file's interface, as the compiler reads one (the shape parseInterface gives,
// src/codegen/javascript/types.js), built from the AST, each type both as the file
// writes it (`type`) and encoded (`typeEnc`). src/service_doc.js encodes it as the file's Opre service document
// (notes/opre-type-encoding-2026-11-21.md). Its pieces are also what an extender
// is checked against: the override tables (`settleOverrideTables`).
//
// A synthesized name (a closure's `@0`) is reached through a function value, typed
// where the value is, so it is no op of the service's.

import { purportedFunctions } from './effects.js';
import { resolveSuperclassChain } from './subclass.js';
import { buildsBase } from './super_calls.js';
import { returnShapes } from './return_shapes.js';
import { show, fnReply } from './type_enc.js';

const SYNTHESIZED = /^@(\d+$|__)/;

const untrackedCell = (actor, name) => (actor.stateVarDecls || []).some(d => d.untracked && d.name === name);

function shapeParam(p) {
  // A published type has to have an encoding.
  if (p.typeUnencoded) throw new Error(p.typeUnencoded);
  const optional = !!(p.defaultValue || p.optional);
  return { name: p.positional ? null : (p.key || p.name), type: p.type || 'Anything', typeEnc: p.typeEnc ?? (p.type ? undefined : 'Anything'), positional: !!p.positional, ...(optional && { optional }) };
}

function fnShape(fn, purported) {
  const params = fn.params.map(shapeParam);
  if (fn.body.some(stmt => stmt.type === 'SilentTerminator')) return { params, returns: null, effect: 'write', noReply: true };
  const effect = fn.name.endsWith('!') ? 'write' : purported?.has(fn.name) ? 'purported' : 'read';
  const { alternatives, orSelf } = returnShapes(fn);
  const slots = (alt) => alt.map(({ name, type, typeEnc }) => ({ name, type, typeEnc, positional: name === null }));
  const shapes = alternatives.map(slots);
  return {
    params, returns: shapes[0] ?? null, effect,
    ...(orSelf && { returnsSelf: true }),
    ...(shapes.length > 1 && { returnAlternatives: shapes }),
  };
}

// A reactive cell's getter and setter agree on one type: the cell's.
function reactiveCellType(getter, setter) {
  if (getter.params.length !== 0 || setter.params.length !== 1) return null;
  const reply = getter.body.find(s => s.type === 'Reply');
  if (!reply || reply.fields.length !== 1) return null;
  const [field] = reply.fields;
  const [setParam] = setter.params;
  if (field?.typeEnc === undefined || !field.positional || setParam?.typeEnc === undefined || !setParam.positional) return null;
  return field.typeEnc === setParam.typeEnc ? { type: field.type, typeEnc: field.typeEnc } : null;
}

// A public cell `@name`: its type, and whether it is read-only. Null for anything else.
function cellShape(getters, setters) {
  if (getters.length !== 1 || setters.length > 1) return null;
  const [getter] = getters;
  if (setters.length === 1) {
    const type = reactiveCellType(getter, setters[0]);
    return type ? { ...type, readOnly: false } : null;
  }
  if (!getter.cellGetter) return null;
  const field = getter.body.find(s => s.type === 'Reply')?.fields?.[0];
  return field?.typeEnc !== undefined ? { type: field.type, typeEnc: field.typeEnc, readOnly: true } : null;
}

const addFn = (doc, name, sig, untracked = false) => {
  (doc[name] ??= []).push(sig);
  if (untracked) (doc.__untracked ??= []).push(name);
};
const addField = (doc, name, { type, typeEnc, cell, readOnly }, untracked = false) => {
  (doc[name] ??= []).push({ params: [], returns: [{ name: null, type, typeEnc, positional: true }] });
  (doc.__fields ??= {})[name] = { type, typeEnc, cell, readOnly };
  if (untracked) (doc.__untracked ??= []).push(name);
};
const addSetter = (doc, name, { type, typeEnc }) => {
  (doc.__setters ??= []).push({ name, type, typeEnc });
  (doc.__fields ??= {})[name] = { type, typeEnc, cell: true, writeOnly: true };
};
const own = (doc) => Object.keys(doc).filter(k => !k.startsWith('__'));
const entryNames = (doc) => new Set([...own(doc), ...Object.keys(doc.__fields || {}), ...Object.keys(doc.__services || {})]);

// Copies `from`'s entries whose names `into` doesn't have.
function inherit(into, from) {
  const have = entryNames(into);
  for (const name of entryNames(from)) {
    if (have.has(name)) continue;
    if (from[name]) into[name] = from[name];
    if (from.__fields?.[name]) (into.__fields ??= {})[name] = from.__fields[name];
    if (from.__services?.[name]) (into.__services ??= {})[name] = from.__services[name];
    if (from.__untracked?.includes(name)) (into.__untracked ??= []).push(name);
    for (const st of from.__setters || []) if (st.name === name) (into.__setters ??= []).push(st);
  }
  return into;
}

// A silent-function field is named with its silent `.` (stored without it).
const typeDeclShape = (decl) => ({
  fields: (decl.fields || []).map(f => (fnReply(f.paramTypeEnc) === 'silent' && f.named ? { ...f, name: `${f.name}.` } : f)),
});

// The types declared in a class's constructor block.
const ownTypes = (ast, actor) => (ast.types || []).filter(t => t.ownerClass && (t.ownerClass === actor.name || t.ownerClass === actor.sourceName));

// The public singleton `@name` declared directly in `owner` (src/parser.js), if any.
const singletonIn = (ast, owner, name) =>
  ast.actors.find(a => a.singletonOf === name && (a.enclosing ?? null) === (owner.name ?? null));

// An actor's public members: an autogenerated `@name` getter and `set@name` setter
// are a cell; one overload per signature.
function publicMembersShape(ast, actor, purportedByActor, doc = {}) {
  const purported = purportedByActor.get(actor);
  const grouped = new Map();
  for (const fn of actor.functions) {
    if (!fn.name || SYNTHESIZED.test(fn.name)) continue;
    const isGetter = fn.name.startsWith('@');
    const isSetter = fn.name.startsWith('set@');
    if (!isGetter && !isSetter) continue;
    const bare = fn.name.replace(/^set@|^@/, '');
    if (!grouped.has(bare)) grouped.set(bare, { getters: [], setters: [] });
    (isGetter ? grouped.get(bare).getters : grouped.get(bare).setters).push(fn);
  }
  for (const [bare, { getters, setters }] of grouped) {
    const cell = cellShape(getters, setters);
    if (cell) { addField(doc, bare, { ...cell, cell: true }, untrackedCell(actor, '@' + bare)); continue; }
    const singleton = getters.length === 1 && singletonIn(ast, actor, '@' + bare);
    if (singleton) { (doc.__services ??= {})[bare] = singletonShape(ast, singleton, purportedByActor); continue; }
    for (const fn of getters) addFn(doc, bare, fnShape(fn, purported), !!fn.untracked);
    for (const fn of setters) addSetter(doc, bare, { type: fn.params[0]?.type || 'Anything', typeEnc: fn.params[0]?.typeEnc ?? (fn.params[0]?.type ? undefined : 'Anything') });
  }
  return doc;
}

// A public singleton, or a class block: a document of its own.
function singletonShape(ast, cls, purportedByActor) {
  const doc = {};
  for (const decl of ownTypes(ast, cls)) (doc.__typeDecls ??= {})[decl.bareName ?? decl.name] = typeDeclShape(decl);
  if (!cls.membersOf) return publicMembersShape(ast, cls, purportedByActor, doc);
  return blockShape(ast, cls, purportedByActor, doc);
}

// A class block's extension doc: its public members and its protected ones (what
// an extender may use and override), composite over the blocks it extends. With
// `own`, its own only. See notes/opre-extend-and-as-2026-11-20.md ("The extension doc").
function blockShape(ast, block, purportedByActor, doc = {}, { own: ownOnly = false } = {}) {
  const view = ownOnly ? { ...block, functions: (block.functions || []).filter(f => !f.inheritedFrom), blockParent: null, remoteBase: null } : block;
  blockPublicShape(ast, view, purportedByActor, doc);
  const prot = protectedShape(ast, view, purportedByActor);
  if (entryNames(prot).size) doc.__protected = prot;
  return doc;
}

function blockPublicShape(ast, block, purportedByActor, doc = {}) {
  publicMembersShape(ast, { ...block, functions: (block.functions || []).filter(f => !f.inheritedFrom) }, purportedByActor, doc);
  const parent = block.blockParent && ast.actors.find(a => a.name === block.blockParent);
  if (parent) inherit(doc, blockPublicShape(ast, parent, purportedByActor));
  else if (block.remoteBase) inherit(doc, { ...block.remoteBase.doc, __protected: undefined, __types: undefined, __typeDecls: undefined });
  return doc;
}

// A block's protected functions and cells, composite over the blocks it extends.
function protectedMembers(ast, block) {
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const accessorCell = (f) => f.cellGetter || /^(?:set|update|subscribe)[@.#]/.test(f.name ?? '');
  const fns = new Map();
  const cells = new Map();
  for (let b = block; b; b = b.blockParent ? byName.get(b.blockParent) : null) {
    const here = new Map();
    for (const f of b.functions || []) {
      if (typeof f.name !== 'string' || /^[@#]/.test(f.name) || f.inheritedFrom || f.baseOf || f.actorDef || accessorCell(f) || f.name.includes('__')) continue;
      if (!fns.has(f.name) && !cells.has(f.name)) (here.get(f.name) ?? here.set(f.name, []).get(f.name)).push(f);
    }
    for (const [name, clauses] of here) fns.set(name, clauses);
    for (const d of b.stateVarDecls || []) {
      if (typeof d.name !== 'string' || /^[@#]/.test(d.name) || d.baseOf || d.name.includes('__')) continue;
      if (!fns.has(d.name) && !cells.has(d.name)) cells.set(d.name, d);
    }
  }
  return { fns, cells };
}

// Then what a parent block in another file gives it, by that file's document.
function protectedShape(ast, block, purportedByActor) {
  const { fns, cells } = protectedMembers(ast, block);
  const purported = purportedByActor.get(block);
  const doc = {};
  for (const d of cells.values()) addField(doc, `~${d.name}`, { type: d.typeName || 'Anything', typeEnc: d.typeNameEnc ?? (d.typeName ? undefined : 'Anything'), cell: true, readOnly: !d.isRef });
  for (const [name, clauses] of fns) for (const f of clauses) addFn(doc, `~${name}`, fnShape(f, purported));
  let top = block;
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  while (top.blockParent && byName.get(top.blockParent)) top = byName.get(top.blockParent);
  if (top.remoteBase?.doc.__protected) inherit(doc, top.remoteBase.doc.__protected);
  return doc;
}

// What a class's instances present to an extender: their public and protected
// members, composite (own, then inherited), published params as public fields.
// With `own`, its own only.
function instanceMembers(ast, cls, { own: ownOnly = false } = {}) {
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const chain = ownOnly ? { inheritedFunctions: [], inheritedState: [], inheritedParams: [] } : resolveSuperclassChain(byName, cls);
  const ownNames = new Set((cls.functions || []).map(f => f.name));
  const functions = [...chain.inheritedFunctions.filter(f => !ownNames.has(f.name)), ...(cls.functions || [])]
    .filter(f => typeof f.name === 'string' && !f.actorDef && !f.baseOf && !f.name.includes('__'));
  const ownCells = new Set((cls.stateVarDecls || []).map(d => d.name));
  const cells = [...(cls.stateVarDecls || []), ...chain.inheritedState.filter(d => !ownCells.has(d.name))]
    .filter(d => typeof d.name === 'string' && !d.baseOf && !d.name.includes('__') && !d.name.startsWith('#'));
  const params = [...chain.inheritedParams, ...(cls.initParams || [])].filter(p => p.accessor);
  return { functions, cells, params };
}

function instanceProtectedShape(ast, cls, purportedByActor, opts) {
  const { functions, cells } = instanceMembers(ast, cls, opts);
  const purported = purportedByActor.get(cls);
  const isAccessor = (f) => f.cellGetter || /^(set|update|subscribe|new)[@.#]/.test(f.name);
  // A cell holding an actor of a dependency is typed Actor, as any actor value is.
  const deps = new Set((ast.dependencies || []).map(d => d.name));
  const typeOf = (d) => (!d.typeName ? 'Anything' : deps.has(d.typeName) ? 'Actor' : d.typeName);
  const typeEncOf = (d) => (d.typeName && deps.has(d.typeName) ? 'Actor' : d.typeNameEnc ?? (d.typeName ? undefined : 'Anything'));
  const doc = {};
  for (const d of cells.filter(d => !d.name.startsWith('@'))) addField(doc, `~${d.name}`, { type: typeOf(d), typeEnc: typeEncOf(d), cell: true, readOnly: !d.isRef });
  for (const f of functions.filter(f => !/^[@#]/.test(f.name) && !isAccessor(f))) addFn(doc, `~${f.name}`, fnShape(f, purported));
  return doc;
}

// A class's instances, flat: public members and protected ones, as their node
// presents them once their parents' are merged in.
function instanceShape(ast, cls, purportedByActor, opts = {}) {
  const { functions, params } = instanceMembers(ast, cls, opts);
  const doc = {};
  for (const p of params) addField(doc, p.accessor.replace(/^@/, ''), { type: p.type || 'Anything', typeEnc: p.typeEnc ?? (p.type ? undefined : 'Anything'), cell: false, readOnly: true });
  publicMembersShape(ast, { ...cls, functions }, purportedByActor, doc);
  const prot = instanceProtectedShape(ast, cls, purportedByActor, opts);
  if (entryNames(prot).size) doc.__protected = prot;
  return doc;
}

// A private superclass has no node of its own to inherit from, so a public class
// states what it inherits from one in place, with its own members winning.
function withPrivateSupers(actor, privateClasses, purportedByActor) {
  const supertypes = [];
  const params = [];
  const initParams = [];
  const functions = [];
  const purported = new Set();
  for (const st of actor.supertypes || []) {
    const parent = privateClasses.get(st.supertype);
    if (!parent) {
      supertypes.push(st);
      continue;
    }
    const flat = withPrivateSupers(parent, privateClasses, purportedByActor);
    supertypes.push(...flat.supertypes);
    // A class with a constructor of its own takes none of its parent's params; the
    // parent's published ones still read as fields.
    const taken = buildsBase(actor) ? flat.initParams.filter(p => p.accessor) : flat.initParams;
    if (!buildsBase(actor)) params.push(...flat.params);
    initParams.push(...taken);
    functions.push(...flat.functions);
    for (const name of flat.purported) purported.add(name);
  }
  const ownNames = new Set((actor.functions || []).map(f => f.name));
  const ownParams = new Set((actor.params || []).map(p => p.name));
  const ownInit = new Set((actor.initParams || []).map(p => p.name));
  for (const name of ownNames) purported.delete(name);
  for (const name of purportedByActor.get(actor) || []) purported.add(name);
  return {
    supertypes,
    params: [...params.filter(p => !ownParams.has(p.name)), ...(actor.params || [])],
    initParams: [...initParams.filter(p => !ownInit.has(p.name)), ...(actor.initParams || [])],
    functions: [...functions.filter(f => !ownNames.has(f.name)), ...(actor.functions || [])],
    purported,
  };
}

function classShape(ast, actor, privateClasses, purportedByActor) {
  const name = (actor.sourceName ?? actor.name).replace(/^@/, '');
  const flat = withPrivateSupers(actor, privateClasses, purportedByActor);
  // A parent as it's written (`@G`, `T`), which is how its address resolves.
  const supertypes = flat.supertypes.map(st => ({ supertype: st.sourceName ?? st.supertype }));
  const ownNew = !supertypes.length || flat.params.length > 0 || buildsBase(actor);
  const inst = {};
  for (const p of flat.initParams) if (p.accessor) addField(inst, p.accessor, { type: p.type || 'Anything', typeEnc: p.typeEnc ?? (p.type ? undefined : 'Anything'), cell: false, readOnly: true });
  const setterOf = (fnName) => flat.functions.filter(f => f.name === 'set' + fnName);
  for (const fn of flat.functions.filter(f => f.name?.startsWith('@') && !SYNTHESIZED.test(f.name))) {
    const bare = fn.name.replace(/^@/, '');
    const cell = cellShape([fn], setterOf(fn.name));
    if (cell) { addField(inst, bare, { ...cell, cell: true }); continue; }
    const singleton = singletonIn(ast, actor, fn.name);
    if (singleton) { (inst.__services ??= {})[bare] = singletonShape(ast, singleton, purportedByActor); continue; }
    addFn(inst, bare, fnShape(fn, flat.purported));
  }
  const functions = own(inst).flatMap(n => inst[n].map(sig => ({ name: n, ...sig })));
  const setters = Object.entries(inst.__fields || {}).filter(([, f]) => f.cell && !f.readOnly).map(([n, f]) => ({ name: n, type: f.type, typeEnc: f.typeEnc }));
  const typeDecls = Object.fromEntries(ownTypes(ast, actor).map(d => [d.bareName ?? d.name, typeDeclShape(d)]));
  // Every actor is extensible for now: its instances' protected members are
  // published too, composite (notes/opre-extend-and-as-2026-11-20.md).
  const instanceProtected = instanceProtectedShape(ast, actor, purportedByActor);
  const members = actor.membersClass ? ast.actors.find(a => a.name === actor.membersClass) : null;
  return [name, {
    effect: name.endsWith('!') ? 'write' : 'read',
    supertypes,
    initParams: flat.params.map(shapeParam),
    functions,
    setters,
    ...(inst.__services && { services: inst.__services }),
    ...(inst.__fields && { fields: inst.__fields }),
    ...(Object.keys(typeDecls).length && { typeDecls }),
    ...(members && { members: singletonShape(ast, members, purportedByActor) }),
    ...(ownNew && supertypes.length && { ownNew: true }),
    ...(entryNames(instanceProtected).size && { instanceProtected }),
  }];
}

// The functions whose read-only claim rests on a `~>`, by actor: from inline
// interfaces and `remoteDocs` (by dependency path).
function purported(ast, remoteDocs) {
  const byName = Object.fromEntries((ast.dependencies || []).filter(d => d.path && remoteDocs[d.path]).map(d => [d.name, remoteDocs[d.path]]));
  return purportedFunctions(ast, byName);
}

// The file's interface. Its `as` clauses are what its `$as` converts it to.
export function serviceShape(ast, remoteDocs = {}) {
  const purportedByActor = purported(ast, remoteDocs);
  const privateClasses = new Map(ast.actors.filter(a => a.name && !a.name.startsWith('@')).map(a => [a.name, a]));
  const doc = {};
  for (const decl of ast.types || []) if (!decl.ownerClass) (doc.__typeDecls ??= {})[decl.bareName ?? decl.name] = typeDeclShape(decl);
  for (const actor of ast.actors) {
    if (actor.name?.startsWith('@')) {
      const [name, cls] = classShape(ast, actor, privateClasses, purportedByActor);
      (doc.__types ??= {})[name] = cls;
      continue;
    }
    // A private class isn't part of the file's surface.
    if (actor.name) continue;
    // The file's published params read as read-only fields.
    for (const p of actor.initParams || []) if (p.accessor) addField(doc, p.accessor, { type: p.type || 'Anything', typeEnc: p.typeEnc ?? (p.type ? undefined : 'Anything'), cell: false, readOnly: true });
    publicMembersShape(ast, actor, purportedByActor, doc);
    const asClauses = (actor.asClauses || []).filter(c => !c.negated);
    if (asClauses.length) {
      doc.__asTypes = [...(doc.__asTypes || []), ...asClauses.map(c => c.targetType)];
      doc.__asTypesEnc = [...(doc.__asTypesEnc || []), ...asClauses.map(c => c.targetTypeEnc)];
    }
  }
  return doc;
}

// ── Override tables ──────────────────────────────────────────────────────────

// The parent's public and protected names a block overrides (a function) or
// redeclares (a cell), in the parent's terms: wire names, `~` on protected ones.
// Built from the parent block's extension doc, never its source, so a parent known
// only by its doc is the same case. A clash with the parent's declaration is the
// child's compile error.
export function settleOverrideTables(ast) {
  const purportedByActor = purportedFunctions(ast);
  const byName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const shown = (name) => (byName.get(name)?.sourceName ?? name ?? '').replace(/^@/, '').replace(/__pub$/, '');
  const docNames = (doc) => [...own(doc), ...own(doc.__protected || {})];
  // What each block declares, by wire name: what a `$extend` to it may name. And
  // what each class's instances declare, for the `instance` section.
  for (const block of ast.actors) {
    if (!block.membersOf) continue;
    const doc = blockShape(ast, block, purportedByActor);
    Object.defineProperty(block, 'extensionNames', { value: docNames(doc), configurable: true, enumerable: false });
  }
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf && !a.remoteStub;
  for (const cls of ast.actors.filter(isClass)) {
    const doc = instanceShape(ast, cls, purportedByActor);
    Object.defineProperty(cls, 'instanceNames', { value: docNames(doc), configurable: true, enumerable: false });
  }
  for (const block of ast.actors) {
    if (!block.blockParent) continue;
    const parent = byName.get(block.blockParent);
    // A parent in another file is known by its published doc only.
    const theirs = parent ? blockShape(ast, parent, purportedByActor) : block.remoteBase?.doc;
    if (!theirs) continue;
    const mine = blockShape(ast, block, purportedByActor, {}, { own: true });
    const where = `the class block of '${shown(block.membersOf)}'`;
    const parentWhere = parent ? `the class block of '${shown(parent.membersOf)}'` : `the class block of '${(block.remoteBase.address.split(':').pop())}' (in '${block.remoteBase.address.split(':')[0]}')`;
    const table = overrides(mine, theirs, where, parentWhere);
    Object.defineProperty(block, 'overrideTable', { value: { block: table }, configurable: true, enumerable: false });
  }
  // The `instance` section: for each parent, its instances' names that the class's
  // instances supply in place of its own: what the class declares, and what a later
  // parent supplies (the later parent winning).
  // A parent in another file, by its doc's entry: its instances' doc.
  const remoteInstanceDoc = (entry) => {
    const doc = {};
    for (const f of entry.functions || []) (doc[f.name] ??= []).push({ params: f.params || [], returns: f.returns ?? null, effect: f.effect });
    if (entry.fields) doc.__fields = entry.fields;
    if (entry.instanceProtected) doc.__protected = entry.instanceProtected;
    return doc;
  };
  for (const cls of ast.actors.filter(isClass)) {
    if (!cls.remoteLayers?.length) continue;
    const mine = instanceShape(ast, cls, purportedByActor, { own: true });
    const tables = {};
    for (const L of cls.remoteLayers) {
      const addr = L.address.split(':');
      tables[L.name] = overrides(mine, remoteInstanceDoc(L.doc), `'${shown(cls.name)}'`, `'${addr.pop()}' (in '${addr.join(':')}')`);
      // A parent there with a class block: our block's `$extend` to it speaks for the
      // class, carrying the section, in place of a handshake of its own.
      const block = cls.membersClass ? byName.get(cls.membersClass) : null;
      if (block?.remoteBase?.address === L.address) {
        L.viaBlock = true;
        if (block.overrideTable && tables[L.name].length) block.overrideTable.instance = tables[L.name];
      }
    }
    Object.defineProperty(cls, 'instanceTables', { value: tables, configurable: true, enumerable: false });
  }
  for (const cls of ast.actors.filter(isClass)) {
    const parents = (cls.supertypes || []).map(st => byName.get(st.supertype)).filter(p => p && isClass(p));
    if (!parents.length) continue;
    const mine = instanceShape(ast, cls, purportedByActor, { own: true });
    const tables = { ...(cls.instanceTables || {}) };
    parents.forEach((P, i) => {
      const theirs = instanceShape(ast, P, purportedByActor);
      const table = overrides(mine, theirs, `'${shown(cls.name)}'`, `'${shown(P.name)}'`);
      const theirNames = new Set(docNames(theirs));
      for (const later of parents.slice(i + 1)) {
        for (const n of later.instanceNames || []) if (theirNames.has(n) && !table.includes(n)) table.push(n);
      }
      tables[P.name] = table;
    });
    Object.defineProperty(cls, 'instanceTables', { value: tables, configurable: true, enumerable: false });
    // A class block's `$extend` speaks for the class: it carries the section for the
    // class whose block it extends.
    const block = cls.membersClass ? byName.get(cls.membersClass) : null;
    const parentBlock = block?.blockParent ? byName.get(block.blockParent) : null;
    const instance = parentBlock ? tables[parentBlock.membersOf] : null;
    if (block?.overrideTable && instance?.length) block.overrideTable.instance = instance;
  }
}

// Two encoded types in a signature agree: the same, or either one unknown.
const sameType = (a, b) => a === undefined || b === undefined || a === b || a === 'Anything' || b === 'Anything';

// The parent's public and protected names that `mine` overrides (a function) or
// redeclares (a cell), in the parent's terms, checked against the parent's doc.
function overrides(mine, theirs, where, parentWhere) {
  const table = [];
  const shownType = (t) => show(t);
  const check = (label, source, my, their) => {
    if (!their) return;
    // A prop (a published param) is read as an op; a function may stand in for it.
    // Its type is the accessor rule's to check (src/validate.js).
    if (their.field && !their.field.cell) { table.push(label); return; }
    const myCell = !!my.field;
    const theirCell = !!their.field;
    if (myCell !== theirCell) {
      throw new Error(`'${source}' in ${where} is a ${myCell ? 'cell' : 'function'}, and in ${parentWhere}, which it extends, '${source}' is a ${theirCell ? 'cell' : 'function'}`);
    }
    if (myCell) {
      if (!sameType(my.field.typeEnc, their.field.typeEnc)) {
        throw new Error(`'${source}' in ${where} is a ${shownType(my.field.typeEnc)}, and in ${parentWhere}, which it extends, a ${shownType(their.field.typeEnc)}`);
      }
    } else {
      for (const sig of my.sigs) {
        const match = their.sigs.find(t => t.params.length === sig.params.length);
        if (!match) {
          const arities = [...new Set(their.sigs.map(t => t.params.length))].join(' or ');
          throw new Error(`'${source}' in ${where} takes ${sig.params.length} arg${sig.params.length === 1 ? '' : 's'}, and in ${parentWhere}, which it extends, ${arities}`);
        }
        sig.params.forEach((p, i) => {
          const q = match.params[i];
          if (!sameType(p.typeEnc, q.typeEnc)) throw new Error(`'${source}' in ${where}: its arg ${i + 1} is a ${shownType(p.typeEnc)}, and in ${parentWhere}, which it extends, a ${shownType(q.typeEnc)}`);
        });
        const [r, q] = [sig.returns, match.returns];
        if (r && q && (r.length !== q.length || r.some((x, i) => !sameType(x.typeEnc, q[i].typeEnc)))) {
          const fmt = (xs) => `(${xs.map(x => shownType(x.typeEnc)).join(', ')})`;
          throw new Error(`'${source}' in ${where} replies ${fmt(r)}, and in ${parentWhere}, which it extends, ${fmt(q)}`);
        }
      }
    }
    table.push(label);
  };
  const entry = (doc, name) => doc[name] ? { sigs: doc[name], field: doc.__fields?.[name] } : null;
  for (const name of own(mine)) check(name, '@' + name, entry(mine, name), entry(theirs, name));
  const prot = (doc, name) => (doc.__protected?.[name] ? { sigs: doc.__protected[name], field: doc.__protected.__fields?.[name] } : null);
  for (const name of own(mine.__protected || {})) check(name, name.slice(1), prot(mine, name), prot(theirs, name));
  return table;
}
