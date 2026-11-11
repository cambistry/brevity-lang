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
// Writes are refused before this runs: a class can't set an enclosing actor's cells.
// See notes/session-2026-11-03-class-reads-file-cells.md and
// notes/session-2026-11-07-enclosing-actor-chain.md.

import { resolveSuperclassChain } from './subclass.js';

// What the file actor holds, by name, with its type: cells, constants, file params.
export function fileOuterNames(program) {
  const file = program.actors.find(a => !a.name);
  const names = new Map();
  if (!file) return names;
  for (const p of file.initParams || []) names.set(p.name, p.type || null);
  for (const d of file.stateVarDecls || []) names.set(d.name, d.typeName || null);
  return names;
}

// The classes a class is declared in, innermost first, ending with the file (null).
export function enclosingChain(program, actor) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  const chain = [];
  for (let at = actor; at?.enclosing; at = classes.get(at.enclosing)) chain.push(at.enclosing);
  chain.push(null);
  return chain;
}

// Where a class `name` may be constructed from: inside the class it's declared in, or
// inside any class declared within that one. A file-level class is everywhere.
export function classVisibleFrom(program, name, from) {
  const cls = program.actors.find(a => a.name === name);
  if (!cls?.enclosing) return true;
  if (!from?.name) return false;
  return from.name === cls.enclosing || enclosingChain(program, from).includes(cls.enclosing);
}

// The names a class declares itself, inherited ones included, with each one's type and
// whether it's a class param.
function classOwnNames(classes, actor) {
  const { inheritedParams, inheritedState, wrappedBindings } = resolveSuperclassChain(classes, actor);
  const names = new Map();
  const add = (name, type, param) => { if (typeof name === 'string' && !names.has(name)) names.set(name, { type: type || null, param }); };
  for (const p of actor.initParams || []) add(p.name, p.type, true);
  for (const p of inheritedParams) add(p.name, p.type, true);
  for (const d of actor.stateVarDecls || []) add(d.name, d.typeName, false);
  for (const d of inheritedState || []) add(d.name, d.typeName, false);
  for (const s of actor.initBody || []) add(s.name, s.typeName, false);
  for (const w of wrappedBindings) add(w.name, null, false);
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
    const names = new Map([...fileOuterNames(program)].map(([n, type]) => [n, { type, param: false }]));
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
    if (actor.enclosing && actor.isPublic) {
      throw new Error(`'${actor.name}' is declared inside '${actor.enclosing}', and a class declared in a class can't be public yet`);
    }
  }

  for (const actor of program.actors) {
    // The file is the outermost actor, so it reads nothing from outside itself. It
    // still mustn't construct a class declared inside one of its classes.
    const chain = actor.name ? enclosingChain(program, actor).map(owner => levels.get(owner)) : [];
    const ownLevel = levels.get(actor.name ?? null);
    const own = actor.name ? ownLevel.names : new Map();
    const ownFunctions = ownLevel.functions;
    // Every class's names, to say whose a name is when it's out of reach.
    const elsewhere = (name) => [...classes.values()].find(c => c !== actor && !chain.some(l => l.owner === c.name)
      && levels.get(c.name).names.has(name));

    const ownerOf = (name, bound) => {
      if (typeof name !== 'string' || own.has(name) || bound.has(name)) return null;
      const at = chain.findIndex(l => l.names.has(name));
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
          throw new Error(`'${name}' is declared inside '${classes.get(name).enclosing}', so only that class and the classes inside it can construct it`);
        }
        return;
      }
      if (!actor.name || ownFunctions.has(name)) return;
      // Calling an enclosing actor's function isn't supported yet, so it's refused
      // here rather than failing at runtime.
      const owner = chain.find(l => l.functions.has(name));
      if (owner) throw new Error(`'${name}' is a function of ${shown(owner.owner)}, and a class can't call it yet — pass what it needs as a class param`);
    };
    // A name that a class outside the chain declares is out of reach. Anything the
    // class binds anywhere (a destructure, a catch, a lambda) is its own.
    const binders = actor.name ? boundAnywhere(actor) : new Set();
    const checkReach = (node, bound) => {
      if (!actor.name || typeof node.name !== 'string' || own.has(node.name) || bound.has(node.name) || binders.has(node.name)) return;
      if (chain.some(l => l.names.has(node.name)) || classes.has(node.name) || dependencies.has(node.name)) return;
      const other = elsewhere(node.name);
      if (other) throw new Error(`'${node.name}' is a name of '${other.name}', which '${actor.name}' isn't declared in`);
    };

    const visit = (node, bound) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n, bound)); return; }
      // A function's params may reuse an outer name, and then mean the param.
      if (node.type === 'FunctionDecl' || node.type === 'Function') {
        bound = new Set([...bound, ...(node.params || []).map(p => p?.name).filter(Boolean)]);
      }
      if (node.type === 'ForStatement' && node.name) bound = new Set([...bound, node.name]);
      if (Array.isArray(node.body)) {
        const locals = node.body.filter(st => (st?.type === 'Assign' || st?.type === 'TypedAssign') && typeof st.name === 'string').map(st => st.name);
        if (locals.length) bound = new Set([...bound, ...locals]);
      }
      if (node.type === 'FunctionCallExpr') checkCall(node, bound);
      // Its address is global (src/opre.js): a dependency, or a path through one.
      const dep = node.type === 'DotCallExpr' && node.opre?.address.kind === 'static' ? node.opre.address.dep : null;
      if (actor.name && dep && dependencies.has(dep)
          && !own.has(dep) && !bound.has(dep) && !chain.some(l => l.owner !== null && l.names.has(dep))) {
        node.outerCall = true;
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
      if (/^(set|update|new|subscribe)@/.test(fn.name ?? '')) continue;
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
    if (node.outer === true || node.outerCall === true) { found = true; return; }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  for (const a of program.actors) if (a.name) walk(a);
  return found;
}

// Whether a class encloses another, so its actors answer reads of their cells.
export function enclosesClasses(program, actor) {
  return !!actor.name && program.actors.some(a => a.enclosing === actor.name);
}
