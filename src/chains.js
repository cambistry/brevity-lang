// A call on the result of a call: `c.inc!(5).inc!(2).total`. The JS backend chains
// through promises at runtime. Rust and Erlang bind each receiver to a temp first,
// so every call in a chain is a plain call on a bound name.

import { resolveSuperclassChain } from './subclass.js';

const isCtorCall = (node, actorNames) =>
  node?.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && actorNames.has(node.callee.name);

const isChainReceiver = (node, actorNames) =>
  (node?.type === 'DotCallExpr' && node.method?.endsWith('!')) ||
  (node?.type === 'DotAccessExpr' && node.property?.endsWith('!')) ||
  isCtorCall(node, actorNames);

const isMemberOnCall = (node, actorNames) =>
  (node?.type === 'DotCallExpr' || node?.type === 'DotAccessExpr') && isChainReceiver(node.object, actorNames);

// Whether every return path of a `!` function yields self, so that its result is
// a handle to the receiver. `settleBangDecls` has already made each path explicit.
export function returnsOnlySelf(fn) {
  let only = true;
  const walk = (n) => {
    if (!n || typeof n !== 'object' || n.type === 'Function') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if ((n.type === 'Reply' || n.type === 'Return') && !n.fields?.[0]?.selfReturn) only = false;
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(fn.body);
  return only;
}

// A member of a chain needs a receiver. On a class in this file a `!` function that
// returns a value isn't one: a typed value only decodes against a declared type, so
// it has to be bound first. A remote's return shape isn't checked here.
export function checkChainReceivers(program) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name, a]));
  const classOf = (node, locals) => {
    if (node?.type === 'FunctionCallExpr') return classes.get(node.callee?.name) ?? null;
    if (node?.type === 'Identifier') return locals.get(node.name) ?? null;
    if ((node?.type === 'DotCallExpr' && node.method?.endsWith('!')) || (node?.type === 'DotAccessExpr' && node.property?.endsWith('!'))) return classOf(node.object, locals);
    return null;
  };
  const check = (node, locals) => {
    if (!node || typeof node !== 'object' || node.type === 'Function') return;
    if (Array.isArray(node)) { node.forEach(n => check(n, locals)); return; }
    if (node.type === 'Assign' && classes.has(node.value?.callee?.name)) locals.set(node.name, classes.get(node.value.callee.name));
    if ((node.type === 'DotCallExpr' || node.type === 'DotAccessExpr') && node.object?.type === 'DotCallExpr' && node.object.method?.endsWith('!')) {
      const fn = classOf(node.object.object, locals)?.functions?.find(f => f.name === '@' + node.object.method);
      if (fn && !returnsOnlySelf(fn)) {
        throw new Error(`'${node.object.method}' returns a value here, so nothing can be chained on it — bind it first`);
      }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') check(v, locals);
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if ((node.type === 'FunctionDecl' || node.type === 'Function') && Array.isArray(node.body)) check(node.body, new Map());
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(program.actors);
}

// A member call's args, in the shape a plain call's take.
function callArgsOf(sendArgs = []) {
  const args = sendArgs.filter(a => a.positional).map(a => a.expr);
  const named = sendArgs.filter(a => !a.positional);
  if (named.length) args.push({ type: 'NamedArgsBag', fields: Object.fromEntries(named.map(a => [a.name, a.expr ?? { type: 'Identifier', name: a.name }])) });
  return args;
}

const CHAIN_ROOTS = { ExprStatement: 'expr', ImplicitReturn: 'expr', Assign: 'value', TypedAssign: 'value', SetStatement: 'value', DestructureAssign: 'source' };

// A chain from a call on this actor: `@add!(1).add!(2)`, `bump!(1).total`. A self-return
// is this actor, so the chain is a run of self-calls: each `!` call becomes a statement,
// and the member after it a self-call. That moves the call ahead of the rest of its
// statement, so only a chain that's the statement's whole value can be lowered. The
// caller reports any other.
export function lowerSelfChains(program) {
  const classes = new Map(program.actors.filter(a => a.name).map(a => [a.name.replace(/^@/, ''), a]));
  for (const actor of program.actors) {
    const own = [...resolveSuperclassChain(classes, actor).inheritedFunctions, ...(actor.functions || [])]
      .filter(f => f.type === 'FunctionDecl' && typeof f.name === 'string' && !f.actorDef && !f.emptyOverload);
    const overloads = (name) => {
      const bare = name.replace(/^[@#]/, '');
      return own.filter(f => (name === bare ? f.name.replace(/^[@#]/, '') === bare : f.name === name));
    };

    const asSelfCall = (node) => {
      const member = node.method ?? node.property;
      if (overloads('@' + member).length) return { type: 'FunctionCallExpr', callee: { type: 'Identifier', name: '@' + member }, args: callArgsOf(node.args) };
      if (node.type === 'DotAccessExpr' && actor.stateVarDecls?.some(d => d.name === '@' + member)) return { type: 'RefRead', name: '@' + member };
      throw new Error(`'${member}' isn't a public function of this actor, so a chain can't reach it`);
    };

    const lower = (node, hoisted, localFunctions) => {
      if (node?.type !== 'DotCallExpr' && node?.type !== 'DotAccessExpr') return node;
      const object = lower(node.object, hoisted, localFunctions);
      const head = object?.type === 'FunctionCallExpr' && object.callee?.type === 'Identifier' ? object.callee.name : null;
      if (!head?.endsWith('!') || localFunctions.has(head) || !overloads(head).length) {
        return object === node.object ? node : { ...node, object };
      }
      if (!overloads(head).every(returnsOnlySelf)) {
        throw new Error(`'${head}' returns a value here, so nothing can be chained on it — bind it first`);
      }
      hoisted.push({ type: 'ExprStatement', expr: object });
      return asSelfCall(node);
    };

    const lowerRoot = (holder, key, stmts, i, localFunctions) => {
      const hoisted = [];
      holder[key] = lower(holder[key], hoisted, localFunctions);
      if (hoisted.length) stmts.splice(i, 0, ...hoisted);
    };

    const visit = (node, localFunctions) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const s = node[i];
          const field = (s?.type === 'Reply' || s?.type === 'Return') && s.fields?.length === 1 ? s.fields[0] : null;
          if (CHAIN_ROOTS[s?.type]) lowerRoot(s, CHAIN_ROOTS[s.type], node, i, localFunctions);
          else if (field) lowerRoot(field, field.expr ? 'expr' : 'value', node, i, localFunctions);
          visit(s, localFunctions);
        }
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, localFunctions);
    };

    // A bare name reaches a public function, unless something nearer holds that name.
    const fileNames = new Set([
      ...(actor.stateVarDecls || []).map(d => d.name),
      ...(actor.initParams || []).map(p => p.name),
      ...(actor.initBody || []).filter(s => s.name).map(s => s.name),
      ...(program.dependencies || []).map(d => d.name),
      ...classes.keys(),
    ]);
    const nameBareCalls = (node, locals) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => nameBareCalls(n, locals)); return; }
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier') {
        const { name } = node.callee;
        if (!/^[@#]/.test(name) && !locals.has(name) && !fileNames.has(name) && overloads('@' + name).length && !own.some(f => f.name === name || f.name === '#' + name)) {
          node.callee = { ...node.callee, name: '@' + name };
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') nameBareCalls(v, locals);
    };

    for (const fn of actor.functions || []) {
      const localFunctions = new Set();
      const locals = new Set((fn.params || []).map(p => p.name));
      const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if ((node.type === 'Assign' || node.type === 'TypedAssign') && node.value?.type === 'Function') localFunctions.add(node.name);
        if (typeof node.name === 'string' && ['Assign', 'TypedAssign', 'RefDecl'].includes(node.type)) locals.add(node.name);
        if (node.type === 'Function') for (const p of node.params || []) locals.add(p.name);
        if (node.type === 'DestructureAssign') for (const item of node.pattern || []) if (item.name) locals.add(item.name);
        for (const v of Object.values(node)) if (v && typeof v === 'object') collect(v);
      };
      collect(fn.body);
      visit(fn.body, localFunctions);
      nameBareCalls(fn.body, locals);
    }
  }
}

export function lowerChains(program) {
  const actorNames = new Set(program.actors.map(a => a.name).filter(Boolean));
  let nextTemp = 0;
  // Hoists the receivers in `node` into temps pushed onto `hoisted`, in order.
  const hoistIn = (node, hoisted) => {
    if (!node || typeof node !== 'object' || node.type === 'Function') return;
    if (Array.isArray(node)) {
      // A nested statement list keeps its own temps.
      if (node.some(isStatementLike)) { lowerList(node); return; }
      node.forEach(n => hoistIn(n, hoisted));
      return;
    }
    if (isMemberOnCall(node, actorNames)) {
      hoistIn(node.object, hoisted);
      const name = `chain_tmp${nextTemp++}`;
      hoisted.push({ type: 'Assign', name, value: node.object });
      node.object = { type: 'Identifier', name };
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') hoistIn(v, hoisted);
  };
  const lowerList = (stmts) => {
    for (let i = stmts.length - 1; i >= 0; i--) {
      const s = stmts[i];
      // A loop condition runs on every pass, so it can't be hoisted out.
      const hoisted = [];
      if (s?.type === 'WhileStatement') { lowerList(s.body); continue; }
      hoistIn(s, hoisted);
      if (hoisted.length) stmts.splice(i, 0, ...hoisted);
    }
  };
  const isStatementLike = (n) => n && typeof n === 'object' && STATEMENTS.has(n.type);
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if ((node.type === 'FunctionDecl' || node.type === 'Function') && Array.isArray(node.body)) lowerList(node.body);
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(program.actors);
}

const STATEMENTS = new Set(['Assign', 'TypedAssign', 'ExprStatement', 'Reply', 'Return', 'ImplicitReturn', 'SetStatement',
  'IfStatement', 'WhileStatement', 'SilentTerminator', 'RefDecl', 'DestructureAssign', 'SpawnStatement', 'ActorSetStatement', 'ActorFieldSet']);
