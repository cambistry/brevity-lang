// The arg a constructor call passes for one of the class's params: by its key
// when named, else by its place among the positional params.
export function argForParam(initParams, args, paramName) {
  const param = (initParams || []).find(p => p.name === paramName);
  if (!param) return null;
  const namedBag = (args || []).find(a => a?.type === 'NamedArgsBag');
  const key = param.key || param.name;
  if (namedBag?.fields && key in namedBag.fields) return namedBag.fields[key];
  if (!param.positional) return null;
  const positionalArgs = (args || []).filter(a => a?.type !== 'NamedArgsBag');
  const at = (initParams || []).filter(p => p.positional).indexOf(param);
  return positionalArgs[at] ?? null;
}

// The params a class subscribes to (`p.subscribe (v) { … }` in its constructor
// block). A caller passes each a live link to its cell rather than a value.
export function subscribedParams(actor) {
  const params = new Set((actor?.initParams || []).map(p => p.name));
  const found = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'SubscribeCall' && node.target?.type === 'Identifier' && params.has(node.target.name)) {
      found.add(node.target.name);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(actor?.initBody);
  visit(actor?.constructorBody);
  return found;
}
