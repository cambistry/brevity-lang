// What follows an early return runs only on the path past it, so
// `if c { return r }; r = 6; return r` means `if c { return r } else { r = 6; return r }`.
// Rust and Erlang run a guard after all of a body's locals, so nothing may follow one.

const isReturn = (s) => s?.type === 'Return' || s?.type === 'Reply';

function alwaysReturns(body) {
  const last = body?.at(-1);
  if (isReturn(last)) return true;
  return last?.type === 'ImplicitReturn' && last.expr?.type === 'IfExpr' && chainAlwaysReturns(last.expr);
}

function chainAlwaysReturns(ifExpr) {
  if (!alwaysReturns(ifExpr.then?.body) || !ifExpr.else) return false;
  return ifExpr.else.type === 'IfExpr' ? chainAlwaysReturns(ifExpr.else) : alwaysReturns(ifExpr.else.body);
}

// The last `if` of a chain whose every branch returns and which has no final
// `else`: the place the rest of the body goes.
function openEnd(ifExpr) {
  if (!alwaysReturns(ifExpr.then?.body)) return null;
  if (!ifExpr.else) return ifExpr;
  return ifExpr.else.type === 'IfExpr' ? openEnd(ifExpr.else) : null;
}

const isGuard = (s) => s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && openEnd(s.expr);

function asBranchBody(rest) {
  return rest.map(s => s.type === 'Reply' ? { ...s, type: 'Return' } : s);
}

// Branches run binds, writes and calls. A body that also makes an actor, binds
// a function or destructures keeps its order as it is.
function canMove(s, classes) {
  if (isReturn(s) || isGuard(s) || s.type === 'SetStatement' || s.type === 'ExprStatement') return true;
  if (s.type !== 'Assign' && s.type !== 'TypedAssign') return false;
  const value = s.value;
  if (value?.type === 'Function') return false;
  return !(value?.type === 'FunctionCallExpr' && classes.has(value.callee?.name));
}

// A leading guard of a function already runs before its locals.
function lowerBody(body, isBranch, classes) {
  for (let i = isBranch ? 0 : 1; i < body.length; i++) {
    const rest = body.slice(i + 1);
    const moves = rest.some(s => !isReturn(s) && !isGuard(s));
    if (!isGuard(body[i]) || !moves || !alwaysReturns(rest) || !rest.every(s => canMove(s, classes))) continue;
    openEnd(body[i].expr).else = { type: 'IfBranch', body: asBranchBody(rest) };
    body.length = i + 1;
    return;
  }
}

function walk(node, classes) {
  if (Array.isArray(node)) {
    node.forEach(item => walk(item, classes));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.body) && (node.type === 'FunctionDecl' || node.type === 'Function' || node.type === 'IfBranch')) {
    lowerBody(node.body, node.type === 'IfBranch', classes);
  }
  Object.values(node).forEach(value => walk(value, classes));
}

export function lowerBranchOrder(ast) {
  const classes = new Set(['Self']);
  (ast.actors || []).forEach(a => { if (a.name) classes.add(a.name); });
  (ast.dependencies || []).forEach(d => classes.add(d.name));
  walk(ast.actors, classes);
}
