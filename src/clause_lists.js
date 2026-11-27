// A clause list (notes/clause-lists-2026-11-25.md): a list literal whose entries are
// clauses, `head -> value`, is a function. It's tried clause by clause; the first
// whose heads match answers, and no match is `unhandled`.
//
//   key |> [
//     "enter" | "esc" -> back     a literal pattern, or a union of them
//     (x == 1) -> do!             a condition: the input is ignored
//     0, y -> y                   one head per argument; a name binds it
//     else -> other               the catch-all, last
//   ]
//
// It compiles to one function of the list's arity, returning the `if` chain the
// clauses mean: each clause's tests in order, its bindings renamed to the
// function's params. With no catch-all, the chain ends in `NoMatch`, which fails as
// an unhandled call does.

import * as AST from './ast.js';
import { renameIn } from './super_calls.js';

const LITERAL_TYPES = { StringLiteral: 'Text', IntLiteral: 'Integer', FloatLiteral: 'Float', DecimalLiteral: 'Decimal', BoolLiteral: 'Boolean' };

// A clause: `{ heads, condition, isElse, body }`, each head `{ kind: 'lit', values }`
// or `{ kind: 'bind', name, type }`, the body `{ expr }` or `{ stmts }`.
export const isPatternClause = (c) => c.isElse || !!c.condition || c.heads.some(h => h.kind === 'lit');

// Whether the clauses match their input: a literal head does, a condition doesn't.
export const matchesInput = (clauses) => clauses.some(c => c.heads.some(h => h.kind === 'lit'));

const and = (a, b) => ({ ...AST.ifExpr(a, AST.ifBranch({ expr: b }), AST.ifBranch({ expr: AST.boolLiteral(false) })), boolOp: 'and' });
const or = (a, b) => ({ ...AST.ifExpr(a, AST.ifBranch({ expr: AST.boolLiteral(true) }), AST.ifBranch({ expr: b })), boolOp: 'or' });

function shownAs(node, name) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => shownAs(n, name)); return; }
  if ((node.type === 'Identifier' || node.type === 'RefRead') && node.name === name) node.shownAs ??= name;
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') shownAs(v, name);
}

// A name the clause binds is a param, though a cell of that name was in scope when
// it was read: a read of it is the param's.
function asParam(node, name) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => asParam(n, name)); return; }
  if (node.type === 'RefRead' && node.name === name) node.type = 'Identifier';
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') asParam(v, name);
}

export function lowerClauseList(clauses) {
  const elseAt = clauses.findIndex(c => c.isElse || (!c.condition && c.heads.every(h => h.kind === 'bind' && !h.type)));
  if (elseAt >= 0 && elseAt < clauses.length - 1) {
    throw new Error("In a clause list, a clause that takes any value ('else', or bare names) is the last: the ones after it can never match");
  }
  // A condition alone ignores the input, so it fits any arity.
  const arities = new Set(clauses.filter(c => !c.isElse && c.heads.length).map(c => c.heads.length));
  if (arities.size > 1) throw new Error(`The clauses of a list take the same number of arguments: here ${[...arities].join(' and ')}`);
  const arity = [...arities][0] ?? 1;
  const params = [];
  for (let k = 0; k < arity; k++) {
    const types = new Set(clauses.filter(c => c.heads[k]).map(c => {
      const h = c.heads[k];
      return h.kind === 'bind' ? h.type : LITERAL_TYPES[h.values[0].type] ?? null;
    }).filter(Boolean));
    if (types.size > 1) throw new Error(`In a clause list, the heads for one argument share a type: here ${[...types].map(t => `'${t}'`).join(' and ')}`);
    params.push({ name: `__clause${k}`, type: [...types][0] ?? null, positional: true });
  }
  const arg = (k) => AST.identifier(params[k].name);
  const branch = (c) => (c.body.stmts ? AST.ifBranch({ body: c.body.stmts }) : AST.ifBranch({ expr: c.body.expr }));
  // From the last clause up: each clause's tests choose its value, else the rest's.
  let chain = AST.ifBranch({ expr: { type: 'NoMatch' } });
  for (let i = clauses.length - 1; i >= 0; i--) {
    const c = clauses[i];
    c.heads.forEach((h, k) => {
      if (h.kind !== 'bind') return;
      // A read keeps the name it was written with, for the errors about it.
      shownAs(c.body, h.name);
      renameIn(c.body, h.name, params[k].name);
      if (c.condition) renameIn(c.condition, h.name, params[k].name);
      asParam(c.body, params[k].name);
      if (c.condition) asParam(c.condition, params[k].name);
    });
    const tests = [];
    c.heads.forEach((h, k) => {
      if (h.kind !== 'lit') return;
      tests.push(h.values.map(v => AST.binaryExpr('===', arg(k), v)).reduce(or));
    });
    if (c.condition) tests.push(c.condition);
    chain = tests.length ? AST.ifExpr(tests.reduce(and), branch(c), chain) : branch(c);
  }
  // The function returns the chain's value; a list of one catch-all is its body.
  const body = chain.type === 'IfExpr'
    ? [AST.reply([{ expr: chain, type: null, positional: true }])]
    : chain.body ?? [AST.reply([{ expr: chain.expr, type: null, positional: true }])];
  const fn = AST.functionNode(params, body);
  return Object.assign(fn, { clauseList: true, ...(matchesInput(clauses) && { matchesInput: true }) });
}
