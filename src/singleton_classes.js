import { returnShapes } from './return_shapes.js';
import { isUnion } from './type_enc.js';
import { typeText } from './codegen/enc_names.js';
import { readDocument } from './service_doc.js';
import { _opre_quote as quoteToken } from './codegen/opre_tokens.js';
import { wireLabel as wireLabelOf } from './codegen/wire_labels.js';
import { lowerActorValues } from './actor_values.js';
// Class singletons: a class whose class block holds members of its own.
//
//   Nested:   C = actor { count *Integer = 0; new = (seed Integer) *{ … } }
//   Layered:  C = (seed Integer) *{ … } ^ { count *Integer = 0 }
//
// Either way the members are a singleton, kept in the declaring actor's cell
// `C__class`, and `C` is an ordinary class of the declaring actor: `C()` builds
// one, its actors are `C:n` on the wire under it, and their `ty` names `C`. What
// differs is the constructor's lexical scope:
//
// - Nested: the constructor block is inside the singleton, so it closes over it,
//   private cells included. The class's `enclosing` is the singleton (what it
//   reads, writes and calls); `home` is the actor that declares it (where it is
//   built and published). Every target puts the singleton at the head of the
//   chain of actors a new actor reads from.
// - Trailing: the constructor block isn't inside the singleton, so its scope skips
//   it. It reaches the members through their published interface, as any client
//   does: `C.count` reads `@count` of `C__class`.
//
// In the singleton, `new(args)` builds the class: it is `C(args)`. `new` names
// only that, so it is reserved everywhere else.
// See notes/class-singleton-forms-2026-11-13.md.

// These lowerings run in the parse, before its types are encoded (src/parser_types.js):
// a node takes a declaration's encoded type when it's asked for.
const encodedLater = (node, key, decl, declKey) => Object.defineProperty(node, key, {
  get: () => decl[declKey], enumerable: true, configurable: true,
});

// `class` as the parser leaves it: `class` is reserved, so no other name is spelled so.
// Resolved here to the class of the actor it's in.
export const CLASS_SELF = 'class';

// `class::base` as the parser leaves it (src/parser.js, foldSelfClass): the running
// class's parent. Nothing in source can spell it.
export const CLASS_BASE = 'class::base';

// The class of a file that declares `new =`. Nothing in source can name it.
export const FILE_CLASS = 'new__file';

// The label an actor is published at in the actor that builds it, sigil and all
// (`@s`), or null: a public singleton's, or a public class's members, which are
// reached at the class's label (`:C:count`; `$new` to `:C` still builds a `C`).
export function publicLabel(actor) {
  if (actor?.singletonOf?.startsWith('@')) return actor.singletonOf;
  return actor?.publishedAs ? '@' + actor.publishedAs : null;
}

const NOT_IN_SINGLETON ="'new' makes a singleton a class, so it goes inside one: 'C = actor { … new = (params) *{ … } }'";

// An empty class block for \`a\`, as the parser makes one for \`^ { }\`: an actor, its
// singleton, and the cell holding it in the actor \`a\` is declared in, built just
// after the parent's block (\`parentBlock\`'s cell) so it can register there.
function addImplicitBlock(actors, byName, a, parentBlock) {
  const bare = a.name.replace(/^[@#]/, '');
  const blockName = `${bare}_singleton`;
  const cell = `${bare}__class`;
  const declarer = actors.find(x => (x.name ?? null) === (a.enclosing ?? null));
  const make = () => ({ type: 'FunctionCallExpr', callee: { type: 'Identifier', name: blockName }, args: [] });
  declarer.stateVarDecls.push({ name: cell, typeName: blockName, typeNameEnc: `:${quoteToken(blockName)}:*`, typeFromCallee: true, isRef: false });
  const place = (body, st) => {
    if (!body) return;
    const at = body.findIndex(x => x.name === parentBlock?.singletonOf);
    body.splice(at + 1, 0, st);
  };
  place(declarer.initBody, { type: 'StateAssign', name: cell, value: make() });
  place(declarer.constructorBody, { type: 'TypedAssign', name: cell, typeName: null, value: make() });
  const block = { type: 'Actor', name: blockName, params: [], functions: [], stateVarDecls: [], initBody: [], constructorBody: [], initParams: [], asClauses: [], supertypes: [], declarationReturn: null, singletonOf: cell, membersOf: a.name, ...(a.enclosing !== undefined && { enclosing: a.enclosing }) };
  Object.defineProperty(block, 'implicitBlock', { value: true, configurable: true, enumerable: false });
  actors.push(block);
  byName.set(blockName, block);
  a.membersClass = blockName;
}

export function lowerSingletonClasses(actors, types = [], { fileKind = 'singleton' } = {}) {
  // Whether `X::name` names a type declared in actor `X` (no member shares its name).
  const isType = (owners, name) => types.some(t => t.name === name && owners.includes(t.ownerClass));
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const declarer = (name) => actors.find(a => (a.name ?? null) === (name ?? null));

  // A file's `new =`: the file is the singleton, so its class is a class of
  // the file, closing over the file's members as any of its classes does.
  const fileNew = actors.find(a => a.name === 'new' && a.fileNew);
  if (fileNew) {
    fileNew.name = FILE_CLASS;
    byName.set(FILE_CLASS, fileNew);
  }

  for (const cls of actors.filter(a => a.name === 'new')) {
    const members = byName.get(cls.enclosing);
    if (!members?.singletonOf || members.membersOf) throw new Error(NOT_IN_SINGLETON);
    const className = members.singletonOf;
    if (byName.has(className)) throw new Error(`Class '${className}' is declared more than once`);
    cls.name = className;
    for (const a of actors) if (a.enclosing === 'new' && a.enclosingBody === cls.functions) a.enclosing = className;
    cls.membersClass = members.name;
    cls.home = members.enclosing ?? null;
    members.membersOf = className;
    byName.set(className, cls);
    const cell = `${className.replace(/^[@#]/, '')}__class`;
    renameCell(declarer(members.enclosing), className, cell);
    members.singletonOf = cell;
    // Kept without its `@`: renamePublicClasses renames every `@C` it finds.
    if (className.startsWith('@')) members.publishedAs = className.slice(1);
    // `new(args)` in the singleton is `C(args)`.
    renameCalls(members, 'new', className);
  }

  // A class's block, if it has one. An implicit one (below) is transparent to a
  // block that extends through it: that block's base is the nearest written one.
  const ownBlock = (a) => a?.membersClass ? a : null;
  const blockOf = (a, seen = new Set()) => {
    if (!a || seen.has(a)) return null;
    seen.add(a);
    if (ownBlock(a) && !byName.get(a.membersClass)?.implicitBlock) return a;
    const found = [...new Set((a.supertypes || [])
      .map(st => blockOf(byName.get(st.supertype), seen)).filter(Boolean))];
    if (found.length > 1) throw new Error(`'${shownName(a)}' has more than one parent with a class block ('${found.map(shownName).join("', '")}'), and which one it uses isn't settled yet`);
    return found[0] ?? null;
  };
  // A class with no class block of its own has an empty one, as if it wrote `^ { }`
  // (`C = () *{}` makes an empty class singleton): notional, no actor, unless a parent
  // has a block, which is then its base, here or in another file
  // (notes/implicit-class-block-2026-11-21.md).
  for (const a of actors.filter(a => a.name && (a.supertypes || []).length && !a.membersClass && !a.membersOf && !a.singletonOf && !a.remoteStub)) {
    const parent = blockOf(a);
    if (!parent) continue;
    const parentHome = 'home' in parent ? parent.home : parent.enclosing ?? null;
    if ((a.enclosing ?? null) !== (parentHome ?? null)) {
      throw new Error(`'${shownName(a)}' extends '${shownName(parent)}', which has a class block, and is declared somewhere else than it — that isn't supported yet`);
    }
    addImplicitBlock(actors, byName, a, byName.get(parent.membersClass));
  }
  // A subclass with a class block of its own extends its nearest parent's block by
  // delegation (notes/class-scope-and-inheritance-2026-11-16.md): the block's actor
  // takes the parent block's functions as a parent layer, late-bound, and is declared
  // inside the parent block, so a cell it doesn't redeclare is the parent block's one
  // cell, read and written there. A cell it redeclares is its own, and the parent's
  // code running for it uses that. The parent block's initializers don't run again.
  for (const a of actors.filter(a => ownBlock(a) && (a.supertypes || []).length)) {
    const found = [...new Set(a.supertypes.map(st => blockOf(byName.get(st.supertype))).filter(Boolean))];
    if (found.length > 1) throw new Error(`'${shownName(a)}' has more than one parent with a class block ('${found.map(shownName).join("', '")}'), and which one it extends isn't settled yet`);
    if (!found.length) continue;
    const block = byName.get(a.membersClass);
    const parentBlock = byName.get(found[0].membersClass);
    const homeOfBlock = (b) => ('home' in b ? b.home : b.enclosing) ?? null;
    if (homeOfBlock(block) !== homeOfBlock(parentBlock)) {
      throw new Error(`'${shownName(a)}' extends '${shownName(found[0])}', which has a class block, and is declared somewhere else than it — that isn't supported yet`);
    }
    block.supertypes = [{ supertype: parentBlock.name, delegated: true }];
    block.blockParent = parentBlock.name;
    block.home = block.enclosing ?? null;
    block.enclosing = parentBlock.name;
  }
  // The class whose block code in `a` reaches: its own, or its nearest parent's.
  const blockClassOf = (a) => ownBlock(a);
  // Whether `a` is in `cls`'s family: a subclass of it, at any depth.
  const extendsClass = (a, cls, seen = new Set()) => {
    if (!a || seen.has(a)) return false;
    seen.add(a);
    return (a.supertypes || []).some(st => st.supertype === cls.name || extendsClass(byName.get(st.supertype), cls, seen));
  };

  // `class::base` follows the running class.
  lowerClassBase(actors, byName, extendsClass);
  // `class` (and `self::class`) names the class of the actor it's in.
  for (const a of actors) resolveClassOf(a, blockClassOf, fileKind);
  // A declared actor as a value, and a name bound to one (src/actor_values.js).
  lowerActorValues(actors, byName);

  for (const cls of actors.filter(a => a.membersClass)) {
    const members = byName.get(cls.membersClass);
    // Trailing: its actors still have the members first in their chain, so they can
    // message them as from inside the class, but no bare name reaches them.
    if (!('home' in cls)) {
      cls.home = cls.enclosing ?? null;
      cls.enclosing = members.name;
      cls.membersOpaque = true;
    }
    if (cls.name.startsWith('@')) members.publishedAs = cls.name.slice(1);
    // Inside the class, in either form, `C.count` reaches the members from inside:
    // the class's actors and the classes declared in them.
    // A class named `C!` is referred to as `C` (src/parser.js, settleBangDecls, runs later).
    const spellings = [...new Set([cls.name, cls.name.replace(/[!.]$/, '')])];
    // Its family: the class, its subclasses that use its block, and the classes
    // declared in either. (A subclass with a block of its own reaches this one's public
    // members as anyone does; its `::` is the error below.)
    // A subclass whose own block extends this one's (by delegation) has it in its chain too.
    const blockExtends = (a) => {
      for (let b = byName.get(a.membersClass); b; b = b.blockParent ? byName.get(b.blockParent) : null) if (b.blockParent === cls.membersClass) return true;
      return false;
    };
    const reaches = (a) => a === cls || (extendsClass(a, cls) && blockExtends(a));
    const family = (a) => reaches(a) || [...actors].some(f => f !== a && reaches(f) && isInside(a, f.name, byName));
    for (const a of actors) if (family(a)) for (const n of spellings) lowerMemberAccess(a, n, members, isType, byName);
    // `C.count` reads the members; `C(…)` still builds a `C`.
    for (const a of actors) for (const n of spellings) renameReceivers(a, n, members.singletonOf);
  }

  // A write in a constructor block to a name that isn't a `*` cell in scope. The
  // parser couldn't tell yet whether it names a member of a trailing class block.
  // A trailing constructor block's bare write to a class-block member is the same
  // scope error, reported before anything else can complain about the write.
  for (const a of actors) {
    // A class's own block, or for one with no block of its own, the nearest written
    // one its implicit block's base chain reaches: a member declared there.
    const ownMembers = a.membersOpaque ? byName.get(a.membersClass) : null;
    let members = ownMembers;
    while (members?.implicitBlock && members.blockParent && byName.get(members.blockParent)) members = byName.get(members.blockParent);
    const own = new Set([...(a.stateVarDecls || []), ...(a.initParams || [])].map(d => d.name));
    const memberCell = (name) => members && !own.has(name) && memberNames(members).cells.has(name);
    const notClosedOver = (name) => {
      const cls = members !== ownMembers ? shownName(byName.get(members.membersOf) ?? { name: members.membersOf }) : a.name.replace(/^@/, '').replace(/[!.]$/, '');
      const reach = name.startsWith('@') ? `: reach it as '${cls}.${name.slice(1)}'` : '';
      const outside = members !== ownMembers ? `a subclass of '${cls}'` : 'a trailing constructor';
      return new Error(`'${name}' is a member of the class '${cls}', and ${outside} doesn't close over its class block${reach}`);
    };
    for (const b of [a.initBody, a.constructorBody]) walk(b, (n) => {
      if (n.type === 'SetStatement' && !n.viaClass && memberCell(n.name)) throw notClosedOver(n.name);
    });
    for (const b of bodies(a)) walk(b, (n) => {
      if (n.type === 'SetStatement' && n.deferredError) throw memberCell(n.name) ? notClosedOver(n.name) : new Error(n.deferredError);
    });
  }

  // A protected member reached from outside its class's family, or `::` on something
  // that has no class block.
  for (const a of actors) checkQualified(a, byName, extendsClass, isType);

  // What's left of `new(args)` builds the file's class.
  if (fileNew) for (const a of actors) renameCalls(a, 'new', FILE_CLASS);

  for (const a of actors) {
    if ((a.functions || []).some(f => f.name === 'new') || (a.stateVarDecls || []).some(d => d.name === 'new')) {
      throw new Error(NOT_IN_SINGLETON);
    }
    if (callsNew(a)) throw new Error(`'new(…)' builds the class of the singleton it's in, and '${a.name ?? 'this file'}' isn't one with 'new'`);
  }
}


// A class block extending its parent's isn't declared inside it: it is declared in its
// home, and holds the parent block as its base. A cell of an ancestor block's that the
// block doesn't redeclare is read and written at the base, as `$get` / `$set` of its
// wire name (`~count`), with the block as `from`: the base answers it, or forwards it
// to its own base. Each use is marked as an outer read (or an `OuterSet`) with
// `outerBase`, which the targets send to the base instead of up the chain. `base::x`
// (and `A::x` in the block) is the same read: the parent's cell, whatever the block
// redeclares. The cells a block inherits are its `forwardCells`: it answers them for
// its own family and its extenders, by forwarding them to its base.
// See notes/opre-extend-and-as-2026-11-20.md ("$extend", "In Brevity").
export function lowerInheritedBlockCells(actors) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const shownName = (a) => (a.sourceName ?? a.name ?? '').replace(/^@/, '').replace(/__pub$/, '').replace(/[!.]$/, '');
  const ancestors = (block) => {
    const out = [];
    for (let b = byName.get(block.blockParent); b; b = b.blockParent ? byName.get(b.blockParent) : null) out.push(b);
    return out;
  };
  const SCALAR = new Set(['Integer', 'Text', 'Boolean', 'Decimal', 'Float']);
  // A class whose parent is in another file reaches its layer the same way: the
  // parent's placeholder is its base (addRemoteParents).
  const remoteParents = (a) => (a.supertypes || []).map(st => byName.get(st.supertype)).filter(p => p?.remoteStub && !p.membersOf);
  for (const block of actors.filter(a => a.blockParent || (!a.membersOf && remoteParents(a).length))) {
    const up = block.blockParent ? ancestors(block) : remoteParents(block);
    const upNames = new Set(up.map(b => b.name));
    const own = new Set((block.stateVarDecls || []).map(d => d.name));
    const inherited = new Map();
    const privates = new Map();
    for (const b of up) for (const d of b.stateVarDecls || []) {
      if (typeof d.name !== 'string' || own.has(d.name) || d.name.includes('__')) continue;
      if (d.name.startsWith('#')) { if (!privates.has(d.name)) privates.set(d.name, b); continue; }
      if (!inherited.has(d.name)) inherited.set(d.name, { decl: d, owner: b.name });
    }
    if (block.blockParent) block.enclosing = block.home ?? null;
    Object.defineProperty(block, 'forwardCells', { value: [...inherited].map(([name, { decl }]) => ({ name, typeName: decl.typeName ?? null, get typeNameEnc() { return decl.typeNameEnc; }, isRef: !!decl.isRef })), configurable: true });
    // The cell a use names: an inherited one, or (`base::x`, `A::x`) an ancestor's.
    const resolve = (node, bound) => {
      if (typeof node.name !== 'string') return null;
      if (node.viaClass) {
        if (!upNames.has(node.viaClass)) return null;
        const found = inherited.get(node.name);
        if (found) return found;
        // The base's own cell, where the block redeclares it.
        for (const b of up) {
          const d = (b.stateVarDecls || []).find(e => e.name === node.name);
          if (d) return { decl: d, owner: b.name };
        }
        return null;
      }
      if (bound.has(node.name)) return null;
      const priv = privates.get(node.name);
      if (priv) throw new Error(`'${node.name}' is private to the class block of '${shownName(byName.get(priv.membersOf) ?? priv)}', and the class block of '${shownName(byName.get(block.membersOf) ?? block)}', which extends it, can't reach it`);
      return inherited.get(node.name) ?? null;
    };
    const mark = (node, found) => {
      delete node.viaClass;
      Object.assign(node, { outer: true, outerBase: true, outerLevel: 1, outerClass: found.owner, outerParam: false, outerType: found.decl.typeName ?? null });
      encodedLater(node, 'outerTypeEnc', found.decl, 'typeNameEnc');
      return node;
    };
    const visit = (node, bound) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, bound)); return; }
      if (node.type === 'Actor' && Array.isArray(node.functions)) return;
      if (node.type === 'FunctionDecl' || node.type === 'Function' || node.type === 'SubscribeCall') {
        bound = new Set([...bound, ...(node.params || []).map(p => p?.name).filter(Boolean)]);
      }
      if (node.type === 'ForStatement' && node.name) bound = new Set([...bound, node.name]);
      if (Array.isArray(node.body)) {
        const locals = node.body.filter(st => (st?.type === 'Assign' || st?.type === 'TypedAssign' || st?.type === 'RefDecl') && typeof st.name === 'string').map(st => st.name);
        if (locals.length) bound = new Set([...bound, ...locals]);
      }
      if ((node.type === 'Identifier' || node.type === 'RefRead') && !node.outerBase) {
        const found = resolve(node, bound);
        if (found) { mark(node, found); return; }
      }
      if (node.type === 'SetStatement') {
        const found = resolve(node, bound);
        if (found) {
          if (!found.decl.isRef) throw new Error(`Cannot set '${node.name}' — it's a cell of the class block of '${shownName(byName.get(byName.get(found.owner)?.membersOf) ?? { name: found.owner })}' that isn't '*', so it can't be set`);
          const { name, value, updateOp } = node;
          for (const k of Object.keys(node)) if (k !== 'loc') delete node[k];
          node.type = 'ExprStatement';
          const type = found.decl.typeName ?? null;
          node.expr = { type: 'OuterSet', name, value, updateOp: SCALAR.has(type) ? null : updateOp ?? null, outerLevel: 1, outerBase: true, outerClass: found.owner, outerType: type };
          encodedLater(node.expr, 'outerTypeEnc', found.decl, 'typeNameEnc');
          visit(value, bound);
          return;
        }
      }
      if (node.type === 'Reply' || node.type === 'Return') {
        node.fields = (node.fields || []).map(f => {
          if (f.positional && !f.expr && !f.value && typeof f.name === 'string') {
            const found = resolve({ name: f.name }, bound);
            if (found) { const { name, ...rest } = f; return { ...rest, positional: true, expr: mark({ type: 'Identifier', name }, found) }; }
          }
          if (typeof f.sigil === 'string' && !f.expr && !f.value) {
            const found = resolve({ name: f.sigil }, bound);
            if (found) { const { sigil, ...rest } = f; delete rest.ref; return { ...rest, key: sigil.replace(/^[@#]/, ''), value: mark({ type: 'Identifier', name: sigil }, found) }; }
          }
          return f;
        });
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') visit(v, bound);
    };
    for (const f of block.functions || []) visit(f, new Set());
    for (const b of [block.initBody, block.constructorBody, block.declarationReturn]) visit(b, new Set());
    for (const p of block.initParams || []) if (p.defaultValue) visit(p.defaultValue, new Set());
  }
}

// A parent class from another file (`B = A ^ { … }` with `A` from `use`), known only by
// its published doc: its class block is a remote actor at `<dependency>:A`. For the
// parse, it stands as a placeholder pair of actors, the class and its block, built from
// the doc's `^ { … }` section (public and `~` protected members), so a block extending
// it is lowered as for a local parent; then the placeholders go, and what the child
// needs of its parent is kept on its block (`remoteBase`). Nothing is generated for
// them. See notes/opre-extend-and-as-2026-11-20.md.
export function addRemoteParents(actors, dependencies, remotes) {
  const stubs = [];
  if (!remotes?.length) return stubs;
  const used = new Map();
  for (const d of dependencies || []) {
    if (d.type !== 'Dependency' || !d.path) continue;
    const doc = remotes.find(r => r.path === d.path)?.service;
    if (!doc) continue;
    for (const ds of d.destructures || []) used.set(ds.local ?? ds.name, { path: d.path, remote: ds.remote ?? ds.name, doc });
  }
  const local = new Set(actors.filter(a => a.name).map(a => a.name));
  for (const [name, info] of used) {
    if (local.has(name) || !actors.some(a => (a.supertypes || []).some(st => st.supertype === name))) continue;
    const parsed = readDocument(info.doc, info.path);
    const cls = parsed?.__types?.[info.remote];
    if (!cls) continue;
    const members = cls.members;
    const stubName = `${name}__remote`;
    const address = `${quoteToken(info.path)}:${quoteToken(info.remote)}`;
    const stubClass = { type: 'Actor', name: stubName, functions: [], stateVarDecls: [], initBody: [], constructorBody: [], initParams: [], supertypes: [], remoteStub: true, remoteAddress: address, remoteDoc: cls };
    Object.defineProperty(stubClass, 'sourceName', { value: name, configurable: true });
    // Its `new`'s params, by the doc: a published one is a prop (`n Integer`).
    const props = new Set(Object.entries(cls.fields || {}).filter(([, f]) => !f.cell).map(([n]) => n));
    stubClass.initParams = (cls.initParams || []).map((p, i) => ({
      name: p.name ?? `p${i}`, key: p.name ?? `p${i}`, type: p.type, typeEnc: p.typeEnc, positional: p.positional !== false,
      ...(p.optional && { remoteOptional: true }), ...(p.name && props.has(p.name) && { accessor: p.name }),
    }));
    if (cls.ownNew) stubClass.ownNew = true;
    const publicFns = {};
    for (const f of cls.functions || []) if (!props.has(f.name)) (publicFns[f.name] ??= []).push(f);
    // A published param is read as an op, \`n\`: its layer answers it.
    for (const n of props) stubClass.functions.push({ type: 'FunctionDecl', name: '@' + n, params: [], body: [] });
    fillStub(stubClass, publicFns, Object.fromEntries(Object.entries(cls.fields || {}).filter(([, f]) => f.cell)), cls.instanceProtected || {});
    stubs.push(stubClass);
    if (members) {
      const block = { type: 'Actor', name: `${stubName}_block`, functions: [], stateVarDecls: [], initBody: [], constructorBody: [], initParams: [], supertypes: [], singletonOf: `${name}__class`, remoteStub: true, remoteAddress: address, remoteDoc: members };
      const sigs = Object.fromEntries(Object.entries(members).filter(([n]) => !n.startsWith('__')));
      fillStub(block, sigs, members.__fields || {}, members.__protected || {});
      stubClass.membersClass = block.name;
      block.membersOf = stubName;
      stubs.push(block);
    }
    for (const a of actors) for (const st of a.supertypes || []) {
      if (st.supertype === name) { st.supertype = stubName; st.sourceName ??= name; }
    }
  }
  actors.push(...stubs);
  // A diamond of instance layers isn't supported yet: two parents that extend one
  // class would each build their own layer of it (the note's "Several parents").
  for (const a of actors) {
    const remote = (a.supertypes || []).map(st => stubs.find(x => x.name === st.supertype && !x.membersOf)).filter(Boolean);
    if (remote.length < 2) continue;
    const seen = new Map();
    for (const P of remote) for (const anc of (P.remoteDoc?.supertypes || []).map(st => st.supertype)) {
      if (seen.has(anc)) throw new Error(`'${(a.sourceName ?? a.name).replace(/^@/, '')}' extends '${seen.get(anc)}' and '${P.sourceName}', which both extend '${anc}': a diamond of instance layers isn't supported yet`);
      seen.set(anc, P.sourceName);
    }
  }
  return stubs;
}

// A placeholder's members, by its doc: public functions and cells, and protected
// ones (`~`). Bodies are empty: nothing is generated for it.
function fillStub(stub, publicSigs, fields, prot) {
  const fn = (n, sig) => ({ type: 'FunctionDecl', name: n, params: (sig.params || []).map((p, i) => ({ name: `p${i}`, type: p.type, positional: p.positional !== false })), body: [], remoteReturns: sig.returns ?? null });
  for (const [n, sigs] of Object.entries(publicSigs)) {
    if (n.startsWith('__')) continue;
    const field = fields[n];
    if (field) {
      stub.stateVarDecls.push({ type: 'StateVarDecl', name: '@' + n, typeName: field.type, typeNameEnc: field.typeEnc, isRef: !field.readOnly });
      stub.functions.push({ ...fn('@' + n, { params: [], returns: sigs[0]?.returns }), cellGetter: true });
    } else for (const sig of sigs) stub.functions.push(fn('@' + n, sig));
  }
  for (const [n, sigs] of Object.entries(prot)) {
    if (n.startsWith('__')) continue;
    const bare = n.replace(/^~/, '');
    const f = prot.__fields?.[n];
    if (f) stub.stateVarDecls.push({ type: 'StateVarDecl', name: bare, typeName: f.type, typeNameEnc: f.typeEnc, isRef: !f.readOnly });
    else for (const sig of sigs) stub.functions.push(fn(bare, sig));
  }
}

// The placeholders go once the parse has lowered the blocks extending them; each
// child block keeps its remote parent's address and doc.
export function dropRemoteParents(actors, stubs) {
  if (!stubs.length) return;
  const gone = new Set(stubs.map(s => s.name));
  for (const a of actors) {
    if (!a.blockParent || !gone.has(a.blockParent)) continue;
    const base = stubs.find(s => s.name === a.blockParent);
    a.remoteBase = { address: base.remoteAddress, doc: base.remoteDoc };
  }
  // A supertype that names one is in another file: a class extends it only through
  // its block for now (instance layers aren't built yet).
  for (const a of actors) {
    const remote = (a.supertypes || []).filter(st => gone.has(st.supertype));
    if (!remote.length) continue;
    Object.defineProperty(a, 'remoteSupertypes', { value: remote, configurable: true });
    // Its layers in another file, one per parent there that it builds with \`super\`
    // (no \`super\`, no layer).
    const built = new Set((a.initBody || []).filter(st => st.type === 'ExprStatement' && st.expr?.type === 'RemoteNew').map(st => st.expr.layer));
    if (!a.membersOf && built.size) {
      a.remoteLayers = remote.filter(st => built.has(st.supertype)).map(st => {
        const stub = stubs.find(x => x.name === st.supertype);
        return { name: stub.name, sourceName: st.sourceName, address: stub.remoteAddress, doc: stub.remoteDoc };
      });
    }
    a.supertypes = a.supertypes.filter(st => !gone.has(st.supertype));
  }
  for (let i = actors.length - 1; i >= 0; i--) if (gone.has(actors[i].name)) actors.splice(i, 1);
}

// The \`ty\` a function's reply is tagged with, when it has one shape of plain types:
// \`['Integer']\`, \`[{ a: 'Integer' }]\`. A placeholder's function has its doc's returns.
// Read once types are encoded (src/parser_types.js).
export function replyTy(fn) {
  const slots = fn.remoteReturns ? fn.remoteReturns.map(r => ({ name: r.name, typeEnc: r.typeEnc }))
    : (() => { const { alternatives, orSelf, opaque } = returnShapes(fn); return alternatives.length === 1 && !orSelf && !opaque ? alternatives[0] : null; })();
  if (!slots?.length || slots.some(x => x.typeEnc === undefined || x.typeEnc === 'Anything' || isUnion(x.typeEnc))) return null;
  const text = (x) => typeText(x.typeEnc);
  const pos = slots.filter(x => !x.name).map(text);
  const named = slots.filter(x => x.name);
  return named.length ? [...pos, Object.fromEntries(named.map(x => [x.name, text(x)]))] : pos;
}

// Delegation (notes/opre-extend-and-as-2026-11-20.md, "as: a delegated call"): a class
// block's functions aren't copied into the blocks that extend it. A block's call of a
// function it inherits is a delegated call to its base (`inheritedCall`: 'late', or
// 'direct' for `super` / `base::h()`, which skips the block's own overrides); a call
// for a name it doesn't define goes there too. The base runs its own definition for
// the caller's context, and each public or protected name it reaches resolves through
// that context's override table. So a block's function body marks the cells it reads
// and writes that an extender may redeclare (`ctxCell`, the wire name); its calls of
// its own functions resolve at run time. The functions a block inherits are its
// `forwardFns`, by source name.
export function lowerBlockDelegation(actors) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const isAccessor = (f) => typeof f.name !== 'string' || /^(set|update|subscribe|new)[@.#]/.test(f.name);
  // Every actor is extensible for now: a class block, and a published class, whose
  // instances may be built as a layer for a class in another file. A class whose
  // parent is in another file delegates to its layer.
  const remoteParents = (a) => (a.supertypes || []).map(st => byName.get(st.supertype)).filter(p => p?.remoteStub && !p.membersOf);
  const publishedClass = (a) => typeof a.name === 'string' && a.name.startsWith('@') && !a.singletonOf && !a.membersOf;
  for (const block of actors.filter(a => !a.remoteStub && (a.membersOf || publishedClass(a) || remoteParents(a).length))) {
    const ownFns = new Set((block.functions || []).map(f => f.name));
    const inherited = new Map();
    for (const p of block.membersOf ? [] : remoteParents(block)) {
      for (const f of p.functions || []) {
        if (isAccessor(f) || f.name.startsWith('#') || ownFns.has(f.name) || inherited.has(f.name)) continue;
        inherited.set(f.name, p.name);
      }
    }
    for (let b = block.membersOf ? byName.get(block.blockParent) : null; b; b = b.blockParent ? byName.get(b.blockParent) : null) {
      for (const f of b.functions || []) {
        if (isAccessor(f) || f.name.startsWith('#') || f.baseOf || f.actorDef || ownFns.has(f.name) || inherited.has(f.name)) continue;
        inherited.set(f.name, b.name);
      }
    }
    Object.defineProperty(block, 'forwardFns', { value: [...inherited.keys()], configurable: true });
    // What each one replies, tagged: a call for it that the base answers is tagged so.
    // Its types are read when they're encoded, after the parse.
    Object.defineProperty(block, 'inheritedTys', {
      get: () => Object.fromEntries([...inherited].map(([n, owner]) => {
        const decls = (byName.get(owner)?.functions || []).filter(f => f.name === n);
        return [wireLabelOf(n), decls.length === 1 ? replyTy(decls[0]) : null];
      }).filter(([, t]) => t)),
      configurable: true, enumerable: false,
    });
    // Which parent each inherited function is from: its layer, for a class with two.
    if (!block.membersOf) block.inheritedOwners = Object.fromEntries([...inherited].map(([n, owner]) => [wireLabelOf(n), owner]));
    const ownCells = new Set((block.stateVarDecls || []).map(d => d.name).filter(n => typeof n === 'string' && !n.startsWith('#') && !n.includes('__')));
    const visit = (node, bound) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, bound)); return; }
      if (node.type === 'Actor' && Array.isArray(node.functions)) return;
      if (node.type === 'FunctionDecl' || node.type === 'Function' || node.type === 'SubscribeCall') {
        bound = new Set([...bound, ...(node.params || []).map(p => p?.name).filter(Boolean)]);
      }
      if (node.type === 'ForStatement' && node.name) bound = new Set([...bound, node.name]);
      if (Array.isArray(node.body)) {
        const locals = node.body.filter(st => (st?.type === 'Assign' || st?.type === 'TypedAssign' || st?.type === 'RefDecl') && typeof st.name === 'string').map(st => st.name);
        if (locals.length) bound = new Set([...bound, ...locals]);
      }
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && !bound.has(node.callee.name)) {
        const name = node.callee.name;
        if (!node.inheritedCall && !ownFns.has(name) && inherited.has(name)) {
          node.inheritedCall = 'late';
          node.inheritedFrom = inherited.get(name);
        }
      }
      if ((node.type === 'Identifier' || node.type === 'RefRead') && typeof node.name === 'string' && !bound.has(node.name)
          && !node.viaClass && (node.outerBase || ownCells.has(node.name))) {
        node.ctxCell = wireLabelOf(node.name);
        return;
      }
      // A write to one of its own cells: an extender may redeclare it, so it's made
      // through the cell's own `$set`, or at the extender (src/codegen/*).
      if (node.type === 'SetStatement' && ownCells.has(node.name) && !bound.has(node.name)) {
        const decl = block.stateVarDecls.find(d => d.name === node.name);
        const type = decl.typeName ?? null;
        if (node.updateOp === '<|' && !['Integer', 'Text', 'Boolean', 'Decimal', 'Float'].includes(type)) {
          throw new Error(`'${node.name} <|' in a function of a class block isn't supported yet: write '${node.name} <- …'`);
        }
        const { name, value } = node;
        visit(value, bound);
        for (const k of Object.keys(node)) if (k !== 'loc') delete node[k];
        node.type = 'ExprStatement';
        node.expr = { type: 'OuterSet', name, value, updateOp: null, outerLevel: 0, outerSelf: true, outerType: type, ctxCell: wireLabelOf(name) };
        encodedLater(node.expr, 'outerTypeEnc', decl, 'typeNameEnc');
        return;
      }
      if (node.type === 'OuterSet' && node.outerBase) node.ctxCell = wireLabelOf(node.name);
      if (node.type === 'Reply' || node.type === 'Return') {
        node.fields = (node.fields || []).map(f => {
          if (f.positional && !f.expr && !f.value && typeof f.name === 'string' && ownCells.has(f.name) && !bound.has(f.name)) {
            const { name, ...rest } = f;
            return { ...rest, positional: true, expr: { type: 'Identifier', name } };
          }
          if (typeof f.sigil === 'string' && !f.expr && !f.value && ownCells.has(f.sigil) && !bound.has(f.sigil)) {
            const { sigil, ...rest } = f;
            delete rest.ref;
            return { ...rest, key: sigil.replace(/^[@#]/, ''), value: { type: 'Identifier', name: sigil } };
          }
          return f;
        });
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') visit(v, bound);
    };
    // A cell's accessors and the block's constructor run as the block itself.
    for (const f of block.functions || []) if (!isAccessor(f) && !f.cellGetter) visit(f, new Set());
    // Its initializers call what it inherits as itself.
    const calls = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(calls); return; }
      if (node.type === 'Actor' && Array.isArray(node.functions)) return;
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && !node.inheritedCall && !ownFns.has(node.callee.name) && inherited.has(node.callee.name)) {
        node.inheritedCall = 'late';
        node.inheritedFrom = inherited.get(node.callee.name);
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') calls(v);
    };
    for (const b of [block.initBody, block.constructorBody, block.declarationReturn]) calls(b);
  }
}

// `class::base` is the running class's parent (Ruby's self.class.superclass): in `T`'s
// code running for a `U`, it's `T`. Each use becomes a call to a protected function
// of its own, which the class and each class under it define against their own parent,
// so the running class's definition answers (notes/super-2026-11-19.md):
//
//   class::base::h(a)   P::h(a)      class::base.f(a)   P.f(a)
//   class::base::x      P::x         class::base.x      P.x
//   class::base(a)      P(a)         class::base        P
export function lowerClassBase(actors, byName, extendsClass) {
  const isClass = (a) => a.name && !a.singletonOf && !a.membersOf;
  const isBase = (o) => o?.type === 'Identifier' && o.name === CLASS_BASE;
  const bodiesOf = (a) => [a.functions, a.initBody, a.constructorBody, a.declarationReturn];
  let site = 0;
  const parentOf = (C, user) => {
    const parents = (C.supertypes || []).map(st => st.supertype);
    const shownC = shownName(C);
    if (!parents.length) throw new Error(`'class::base' in '${shownName(user)}': it's the running class's parent, and '${shownC}' has no parent`);
    if (parents.length > 1) {
      throw new Error(`'class::base' in '${shownName(user)}': '${shownC}' has parents ${parents.map(p => `'${shownName(byName.get(p) ?? { name: p })}'`).join(' and ')} — write the parent's name`);
    }
    return parents[0];
  };
  for (const X of actors) {
    const sites = [];
    for (const b of bodiesOf(X)) walk(b, (n) => {
      if (isBase(n) || (n.type === 'TypeConstruction' && n.qualifier?.[0] === CLASS_BASE)) sites.push(n);
      for (const k of ['object', 'callee']) if (isBase(n[k])) sites.push(n);
    });
    if (!sites.length) continue;
    if (!isClass(X)) throw new Error(`'class::base' in ${X.membersOf ? `the class block of '${shownName(byName.get(X.membersOf) ?? { name: X.membersOf })}'` : X.singletonOf ? 'a singleton' : 'this file'}: it names the parent of the class of an actor built by a class, and this one isn't`);
    // Each use once, outermost first: `class::base.f()` is one use, not two.
    const seen = new Set();
    const family = actors.filter(a => isClass(a) && (a === X || extendsClass(a, X)));
    for (const n of sites) {
      if (seen.has(n)) continue;
      seen.add(n);
      if (n.object) seen.add(n.object);
      if (n.callee) seen.add(n.callee);
      // The use as a template over the parent's name, and the args it passes.
      let args = [];
      let make;
      if (n.type === 'TypeConstruction') {
        args = n.args || [];
        make = (P, xs) => ({ ...n, qualifier: [P, ...n.qualifier.slice(1)], args: xs });
      } else if (n.type === 'FunctionCallExpr' && isBase(n.callee)) {
        args = n.args || [];
        make = (P, xs) => ({ ...n, callee: { ...n.callee, name: P }, args: xs });
      } else if (n.type === 'DotCallExpr' && isBase(n.object)) {
        args = n.args || [];
        make = (P, xs) => ({ ...n, object: { ...n.object, name: P }, args: xs });
      } else if (isBase(n.object)) {
        make = (P) => ({ ...n, object: { ...n.object, name: P } });
      } else if (isBase(n)) {
        make = (P) => ({ ...n, name: P });
      } else {
        throw new Error("'class::base' here isn't supported yet: reach the parent's members as 'class::base::name', 'class::base.name' or 'class::base(…)'");
      }
      const name = `classbase__${site++}`;
      // Params for what the use passes: positional ones by place, named ones by key.
      const params = [];
      const passed = args.map((a, i) => {
        if (a?.type === 'NamedArgsBag') {
          const fields = {};
          for (const k of Object.keys(a.fields)) { const p = `${name}_${k}`; params.push({ name: p, positional: false, key: k }); fields[k] = AST_IDENT(p); }
          return { type: 'NamedArgsBag', fields };
        }
        if (a && typeof a === 'object' && 'positional' in a && a.positional === false) {
          const p = `${name}_${a.name}`; params.push({ name: p, positional: false, key: a.name });
          return { ...a, expr: AST_IDENT(p) };
        }
        const p = `${name}_${i}`; params.push({ name: p, positional: true });
        return a && typeof a === 'object' && 'expr' in a && a.positional ? { ...a, expr: AST_IDENT(p) } : AST_IDENT(p);
      });
      // The call to it passes them the same way: positional values, then the named
      // ones in a bag.
      const named = {};
      const callArgs = [];
      for (const a of args) {
        if (a?.type === 'NamedArgsBag') Object.assign(named, a.fields);
        else if (a && typeof a === 'object' && 'positional' in a && a.positional === false) named[a.name] = a.expr ?? AST_IDENT(a.name);
        else callArgs.push(a && typeof a === 'object' && 'expr' in a && a.positional ? a.expr : a);
      }
      if (Object.keys(named).length) callArgs.push({ type: 'NamedArgsBag', fields: named });
      for (const C of family) {
        const P = parentOf(C, X);
        (C.functions ||= []).push({ type: 'FunctionDecl', name, params: params.map(p => ({ ...p })), body: [{ type: 'ImplicitReturn', expr: structuredClone(make(P, passed)), typeName: null }] });
      }
      for (const k of Object.keys(n)) if (k !== 'loc') delete n[k];
      Object.assign(n, { type: 'FunctionCallExpr', callee: AST_IDENT(name), args: callArgs });
    }
  }
}
const AST_IDENT = (name) => ({ type: 'Identifier', name });

// The declaring actor's cell holding the singleton, `C` or `@C`, becomes `C__class`.
// A published one loses its getter: `@C` is the class now.
function renameCell(owner, from, to) {
  if (!owner) return;
  for (const list of [owner.stateVarDecls, owner.initBody, owner.constructorBody]) {
    for (const s of list || []) if (s.name === from) s.name = to;
  }
  owner.functions = (owner.functions || []).filter(f => !(f.name === from && f.body?.[0]?.type === 'Reply'));
}

const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, visit)); return; }
  visit(node);
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') walk(v, visit);
};
const bodies = (a) => [a.functions, a.initBody, a.constructorBody, a.initParams, a.declarationReturn];

function renameCalls(actor, from, to) {
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === from) n.callee = { ...n.callee, name: to };
  });
}

// `C.count` is a read of the members; `C(…)` builds a `C` (the parser saw the
// singleton's cell first, so a call may name it as a ref).
function renameReceivers(actor, from, to) {
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'RefRead' && n.callee.name === from) n.callee = { type: 'Identifier', name: from };
    const obj = n.type === 'QualifiedMember' ? null : n.object;
    if (obj && (obj.type === 'Identifier' || obj.type === 'RefRead') && obj.name === from) {
      n.object = { ...obj, name: to };
      // A member read is a call to the member's published getter: `C.count` asks
      // the members' actor for `count`.
      if (n.type === 'DotAccessExpr') {
        n.type = 'DotCallExpr';
        n.method = n.property;
        n.args = [];
        delete n.property;
      }
    }
    if (n.objectName === from && !n.protected) n.objectName = to;
  });
}

// Whether `actor` is declared, at any depth, inside class `name`'s constructor.
function isInside(actor, name, byName) {
  for (let at = byName.get(actor.enclosing); at; at = byName.get(at.enclosing)) if (at.name === name) return true;
  return false;
}

// `class` (and `self::class`, which the parser folds into it) is the class of the actor
// it's in: as a receiver (`class.count`, `class::total`): the class whose block
// the code reaches, its own or its nearest parent's. Anywhere else it is the class
// itself: `class(args)` builds one, as `C(args)` does, and `k = class` is its address.
function resolveClassOf(actor, blockClassOf, fileKind) {
  // A factory file (a `*` header) is built by its host: in its own code `class` is
  // the file's kind, `Self` internally, so `class(args)` builds another.
  const factoryFile = !actor.name && fileKind === 'factory';
  const where = () => actor.membersOf ? 'a class block' : actor.singletonOf ? 'a singleton' : 'this file';
  const isClass = actor.name && !actor.singletonOf && !actor.membersOf && actor.name !== FILE_CLASS;
  const notAClass = () => new Error(`'class' in ${where()}: it names the class of an actor built by a class, and this one isn't`);
  const receiver = () => {
    if (!isClass) throw notAClass();
    const cls = blockClassOf(actor);
    if (!cls) throw new Error(`'class': '${shownName(actor)}' has no class block, and nor do its parents, so there are no class members to reach`);
    return cls.name;
  };
  const isClassId = (o) => o?.type === 'Identifier' && o.name === CLASS_SELF;
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'ActorFieldSet' && n.objectName === CLASS_SELF) { n.objectName = receiver(); n.objectWritten = 'class'; }
    if (isClassId(n.object) && !(n.type === 'DotCallExpr' && n.method === 'new')) n.object = { ...n.object, name: receiver(), written: 'class' };
    if (n.type === 'TypeConstruction' && n.qualifier?.[0] === CLASS_SELF) {
      n.qualifier = [receiver(), ...n.qualifier.slice(1)];
      n.qualifierWritten = 'class';
    }
  });
  for (const b of bodies(actor)) walk(b, (n) => {
    if (isClassId(n)) {
      if (factoryFile) { n.name = 'class'; return; }
      if (!isClass) throw notAClass();
      n.name = actor.name;
    }
  });
}

const shownName = (a) => (a.sourceName ?? a.name ?? '').replace(/^@/, '').replace(/__pub$/, '').replace(/[!.]$/, '');

// `C::x` left once every class's family is lowered: `C` has a class block and this
// isn't its family, or `C` has none.
function checkQualified(actor, byName, extendsClass, isType) {
  const classOf = (name) => {
    const c = byName.get(name);
    return c && !c.singletonOf && !c.membersOf ? c : null;
  };
  const fail = (recv, name, call = '') => {
    const c = classOf(recv);
    const shown = c ? shownName(c) : recv;
    if (c?.membersClass && extendsClass(actor, c)) {
      return new Error(`'${shown}::${name}${call}' — '${shownName(actor)}' has a class block of its own, and reaching a parent's protected members from it isn't supported yet`);
    }
    if (c?.membersClass) return new Error(`'${shown}::${name}${call}' — a protected member of '${shown}' is reached only from its family: its actors and its subclasses' actors`);
    if (c) return new Error(`'${shown}::${name}${call}' — '${shown}' has no class block, so it has no protected members to reach`);
    return null;
  };
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'QualifiedMember') {
      if (isType([n.object.name], n.name)) throw new Error(`'${n.object.name}::${n.name}' is a type, not a value`);
      throw fail(n.object.name, n.name) ?? new Error(`'${n.object.name}::${n.name}' is a type, not a value`);
    }
    if (n.type === 'ActorFieldSet' && n.protected) {
      throw fail(n.objectName, n.fieldName, ' <- …') ?? new Error(`'${n.objectName}::${n.fieldName}' — only a class's protected cell is written through '::'`);
    }
    if (n.type === 'TypeConstruction' && n.qualifier?.length === 1) {
      const c = classOf(n.qualifier[0]);
      const members = c?.membersClass ? byName.get(c.membersClass) : null;
      if (members && memberNames(members).fns.has(n.typeName)) throw fail(n.qualifier[0], n.typeName, '()');
    }
  });
}

// What the members declare, by source name: cells and functions, public (`@x`),
// protected (bare) and private (`#x`). A published cell's getter is the cell.
// A block that extends its parent's (`blockParent`) has the parent block's members too;
// `owner` says which block declares each cell.
function memberNames(members, byName = null) {
  const owner = new Map();
  const fns = new Set();
  for (let b = members; b; b = b.blockParent && byName ? byName.get(b.blockParent) : null) {
    for (const d of b.stateVarDecls || []) if (typeof d.name === 'string' && !owner.has(d.name)) owner.set(d.name, b.name);
    for (const f of b.functions || []) {
      if (typeof f.name === 'string' && !f.cellGetter && !/^(set|update|new|subscribe)@/.test(f.name)) fns.add(f.name);
    }
  }
  const cells = new Set(owner.keys());
  for (const c of cells) fns.delete(c);
  return { cells, fns, owner };
}

// `C.x` in the class, or in a class inside it, reaches the members' public names:
// after a dot a name is public, written without its `@`. A cell is read or written at
// the members' level of the chain (src/outer_reads.js, `viaClass`), as a bare `@x` in
// the nested form is; a function stays a message to the class. Anything else after the
// dot (a protected or private member, or nothing) is an error.
// See notes/class-scope-and-inheritance-2026-11-16.md.
function lowerMemberAccess(actor, from, members, isType, byName) {
  const { cells, fns, owner } = memberNames(members, byName);
  const isC = (o) => o && (o.type === 'Identifier' || o.type === 'RefRead') && o.name === from;
  const shown = from.replace(/^@/, '').replace(/[!.]$/, '');
  const noPublic = (x) => new Error(`No public member '${x}' in '${shown}'`);
  const replace = (n, next) => { for (const k of Object.keys(n)) if (k !== 'loc') delete n[k]; Object.assign(n, next); };
  const via = members.name;
  // An actor of a class reaches a block cell through its own class's block, which
  // forwards it to the block that holds it: nobody talks past their direct parent.
  // That's the cell its own block sees, so a qualifier that sees another one (a block
  // between redeclares it) isn't reachable that way yet.
  const ownBlock = actor.membersClass && !actor.membersOf && byName ? actor.membersClass : null;
  const cellVia = (name, written) => {
    const at = owner.get(name) ?? via;
    if (!ownBlock || ownBlock === at) return at;
    const mine = memberNames(byName.get(ownBlock), byName).owner.get(name);
    if (mine !== at) {
      const cls = shownBlock(byName, ownBlock);
      throw new Error(`'${written}' in '${shownBlock(byName, null, actor)}': the class block of '${cls}' redeclares '${name}', and reaching another block's '${name}' from an actor of '${cls}' isn't supported yet`);
    }
    return ownBlock;
  };
  // After `::`, a name is bare: a protected member.
  const isPublic = (x) => cells.has('@' + x) || fns.has('@' + x);
  const protectedError = (written, x, call = '') => isPublic(x)
    ? new Error(`'${x}' is public: write '${written ?? shown}.${x}${call}'`)
    : new Error(`No protected member '${x}' in '${shown}'`);
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'ActorFieldSet' && n.objectName === from && n.protected) {
      if (!cells.has(n.fieldName)) throw protectedError(n.objectWritten, n.fieldName);
      replace(n, { type: 'SetStatement', name: n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: cellVia(n.fieldName, `${n.objectWritten ?? shown}::${n.fieldName}`) });
    } else if (n.type === 'QualifiedMember' && isC(n.object)) {
      if (isType([from, members.name, members.membersOf], n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a type, not a value`);
      if (fns.has(n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a function: call it, '${n.object.written ?? shown}::${n.name}()'`);
      if (!cells.has(n.name)) throw protectedError(n.object.written, n.name);
      replace(n, { type: 'Identifier', name: n.name, viaClass: cellVia(n.name, `${n.object.written ?? shown}::${n.name}`) });
    } else if (n.type === 'TypeConstruction' && n.qualifier?.length === 1 && n.qualifier[0] === from
               && (fns.has(n.typeName) || isPublic(n.typeName) || cells.has(n.typeName))) {
      // A type of the class keeps its construction: a type name is reserved, so no
      // member shares it.
      if (!fns.has(n.typeName)) throw protectedError(n.qualifierWritten, n.typeName, '()');
      replace(n, { type: 'FunctionCallExpr', callee: { type: 'Identifier', name: n.typeName }, args: n.args, viaClass: via });
    } else if (n.type === 'ActorFieldSet' && n.objectName === from) {
      if (!cells.has('@' + n.fieldName)) throw noPublic(n.fieldName);
      replace(n, { type: 'SetStatement', name: '@' + n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: cellVia('@' + n.fieldName, `${shown}.${n.fieldName}`) });
    } else if (n.type === 'DotAccessExpr' && isC(n.object)) {
      if (cells.has('@' + n.property)) replace(n, { type: 'Identifier', name: '@' + n.property, viaClass: cellVia('@' + n.property, `${shown}.${n.property}`) });
      else if (!fns.has('@' + n.property)) throw noPublic(n.property);
    } else if (n.type === 'DotCallExpr' && isC(n.object) && n.method !== 'new') {
      if (!fns.has('@' + n.method) && !cells.has('@' + n.method)) throw noPublic(n.method);
    }
  });
}

const shownBlock = (byName, blockName, actor = null) => {
  const a = actor ?? byName.get(byName.get(blockName)?.membersOf) ?? { name: blockName };
  return (a.sourceName ?? a.name ?? '').replace(/^@/, '').replace(/__pub$/, '').replace(/[!.]$/, '');
};

function callsNew(actor) {
  let found = false;
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === 'new') found = true;
  });
  return found;
}
