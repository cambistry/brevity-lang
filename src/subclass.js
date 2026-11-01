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
 *   - wrappedBindings:    `*(T *name |)` wrapped-superclass declarations
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
    return { inheritedParams: [], inheritedFunctions: [], wrappedBindings: [], inheritedIngests: [], inheritedSetters: [], inheritedState: [], inheritedInit: [] };
  }

  const inheritedParams = [];
  const inheritedFunctions = [];
  const wrappedBindings = [];
  const inheritedIngests = [];
  const inheritedSetters = [];
  const inheritedState = [];
  const inheritedInit = [];

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

    // A wrapped superclass is its own actor, which keeps its own state.
    if (!st.wrappedAs) {
      for (const sv of [...parentChain.inheritedState, ...(superActor.stateVarDecls || []).filter(v => !v.ingest)]) {
        const idx = inheritedState.findIndex(es => es.name === sv.name);
        if (idx >= 0) inheritedState[idx] = sv;
        else inheritedState.push(sv);
      }
      // An ingest slot is filled by the subclass's own tail.
      inheritedInit.push(...parentChain.inheritedInit, ...(superActor.initBody || []).filter(s => s.value?.type !== 'IngestExpr'));
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

  return { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests, inheritedSetters, inheritedState, inheritedInit };
}

// A subclass actor has its own copy of the state its inherited methods use, and runs
// its ancestors' constructor bodies before its own. A name it declares itself hides the
// inherited one.
export function withInheritedState(actor, { inheritedState, inheritedInit }) {
  const own = actor.stateVarDecls || [];
  const ownNames = new Set(own.map(v => v.name));
  const stateVarDecls = [...inheritedState.filter(v => !ownNames.has(v.name)), ...own];
  const stateNames = new Set(stateVarDecls.map(v => v.name));
  // The nearest class's initial value for a name is its only one.
  const seen = new Set();
  const initBody = [...inheritedInit, ...(actor.initBody || [])].reverse().filter((s) => {
    if (!stateNames.has(s.name)) return true;
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  }).reverse();
  return { stateVarDecls, initBody };
}

// The `@` on a class says it's public, which matters to docs. Calls and supertypes name
// it bare, as generated code does.
// Validation writes to the AST and callers read it afterward, so this renames in place.
export function useBareClassNames(ast) {
  const seen = new Set();
  for (const a of ast.actors) {
    if (!a.name) continue;
    if (a.name.startsWith('@')) a.isPublic = true;
    a.name = a.name.replace(/^@/, '');
    if (seen.has(a.name)) throw new Error(`Class '${a.name}' is declared more than once`);
    seen.add(a.name);
  }
}
