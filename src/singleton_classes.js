// Class singletons: a class whose class block holds members of its own.
//
//   Nested:   C = **{ count *Integer = 0; new = (seed Integer) *{ … } }
//   Trailing: C = (seed Integer) *{ … } **{ count *Integer = 0 }
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

// `class_of(self)` as the parser leaves it: an Identifier no source name can spell,
// resolved here to the class of the actor it's in.
export const CLASS_OF_SELF = 'class_of(self)';

// The class of a file whose `*` section is its `new`. Nothing in source can name it.
export const FILE_CLASS = 'new__file';

// The label an actor is published at in the actor that builds it, sigil and all
// (`@s`), or null: a public singleton's, or a public class's members, which are
// reached at the class's label (`:C:count`; `$new` to `:C` still builds a `C`).
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

  // `class_of(self)` names the class of the actor it's in.
  for (const a of actors) resolveClassOf(a);

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
    for (const a of actors) if (a === cls || isInside(a, cls.name, byName)) for (const n of spellings) lowerMemberAccess(a, n, members);
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
      return new Error(`'${name}' is a member of the class '${cls}', and a trailing constructor doesn't close over its class block${reach}`);
    };
    for (const b of [a.initBody, a.constructorBody]) walk(b, (n) => {
      if (n.type === 'SetStatement' && !n.viaClass && memberCell(n.name)) throw notClosedOver(n.name);
    });
    for (const b of bodies(a)) walk(b, (n) => {
      if (n.type === 'SetStatement' && n.deferredError) throw memberCell(n.name) ? notClosedOver(n.name) : new Error(n.deferredError);
    });
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

// Whether `actor` is declared, at any depth, inside class `name`'s constructor.
function isInside(actor, name, byName) {
  for (let at = byName.get(actor.enclosing); at; at = byName.get(at.enclosing)) if (at.name === name) return true;
  return false;
}

// `class_of(self)` is the class of the actor it's in, so `class_of(self).count` is
// `C.count` in `C`. Only `self`, and only as a receiver, for now.
function resolveClassOf(actor) {
  const where = () => actor.singletonOf || actor.membersOf ? 'a class block' : 'this file';
  const isClass = actor.name && !actor.singletonOf && !actor.membersOf && actor.name !== FILE_CLASS;
  const resolve = () => {
    if (!isClass) throw new Error(`'class_of(self)' in ${where()} isn't supported yet: it names the class of an actor built by a class`);
    if (!actor.membersClass) throw new Error(`'class_of(self)': '${actor.name}' has no class block, so there are no class members to reach`);
    return actor.name;
  };
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'ActorFieldSet' && n.objectName === CLASS_OF_SELF) n.objectName = resolve();
    if (n.object?.type === 'Identifier' && n.object.name === CLASS_OF_SELF) n.object = { ...n.object, name: resolve() };
  });
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'Identifier' && n.name === CLASS_OF_SELF) {
      throw new Error("'class_of(self)' is only a receiver for now: 'class_of(self).count', 'class_of(self).bump!()'");
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
function lowerMemberAccess(actor, from, members) {
  const { cells, fns } = memberNames(members);
  const isC = (o) => o && (o.type === 'Identifier' || o.type === 'RefRead') && o.name === from;
  const shown = from.replace(/^@/, '').replace(/[!.]$/, '');
  const noPublic = (x) => new Error(`No public member '${x}' in '${shown}'`);
  const replace = (n, next) => { for (const k of Object.keys(n)) if (k !== 'loc') delete n[k]; Object.assign(n, next); };
  const via = members.name;
  for (const b of bodies(actor)) walk(b, (n) => {
    if (n.type === 'ActorFieldSet' && n.objectName === from) {
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
