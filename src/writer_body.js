// The body of a function that writes: a `!` function, or an anonymous function in a
// `=>` slot. It has no tail return, falling off the end returns self, and `return v`
// returns v. See notes/mutation-suffix-2026-10-31.md.

import * as AST from './ast.js';

const PURE_TAIL = new Set(['Identifier', 'RefRead', 'BinaryExpr', 'UnaryExpr', 'IntLiteral', 'BigIntLiteral', 'DecimalLiteral',
  'FloatLiteral', 'NumberLiteral', 'TextLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral', 'ListLiteral', 'StructureLiteral', 'ObjectLiteral', 'Function']);

export const selfReturnFields = () => [{ selfReturn: true, positional: true, expr: AST.selfValue(), type: null }];
export const isReturn = (s) => s?.type === 'Reply' || s?.type === 'Return';
export const isSelfReturn = (s) => s.fields?.[0]?.selfReturn === true;

// How errors name the function: `'bump!' is a '!' function`, or for an anonymous
// one, by the slot it fills.
const who = (fn) => (fn.name ? `'${fn.name}'` : 'This function');
const tailValueError = (fn) => new Error(fn.name
  ? `'${fn.name}' is a '!' function, which has no tail return — a final value is discarded. Did you mean 'return'?`
  : `This function writes, in a '=>' slot, so it has no tail return — a final value is discarded. Did you mean 'return'?`);

// Whether a statement list always returns ('returns') or can reach its end
// ('falls'), rejecting tail values and dropping implicit-return wrappers.
function settleTail(fn, stmts) {
  const last = stmts[stmts.length - 1];
  if (!last) return 'falls';
  // A final write is a statement, even in arrow form: `bump! = (i) -> a <- i`. An
  // anonymous function's arrow-form write was already moved ahead of a read of its
  // cell (`fromTailWrite`), which in a writer is the statement alone.
  const tailWrite = last.type === 'ImplicitReturn' ? last.expr
    : (isReturn(last) && last.tailValue && last.fields?.length === 1 ? last.fields[0].expr : null);
  if (tailWrite?.type === 'SetExpr') {
    stmts[stmts.length - 1] = AST.setStatement(tailWrite.name, tailWrite.value, { updateOp: tailWrite.updateOp });
    return 'falls';
  }
  if (last.fromTailWrite) {
    stmts.pop();
    return 'falls';
  }
  if (isReturn(last)) {
    if (last.tailValue) {
      if (isSelfReturn(last)) throw new Error(`${who(fn)} returns self by falling off the end — delete the bare 'self', or write 'return self'`);
      throw tailValueError(fn);
    }
    return 'returns';
  }
  if (last.type === 'ImplicitReturn' && last.expr?.type === 'IfExpr') {
    settleIf(fn, last.expr);
    // Each path through a tail `if` ends the function, so each returns self
    // unless it says otherwise. That gives backends their one early-return form.
    return returnSelfFromBranches(last.expr);
  }
  if (last.type === 'ImplicitReturn' || last.type === 'ExprStatement') {
    if (PURE_TAIL.has(last.expr?.type)) throw tailValueError(fn);
    if (last.type === 'ImplicitReturn') stmts[stmts.length - 1] = AST.exprStatement(last.expr);
  }
  return 'falls';
}

function returnSelfFromBranches(ifExpr) {
  const close = (branch) => {
    if (branch.type === 'IfExpr') return returnSelfFromBranches(branch);
    if (!isReturn(branch.body[branch.body.length - 1])) branch.body.push(AST.returnNode(selfReturnFields()));
    return 'returns';
  };
  const thenPath = close(ifExpr.then);
  if (!ifExpr.else) return 'falls';
  const elsePath = close(ifExpr.else);
  return thenPath === 'returns' && elsePath === 'returns' ? 'returns' : 'falls';
}

function settleBranch(fn, branch) {
  if (branch.type === 'IfExpr') return settleIf(fn, branch);
  if (!branch.body) throw tailValueError(fn);
  return settleTail(fn, branch.body);
}

function settleIf(fn, ifExpr) {
  const thenPath = settleBranch(fn, ifExpr.then);
  if (!ifExpr.else) return 'falls';
  const elsePath = settleBranch(fn, ifExpr.else);
  return thenPath === 'returns' && elsePath === 'returns' ? 'returns' : 'falls';
}

// Visits returns on this function's own paths, not those of nested functions.
export function eachReturn(node, visit) {
  if (!node || typeof node !== 'object' || node.type === 'Function') return;
  if (Array.isArray(node)) { node.forEach(n => eachReturn(n, visit)); return; }
  if (isReturn(node)) { visit(node); return; }
  for (const v of Object.values(node)) if (v && typeof v === 'object') eachReturn(v, visit);
}

// Makes each path of a writer's body explicit, and says what it yields: 'self',
// 'value' when every path returns one, or 'both'.
export function settleWriterBody(fn) {
  const body = fn.body || (fn.body = []);
  const paths = settleTail(fn, body);
  let returnsValue = false;
  let returnsSelf = false;
  eachReturn(body, (r) => {
    // A bare `return` exits the way falling off the end does.
    if (!r.fields?.length) r.fields = selfReturnFields();
    if (isSelfReturn(r)) returnsSelf = true;
    else returnsValue = true;
  });
  if (paths === 'returns') return returnsValue ? (returnsSelf ? 'both' : 'value') : 'self';
  if (returnsValue) throw new Error(`${who(fn)} returns a value on one path and falls off the end on another — write 'return self' to make that deliberate`);
  body.push(AST.reply(selfReturnFields()));
  return 'self';
}
