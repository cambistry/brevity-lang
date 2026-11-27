// A message send (`k.n()`, `Svc.get()`, `@R.pubFn()`) used as an operand: of an
// operator, as an arg, in interpolated text, as a condition, as a list element.
// Each target's genExpr emits it as its reply's one value (on js, the awaited
// reply's). A send as a statement's own value is taken by the statement.
const SEND_OPERANDS = new WeakSet();

const isSendNode = (n) => n?.type === 'DotCallExpr' || n?.type === 'DotAccessExpr';
const ARG_CARRIERS = new Set(['FunctionCallExpr', 'DotCallExpr', 'ListMethodExpr', 'TextMethodExpr', 'MathMethodExpr', 'BlobMethodExpr', 'GraphemeTextMethodExpr']);

export function markSendOperands(ast) {
  const mark = (n) => { if (isSendNode(n)) SEND_OPERANDS.add(n); };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'BinaryExpr') { mark(n.left); mark(n.right); }
    if (n.type === 'UnaryExpr') mark(n.operand ?? n.expr);
    if (n.type === 'InterpolatedString') for (const p of n.parts || []) mark(p.expr);
    if (ARG_CARRIERS.has(n.type)) for (const a of n.args || []) mark(a?.type === undefined || a.expr ? a.expr : a);
    if (n.type === 'IfExpr' || n.type === 'WhileStatement') mark(n.cond);
    if (n.type === 'ListLiteral') for (const e of n.elements || []) mark(e);
    for (const k in n) if (k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k]);
  };
  walk(ast.actors);
}

export const isSendOperand = (n) => SEND_OPERANDS.has(n);
