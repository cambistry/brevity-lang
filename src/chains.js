// A call on the result of a call: `c.inc!(5).inc!(2).total`. The JS backend chains
// through promises at runtime. Rust and Erlang bind each receiver to a temp first,
// so every call in a chain is a plain call on a bound name.

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
