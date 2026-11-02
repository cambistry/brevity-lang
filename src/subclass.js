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

// `@Box` and `Box` are different classes. Backends need an identifier, which `@Box` can't
// be, so a public class gets one that nothing in a file can name.
// Validation writes to the AST and callers read it afterward, so this renames in place.
export const PUBLIC_CLASS_SUFFIX = '__pub';
const SELECTOR_KEYS = new Set(['value', 'op', 'method', 'property', 'key', 'selector']);

export function renamePublicClasses(ast) {
  const seen = new Set();
  const renames = new Map();
  const file = ast.actors.find(a => !a.name);
  for (const a of ast.actors) {
    if (!a.name) continue;
    if (seen.has(a.name)) throw new Error(`Class '${a.name}' is declared more than once`);
    seen.add(a.name);
    if (!a.name.startsWith('@')) continue;
    if (file?.functions?.some(f => f.name === a.name && !f.actorDef && !f.emptyOverload)) {
      throw new Error(`'${a.name}' is declared as both a class and a function`);
    }
    a.isPublic = true;
    a.selector = (a.sourceName ?? a.name).slice(1);
    renames.set(a.name, `${a.name.slice(1)}${PUBLIC_CLASS_SUFFIX}`);
  }
  if (renames.size === 0) return;

  const classes = buildActorMap(ast);
  // Inside a class, `@x` is that class's own function or cell before it's a class of the file.
  const labelsOf = (actor) => new Set([
    ...[...(actor.functions || []), ...resolveSuperclassChain(classes, actor).inheritedFunctions].filter(f => !f.actorDef).map(f => f.name),
    ...(actor.stateVarDecls || []).map(d => d.name),
    ...(actor.initParams || []).map(p => p.name),
  ]);
  const AT_NAME = /(?<![\w@])@\w+(?![\w!])/g;
  const rename = (node, labels) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => rename(n, labels)); return; }
    const inside = node.type === 'Actor' ? labelsOf(node) : labels;
    for (const [key, v] of Object.entries(node)) {
      if (v && typeof v === 'object') rename(v, inside);
      else if (typeof v === 'string' && v.includes('@') && !SELECTOR_KEYS.has(key)) {
        const ownLabel = key === 'name' && node.type !== 'Actor' && inside.has(v);
        if (!ownLabel) node[key] = v.replace(AT_NAME, m => renames.get(m) ?? m);
      }
    }
  };
  rename(ast, new Set());
}

// A compile error shows a public class by the name in its source.
export function validateWithSourceNames(validate, ast, options) {
  try {
    validate(ast, options);
  } catch (e) {
    if (typeof e?.message === 'string') e.message = e.message.replace(new RegExp(`\\b(\\w+)${PUBLIC_CLASS_SUFFIX}\\b`, 'g'), '@$1');
    throw e;
  }
}
