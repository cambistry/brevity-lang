// Whether a function exits a label it doesn't declare: one of a `catch` around it
// (`catch #found { over(xs) (x) { if (x == k) #found(x) } }`). Such a function is
// generated inline, inside its `catch`, where the label is in scope.
export function exitsOuterLabel(funcNode) {
  const own = new Set();
  let exits = false;
  const walk = (n) => {
    if (!n || typeof n !== 'object' || exits) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'CatchExpr') own.add(n.label);
    if (n.type === 'LabelInvoke' && !own.has(n.label)) { exits = true; return; }
    for (const k in n) walk(n[k]);
  };
  walk(funcNode.body ?? funcNode.expr);
  return exits;
}
