// A class closes over the file actor it's declared in. `total *Integer = 4` at file
// level, then `W = *{ @get = { return total } }`: the class reads the file actor's
// `total`. A class is its own actor, so each read is a message to that file actor, and
// `Svc.W()` and `s.W()` read the cells of whichever actor made them.
//
// This pass marks each such read (`outer: true` on the Identifier or RefRead) and gives
// a reply shorthand (`return total`, `return :total`) an explicit expression to carry
// the mark. Backends emit a marked read as a read from the file actor. Writes are
// refused before this runs: a class can't set its file's cells.

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

// The names a class declares itself, inherited ones included.
function classOwnNames(classes, actor) {
  const { inheritedParams, inheritedState, wrappedBindings } = resolveSuperclassChain(classes, actor);
  return new Set([
    ...(actor.stateVarDecls || []).map(d => d.name),
    ...(actor.initParams || []).map(p => p.name),
    ...(actor.initBody || []).filter(s => typeof s.name === 'string').map(s => s.name),
    ...inheritedParams.map(p => p.name),
    ...(inheritedState || []).map(d => d.name),
    ...wrappedBindings.map(w => w.name),
  ]);
}

// A file's own functions, as a class could name them. A published cell's getter is
// the cell, so it isn't one.
function fileFunctionNames(program, outer) {
  const file = program.actors.find(a => !a.name);
  return new Set((file?.functions || [])
    .map(f => f.name)
    .filter(n => typeof n === 'string' && !/^(set|update|new|subscribe)@/.test(n) && !outer.has(n)));
}

export function markOuterReads(program) {
  const outer = fileOuterNames(program);
  const fileFunctions = fileFunctionNames(program, outer);
  // A dependency in the file's header is the file actor's, so a class's call on it
  // is made by the file actor (`outerCall`), as a read of its cell is.
  const dependencies = new Set((program.dependencies || []).map(d => d.name));
  if (outer.size === 0 && fileFunctions.size === 0 && dependencies.size === 0) return;
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  for (const actor of program.actors) {
    if (!actor.name) continue;
    const own = classOwnNames(classes, actor);
    const ownFunctions = new Set([
      ...(actor.functions || []).map(f => f.name),
      ...resolveSuperclassChain(classes, actor).inheritedFunctions.map(f => f.name),
    ]);
    // Calling a file's function from a class isn't supported yet, so it's refused
    // here rather than failing at runtime.
    const checkCall = (node, bound) => {
      const name = node.callee?.type === 'Identifier' ? node.callee.name : null;
      if (!fileFunctions.has(name) || ownFunctions.has(name) || own.has(name) || bound.has(name)) return;
      throw new Error(`'${name}' is a function of this file, and a class can't call it yet — pass what it needs as a class param`);
    };
    const reaches = (name, bound) => typeof name === 'string' && outer.has(name) && !own.has(name) && !bound.has(name);
    const read = (name) => ({ type: 'Identifier', name, outer: true });

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
      if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier' && dependencies.has(node.object.name)
          && !own.has(node.object.name) && !bound.has(node.object.name)) {
        node.outerCall = true;
      }
      if ((node.type === 'Identifier' || node.type === 'RefRead') && reaches(node.name, bound)) {
        node.outer = true;
        return;
      }
      if (node.type === 'Reply' || node.type === 'Return') {
        node.fields = (node.fields || []).map(f => {
          if (f.positional && !f.expr && !f.value && reaches(f.name, bound)) {
            const { name, ...rest } = f;
            return { ...rest, positional: true, expr: read(name) };
          }
          if (typeof f.sigil === 'string' && !f.expr && !f.value && reaches(f.sigil, bound)) {
            const { sigil, ...rest } = f;
            delete rest.ref;
            return { ...rest, key: sigil.replace(/^[@#]/, ''), value: read(sigil) };
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
  }
}

// Whether any class in the program reads its file actor, or calls its dependencies.
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
