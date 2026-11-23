// What a function can return, across all its paths. A generated doc prints this, and a
// caller's annotation is checked against it. Each alternative is a list of slots, and
// paths with the same slots merge, so one set of paths has one spelling:
//
//   if b { return 1 }; return "x"                   (Integer | Text)
//   if b { return a: 1 }; return 2, n: "x"          (a: Integer) | (Integer, n: Text)
//
// A slot whose type can't be inferred is `Anything`, which absorbs the rest of its union.

import { inferExprType } from './inference.js';
import { inferType } from './type_infer.js';
import { intern, members as encMembers } from './type_enc.js';

// Each slot has its type as text (`type`) and encoded (`typeEnc`, src/type_enc.js):
// the passes that read encodings use the one, the code generators the other.

// A scope's names and their encoded types.
export function scopeTypesEnc(params, body, outer = null) {
  const env = new Map(outer ?? []);
  for (const p of params || []) {
    if (p.rest) continue;
    if (p.name && p.typeEnc !== undefined) env.set(p.name, p.typeEnc);
  }
  for (const s of body || []) {
    if ((s?.type === 'TypedAssign' || s?.type === 'BareTypeDecl') && s.typeNameEnc !== undefined) {
      env.set(s.name, s.typeNameEnc);
    } else if (s?.type === 'Assign') {
      const t = inferType(s.value, env);
      if (t !== undefined) env.set(s.name, t);
    } else if (s?.type === 'RefDecl' && s.typeNameEnc !== undefined) {
      env.set(s.name, s.typeNameEnc);
    }
  }
  return env;
}

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

// Every return on the function's own paths, with the locals in scope at each, by
// their text (`env`) and their encoded types (`envEnc`). `outer` is the enclosing
// scope's, as `{ env, envEnc }`, or a text env alone.
export function returnPaths(fn, outer = null) {
  const outerText = outer instanceof Map ? outer : outer?.env ?? null;
  const outerEnc = outer instanceof Map ? null : outer?.envEnc ?? null;
  const paths = [];
  const walk = (node, env, envEnc) => {
    if (!node || typeof node !== 'object' || node.type === 'Function') return;
    if (Array.isArray(node)) {
      const scope = scopeTypes(null, node, env);
      const scopeEnc = scopeTypesEnc(null, node, envEnc);
      node.forEach(n => walk(n, scope, scopeEnc));
      return;
    }
    if (node.type === 'Reply' || node.type === 'Return') {
      paths.push({ node, env, envEnc });
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, env, envEnc);
  };
  const root = scopeTypes(fn.params, null, outerText);
  const rootEnc = scopeTypesEnc(fn.params, null, outerEnc);
  walk(fn.body, root, rootEnc);
  // A tail `if` returns the value each of its branches ends in.
  const tailIf = (branch, env, envEnc) => {
    if (branch?.type === 'IfExpr') {
      tailIf(branch.then, env, envEnc);
      tailIf(branch.else, env, envEnc);
      return;
    }
    const scope = scopeTypes(null, branch?.body, env);
    const scopeEnc = scopeTypesEnc(null, branch?.body, envEnc);
    const last = branch?.body?.at(-1);
    if (last?.type !== 'ImplicitReturn') return;
    if (last.expr?.type === 'IfExpr') tailIf(last.expr, scope, scopeEnc);
    else paths.push({ node: { fields: [{ positional: true, expr: last.expr, type: last.typeName, typeEnc: last.typeNameEnc }] }, env: scope, envEnc: scopeEnc });
  };
  const tail = fn.body.at(-1);
  if (tail?.type === 'ImplicitReturn' && tail.expr?.type === 'IfExpr') tailIf(tail.expr, root, rootEnc);
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

function fieldTypeEnc(field, env) {
  if (field?.typeEnc !== undefined) return field.typeEnc;
  const expr = field?.value ?? field?.expr;
  if ('sigil' in field) return env.has(field.sigil) ? env.get(field.sigil) : inferType(expr, env);
  if (field.name && !expr) return env.get(field.name);
  return inferType(expr, env);
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

export const mergeTypes = (a, b) => {
  const members = [...new Set([...unionMembers(a), ...unionMembers(b)])];
  return members.includes('Anything') ? 'Anything' : members.join(' | ');
};

// Two encoded types as one: their members, `Anything` absorbing the rest.
export const mergeTypesEnc = (a, b) => {
  if (a === undefined || b === undefined) return undefined;
  const all = [...new Set([...encMembers(a), ...encMembers(b)])];
  if (all.includes('Anything')) return 'Anything';
  return all.length === 1 ? all[0] : intern({ '%or': all });
};

// Adds one path's slots, merging them into an alternative with the same slots.
function addAlternative(alternatives, slots) {
  const same = alternatives.find(alt => alt.length === slots.length && alt.every((s, i) => s.name === slots[i].name));
  if (same) same.forEach((s, i) => { s.type = mergeTypes(s.type, slots[i].type); s.typeEnc = mergeTypesEnc(s.typeEnc, slots[i].typeEnc); });
  else alternatives.push(slots.map(s => ({ ...s })));
}

// `{ alternatives: [[{ name, type }]], orSelf }`. A `name` is null for a positional slot.
export function returnShapes(fn, outer = null) {
  const alternatives = [];
  let orSelf = false;
  let opaque = false;
  for (const { node, env, envEnc } of returnPaths(fn, outer)) {
    const fields = node.fields ?? [];
    if (fields[0]?.selfReturn) { orSelf = true; continue; }
    if (fields.some(f => f.spread || f.rest)) opaque = true;
    addAlternative(alternatives, fields.map(f => {
      const enc = fieldTypeEnc(f, envEnc);
      const type = fieldType(f, env) || 'Anything';
      return { name: fieldName(f), type, typeEnc: enc === undefined && type === 'Anything' ? 'Anything' : enc };
    }));
  }
  return { alternatives, orSelf, opaque };
}

// What several clauses can return between them, as one shape.
export function mergeShapes(shapes) {
  const alternatives = [];
  for (const shape of shapes) for (const alt of shape.alternatives) addAlternative(alternatives, alt);
  return { alternatives, orSelf: shapes.some(s => s.orSelf), opaque: shapes.some(s => s.opaque) };
}

// The same shape from a doc entry.
export function docReturnShapes(sig) {
  const alternatives = (sig.returnAlternatives ?? (sig.returns ? [sig.returns] : []))
    .map(alt => alt.map(r => ({ name: r.positional ? null : r.name, type: r.type || 'Anything', typeEnc: r.typeEnc ?? 'Anything' })));
  return { alternatives, orSelf: !!sig.returnsSelf, opaque: false };
}

// A key a caller can rely on: in every alternative, typed as the union of them.
export function fieldAcrossReturns(sig, name) {
  const alternatives = sig?.returnAlternatives ?? (sig?.returns ? [sig.returns] : []);
  if (alternatives.length === 0) return null;
  const found = alternatives.map(alt => alt.find(r => r.name === name));
  if (found.some(r => !r)) return null;
  return { name, type: found.map(r => r.type).reduce(mergeTypes), typeEnc: found.map(r => r.typeEnc ?? 'Anything').reduce(mergeTypesEnc) };
}
