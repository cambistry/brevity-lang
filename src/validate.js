// Shared semantic validation pass — runs between parse() and codegen.
// Every target (JS, Erlang, Rust) gets the same checks.

import { parseInterface } from './codegen/javascript/types.js';
import { parseDecimalLiteral, isTerminatingDivision } from './codegen/decimal_utils.js';
import { MATH_METHODS } from './math_methods.js';
import { LIST_METHODS } from './list_methods.js';
import { inferExprType as inferExprTypeFull, listElementType, typesCompatible } from './inference.js';
import { resolveSupertypeChain } from './subtype.js';

export function validate(ast, options = {}) {
  // Build actor info map for cross-actor as-clause checking
  const actorInfo = new Map();
  for (const actor of ast.actors) {
    if (actor.name && actor.asClauses && actor.asClauses.length > 0) {
      actorInfo.set(actor.name, { asClauses: actor.asClauses });
    }
  }

  // Build remote interfaces and constructor params from declarations.
  // Order: remotesParsed first (needed to expand spread `...` in destructures),
  // then destructure expansion, then the destructuredMembers/dependencyNames
  // index built from the final (expanded) lists.
  const dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  const remotesParsed = {};
  const factoryDecls = {};
  for (const d of (ast.dependencies || [])) {
    if (d.interface) {
      const { iface, asTypes } = splitAsTypes(d.interface);
      remotesParsed[d.name] = parseInterface(iface);
      if (asTypes.length > 0) remotesParsed[d.name].__asTypes = asTypes;
    }
    if (d.constructorParams) factoryDecls[d.name] = d.constructorParams;
  }
  // Collect dep names whose manifest is provided inline by a constructor
  // coercion (`Coerced = Dep as <ctor> -> { iface }`). These are exempt from
  // the bare-* / # interface check below.
  const coercedDeps = new Set();
  for (const actor of ast.actors) {
    for (const s of (actor.constructorBody || [])) {
      if (s.type === 'ServiceCoercion' && s.constructorParams) {
        const refName = s.ref?.name || s.ref;
        if (refName) coercedDeps.add(refName);
      }
    }
  }
  if (options.remotes) {
    // Build path → alias map from declarations for resolving path-keyed remotes
    const pathToAlias = new Map();
    for (const d of (ast.dependencies || [])) {
      if (d.path) pathToAlias.set(d.path, d.name);
    }
    const ingestRemote = (alias, service, params) => {
      if (typeof service !== 'string') {
        remotesParsed[alias] = service;
        return;
      }
      if (params) {
        const ctorParams = parseParamsDocument(params);
        if (ctorParams) factoryDecls[alias] = ctorParams;
        const { iface, asTypes } = splitAsTypes(service);
        remotesParsed[alias] = parseInterface(iface);
        if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
      } else {
        const ctorManifest = parseConstructorManifest(service);
        if (ctorManifest) {
          factoryDecls[alias] = ctorManifest.constructorParams;
          const { iface, asTypes } = splitAsTypes(ctorManifest.service);
          remotesParsed[alias] = parseInterface(iface);
          if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
        } else {
          const { iface, asTypes } = splitAsTypes(service);
          remotesParsed[alias] = parseInterface(iface);
          if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
        }
      }
    };
    if (Array.isArray(options.remotes)) {
      // New format: [{ path, params?, service }, ...]
      for (const { path, service, params } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) ingestRemote(alias, service, params);
      }
    } else {
      for (const [name, iface] of Object.entries(options.remotes)) {
        ingestRemote(name, iface);
      }
    }
  }

  // Check that all bare * / # dependencies have an interface (inline, via
  // options.remotes, or supplied by a constructor coercion).
  for (const d of (ast.dependencies || [])) {
    if (d.path && !d.interface && !remotesParsed[d.name] && !coercedDeps.has(d.name)) {
      throw new Error(`Dependency '${d.name}' (${d.path}) requires an interface — supply it inline or via options.remotes`);
    }
  }

  // ── Rewrite body-form DI destructures into header destructures ─────────
  // `(:div, p: Para, ...) = HTML` (or without parens for the non-spread form)
  // in a function body translates to appending the equivalent entries to
  // HTML's destructures list, then letting the header-spread pass below do
  // the real work. The original DestructureAssign node is tagged `fromDI`
  // so codegen skips emitting a structure-unpack for it.
  //
  // This keeps the source of truth in one place (the dep's destructures
  // list → destructuredMembers → codegen routing) and avoids a second
  // parallel code path.
  const depByName = new Map();
  for (const d of (ast.dependencies || [])) depByName.set(d.name, d);

  const translatePatternEntry = (entry) => {
    if (entry.spread) return { spread: true };
    if (entry.discard) {
      if (!entry.key) return null;
      return { remote: entry.key, discard: true };
    }
    if (entry.named) {
      return { local: entry.name, remote: entry.name, ...(entry.type && { type: entry.type }) };
    }
    if (entry.key) {
      return { local: entry.name, remote: entry.key, ...(entry.type && { type: entry.type }) };
    }
    return null;
  };

  const isDIBodyDestructure = (node) => (
    node && typeof node === 'object' &&
    node.type === 'DestructureAssign' &&
    node.source?.type === 'Identifier' &&
    depByName.has(node.source.name)
  );
  const foldIntoDep = (node) => {
    const dep = depByName.get(node.source.name);
    if (!Array.isArray(dep.destructures)) dep.destructures = [];
    for (const entry of (node.pattern || [])) {
      const translated = translatePatternEntry(entry);
      if (translated) dep.destructures.push(translated);
    }
  };
  const rewriteBodyDestructures = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // Splice out DI body destructures in-place; fold their patterns into
      // the dep's destructures list. Downstream codegen never sees them.
      for (let i = node.length - 1; i >= 0; i--) {
        if (isDIBodyDestructure(node[i])) {
          foldIntoDep(node[i]);
          node.splice(i, 1);
        } else {
          rewriteBodyDestructures(node[i]);
        }
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      rewriteBodyDestructures(node[k]);
    }
  };
  for (const actor of (ast.actors || [])) rewriteBodyDestructures(actor);

  // ── Expand spread `...` and drop discards in DI destructure lists ───────
  // `<Name: (...)>` and `<Name: (remote: local, other: _, ...)>` flatten the
  // module's remote manifest into local scope. Explicit entries before `...`
  // consume their remote name; `...` then supplies every remaining manifest
  // op as `{ local: op, remote: op }`. Discards (`_`) finish by dropping out
  // of the list — they existed only to keep `...` from picking their name
  // up; leaving them behind would pollute codegen's destructuredMembers map
  // with `local: undefined` entries.
  for (const d of (ast.dependencies || [])) {
    if (!Array.isArray(d.destructures)) continue;
    const spreadIdx = d.destructures.findIndex(e => e.spread);
    if (spreadIdx !== -1) {
      const manifest = remotesParsed[d.name];
      if (!manifest) {
        throw new Error(`Dependency '${d.name}' uses spread '...' but no manifest is available to expand it — supply an interface inline or via options.remotes`);
      }
      const consumed = new Set();
      for (const e of d.destructures) {
        if (e.spread) continue;
        if (e.remote) consumed.add(e.remote);
      }
      const expanded = [];
      const allNames = [
        ...Object.keys(manifest).filter(k => !k.startsWith('__')),
        ...Object.keys(manifest.__types || {}),
      ];
      for (const name of allNames) {
        if (consumed.has(name)) continue;
        expanded.push({ local: name, remote: name });
      }
      d.destructures.splice(spreadIdx, 1, ...expanded);
    }
    if (d.destructures.some(e => e.discard)) {
      d.destructures = d.destructures.filter(e => !e.discard);
    }
  }

  // ── Destructured-member index + name-collision check ────────────────────
  // After spread expansion, build the local→{service, remote} map used by
  // codegen and infer routing. A `local` name appearing in two different
  // dependencies' destructure lists is a compile error.
  // destructuredMembers: localName → { service: depName, remote: remoteName }
  const destructuredMembers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (!Array.isArray(d.destructures)) continue;
    for (const entry of d.destructures) {
      if (entry.discard || entry.spread || !entry.local) continue;
      const existing = destructuredMembers.get(entry.local);
      if (existing && existing.service !== d.name) {
        throw new Error(`DI name collision: '${entry.local}' is supplied by both '${existing.service}' and '${d.name}' — alias or discard one side`);
      }
      destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
      dependencyNames.add(entry.local);
    }
  }

  // ── HTML template tags must be in the DI destructure list ────────────────
  // `<div>…</div>` et al. compile to `new HTML @div`. When the DI destructure
  // `<HTML: (:div, :p)>` names specific element constructors, using an
  // unlisted tag is a compile error so the wire never attempts routing
  // against a constructor the actor didn't import. If HTML is not imported
  // at all, or is imported without a destructure list, this check is
  // skipped — legacy flows that rely on runtime HTML dispatch stay intact.
  //
  // The tag is matched against `remote` (the HTML op) rather than `local` so
  // that aliasing (`div: D`) doesn't break `<div>` templates — `D` is the
  // call-site binding; the tag is the manifest op.
  {
    const domDep = (ast.dependencies || []).find(d => d.name === 'HTML');
    if (domDep && Array.isArray(domDep.destructures) && domDep.destructures.length > 0) {
      const allowedTags = new Set(
        domDep.destructures.filter(e => e.remote).map(e => e.remote),
      );
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const n of node) walk(n); return; }
        if (node.type === 'DomConstructor') {
          if (!allowedTags.has(node.tag)) {
            throw new Error(`<${node.tag}> template used but ':${node.tag}' is not in HTML's destructure list — add it to '<HTML: (...)>' to use this tag`);
          }
        }
        for (const k of Object.keys(node)) {
          if (k === 'type') continue;
          walk(node[k]);
        }
      };
      for (const actor of (ast.actors || [])) walk(actor);
    }
  }

  // ── Overload validation ──────────────────────────────────────────────────
  // Check: duplicate = (create) on same name is a redefinition error.
  // Check: << / >> without prior = (create) is an error.
  // Applies to functions within each actor and to actors (constructors) at top level.
  // Collect all constructor names created at top level (actors with = create)
  const topLevelActorCreates = new Set();
  for (const actor of ast.actors) {
    if (actor.name && (!actor.overloadMode || actor.overloadMode === 'create')) {
      topLevelActorCreates.add(actor.name);
    }
  }
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    const fnCreated = new Set();
    // Seed with constructor names — a constructor = create satisfies << on functions
    if (!actor.name) { // anonymous file-level actor
      for (const n of topLevelActorCreates) fnCreated.add(n);
    }
    for (const fn of actor.functions) {
      if (!fn.name) continue;
      const mode = fn.overloadMode || 'create';
      if (mode === 'create') {
        if (fnCreated.has(fn.name) && !topLevelActorCreates.has(fn.name)) {
          throw new Error(`Duplicate definition of '${fn.name}' — use '<< |params| body' to add an overload clause`);
        }
        fnCreated.add(fn.name);
      } else {
        if (!fnCreated.has(fn.name)) {
          throw new Error(`'${fn.name}' ${mode === 'append' ? '<<' : '>>'} used before '${fn.name}' is defined with '='`);
        }
      }
    }
  }
  {
    const ctorCreated = new Set();
    for (const actor of ast.actors) {
      if (!actor.name) continue;
      const mode = actor.overloadMode || 'create';
      if (mode === 'create') {
        if (ctorCreated.has(actor.name)) {
          throw new Error(`Duplicate definition of '${actor.name}' — use '<< <params> { body }' to add an overload clause`);
        }
        ctorCreated.add(actor.name);
      } else {
        if (!ctorCreated.has(actor.name)) {
          throw new Error(`'${actor.name}' ${mode === 'append' ? '<<' : '>>'} used before '${actor.name}' is defined with '='`);
        }
      }
    }
  }

  // ── Optional arg ordering: required positionals must precede optional ones ──
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (!fn.params) continue;
      const posParams = fn.params.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
    // Check constructor params too
    if (actor.initParams) {
      const posParams = actor.initParams.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
  }

  // ── Reorder for >> (prepend) — after validation, before codegen ─────────
  // >> clauses must be tried before existing same-name clauses.
  function reorderPrepends(arr, nameKey = 'name') {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].overloadMode === 'prepend') {
        const name = arr[i][nameKey];
        const firstIdx = arr.findIndex(x => x[nameKey] === name);
        if (firstIdx < i) {
          const [item] = arr.splice(i, 1);
          arr.splice(firstIdx, 0, item);
          i--;
        }
      }
    }
  }
  for (const actor of ast.actors) {
    if (actor.functions) reorderPrepends(actor.functions);
  }
  reorderPrepends(ast.actors);

  // Build actor public method map and ref-param requirements for * validation
  const actorMethods = new Map(); // actorName → Set of public method names
  const actorMethodSigs = new Map(); // actorName → Map(methodName → params[])
  const actorRefRequirements = new Map(); // actorName → { params, requirements, callSites }
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    // Collect public methods and their signatures (params + returns)
    const methods = new Set();
    const sigs = new Map();
    for (const fn of actor.functions) {
      if (fn.name?.startsWith('@')) {
        methods.add(fn.name);
        // Extract return type info from Reply nodes
        const reply = fn.body?.find(s => s.type === 'Reply');
        const returns = reply ? reply.fields.map(f => ({ name: f.key || f.name, type: f.type })).filter(f => f.type) : null;
        sigs.set(fn.name, { params: fn.params || [], returns });
      }
    }
    actorMethods.set(actor.name, methods);
    actorMethodSigs.set(actor.name, sigs);

    // Collect ref param names, what methods the actor calls on them, and the call args
    const refParams = (actor.initParams || []).filter(p => p.ref);
    if (refParams.length > 0) {
      const refParamNames = new Set(refParams.map(p => p.name));
      const requirements = new Map(); // paramName → Set of called methods
      const callSites = []; // { paramName, method, args, fnParams }
      for (const pName of refParamNames) requirements.set(pName, new Set());
      // Walk all functions to find DotCallExpr on ref params
      for (const fn of actor.functions) {
        collectRefCalls(fn.body, refParamNames, requirements, callSites, fn.params);
      }
      actorRefRequirements.set(actor.name, { params: actor.initParams, requirements, callSites });
    }
  }

  const actorByName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));

  // ── Manifest-declared types: synthesise actor-shaped nodes ───────────────
  // `parseInterface` collects `Name: <[Sup |] params> [-> { body }]` entries
  // under `parsed.__types`. We materialise them as actor-shaped records so
  // resolveSupertypeChain / isAssignable can walk cross-service inheritance
  // (e.g. HTML.Div → HTML.Element) without special-casing remote types.
  // Local actors win on collision — a manifest declaration cannot shadow a
  // real one. Functions get an `@`-prefixed name and a reconstructed Reply
  // node so the existing addSig path picks up their return types.
  const manifestActors = [];
  for (const remoteName of Object.keys(remotesParsed)) {
    const types = remotesParsed[remoteName].__types;
    if (!types) continue;
    for (const typeName of Object.keys(types)) {
      if (actorByName.has(typeName)) continue;
      const t = types[typeName];
      const functions = (t.functions || []).map(f => ({
        name: '@' + f.name,
        params: f.params || [],
        body: f.returns ? [{
          type: 'Reply',
          fields: (f.returns || []).map(r => ({ key: r.name, name: r.name, type: r.type, positional: r.positional })),
        }] : [],
      }));
      const synthetic = {
        name: typeName,
        supertypes: t.supertypes || [],
        initParams: t.initParams || [],
        functions,
        setters: t.setters || [],
        stateVarDecls: [],
        __remote: remoteName,
      };
      actorByName.set(typeName, synthetic);
      manifestActors.push(synthetic);
    }
  }

  // ── Flattened method sets per actor: own + inherited, including auto-accessors ──
  // Names include the '@' prefix, matching entries in actorMethods.
  // Auto-accessors are synthesised from initParams: each param produces a `@{name}`
  // getter unless the param explicitly suppresses it (sp.suppressAccessor) or is a
  // destructure alias without an explicit accessor name.
  const accessorsFor = (params) => {
    const names = [];
    for (const sp of (params || [])) {
      if (sp.suppressAccessor) continue;
      if (sp.key && !sp.accessor) continue; // alias suppresses the default accessor
      const n = sp.accessor || sp.name;
      if (n) names.push('@' + n);
    }
    return names;
  };
  const actorMethodsFlat = new Map();
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    const own = actorMethods.get(actor.name) || new Set();
    const flat = new Set(own);
    for (const n of accessorsFor(actor.initParams)) flat.add(n);
    const { inheritedFunctions, inheritedParams } = resolveSupertypeChain(actorByName, actor);
    for (const fn of inheritedFunctions) {
      if (fn.name?.startsWith('@')) flat.add(fn.name);
    }
    for (const n of accessorsFor(inheritedParams)) flat.add(n);
    actorMethodsFlat.set(actor.name, flat);
  }
  // Fold in methods and accessors from overload clauses (`Name << <..>` / `Name >> <..>`).
  // Each clause lives as a FunctionDecl with an actorDef attached; its methods are
  // reachable at runtime via dispatch, so union them into the base type's method set.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      const flat = actorMethodsFlat.get(fn.name);
      if (!flat) continue;
      for (const mfn of (fn.actorDef.functions || [])) {
        if (mfn.name?.startsWith('@')) flat.add(mfn.name);
      }
      for (const n of accessorsFor(fn.actorDef.initParams)) flat.add(n);
    }
  }

  // ── Constructor clause signatures per actor ──────────────────────────
  // Each actor has one "base" clause (its declared initParams merged with
  // inherited params via the supertype chain) plus zero or more overload
  // clauses (`Name << <..>` / `Name >> <..>`). A call matches the type if it
  // fits AT LEAST ONE clause's required-params and positional arity.
  const mergeInheritedParams = (actor) => {
    const own = actor.initParams || [];
    const ownNames = new Set(own.map(p => p.name));
    const { inheritedParams } = resolveSupertypeChain(actorByName, actor);
    return [...inheritedParams.filter(p => !ownNames.has(p.name)), ...own];
  };
  const actorConstructorSigs = new Map(); // name → [{ params }]
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    actorConstructorSigs.set(actor.name, [{ params: mergeInheritedParams(actor) }]);
  }
  // Overload clauses (Name << <..>) — append to the base entry. If no named
  // actor exists (Function() pattern: `Name = Function(); Name << <..>`),
  // start the entry fresh so the name still resolves as a constructor.
  // An overload clause may itself inherit: `Sub << <Base | ...>`, so its params
  // also need merging with its own supertype chain.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      let sigs = actorConstructorSigs.get(fn.name);
      if (!sigs) {
        sigs = [];
        actorConstructorSigs.set(fn.name, sigs);
      }
      sigs.push({ params: mergeInheritedParams(fn.actorDef) });
    }
  }

  // ── Flattened method signatures per actor type ──────────────────────
  // typeName → @methodName → { params, returns }. Includes own + inherited
  // via supertype chain + clauses from overload constructors. Last writer
  // wins — subtype overrides supertype (matches resolveSupertypeChain).
  const actorMethodSigsFlat = new Map();
  const addSig = (sigMap, fn) => {
    if (!fn.name?.startsWith('@')) return;
    const reply = fn.body?.find(s => s.type === 'Reply');
    const returns = reply ? reply.fields.map(f => ({ name: f.key || f.name, type: f.type })).filter(f => f.type) : null;
    sigMap.set(fn.name, { params: fn.params || [], returns });
  };
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    const sigs = new Map();
    const { inheritedFunctions } = resolveSupertypeChain(actorByName, actor);
    for (const fn of inheritedFunctions) addSig(sigs, fn);
    for (const fn of (actor.functions || [])) addSig(sigs, fn);
    actorMethodSigsFlat.set(actor.name, sigs);
  }
  // Fold in overload-clause methods — they add to the base type's method set.
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (!fn.actorDef || !fn.name) continue;
      const sigs = actorMethodSigsFlat.get(fn.name);
      if (!sigs) continue;
      for (const mfn of (fn.actorDef.functions || [])) addSig(sigs, mfn);
    }
  }

  // ── Top-level (non-constructor) function signatures ────────────────
  // fnName → [{ params }]. Built from every FunctionDecl in every actor that
  // isn't a constructor (no actorDef) and isn't itself a public @-method
  // (those live under methods). Used to type-check bare-name function calls.
  const localFunctionSigs = new Map();
  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      if (fn.actorDef || fn.emptyOverload) continue;
      if (!fn.name) continue;
      if (fn.name.startsWith('@') || fn.name.startsWith('set@') || fn.name.startsWith('#')) continue;
      if (actorConstructorSigs.has(fn.name)) continue; // constructor, not a plain fn
      // Lineal form stashes params inside body (BareTypeDecl etc.), leaving
      // fn.params empty. Skip: we'd false-positive on the sig check.
      if ((fn.params || []).length === 0) continue;
      const existing = localFunctionSigs.get(fn.name) || [];
      existing.push({ params: fn.params || [] });
      localFunctionSigs.set(fn.name, existing);
    }
  }

  // Populate derived maps for manifest-declared types. Done after the
  // local-actor passes so resolveSupertypeChain can reach across local and
  // manifest entries (a local actor extending a manifest type, or vice
  // versa, would walk through both).
  //
  // Manifest fields use an explicit `? ` prefix on the slot to mark it
  // optional; that flag is carried as `param.optional` and read by
  // clauseAccepts. `Type | null` is just a nullable value type and does
  // NOT imply optionality on its own.
  for (const synth of manifestActors) {
    const flat = new Set();
    for (const fn of synth.functions) flat.add(fn.name);
    for (const n of accessorsFor(synth.initParams)) flat.add(n);
    const { inheritedFunctions, inheritedParams } = resolveSupertypeChain(actorByName, synth);
    for (const fn of inheritedFunctions) flat.add(fn.name);
    for (const n of accessorsFor(inheritedParams)) flat.add(n);
    actorMethodsFlat.set(synth.name, flat);

    actorConstructorSigs.set(synth.name, [{ params: mergeInheritedParams(synth) }]);

    const sigs = new Map();
    for (const fn of inheritedFunctions) addSig(sigs, fn);
    for (const fn of synth.functions) addSig(sigs, fn);
    actorMethodSigsFlat.set(synth.name, sigs);
  }

  // Flattened settable-field sets per manifest type. Only manifest-declared
  // types currently surface settable fields (via `set <name>: (Type)`); local
  // actors expose all fields settable through ActorFieldSet semantics, so we
  // only populate this map for types that opt-in. Used by validateBody to
  // reject `obj.bogus <- v` against a manifest type's declared surface.
  const actorSettersFlat = new Map();
  for (const synth of manifestActors) {
    const own = new Map();
    const { inheritedSetters } = resolveSupertypeChain(actorByName, synth);
    for (const s of inheritedSetters) own.set(s.name, s.type);
    for (const s of (synth.setters || [])) own.set(s.name, s.type);
    actorSettersFlat.set(synth.name, own);
  }

  // Set of names that denote an actor constructor — used by expression-type
  // inference to resolve `x = T(...)` → x : T.
  const actorNameSet = new Set(actorConstructorSigs.keys());

  // ── Subtype validation ──────────────────────────────────────────────────
  for (const actor of ast.actors) {
    if (!actor.supertypes || actor.supertypes.length === 0) continue;
    for (const st of actor.supertypes) {
      const superActor = actorByName.get(st.supertype);
      if (!superActor) continue;

      // Arg type override rejection: subtype params with same name must have same type
      const superParams = new Map((superActor.initParams || []).map(p => [p.name, p]));
      for (const p of (actor.initParams || [])) {
        const sp = superParams.get(p.name);
        if (sp && sp.type && p.type && sp.type !== p.type) {
          throw new Error(`Subtype '${actor.name}' cannot change type of inherited arg '${p.name}' from '${sp.type}' to '${p.type}'`);
        }
      }

      // Public function return type rejection: overridden functions must return same type
      // Compare both explicit Reply returns and implicit returns
      for (const fn of actor.functions) {
        if (!fn.name?.startsWith('@')) continue;
        const superFn = superActor.functions.find(f => f.name === fn.name);
        if (!superFn) continue;

        // Get return type from super function (Reply or ImplicitReturn)
        const superReply = superFn.body?.find(s => s.type === 'Reply');
        const superImplicit = superFn.body?.find(s => s.type === 'ImplicitReturn');
        const ownReply = fn.body?.find(s => s.type === 'Reply');
        const ownImplicit = fn.body?.find(s => s.type === 'ImplicitReturn');

        // Compare implicit return types
        if (superImplicit && ownImplicit) {
          const superType = superImplicit.typeName || inferExprType(superImplicit.expr);
          const ownType = ownImplicit.typeName || inferExprType(ownImplicit.expr);
          if (superType && ownType && superType !== ownType) {
            throw new Error(`Subtype '${actor.name}' cannot change return type of '${fn.name}' from '${superType}' to '${ownType}'`);
          }
        }

        // Compare Reply returns
        if (superReply && ownReply) {
          for (const sf of superReply.fields) {
            const of2 = ownReply.fields.find(f => (f.key || f.name) === (sf.key || sf.name));
            if (of2 && of2.type && sf.type && of2.type !== sf.type) {
              throw new Error(`Subtype '${actor.name}' cannot change return type of '${fn.name}' field '${sf.key || sf.name}' from '${sf.type}' to '${of2.type}'`);
            }
          }
        }
      }

      // Accessor type rejection: subtype function overriding an auto-accessor must preserve type
      for (const sp of (superActor.initParams || [])) {
        if (sp.suppressAccessor) continue;
        const accessorName = sp.accessor || sp.name;
        if (sp.key && !sp.accessor) continue; // alias suppresses accessor
        const overrideFn = actor.functions.find(f => f.name === '@' + accessorName);
        if (overrideFn) {
          const reply = overrideFn.body?.find(s => s.type === 'Reply');
          const implicitReturn = overrideFn.body?.find(s => s.type === 'ImplicitReturn');
          if (reply) {
            for (const f of reply.fields) {
              if (f.type && f.type !== sp.type) {
                throw new Error(`Subtype '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${sp.type}' to '${f.type}'`);
              }
            }
          } else if (implicitReturn) {
            const irType = implicitReturn.typeName || inferExprType(implicitReturn.expr);
            if (irType && irType !== sp.type) {
              throw new Error(`Subtype '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${sp.type}' to '${irType}'`);
            }
          }
        }
      }

      // Private function access: subtype cannot reference supertype's # functions
      const superPrivates = new Set(superActor.functions.filter(f => f.name?.startsWith('#')).map(f => f.name));
      if (superPrivates.size > 0) {
        for (const fn of actor.functions) {
          checkPrivateAccess(fn.body, superPrivates, actor.name);
        }
      }
    }
  }

  // Collect all named actor (constructor) names for silent-function exclusion
  // Include names from actorDef FunctionDecls (Function() + << constructor clauses)
  const constructorNames = new Set(ast.actors.filter(a => a.name).map(a => a.name));
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (fn.actorDef) constructorNames.add(fn.name);
    }
  }

  for (const actor of ast.actors) {
    validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames, actorByName, destructuredMembers, actorMethodsFlat, actorConstructorSigs, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
  }

  // ── Reply grounding check ────────────────────────────────────────────
  // Reject reply fields whose type depends entirely on remote inference.
  if (Object.keys(remotesParsed).length > 0) {
    for (const actor of ast.actors) {
      for (const fn of (actor.functions || [])) {
        const reply = fn.body?.find(s => s.type === 'Reply');
        if (!reply) continue;
        const remoteInferred = new Set();
        for (const s of fn.body) {
          if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr') {
            const actorName = s.source.object?.name;
            const methodName = s.source.method;
            const iface = remotesParsed[actorName];
            if (!iface) continue;
            const returns = iface[methodName]?.[0]?.returns || iface['@' + methodName]?.[0]?.returns;
            if (!returns) continue;
            for (const item of s.pattern) {
              if (item.discard || !item.name || item.type) continue;
              if (returns.find(r => r.name === item.name && r.type)) {
                remoteInferred.add(item.name);
              }
            }
          }
        }
        if (remoteInferred.size === 0) continue;
        for (const field of reply.fields) {
          if ('sigil' in field && !field.type && remoteInferred.has(field.sigil)) {
            throw new Error(`Reply type for ':${field.sigil}' cannot be inferred from local declarations — annotate explicitly`);
          }
          if (field.key !== undefined && !field.type) {
            const expr = field.value;
            if (expr?.type === 'Identifier' && remoteInferred.has(expr.name)) {
              throw new Error(`Reply type for ':${expr.name}' cannot be inferred from local declarations — annotate explicitly`);
            }
          }
        }
      }
    }
  }

  // ── Decimal division / exponentiation termination checks ──────────────
  checkDecimalTermination(ast);
  // ── List method element-type compat ────────────────────────────────────
  checkListMethodArgs(ast);
}

// ── Decimal termination check ────────────────────────────────────────────
// Walk the AST looking for DecimalLiteral / DecimalLiteral or
// DecimalLiteral ** negative-IntLiteral where the result is non-terminating.

function checkDecimalTermination(ast) {
  function walkExpr(expr) {
    if (!expr || typeof expr !== 'object') return;
    if (expr.type === 'BinaryExpr') {
      walkExpr(expr.left);
      walkExpr(expr.right);
      if (expr.op === '/') {
        const lDec = expr.left.type === 'DecimalLiteral';
        const rDec = expr.right.type === 'DecimalLiteral';
        const lInt = expr.left.type === 'IntLiteral';
        const rInt = expr.right.type === 'IntLiteral';
        if ((lDec || lInt) && (rDec || rInt) && (lDec || rDec)) {
          const lv = parseDecimalLiteral(expr.left.value);
          const rv = parseDecimalLiteral(expr.right.value);
          if (!isTerminatingDivision(lv.coeff, lv.scale, rv.coeff, rv.scale)) {
            throw new Error(`Non-terminating decimal division: ${expr.left.value} / ${expr.right.value}`);
          }
        }
      }
      // Note: negative exponent (e.g. 3.0 ** -1) is checked at runtime only,
      // because the parser does not support unary minus / negative literals.
      return;
    }
    // ── Math method compile-time checks ─────────────────────────────────
    if (expr.type === 'MathMethodExpr') {
      const meta = MATH_METHODS.get(expr.method);
      if (meta && meta.accepts === 'float-decimal' && expr.args.length >= 1) {
        const arg = expr.args[0];
        if (arg.type === 'IntLiteral') {
          throw new Error(`Math.${expr.method}() does not accept Integer — value is already whole`);
        }
        // Also catch typed Integer parameters (known from the type environment at the actor level)
      }
      for (const a of expr.args) walkExpr(a);
      return;
    }
    for (const val of Object.values(expr)) {
      if (Array.isArray(val)) {
        for (const item of val) walkExpr(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkExpr(val);
      }
    }
  }

  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      for (const s of (fn.body || [])) walkExpr(s);
    }
    for (const s of (actor.constructorBody || [])) walkExpr(s);
    for (const s of (actor.initBody || [])) walkExpr(s);
    for (const d of (actor.stateVarDecls || [])) {
      if (d.value) walkExpr(d.value);
    }
  }
}

// ── List method element-type compatibility ────────────────────────────────
// Reject e.g. `List.contains(List of Integers, "x")` at compile time, because
// the runtime equality helper would fall through to identity and return false
// silently. Also restricts `join` to `List of Texts`.
//
// Argument-position semantics by method:
//   • element-position (contains, index_of, before, after, replace*):
//       arg should be Element type (or Anything wildcard)
//   • list-position (starts_with, ends_with, concat, append, prepend):
//       arg should be List of compatible Element
//   • Integer-position (at, slice, take, from, repeat): arg must be Integer
//   • join: receiver must be List of Texts; sep must be Text
//   • flatten: receiver must be List of Lists
//
// Element checks pass when either side is 'Anything' / 'List of Anything', or
// when the type can't be inferred (typeEnv miss). The only hard rejections are
// confidently-known mismatches.
function checkListMethodArgs(ast) {
  const ELEMENT_ARG_METHODS = new Set(['contains', 'index_of', 'before', 'after']);
  const LIST_ARG_METHODS = new Set(['starts_with', 'ends_with', 'concat', 'append', 'prepend']);
  const INT_ARG_METHODS = new Set(['at', 'take', 'from', 'repeat']);

  function checkOne(expr, typeEnv) {
    if (expr.type !== 'ListMethodExpr') return;
    const meta = LIST_METHODS.get(expr.method);
    if (!meta) return;
    const recvType = inferExprTypeFull(expr.args[0], typeEnv);
    const elemType = listElementType(recvType);

    if (ELEMENT_ARG_METHODS.has(expr.method)) {
      const argType = inferExprTypeFull(expr.args[1], typeEnv);
      if (!typesCompatible(argType, elemType)) {
        throw new Error(`List.${expr.method} on ${recvType}: argument type ${argType} is not compatible with element type ${elemType}`);
      }
    } else if (expr.method === 'replace' || expr.method === 'replace_first') {
      // (list, old, new): both old and new must match element type.
      const oldType = inferExprTypeFull(expr.args[1], typeEnv);
      const newType = inferExprTypeFull(expr.args[2], typeEnv);
      if (!typesCompatible(oldType, elemType)) {
        throw new Error(`List.${expr.method} on ${recvType}: needle type ${oldType} is not compatible with element type ${elemType}`);
      }
      if (!typesCompatible(newType, elemType)) {
        throw new Error(`List.${expr.method} on ${recvType}: replacement type ${newType} is not compatible with element type ${elemType}`);
      }
    } else if (LIST_ARG_METHODS.has(expr.method)) {
      const argType = inferExprTypeFull(expr.args[1], typeEnv);
      const argElem = listElementType(argType);
      if (typeof argType !== 'string' || !argType.startsWith('List')) {
        if (argType) throw new Error(`List.${expr.method} on ${recvType}: argument must be a List, got ${argType}`);
      } else if (!typesCompatible(argElem, elemType)) {
        throw new Error(`List.${expr.method} on ${recvType}: argument's element type ${argElem} is not compatible with ${elemType}`);
      }
    } else if (INT_ARG_METHODS.has(expr.method)) {
      const argType = inferExprTypeFull(expr.args[1], typeEnv);
      if (argType && argType !== 'Integer' && argType !== 'Anything') {
        throw new Error(`List.${expr.method} requires an Integer index, got ${argType}`);
      }
    } else if (expr.method === 'slice') {
      const start = inferExprTypeFull(expr.args[1], typeEnv);
      if (start && start !== 'Integer' && start !== 'Anything') {
        throw new Error(`List.slice requires an Integer start, got ${start}`);
      }
      if (expr.args[2]) {
        const end = inferExprTypeFull(expr.args[2], typeEnv);
        if (end && end !== 'Integer' && end !== 'Anything') {
          throw new Error(`List.slice requires an Integer end, got ${end}`);
        }
      }
    } else if (expr.method === 'join') {
      // receiver must be List of Texts; sep must be Text.
      if (typeof recvType === 'string' && recvType !== 'List of Anything' && recvType !== 'List of Texts') {
        throw new Error(`List.join is only valid on List of Texts, got ${recvType}`);
      }
      const sepType = inferExprTypeFull(expr.args[1], typeEnv);
      if (sepType && sepType !== 'Text' && sepType !== 'Anything') {
        throw new Error(`List.join separator must be Text, got ${sepType}`);
      }
    } else if (expr.method === 'flatten') {
      // receiver must be List of Lists (any element type for the inner list).
      if (typeof recvType === 'string' && recvType !== 'List of Anything' &&
          !(typeof elemType === 'string' && elemType.startsWith('List'))) {
        throw new Error(`List.flatten is only valid on a List of Lists, got ${recvType}`);
      }
    }
  }

  function walkBody(body, typeEnv) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'ListMethodExpr') checkOne(node, typeEnv);
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    walk(body);
  }

  for (const actor of (ast.actors || [])) {
    // State-var types visible to all functions.
    const stateEnv = new Map();
    for (const d of (actor.stateVarDecls || [])) {
      if (d.name && d.typeName) stateEnv.set(d.name, d.typeName);
    }
    for (const fn of (actor.functions || [])) {
      const typeEnv = buildTypeEnv(fn.params || [], fn.body || []);
      for (const [k, v] of stateEnv) if (!typeEnv.has(k)) typeEnv.set(k, v);
      walkBody(fn.body || [], typeEnv);
    }
    walkBody(actor.constructorBody || [], stateEnv);
    walkBody(actor.initBody || [], stateEnv);
  }
}

// ── Constructor manifest parsing ──────────────────────────────────────────
//
// A # dependency's manifest from options.remotes has the shape
//   <:p Type, ...> -> { method: sig, ... }
// matching the inline form. This helper splits it into ctor params + the
// inner service interface string. Returns null if the input isn't shaped
// like a constructor manifest (so the caller can fall back to a plain service).

function splitAsTypes(service) {
  const t = service.trim();
  let depth = 0;
  let braceEnd = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  if (braceEnd === -1) return { iface: t, asTypes: [] };
  const iface = t.slice(0, braceEnd + 1);
  const rest = t.slice(braceEnd + 1).trim();
  const asTypes = [];
  for (const part of rest.split('|')) {
    const name = part.trim();
    if (name) asTypes.push(name);
  }
  return { iface, asTypes };
}

function parseParamsDocument(params) {
  const t = params.trim();
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const result = [];
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^:(\w+)\s+(\w+)$/) || trimmed.match(/^(\w+)\s+(\w+)$/);
    if (m) result.push({ name: m[1], type: m[2] });
  }
  return result;
}

function parseConstructorManifest(s) {
  const t = s.trim();
  if (!t.startsWith('<')) return null;
  let depth = 0;
  let i = 0;
  for (; i < t.length; i++) {
    if (t[i] === '<') depth++;
    else if (t[i] === '>') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  const paramsStr = t.slice(1, i).trim();
  let j = i + 1;
  while (j < t.length && /\s/.test(t[j])) j++;
  if (t.slice(j, j + 2) !== '->') return null;
  j += 2;
  while (j < t.length && /\s/.test(t[j])) j++;
  const service = t.slice(j);
  const constructorParams = [];
  if (paramsStr) {
    for (const part of paramsStr.split(',')) {
      const trimmed = part.trim();
      const m = trimmed.match(/^:(\w+)\s+(\w+)$/) || trimmed.match(/^(\w+)\s+(\w+)$/);
      if (m) constructorParams.push({ name: m[1], type: m[2] });
    }
  }
  return { constructorParams, service };
}

// ── Expression type inference (for validation) ────────────────────────────

function inferExprType(expr) {
  if (!expr) return null;
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'InterpolatedString') return 'Text';
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  return null;
}

// ── Private function access check ──────────────────────────────────────────

function checkPrivateAccess(body, superPrivates, subtypeName) {
  if (!body) return;
  for (const node of body) {
    walkForPrivateAccess(node, superPrivates, subtypeName);
  }
}

function walkForPrivateAccess(node, superPrivates, subtypeName) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier' && superPrivates.has(node.name)) {
    throw new Error(`Subtype '${subtypeName}' cannot access private function '${node.name}' from supertype`);
  }
  if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && superPrivates.has(node.callee.name)) {
    throw new Error(`Subtype '${subtypeName}' cannot access private function '${node.callee.name}' from supertype`);
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) walkForPrivateAccess(item, superPrivates, subtypeName);
    } else if (val && typeof val === 'object' && val.type) {
      walkForPrivateAccess(val, superPrivates, subtypeName);
    }
  }
}

// ── Ref param method collection ────────────────────────────────────────────

function collectRefCalls(body, refParamNames, requirements, callSites, fnParams) {
  for (const s of body) {
    collectRefCallsInNode(s, refParamNames, requirements, callSites, fnParams, body);
  }
}

function collectRefCallsInNode(node, refParamNames, requirements, callSites, fnParams, body) {
  if (!node || typeof node !== 'object') return;
  // DotCallExpr on a ref param: super.method()
  if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier' && refParamNames.has(node.object.name)) {
    const method = node.method.startsWith('@') ? node.method : '@' + node.method;
    requirements.get(node.object.name).add(method);
    callSites.push({ paramName: node.object.name, method, args: node.args || [], fnParams, body });
  }
  // Recurse into all object values
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) collectRefCallsInNode(item, refParamNames, requirements, callSites, fnParams, body);
    } else if (val && typeof val === 'object' && val.type) {
      collectRefCallsInNode(val, refParamNames, requirements, callSites, fnParams, body);
    }
  }
}

// ── Actor-level checks ─────────────────────────────────────────────────────

function validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames = new Set(), actorByName = new Map(), destructuredMembers = new Map(), actorMethodsFlat = new Map(), actorConstructorSigs = new Map(), actorMethodSigsFlat = new Map(), localFunctionSigs = new Map(), actorNameSet = new Set(), actorSettersFlat = new Map()) {
  checkNamespaceConflict(actor);
  checkSilentTopLevelUsage(actor, constructorNames);
  checkSilentFunctionUsage(actor, constructorNames);
  checkXmlConstructorCalls(actor, constructorNames, actorByName);
  checkAsClauses(actor);

  // ── Per-actor augmented dep sets ────────────────────────────────────────
  // Constructor coercions (`Coerced = Thing as <ctor> -> { iface }`) introduce
  // synthetic local deps. They are construction-capable and have a service
  // interface, so add them to the per-actor copies of dependencyNames /
  // remotesParsed / factoryDecls used for the rest of validation.
  const localDepNames = new Set(dependencyNames);
  const localRemotes = { ...remotesParsed };
  const localFactoryDecls = { ...factoryDecls };
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && s.constructorParams) {
      localDepNames.add(s.name);
      localFactoryDecls[s.name] = s.constructorParams;
      // parseServiceConstraint produces { method: { params, returns } }, but
      // remotesParsed is { method: [{ params, returns }, ...] } (array of
      // overloads). Wrap each entry in an array.
      const wrapped = {};
      for (const [m, sig] of Object.entries(s.constraint)) wrapped[m] = [sig];
      localRemotes[s.name] = wrapped;
    }
  }

  // Validate constructor calls in constructorBody (top-level init)
  const initTypeEnv = buildTypeEnv([], actor.constructorBody || []);
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      const depName = s.value.callee.name;
      // For destructured members, skip constructor validation — these are
      // function calls routed to the source service, not dep constructor calls
      if (destructuredMembers.has(depName)) continue;
      if (localFactoryDecls[depName]) {
        validateConstructorCall(s.value, localFactoryDecls, initTypeEnv);
      } else {
        throw new Error(
          `Cannot construct '${depName}' — its dependency declaration has no constructor signature. ` +
          `Use '<"path": (${depName}) #>' with a manifest in options.remotes, ` +
          `or '<"path": (${depName}) <:param Type> -> { ... }>' inline.`,
        );
      }
    }
  }

  // Build state var type env from constructorBody for use in function validation
  const stateTypeEnv = new Map();
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && s.typeName) {
      stateTypeEnv.set(s.name, s.typeName);
    }
    // Infer instance type from constructor calls against declared dependencies
    // (or against constructor coercions, which are in localDepNames):
    //   t = Thing(args)    →  t : Thing
    //   t = Coerced(args)  →  t : Coerced
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && !s.typeName &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      stateTypeEnv.set(s.name, s.value.callee.name);
    }
  }
  for (const d of (actor.stateVarDecls || [])) {
    if (d.typeName) stateTypeEnv.set(d.name, d.typeName);
  }

  // Collect service coercion constraints: alias → { constraint, refName }
  const coercionConstraints = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion') {
      coercionConstraints.set(s.name, { constraint: s.constraint, refName: s.ref?.name || s.ref });
    }
  }

  for (const fn of actor.functions) {
    const outerNames = collectScopeNames(fn.params, fn.body);
    const typeEnv = buildTypeEnv(fn.params, fn.body);
    // Merge state var types so instance variables are visible
    for (const [k, v] of stateTypeEnv) {
      if (!typeEnv.has(k)) typeEnv.set(k, v);
    }
    validateBody(fn.body, outerNames, actorInfo, localDepNames, localRemotes, localFactoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
  }
}

function checkAsClauses(actor) {
  const clauses = actor.asClauses || [];
  if (clauses.length === 0) return;
  const seen = new Set();
  for (const c of clauses) {
    if (c.negated) continue;
    if (seen.has(c.targetType)) {
      throw new Error(`Duplicate 'as ${c.targetType}' clause in actor '${actor.name}'`);
    }
    seen.add(c.targetType);
  }
}

function checkAsClauseMatch(targetType, actorName, actorInfo) {
  const info = actorInfo.get(actorName);
  if (!info) return; // no as clauses — normal actor instantiation
  if (targetType === actorName) return; // identity — no cast needed
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return; // positive match
    if (clause.negated && clause.targetType !== targetType) return; // negated catch-all
  }
  throw new Error(`No matching 'self-as' clause in actor '${actorName}' for type '${targetType}'`);
}

function checkNamespaceConflict(actor) {
  const publicNames = new Set();
  const privateNames = new Set();
  for (const fn of actor.functions) {
    if (!fn.name) continue; // OnHandler etc.
    if (fn.name.startsWith('@')) {
      publicNames.add(fn.name);
    } else {
      privateNames.add(fn.name);
    }
  }
  for (const name of publicNames) {
    if (privateNames.has(name)) {
      throw new Error(`Duplicate function name '${name}'`);
    }
  }
}

function checkXmlConstructorCalls(actor, constructorNames, actorByName) {
  // Walk all function bodies looking for xmlConstructor calls
  function walkExpr(expr) {
    if (!expr) return;
    if (expr.type === 'FunctionCallExpr' && expr.xmlConstructor) {
      const name = expr.callee?.name;
      if (!name) return;
      if (!constructorNames.has(name)) {
        throw new Error(`XML tag <${name} /> can only be used with constructors, not functions`);
      }
      // Check that the constructor doesn't have positional params
      const targetActor = actorByName.get(name);
      if (targetActor) {
        const posParams = (targetActor.initParams || []).filter(p => p.positional);
        if (posParams.length > 0) {
          throw new Error(`XML tag <${name} /> cannot be used with constructors that have positional params — use named params (name: Type) instead`);
        }
      }
    }
    // Recurse into sub-expressions
    if (expr.args) for (const a of expr.args) walkExpr(a.expr || a);
    if (expr.fields) for (const k of Object.keys(expr.fields)) walkExpr(expr.fields[k]);
    if (expr.left) walkExpr(expr.left);
    if (expr.right) walkExpr(expr.right);
    if (expr.object) walkExpr(expr.object);
    if (expr.callee) walkExpr(expr.callee);
    if (expr.collection) walkExpr(expr.collection);
    if (expr.fn) walkExpr(expr.fn);
    if (expr.cond) walkExpr(expr.cond);
    if (expr.then) walkExpr(expr.then?.expr);
    if (expr.else) walkExpr(expr.else?.expr);
  }
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if (s.value) walkExpr(s.value);
      if (s.expr) walkExpr(s.expr);
    }
  }
}

function checkSilentTopLevelUsage(actor, constructorNames = new Set()) {
  const silentFns = new Set();
  // Collect names that have overload clauses — empty Function() initializers aren't silent
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    // Skip constructor overload clauses and constructor names
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    if (!hasReply && !hasImplicit) silentFns.add(fn.name);
  }
  if (silentFns.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentFns.has(s.value.callee.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
      if (s.type === 'ExprStatement' && s.expr?.type === 'FunctionCallExpr' && s.expr.callee?.name && silentFns.has(s.expr.callee.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
    }
  }
}

// Walk an expression tree looking for calls to silent functions
function findSilentCallInExpr(expr, silentNames) {
  if (!expr) return null;
  if (expr.type === 'FunctionCallExpr' && expr.callee?.name && silentNames.has(expr.callee.name)) {
    return expr.callee.name;
  }
  // Recurse into sub-expressions
  if (expr.type === 'BinaryExpr') {
    return findSilentCallInExpr(expr.left, silentNames) || findSilentCallInExpr(expr.right, silentNames);
  }
  if (expr.type === 'FunctionCallExpr') {
    for (const a of (expr.args || [])) {
      const found = findSilentCallInExpr(a, silentNames) || findSilentCallInExpr(a.expr, silentNames);
      if (found) return found;
    }
  }
  if (expr.type === 'IfExpr') {
    return findSilentCallInExpr(expr.cond, silentNames)
      || findSilentCallInExpr(expr.then?.expr, silentNames)
      || findSilentCallInExpr(expr.else?.expr, silentNames);
  }
  return null;
}

function checkSilentFunctionUsage(actor, constructorNames = new Set()) {
  // Collect silent private functions (lineal)
  const silentNames = new Set();
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode || fn.actorDef) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    // Skip empty Function() initializers that have overload clauses
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    if (!hasReply && !hasImplicit) silentNames.add(fn.name);
  }

  // Collect silent lambdas
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'Function' && s.value.returnType === '.') {
        silentNames.add(s.name);
      }
    }
  }
  if (silentNames.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      // Direct assignment: x = silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'DestructureAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentNames.has(s.value.callee.name)) {
        throw new Error(`Cannot assign result of silent function '${s.value.callee.name}' — it has no return value`);
      }

      // Used in expression: x = 1 + silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value) {
        // Skip direct call (caught above), check sub-expressions
        if (s.value.type !== 'FunctionCallExpr') {
          const found = findSilentCallInExpr(s.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used in an expression — it has no return value`);
        }
      }

      // Used as argument: double(silent())
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && !silentNames.has(s.value.callee?.name)) {
        for (const a of (s.value.args || [])) {
          const arg = a.expr || a;
          const found = findSilentCallInExpr(arg, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as an argument — it has no return value`);
        }
      }

      // Used as return value: -> silent()
      if (s.type === 'Reply') {
        for (const f of s.fields) {
          const found = findSilentCallInExpr(f.expr || f.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as a return value — it has no return value`);
        }
      }
    }
  }
}

// ── Scope name collection (mirrors buildTypeEnv in codegen.js) ──────────

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      env.set(s.name, s.typeName);
    } else if (s.type === 'RefDecl' && s.typeName) {
      env.set(s.name, s.typeName);
    } else if (s.type === 'Assign') {
      const t = inferLiteralType(s.value);
      if (t) env.set(s.name, t);
    }
  }
  return env;
}

function collectScopeNames(params, body) {
  const names = new Set();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.type) names.add(p.name);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      names.add(s.name);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) { names.add(item.name); continue; }
        if (s.source?.type === 'StructureConstructor') {
          let t;
          if (item.positional) t = s.source.args.filter(a => a.positional)[item.idx]?.type;
          else if (item.named) t = s.source.args.find(a => a.key === item.name)?.type;
          else if (item.key !== undefined) t = s.source.args.find(a => a.key === item.key)?.type;
          if (t) names.add(item.name);
        }
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) names.add(item.name);
      }
    } else if (s.type === 'Assign') {
      if (inferLiteralType(s.value)) names.add(s.name);
    } else if (s.type === 'RefDecl' && s.typeName) {
      names.add(s.name);
    }
  }
  return names;
}

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral')     return 'Integer';
  if (expr.type === 'StringLiteral')  return 'Text';
  if (expr.type === 'InterpolatedString') return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral')   return 'Float';
  if (expr.type === 'BoolLiteral')    return 'Boolean';
  if (expr.type === 'NullLiteral')    return 'null';
  return null;
}

// Split a type string on top-level `|` (respecting `(...)` and `->` depth).
// Returns null when the type is not a union.
function splitUnionMembers(ty) {
  if (typeof ty !== 'string' || ty.indexOf('|') === -1) return null;
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < ty.length; i++) {
    const c = ty[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '|' && depth === 0) {
      parts.push(ty.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(ty.slice(start).trim());
  return parts.length > 1 ? parts : null;
}

// Is `from` assignable to a parameter declared as `to`? Handles:
//   - identical named types
//   - 'Anything' on either side (wildcard)
//   - union types on either side: target accepts any member; source assignable iff every member is
//   - nominal subtyping between actor types (from's supertype chain contains to)
// Unknown types (null inputs) → null return, callers skip the check.
function isAssignable(from, to, actorByName) {
  if (!from || !to) return null;
  if (from === to) return true;
  if (from === 'Anything' || to === 'Anything') return true;
  const toMembers = splitUnionMembers(to);
  if (toMembers) {
    const fromMembers = splitUnionMembers(from);
    if (fromMembers) return fromMembers.every(fm => isAssignable(fm, to, actorByName));
    return toMembers.some(tm => isAssignable(from, tm, actorByName));
  }
  const fromMembers = splitUnionMembers(from);
  if (fromMembers) return false; // a union can't narrow to a single type without a guard
  // Nominal subtyping: walk from's supertype chain looking for `to`.
  const visited = new Set();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const actor = actorByName?.get(cur);
    if (!actor?.supertypes) continue;
    for (const st of actor.supertypes) {
      if (st.supertype === to) return true;
      stack.push(st.supertype);
    }
  }
  return false;
}

// Best-effort type of an expression given the current scope's type env and
// locally-tracked actor-constructor bindings. Returns null when ambiguous —
// callers skip rather than false-positive.
function inferExpressionType(expr, typeEnv, localActorTypes, actorNameSet) {
  if (!expr) return null;
  const lit = inferLiteralType(expr);
  if (lit) return lit;
  if (expr.type === 'Identifier') {
    return localActorTypes?.get(expr.name) || typeEnv?.get(expr.name) || null;
  }
  if (expr.type === 'RefRead') return typeEnv?.get(expr.name) || null;
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier') {
    const nm = expr.callee.name;
    if (actorNameSet?.has(nm)) return nm;
  }
  if (expr.type === 'TypedValue' && expr.typeName) return expr.typeName;
  if (expr.type === 'AsClause' && expr.targetType) return expr.targetType;
  return null;
}

function inferArgType(expr, typeEnv) {
  if (!expr) return null;
  const lit = inferLiteralType(expr);
  if (lit) return lit;
  // Resolve identifiers from the type environment
  if (expr.type === 'Identifier' && typeEnv?.has(expr.name)) return typeEnv.get(expr.name);
  return null;
}

// ── Body-level checks ───────────────────────────────────────────────────────

function validateBody(body, outerNames, actorInfo, dependencyNames, remotesParsed, factoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat = new Map(), actorConstructorSigs = new Map(), actorByName = new Map(), actorMethodSigsFlat = new Map(), localFunctionSigs = new Map(), actorNameSet = new Set(), actorSettersFlat = new Map()) {
  checkTypeConsistency(body);

  // Build a local map of variable → actor type from assignments like: a = A().
  // Both locally-defined actors (in `actorMethods`) and manifest-declared types
  // (in `actorNameSet`) participate; the latter covers destructured remote tags
  // like `(:div) = HTML` so `d = div()` typechecks `d` as `div`.
  const localActorTypes = new Map();
  for (const s of body) {
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        (actorMethods?.has(s.value.callee.name) || actorNameSet?.has(s.value.callee.name))) {
      localActorTypes.set(s.name, s.value.callee.name);
    }
  }

  // Method-existence check: every `obj.method()` must name a method defined on
  // obj's declared actor type (own or inherited). Skips when the type is a
  // dependency (remote calls validated elsewhere) or cannot be determined.
  // A TypedAssign's declared type takes precedence — `x T = U(...)` resolves
  // to T, so calling a U-only method on x is rejected (Liskov).
  const resolveObjType = (objName) => {
    const typed = typeEnv.get(objName);
    if (typed) return typed;
    return localActorTypes.get(objName) || null;
  };
  const checkMethodCall = (call) => {
    const obj = call.object;
    if (obj?.type !== 'Identifier' && obj?.type !== 'RefRead') return;
    const objName = obj.name;
    if (dependencyNames?.has(objName)) return;
    const typeName = resolveObjType(objName);
    if (!typeName) return;
    // Manifest tag locals (`b = br()` after `(:br) = HTML`) appear in
    // `dependencyNames` because their constructor was destructured from
    // the dependency. We still want to validate methods against the
    // manifest's declared surface — the membership in `actorMethodsFlat`
    // is what determines whether we have method info to check against.
    if (!actorMethodsFlat.has(typeName)) return;
    const methodName = call.method.startsWith('@') ? call.method : '@' + call.method;
    const methods = actorMethodsFlat.get(typeName);
    if (methods.has(methodName)) return;
    const available = [...methods].map(m => m.replace(/^@/, '')).sort();
    throw new Error(
      `'${typeName}' has no method '${call.method}' (available: ${available.length ? available.join(', ') : '(none)'})`,
    );
  };
  // Field-set discipline (`obj.field <- value`): when obj's type names a
  // manifest type with declared setters, reject any field name not in the
  // declared set. Local actors aren't gated here — `actorSettersFlat` is
  // populated only for manifest types.
  const checkFieldSet = (s) => {
    const objName = s.objectName;
    if (dependencyNames?.has(objName)) {
      // Tag locals (`b = br()` after destructuring HTML) appear in
      // dependencyNames but still resolve to a manifest type; the type
      // lookup below handles them.
    }
    const typeName = resolveObjType(objName);
    if (!typeName) return;
    if (!actorSettersFlat.has(typeName)) return;
    const setters = actorSettersFlat.get(typeName);
    if (setters.has(s.fieldName)) return;
    const available = [...setters.keys()].sort();
    throw new Error(
      `'${typeName}' has no settable field '${s.fieldName}' (available: ${available.length ? available.join(', ') : '(none)'})`,
    );
  };
  const walkForMethodChecks = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Function') return; // function literal: validated by recursive validateBody
    if (node.type === 'DotCallExpr') checkMethodCall(node);
    if (node.type === 'ActorFieldSet') checkFieldSet(node);
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walkForMethodChecks(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkForMethodChecks(val);
      }
    }
  };
  for (const s of body) walkForMethodChecks(s);

  // Constructor call validation: at every `T(...)` where T names a local actor
  // constructor, verify the call matches at least one clause's arity and required
  // param set (positional count in range, all required named args present, no
  // unexpected named keys). Extracted args share shape with validateConstructorCall
  // above. Type compatibility is handled in task 4.
  const extractCallArgs = (expr) => {
    const named = new Map();
    const positional = [];
    for (const a of (expr.args || [])) {
      if (a.type === 'NamedArgsBag') {
        for (const [k, v] of Object.entries(a.fields)) named.set(k, v);
      } else if (a.positional === false && a.name) {
        named.set(a.name, a.expr);
      } else {
        positional.push(a);
      }
    }
    return { named, positional };
  };
  const clauseArity = (clause) => {
    const sigPos = clause.params.filter(p => p.positional && !p.rest);
    const sigPosRest = clause.params.some(p => p.positional && p.rest);
    const sigNamed = clause.params.filter(p => !p.positional && !p.rest);
    const sigNamedRest = clause.params.some(p => !p.positional && p.rest);
    return { sigPos, sigPosRest, sigNamed, sigNamedRest };
  };
  const isOptional = (p) => p.defaultValue || p.optional;
  const clauseAccepts = (clause, call) => {
    const { sigPos, sigPosRest, sigNamed, sigNamedRest } = clauseArity(clause);
    const requiredPosCount = sigPos.filter(p => !isOptional(p)).length;
    const requiredNamed = new Set(sigNamed.filter(p => !isOptional(p)).map(p => p.key || p.name));
    const allowedNamed = new Set(sigNamed.map(p => p.key || p.name));
    if (call.positional.length < requiredPosCount) return false;
    if (!sigPosRest && call.positional.length > sigPos.length) return false;
    for (const req of requiredNamed) if (!call.named.has(req)) return false;
    if (!sigNamedRest) {
      for (const k of call.named.keys()) if (!allowedNamed.has(k)) return false;
    }
    return true;
  };
  // Check arg-to-param type compatibility for a call that already matched
  // `clause`. Runs isAssignable on each arg whose type can be inferred.
  // Throws with a locating message on first mismatch.
  const checkClauseTypes = (clause, call, label) => {
    const { sigPos, sigNamed } = clauseArity(clause);
    for (let i = 0; i < call.positional.length && i < sigPos.length; i++) {
      const sp = sigPos[i];
      if (!sp.type) continue;
      const argExpr = call.positional[i]?.expr || call.positional[i];
      const argType = inferExpressionType(argExpr, typeEnv, localActorTypes, actorNameSet);
      if (!argType) continue;
      if (!isAssignable(argType, sp.type, actorByName)) {
        throw new Error(`${label} positional arg ${i + 1}: '${argType}' is not assignable to '${sp.type}'`);
      }
    }
    for (const sp of sigNamed) {
      const key = sp.key || sp.name;
      const argExpr = call.named.get(key);
      if (!argExpr || !sp.type) continue;
      const argType = inferExpressionType(argExpr, typeEnv, localActorTypes, actorNameSet);
      if (!argType) continue;
      if (!isAssignable(argType, sp.type, actorByName)) {
        throw new Error(`${label} named arg '${key}': '${argType}' is not assignable to '${sp.type}'`);
      }
    }
  };
  const formatSig = (params) => {
    const parts = params.map(p => {
      const opt = isOptional(p) ? '? ' : '';
      const nm = p.positional ? '' : `:${p.key || p.name} `;
      const ty = p.type || 'Anything';
      const rest = p.rest ? '*' : '';
      return `${opt}${nm}${ty}${rest}`;
    });
    return `<${parts.join(', ')}>`;
  };
  const checkConstructorCall = (callExpr) => {
    if (callExpr.callee?.type !== 'Identifier') return;
    const name = callExpr.callee.name;
    const clauses = actorConstructorSigs.get(name);
    if (!clauses || clauses.length === 0) return;
    const call = extractCallArgs(callExpr);
    const accepting = clauses.filter(cl => clauseAccepts(cl, call));
    if (accepting.length === 0) {
      const sigStrs = clauses.map(cl => formatSig(cl.params)).join(' | ');
      const argDesc = [];
      if (call.positional.length) argDesc.push(`${call.positional.length} positional`);
      if (call.named.size) argDesc.push(`named: ${[...call.named.keys()].join(', ')}`);
      throw new Error(
        `'${name}()' call doesn't match any constructor clause: ${sigStrs}. ` +
        `Got ${argDesc.join(', ') || 'no args'}.`,
      );
    }
    // Only narrow types when exactly one clause fits — otherwise we'd have to
    // pick and risk false positives on the non-chosen clauses.
    if (accepting.length === 1) checkClauseTypes(accepting[0], call, `'${name}()' constructor`);
  };
  const checkLocalFunctionCall = (callExpr) => {
    if (callExpr.callee?.type !== 'Identifier') return;
    const name = callExpr.callee.name;
    if (actorConstructorSigs.has(name)) return; // handled by constructor check
    if (dependencyNames?.has(name)) return; // dep factory handled elsewhere
    const clauses = localFunctionSigs.get(name);
    if (!clauses || clauses.length === 0) return;
    const call = extractCallArgs(callExpr);
    const accepting = clauses.filter(cl => clauseAccepts(cl, call));
    if (accepting.length === 0) {
      const sigStrs = clauses.map(cl => formatSig(cl.params)).join(' | ');
      const argDesc = [];
      if (call.positional.length) argDesc.push(`${call.positional.length} positional`);
      if (call.named.size) argDesc.push(`named: ${[...call.named.keys()].join(', ')}`);
      throw new Error(
        `'${name}()' call doesn't match any function signature: ${sigStrs}. ` +
        `Got ${argDesc.join(', ') || 'no args'}.`,
      );
    }
    if (accepting.length === 1) checkClauseTypes(accepting[0], call, `'${name}()'`);
  };
  const checkMethodCallArgs = (call) => {
    const obj = call.object;
    if (obj?.type !== 'Identifier' && obj?.type !== 'RefRead') return;
    const objName = obj.name;
    if (dependencyNames?.has(objName)) return;
    const typeName = resolveObjType(objName);
    if (!typeName || dependencyNames?.has(typeName)) return;
    const sigs = actorMethodSigsFlat.get(typeName);
    if (!sigs) return;
    const methodName = call.method.startsWith('@') ? call.method : '@' + call.method;
    const sig = sigs.get(methodName);
    if (!sig) return; // missing-method error raised elsewhere
    const callArgs = extractCallArgs(call);
    const clause = { params: sig.params };
    if (!clauseAccepts(clause, callArgs)) {
      throw new Error(
        `'${typeName}.${call.method}()' call doesn't match signature ${formatSig(sig.params)}. ` +
        `Got ${callArgs.positional.length} positional, named: ${[...callArgs.named.keys()].join(', ') || '(none)'}.`,
      );
    }
    checkClauseTypes(clause, callArgs, `'${typeName}.${call.method}()'`);
  };
  const walkForCallChecks = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Function') return;
    if (node.type === 'FunctionCallExpr') {
      checkConstructorCall(node);
      checkLocalFunctionCall(node);
    }
    if (node.type === 'DotCallExpr') checkMethodCallArgs(node);
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) walkForCallChecks(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkForCallChecks(val);
      }
    }
  };
  for (const s of body) walkForCallChecks(s);

  const isRemoteSend = (expr) =>
    expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && dependencyNames.has(expr.object.name);

  // Treat `t.method()` as a remote send when `t` is a local instance of a declared dep:
  //   t = Thing(args)  →  t : Thing  →  t.method() routes to a Thing instance
  // Returns the dep name (so callers can look up parsed remotes), or null.
  const instanceDepName = (expr) => {
    if (expr?.type !== 'DotCallExpr' || expr.object?.type !== 'Identifier') return null;
    const objName = expr.object.name;
    if (dependencyNames.has(objName)) return null; // already a direct dep
    const t = typeEnv.get(objName);
    return (t && dependencyNames.has(t)) ? t : null;
  };

  // Wraps an instance method call into a direct-dep-shaped expr so the
  // existing remote-call validators can use it without further changes.
  const asDepCall = (expr) => {
    if (isRemoteSend(expr)) return expr;
    const dep = instanceDepName(expr);
    if (!dep) return null;
    return { ...expr, object: { type: 'Identifier', name: dep } };
  };

  for (const s of body) {
    // ── Ref param validation at instantiation site ──────────────────
    // When b = B(a) and B has * ref params, check that a has the required methods
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        actorRefRequirements?.has(s.value.callee.name)) {
      const targetActor = s.value.callee.name;
      const { params, requirements, callSites } = actorRefRequirements.get(targetActor);
      // Resolve positional and named args to their corresponding ref params
      const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
      const namedFields = namedBag?.fields || {};
      let posIdx = 0;
      for (const p of params) {
        let argExpr = null;
        if (p.ref) {
          const lookupKey = p.key || p.name;
          if (namedFields[lookupKey]) {
            argExpr = namedFields[lookupKey];
          } else if (p.positional && posIdx < positionalArgs.length) {
            argExpr = positionalArgs[posIdx];
          }
        }
        if (p.positional) posIdx++;
        if (!argExpr || !requirements.has(p.name)) continue;
        // Resolve the arg to an actor type
        const argActorName = argExpr.type === 'Identifier' ? localActorTypes.get(argExpr.name) : null;
        if (!argActorName || !actorMethods.has(argActorName)) continue;
        const availableMethods = actorMethods.get(argActorName);
        const requiredMethods = requirements.get(p.name);
        const missing = [...requiredMethods].filter(m => !availableMethods.has(m));
        if (missing.length > 0) {
          throw new Error(
            `'${targetActor}' requires ${missing.map(m => `'${m}'`).join(', ')} on ref param '${p.name}', ` +
            `but '${argActorName}' does not have ${missing.length === 1 ? 'it' : 'them'}`,
          );
        }
        // ── Arg type checking on ref param call sites ────────────────
        const targetSigs = actorMethodSigs.get(argActorName);
        if (!targetSigs) continue;
        for (const site of callSites) {
          if (site.paramName !== p.name) continue;
          const methodSig = targetSigs.get(site.method);
          if (!methodSig) continue;
          // Build type env for the wrapper function scope to resolve variable types
          const siteTypeEnv = buildTypeEnv(site.fnParams || [], site.body || []);
          // Match call args to method params by name
          for (const callArg of site.args) {
            const argName = callArg.name;
            const argType = inferArgType(callArg.expr, siteTypeEnv);
            if (!argType) continue; // can't infer — skip, no false positives
            const methodParam = methodSig.params.find(mp => mp.name === argName);
            if (!methodParam || !methodParam.type) continue;
            if (argType !== methodParam.type) {
              throw new Error(
                `Type mismatch in '${targetActor}': ref param '${p.name}' calls '${site.method}' ` +
                `with '${argName}: ${argType}', but '${argActorName}.${site.method}' expects '${argName}: ${methodParam.type}'`,
              );
            }
          }
        }
        // ── Inline constraint validation ─────────────────────────────
        if (p.constraint) {
          for (const [methodName, spec] of Object.entries(p.constraint)) {
            // Check method exists
            if (!availableMethods.has(methodName)) {
              throw new Error(
                `'${targetActor}' constraint on '${p.name}' requires '${methodName}', ` +
                `but '${argActorName}' does not have it`,
              );
            }
            // Check param types
            const sig = targetSigs.get(methodName);
            if (sig && spec.params) {
              for (const cp of spec.params) {
                const ap = sig.params.find(sp => sp.name === cp.name);
                if (ap && cp.type && ap.type && cp.type !== ap.type) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' param '${cp.name}' is '${ap.type}', ` +
                    `but constraint on '${p.name}' expects '${cp.type}'`,
                  );
                }
              }
            }
            // Check return types
            if (sig && spec.returns && sig.returns) {
              for (const cr of spec.returns) {
                const ar = sig.returns.find(sr => sr.name === cr.name);
                if (ar && cr.type && ar.type && cr.type !== ar.type) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' returns '${cr.name}: ${ar.type}', ` +
                    `but constraint on '${p.name}' expects '${cr.name}: ${cr.type}'`,
                  );
                }
              }
            }
          }
        }
      }
    }

    // Structure arity check on plain Assign
    if (s.type === 'Assign' && s.value?.type === 'StructureConstructor') {
      const positionals = s.value.args.filter(a => a.positional);
      if (positionals.length > 1) {
        throw new Error(`Cannot assign ${positionals.length}-arity Structure to '${s.name}' — use ': Structure' type annotation`);
      }
    }

    // Named-field check on DestructureAssign
    if (s.type === 'DestructureAssign') {
      checkNamedFields(s.pattern, s.source);
    }

    // Constructor call validation in function bodies
    const callExpr = s.type === 'ExprStatement' ? s.expr : s.value;
    if (callExpr?.type === 'FunctionCallExpr' && callExpr.callee?.type === 'Identifier'
        && dependencyNames.has(callExpr.callee.name) && factoryDecls[callExpr.callee.name]) {
      validateConstructorCall(callExpr, factoryDecls, typeEnv);
    }

    // as-clause type check on TypedAssign + FunctionCallExpr (actor instantiation)
    if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && actorInfo) {
      checkAsClauseMatch(s.typeName, s.value.callee.name, actorInfo);
    }
    // as-type check for dependency typed assign: n Integer = Dep or n Integer = Dep()
    if (s.type === 'TypedAssign' && s.typeName) {
      const depName = s.value?.type === 'Identifier' ? s.value.name
        : (s.value?.type === 'FunctionCallExpr' ? s.value.callee?.name : null);
      if (depName && dependencyNames.has(depName) && remotesParsed[depName]) {
        const asTypes = remotesParsed[depName].__asTypes;
        if (asTypes && !asTypes.includes(s.typeName)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${s.typeName}'`);
        } else if (!asTypes && !actorInfo?.has(depName)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${s.typeName}'`);
        }
      }
    }

    // ── Service coercion constraint checking ──────────────────────────
    // Check DotCallExpr on coercion aliases against the cast's constraint
    if (coercionConstraints?.size > 0) {
      const coercionDot = s.type === 'DestructureAssign' ? s.source : (s.type === 'ExprStatement' ? s.expr : s.value);
      if (coercionDot?.type === 'DotCallExpr') {
        const objName = (coercionDot.object?.type === 'Identifier' || coercionDot.object?.type === 'RefRead') ? coercionDot.object.name : null;
        if (objName && coercionConstraints.has(objName)) {
          const { constraint } = coercionConstraints.get(objName);
          const methodName = '@' + coercionDot.method;
          const spec = constraint[methodName] || constraint[coercionDot.method];
          if (spec && spec.params) {
            for (const callArg of coercionDot.args) {
              const argName = callArg.name;
              const argType = inferArgType(callArg.expr, typeEnv);
              if (!argType) continue;
              const specParam = spec.params.find(sp => sp.name === argName);
              if (specParam && specParam.type && argType !== specParam.type) {
                throw new Error(
                  `Type mismatch: cast '${objName}' constrains '${methodName}' param '${argName}' to '${specParam.type}', ` +
                  `but got '${argType}'`,
                );
              }
            }
          }
        }
      }
    }

    // ── Remote call validation ──────────────────────────────────────
    // Check DotCallExpr on declared dependencies or instance variables
    const dotCall = s.type === 'ExprStatement' ? s.expr
      : s.type === 'DestructureAssign' ? s.source
      : s.value;
    if (dotCall?.type === 'DotCallExpr') {
      const objName = (dotCall.object?.type === 'Identifier' || dotCall.object?.type === 'RefRead') ? dotCall.object.name : null;
      // Direct dependency call: Remote.call()
      if (isRemoteSend(dotCall)) {
        validateRemoteCall(dotCall, remotesParsed, typeEnv, actorByName);
      }
      // Instance call: view.open() where view is typed as a dependency name
      if (objName && !dependencyNames.has(objName)) {
        const objType = typeEnv.get(objName);
        if (objType && dependencyNames.has(objType) && remotesParsed[objType]) {
          // Validate against the instance interface
          const instanceExpr = { ...dotCall, object: { type: 'Identifier', name: objType } };
          validateRemoteCall(instanceExpr, remotesParsed, typeEnv, actorByName);
        }
      }
    }

    // Reject returning result of remote send when silent or no interface
    if (s.type === 'Reply') {
      for (const f of s.fields) {
        const dep = asDepCall(f.expr);
        if (dep) checkRemoteSendAssignable(dep, remotesParsed);
      }
    }
    if (s.type === 'ImplicitReturn') {
      const dep = asDepCall(s.expr);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Reject assigning result of remote send when not allowed
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr') {
      const dep = asDepCall(s.value);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }
    if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr') {
      const dep = asDepCall(s.source);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Function literal validation
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function' && s.value.body) {
      checkRebind(s.value.body, outerNames, 'a function');
      checkWhileReturnType(s.value);
      const fnScope = collectScopeNames(s.value.params || [], s.value.body);
      const fnTypeEnv = buildTypeEnv(s.value.params || [], s.value.body);
      validateBody(s.value.body, fnScope, actorInfo, dependencyNames, remotesParsed, factoryDecls, fnTypeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints, actorMethodsFlat, actorConstructorSigs, actorByName, actorMethodSigsFlat, localFunctionSigs, actorNameSet, actorSettersFlat);
    }

    // IfExpr re-bind check
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'IfExpr') {
      checkRebindInIf(s.value, outerNames);
    }

    // WhileStatement re-bind check
    if (s.type === 'WhileStatement' && s.body) {
      checkRebind(s.body, outerNames, 'a while block');
    }
  }
}

// ── Type consistency ────────────────────────────────────────────────────────

function checkTypeConsistency(body) {
  const typeMap = new Map();
  function checkAndSet(name, typeName) {
    if (typeMap.has(name) && typeMap.get(name) !== typeName) {
      throw new Error(`Conflicting type declarations for '${name}': '${typeMap.get(name)}' vs '${typeName}'`);
    }
    typeMap.set(name, typeName);
  }
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'TypedAssign') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'RefDecl' && s.typeName) {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) checkAndSet(item.name, item.type);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && !item.rest && item.name && item.type) checkAndSet(item.name, item.type);
      }
    }
  }
}

// ── Named-field check ───────────────────────────────────────────────────────

function checkNamedFields(pattern, source) {
  if (source.type !== 'StructureConstructor') return;
  const literalKeys = new Set(source.args.filter(a => a.key !== undefined).map(a => a.key));
  for (const item of pattern) {
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key !== null && !literalKeys.has(key)) {
      throw new Error(`Field '${key}' not found in Structure literal`);
    }
  }
}

// ── Re-bind guards ──────────────────────────────────────────────────────────

function checkRebind(body, outerNames, scopeLabel) {
  for (const s of body) {
    if (s.type === 'Assign' && outerNames.has(s.name)) {
      throw new Error(`Cannot re-bind '${s.name}' from inside ${scopeLabel} — use '${s.name} : Type = ...' to shadow it`);
    }
    if (s.type === 'WhileStatement' && s.body) {
      checkRebind(s.body, outerNames, 'a while block');
    }
  }
}

function checkRebindInIf(ifExpr, outerNames) {
  if (ifExpr.then?.body) {
    checkRebind(ifExpr.then.body, outerNames, 'an if block');
  }
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      checkRebindInIf(ifExpr.else, outerNames);
    } else if (ifExpr.else.body) {
      checkRebind(ifExpr.else.body, outerNames, 'an if block');
    }
  }
}

// ── While-null return type check ────────────────────────────────────────────

// ── Constructor call validation ─────────────────────────────────────────

function validateConstructorCall(expr, factoryDecls, _typeEnv) {
  const name = expr.callee.name;
  const declaredParams = factoryDecls[name];
  if (!declaredParams) return;

  // Build a single signature from the constructor params
  const sig = { params: declaredParams.map(p => ({ name: p.key || p.name, type: p.type })) };

  // Extract call args — may come from parseCallArgs (NamedArgsBag) or parseSendArgs (direct)
  const callNamed = new Map();
  const callPositional = [];
  for (const a of expr.args) {
    if (a.type === 'NamedArgsBag') {
      for (const [k, v] of Object.entries(a.fields)) {
        callNamed.set(k, { expr: v, typeName: null });
      }
    } else if (a.positional === false && a.name) {
      callNamed.set(a.name, { expr: a.expr, typeName: a.typeName });
    } else {
      callPositional.push(a);
    }
  }

  const sigPositional = sig.params.filter(p => !p.name);
  const sigNamed = sig.params.filter(p => p.name);
  const requiredPositional = sigPositional.filter(p => !p.optional).length;

  // Check positional count (accounting for optional params)
  if (callPositional.length < requiredPositional || callPositional.length > sigPositional.length) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type).join(', ')})`;
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. Expected ${requiredPositional === sigPositional.length ? sigPositional.length : requiredPositional + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
  }

  // Check named args match (optional named args don't need to be provided)
  const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
  const allNamedKeys = new Set(sigNamed.map(p => p.name));
  const callNamedKeys = new Set(callNamed.keys());
  const missing = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
  const extra = [...callNamedKeys].filter(k => !allNamedKeys.has(k));
  if (missing.length > 0 || extra.length > 0) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type).join(', ')})`;
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(', ')}`);
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. ${parts.join('; ')}`);
  }

  // Check types
  const argType = (a) => {
    if (a.typeName) return a.typeName;
    if (a.expr) return inferLiteralType(a.expr);
    return null;
  };

  for (const sp of sigNamed) {
    const ca = callNamed.get(sp.name);
    if (!ca) continue;
    const ct = argType(ca);
    if (ct && sp.type && ct !== sp.type) {
      throw new Error(`'${name}()' constructor arg '${sp.name}': expected ${sp.type}, got ${ct}`);
    }
  }
}

// ── Remote call validation ────────────────────────────────────────────────

function validateRemoteCall(expr, remotesParsed, typeEnv, actorByName) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) return; // no interface — no arg validation
  const methodName = expr.method;
  let sigs = parsed[methodName];
  // Type-form fallback: when the dep alias names a type in `__types` (e.g.
  // `document: <> -> { title: ... }`), look up methodName in that type's
  // function table. The synthetic actor in actorByName carries the methods
  // with `@`-prefixed names and Reply-shaped bodies for return extraction.
  if (!sigs && parsed.__types?.[actorName] && actorByName) {
    const typeActor = actorByName.get(actorName);
    let fn = typeActor?.functions?.find(f => f.name === '@' + methodName);
    // Walk the supertype chain for inherited methods. Lets a typed remote
    // singleton (e.g. `document: <Document |>`, `Document: <Node |>`) pick
    // up methods declared on its ancestors — even when those ancestors live
    // in a different remote service, since actorByName is shared.
    if (!fn && typeActor) {
      const { inheritedFunctions } = resolveSupertypeChain(actorByName, typeActor);
      fn = inheritedFunctions.find(f => f.name === '@' + methodName);
    }
    if (fn) {
      const reply = fn.body?.find(s => s.type === 'Reply');
      const returns = reply ? reply.fields.map(f => ({
        name: f.key || f.name, type: f.type, positional: f.positional,
      })) : null;
      sigs = [{ params: fn.params || [], returns }];
    }
  }
  if (!sigs) {
    const opNames = Object.keys(parsed).filter(k => !k.startsWith('__'));
    const typeMethods = parsed.__types?.[actorName]?.functions?.map(f => f.name) || [];
    const available = [...opNames, ...typeMethods].join(', ') || 'none';
    throw new Error(`'${actorName}' has no function '${methodName}'. Available: ${available}`);
  }
  const callPositional = expr.args.filter(a => a.positional !== false && a.type !== 'NamedArgsBag');
  const callNamed = expr.args.filter(a => a.positional === false || a.type === 'NamedArgsBag');
  const callNamedKeys = new Set();
  for (const a of callNamed) {
    if (a.type === 'NamedArgsBag') {
      for (const k of Object.keys(a.fields || {})) callNamedKeys.add(k);
    } else if (a.name) {
      callNamedKeys.add(a.name);
    }
  }
  const argType = (a) => {
    if (a.typeName) return a.typeName;
    if (a.expr?.type === 'Identifier' && typeEnv) {
      return typeEnv.get(a.expr.name) || null;
    }
    if (a.expr) return inferLiteralType(a.expr);
    return null;
  };
  const errors = [];
  for (const sig of sigs) {
    const sigPositional = sig.params.filter(p => !p.name);
    const sigNamed = sig.params.filter(p => p.name);
    const requiredPos = sigPositional.filter(p => !p.optional).length;
    if (callPositional.length < requiredPos || callPositional.length > sigPositional.length) {
      errors.push(`expected ${requiredPos === sigPositional.length ? sigPositional.length : requiredPos + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
      continue;
    }
    const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
    const sigNamedKeys = new Set(sigNamed.map(p => p.name));
    const missingNamed = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
    const extraNamed = [...callNamedKeys].filter(k => !sigNamedKeys.has(k));
    if (missingNamed.length > 0 || extraNamed.length > 0) {
      const parts = [];
      if (missingNamed.length) parts.push(`missing: ${missingNamed.join(', ')}`);
      if (extraNamed.length) parts.push(`unexpected: ${extraNamed.join(', ')}`);
      errors.push(parts.join('; '));
      continue;
    }
    let typeMismatch = false;
    for (let i = 0; i < callPositional.length; i++) {
      const callType = argType(callPositional[i]);
      const sigType = sigPositional[i]?.type;
      if (callType && sigType && isAssignable(callType, sigType, actorByName) === false) {
        errors.push(`positional arg ${i + 1}: expected ${sigType}, got ${callType}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    for (const a of callNamed) {
      const aName = a.name;
      if (!aName) continue;
      const callType = argType(a);
      const sigParam = sigNamed.find(p => p.name === aName);
      if (callType && sigParam?.type && isAssignable(callType, sigParam.type, actorByName) === false) {
        errors.push(`named arg '${aName}': expected ${sigParam.type}, got ${callType}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    return; // match found
  }
  const sigStrs = sigs.map(s => {
    const parts = s.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type);
    return `(${parts.join(', ')})`;
  });
  throw new Error(`'${actorName}.${methodName}()' arguments don't match any signature: ${sigStrs.join(' | ')}. ${errors[0]}`);
}

function checkRemoteSendAssignable(expr, remotesParsed) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — '${actorName}' has no declared interface.`);
  }
  const sigs = parsed[expr.method];
  if (sigs && sigs.every(s => s.returns === null)) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — it is declared as silent (-> .).`);
  }
}

// ── While-null return type check ────────────────────────────────────────────

function checkWhileReturnType(fnNode) {
  if (!fnNode.body || fnNode.body.length === 0) return;
  // Find the last non-BareTypeDecl statement (matches codegen.js _lastIsWhile tracking)
  let last = null;
  for (const s of fnNode.body) {
    if (s.type !== 'BareTypeDecl') last = s;
  }
  if (!last || last.type !== 'WhileStatement') return;
  if (fnNode.returnType && !fnNode.returnType.endsWith(' | null')) {
    throw new Error(
      `while always evaluates to null — use '${fnNode.returnType} | null' as the return type`,
    );
  }
}
