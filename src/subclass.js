// Target-neutral helpers for the actor class system: subclass-chain resolution,
// actor lookup, and (eventually) method/param table flattening for validation.

/**
 * Build a lookup map from actor name to actor AST node. Skips file-level
 * (unnamed) actors. Filters to named actors only.
 */
export function buildActorMap(ast) {
  return new Map((ast.actors || []).filter(a => a.name).map(a => [a.name, a]));
}

/**
 * Walk an actor's superclass chain and return its flattened inheritance:
 *   - inheritedParams:    initParams from each ancestor (deduped by name)
 *   - inheritedFunctions: own functions from each ancestor (overrides win)
 *   - wrappedBindings:    `<T *name |>` wrapped-instance declarations
 *   - inheritedIngests:   stateVarDecls flagged `ingest` from each ancestor
 *   - inheritedSetters:   manifest `set <name>: (Type)` entries from ancestors
 *
 * Order: grandparent material is collected before direct-parent material at
 * each level. For functions, later entries override earlier — direct parent
 * overrides grandparent.
 *
 * `actorByName` is a Map<string, actor>. Pass null/undefined to no-op for
 * actors with no resolvable parents.
 */
export function resolveSuperclassChain(actorByName, actor) {
  const supertypes = actor.supertypes || [];
  if (supertypes.length === 0) {
    return { inheritedParams: [], inheritedFunctions: [], wrappedBindings: [], inheritedIngests: [], inheritedSetters: [] };
  }

  const inheritedParams = [];
  const inheritedFunctions = [];
  const wrappedBindings = [];
  const inheritedIngests = [];
  const inheritedSetters = [];

  for (const st of supertypes) {
    const superActor = actorByName?.get(st.supertype);
    if (!superActor) continue;

    const parentChain = resolveSuperclassChain(actorByName, superActor);

    for (const p of parentChain.inheritedParams) {
      if (!inheritedParams.some(ip => ip.name === p.name)) inheritedParams.push(p);
    }
    for (const p of (superActor.initParams || [])) {
      if (!inheritedParams.some(ip => ip.name === p.name)) inheritedParams.push(p);
    }

    for (const f of parentChain.inheritedFunctions) {
      const idx = inheritedFunctions.findIndex(ef => ef.name === f.name);
      if (idx >= 0) inheritedFunctions[idx] = f;
      else inheritedFunctions.push(f);
    }
    for (const f of superActor.functions) {
      const idx = inheritedFunctions.findIndex(ef => ef.name === f.name);
      if (idx >= 0) inheritedFunctions[idx] = f;
      else inheritedFunctions.push(f);
    }

    if (st.wrappedAs) {
      wrappedBindings.push({ name: st.wrappedAs, supertype: st.supertype });
    }

    for (const sv of (superActor.stateVarDecls || [])) {
      if (sv.ingest) {
        inheritedIngests.push({ name: sv.name, typeName: sv.typeName, defaultValue: sv.ingestDefault, fromSupertype: st.supertype });
      }
    }

    for (const s of parentChain.inheritedSetters) {
      const idx = inheritedSetters.findIndex(es => es.name === s.name);
      if (idx >= 0) inheritedSetters[idx] = s;
      else inheritedSetters.push(s);
    }
    for (const s of (superActor.setters || [])) {
      const idx = inheritedSetters.findIndex(es => es.name === s.name);
      if (idx >= 0) inheritedSetters[idx] = s;
      else inheritedSetters.push(s);
    }
  }

  return { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests, inheritedSetters };
}
