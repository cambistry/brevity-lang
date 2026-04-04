import { LIST_PREAMBLE, STRUCTURE_PREAMBLE } from './preambles.js';
import { buildTypeEnv } from './types.js';
export { parseServiceManifest } from './types.js';
import {
  CALL_LIKE, genExpr, genDestructure, genReBody, genBvaBody,
  genTypeCondition,
} from './expressions.js';
import {
  genFunctionBodyCode, genLocals,
} from './statements.js';

function createContext() {
  return {
    actorNames: new Set(),
    actorFnNames: new Set(),
    stateVarNames: new Set(),
    usesNames: new Set(),
    remoteInstanceVars: new Set(),
    childActorVars: new Map(),
    wrappedChildParams: new Set(),
    emitNames: new Map(),
    constructsProxyVars: new Set(),
    constructsMap: new Map(),
    lambdaCounter: 0,
    lambdaHandlers: [],
    lambdaVarNames: new Set(),
    lambdaCaptureFields: [],
    currentTypeEnv: null,
    // Late-bound: wired below in codegen()
    genFunctionBodyCode: null,
  };
}

function genPublicFn(ctx, { name, params, body: rawBody }, stateVarEnv = null, remotes = null) {
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement in braced body acts as implicit return (unless explicitly silent with .)
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    // Don't promote silent emit calls to implicit returns
    const isSilentEmit = lastExpr.type === 'FunctionCallExpr' && lastExpr.callee?.type === 'Identifier' && ctx.emitNames.has(lastExpr.callee.name) && ctx.emitNames.get(lastExpr.callee.name).silent;
    if (!isSilentEmit) {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }
  const destructure = genDestructure(ctx, params);
  const { env: typeEnv, remoteInferred } = buildTypeEnv(params, body, stateVarEnv, remotes);
  // Reply grounding check: reject reply fields whose type depends on remote inference
  if (reply && remoteInferred.size > 0) {
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
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;
  const locals = genLocals(ctx, body, typeEnv);
  ctx.currentTypeEnv = savedTypeEnv;
  const isPrivate = !name.startsWith('@') && !name.startsWith('::');
  let reLine;
  if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: isPrivate })};`;
  } else if (implicitReturn) {
    const raw = genExpr(ctx, implicitReturn.expr);
    const val = CALL_LIKE.has(implicitReturn.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    reLine = `\n        re = [${val}];`;
  } else {
    reLine = '';
  }
  // ::set/::update are fire-and-forget — no reply, no ack
  let bvaLine = '';
  if (reply) {
    if (reply.fields.some(f => f.spread)) {
      bvaLine = `\n        _bva_re = _bva != null ? _bva[0] : undefined;`;
    } else {
      const bvaBody = genBvaBody(ctx, reply.fields, typeEnv);
      if (bvaBody !== null) {
        bvaLine = `\n        _bva_re = ${bvaBody};`;
      }
    }
  }
  const typeCondition = genTypeCondition(ctx, params);
  const condition = typeCondition
    ? `opName === "${name}" && (from === '__parent' || from === '__self' || from === '__test' || ${typeCondition})`
    : `opName === "${name}"`;
  return { condition, block: `${destructure}${locals}${reLine}${bvaLine}\n        _handled = true;` };
}

function genFnMethod(ctx, { name, params, body: rawBody }, stateVarEnv = null) {
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    implicitReturn = { type: 'ImplicitReturn', expr: rawBody[rawBody.length - 1].expr, typeName: null };
    body = rawBody.slice(0, -1);
  }
  const destructure = genDestructure(ctx, params);
  const { env: typeEnv } = buildTypeEnv(params, body, stateVarEnv);
  const locals = genLocals(ctx, body, typeEnv);
  let reLine;
  if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: true })};`;
  } else if (implicitReturn) {
    const raw = genExpr(ctx, implicitReturn.expr);
    const val = CALL_LIKE.has(implicitReturn.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    reLine = `\n        re = [${val}];`;
  } else {
    reLine = '\n        re = null;';
  }
  const jsName = name.startsWith('#') ? `priv_${name.slice(1)}` : name;
  return `  async #${jsName}Fn(_s) {${destructure}${locals}
    let re;${reLine}
    return Structure.pack(re);
  }`;
}

// genInitMethod removed — init/$var syntax deprecated

// Resolve the full supertype chain for an actor, returning flattened inherited params and functions.
function resolveSupertypeChain(ctx, actor) {
  const supertypes = actor.supertypes || [];
  if (supertypes.length === 0) return { inheritedParams: [], inheritedFunctions: [], wrappedBindings: [], inheritedIngests: [] };

  const inheritedParams = [];
  const inheritedFunctions = [];
  const wrappedBindings = [];
  const inheritedIngests = [];

  for (const st of supertypes) {
    const superActor = ctx.actorNodes?.get(st.supertype);
    if (!superActor) continue;

    // Recursively resolve the supertype's own chain
    const parentChain = resolveSupertypeChain(ctx, superActor);

    // Collect params: grandparent params first, then direct parent params
    for (const p of parentChain.inheritedParams) {
      if (!inheritedParams.some(ip => ip.name === p.name)) inheritedParams.push(p);
    }
    for (const p of (superActor.initParams || [])) {
      if (!inheritedParams.some(ip => ip.name === p.name)) inheritedParams.push(p);
    }

    // Collect functions: grandparent functions first, then direct parent
    for (const f of parentChain.inheritedFunctions) {
      const idx = inheritedFunctions.findIndex(ef => ef.name === f.name);
      if (idx >= 0) inheritedFunctions[idx] = f; // override
      else inheritedFunctions.push(f);
    }
    for (const f of superActor.functions) {
      const idx = inheritedFunctions.findIndex(ef => ef.name === f.name);
      if (idx >= 0) inheritedFunctions[idx] = f; // override
      else inheritedFunctions.push(f);
    }

    // Track wrapped instance bindings
    if (st.wrappedAs) {
      wrappedBindings.push({ name: st.wrappedAs, supertype: st.supertype });
    }

    // Collect ingest declarations from the supertype
    for (const sv of (superActor.stateVarDecls || [])) {
      if (sv.ingest) {
        inheritedIngests.push({ name: sv.name, typeName: sv.typeName, defaultValue: sv.ingestDefault, fromSupertype: st.supertype });
      }
    }
  }

  return { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests };
}

function genClass(ctx, actor, exportKw, remotes = null) {
  // Reset lambda state for this class
  ctx.lambdaCounter = 0;
  ctx.lambdaHandlers = [];
  ctx.lambdaVarNames = new Set();
  ctx.lambdaCaptureFields = [];

  // ── Resolve supertype inheritance ──────────────────────────────────────
  const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSupertypeChain(ctx, actor);

  // Merge inherited params (prepend) — skip any that the subtype redefines
  const ownParamNames = new Set((actor.initParams || []).map(p => p.name));
  const mergedParams = [
    ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
    ...(actor.initParams || []),
  ];

  // Merge inherited functions — subtype's own functions take precedence
  // If there's a wrapped binding, inherited public functions delegate through the wrapped instance
  const ownFnNames = new Set(actor.functions.map(f => f.name));
  const delegatedFunctions = []; // functions to forward to wrapped supertype
  const inlinedInherited = [];   // functions to inline directly

  for (const f of inheritedFunctions) {
    if (ownFnNames.has(f.name) || f.name?.startsWith('#')) continue;
    // If there's a wrapped binding, delegate public functions through it
    if (wrappedBindings.length > 0 && f.name?.startsWith('@')) {
      delegatedFunctions.push(f);
    } else {
      inlinedInherited.push(f);
    }
  }
  const mergedFunctions = [
    ...actor.functions,
    ...inlinedInherited,
  ];

  // Build a modified actor with merged members
  const mergedActor = {
    ...actor,
    initParams: mergedParams,
    functions: mergedFunctions,
  };

  // Merge inherited ingest state var decls into the subtype
  if (inheritedIngests.length > 0) {
    const ownStateNames = new Set((mergedActor.stateVarDecls || []).map(v => v.name));
    for (const ingest of inheritedIngests) {
      if (!ownStateNames.has(ingest.name)) {
        mergedActor.stateVarDecls = [
          ...(mergedActor.stateVarDecls || []),
          { name: ingest.name, typeName: ingest.typeName, ingest: true, ingestDefault: ingest.defaultValue },
        ];
      }
    }
  }

  // Track wrapped supertype bindings — these are auto-created, not constructor params
  const supertypeBindings = [];
  for (const wb of wrappedBindings) {
    const superActor = ctx.actorNodes?.get(wb.supertype);
    if (superActor) {
      supertypeBindings.push(wb);
    }
  }

  const name = mergedActor.name ? ` ${mergedActor.name}` : '';

  const isFnDecl = f => f.type === 'FunctionDecl';
  const isPublicOrBuiltin = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const publicFns = mergedActor.functions.filter(f => isFnDecl(f) && isPublicOrBuiltin(f));
  const privateFns = mergedActor.functions.filter(f => isFnDecl(f) && !isPublicOrBuiltin(f));
  const onHandlers = mergedActor.functions.filter(f => f.type === 'OnHandler');

  ctx.actorFnNames = new Set(privateFns.map(f => f.name));
  const allFns = [...publicFns, ...privateFns];
  const usesStructure = allFns.some(h => h.params.length > 0) || onHandlers.some(h => h.params.length > 0);
  const usesTypeMatching = allFns.some(h => h.params.some(p => !p.rest));

  const stateVarDecls = mergedActor.stateVarDecls || [];
  const initBody = mergedActor.initBody || [];
  const constructorParams = mergedActor.initParams || [];
  // Collect service coercion aliases from constructor body
  const serviceCoercions = (mergedActor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
  // Constructor params are also state — accessible from handlers
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
    ...supertypeBindings.map(wb => wb.name),
  ];
  ctx.stateVarNames = new Set(allStateNames);
  ctx.remoteInstanceVars = new Set();
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.usesNames.has(s.value.callee.name)) {
      if (!ctx.constructsMap.has(s.value.callee.name)) ctx.remoteInstanceVars.add(s.name);
    }
  }
  // Track constructs proxy vars — these hold child actor instances, not remote addresses
  ctx.constructsProxyVars = new Set();
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.constructsMap.has(s.value.callee.name)) {
      ctx.constructsProxyVars.add(s.name);
    }
  }
  // Constructor params marked with ref: true (the * syntax) are wrapped child actor references
  // Bare idents without ref flag on a constructs proxy are remote instance refs
  const isConstructsProxy = [...ctx.constructsMap.values()].some(c => c.proxyName === mergedActor.name);
  ctx.wrappedChildParams = new Set();
  for (const p of constructorParams) {
    if (p.ref) {
      ctx.wrappedChildParams.add(p.name);
    } else if (p.type === 'Anything') {
      if (isConstructsProxy) {
        ctx.remoteInstanceVars.add(p.name);
      } else {
        ctx.wrappedChildParams.add(p.name);
      }
    }
  }
  // Service coercion aliases are also wrapped child params
  for (const s of serviceCoercions) {
    ctx.wrappedChildParams.add(s.name);
  }
  // Supertype wrapped instance bindings are child actors (auto-created)
  for (const wb of supertypeBindings) {
    ctx.wrappedChildParams.add(wb.name);
  }
  // Collect emit declarations
  const emitDecls = new Map();
  for (const s of (mergedActor.constructorBody || [])) {
    if (s.type === 'EmitDecl') emitDecls.set(s.name, s);
  }
  ctx.emitNames = emitDecls;
  const stateVarEnv = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);

  // All functions (public + private) go through dispatch as self-send targets
  const allDispatchFns = [...publicFns, ...privateFns];
  const publicFnParts = allDispatchFns.map(h => genPublicFn(ctx, h, stateVarEnv, remotes));

  // Generate lambda handler arms (registered during codegen above)
  // Use index loop since nested lambdas may add new handlers during iteration
  const lambdaParts = [];
  for (let li = 0; li < ctx.lambdaHandlers.length; li++) {
    const lh = ctx.lambdaHandlers[li];
    const { name: lName, varName: lVarName, fn: fnNode, captures } = lh;
    const params = fnNode.params || [];
    const destr = genDestructure(ctx, params);
    let block = destr;
    // Declare self-reference so recursive lambdas can call themselves
    if (lVarName) {
      const jsVarName = lVarName.startsWith('#') ? `_pv_${lVarName.slice(1)}` : lVarName;
      block += `\n        const ${jsVarName} = "${lName}";`;
    }
    // Load captures from private fields
    if (captures && captures.length > 0) {
      for (const cap of captures) {
        block += `\n        const ${cap.name} = this.#_cap_${cap.lambdaName}_${cap.name};`;
      }
    }
    // Generate body using genFunctionBodyCode-style to support all assignment forms
    if (fnNode.body) {
      const fnCode = genFunctionBodyCode(ctx, params, fnNode.body, null, fnNode.returnType);
      if (fnNode.returnType === '.') {
        // Silent/void lambda — invoke and return ack so self-send resolves
        block += `\n        await (${fnCode})(_s);\n        re = null;`;
      } else {
        // fnCode is `async (_s) => {...}` — we invoke it inline to get the result
        block += `\n        re = Structure.splat(await (${fnCode})(_s));`;
      }
    } else if (fnNode.expr) {
      if (fnNode.returnType === '.') {
        block += `\n        ${genExpr(ctx, fnNode.expr)};`;
      } else {
        block += `\n        re = [${genExpr(ctx, fnNode.expr)}];`;
      }
    }
    block += '\n        _handled = true;';
    lambdaParts.push({ condition: `opName === "${lName}"`, block });
  }

  // Generate on-handler dispatch arms
  const onParts = onHandlers.map(h => {
    const destructure = genDestructure(ctx, h.params);
    const { env: typeEnv } = buildTypeEnv(h.params, h.body, stateVarEnv);
    const savedTypeEnv = ctx.currentTypeEnv;
    ctx.currentTypeEnv = typeEnv;
    const locals = genLocals(ctx, h.body, typeEnv);
    ctx.currentTypeEnv = savedTypeEnv;
    const hasSilent = h.body.some(s => s.type === 'SilentTerminator');
    let reLine = '';
    if (!hasSilent) {
      const reply = h.body.find(s => s.type === 'Reply');
      if (reply) {
        reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: true })};`;
      }
    }
    const block = `${destructure}${locals}${reLine}\n        _handled = true;`;
    // For constructs proxies, match from against the remote address stored in state
    const sourceIsRemote = ctx.remoteInstanceVars.has(h.source);
    const fromCheck = sourceIsRemote
      ? `from === this.#${h.source}`
      : 'from === "__emit"';
    return { condition: `opName === ${JSON.stringify(h.eventName)} && ${fromCheck}`, block };
  });

  // Auto-generate accessor dispatch arms for constructor params
  const accessorParts = constructorParams
    .map(p => {
      // suppressAccessor: positional (name) suppression
      if (p.suppressAccessor) return null;
      // key present without accessor: alias suppresses accessor
      if (p.key && !p.accessor) return null;
      const accessorName = p.accessor || p.name;
      const internalName = p.name;
      return {
        condition: `opName === ${JSON.stringify('@' + accessorName)}`,
        block: `\n        re = { ${accessorName}: this.#${internalName} };\n        _handled = true;`,
      };
    })
    .filter(Boolean);

  // Generate delegation arms for inherited functions from wrapped supertypes
  const delegationParts = delegatedFunctions.map(f => {
    // Find the wrapped binding to delegate through
    const wb = supertypeBindings[0]; // Use the first (primary) wrapped binding
    return {
      condition: `opName === "${f.name}"`,
      block: `\n        re = await this.#childSend(this.#${wb.name}, "${f.name}");\n        _handled = true;`,
    };
  });

  const allParts = [...publicFnParts, ...lambdaParts, ...onParts, ...accessorParts, ...delegationParts];
  const ifChain = allParts.length > 0
    ? allParts.map(({ condition, block }, i) => {
        const kw = i === 0 ? '    if' : '    } else if';
        return `${kw} (${condition}) {${block}`;
      }).join('\n') + '\n    }'
    : '';

  const hasLambdas = ctx.lambdaHandlers.length > 0;
  const structureLine = (usesStructure || hasLambdas)
    ? '\n    const _s = Structure.pack(payload);'
    : '';
  const bvaDecl = "\n    const _bva = message['bv-a'];";
  const typesLines = usesTypeMatching
    ? "\n    const _types = _bva != null ? Structure.pack(_bva[0] ?? null) : null;"
    : '';

  // Generate remote ref from-check for payload validation bypass
  const remoteRefChecks = [...ctx.remoteInstanceVars].map(n => `from !== this.#${n}`).join(' && ');

  const fnMethods = privateFns.map(f => genFnMethod(ctx, f, stateVarEnv)).join('\n\n');
  const fnSection = fnMethods ? '\n\n' + fnMethods : '';

  // Private field declarations — values set in constructor
  const allFieldNames = new Set([
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
    ...supertypeBindings.map(wb => wb.name),
  ]);
  const stateFields = [...allFieldNames].map(n => `  #${n}`).join('\n');
  const captureFields = ctx.lambdaCaptureFields.map(n => `  #${n}`).join('\n');
  const fieldSection = [stateFields, captureFields].filter(Boolean).join('\n');

  // Constructor: initialize state from params and constructor body
  const ctorParamNames = constructorParams.map(p => p.name);
  const constructorArgs = ['binding', ...ctorParamNames].join(', ');
  const paramInitLines = ctorParamNames.map(n => `    this.#${n} = ${n};`);
  function genOneInitLine(s) {
    // Check if this is a remote construction: ref x = UsesName(args)
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.usesNames.has(s.value.callee.name)) {
      const targetName = s.value.callee.name;
      const cDecl = ctx.constructsMap.get(targetName);
      if (!cDecl) ctx.remoteInstanceVars.add(s.name);
      const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
      let argsExpr;
      if (positionalArgs.length === 0 && !namedBag) {
        argsExpr = '{}';
      } else if (namedBag) {
        const fields = Object.entries(namedBag.fields).map(([k, v]) => `${k}: ${genExpr(ctx, v)}`).join(', ');
        if (positionalArgs.length > 0) {
          argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}, {${fields}}]`;
        } else {
          argsExpr = `{${fields}}`;
        }
      } else {
        argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}]`;
      }
      if (cDecl && cDecl.proxyName) {
        return `    this.#sendNew(${argsExpr}, ${JSON.stringify(targetName)}).then(async (addr) => {\n` +
          `      this.#${s.name} = await ${cDecl.proxyName}.create(this.#binding, addr);\n` +
          `      if (!this.#_remoteRoutes) this.#_remoteRoutes = new Map();\n` +
          `      this.#_remoteRoutes.set(addr, this.#${s.name});\n` +
          `    });`;
      }
      return `    this.#sendNew(${argsExpr}, ${JSON.stringify(targetName)}).then(addr => { this.#${s.name} = addr; });`;
    }
    if (s.type === 'ServiceCoercion') {
      const refName = s.ref?.name || s.ref;
      return `    this.#${s.name} = ${ctx.wrappedChildParams.has(refName) || ctx.stateVarNames.has(refName) ? `this.#${refName}` : genExpr(ctx, s.ref)};`;
    }
    if (s.value === null) return `    this.#${s.name} = undefined;`;
    return `    this.#${s.name} = ${genExpr(ctx, s.value)};`;
  }

  // Split init body into pre-ingest, ingest, and post-ingest phases
  let ownIngestInfo = null; // { name, defaultValue } — this actor's own ingest
  const preIngestBodyLines = [];
  const postIngestBodyLines = [];
  let pastIngest = false;
  for (const s of initBody) {
    if (s.value?.type === 'IngestExpr') {
      ownIngestInfo = { name: s.name, defaultValue: s.value.defaultValue };
      pastIngest = true;
      continue;
    }
    (pastIngest ? postIngestBodyLines : preIngestBodyLines).push(genOneInitLine(s));
  }
  const bodyInitLines = pastIngest ? preIngestBodyLines : preIngestBodyLines; // alias for non-ingest path
  // Generate init lines for service coercions
  const coercionInitLines = serviceCoercions.map(s => {
    const refName = s.ref?.name || s.ref;
    return `    this.#${s.name} = ${ctx.stateVarNames.has(refName) ? `this.#${refName}` : genExpr(ctx, s.ref)};`;
  });
  const allInitLines = [...paramInitLines, ...preIngestBodyLines];

  // Handle ingest: inject the ingest value between pre and post phases
  if (ownIngestInfo) {
    if (ownIngestInfo.defaultValue) {
      // Default: use _ingest param with default value
      allInitLines.push(`    this.#${ownIngestInfo.name} = _ingest_${ownIngestInfo.name} !== undefined ? _ingest_${ownIngestInfo.name} : ${genExpr(ctx, ownIngestInfo.defaultValue)};`);
    } else {
      allInitLines.push(`    this.#${ownIngestInfo.name} = _ingest_${ownIngestInfo.name};`);
    }
    allInitLines.push(...postIngestBodyLines);
  } else if (inheritedIngests.length > 0 && actor.declarationReturn) {
    // This subtype provides a value for its supertype's ingest
    // Evaluate the declaration return and assign to the inherited ingest var
    const ingest = inheritedIngests[0]; // primary ingest from direct supertype
    allInitLines.push(`    this.#${ingest.name} = ${genExpr(ctx, actor.declarationReturn.expr)};`);
  } else if (inheritedIngests.length > 0) {
    // Subtype doesn't provide a return — use supertype's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        allInitLines.push(`    this.#${ingest.name} = ${genExpr(ctx, ingest.defaultValue)};`);
      }
    }
  }

  allInitLines.push(...coercionInitLines);
  // Generate on-handler init lines (subscribe to child emits)
  const onInitLines = onHandlers.map(h => {
    return `    if (this.#${h.source} && this.#${h.source}._subscribe) this.#${h.source}._subscribe(${JSON.stringify(h.eventName)}, async (msg) => { await this.#dispatch(msg); });`;
  });
  if (onInitLines.length > 0) {
    allInitLines.push(...onInitLines);
  }
  // Auto-create wrapped supertype instances
  for (const wb of supertypeBindings) {
    const superActor = ctx.actorNodes?.get(wb.supertype);
    if (superActor) {
      // Pass inherited params from the supertype to its constructor
      const superParams = (superActor.initParams || []).map(p => p.name);
      const args = superParams.length > 0 ? `, ${superParams.join(', ')}` : '';
      // Pass ingest value if the supertype uses ingest and this subtype has a declaration return
      const superIngests = (superActor.stateVarDecls || []).filter(v => v.ingest);
      let ingestArg = '';
      if (superIngests.length > 0 && actor.declarationReturn) {
        ingestArg = `, ${genExpr(ctx, actor.declarationReturn.expr)}`;
      }
      allInitLines.push(`    this.#${wb.name} = await ${wb.supertype}.create({post: (msg) => this.receive(msg)}${args}${ingestArg});`);
    }
  }
  // Regenerate initMethodBody with on-handler lines
  const finalInitBody = allInitLines.length > 0
    ? `\n${allInitLines.join('\n')}\n  `
    : ' ';

  const hasEmits = emitDecls.size > 0;

  return `${exportKw}class${name} {
  #binding
  #pending = new Map()
  #_newPending = new Map()
  #_testFwd = new Map()${hasEmits ? '\n  #_subscribers = new Map()' : ''}
  #nextId = 0
  #_remoteRoutes = null
${fieldSection ? fieldSection + '\n' : ''}
  constructor(binding) { this.#binding = binding; }

  _adoptBinding(binding) { const old = this.#binding; this.#binding = binding; return old; }${hasEmits ? `

  _subscribe(event, callback) {
    if (!this.#_subscribers.has(event)) this.#_subscribers.set(event, []);
    this.#_subscribers.get(event).push(callback);
  }

  async #emit(event, payload) {
    const subs = this.#_subscribers.get(event) || [];
    for (const cb of subs) {
      const op = payload && Object.keys(payload).length > 0 ? [payload, event] : event;
      await cb({ op, from: '__emit' });
    }
  }

  async #emitAwait(event, payload) {
    const subs = this.#_subscribers.get(event) || [];
    for (const cb of subs) {
      const id = String(++this.#nextId);
      const p = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
      const op = payload && Object.keys(payload).length > 0 ? [payload, event] : event;
      cb({ id, op, from: '__emit' });
      return p;
    }
    return null;
  }` : ''}

  async #init(${[...ctorParamNames, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {${finalInitBody}}

  static async create(${['binding', ...ctorParamNames, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {
    const instance = new this(binding);
    await instance.#init(${[...ctorParamNames, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')});
    return instance;
  }

  async #send(op, to, bva) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const _msg = { id, op, to };
      if (bva !== undefined) _msg['bv-a'] = bva;
      this.#binding.post(_msg);
    });
  }

  async #sendNew(args, to) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#_newPending.set(id, resolve);
      const _msg = { id, op: [args, '::new'], to };
      this.#binding.post(_msg);
    });
  }${(!mergedActor.name && ctx.actorNames.size > 0) || ctx.wrappedChildParams.size > 0 || ctx.constructsProxyVars.size > 0 ? `

  async #childSend(child, op) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      child.receive({ id, op, from: '__parent', _route: (msg) => this.receive(msg) });
    });
  }` : ''}${fnSection}

  #capture() {
    return {${[...allFieldNames].map(n => ` ${n}: this.#${n}`).join(',')} };
  }

  #hydrate(state) {
${[...allFieldNames].map(n => `    if ('${n}' in state) this.#${n} = state.${n};`).join('\n')}
  }

  async #_test(message) {
    const t = message.test;
    if ('target' in t) {
      const parts = t.target.split('.');
      const childName = parts[0];
      const _refs = {${[...allFieldNames].map(n => ` '${n}': this.#${n}`).join(',')} };
      const child = _refs[childName];
      if (!child || typeof child.receive !== 'function') {
        this.#binding.post({ id: message.id, ex: { target: 'not_found' }, to: message.from });
        return;
      }
      const rest = parts.slice(1);
      const fwd = { ...t };
      delete fwd.target;
      if (rest.length > 0) fwd.target = rest.join('.');
      if ('set' in fwd || 'update' in fwd) {
        child.receive({ test: fwd, from: message.from });
      } else {
        const fwdId = String(++this.#nextId);
        this.#_testFwd.set(fwdId, (reply) => {
          this.#binding.post({ ...reply, id: message.id });
        });
        child.receive({ id: fwdId, test: fwd, from: message.from });
      }
      return;
    }
    if ('get' in t) {
      const _vals = {${[...allFieldNames].map(n => ` '${n}': this.#${n}`).join(',')} };
      const _types = {${[...stateVarDecls.map(v => ` '${v.name}': '${v.typeName}'`), ...constructorParams.map(p => ` '${p.name}': '${p.type || 'Anything'}'`)].join(',')} };
      let _v = _vals[t.get];
      if (_types[t.get] === 'Structure' && _v && typeof _v === 'object' && _v.positional) {
        const _hasPos = _v.positional.length > 0;
        const _hasNamed = _v.named && Object.keys(_v.named).length > 0;
        _v = _hasPos && _hasNamed ? [..._v.positional, _v.named] : _hasPos ? _v.positional : _v.named || {};
      }
      const _post = { id: message.id, re: _v, to: message.from };
      if (_types[t.get]) _post['bv-a'] = _types[t.get];
      this.#binding.post(_post);
    } else if ('set' in t) {
      const _sv = t.set;
      const payload = Array.isArray(_sv) ? _sv : (typeof _sv === 'object' && _sv !== null) ? _sv : [_sv];
      this.#dispatch({ op: [payload, '::set'], from: '__self' });
    } else if ('update' in t) {
      const _uv = t.update;
      const payload = Array.isArray(_uv) ? _uv : (typeof _uv === 'object' && _uv !== null) ? _uv : [_uv];
      this.#dispatch({ op: [payload, '::update'], from: '__self' });
    } else if ('op' in t) {
      await this.#dispatch({ id: message.id, op: t.op, from: '__test', _replyTo: message.from });
    }
  }

  async #selfSend(op) {
    const id = String(++this.#nextId);
    const p = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    await this.#dispatch({ id, op, from: '__self' });
    return p;
  }

  receive(message) {
    if (this.#_testFwd.has(message.id)) {
      const cb = this.#_testFwd.get(message.id);
      this.#_testFwd.delete(message.id);
      cb(message);
      return;
    }
    if ('re' in message) {
      const newResolve = this.#_newPending.get(message.id);
      if (newResolve) { this.#_newPending.delete(message.id); newResolve(message.from); return; }
      const pending = this.#pending.get(message.id);
      if (pending) { this.#pending.delete(message.id); pending.resolve(message.re); return; }
      // No matching pending — may need to forward to a proxy via remote routes
    }
    if ('ex' in message) {
      const newResolve = this.#_newPending.get(message.id);
      if (newResolve) { this.#_newPending.delete(message.id); newResolve(null); return; }
      const pending = this.#pending.get(message.id);
      if (pending) { this.#pending.delete(message.id); pending.reject(message.ex); return; }
      // No matching pending — may need to forward to a proxy via remote routes
    }
    if (message.cam === 'capture') {
      this.#binding.post({ id: message.id, re: this.#capture(), to: message.from });
      return;
    }
    if (Array.isArray(message.cam) && message.cam[message.cam.length - 1] === 'hydrate') {
      this.#hydrate(message.cam[0]);
      this.#binding.post({ id: message.id, re: 'hydrate', to: message.from });
      return;
    }
    if (message.test) {
      this.#_test(message);
      return;
    }
    if (this.#_remoteRoutes && message.from) {
      const proxy = this.#_remoteRoutes.get(message.from);
      if (proxy) { proxy.receive(message); return; }
    }
    this.#dispatch(message);
  }

  async #dispatch(message) {
    const { id } = message;
    const from = message.from;
    const _replyTo = message._replyTo || from;
    const opName = typeof message.op === 'string' ? message.op : message.op[message.op.length - 1];
    const _rawPayload = Array.isArray(message.op) ? message.op[0] : null;
    const _hasPayload = _rawPayload !== null && _rawPayload !== undefined &&
      (Array.isArray(_rawPayload) ? _rawPayload.length > 0 : Object.keys(_rawPayload).length > 0);
    if (_hasPayload && !('bv-a' in message) && from !== '__parent' && from !== '__self' && from !== '__test' && from !== '__emit'${remoteRefChecks ? ` && ${remoteRefChecks}` : ''}) {
      this.#binding.post({ id, ex: { [opName]: 'schema_required' }, to: _replyTo });
      return;
    }
    const payload = _rawPayload ?? {};${structureLine}${bvaDecl}${typesLines}
    let re;
    let _bva_re;
    let _handled = false;
    try {
${ifChain}
    } catch (err) {
      const _route = message._route || (from === '__self' ? (msg) => this.receive(msg) : (msg) => this.#binding.post(msg));
      _route({ id, ex: { [opName]: 'error' }, to: _replyTo });
      return;
    }
    const _route = message._route || (from === '__self' ? (msg) => this.receive(msg) : (msg) => this.#binding.post(msg));
    if (!_handled) {
      _route({ id, ex: { [opName]: 'unhandled' }, to: _replyTo });
    } else if (re !== undefined) {
      const _post = { id, re, to: _replyTo };
      if (_bva_re !== undefined) _post['bv-a'] = _bva_re;
      _route(_post);
    } else if (id && (from === '__parent' || from === '__self')) {
      // Silent handler — send empty ack so internal callers don't hang
      _route({ id, re: null, to: _replyTo });
    }
  }
}`;
}

export function codegen(ast, options = {}) {
  const ctx = createContext();
  // Wire late binding for genFunctionBodyCode
  ctx.genFunctionBodyCode = genFunctionBodyCode;
  // Build remotes from inline manifests and merge with options.remotes
  const inlineRemotes = {};
  for (const u of (ast.useDecls || [])) {
    if (u.manifest) inlineRemotes[u.name] = u.manifest;
  }
  // Resolve path-keyed remotes to alias names
  const resolvedRemotes = {};
  if (options.remotes) {
    if (Array.isArray(options.remotes)) {
      const pathToAlias = new Map();
      for (const u of (ast.useDecls || [])) {
        if (u.path) pathToAlias.set(u.path, u.name);
      }
      for (const { path, service } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) resolvedRemotes[alias] = service;
      }
    } else {
      Object.assign(resolvedRemotes, options.remotes);
    }
  }
  const _remotes = Object.keys(inlineRemotes).length > 0 || Object.keys(resolvedRemotes).length > 0
    ? { ...inlineRemotes, ...resolvedRemotes }
    : null;
  // Build constructs map: factory name → { proxyName, proxyParam }
  ctx.constructsMap = new Map();
  for (const c of (ast.constructsDecls || [])) {
    ctx.constructsMap.set(c.factory, c);
  }
  const active = ast.actors.filter(a => a.functions.length > 0 || (a.constructorBody && a.constructorBody.length > 0) || (a.stateVarDecls && a.stateVarDecls.length > 0) || (a.initParams && a.initParams.length > 0));
  if (active.length === 0) return '';

  function bodyUsesStructure(body) {
    return body.some(s =>
      s.type === 'DestructureAssign' ||
      s.type === 'TypedAssign' ||
      (s.type === 'Assign' && (
        s.value.type === 'Function' ||
        s.value.type === 'StructureLiteral' ||
        s.value.type === 'StructureConstructor' ||
        CALL_LIKE.has(s.value.type)
      )),
    );
  }
  function bodyUsesList(body) {
    const iterExpr = t => t === 'OverExpr' || t === 'ReduceExpr';
    return body.some(s =>
      s.type === 'ListDestructure' ||
      (s.type === 'Assign' && (s.value?.type === 'ListLiteral' || iterExpr(s.value?.type))) ||
      (s.type === 'TypedAssign' && (
        (typeof s.typeName === 'string' && s.typeName.startsWith('List')) ||
        iterExpr(s.value?.type)
      )) ||
      (s.type === 'BareTypeDecl' && typeof s.typeName === 'string' && s.typeName.startsWith('List')),
    );
  }
  const needsPreamble = active.some(a =>
    a.functions.some(f => f.name && ((f.name.startsWith('@') || f.name.startsWith('::')) ? (f.params.length > 0 || bodyUsesStructure(f.body)) : true)) ||
    (a.initBody && bodyUsesStructure(a.initBody)) ||
    (a.initParams && a.initParams.length > 0),
  );
  const needsListPreamble = active.some(a =>
    a.functions.some(f =>
      f.params.some(p => typeof p.type === 'string' && p.type.startsWith('List')) ||
      bodyUsesList(f.body),
    ) ||
    (a.initBody && bodyUsesList(a.initBody)),
  );
  ctx.actorNodes = new Map(active.filter(a => a.name).map(a => [a.name, a]));
  // Build actorNames with merged initParams for subtypes (so constructor calls know full param list)
  ctx.actorNames = new Map(active.filter(a => a.name).map(a => {
    const { inheritedParams } = resolveSupertypeChain(ctx, a);
    const ownParamNames = new Set((a.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(a.initParams || []),
    ];
    return [a.name, { asClauses: a.asClauses || [], initParams: mergedParams }];
  }));
  ctx.usesNames = new Set((ast.useDecls || []).map(u => u.name));
  // Parse all remote manifests for compile-time validation (TODO)
  const classes = active.map(a => genClass(ctx, a, a.name ? '' : 'export default ', _remotes) + '\n').join('\n');
  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') +
         (needsListPreamble ? LIST_PREAMBLE + '\n\n' : '') +
         classes;
}

export default codegen;
