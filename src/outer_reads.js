// A class closes over the actors it's declared in: the class around it, that class's
// enclosing class, and so on out to the file actor, which is the outermost. `total
// *Integer = 4` at file level, then `W = *{ @get = { return total } }`: the class reads
// the file actor's `total`. A class is its own actor, so each read is a message to the
// actor that owns the name, and `Svc.W()` and `s.W()` read the cells of whichever actor
// made them. The chain is made of actors, not declarations: an `Inner` that the `Outer`
// actor o1 constructs reads o1's cells, whenever it runs.
//
// This pass marks each such read and gives a reply shorthand (`return total`, `return
// :total`) an explicit expression to carry the mark. A marked read has:
//   outer: true
//   outerLevel   how many actors up the chain its owner is, 1 being the enclosing one
//   outerClass   the owner's class name, or null for the file actor
//   outerParam   whether it's one of the owner's class params
//   outerType    its declared type, if any
//
// A write (`total <- total + 1`) and a call (`helper(3)`) reach the owner the same
// way, as messages: a write becomes an `OuterSet` statement, a `$set` to the owner's
// cell; a call is marked `outerFnCall`, with its level. Only a `*` cell can be set.
// A closure sends to a cell of its enclosing scope; a class sends to a cell of its
// enclosing actor. See notes/class-singleton-forms-2026-11-13.md.
// See notes/session-2026-11-03-class-reads-file-cells.md and
// notes/session-2026-11-07-enclosing-actor-chain.md.

import { resolveSuperclassChain } from './subclass.js';

const SCALAR_TYPES = new Set(['Integer', 'Text', 'Boolean', 'Decimal', 'Float']);

// What the file actor holds, by name, with its type: cells, constants, file params.
export function fileOuterNames(program) {
  const file = program.actors.find(a => !a.name);
  const names = new Map();
  if (!file) return names;
  for (const p of file.initParams || []) names.set(p.name, p.type || null);
  for (const d of file.stateVarDecls || []) names.set(d.name, d.typeName || null);
  return names;
}

// The names an actor answers `$get` for: `{ name, param, open }`. A file actor's are
// its cells, constants and params; a class's its own cells and params. `open` marks a
// public cell, which answers anyone; every other name answers only from inside the
// actor and from a class declared in it (an outer read). The same table answers both.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
export function readableNames(actor) {
  const isPublicCell = (n) => n.startsWith('@') && (actor.functions || []).some(f => f.name === n && f.cellGetter);
  const params = new Set((actor.initParams || []).map(p => p.name));
  const names = !actor.name ? [...fileOuterNames({ actors: [actor] }).keys()]
    : [...params, ...(actor.stateVarDecls || []).map(d => d.name)];
  return [...new Set(names.filter(n => typeof n === 'string'))].map(name => ({ name, param: params.has(name), open: isPublicCell(name) }));
}

// An actor's props, by source name: its published params (`@name Type` in a
// header). A prop is read as an op and isn't an address: `$get` and `$subscribe`
// to it answer unhandled.
export function propNames(actor) {
  return (actor.initParams || []).filter(p => p.accessor).map(p => p.accessor.replace(/^@/, ''));
}

// The classes a class is declared in, innermost first, ending with the file (null).
export function enclosingChain(program, actor) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  const chain = [];
  for (let at = actor; at?.enclosing; at = classes.get(at.enclosing)) {
    chain.push(at.enclosing);
    // A class block that extends another isn't declared in it, but an actor whose
    // chain holds the block holds the blocks it extends next (src/singleton_classes.js).
    for (let b = classes.get(classes.get(at.enclosing)?.blockParent); b; b = classes.get(b.blockParent)) chain.push(b.name);
  }
  chain.push(null);
  return chain;
}

// Where a class `name` may be constructed from: inside the class it's declared in, or
// inside any class declared within that one. A file-level class is everywhere.
// A class with members (src/singleton_classes.js) is declared where its singleton
// is: its `home`, whatever its constructor closes over.
export function classVisibleFrom(program, name, from) {
  const cls = program.actors.find(a => a.name === name);
  const home = homeOf(cls);
  if (!home) return true;
  if (!from?.name) return false;
  return from.name === home || enclosingChain(program, from).includes(home);
}

// The actor a class is declared in: where it is built and published.
export function homeOf(cls) {
  return cls && 'home' in cls ? cls.home : cls?.enclosing ?? null;
}

// The names a class declares itself, inherited ones included, with each one's type and
// whether it's a class param.
function classOwnNames(classes, actor) {
  const { inheritedParams, inheritedState } = resolveSuperclassChain(classes, actor);
  const names = new Map();
  const add = (name, type, param, ref = false) => { if (typeof name === 'string' && !names.has(name)) names.set(name, { type: type || null, param, ref: !!ref }); };
  for (const p of actor.initParams || []) add(p.name, p.type, true, p.ref);
  for (const p of inheritedParams) add(p.name, p.type, true, p.ref);
  for (const d of actor.stateVarDecls || []) add(d.name, d.typeName, false, d.isRef);
  for (const d of inheritedState || []) add(d.name, d.typeName, false, d.isRef);
  // A class block answers the cells it inherits, by forwarding them to its base.
  for (const c of actor.forwardCells || []) add(c.name, c.typeName, false, c.isRef);
  // A write in the constructor block (`total <- 1`) names a cell; it doesn't declare one.
  for (const s of actor.initBody || []) if (s.type !== 'SetStatement' && s.type !== 'ActorSetStatement') add(s.name, s.typeName, false, s.isRef);
  return names;
}

// An actor's own functions, as a class inside it could name them. A published cell's
// getter is the cell, so it isn't one.
function functionNames(classes, actor, cells) {
  const own = actor.name ? resolveSuperclassChain(classes, actor).inheritedFunctions : [];
  return new Set([...(actor.functions || []), ...own]
    .map(f => f.name)
    .filter(n => typeof n === 'string' && !/^(set|update|new|subscribe)@/.test(n) && !cells.has(n)));
}

// What one actor in a chain holds: its names (name -> { type, param }) and functions.
function levelOf(program, classes, owner) {
  if (owner === null) {
    const file = program.actors.find(a => !a.name);
    const refs = new Set([...(file?.stateVarDecls || []), ...(file?.initParams || [])].filter(d => d.isRef || d.ref).map(d => d.name));
    const names = new Map([...fileOuterNames(program)].map(([n, type]) => [n, { type, param: false, ref: refs.has(n) }]));
    return { owner, names, functions: file ? functionNames(classes, file, names) : new Set() };
  }
  const actor = classes.get(owner);
  const names = classOwnNames(classes, actor);
  return { owner, names, functions: functionNames(classes, actor, names) };
}

// Every name a node binds, in any form: assignments, destructure patterns, loop
// variables, function and lambda params.
function boundAnywhere(root) {
  const names = new Set();
  const collect = (pattern) => {
    if (!pattern || typeof pattern !== 'object') return;
    if (Array.isArray(pattern)) { pattern.forEach(collect); return; }
    if (typeof pattern.name === 'string') names.add(pattern.name);
    for (const v of Object.values(pattern)) if (v && typeof v === 'object') collect(v);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if ((node.type === 'Assign' || node.type === 'TypedAssign' || node.type === 'ForStatement') && typeof node.name === 'string') names.add(node.name);
    if (node.type === 'DestructureAssign' || node.type === 'ListDestructure') collect(node.pattern);
    if (node.type === 'FunctionDecl' || node.type === 'Function') collect(node.params);
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(root.functions);
  walk(root.initBody);
  walk(root.constructorBody);
  return names;
}

const shown = (owner) => owner === null ? 'this file' : `'${owner}'`;

export function markOuterReads(program) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  // A dependency in the file's header is the file actor's, so a class's call on it
  // is made by the file actor (`outerCall`), as a read of its cell is.
  const dependencies = new Set((program.dependencies || []).map(d => d.name));
  const levels = new Map([[null, levelOf(program, classes, null)]]);
  for (const name of classes.keys()) levels.set(name, levelOf(program, classes, name));

  for (const actor of classes.values()) {
    if (homeOf(actor) && actor.isPublic) {
      throw new Error(`'${actor.name}' is declared inside '${homeOf(actor)}', and a class declared in a class can't be public yet`);
    }
  }

  for (const actor of program.actors) {
    // The file is the outermost actor, so it reads nothing from outside itself. It
    // still mustn't construct a class declared inside one of its classes.
    // A trailing class's members (src/singleton_classes.js) are in its chain, but no
    // bare name reaches them: their level is opaque, and only `C.count` (`viaClass`)
    // reads it.
    const opaque = new Set();
    for (let at = actor; at?.enclosing; at = classes.get(at.enclosing)) {
      if (!at.membersOpaque) continue;
      opaque.add(at.enclosing);
      for (let b = classes.get(classes.get(at.enclosing)?.blockParent); b; b = classes.get(b.blockParent)) opaque.add(b.name);
    }
    const chain = actor.name ? enclosingChain(program, actor).map(owner => ({ ...levels.get(owner), opaque: opaque.has(owner) })) : [];
    const ownLevel = levels.get(actor.name ?? null);
    const own = actor.name ? ownLevel.names : new Map();
    const ownFunctions = ownLevel.functions;

    // `C.count` inside the class (src/singleton_classes.js): the members' own level,
    // whatever the actor or the levels between declare.
    const viaClassAt = (node) => {
      const at = chain.findIndex(l => l.owner === node.viaClass);
      return at < 0 ? null : { level: at + 1, ...chain[at] };
    };
    // A name of a trailing class's members, which a bare name doesn't reach.
    const opaqueOwner = (name, kind) => {
      const l = chain.find(l => l.opaque && l[kind].has(name));
      return l ? classes.get(l.owner) : null;
    };
    // A subclass that uses its parent's class block (`D = C ^ …`) is outside the
    // block, as a trailing constructor is: neither closes over it.
    const outside = actor.membersInherited ? `a subclass of '${actor.membersInherited.replace(/^@/, '').replace(/__pub$/, '')}'` : 'a trailing constructor';
    const notClosedOver = (name, members) => {
      const cls = members.membersOf.replace(/^@/, '');
      if (name.startsWith('#')) return new Error(`'${name}' is private to the class block of '${cls}', and ${outside} doesn't close over it`);
      const reach = name.startsWith('@') ? `: reach it as '${cls}.${name.slice(1)}'` : '';
      return new Error(`'${name}' is a member of the class '${cls}', and ${outside} doesn't close over its class block${reach}`);
    };

    const ownerOf = (name, bound) => {
      if (typeof name !== 'string' || own.has(name) || bound.has(name)) return null;
      const at = chain.findIndex(l => !l.opaque && l.names.has(name));
      return at < 0 ? null : { level: at + 1, ...chain[at] };
    };
    const mark = (node, found) => {
      const { type, param } = found.names.get(node.name);
      node.outer = true;
      node.outerLevel = found.level;
      node.outerClass = found.owner;
      node.outerParam = param;
      node.outerType = type;
      return node;
    };

    const checkCall = (node, bound) => {
      const name = node.callee?.type === 'Identifier' ? node.callee.name : null;
      if (typeof name !== 'string' || bound.has(name) || own.has(name)) return;
      if (classes.has(name)) {
        if (!classVisibleFrom(program, name, actor)) {
          throw new Error(`'${name}' is declared inside '${homeOf(classes.get(name))}', so only that class and the classes inside it can construct it`);
        }
        return;
      }
      if (!actor.name) return;
      if (node.viaClass) {
        const found = viaClassAt(node);
        if (found) { node.outerFnCall = true; node.outerLevel = found.level; node.outerClass = found.owner; }
        return;
      }
      if (ownFunctions.has(name)) return;
      // A function of an enclosing actor: a message to that actor.
      const at = chain.findIndex(l => !l.opaque && l.functions.has(name));
      if (at >= 0) {
        node.outerFnCall = true;
        node.outerLevel = at + 1;
        node.outerClass = chain[at].owner;
        return;
      }
      const members = opaqueOwner(name, 'functions');
      if (members) throw notClosedOver(name, members);
    };
    // `x <- v` on an enclosing actor's cell: a `$set` (or `$update`) sent to it.
    const markSet = (node, bound) => {
      if (!actor.name) return;
      const found = node.viaClass ? viaClassAt(node) : ownerOf(node.name, bound);
      if (!found) {
        const members = !own.has(node.name) && !bound.has(node.name) && opaqueOwner(node.name, 'names');
        if (members) throw notClosedOver(node.name, members);
        return;
      }
      const { type, ref } = found.names.get(node.name);
      if (!ref) throw new Error(`Cannot set '${node.name}' — it's a cell of ${shown(found.owner)} that isn't '*', so it can't be set`);
      const { name, value, updateOp } = node;
      for (const k of Object.keys(node)) if (k !== 'loc') delete node[k];
      node.type = 'ExprStatement';
      // `<|` on a scalar replaces it, as on an actor's own cell, so it's a `$set`. (An
      // owner has no `$update` for a cell yet, so a structured `<|` across actors isn't
      // supported.)
      const scalar = SCALAR_TYPES.has(type);
      node.expr = { type: 'OuterSet', name, value, updateOp: scalar ? null : updateOp ?? null, outerLevel: found.level, outerClass: found.owner, outerType: type };
    };
    // A name that a class outside the chain declares is out of reach. Anything the
    // class binds anywhere (a destructure, a catch, a lambda) is its own.
    const binders = actor.name ? boundAnywhere(actor) : new Set();
    const checkReach = (node, bound) => {
      if (!actor.name || typeof node.name !== 'string' || own.has(node.name) || bound.has(node.name) || binders.has(node.name)) return;
      // Its own functions (inherited ones too) and an enclosing actor's are in reach,
      // as a callee or as a value.
      if (ownFunctions.has(node.name) || chain.some(l => !l.opaque && (l.names.has(node.name) || l.functions.has(node.name)))) return;
      if (classes.has(node.name) || dependencies.has(node.name)) return;
      const members = opaqueOwner(node.name, 'names');
      if (members) throw notClosedOver(node.name, members);
    };

    const visit = (node, bound) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, bound)); return; }
      // A function's params may reuse an outer name, and then mean the param.
      // So may a subscribe callback's.
      if (node.type === 'FunctionDecl' || node.type === 'Function' || node.type === 'SubscribeCall') {
        bound = new Set([...bound, ...(node.params || []).map(p => p?.name).filter(Boolean)]);
      }
      if (node.type === 'ForStatement' && node.name) bound = new Set([...bound, node.name]);
      if (Array.isArray(node.body)) {
        const locals = node.body.filter(st => (st?.type === 'Assign' || st?.type === 'TypedAssign' || st?.type === 'RefDecl') && typeof st.name === 'string').map(st => st.name);
        if (locals.length) bound = new Set([...bound, ...locals]);
      }
      if (node.type === 'FunctionCallExpr') checkCall(node, bound);
      if (node.type === 'SetStatement') markSet(node, bound);
      // Its address is global (src/opre.js): a dependency, or a path through one.
      const dep = node.type === 'DotCallExpr' && node.opre?.address.kind === 'static' ? node.opre.address.dep : null;
      if (actor.name && dep && dependencies.has(dep)
          && !own.has(dep) && !bound.has(dep) && !chain.some(l => l.owner !== null && l.names.has(dep))) {
        node.outerCall = true;
      }
      // A block's inherited cell is read at its base (src/singleton_classes.js).
      if (node.outerBase) return;
      if (actor.name && node.type === 'Identifier' && node.viaClass) {
        const found = viaClassAt(node);
        if (found) { mark(node, found); return; }
      }
      if (actor.name && (node.type === 'Identifier' || node.type === 'RefRead')) {
        const found = ownerOf(node.name, bound);
        if (found) { mark(node, found); return; }
        checkReach(node, bound);
      }
      if (actor.name && (node.type === 'Reply' || node.type === 'Return')) {
        node.fields = (node.fields || []).map(f => {
          if (f.positional && !f.expr && !f.value) {
            const found = ownerOf(f.name, bound);
            if (found) {
              const { name, ...rest } = f;
              return { ...rest, positional: true, expr: mark({ type: 'Identifier', name }, found) };
            }
            checkReach({ name: f.name }, bound);
          }
          if (typeof f.sigil === 'string' && !f.expr && !f.value) {
            const found = ownerOf(f.sigil, bound);
            if (found) {
              const { sigil, ...rest } = f;
              delete rest.ref;
              return { ...rest, key: sigil.replace(/^[@#]/, ''), value: mark({ type: 'Identifier', name: sigil }, found) };
            }
            checkReach({ name: f.sigil }, bound);
          }
          return f;
        });
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'loc') continue;
        if (v && typeof v === 'object') visit(v, bound);
      }
    };

    for (const fn of actor.functions || []) {
      // A cell's own setter sets its own cell. One a class block took from its parent's
      // (src/singleton_classes.js) sets the parent block's, unless the block redeclares it.
      if (/^(set|update|new|subscribe)@/.test(fn.name ?? '') && !fn.inheritedFrom) continue;
      visit(fn, new Set());
    }
    visit(actor.initBody, new Set());
    // A param default runs in the constructor, so it reaches what the body does.
    for (const p of actor.initParams || []) if (p.defaultValue) visit(p.defaultValue, new Set());
  }
}

// The names a class reads from the actors it's declared in, with their types. The
// innermost declaration of a name wins, and the class's own names win over all of them.
export function outerNamesFor(program, actor) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  const names = new Map();
  // A class block's inherited cells, read at its base (src/singleton_classes.js).
  for (const c of actor.forwardCells || []) names.set(c.name, c.typeName ?? null);
  for (const owner of enclosingChain(program, actor)) {
    for (const [n, { type }] of levelOf(program, classes, owner).names) if (!names.has(n)) names.set(n, type);
  }
  return names;
}

// Whether any class in the program reads an enclosing actor, or calls its file's
// dependencies.
export function hasOuterReads(program) {
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.outer === true || node.outerCall === true || node.outerFnCall === true || node.type === 'OuterSet') { found = true; return; }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  for (const a of program.actors) if (a.name) walk(a);
  return found;
}

// Whether a class encloses another, so its actors answer reads of their cells.
export function enclosesClasses(program, actor) {
  return !!actor.name && program.actors.some(a => a.enclosing === actor.name);
}
