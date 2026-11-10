// Param defaults (see notes/param-default-expressions-2026-11-10.md).
//
// A default is a literal or any expression. It runs in the callee, after
// every supplied arg is bound, and may name any param. Defaults that name
// other params run after them; a cycle is a compile error.

const LITERALS = new Set([
  'IntLiteral', 'DecimalLiteral', 'FloatLiteral', 'StringLiteral', 'BoolLiteral', 'NullLiteral',
]);

export function isLiteralDefault(node) {
  if (!node) return false;
  if (LITERALS.has(node.type)) return true;
  return node.type === 'ObjectLiteral' && (node.args?.length ?? 0) === 0;
}

// The names an expression mentions. Over-approximate: any node with a
// `name` that reads a value counts.
const NAME_NODES = new Set(['Identifier', 'RefRead', 'RefArg', 'FnRef']);
function namesIn(node, out = new Set()) {
  if (Array.isArray(node)) { for (const n of node) namesIn(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (NAME_NODES.has(node.type) && typeof node.name === 'string') out.add(node.name);
  for (const v of Object.values(node)) if (v && typeof v === 'object') namesIn(v, out);
  return out;
}

// The params in binding order: those without an expression default first, in
// source order; then those with one, each after the params its default names.
export function orderParamsForDefaults(params) {
  const isLate = p => p.defaultValue && !isLiteralDefault(p.defaultValue);
  const early = params.filter(p => !isLate(p));
  const late = params.filter(isLate);
  if (late.length === 0) return params;
  const lateByName = new Map(late.map(p => [p.name, p]));
  const ordered = [];
  const state = new Map(); // name → 'visiting' | 'done'
  const visit = (p, path) => {
    const s = state.get(p.name);
    if (s === 'done') return;
    if (s === 'visiting') {
      const cycle = [...path.slice(path.indexOf(p.name)), p.name];
      throw new Error(`Param defaults form a cycle: ${cycle.join(' → ')}`);
    }
    state.set(p.name, 'visiting');
    for (const n of namesIn(p.defaultValue)) {
      const dep = lateByName.get(n);
      if (dep && dep !== p) visit(dep, [...path, p.name]);
      else if (dep === p) throw new Error(`Param '${p.name}' default names itself`);
    }
    state.set(p.name, 'done');
    ordered.push(p);
  };
  for (const p of late) visit(p, []);
  return [...early, ...ordered];
}
