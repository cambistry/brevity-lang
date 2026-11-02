// What a function can return, across all its paths. A generated doc prints this, and a
// caller's annotation is checked against it. Each alternative is a list of slots, and
// paths with the same slots merge, so one set of paths has one spelling:
//
//   if b { return 1 }; return "x"                   (Integer | Text)
//   if b { return a: 1 }; return 2, n: "x"          (a: Integer) | (Integer, n: Text)
//
// A slot whose type can't be inferred is `Anything`, which absorbs the rest of its union.

import { inferExprType } from './inference.js';

export function scopeTypes(params, body, outer = null) {
  const env = new Map(outer ?? []);
  for (const p of params || []) {
    if (p.rest) continue;
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body || []) {
    if (s?.type === 'TypedAssign' || s?.type === 'BareTypeDecl') {
      env.set(s.name, s.typeName);
    } else if (s?.type === 'Assign') {
      const t = inferExprType(s.value, env);
      if (t) env.set(s.name, t);
    } else if (s?.type === 'RefDecl' && s.typeName) {
      env.set(s.name, s.typeName);
    }
  }
  return env;
}

// Every return on the function's own paths, with the locals in scope at each.
export function returnPaths(fn, outer = null) {
  const paths = [];
  const walk = (node, env) => {
    if (!node || typeof node !== 'object' || node.type === 'Function') return;
    if (Array.isArray(node)) {
      const scope = scopeTypes(null, node, env);
      node.forEach(n => walk(n, scope));
      return;
    }
    if (node.type === 'Reply' || node.type === 'Return') {
      paths.push({ node, env });
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, env);
  };
  const root = scopeTypes(fn.params, null, outer);
  walk(fn.body, root);
  // A tail `if` returns the value each of its branches ends in.
  const tailIf = (branch, env) => {
    if (branch?.type === 'IfExpr') {
      tailIf(branch.then, env);
      tailIf(branch.else, env);
      return;
    }
    const scope = scopeTypes(null, branch?.body, env);
    const last = branch?.body?.at(-1);
    if (last?.type !== 'ImplicitReturn') return;
    if (last.expr?.type === 'IfExpr') tailIf(last.expr, scope);
    else paths.push({ node: { fields: [{ positional: true, expr: last.expr, type: last.typeName }] }, env: scope });
  };
  const tail = fn.body.at(-1);
  if (tail?.type === 'ImplicitReturn' && tail.expr?.type === 'IfExpr') tailIf(tail.expr, root);
  return paths;
}

function fieldType(field, env) {
  if (field?.type) return field.type;
  const expr = field?.value ?? field?.expr;
  if ('sigil' in field) return env.get(field.sigil) || inferExprType(expr, env);
  // A positional field can name a local: `-> retries`.
  if (field.name && !expr) return env.get(field.name);
  return inferExprType(expr, env);
}

const fieldName = (field) => ('sigil' in field ? field.sigil : field.key) ?? null;

export const unionMembers = (type) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of type) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '|' && depth === 0) { parts.push(current.trim()); current = ''; } else current += c;
  }
  parts.push(current.trim());
  return parts;
};

const mergeTypes = (a, b) => {
  const members = [...new Set([...unionMembers(a), ...unionMembers(b)])];
  return members.includes('Anything') ? 'Anything' : members.join(' | ');
};

// `{ alternatives: [[{ name, type }]], orSelf }`. A `name` is null for a positional slot.
export function returnShapes(fn, outer = null) {
  const alternatives = [];
  let orSelf = false;
  let opaque = false;
  for (const { node, env } of returnPaths(fn, outer)) {
    const fields = node.fields ?? [];
    if (fields[0]?.selfReturn) { orSelf = true; continue; }
    if (fields.some(f => f.spread || f.rest)) opaque = true;
    const slots = fields.map(f => ({ name: fieldName(f), type: fieldType(f, env) || 'Anything' }));
    const same = alternatives.find(alt => alt.length === slots.length && alt.every((s, i) => s.name === slots[i].name));
    if (same) same.forEach((s, i) => { s.type = mergeTypes(s.type, slots[i].type); });
    else alternatives.push(slots);
  }
  return { alternatives, orSelf, opaque };
}

// The same shape from a doc entry.
export function docReturnShapes(sig) {
  const alternatives = (sig.returnAlternatives ?? (sig.returns ? [sig.returns] : []))
    .map(alt => alt.map(r => ({ name: r.positional ? null : r.name, type: r.type || 'Anything' })));
  return { alternatives, orSelf: !!sig.returnsSelf, opaque: false };
}

// A key a caller can rely on: in every alternative, typed as the union of them.
export function fieldAcrossReturns(sig, name) {
  const alternatives = sig?.returnAlternatives ?? (sig?.returns ? [sig.returns] : []);
  if (alternatives.length === 0) return null;
  const found = alternatives.map(alt => alt.find(r => r.name === name));
  if (found.some(r => !r)) return null;
  return { name, type: found.map(r => r.type).reduce(mergeTypes) };
}
