// Parens are optional on a call with no arguments (notes/zero-arity-calls-2026-11-06.md).
// A bare name of one of the actor's functions, or of a local bound to a function
// literal, is a call: `get`, `@get`, `bump!`. The function itself is `&get`, so
// `get as Function` is an error naming it. A name the function declares (a
// param, a local, a loop variable) is that local, as before.

import { buildActorMap, resolveSuperclassChain } from './subclass.js';

const DECLS = new Set(['Assign', 'TypedAssign', 'RefDecl', 'StateAssign']);

// Every name a function declares, anywhere in its body. Shadowing is checked
// against all of them at once: a function name reused as a local is that local.
function declaredNames(fn) {
  const names = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (DECLS.has(n.type) && typeof n.name === 'string') names.add(n.name);
    for (const p of Array.isArray(n.params) ? n.params : []) if (p?.name) names.add(p.name);
    for (const p of Array.isArray(n.pattern) ? n.pattern : []) if (p?.name) names.add(p.name);
    if (typeof n.variable === 'string') names.add(n.variable);
    if (typeof n.var === 'string') names.add(n.var);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(fn);
  return names;
}

// Locals bound directly to a function literal, with the literal.
function functionLocals(fn) {
  const out = new Map();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if ((n.type === 'Assign' || n.type === 'TypedAssign') && typeof n.name === 'string' && n.value?.type === 'Function') out.set(n.name, n.value);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(fn.body);
  return out;
}

const required = (params = []) => params.filter(p => !p.rest && p.default === undefined && p.defaultValue === undefined && !p.optional);

export function lowerBareCalls(ast) {
  const classes = buildActorMap(ast);
  for (const actor of ast.actors || []) {
    const { inheritedFunctions = [] } = actor.name ? resolveSuperclassChain(classes, actor) : {};
    const byName = new Map();
    for (const f of [...inheritedFunctions, ...(actor.functions || [])]) {
      if (f?.type !== 'FunctionDecl' || typeof f.name !== 'string' || f.actorDef) continue;
      if (!byName.has(f.name)) byName.set(f.name, []);
      byName.get(f.name).push(f);
    }
    const cells = new Set((actor.stateVarDecls || []).map(d => d.name));
    for (const p of actor.initParams || []) if (p?.name) cells.add(p.name);

    for (const fn of actor.functions || []) {
      if (fn?.type !== 'FunctionDecl' || !Array.isArray(fn.body)) continue;
      const declared = declaredNames(fn);
      const lambdas = functionLocals(fn);
      // What a bare `name` means here: a call (zero required params), an error,
      // or nothing to do.
      const resolve = (name) => {
        if (lambdas.has(name)) return { params: lambdas.get(name).params ?? [] };
        if (declared.has(name) || cells.has(name)) return null;
        const decls = byName.get(name);
        if (!decls) return null;
        const zero = decls.find(d => required(d.params).length === 0);
        return { params: zero ? [] : decls[0].params ?? [] };
      };
      const asCall = (name, node) => {
        if (node?.attestedAs === 'Function') {
          throw new Error(`'${name} as Function' — the function itself is '&${name}'`);
        }
        const target = resolve(name);
        if (!target) return null;
        if (required(target.params).length > 0) {
          throw new Error(`'${name}' takes arguments — call it '${name}(…)', or use &${name} for the function itself`);
        }
        const call = { type: 'FunctionCallExpr', callee: { type: 'Identifier', name }, args: [] };
        if (node?.attestedAs) call.attestedAs = node.attestedAs;
        return call;
      };
      const visit = (node) => {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i++) {
            const s = node[i];
            const bare = s?.type === 'ImplicitReturn' && s.expr?.type === 'Identifier';
            node[i] = visit(s);
            // A bare name read as a tail mid-body is a call statement: `bump!`.
            if (bare && i < node.length - 1 && s.expr.type === 'FunctionCallExpr') node[i] = { type: 'ExprStatement', expr: s.expr };
          }
          return node;
        }
        if (node.type === 'Identifier') return asCall(node.name, node) ?? node;
        if ((node.type === 'Reply' || node.type === 'Return') && Array.isArray(node.fields)) {
          for (const f of node.fields) {
            if (f?.positional && f.name && !f.expr && !f.spread) {
              const call = asCall(f.name, f.type === 'Function' ? { attestedAs: 'Function' } : f);
              if (call) { f.expr = call; delete f.name; }
            } else if (f?.sigil && !f.ref) {
              const call = asCall(f.sigil, f);
              if (call) { f.key = f.sigil; f.value = call; delete f.sigil; }
            }
          }
        }
        for (const [k, v] of Object.entries(node)) {
          if (!v || typeof v !== 'object') continue;
          // A callee is already called. A subscription names the function it
          // subscribes to: `#count.subscribe (v) { … }`.
          if (k === 'callee' && v.type === 'Identifier') continue;
          if (k === 'target' && node.type === 'SubscribeCall' && v.type === 'Identifier') continue;
          node[k] = visit(v);
        }
        return node;
      };
      visit(fn.body);
    }
  }
}

// A bare member of something known to be an actor is a call: `C().total`,
// `c.total` for a `c = C()`, `Svc.ping` for a function in `Svc`'s doc. Members of
// anything else (a typed value, an Object, an unknown) stay reads, as before;
// on an actor the two are the same op.
export function lowerBareMemberCalls(ast, remotesParsed = {}) {
  const classes = new Set(ast.actors.filter(a => a.name).map(a => a.name));
  for (const actor of ast.actors) for (const f of actor.functions || []) if (f.actorDef && typeof f.name === 'string') classes.add(f.name);
  const isCtor = (n) => n?.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && classes.has(n.callee.name);
  for (const actor of ast.actors || []) {
    for (const fn of actor.functions || []) {
      if (fn?.type !== 'FunctionDecl' || !Array.isArray(fn.body)) continue;
      const actorLocals = new Set();
      const shadowed = new Set();
      const scan = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(scan); return; }
        if ((n.type === 'Assign' || n.type === 'TypedAssign') && typeof n.name === 'string') {
          if (isCtor(n.value) || (n.type === 'TypedAssign' && classes.has(n.typeName))) actorLocals.add(n.name);
          else shadowed.add(n.name);
        }
        for (const v of Object.values(n)) if (v && typeof v === 'object') scan(v);
      };
      scan(fn.body);
      for (const p of fn.params || []) if (p?.name) { if (classes.has(p.type)) actorLocals.add(p.name); else shadowed.add(p.name); }
      const isActor = (o) => isCtor(o) ||
        (o?.type === 'Identifier' && actorLocals.has(o.name) && !shadowed.has(o.name));
      const docFunction = (o, m) => o?.type === 'Identifier' && !shadowed.has(o.name) && !actorLocals.has(o.name) &&
        Array.isArray(remotesParsed[o.name]?.[m]);
      const visit = (node) => {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = visit(node[i]); return node; }
        for (const [k, v] of Object.entries(node)) {
          // A subscription names the member it subscribes to: `Pub.pub.subscribe …`.
          if (k === 'target' && node.type === 'SubscribeCall') continue;
          if (v && typeof v === 'object') node[k] = visit(v);
        }
        if (node.type === 'DotAccessExpr' && (isActor(node.object) || docFunction(node.object, node.property))) {
          return { ...node, type: 'DotCallExpr', method: node.property, args: [], property: undefined };
        }
        return node;
      };
      visit(fn.body);
    }
  }
}
