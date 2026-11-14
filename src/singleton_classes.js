// Class singletons: a class whose class block holds members of its own.
//
//   Nested:   C = **{ count *Integer = 0; new = (seed Integer) *{ … } }
//   Trailing: C = (seed Integer) *{ … } **{ count *Integer = 0 }
//
// Either way the members are a singleton, kept in the declaring actor's cell
// `C__class`, and `C` is an ordinary class of the declaring actor: `C()` builds
// one, its actors are `C n` on the wire under it, and their `ty` names `C`. What
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

// The class of a file whose `*` section is its `new`. Nothing in source can name it.
export const FILE_CLASS = 'new__file';

// The label an actor is published at in the actor that builds it, sigil and all
// (`@s`), or null: a public singleton's, or a public class's members, which are
// reached at the class's label (`. C count`; `$new` to `. C` still builds a `C`).
export function publicLabel(actor) {
  if (actor?.singletonOf?.startsWith('@')) return actor.singletonOf;
  return actor?.publishedAs ? '@' + actor.publishedAs : null;
}

const NOT_IN_SINGLETON ="'new' makes a singleton a class, so it goes inside one: 'C = **{ … new = (params) *{ … } }'";

export function lowerSingletonClasses(actors) {
  const byName = new Map(actors.filter(a => a.name).map(a => [a.name, a]));
  const declarer = (name) => actors.find(a => (a.name ?? null) === (name ?? null));

  // A file's `*` section: the file is the singleton, so its class is a class of
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
    // In the class itself, `C.count` on a protected member (bare `count`) reads it
    // from inside the class (`$get` of `~count`), which a client can't.
    if (cls.membersOpaque) renameProtectedReads(cls, cls.name, protectedCells(members));
    // `C.count` reads the members; `C(…)` still builds a `C`.
    for (const a of actors) renameReceivers(a, cls.name, members.singletonOf);
  }

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
    const obj = n.object;
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
    if (n.objectName === from) n.objectName = to;
  });
}

// The members' protected cells: bare names, not published.
function protectedCells(members) {
  return new Set([...(members.stateVarDecls || []).map(d => d.name)].filter(n => typeof n === 'string' && !/^[@#]/.test(n)));
}

// `C.count`, for a protected `count`, becomes a read of it at the members' level
// of the chain (src/outer_reads.js, `viaClass`).
function renameProtectedReads(actor, from, cells) {
  for (const b of bodies(actor)) walk(b, (n) => {
    const obj = n.object;
    if (n.type !== 'DotAccessExpr' || !obj || (obj.type !== 'Identifier' && obj.type !== 'RefRead') || obj.name !== from || !cells.has(n.property)) return;
    const name = n.property;
    for (const k of Object.keys(n)) if (k !== 'loc') delete n[k];
    Object.assign(n, { type: 'Identifier', name, viaClass: true });
  });
}

function callsNew(actor) {
  let found = false;
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === 'new') found = true;
  });
  return found;
}
