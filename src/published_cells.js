// An actor's published cell, seen from its own functions. `@a *Integer` is `@a` inside
// as well as out: a bare `a` names a different, private cell. Writing `@a` tells its
// subscribers, as a `set` from outside does.

import { resolveSuperclassChain } from './subclass.js';
import { outerNamesFor, enclosingChain } from './outer_reads.js';

// The cells of each actor (by name, null for the file) that an actor declared
// inside it subscribes to by name (`c.subscribe`): the innermost enclosing actor
// that declares the name owns it, unless the subscriber owns it itself.
function subscribedFromInside(ast) {
  const byName = new Map(ast.actors.map(a => [a.name ?? null, a]));
  const declares = (a, name) => (a?.stateVarDecls || []).some(d => d.name === name) || (a?.initParams || []).some(p => p.name === name);
  const out = new Map();
  for (const actor of ast.actors.filter(a => a.name)) {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      const t = node.type === 'SubscribeCall' ? node.target : null;
      if ((t?.type === 'Identifier' || t?.type === 'RefRead') && !t.name.startsWith('@') && !declares(actor, t.name)) {
        const owner = enclosingChain(ast, actor).find(o => declares(byName.get(o), t.name));
        if (owner !== undefined) {
          if (!out.has(owner)) out.set(owner, new Set());
          out.get(owner).add(t.name);
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    [actor.functions, actor.initBody, actor.constructorBody].forEach(visit);
  }
  return out;
}

// Every name a function could mean by a bare `a`, however it was declared.
function declaredNames(fn) {
  const names = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (['RefDecl', 'Assign', 'TypedAssign', 'BareTypeDecl', 'FunctionDecl', 'ForStatement'].includes(node.type) && node.name) names.add(node.name);
    for (const p of Array.isArray(node.params) ? node.params : []) if (p?.name) names.add(p.name);
    for (const item of Array.isArray(node.pattern) ? node.pattern : []) if (item?.name) names.add(item.name);
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(fn);
  return names;
}

export function lowerOwnCellWrites(ast) {
  const classes = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  const fromInside = subscribedFromInside(ast);
  for (const actor of ast.actors) {
    const inherited = resolveSuperclassChain(classes, actor).inheritedState || [];
    const state = new Map([...inherited, ...(actor.stateVarDecls || [])].map(v => [v.name, v]));
    // A cell of an actor this class is declared in is set by a message to it
    // (src/outer_reads.js), and that actor notifies its own subscribers.
    const outer = actor.name ? outerNamesFor(ast, actor) : new Map();
    // A protected or private cell some code here subscribes to (`c.subscribe`):
    // writing it tells those subscribers too.
    const subscribed = new Set();
    const findSubs = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(findSubs); return; }
      const t = node.type === 'SubscribeCall' ? node.target : null;
      if ((t?.type === 'Identifier' || t?.type === 'RefRead') && !t.name.startsWith('@') && state.get(t.name)?.isRef) subscribed.add(t.name);
      for (const v of Object.values(node)) if (v && typeof v === 'object') findSubs(v);
    };
    [actor.functions, actor.initBody, actor.constructorBody].forEach(findSubs);
    // …or code in an actor declared inside this one does.
    for (const name of fromInside.get(actor.name ?? null) || []) if (state.get(name)?.isRef) subscribed.add(name);
    const visit = (node, declared) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const s = node[i];
          visit(s, declared);
          if (s?.type !== 'SetStatement') continue;
          if (!s.name.startsWith('@')) {
            if (declared.has(s.name)) continue;
            if (subscribed.has(s.name)) {
              node.splice(++i, 0, { type: 'ExprStatement', expr: { type: 'CellNotify', cell: s.name, cellTypeEnc: state.get(s.name).typeNameEnc, label: s.name } });
            }
            continue;
          }
          // A public constant (`@magic = "x"`) is state, but not a cell.
          const cell = state.get(s.name);
          if (!cell && outer.has(s.name)) continue;
          if (!cell || cell.isRef === false) throw new Error(`Cannot set '${s.name}' — it isn't a published cell of this ${actor.name ? 'class' : 'file'}`);
          node.splice(++i, 0, { type: 'ExprStatement', expr: { type: 'CellNotify', cell: s.name.slice(1), cellTypeEnc: cell.typeNameEnc } });
        }
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, declared);
    };

    for (const fn of actor.functions || []) {
      if (/^(set|update|new)@/.test(fn.name ?? '')) continue;
      visit(fn.body, declaredNames(fn));
    }
    visit(actor.initBody, declaredNames({ body: actor.initBody }));
  }
}
