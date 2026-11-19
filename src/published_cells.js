// An actor's published cell, seen from its own functions. `@a *Integer` is `@a` inside
// as well as out: a bare `a` names a different, private cell. Writing `@a` tells its
// subscribers, as a `set` from outside does.

import { resolveSuperclassChain } from './subclass.js';
import { outerNamesFor } from './outer_reads.js';

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
  for (const actor of ast.actors) {
    const inherited = resolveSuperclassChain(classes, actor).inheritedState || [];
    const state = new Map([...inherited, ...(actor.stateVarDecls || [])].map(v => [v.name, v]));
    const params = new Set((actor.initParams || []).map(p => p.name));
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
    const check = (name) => {
      if (name.startsWith('@') || state.has(name) || params.has(name) || !state.get('@' + name)) return;
      throw new Error(`'${name}' isn't in scope — the published cell is '@${name}'`);
    };

    const visit = (node, declared) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const s = node[i];
          visit(s, declared);
          if (s?.type !== 'SetStatement') continue;
          if (!s.name.startsWith('@')) {
            if (declared.has(s.name)) continue;
            check(s.name);
            if (subscribed.has(s.name)) {
              node.splice(++i, 0, { type: 'ExprStatement', expr: { type: 'CellNotify', cell: s.name, cellType: state.get(s.name).typeName, label: s.name } });
            }
            continue;
          }
          // A public constant (`@magic = "x"`) is state, but not a cell.
          const cell = state.get(s.name);
          if (!cell && outer.has(s.name)) continue;
          if (!cell || cell.isRef === false) throw new Error(`Cannot set '${s.name}' — it isn't a published cell of this ${actor.name ? 'class' : 'file'}`);
          node.splice(++i, 0, { type: 'ExprStatement', expr: { type: 'CellNotify', cell: s.name.slice(1), cellType: cell.typeName } });
        }
        return;
      }
      if ((node.type === 'Identifier' || node.type === 'RefRead') && !declared.has(node.name)) check(node.name);
      // A reply field can name its value: `return a`, `return :a`.
      const shorthand = node.type ? null : (node.sigil ?? (node.positional && !node.expr && !node.value ? node.name : null));
      if (typeof shorthand === 'string' && !declared.has(shorthand)) check(shorthand);
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, declared);
    };

    for (const fn of actor.functions || []) {
      if (/^(set|update|new)@/.test(fn.name ?? '')) continue;
      visit(fn.body, declaredNames(fn));
    }
    visit(actor.initBody, declaredNames({ body: actor.initBody }));
  }
}
