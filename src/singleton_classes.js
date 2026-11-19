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
  // The class whose block code in `a` reaches: its own, or its nearest parent's.
  const blockClassOf = (a) => ownBlock(a) ?? (a.membersInherited ? byName.get(a.membersInherited) : null);
  // Whether `a` is in `cls`'s family: a subclass of it, at any depth.
  const extendsClass = (a, cls, seen = new Set()) => {
    if (!a || seen.has(a)) return false;
    seen.add(a);
    return (a.supertypes || []).some(st => st.supertype === cls.name || extendsClass(byName.get(st.supertype), cls, seen));
  };

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
    const family = (a) => a === cls || (extendsClass(a, cls) && a.membersInherited) || [...actors].some(f => f !== a
      && (f === cls || (extendsClass(f, cls) && f.membersInherited)) && isInside(a, f.name, byName));
    for (const a of actors) if (family(a)) for (const n of spellings) lowerMemberAccess(a, n, members, isType);
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
function memberNames(members) {
  const cells = new Set((members.stateVarDecls || []).map(d => d.name).filter(n => typeof n === 'string'));
  const fns = new Set((members.functions || []).filter(f => !f.cellGetter && !cells.has(f.name)).map(f => f.name)
    .filter(n => typeof n === 'string' && !/^(set|update|new|subscribe)@/.test(n)));
  return { cells, fns };
}

// `C.x` in the class, or in a class inside it, reaches the members' public names:
// after a dot a name is public, written without its `@`. A cell is read or written at
// the members' level of the chain (src/outer_reads.js, `viaClass`), as a bare `@x` in
// the nested form is; a function stays a message to the class. Anything else after the
// dot (a protected or private member, or nothing) is an error.
// See notes/class-scope-and-inheritance-2026-11-16.md.
function lowerMemberAccess(actor, from, members, isType) {
  const { cells, fns } = memberNames(members);
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
      replace(n, { type: 'SetStatement', name: n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: via });
    } else if (n.type === 'QualifiedMember' && isC(n.object)) {
      if (isType([from, members.name, members.membersOf], n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a type, not a value`);
      if (fns.has(n.name)) throw new Error(`'${n.object.written ?? shown}::${n.name}' is a function: call it, '${n.object.written ?? shown}::${n.name}()'`);
      if (!cells.has(n.name)) throw protectedError(n.object.written, n.name);
      replace(n, { type: 'Identifier', name: n.name, viaClass: via });
    } else if (n.type === 'TypeConstruction' && n.qualifier?.length === 1 && n.qualifier[0] === from
               && (fns.has(n.typeName) || isPublic(n.typeName) || cells.has(n.typeName))) {
      // A type of the class keeps its construction: a type name is reserved, so no
      // member shares it.
      if (!fns.has(n.typeName)) throw protectedError(n.qualifierWritten, n.typeName, '()');
      replace(n, { type: 'FunctionCallExpr', callee: { type: 'Identifier', name: n.typeName }, args: n.args, viaClass: via });
    } else if (n.type === 'ActorFieldSet' && n.objectName === from) {
      if (!cells.has('@' + n.fieldName)) throw noPublic(n.fieldName);
      replace(n, { type: 'SetStatement', name: '@' + n.fieldName, value: n.value, ...(n.updateOp && { updateOp: n.updateOp }), viaClass: via });
    } else if (n.type === 'DotAccessExpr' && isC(n.object)) {
      if (cells.has('@' + n.property)) replace(n, { type: 'Identifier', name: '@' + n.property, viaClass: via });
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
