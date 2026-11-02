// A function param may reuse a name from the file or class. Every target looks up
// file and class names before locals, so the param gets a name of its own here,
// and its wire key stays what the source says. Inside the function the name means
// the param, so `k <- v` only works if the param is a ref.

const SETS = new Set(['SetStatement', 'ActorSetStatement']);

function renameIn(node, from, to, isRef) {
  if (Array.isArray(node)) {
    node.forEach(item => renameIn(item, from, to, isRef));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if ((node.type === 'Function' || node.type === 'FunctionDecl') && (node.params || []).some(p => p.name === from)) return;
  if (node.name === from && SETS.has(node.type) && !isRef) {
    throw new Error(`Cannot set '${from}' — only 'ref' variables and actor references support '<-'`);
  }
  if (node.name === from) {
    node.name = to;
    if (node.named) {
      delete node.named;
      node.key = from;
    }
  }
  if (node.objectName === from) node.objectName = to;
  if (node.sigil === from) {
    delete node.sigil;
    node.key = from;
    node.value = { type: 'Identifier', name: to };
  }
  for (const value of Object.values(node)) renameIn(value, from, to, isRef);
}

function freeName(name, taken) {
  let candidate = `${name}_param`;
  while (taken.has(candidate)) candidate += '_';
  taken.add(candidate);
  return candidate;
}

function scopeParams(node, outer, taken) {
  if (Array.isArray(node)) {
    node.forEach(item => scopeParams(item, outer, taken));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Actor') {
    scopeActor(node, taken);
    return;
  }
  if ((node.type === 'Function' || node.type === 'FunctionDecl') && node.params) {
    for (const p of node.params) {
      if (!p.name || !outer.has(p.name)) continue;
      const from = p.name;
      const to = freeName(from, taken);
      renameIn(node.body, from, to, p.ref);
      renameIn(node.expr, from, to, p.ref);
      p.name = to;
      if (!p.positional && !p.key) p.key = from;
    }
  }
  for (const value of Object.values(node)) scopeParams(value, outer, taken);
}

function scopeActor(actor, taken) {
  const outer = new Set([
    ...(actor.stateVarDecls || []).map(d => d.name),
    ...(actor.initParams || []).map(p => p.name),
    ...(actor.functions || []).map(f => f.name),
  ].filter(Boolean));
  scopeParams(actor.functions, outer, taken);
}

export function lowerParamScope(ast) {
  const taken = new Set();
  for (const actor of ast.actors || []) scopeActor(actor, taken);
}
