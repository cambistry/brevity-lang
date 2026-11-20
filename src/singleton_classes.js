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

  // A subclass with no class block of its own uses its nearest parent's (the
  // delegated rule, notes/class-scope-and-inheritance-2026-11-16.md): its actors have
  // that block first in their chain, as the parent's do, and reach it as the
  // parent's trailing constructor does, through `T.` and `T::`.
  const ownBlock = (a) => a?.membersClass && !a.membersInherited ? a : null;
  const blockOf = (a, seen = new Set()) => {
    if (!a || seen.has(a)) return null;
    seen.add(a);
    if (ownBlock(a)) return a;
    const found = [...new Set((a.supertypes || [])
      .map(st => blockOf(byName.get(st.supertype), seen)).filter(Boolean))];
    if (found.length > 1) throw new Error(`'${shownName(a)}' has more than one parent with a class block ('${found.map(shownName).join("', '")}'), and which one it uses isn't settled yet`);
    return found[0] ?? null;
  };
  for (const a of actors.filter(a => a.name && (a.supertypes || []).length && !a.membersClass)) {
    const parent = blockOf(a);
    if (!parent) continue;
    const parentHome = 'home' in parent ? parent.home : parent.enclosing ?? null;
    if ((a.enclosing ?? null) !== (parentHome ?? null)) {
      throw new Error(`'${shownName(a)}' extends '${shownName(parent)}', which has a class block, and is declared somewhere else than it — that isn't supported yet`);
    }
    a.membersClass = parent.membersClass;
    a.membersInherited = parent.name;
    a.home = a.enclosing ?? null;
    a.enclosing = parent.membersClass;
    a.membersOpaque = true;
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
  const blockClassOf = (a) => ownBlock(a) ?? (a.membersInherited ? byName.get(a.membersInherited) : null);
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

  for (const cls of actors.filter(a => a.membersClass && !a.membersInherited)) {
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
    const reaches = (a) => a === cls || (extendsClass(a, cls) && (a.membersInherited || blockExtends(a)));
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
    const members = a.membersOpaque ? byName.get(a.membersClass) : null;
    const own = new Set([...(a.stateVarDecls || []), ...(a.initParams || [])].map(d => d.name));
    const memberCell = (name) => members && !own.has(name) && memberNames(members).cells.has(name);
    const notClosedOver = (name) => {
      const cls = a.name.replace(/^@/, '').replace(/[!.]$/, '');
      const reach = name.startsWith('@') ? `: reach it as '${cls}.${name.slice(1)}'` : '';
      const outside = a.membersInherited ? `a subclass of '${shownName(byName.get(a.membersInherited) ?? { name: a.membersInherited })}'` : 'a trailing constructor';
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

// A class block extending its parent's (`blockParent`): a copy of each of the parent
// block's functions the block doesn't define, so it runs as the block, late-bound:
// a cell the block redeclares is its own, any other is the parent block's (the block
// is declared inside it). A layer's clauses for a name replace the parent's together.
// Runs once `base` and `super` are lowered, so a parent's function they reach is in
// the copy too. Parents first, so a parent block has its own parent's by then.
export function flattenDelegatedBlocks(actors) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const done = new Set();
  const flatten = (block) => {
    if (!block?.blockParent || done.has(block)) return;
    done.add(block);
    const parent = byName.get(block.blockParent);
    flatten(parent);
    const own = new Set((block.functions || []).map(f => f.name));
    const ownCells = new Set((block.stateVarDecls || []).map(d => d.name));
    // A cell's accessors stay with the block that declares it.
    const accessorOf = (f) => f.cellGetter ? f.name : f.name?.match(/^(?:set|update|subscribe)([@.])(.+)$/)?.slice(1).join('').replace(/^\./, '');
    const add = (f) => {
      Object.defineProperty(f, 'inheritedFrom', { value: parent.name, configurable: true });
      (block.functions ||= []).push(f);
    };
    for (const f of parent.functions || []) {
      if (own.has(f.name)) continue;
      const cell = accessorOf(f);
      if (cell && !ownCells.has(cell)) continue;
      add(structuredClone(f));
    }
    // A public cell of the parent block's, read through this one: the parent block answers.
    for (const d of parent.stateVarDecls || []) {
      if (typeof d.name !== 'string' || !d.name.startsWith('@') || ownCells.has(d.name) || own.has(d.name)) continue;
      add({ type: 'FunctionDecl', name: d.name, params: [], body: [{ type: 'ImplicitReturn', expr: { type: 'Identifier', name: d.name, viaClass: parent.name }, typeName: d.typeName ?? null }] });
    }
  };
  for (const a of actors) flatten(a);
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
  // After `::`, a name is bare: a protected member.
  const isPublic = (x) => cells.has('@' + x) || fns.has('@' + x);
  const protectedError = (written, x, call = '') => isPublic(x)
    ? new Error(`'${x}' is public: write '${written ?? shown}.${x}${call}'`)
    : new Error(`No protected member '${x}' in '${shown}'`);
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'ActorFieldSet' && n.objectName === from && n.protected) {
      if (!cells.has(n.fieldName)) throw protectedError(n.objectWritten, n.fieldName);
      replace(n, { type: 'SetStatement', name: n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: owner.get(n.fieldName) ?? via });
    } else if (n.type === 'QualifiedMember' && isC(n.object)) {
      if (isType([from, members.name, members.membersOf], n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a type, not a value`);
      if (fns.has(n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a function: call it, '${n.object.written ?? shown}::${n.name}()'`);
      if (!cells.has(n.name)) throw protectedError(n.object.written, n.name);
      replace(n, { type: 'Identifier', name: n.name, viaClass: owner.get(n.name) ?? via });
    } else if (n.type === 'TypeConstruction' && n.qualifier?.length === 1 && n.qualifier[0] === from
               && (fns.has(n.typeName) || isPublic(n.typeName) || cells.has(n.typeName))) {
      // A type of the class keeps its construction: a type name is reserved, so no
      // member shares it.
      if (!fns.has(n.typeName)) throw protectedError(n.qualifierWritten, n.typeName, '()');
      replace(n, { type: 'FunctionCallExpr', callee: { type: 'Identifier', name: n.typeName }, args: n.args, viaClass: via });
    } else if (n.type === 'ActorFieldSet' && n.objectName === from) {
      if (!cells.has('@' + n.fieldName)) throw noPublic(n.fieldName);
      replace(n, { type: 'SetStatement', name: '@' + n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: owner.get('@' + n.fieldName) ?? via });
    } else if (n.type === 'DotAccessExpr' && isC(n.object)) {
      if (cells.has('@' + n.property)) replace(n, { type: 'Identifier', name: '@' + n.property, viaClass: owner.get('@' + n.property) ?? via });
      else if (!fns.has('@' + n.property)) throw noPublic(n.property);
    } else if (n.type === 'DotCallExpr' && isC(n.object) && n.method !== 'new') {
      if (!fns.has('@' + n.method) && !cells.has('@' + n.method)) throw noPublic(n.method);
    }
  });
}

function callsNew(actor) {
  let found = false;
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === 'new') found = true;
  });
  return found;
}
