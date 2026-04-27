import * as AST from '../../ast.js';
import { resolveSuperclassChain } from '../../subclass.js';
import { LIST_PREAMBLE, STRUCTURE_PREAMBLE, TEXT_PREAMBLE, MATH_PREAMBLE, DECIMAL_PREAMBLE, STRING_PREAMBLE, EQUALITY_PREAMBLE } from './preambles.js';
import { buildTypeEnv, parseInterface } from './types.js';
export { parseInterface } from './types.js';
import {
  CALL_LIKE, genExpr, genDestructure, genReBody, genBvaBody,
  genTypeCondition, genDefaultValue,
} from './expressions.js';
import {
  genFunctionBodyCode, genLocals,
} from './statements.js';

function stripAsTypeSuffix(service) {
  if (typeof service !== 'string') return service;
  const t = service.trim();
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) return t.slice(0, i + 1); }
  }
  return t;
}

function createContext() {
  return {
    actorNames: new Set(),
    actorFnNames: new Set(),
    stateVarNames: new Set(),
    dependencyNames: new Set(),
    remoteInstanceVars: new Set(),
    // Per-handler-body locals bound to dep constructor calls:
    //   @go = { t = Thing(args); ... t.method() ... }
    // The dep call inside a handler emits `new` and binds the result address
    // to a function-local var; subsequent t.method() calls route to that
    // address via `this.#send(op, t)` (no `this.#` prefix since it's local).
    localInstanceVars: new Set(),
    childActorVars: new Map(),
    wrappedChildParams: new Set(),
    emitNames: new Map(),
    lambdaCounter: 0,
    lambdaHandlers: [],
    lambdaVarNames: new Set(),
    lambdaCaptureFields: [],
    currentTypeEnv: null,
    // Late-bound: wired below in codegen()
    genFunctionBodyCode: null,
  };
}

function genPublicFn(ctx, { name, params, body: rawBody, actorDef }, stateVarEnv = null, remotes = null) {
  // Skip actorDef constructor clauses — dispatched via actor instantiation, not message dispatch
  if (actorDef) return null;
  // Skip empty Function() initializers — they produce no dispatch arm
  if (arguments[1].emptyOverload) return null;
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
  // Save SSA scope: genLocals sets ctx.ssaScope/ssaCounts and leaves them
  // set so the reply/return emission below sees the right SSA names. Restore
  // at end.
  const savedSsaScope = ctx.ssaScope;
  const savedSsaCounts = ctx.ssaCounts;
  const locals = genLocals(ctx, body, typeEnv);
  const isPrivate = !name.startsWith('@') && name !== 'set' && name !== 'update' && !name.startsWith('set@');
  let reLine;
  if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: isPrivate })};`;
  } else if (implicitReturn) {
    const raw = genExpr(ctx, implicitReturn.expr);
    const val = CALL_LIKE.has(implicitReturn.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    reLine = `\n        re = [${val}];`;
  } else if (hasSilent) {
    reLine = '';
  } else {
    reLine = '\n        re = [];';
  }
  // `set`/`update` are fire-and-forget — no reply, no ack
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
  ctx.ssaScope = savedSsaScope;
  ctx.ssaCounts = savedSsaCounts;
  ctx.currentTypeEnv = savedTypeEnv;
  const typeCondition = genTypeCondition(ctx, params);
  // For overloaded functions (multiple clauses with same name), add arity check
  const hasOverloads = ctx._allDispatchFns && ctx._allDispatchFns.filter(f => f.name === name).length > 1;
  let condition;
  if (hasOverloads && params.length > 0) {
    // Overloaded: arity check applies to ALL callers (including self-sends)
    const allPos = params.filter(p => p.positional);
    const posCount = allPos.length;
    const requiredPosCount = allPos.filter(p => !p.defaultValue).length;
    const allNamed = params.filter(p => !p.positional);
    const requiredNamedKeys = allNamed.filter(p => !p.defaultValue).map(p => p.key || p.name);
    const allNamedKeys = allNamed.map(p => p.key || p.name);
    const checks = [];
    if (posCount > 0) {
      if (requiredPosCount < posCount) {
        checks.push(`_s.positional.length >= ${requiredPosCount} && _s.positional.length <= ${posCount}`);
      } else {
        checks.push(`_s.positional.length === ${posCount}`);
      }
    }
    for (const k of requiredNamedKeys) checks.push(`${JSON.stringify(k)} in _s.named`);
    // Ensure caller doesn't provide named keys this clause doesn't accept
    if (allNamedKeys.length > 0) {
      checks.push(`Object.keys(_s.named).every(k => [${allNamedKeys.map(k => JSON.stringify(k)).join(',')}].includes(k))`);
    }
    if (typeCondition) {
      // External callers also need type matching
      condition = `opName === "${name}" && (${checks.join(' && ')}) && (from === '__parent' || from === '__self' || from === '__test' || ${typeCondition})`;
    } else {
      condition = `opName === "${name}" && (${checks.join(' && ')})`;
    }
  } else if (typeCondition) {
    condition = `opName === "${name}" && (from === '__parent' || from === '__self' || from === '__test' || ${typeCondition})`;
  } else {
    condition = `opName === "${name}"`;
  }
  // set@<cell>: after mutation, replay the new value to each registered
  // subscriber using the stored id. Notification shape matches the getter
  // (positional `re` plus `bv-a` type tag). Additionally, for every public
  // fn whose body captures this cell, re-dispatch `@<fn>` per subscriber so
  // derived computations get re-evaluated and replayed.
  let notifyBlock = '';
  if (name.startsWith('set@')) {
    const cellName = name.slice('set@'.length);
    const key = JSON.stringify(cellName);
    const cellType = params[0]?.type;
    const bvaPart = cellType ? `, 'bv-a': [${JSON.stringify(cellType)}]` : '';
    notifyBlock = `
        { const _subs = this.#_cellSubs.get(${key}); if (_subs) for (const _sub of _subs) this.#binding.post({ id: _sub.id, re: [this.#${cellName}]${bvaPart}, to: _sub.from }); }`;
    // Derived fn replay for this cell is emitted by the underlying
    // SetStatement codegen (set@<cell>'s body is `<cell> <- _v`), so no
    // additional replay block here.
  }
  return { condition, block: `${destructure}${locals}${reLine}${bvaLine}${notifyBlock}\n        _handled = true;` };
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
  const savedSsaScope = ctx.ssaScope;
  const savedSsaCounts = ctx.ssaCounts;
  const locals = genLocals(ctx, body, typeEnv);
  let reLine;
  if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: true })};`;
  } else if (implicitReturn) {
    const raw = genExpr(ctx, implicitReturn.expr);
    const val = CALL_LIKE.has(implicitReturn.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    reLine = `\n        re = [${val}];`;
  } else {
    reLine = '\n        re = [];';
  }
  ctx.ssaScope = savedSsaScope;
  ctx.ssaCounts = savedSsaCounts;
  const jsName = name.startsWith('#') ? `priv_${name.slice(1)}` : name;
  return `  async #${jsName}Fn(_s) {${destructure}${locals}
    let re;${reLine}
    return Structure.pack(re);
  }`;
}

// genInitMethod removed — init/$var syntax deprecated

function genClass(ctx, actor, exportKw, remotes = null) {
  // Reset lambda state for this class
  ctx.lambdaCounter = 0;
  ctx.lambdaHandlers = [];
  ctx.lambdaVarNames = new Set();
  ctx.lambdaCaptureFields = [];

  const hasReturnAs = !!(actor.declarationReturn && actor.declarationReturn.typeName);

  // ── Resolve supertype inheritance ──────────────────────────────────────
  const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSuperclassChain(ctx.actorNodes, actor);

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
  const isPublicOrBuiltin = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@'));
  const publicFns = mergedActor.functions.filter(f => isFnDecl(f) && isPublicOrBuiltin(f));
  const privateFns = mergedActor.functions.filter(f => isFnDecl(f) && !isPublicOrBuiltin(f));
  const onHandlers = mergedActor.functions.filter(f => f.type === 'OnHandler');

  ctx.actorFnNames = new Set(privateFns.map(f => f.name));
  // Identify silent functions (no reply, no implicit return, has SilentTerminator)
  const silentFnNames = new Set();
  for (const fn of [...publicFns, ...privateFns]) {
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (hasSilent && !hasReply && !hasImplicit) silentFnNames.add(fn.name);
  }
  const allFns = [...publicFns, ...privateFns];
  const usesStructure = allFns.some(h => h.params.length > 0) || onHandlers.some(h => h.params.length > 0);
  const usesTypeMatching = allFns.some(h => h.params.some(p => !p.rest));

  const stateVarDecls = mergedActor.stateVarDecls || [];
  const initBody = mergedActor.initBody || [];
  const constructorParams = mergedActor.initParams || [];
  // Collect service coercion aliases from the service block. Constructor
  // coercions (those carrying constructorParams) are not runtime state —
  // they only exist as compile-time aliases for an underlying dep — so
  // they're partitioned out and tracked separately.
  const allCoercions = (mergedActor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
  const serviceCoercions = allCoercions.filter(s => !s.constructorParams);
  const constructorCoercions = allCoercions.filter(s => s.constructorParams);
  // Constructor params are also state — accessible from handlers
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
    ...supertypeBindings.map(wb => wb.name),
  ];
  ctx.stateVarNames = new Set(allStateNames);
  ctx.remoteInstanceVars = new Set();
  // Constructor coercions: alias name → underlying dep name. The alias is
  // treated as a dep at codegen time so `t = Coerced(args)` enters the same
  // construction path as `t = Thing(args)`, but `new` is addressed to the
  // underlying dep.
  ctx.constructorCoercions = new Map();
  for (const c of constructorCoercions) {
    const underlying = c.ref?.name || c.ref;
    ctx.constructorCoercions.set(c.name, underlying);
    ctx.dependencyNames.add(c.name);
  }
  const VALUE_TYPES = new Set(['Text', 'Integer', 'Decimal', 'Float', 'Boolean', 'Anything']);
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name)) {
      ctx.remoteInstanceVars.add(s.name);
    }
    if (s.value?.type === 'DotCallExpr') {
      if (s.isRef) {
        ctx.remoteInstanceVars.add(s.name);
      } else if (remotes) {
        const objName = s.value.object?.name;
        const method = s.value.method;
        const iface = remotes[objName];
        if (iface) {
          const parsed = typeof iface === 'string' ? parseInterface(iface) : iface;
          // Op-form: parsed[method][0].returns. Type-form: methods live
          // inside parsed.__types[objName].functions.
          const retType = parsed?.[method]?.[0]?.returns?.[0]?.type
            || parsed?.__types?.[objName]?.functions?.find(f => f.name === method)?.returns?.[0]?.type;
          if (retType && !VALUE_TYPES.has(retType)) {
            ctx.remoteInstanceVars.add(s.name);
          }
        }
      }
    }
  }
  // Constructor params marked with ref: true (the * syntax) are wrapped child actor references
  ctx.wrappedChildParams = new Set();
  for (const p of constructorParams) {
    if (p.ref) {
      ctx.wrappedChildParams.add(p.name);
    } else if (p.type === 'Anything') {
      ctx.wrappedChildParams.add(p.name);
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

  // Ref-captured-by map: which non-silent public fns reference each ref in
  // their body. Set@<cell>'s notifyBlock uses this to fire re-evaluation
  // dispatches for subscribers of any fn that derives from the cell being set.
  const collectRefReads = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) collectRefReads(n, acc); return; }
    if (node.type === 'RefRead' && node.name) acc.add(node.name);
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      collectRefReads(node[k], acc);
    }
  };
  const refCapturedBy = new Map();
  for (const fn of [...publicFns, ...privateFns]) {
    if (!fn.name) continue;
    const isPublic = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
    const isPrivate = fn.name.startsWith('#');
    if (!isPublic && !isPrivate) continue;
    if (silentFnNames.has(fn.name)) continue;
    const acc = new Set();
    collectRefReads(fn.body, acc);
    for (const refName of acc) {
      if (!refCapturedBy.has(refName)) refCapturedBy.set(refName, new Set());
      // Store the full name (with @ or # sigil) so replay emits the right
      // dispatch op and storage key can be derived as name.slice(1).
      refCapturedBy.get(refName).add(fn.name);
    }
  }
  ctx._refCapturedBy = refCapturedBy;
  // All functions (public + private) go through dispatch as self-send targets
  const allDispatchFns = [...publicFns, ...privateFns];
  ctx._allDispatchFns = allDispatchFns;
  const publicFnParts = allDispatchFns.map(h => genPublicFn(ctx, h, stateVarEnv, remotes)).filter(Boolean);

  // Generate lambda handler arms (registered during codegen above)
  // Use index loop since nested lambdas may add new handlers during iteration
  const lambdaParts = [];
  for (let li = 0; li < ctx.lambdaHandlers.length; li++) {
    const lh = ctx.lambdaHandlers[li];
    const { name: lName, varName: lVarName, fn: fnNode, captures } = lh;
    const params = fnNode.params || [];
    // Skip empty Function() initializer — no dispatch arm needed
    if (fnNode.emptyOverload) continue;
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
        // Silent/void lambda — no reply
        block += `\n        await (${fnCode})(_s);`;
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
    // For overloaded lambdas (multiple handlers with same label), add arity condition
    const hasOverloads = ctx.lambdaHandlers.filter(h => h.name === lName).length > 1;
    let condition;
    if (hasOverloads && params.length > 0) {
      const posCount = params.filter(p => p.positional).length;
      const namedKeys = params.filter(p => !p.positional).map(p => p.key || p.name);
      const checks = [];
      if (posCount > 0) checks.push(`_s.positional.length === ${posCount}`);
      for (const k of namedKeys) checks.push(`${JSON.stringify(k)} in _s.named`);
      condition = `opName === "${lName}" && ${checks.join(' && ')}`;
    } else {
      condition = `opName === "${lName}"`;
    }
    lambdaParts.push({ condition, block });
    if (fnNode.returnType === '.') silentFnNames.add(lName);
  }

  // Generate on-handler dispatch arms
  const onParts = onHandlers.map(h => {
    const destructure = genDestructure(ctx, h.params);
    const { env: typeEnv } = buildTypeEnv(h.params, h.body, stateVarEnv);
    const savedTypeEnv = ctx.currentTypeEnv;
    ctx.currentTypeEnv = typeEnv;
    const savedSsaScope = ctx.ssaScope;
    const savedSsaCounts = ctx.ssaCounts;
    const locals = genLocals(ctx, h.body, typeEnv);
    const hasSilent = h.body.some(s => s.type === 'SilentTerminator');
    let reLine = '';
    if (!hasSilent) {
      const reply = h.body.find(s => s.type === 'Reply');
      if (reply) {
        reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: true })};`;
      }
    }
    ctx.ssaScope = savedSsaScope;
    ctx.ssaCounts = savedSsaCounts;
    ctx.currentTypeEnv = savedTypeEnv;
    const block = `${destructure}${locals}${reLine}\n        _handled = true;`;
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

  const asClauseParts = (mergedActor.asClauses || []).map(clause => {
    const val = genExpr(ctx, clause.expr);
    const typeCond = clause.negated
      ? `_rawPayload !== ${JSON.stringify(clause.targetType)}`
      : `_rawPayload === ${JSON.stringify(clause.targetType)}`;
    return {
      condition: `opName === "as" && typeof _rawPayload === "string" && ${typeCond}`,
      block: `\n        re = [${val}];\n        _bva_re = [_rawPayload];\n        _handled = true;`,
    };
  });
  if (hasReturnAs) {
    const returnAsType = actor.declarationReturn.typeName;
    asClauseParts.push({
      condition: `opName === "as" && typeof _rawPayload === "string" && _rawPayload === ${JSON.stringify(returnAsType)}`,
      block: `\n        re = [this.#__returnAs];\n        _bva_re = [_rawPayload];\n        _handled = true;`,
    });
  }

  const allParts = [...publicFnParts, ...lambdaParts, ...onParts, ...accessorParts, ...delegationParts, ...asClauseParts];
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

  // Deduplicate private functions for method generation — overloaded functions
  // go through dispatch, only the first clause needs a method stub
  const seenPrivateNames = new Set();
  const uniquePrivateFns = privateFns.filter(f => {
    if (seenPrivateNames.has(f.name)) return false;
    seenPrivateNames.add(f.name);
    return true;
  });
  const fnMethods = uniquePrivateFns.map(f => genFnMethod(ctx, f, stateVarEnv)).join('\n\n');
  const fnSection = fnMethods ? '\n\n' + fnMethods : '';

  // Private field declarations — values set in constructor
  const allFieldNames = new Set([
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
    ...supertypeBindings.map(wb => wb.name),
  ]);
  if (hasReturnAs) allFieldNames.add('__returnAs');
  const stateFields = [...allFieldNames].map(n => `  #${n}`).join('\n');
  const captureFields = ctx.lambdaCaptureFields.map(n => `  #${n}`).join('\n');
  const fieldSection = [stateFields, captureFields].filter(Boolean).join('\n');

  // Constructor: initialize state from params and service block
  const ctorParamNames = constructorParams.map(p => p.name);
  // Generate param names with JS default values for optional params
  const ctorParamExprs = constructorParams.map(p => {
    if (p.defaultValue) return `${p.name} = ${genDefaultValue(p.defaultValue)}`;
    return p.name;
  });
  const paramInitLines = ctorParamNames.map(n => `    this.#${n} = ${n};`);
  function genOneInitLine(s) {
    // Check if this is a remote construction: ref x = DependencyName(args)
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name)) {
      const calleeName = s.value.callee.name;
      // Constructor coercions resolve to the underlying dep name for `new` addressing
      const targetName = ctx.constructorCoercions.get(calleeName) || calleeName;
      ctx.remoteInstanceVars.add(s.name);
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
      return `    this.#sendNew(${argsExpr}, ${JSON.stringify(targetName)}).then(addr => { this.#${s.name} = addr; });`;
    }
    if (s.type === 'ExprStatement') {
      let expr = genExpr(ctx, s.expr);
      const isAsyncSend = s.expr.type === 'DotCallExpr' && expr.includes('this.#send(');
      return `    ${isAsyncSend ? 'await ' : ''}${expr};`;
    }
    if (s.type === 'ServiceCoercion') {
      // Constructor coercions have no runtime presence — they're compile-time
      // aliases handled by ctx.constructorCoercions during `new` emission.
      if (s.constructorParams) return '';
      const refName = s.ref?.name || s.ref;
      return `    this.#${s.name} = ${ctx.wrappedChildParams.has(refName) || ctx.stateVarNames.has(refName) ? `this.#${refName}` : genExpr(ctx, s.ref)};`;
    }
    if (s.value === null) return `    this.#${s.name} = undefined;`;
    let expr = genExpr(ctx, s.value);
    const isAsyncSend = s.value.type === 'DotCallExpr' && expr.includes('this.#send(');
    if ((s.isRef || ctx.remoteInstanceVars.has(s.name)) && isAsyncSend) {
      expr = expr.replace('this.#send(', 'this.#sendRef(');
    }
    return `    this.#${s.name} = ${isAsyncSend ? 'await ' : ''}${expr};`;
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

  if (hasReturnAs) {
    allInitLines.push(`    this.#__returnAs = ${genExpr(ctx, actor.declarationReturn.expr)};`);
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
  // #_cellSubs holds subscription lists keyed by target name. Populated by
  // the generic subscribe@X prologue in #dispatch; walked by set@X's
  // notifyBlock to replay new values to registered subscribers. Always
  // emitted since the dispatcher prologue references it unconditionally.
  const hasSubscribableCells = true;

  return `${exportKw}class${name} {
  #binding
  #pending = new Map()
  #_newPending = new Map()
  #_testFwd = new Map()${hasEmits ? '\n  #_subscribers = new Map()' : ''}${hasSubscribableCells ? '\n  #_cellSubs = new Map()' : ''}
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

  async #init(${[...ctorParamExprs, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {${finalInitBody}}

  static async create(${['binding', ...ctorParamExprs, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {
    const instance = new this(binding);
    if (binding.created) binding.created(instance);
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

  async #sendRef(op, to, bva) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#_newPending.set(id, resolve);
      const _msg = { id, op, to };
      if (bva !== undefined) _msg['bv-a'] = bva;
      this.#binding.post(_msg);
    });
  }

  async #sendNew(args, to) {
    const id = String(++this.#nextId);
    return new Promise(resolve => {
      this.#_newPending.set(id, resolve);
      const _msg = { id, op: [args, 'new'], to };
      this.#binding.post(_msg);
    });
  }${(!mergedActor.name && ctx.actorNames.size > 0) || ctx.wrappedChildParams.size > 0 ? `

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
      this.#dispatch({ op: [payload, 'set'], from: '__self' });
    } else if ('update' in t) {
      const _uv = t.update;
      const payload = Array.isArray(_uv) ? _uv : (typeof _uv === 'object' && _uv !== null) ? _uv : [_uv];
      this.#dispatch({ op: [payload, 'update'], from: '__self' });
    } else if ('op' in t) {
      await this.#dispatch({ id: message.id, op: t.op, from: '__test', _replyTo: message.from });
    }
  }

  async #selfSend(op) {
    const _opName = Array.isArray(op) ? op[op.length - 1] : op;
    const id = String(++this.#nextId);${silentFnNames.size > 0 ? `
    if (${JSON.stringify([...silentFnNames])}.includes(_opName)) {
      this.#dispatch({ id, op, from: '__self' });
      return;
    }` : ''}
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
      if (newResolve) { const addr = typeof message.re === 'string' && message.re.startsWith('#<') && message.re.endsWith('>') ? message.re.slice(2, -1) : message.from; this.#_newPending.delete(message.id); newResolve(addr); return; }
      const pending = this.#pending.get(message.id);
      if (pending) {
        if (pending.persistent) { pending.handler(message.re); return; }
        this.#pending.delete(message.id); pending.resolve(message.re); return;
      }
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
    let opName = typeof message.op === 'string' ? message.op : message.op[message.op.length - 1];
    // Wire to internal normalization: bare "subscribe"/"set" op carries its
    // selector in the to-field. Recognize both: bare @sel/#sel (router
    // already stripped the alias) and #<alias selector> (hash-angle
    // delimited, selector before closing >). Re-synthesize subscribe@field /
    // set@field so the handler-name machinery below matches.
    if ((opName === 'subscribe' || opName === 'set') && typeof message.to === 'string') {
      const _toSelMatch = /(@|#)([0-9]+|[A-Za-z_][A-Za-z0-9_]*)>?$/.exec(message.to.trim());
      if (_toSelMatch) opName = opName + _toSelMatch[1] + _toSelMatch[2];
    }
    if (typeof opName === 'string' && (opName.startsWith('subscribe@') || opName.startsWith('subscribe#'))) {
      const _sigil = opName[('subscribe').length];
      const _subTarget = opName.slice('subscribe'.length + 1);
      const _subArgs = Array.isArray(message.op) ? message.op[0] : null;
      let _subs = this.#_cellSubs?.get(_subTarget);
      if (!_subs && this.#_cellSubs) { _subs = []; this.#_cellSubs.set(_subTarget, _subs); }
      if (_subs) _subs.push({ id, from: _replyTo, args: _subArgs, route: message._route || null });
      opName = _sigil + _subTarget;
    }
    const _rawPayload = Array.isArray(message.op) ? message.op[0] : null;
    const _hasPayload = _rawPayload !== null && _rawPayload !== undefined &&
      (Array.isArray(_rawPayload) ? _rawPayload.length > 0 : Object.keys(_rawPayload).length > 0);
    if (_hasPayload && opName !== 'as' && !('bv-a' in message) && from !== '__parent' && from !== '__self' && from !== '__test' && from !== '__emit'${remoteRefChecks ? ` && ${remoteRefChecks}` : ''}) {
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
    }
  }
}`;
}

export function codegen(ast, options = {}) {
  const ctx = createContext();
  // Wire late binding for genFunctionBodyCode
  ctx.genFunctionBodyCode = genFunctionBodyCode;
  // Build remotes from inline interfaces and merge with options.remotes
  const inlineRemotes = {};
  for (const d of (ast.dependencies || [])) {
    if (d.interface) inlineRemotes[d.name] = stripAsTypeSuffix(d.interface);
  }
  // Resolve path-keyed remotes to alias names
  const resolvedRemotes = {};
  if (options.remotes) {
    if (Array.isArray(options.remotes)) {
      const pathToAlias = new Map();
      for (const d of (ast.dependencies || [])) {
        if (d.path) pathToAlias.set(d.path, d.name);
      }
      for (const { path, service } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) resolvedRemotes[alias] = stripAsTypeSuffix(service);
      }
    } else {
      Object.assign(resolvedRemotes, options.remotes);
    }
  }
  const _remotes = Object.keys(inlineRemotes).length > 0 || Object.keys(resolvedRemotes).length > 0
    ? { ...inlineRemotes, ...resolvedRemotes }
    : null;
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
    // Deep walk for ListMethodExpr — `List.size(nums)` and `*nums.first` need
    // the preamble even when the surrounding statement is plain Reply or Assign.
    const hasListMethod = (n) => {
      if (!n || typeof n !== 'object') return false;
      if (Array.isArray(n)) return n.some(hasListMethod);
      if (n.type === 'ListMethodExpr' || n.type === 'ListLiteral') return true;
      for (const k of Object.keys(n)) { if (k === 'type') continue; if (hasListMethod(n[k])) return true; }
      return false;
    };
    return body.some(s =>
      s.type === 'ListDestructure' ||
      (s.type === 'Assign' && (s.value?.type === 'ListLiteral' || iterExpr(s.value?.type))) ||
      (s.type === 'TypedAssign' && (
        (typeof s.typeName === 'string' && s.typeName.startsWith('List')) ||
        iterExpr(s.value?.type)
      )) ||
      (s.type === 'BareTypeDecl' && typeof s.typeName === 'string' && s.typeName.startsWith('List')) ||
      hasListMethod(s),
    );
  }
  const needsPreamble = active.some(a =>
    a.functions.some(f => f.name && ((f.name.startsWith('@') || f.name === 'set' || f.name === 'update') ? (f.params.length > 0 || bodyUsesStructure(f.body)) : true)) ||
    (a.initBody && bodyUsesStructure(a.initBody)) ||
    (a.initParams && a.initParams.length > 0),
  );
  const needsListPreamble = active.some(a =>
    a.functions.some(f =>
      f.params.some(p => typeof p.type === 'string' && p.type.startsWith('List')) ||
      bodyUsesList(f.body),
    ) ||
    (a.initBody && bodyUsesList(a.initBody)) ||
    (a.stateVarDecls || []).some(v => typeof v.typeName === 'string' && v.typeName.startsWith('List')),
  );
  // ── Constructor overloads: promote actorDef FunctionDecls to synthetic actors ──
  // Collect overload clauses from the anonymous actor's functions
  ctx.constructorOverloads = new Map(); // baseName → [{ mangledName, params }]
  const syntheticActors = [];
  const existingActorNames = new Set(active.filter(a => a.name).map(a => a.name));
  for (const a of active) {
    if (a.name) continue; // only check anonymous actor (file-level)
    // Group actorDef FunctionDecls by name
    const actorDefsByName = new Map();
    for (const fn of a.functions) {
      if (!fn.actorDef) continue;
      if (!actorDefsByName.has(fn.name)) actorDefsByName.set(fn.name, []);
      actorDefsByName.get(fn.name).push(fn);
    }
    for (const [baseName, fns] of actorDefsByName) {
      const hasPrimaryActor = existingActorNames.has(baseName);
      if (!ctx.constructorOverloads.has(baseName)) ctx.constructorOverloads.set(baseName, []);
      const overloads = ctx.constructorOverloads.get(baseName);
      for (let i = 0; i < fns.length; i++) {
        const fn = fns[i];
        if (!hasPrimaryActor && i === 0) {
          // No primary Actor exists (Function() initializer case) — first clause becomes the primary
          const synActor = AST.actor(baseName, { ...fn.actorDef });
          syntheticActors.push(synActor);
        } else {
          const mangledName = `${baseName}_ov${overloads.length}`;
          overloads.push({ mangledName, params: fn.actorDef.params || fn.params || [] });
          const synActor = AST.actor(mangledName, { ...fn.actorDef });
          syntheticActors.push(synActor);
        }
      }
    }
  }
  active.push(...syntheticActors);

  ctx.actorNodes = new Map(active.filter(a => a.name).map(a => [a.name, a]));
  // Build actorNames with merged initParams for subtypes (so constructor calls know full param list)
  ctx.actorNames = new Map(active.filter(a => a.name).map(a => {
    const { inheritedParams } = resolveSuperclassChain(ctx.actorNodes, a);
    const ownParamNames = new Set((a.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(a.initParams || []),
    ];
    const asClauses = [...(a.asClauses || [])];
    if (a.declarationReturn && a.declarationReturn.typeName) {
      asClauses.push({ targetType: a.declarationReturn.typeName, negated: false, expr: a.declarationReturn.expr, memoized: true });
    }
    return [a.name, { asClauses, initParams: mergedParams }];
  }));
  ctx.dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  // destructuredMembers: localName → { service: depName, remote: remoteName }
  ctx.destructuredMembers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (d.destructures) {
      for (const entry of d.destructures) {
        ctx.destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
        ctx.dependencyNames.add(entry.local);
      }
    }
  }
  // Parse all remote interfaces for compile-time validation (TODO)
  const classes = active.map(a => genClass(ctx, a, a.name ? '' : 'export default ', _remotes) + '\n').join('\n');

  return (needsPreamble ? STRUCTURE_PREAMBLE + '\n\n' : '') +
         DECIMAL_PREAMBLE + '\n\n' +
         EQUALITY_PREAMBLE + '\n\n' +
         (needsListPreamble ? LIST_PREAMBLE + '\n\n' : '') +
         TEXT_PREAMBLE + '\n\n' +
         MATH_PREAMBLE + '\n\n' +
         STRING_PREAMBLE + '\n\n' +
         classes;
}

export default codegen;
