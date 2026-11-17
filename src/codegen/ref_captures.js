// The refs a function reads from outside itself: its actor's cells, or an
// enclosing scope's. A set site on one of them replays the function for its
// subscribers. A ref the function declares, or takes as a param, is its own:
// a write to another function's ref of the same name doesn't touch it.
export function capturedRefs(fn) {
  const reads = new Set();
  const own = new Set((fn.params || []).map(p => p.name).filter(Boolean));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'RefRead' && node.name) reads.add(node.name);
    if (node.type === 'RefDecl' && node.name) own.add(node.name);
    if ((node.type === 'Function' || node.type === 'FunctionDecl') && node.params) {
      for (const p of node.params) if (p.name) own.add(p.name);
    }
    for (const k of Object.keys(node)) {
      if (k !== 'type') walk(node[k]);
    }
  };
  walk(fn.body);
  return [...reads].filter(name => !own.has(name));
}
