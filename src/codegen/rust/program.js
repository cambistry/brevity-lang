// program.js — Program assembly and entry for Rust codegen
import * as AST from '../../ast.js';
import {
  G, createRustContext, setCtx, TYPE_MEMBER_OF_FN, MATCH_TYPES_FN, MATCH_TYPES_POSITIONAL_FN,
  RUST_STRUCTURE_PREAMBLE, RUST_WIRE_HELPERS, LIST_TYPES_OF_FN,
  inferLiteralType,
  toJsonValue, forceJsonWrap, fnReturnsFunction,
  needsDotCallAwait,
  rustIdent, convertFromValue, stateKey, classNeedsSpawnedInstances,
} from './types.js';
import {
  genRustExpr, genRustFnMethod,
} from './expressions.js';
import {
  genRustDispatch,
  genRustChildMethods,
} from './handlers.js';
import { resolveSuperclassChain } from '../../subclass.js';
import { genRustLocals } from './statements.js';

function genRustProgram(actor, allActors) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@'));
  const publicFns = actor.functions.filter(_isPublic);
  const privateFns = actor.functions.filter(f => !_isPublic(f) && !f.actorDef && !f.emptyOverload);
  const hasFns = privateFns.length > 0;
  const childActors = (allActors || []).filter(a => a.name && G.ctx.actorInfo.has(a.name));
  const anyChildStateful = childActors.some(a => (a.stateVarDecls || []).length > 0);
  const isStateful = (actor.stateVarDecls && actor.stateVarDecls.length > 0) || anyChildStateful;
  const fnsWithRefs = [...publicFns, ...privateFns];
  function bodyMutatesRefs(body) {
    if (!Array.isArray(body)) return false;
    for (const s of body) {
      if (!s) continue;
      if (s.type === 'RefDecl' || s.type === 'SetStatement' || s.type === 'RefRead') return true;
      if (s.type === 'WhileStatement' && Array.isArray(s.body) && bodyMutatesRefs(s.body)) return true;
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'Function' && bodyMutatesRefs(s.value.body)) return true;
    }
    return false;
  }
  const needsRefs = fnsWithRefs.some(h => bodyMutatesRefs(h.body));
  const allDispatchFns = [...publicFns, ...privateFns];
  const needsMatchTypes = allDispatchFns.some(h => {
    const typed = h.params.filter(p => p.type && !p.rest);
    return typed.length > 0 && !typed.some(p => p.positional);
  });
  const needsMatchTypesPos = allDispatchFns.some(h => h.params.some(p => p.type && !p.rest && p.positional));
  const needsListTypesOf = publicFns.some(h => {
    const isListOfAny = t => t === 'List of Anything' || t === 'List';
    return h.body.some(s =>
      (s.type === 'TypedAssign' && isListOfAny(s.typeName)) ||
      (s.type === 'DestructureAssign' && (s.pattern || []).some(p => isListOfAny(p.type))),
    );
  });
  const typeMemberOfFn = (needsMatchTypes || needsMatchTypesPos) ? '\n' + TYPE_MEMBER_OF_FN + '\n' : '';
  const matchTypesFn = needsMatchTypes ? '\n' + MATCH_TYPES_FN + '\n' : '';
  const matchTypesPosFn = needsMatchTypesPos ? '\n' + MATCH_TYPES_POSITIONAL_FN + '\n' : '';
  const listTypesOfFn = needsListTypesOf ? '\n' + LIST_TYPES_OF_FN + '\n' : '';
  // Always include Structure — handle_op uses Structure::pack
  const structurePreamble = '\n' + RUST_STRUCTURE_PREAMBLE + '\n';
  // Slice 12+13: per-program shape registry. `bv_type_fields(name)` returns
  // a static slice of declared field names for known types so the inbound
  // dispatch can reconstruct tagged values from wire payloads.
  const bvTypeFieldsArms = (G.ctx.typeDecls ? [...G.ctx.typeDecls.values()] : []).map(t => {
    const fieldList = (t.fields || []).map(f => `"${f.name}"`).join(', ');
    return `        "${t.name}" => Some(&[${fieldList}]),`;
  }).join('\n');
  const bvTypeFieldsFn = `\nfn bv_type_fields(name: &str) -> Option<&'static [&'static str]> {
    match name {
${bvTypeFieldsArms}
        _ => None,
    }
}\n`;
  const wireHelpers = '\n' + RUST_WIRE_HELPERS + bvTypeFieldsFn;
  const mainActorStateful = actor.stateVarDecls && actor.stateVarDecls.length > 0;
  const constructorParams = actor.initParams || [];
  // Collect service coercion aliases from the constructor block. Class-style
  // coercions (those carrying constructorParams) are not runtime state —
  // they only exist as compile-time aliases for an underlying dep.
  const allCoercions = (actor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
  const serviceCoercions = allCoercions.filter(s => !s.constructorParams);
  const constructorCoercions = allCoercions.filter(s => s.constructorParams);
  G.ctx.currentActorName = actor.name || '';
  G.ctx.currentActor = actor;
  // Ref-captured-by: for every non-silent @/# fn that reads a state ref,
  // record refName -> Set<fnFullName>. Consumed by SetStatement codegen
  // to emit fn replay blocks per subscriber.
  const collectRefReads = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) collectRefReads(n, acc); return; }
    if (node.type === 'RefRead' && node.name) acc.add(node.name);
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      collectRefReads(node[k], acc);
    }
  };
  const _silentFns = new Set();
  for (const fn of (actor.functions || [])) {
    if (!fn.name) continue;
    const hasReply = fn.body?.some(s => s.type === 'Reply');
    const hasImplicit = fn.body?.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body?.some(s => s.type === 'SilentTerminator');
    if (hasSilent && !hasReply && !hasImplicit) _silentFns.add(fn.name);
  }
  const refCapturedBy = new Map();
  for (const fn of (actor.functions || [])) {
    if (!fn.name) continue;
    const isPub = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
    const isPriv = fn.name.startsWith('#');
    if (!isPub && !isPriv) continue;
    if (_silentFns.has(fn.name)) continue;
    const acc = new Set();
    collectRefReads(fn.body, acc);
    for (const refName of acc) {
      if (!refCapturedBy.has(refName)) refCapturedBy.set(refName, new Set());
      refCapturedBy.get(refName).add(fn.name);
    }
  }
  G.ctx._refCapturedBy = refCapturedBy;
  G.ctx.stateVarNames = new Set([
    ...(actor.stateVarDecls || []).map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
  ]);
  G.ctx.stateVarDecls = [
    ...(actor.stateVarDecls || []),
    ...constructorParams.map(p => ({ name: p.name, typeName: p.type || 'Anything' })),
    ...serviceCoercions.map(s => ({ name: s.name, typeName: 'Anything' })),
  ];
  G.ctx.remoteInstanceVars = new Set();
  // Constructor coercions: alias name → underlying dep name. Treat the alias
  // as a dep so `t = Coerced(args)` enters the construction path; substitute
  // the underlying dep for `new` addressing.
  G.ctx.constructorCoercions = new Map();
  for (const c of constructorCoercions) {
    const underlying = c.ref?.name || c.ref;
    G.ctx.constructorCoercions.set(c.name, underlying);
    G.ctx.dependencyNames.add(c.name);
  }
  // Module-level state var -> child actor class, so ActorFieldSet /
  // SubscribeCall can invoke child_<c>_dispatch inline.
  G.ctx.childVarToActor = new Map();
  for (const s of (actor.initBody || [])) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.dependencyNames.has(s.value.callee.name)) {
      G.ctx.remoteInstanceVars.add(s.name);
    } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo?.has(s.value.callee.name)) {
      G.ctx.childVarToActor.set(s.name, s.value.callee.name);
    }
  }

  // Pre-register lambdas from state init body (before dispatch, so handlers are included)
  const _preInitLambdas = [];
  for (const s of (actor.initBody || [])) {
    if (s.type === 'StateAssign' && s.value?.type === 'Function') {
      const lambdaName = `_lambda_pre_init_${s.name}`;
      _preInitLambdas.push({ stateVar: s.name, lambdaName, fn: s.value });
    }
  }

  // Reset the per-actor needsAwaitNew flag before dispatch generation;
  // genRustDepConstructorAssign will set it if any handler body emits a
  // function-body dep construction.
  G.ctx.needsAwaitNew = false;
  // Subscribe slot registry — populated as SubscribeCall expressions are
  // lowered in handler bodies. Emitted as a dispatch_sub match later.
  G.ctx.subscribeSlots = [];
  // Pre-pass: for every spawn-needing child class, transform SubscribeCall
  // on a constructor-param ref into a synthesized public handler
  // `@__sub_<param>` and record the subscription metadata. We must do this
  // before genRustDispatch so the file class's @run handler sees the
  // child's _paramSubscriptions when emitting construction sites.
  for (const a of (allActors || [])) {
    if (!a.name || !G.ctx.actorInfo.has(a.name)) continue;
    const childActor = G.ctx.actorInfo.get(a.name)?.actor || a;
    if (!classNeedsSpawnedInstances(childActor)) continue;
    const paramSubInfo = [];
    const seenCallbacks = new Set();
    const transform = (body) => {
      if (!Array.isArray(body)) return body;
      const out = [];
      for (const s of body) {
        if (s?.type === 'ExprStatement' && s.expr?.type === 'SubscribeCall' &&
            s.expr.target?.type === 'Identifier' &&
            (childActor.initParams || []).some(p => p.name === s.expr.target.name)) {
          const paramName = s.expr.target.name;
          const callbackName = '@__sub_' + paramName;
          const sub = s.expr;
          if (!seenCallbacks.has(callbackName)) {
            seenCallbacks.add(callbackName);
            childActor.functions = childActor.functions || [];
            childActor.functions.push({
              type: 'FunctionDecl',
              name: callbackName,
              params: sub.params || [],
              body: sub.body || [],
            });
            const paramType = (childActor.initParams || []).find(p => p.name === paramName)?.type;
            paramSubInfo.push({ paramName, callbackName, paramType });
          }
          continue;
        }
        out.push(s);
      }
      return out;
    };
    childActor.constructorBody = transform(childActor.constructorBody || []);
    childActor.initBody = transform(childActor.initBody || []);
    childActor._paramSubscriptions = paramSubInfo;
    G.ctx.actorInfo.set(a.name, { ...G.ctx.actorInfo.get(a.name), actor: childActor });
  }
  const matchArms = genRustDispatch(publicFns, privateFns, _preInitLambdas, constructorParams, actor.asClauses || [], actor.declarationReturn);
  // Skip fn method generation for fns with function-type params or function returns (inlined at call sites)
  // Also skip overloaded private functions (they're dispatched via arity-guarded match arms)
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));
  const overloadedPrivNames = new Set();
  {
    const privNameCounts = new Map();
    for (const f of privateFns) {
      if (f.emptyOverload) continue;
      privNameCounts.set(f.name, (privNameCounts.get(f.name) || 0) + 1);
    }
    for (const [name, count] of privNameCounts) {
      if (count > 1) overloadedPrivNames.add(name);
    }
  }
  const compilableFns = hasFns ? privateFns.filter(f =>
    !f.params.some(fp => isFunctionType(fp.type)) && !fnReturnsFunction(f) && !overloadedPrivNames.has(f.name) && !f.emptyOverload) : [];
  const fnMethods = compilableFns.length > 0 ? '\n' + compilableFns.map(f => genRustFnMethod(f)).join('\n\n') : '';
  const childMethodsCode = genRustChildMethods(allActors || []);
  // Either remote-instance method-call awaits (existing) or function-body
  // dep construction awaits (new) need the stdin reader + main loop.
  const needsAwait = needsDotCallAwait(actor) || G.ctx.needsAwaitNew;
  const hasDotCallAwait = needsAwait;

  // Actor struct fields
  const structFields = ['    binding: mpsc::Sender<Value>'];
  // newFields tracked via newArgs below
  const newArgs = [];
  // Always include state — lambda captures may use it at runtime
  structFields.push('    state: std::collections::HashMap<String, Value>');
  newArgs.push('state: std::collections::HashMap::new()');
  if (needsRefs || isStateful) {
    structFields.push('    refs: std::collections::HashMap<String, Value>');
    newArgs.push('refs: std::collections::HashMap::new()');
  }
  // Always emit cell_subs: the generic subscribe prologue in handle_op
  // references it unconditionally.
  const hasSubscribableCells = true;
  if (hasSubscribableCells) {
    structFields.push('    cell_subs: std::collections::HashMap<String, Vec<(String, String, Value, Value)>>');
    newArgs.push('cell_subs: std::collections::HashMap::new()');
    // In-process cell subscriptions: when a spawn-needing class is
    // constructed with a host state-cell as a Self-bearing param, the
    // host registers `(class_name, instance_id, callback_op)` here so
    // future SetStatements on that cell can dispatch notifications via
    // child_<class>_dispatch_at without going through the wire protocol.
    structFields.push('    inproc_cell_subs: std::collections::HashMap<String, Vec<(String, u32, String)>>');
    newArgs.push('inproc_cell_subs: std::collections::HashMap::new()');
  }
  structFields.push('    send_seq: std::cell::Cell<i64>');
  newArgs.push('send_seq: std::cell::Cell::new(1)');

  // Per-class instance pools for spawn-needing classes. Each pool keys an
  // independent state HashMap by a u32 instance id, so multiple instances of
  // the same class don't collide. Self()-recursion within the file class
  // uses the `self_instances` pool — same pattern, but the file class's own
  // primary state stays in `self.state` (instance #0 conceptually).
  const spawnNeedingChildren = (allActors || []).filter(a =>
    a.name && G.ctx.actorInfo?.has(a.name) && classNeedsSpawnedInstances(G.ctx.actorInfo.get(a.name)?.actor || a),
  );
  for (const a of spawnNeedingChildren) {
    const lc = a.name.toLowerCase();
    structFields.push(`    ${lc}_instances: std::collections::HashMap<u32, std::collections::HashMap<String, Value>>`);
    newArgs.push(`${lc}_instances: std::collections::HashMap::new()`);
    structFields.push(`    ${lc}_next_id: std::cell::Cell<u32>`);
    newArgs.push(`${lc}_next_id: std::cell::Cell::new(1)`);
    // Currently-dispatching instance id, set by child_<class>_dispatch_at
    // and restored on exit. The over-on-Pid inline uses this to detect
    // self-routing (when the iteration item equals our own id) and call
    // the local handler against the already-swapped self.state instead
    // of re-swapping (which would be a missing-entry case).
    structFields.push(`    current_${lc}_instance: Option<u32>`);
    newArgs.push(`current_${lc}_instance: None`);
  }
  const fileClassNeedsSelfPool = classNeedsSpawnedInstances(actor);
  G.ctx.actorNeedsSelfPool = fileClassNeedsSelfPool;
  if (fileClassNeedsSelfPool) {
    structFields.push('    self_instances: std::collections::HashMap<u32, std::collections::HashMap<String, Value>>');
    newArgs.push('self_instances: std::collections::HashMap::new()');
    structFields.push('    self_next_id: std::cell::Cell<u32>');
    newArgs.push('self_next_id: std::cell::Cell::new(1)');
  }
  if (hasDotCallAwait) {
    structFields.push('    reader: io::BufReader<io::Stdin>');
    newArgs.push('reader: io::BufReader::new(io::stdin())');
  }

  // State initialization lines (run in main before message loop)
  const stateInitLines = [];
  if (mainActorStateful) {
    const initTypeEnv = new Map();
    for (const d of (actor.stateVarDecls || [])) {
      initTypeEnv.set(d.name, d.typeName);
    }
    const initBody = actor.initBody || [];
    for (const s of initBody) {
      if (s.type === 'StateAssign' && G.ctx.remoteInstanceVars.has(s.name)) {
        // Remote construction: send `new`, await reply, extract from
        const calleeName = s.value.callee.name;
        // Constructor coercions resolve to the underlying dep name for `new`
        const callee = G.ctx.constructorCoercions.get(calleeName) || calleeName;
        const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
        let argsJson;
        if (positionalArgs.length === 0 && !namedBag) {
          argsJson = 'json!({})';
        } else if (namedBag) {
          const fields = Object.entries(namedBag.fields).map(([k, v]) => `"${k}": ${forceJsonWrap(toJsonValue(genRustExpr(v, initTypeEnv), inferLiteralType(v)))}`).join(', ');
          argsJson = `json!({${fields}})`;
        } else {
          const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, initTypeEnv), inferLiteralType(a)))).join(', ');
          argsJson = `json!([${vals}])`;
        }
        stateInitLines.push(`    {`);
        stateInitLines.push(`        let seq = actor.send_seq.get();`);
        stateInitLines.push(`        actor.send_seq.set(seq + 1);`);
        stateInitLines.push(`        let new_id = seq.to_string();`);
        stateInitLines.push(`        actor.state.insert("_pending_new_${s.name}".to_string(), json!(new_id.clone()));`);
        stateInitLines.push(`        let new_op = json!([${argsJson}, "#new"]);`);
        stateInitLines.push(`        let new_msg = json!({"id": new_id, "op": new_op, "to": "${callee}"});`);
        stateInitLines.push(`        let _ = actor.binding.send(new_msg);`);
        stateInitLines.push(`    }`);
        continue;
      }
      if (s.type === 'StateAssign') {
        // Check if this was pre-registered as a lambda
        const preInit = _preInitLambdas.find(p => p.stateVar === s.name);
        if (preInit) {
          stateInitLines.push(`    actor.state.insert("${stateKey(s.name)}".to_string(), json!("${preInit.lambdaName}"));`);
        } else if (s.value?.type === 'StructureConstructor' || s.value?.type === 'StructureLiteral') {
          // Store Structure as wire-format JSON (Structure type is not serializable)
          const positional = s.value.args.filter(a => a.positional);
          const named = s.value.args.filter(a => a.key !== undefined);
          if (positional.length === 1 && named.length === 0) {
            const val = genRustExpr(positional[0].expr, initTypeEnv);
            const pt = positional[0].type || inferLiteralType(positional[0].expr);
            stateInitLines.push(`    actor.state.insert("${stateKey(s.name)}".to_string(), json!([${toJsonValue(val, pt)}]));`);
          } else {
            const val = genRustExpr(s.value, initTypeEnv);
            stateInitLines.push(`    actor.state.insert("${stateKey(s.name)}".to_string(), { let _s = ${val}; _s.to_json() });`);
          }
        } else if (s.value?.type === 'FunctionCallExpr' && G.ctx.actorInfo.has(s.value.callee?.name)) {
          // Local child actor construction — call child init function
          const childName = s.value.callee.name.toLowerCase();
          const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const argsJson = positionalArgs.length > 0
            ? `json!([${positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, initTypeEnv), inferLiteralType(a)))).join(', ')}])`
            : 'json!([])';
          stateInitLines.push(`    actor.child_${childName}_init(&${argsJson});`);
        } else {
          const val = genRustExpr(s.value, initTypeEnv);
          const t = initTypeEnv.get(s.name);
          stateInitLines.push(`    actor.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        }
      }
    }
  }
  // Memoized return-as value for main actor
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const raTypeEnv = new Map([...(actor.stateVarDecls || []).map(d => [d.name, d.typeName])]);
    for (const p of (actor.initParams || [])) raTypeEnv.set(p.name, p.type);
    let val = genRustExpr(actor.declarationReturn.expr, raTypeEnv);
    val = val.replace(/\bself\./g, 'actor.');
    const t = actor.declarationReturn.typeName;
    stateInitLines.push(`    actor.state.insert("${stateKey('__returnAs')}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
  }
  const initMethod = '';

  // Capture — serialize actor state
  const captureFields = [...G.ctx.stateVarNames].map(n =>
    `m.insert(${JSON.stringify(n)}.to_string(), self.state.get("${stateKey(n)}").cloned().unwrap_or(Value::Null));`,
  ).join(' ');
  const captureMethod = `    fn capture(&self) -> Value {
        let mut m = Map::new();
        ${captureFields}
        Value::Object(m)
    }

    fn hydrate(&mut self, state: &Value) {
${[...G.ctx.stateVarNames].map(n =>
  `        if let Some(v) = state.get(${JSON.stringify(n)}) { self.state.insert("${stateKey(n)}".to_string(), v.clone()); }`,
).join('\n')}
    }

    fn handle_test(&mut self, test: &Value, id: &str, from: &str) {${(() => {
  // Build target routing for child actor refs
  const childRefRoutes = [];
  const allActorsList = allActors || [];
  function buildChildRoutes(initBody, actors, pathPrefix, depth) {
    if (depth > 3) return;
    for (const s of initBody) {
      if (s.type !== 'StateAssign') continue;
      const calleeName = s.value?.callee?.name;
      if (!calleeName) continue;
      const childActor = actors.find(a => a.name === calleeName);
      if (!childActor) continue;
      const prefix = calleeName.toLowerCase();
      const path = pathPrefix ? `${pathPrefix}.${s.name}` : s.name;
      const childStateVars = (childActor.stateVarDecls || []).filter(v => v.isRef);
      childRefRoutes.push({ path, prefix, stateVars: childStateVars });
      if (childActor.initBody) buildChildRoutes(childActor.initBody, actors, path, depth + 1);
    }
  }
  buildChildRoutes(actor.initBody || [], allActorsList, '', 0);
  if (childRefRoutes.length === 0) return '';
  const targetClauses = childRefRoutes.map(r => {
    const getClauses = r.stateVars.map(v => {
      const childCtx = { ...G.ctx, childStatePrefix: r.prefix };
      const savedCtx = G.ctx; G.ctx = childCtx;
      const sk = stateKey(v.name);
      G.ctx = savedCtx;
      return `                        "${v.name}" => (self.state.get("${sk}").cloned().unwrap_or(Value::Null), Some("${v.typeName || 'Anything'}")),`;
    }).join('\n');
    return `                    "${r.path}" => {
                        if let Some(tname) = test.get("get").and_then(|v| v.as_str()) {
                            let (tval, ttype) = match tname {
${getClauses}
                                _ => (Value::Null, None),
                            };
                            let mut resp = Map::new();
                            resp.insert("id".to_string(), json!(id));
                            resp.insert("re".to_string(), tval);
                            resp.insert("to".to_string(), json!(from));
                            if let Some(t) = ttype { resp.insert("bv-a".to_string(), json!(t)); }
                            let _ = self.binding.send(Value::Object(resp));
                        } else if let Some(sv) = test.get("set") {
                            let p = if sv.is_array() { sv.clone() } else if sv.is_object() { sv.clone() } else { json!([sv]) };
                            self.child_${r.prefix}_dispatch("set", &p, "", "__parent");
                        }
                        return;
                    }`;
  }).join('\n');
  return `
        if let Some(target) = test.get("target").and_then(|v| v.as_str()) {
            match target {
${targetClauses}
                _ => { return; }
            }
        }`;
})()}
        if let Some(name) = test.get("get").and_then(|v| v.as_str()) {
            let _key: Option<&str> = match name {
${[...G.ctx.stateVarNames].map(n => `                ${JSON.stringify(n)} => Some("${stateKey(n)}"),`).join('\n')}
                _ => None,
            };
            let val = _key.and_then(|k| self.state.get(k)).cloned().unwrap_or(Value::Null);
            let bv_type: Option<&str> = match name {
${[...G.ctx.stateVarNames].map(n => {
  const decl = G.ctx.stateVarDecls.find(d => d.name === n);
  const t = decl?.typeName || 'Anything';
  return `                ${JSON.stringify(n)} => Some("${t}"),`;
}).join('\n')}
                _ => None,
            };
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("re".to_string(), val);
            resp.insert("to".to_string(), json!(from));
            if let Some(t) = bv_type { resp.insert("bv-a".to_string(), json!(t)); }
            let _ = self.binding.send(Value::Object(resp));
        } else if let Some(set_val) = test.get("set") {
            let payload = if set_val.is_array() { set_val.clone() } else if set_val.is_object() { set_val.clone() } else { json!([set_val]) };
            self.handle_op("set", &json!({}), &payload, "__test", id);
        } else if let Some(upd_val) = test.get("update") {
            let payload = if upd_val.is_array() { upd_val.clone() } else if upd_val.is_object() { upd_val.clone() } else { json!([upd_val]) };
            self.handle_op("update", &json!({}), &payload, "__test", id);
        } else if let Some(op) = test.get("op") {
            let (op_name, payload): (String, Value) = if let Some(s) = op.as_str() {
                (s.to_string(), json!({}))
            } else if let Some(arr) = op.as_array() {
                let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
                let p = if arr.len() > 1 { arr[0].clone() } else { json!({}) };
                (name, p)
            } else { return; };
            let (re, bva_re, handled) = self.handle_op(&op_name, &json!({}), &payload, "__test", id);
            if !handled {
                let mut ex = Map::new(); ex.insert(op_name, json!("unhandled"));
                let mut resp = Map::new(); resp.insert("id".to_string(), json!(id)); resp.insert("ex".to_string(), Value::Object(ex)); resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
            } else if let Some(re_val) = re {
                let mut resp = Map::new(); resp.insert("id".to_string(), json!(id)); resp.insert("re".to_string(), re_val); resp.insert("to".to_string(), json!(from));
                if let Some(b) = bva_re { resp.insert("bv-a".to_string(), b); }
                let _ = self.binding.send(Value::Object(resp));
            }
        }
    }`;

  // Receive method — handle cam messages before dispatch
  const allNewVars = new Set(G.ctx.remoteInstanceVars);
  const remoteNewChecks = [...allNewVars].map(name => {
    return `if let Some(pending_id) = self.state.get("_pending_new_${name}") {
                if message.get("id") == Some(pending_id) {
                    let addr = match message.get("re").and_then(|v| v.as_str()) {
                        Some(s) if s.starts_with("#<") && s.ends_with('>') => Value::String(s[2..s.len()-1].to_string()),
                        _ => message.get("from").cloned().unwrap_or(Value::Null)
                    };
                    self.state.insert("${stateKey(name)}".to_string(), addr);
                    self.state.remove("_pending_new_${name}");
                    return;
                }
            }`;
  }).join('\n            ');
  const exNewChecks = allNewVars.size > 0
    ? [...allNewVars].map(name =>
      `if let Some(pending_id) = self.state.get("_pending_new_${name}") {
                if message.get("id") == Some(pending_id) {
                    self.state.remove("_pending_new_${name}");
                    return;
                }
            }`,
    ).join('\n            ')
    : '';
  // Subscribe dispatch: each SubscribeCall reserves a slot; dispatch_sub
  // matches on slot and runs the (inlined) body with the re value.
  const subSlots = G.ctx.subscribeSlots || [];
  // Always emit dispatch_sub — child actors' set@ cell_subs notifications
  // call it for in-process parents, whether or not this actor has its own
  // subscribe call sites.
  const subscribeDispatchMethod = `
    fn dispatch_sub(&mut self, slot: i64, re: &Value) {
        let _ = slot; let _ = re;
        match slot {
${subSlots.map(s => {
  const paramName = s.params?.[0]?.name ? rustIdent(s.params[0].name) : '_sub_arg';
  const paramType = s.params?.[0]?.type || 'Anything';
  const bindV = convertFromValue(`re.as_array().and_then(|a| a.get(0)).cloned().unwrap_or(Value::Null)`, paramType);
  // Build typeEnv for body
  const subTypeEnv = new Map();
  if (s.params?.[0]?.name) subTypeEnv.set(s.params[0].name, paramType);
  for (const d of (G.ctx.stateVarDecls || [])) subTypeEnv.set(d.name, d.typeName);
  // Compile body using genRustLocals
  const savedScope = G.ctx.ssaScope;
  const savedCounts = G.ctx.ssaCounts;
  const bodyLines = genRustLocals(
    s.body,
    subTypeEnv,
    { fnDefs: new Map(), skipSet: new Set(), capturePoints: new Map() },
    new Set(),
    '                ',
    new Map(),
  );
  G.ctx.ssaScope = savedScope;
  G.ctx.ssaCounts = savedCounts;
  return `            ${s.slot} => {
                let ${paramName} = ${bindV};
${bodyLines}
            }`;
}).join('\n')}
            _ => {}
        }
    }`;
  const subscribeReceiveCheck = subSlots.length > 0 ? `
            let msg_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Some(slot_val) = self.state.get(&format!("_sub_slot_{}", msg_id)).cloned() {
                let slot = slot_val.as_i64().unwrap_or(-1);
                let re_val = message.get("re").cloned().unwrap_or(Value::Null);
                self.dispatch_sub(slot, &re_val);
                return;
            }` : '';
  const receiveBody = `        if message.get("re").is_some() {${subscribeReceiveCheck}
            ${remoteNewChecks ? remoteNewChecks + '\n            ' : ''}return;
        }
        if message.get("ex").is_some() {
            ${exNewChecks ? exNewChecks + '\n            ' : ''}return;
        }
        if let Some(cam) = message.get("cam") {
            let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
            if cam.as_str() == Some("capture") {
                let mut resp = Map::new();
                resp.insert("id".to_string(), json!(id));
                resp.insert("re".to_string(), self.capture());
                resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
                return;
            }
            if let Some(arr) = cam.as_array() {
                if arr.last().and_then(|v| v.as_str()) == Some("hydrate") {
                    if let Some(state) = arr.first() {
                        self.hydrate(state);
                    }
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("re".to_string(), json!("hydrate"));
                    resp.insert("to".to_string(), json!(from));
                    let _ = self.binding.send(Value::Object(resp));
                    return;
                }
            }
        }
        if let Some(test) = message.get("test") {
            let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
            self.handle_test(test, id, from);
            return;
        }
        self.dispatch(message);`;

  // Handle op — shared match logic for dispatch and self_send
  const handleOpMethod = `    fn handle_op(&mut self, op_name: &str, message: &Value, payload: &Value, from: &str, id: &str) -> (Option<Value>, Option<Value>, bool) {
        // Generic subscribe prologue: intercept subscribe@<T> / subscribe#<T>,
        // stash the sub in cell_subs, and recurse with the rewritten op_name
        // so the normal getter arm produces the initial re. Subscribe is an
        // implicit affordance on every public getter; no per-name handler is
        // declared.
        if op_name.starts_with("subscribe@") || op_name.starts_with("subscribe#") {
            let sigil = op_name.chars().nth("subscribe".len()).unwrap_or('@');
            let target = &op_name["subscribe".len() + 1..];
            let sub_args = match message.get("op") {
                Some(Value::Array(arr)) if arr.len() > 1 => arr[0].clone(),
                _ => Value::Null,
            };
            let sub_bva = message.get("bv-a").cloned().unwrap_or(Value::Null);
            self.cell_subs
                .entry(target.to_string())
                .or_insert_with(Vec::new)
                .push((id.to_string(), from.to_string(), sub_args, sub_bva));
            let rewritten = format!("{}{}", sigil, target);
            return self.handle_op(&rewritten, message, payload, from, id);
        }
        // Slice 12 inbound: reconstruct any ::Name-tagged shape values
        // from their wire payload (positional list or named map without
        // __type) so handler bodies can read them as tagged structures.
        // We shadow payload with a locally-owned reconstructed copy so
        // both payload.get(...) and Structure::pack downstream see it.
        let _payload_owned = payload.clone();
        let mut _payload_owned = _payload_owned;
        if let Some(Value::Array(_arr)) = message.get("bv-a") {
            if let Some(_types) = _arr.first() {
                if let Some(_types_obj) = _types.as_object() {
                    if let Value::Object(_p_map) = &mut _payload_owned {
                        for (_k, _tag) in _types_obj.iter() {
                            if let Some(_tag_str) = _tag.as_str() {
                                if let Some(_rest) = _tag_str.strip_prefix("::") {
                                    if let Some(_decl) = bv_type_fields(_rest) {
                                        if let Some(_v) = _p_map.get(_k).cloned() {
                                            _p_map.insert(_k.clone(), bv_from_wire(_tag_str, &_v, _decl));
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if let Some(_types_arr) = _types.as_array() {
                    if let Value::Array(_p_arr) = &mut _payload_owned {
                        for (_i, _tag) in _types_arr.iter().enumerate() {
                            if let Some(_tag_str) = _tag.as_str() {
                                if let Some(_rest) = _tag_str.strip_prefix("::") {
                                    if let Some(_decl) = bv_type_fields(_rest) {
                                        if _i < _p_arr.len() {
                                            _p_arr[_i] = bv_from_wire(_tag_str, &_p_arr[_i], _decl);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        let payload = &_payload_owned;
        let _s = Structure::pack(payload);
        let _bva_msg = message.get("bv-a");
        let _ = id;
        let mut re: Option<Value> = None;
        let mut bva_re: Option<Value> = None;
        let mut handled = false;
        match op_name {
${matchArms}
        }
        (re, bva_re, handled)
    }${fileClassNeedsSelfPool ? `

    // Per-instance dispatch on a Self()-spawned sibling. Same pattern as
    // child_<class>_dispatch_at: swap the sibling's state into self.state,
    // run the file-class handle_op, swap back.
    fn handle_op_at(&mut self, instance_id: u32, op_name: &str, message: &Value, payload: &Value, from: &str, id: &str) -> (Option<Value>, Option<Value>, bool) {
        let saved_state = std::mem::take(&mut self.state);
        self.state = self.self_instances.remove(&instance_id).unwrap_or_default();
        let result = self.handle_op(op_name, message, payload, from, id);
        let new_state = std::mem::take(&mut self.state);
        self.self_instances.insert(instance_id, new_state);
        self.state = saved_state;
        result
    }

    fn self_init_at(&mut self, instance_id: u32, args: &Value) {
        let saved_state = std::mem::take(&mut self.state);
        self.state = self.self_instances.remove(&instance_id).unwrap_or_default();
        // Run the same primary-init logic against the swapped state. Args
        // shape mirrors what main()/start() expect: positional Value array.
${actor.initParams && actor.initParams.length > 0 ? actor.initParams.map((p, i) => `        if let Some(v) = args.as_array().and_then(|a| a.get(${i})) { self.state.insert("${stateKey(p.name)}".to_string(), v.clone()); }`).join('\n') : '        let _ = args;'}
        let new_state = std::mem::take(&mut self.state);
        self.self_instances.insert(instance_id, new_state);
        self.state = saved_state;
    }` : ''}

    fn call_fn(&mut self, fn_val: &Value, payload: &Value) -> Value {
        let fn_name = fn_val.as_str().unwrap_or("");
        self.self_send(fn_name, payload)
    }

    fn self_send(&mut self, op_name: &str, payload: &Value) -> Value {
        let empty_msg = json!({});
        let (re, _bva, _handled) = self.handle_op(op_name, &empty_msg, payload, "__self", "");
        re.unwrap_or(Value::Null)
    }`;

  // Dispatch body — calls handle_op, routes results
  const dispatchBlock = `        let result = catch_unwind(AssertUnwindSafe(|| {
            self.handle_op(op_name.as_str(), message, &payload, from, id)
        }));
        match result {
            Ok((re, bva_re, handled)) => {
                if !handled {
                    let mut ex = Map::new();
                    ex.insert(op_name.clone(), json!("unhandled"));
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("ex".to_string(), Value::Object(ex));
                    resp.insert("to".to_string(), json!(from));
                    let _ = self.binding.send(Value::Object(resp));
                } else if let Some(re_val) = re {
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("re".to_string(), re_val);
                    resp.insert("to".to_string(), json!(from));
                    if let Some(bva) = bva_re {
                        resp.insert("bv-a".to_string(), bva);
                    }
                    let _ = self.binding.send(Value::Object(resp));
                }
            }
            Err(_) => {
                let mut ex = Map::new();
                ex.insert(op_name.clone(), json!("error"));
                let mut resp = Map::new();
                resp.insert("id".to_string(), json!(id));
                resp.insert("ex".to_string(), Value::Object(ex));
                resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
            }
        }`;

  return `use serde_json::{json, Value, Map, Number};
use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::panic::{catch_unwind, AssertUnwindSafe};
use regex::Regex;
use num_bigint::BigInt;
use num_traits::{Zero, One, ToPrimitive, Signed};
use num_integer::Integer;
use std::str::FromStr;

// Trait to convert any Brevity value to serde_json::Value
trait IntoValue {
    fn into_value(self) -> Value;
}
impl IntoValue for BigInt {
    fn into_value(self) -> Value { bv_bigint_to_value(&self) }
}
impl IntoValue for &BigInt {
    fn into_value(self) -> Value { bv_bigint_to_value(self) }
}
impl IntoValue for i64 {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for f64 {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for &str {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for String {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for &String {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for bool {
    fn into_value(self) -> Value { json!(self) }
}
impl IntoValue for Value {
    fn into_value(self) -> Value { self }
}
impl IntoValue for &Value {
    fn into_value(self) -> Value { self.clone() }
}

fn bv_val(v: impl IntoValue) -> Value { v.into_value() }

fn bv_to_bigint(v: &Value) -> BigInt {
    match v {
        Value::Number(n) => BigInt::from_str(&n.to_string()).unwrap_or_else(|_| BigInt::zero()),
        _ => BigInt::zero(),
    }
}

fn bv_bigint_to_value(n: &BigInt) -> Value {
    let s = n.to_string();
    Value::Number(Number::from_str(&s).unwrap_or_else(|_| Number::from(0)))
}

fn bv_pow(base: &BigInt, exp: &BigInt) -> BigInt {
    if exp.is_zero() { return BigInt::one(); }
    let mut result = BigInt::one();
    let mut b = base.clone();
    let mut e = exp.clone();
    let two = BigInt::from(2);
    while e > BigInt::zero() {
        if e.is_odd() { result *= &b; }
        e /= &two;
        b = &b * &b;
    }
    result
}

#[derive(Clone, Debug)]
struct BvDecimal { c: BigInt, s: u32 }

impl BvDecimal {
    fn new(c: BigInt, s: u32) -> Self { BvDecimal { c, s } }
    fn from_value(v: &Value) -> Self {
        match v {
            Value::Number(n) => {
                let s = n.to_string();
                if let Some(dot) = s.find('.') {
                    let frac_len = s.len() - dot - 1;
                    let digits: String = s.chars().filter(|c| *c != '.').collect();
                    BvDecimal::new(BigInt::from_str(&digits).unwrap_or_else(|_| BigInt::zero()), frac_len as u32)
                } else {
                    BvDecimal::new(BigInt::from_str(&s).unwrap_or_else(|_| BigInt::zero()), 0)
                }
            },
            _ => BvDecimal::new(BigInt::zero(), 0),
        }
    }
    fn from_int(n: &BigInt) -> Self { BvDecimal::new(n.clone(), 0) }
    fn from_f64(v: f64) -> Self {
        let s = format!("{}", v);
        if let Some(dot) = s.find('.') {
            let frac_len = s.len() - dot - 1;
            let digits: String = s.chars().filter(|c| *c != '.').collect();
            BvDecimal::new(BigInt::from_str(&digits).unwrap_or_else(|_| BigInt::zero()), frac_len as u32)
        } else {
            BvDecimal::new(BigInt::from_str(&s).unwrap_or_else(|_| BigInt::zero()), 0)
        }
    }
    fn align(&self, other: &BvDecimal) -> (BigInt, BigInt, u32) {
        if self.s == other.s { return (self.c.clone(), other.c.clone(), self.s); }
        if self.s > other.s {
            let diff = self.s - other.s;
            let factor = num_traits::pow(BigInt::from(10), diff as usize);
            (self.c.clone(), &other.c * &factor, self.s)
        } else {
            let diff = other.s - self.s;
            let factor = num_traits::pow(BigInt::from(10), diff as usize);
            (&self.c * &factor, other.c.clone(), other.s)
        }
    }
    fn add(&self, other: &BvDecimal) -> BvDecimal {
        let (a, b, s) = self.align(other);
        BvDecimal::new(&a + &b, s)
    }
    fn sub(&self, other: &BvDecimal) -> BvDecimal {
        let (a, b, s) = self.align(other);
        BvDecimal::new(&a - &b, s)
    }
    fn mul(&self, other: &BvDecimal) -> BvDecimal {
        BvDecimal::new(&self.c * &other.c, self.s + other.s)
    }
    fn rem_(&self, other: &BvDecimal) -> BvDecimal {
        let (a, b, s) = self.align(other);
        BvDecimal::new(&a - &(&a / &b) * &b, s)
    }
    fn div_exact(&self, other: &BvDecimal) -> BvDecimal {
        if other.c.is_zero() { panic!("Division by zero"); }
        if self.c.is_zero() { return BvDecimal::new(BigInt::zero(), 0); }
        let abs_num = self.c.abs();
        let abs_den = other.c.abs();
        let g = bv_gcd(&abs_num, &abs_den);
        let mut reduced = &abs_den / &g;
        while (&reduced % BigInt::from(2)).is_zero() { reduced /= 2; }
        while (&reduced % BigInt::from(5)).is_zero() { reduced /= 5; }
        if !reduced.is_one() { panic!("Non-terminating decimal division"); }
        let sign = if (self.c < BigInt::zero()) != (other.c < BigInt::zero()) { BigInt::from(-1) } else { BigInt::from(1) };
        let mut num = abs_num;
        let mut extra: u32 = 0;
        while !(&num % &abs_den).is_zero() { num *= 10; extra += 1; }
        let rc = &sign * &(&num / &abs_den);
        let rs_raw: i64 = self.s as i64 + extra as i64 - other.s as i64;
        let (mut rc2, mut rs2) = if rs_raw < 0 {
            (&rc * num_traits::pow(BigInt::from(10), (-rs_raw) as usize), 0u32)
        } else { (rc, rs_raw as u32) };
        while rs2 > 0 && (&rc2 % BigInt::from(10)).is_zero() { rc2 /= 10; rs2 -= 1; }
        BvDecimal::new(rc2, rs2)
    }
    fn pow_(&self, exp: i64) -> BvDecimal {
        if exp == 0 { return BvDecimal::new(BigInt::one(), 0); }
        if exp > 0 {
            let mut r = self.clone();
            for _ in 1..exp { r = r.mul(self); }
            // Strip trailing zeros
            let mut c = r.c; let mut s = r.s;
            while s > 0 && (&c % BigInt::from(10)).is_zero() { c /= 10; s -= 1; }
            BvDecimal::new(c, s)
        } else {
            let base = self.pow_(-exp);
            BvDecimal::new(BigInt::one(), 0).div_exact(&base)
        }
    }
    fn cmp_(&self, other: &BvDecimal) -> i32 {
        let (a, b, _) = self.align(other);
        if a < b { -1 } else if a > b { 1 } else { 0 }
    }
    fn to_f64(&self) -> f64 {
        let mut c = self.c.clone(); let mut s = self.s;
        while s > 0 && (&c % BigInt::from(10)).is_zero() { c /= 10; s -= 1; }
        let sign = if c < BigInt::zero() { "-" } else { "" };
        let abs = c.abs();
        let abs_str = abs.to_string();
        let len = abs_str.len();
        let float_str = if s == 0 {
            format!("{}{}.0", sign, abs_str)
        } else if s as usize >= len {
            format!("{}0.{}{}", sign, "0".repeat(s as usize - len), abs_str)
        } else {
            format!("{}{}.{}", sign, &abs_str[..len - s as usize], &abs_str[len - s as usize..])
        };
        float_str.parse::<f64>().unwrap_or(0.0)
    }
    fn to_value(&self) -> Value {
        if self.s == 0 {
            let s = self.c.to_string();
            Value::Number(Number::from_str(&s).unwrap_or_else(|_| Number::from(0)))
        } else {
            // Strip trailing zeros
            let mut c = self.c.clone(); let mut s = self.s;
            while s > 0 && (&c % BigInt::from(10)).is_zero() { c /= 10; s -= 1; }
            if s == 0 {
                let st = c.to_string();
                return Value::Number(Number::from_str(&st).unwrap_or_else(|_| Number::from(0)));
            }
            let sign = if c < BigInt::zero() { "-" } else { "" };
            let abs = c.abs();
            let abs_str = abs.to_string();
            let len = abs_str.len();
            let float_str = if s as usize >= len {
                format!("{}0.{}{}", sign, "0".repeat(s as usize - len), abs_str)
            } else {
                format!("{}{}.{}", sign, &abs_str[..len - s as usize], &abs_str[len - s as usize..])
            };
            Value::Number(Number::from_str(&float_str).unwrap_or_else(|_| Number::from(0)))
        }
    }
}

impl IntoValue for BvDecimal {
    fn into_value(self) -> Value { self.to_value() }
}
impl IntoValue for &BvDecimal {
    fn into_value(self) -> Value { self.to_value() }
}

fn bv_gcd(a: &BigInt, b: &BigInt) -> BigInt {
    let mut x = a.abs(); let mut y = b.abs();
    while !y.is_zero() { let t = y.clone(); y = &x % &y; x = t; }
    x
}

fn bv_to_decimal(v: &Value) -> BvDecimal { BvDecimal::from_value(v) }
fn bv_decimal_to_value(d: &BvDecimal) -> Value { d.to_value() }

fn bv_dec_ensure(v: &Value) -> BvDecimal { BvDecimal::from_value(v) }

fn bv_dec_op(a: &BvDecimal, op: &str, b: &BvDecimal) -> BvDecimal {
    match op {
        "+" => a.add(b),
        "-" => a.sub(b),
        "*" => a.mul(b),
        "/" => a.div_exact(b),
        "%" => a.rem_(b),
        _ => a.add(b),
    }
}

fn bv_dec_cmp_op(a: &BvDecimal, op: &str, b: &BvDecimal) -> bool {
    let c = a.cmp_(b);
    match op {
        "==" => c == 0,
        "!=" => c != 0,
        ">"  => c > 0,
        "<"  => c < 0,
        ">=" => c >= 0,
        "<=" => c <= 0,
        _ => false,
    }
}

fn bv_dec_pow(base: &BvDecimal, exp: &BigInt) -> BvDecimal {
    base.pow_(exp.to_i64().unwrap_or(0))
}

fn bv_dec_divide(a: &BvDecimal, b: &BvDecimal, precision: &BigInt) -> BvDecimal {
    let prec = precision.to_u32().unwrap_or(0);
    let needed = prec as i64 + b.s as i64 - a.s as i64;
    let mut num = a.c.clone();
    if needed > 0 {
        num *= num_traits::pow(BigInt::from(10), needed as usize);
    } else if needed < 0 {
        let f = num_traits::pow(BigInt::from(10), (-needed) as usize);
        num /= f;
    }
    let rc = &num / &b.c;
    BvDecimal::new(rc, prec)
}

// Stringification for interpolated strings ("...#{v}...").
// Per spec: Integer → decimal digits; Decimal → decimal with preserved scale;
// Float → mantissa (required decimal point, shortest round-trippable, no
// truncation) + "e" + signed exponent; Boolean → "true"/"false"; Text → self.
trait BvStr { fn bv_str(&self) -> String; }

fn bv_str_float(v: f64) -> String {
    if !v.is_finite() { return v.to_string(); }
    if v == 0.0 { return "0.0e+0".to_string(); }
    let sign = if v < 0.0 { "-" } else { "" };
    let abs = v.abs();
    let formatted = format!("{:e}", abs);
    let (m, e) = formatted.split_once('e').unwrap_or((formatted.as_str(), "0"));
    let m_with_dot = if m.contains('.') { m.to_string() } else { format!("{}.0", m) };
    let e_signed = if e.starts_with('-') || e.starts_with('+') { e.to_string() } else { format!("+{}", e) };
    format!("{}{}e{}", sign, m_with_dot, e_signed)
}

fn bv_str_decimal(v: &BvDecimal) -> String {
    if v.s == 0 { return v.c.to_string(); }
    let neg = v.c < BigInt::zero();
    let abs = if neg { -v.c.clone() } else { v.c.clone() };
    let abs_s = abs.to_string();
    let sign = if neg { "-" } else { "" };
    let scale = v.s as usize;
    if scale >= abs_s.len() {
        let pad = "0".repeat(scale - abs_s.len());
        format!("{}0.{}{}", sign, pad, abs_s)
    } else {
        let split = abs_s.len() - scale;
        format!("{}{}.{}", sign, &abs_s[..split], &abs_s[split..])
    }
}

impl BvStr for BigInt { fn bv_str(&self) -> String { self.to_string() } }
impl BvStr for BvDecimal { fn bv_str(&self) -> String { bv_str_decimal(self) } }
impl BvStr for f64 { fn bv_str(&self) -> String { bv_str_float(*self) } }
impl BvStr for bool { fn bv_str(&self) -> String { if *self { "true".to_string() } else { "false".to_string() } } }
impl BvStr for String { fn bv_str(&self) -> String { self.clone() } }
impl BvStr for str { fn bv_str(&self) -> String { self.to_string() } }

// Slice 12+13 wire format helpers. The codegen passes the field set per
// call-site (no global registry), so each shape-typed reply slot picks up
// its own field order + optionality flag at codegen time.
fn bv_to_wire(v: &Value, fields: &[&str], all_required: bool) -> Value {
    let m = match v { Value::Object(m) => m, _ => return v.clone() };
    if !m.contains_key("__type") { return v.clone(); }
    if all_required {
        let arr: Vec<Value> = fields.iter()
            .map(|f| m.get(*f).cloned().unwrap_or(Value::Null))
            .collect();
        return Value::Array(arr);
    }
    let mut out = Map::new();
    for f in fields {
        if let Some(val) = m.get(*f) {
            if !matches!(val, Value::Null) { out.insert(f.to_string(), val.clone()); }
        }
    }
    Value::Object(out)
}

#[allow(dead_code)]
fn bv_from_wire(tag: &str, payload: &Value, fields: &[&str]) -> Value {
    if !tag.starts_with("::") { return payload.clone(); }
    let name = &tag[2..];
    let mut out = Map::new();
    out.insert("__type".to_string(), Value::String(name.to_string()));
    match payload {
        Value::Array(arr) => {
            for (i, f) in fields.iter().enumerate() {
                if i < arr.len() { out.insert(f.to_string(), arr[i].clone()); }
            }
        }
        Value::Object(m) => {
            for f in fields {
                if let Some(v) = m.get(*f) { out.insert(f.to_string(), v.clone()); }
            }
        }
        _ => return payload.clone(),
    }
    Value::Object(out)
}
impl BvStr for Value {
    fn bv_str(&self) -> String {
        match self {
            Value::String(s) => s.clone(),
            Value::Bool(b) => if *b { "true".to_string() } else { "false".to_string() },
            Value::Null => "null".to_string(),
            Value::Number(n) => {
                if n.is_i64() { return n.as_i64().unwrap().to_string(); }
                if n.is_u64() { return n.as_u64().unwrap().to_string(); }
                if let Some(f) = n.as_f64() { return bv_str_float(f); }
                n.to_string()
            }
            _ => self.to_string(),
        }
    }
}

fn bv_graphemes<'a>(s: &'a str) -> Vec<&'a str> {
    // Simple grapheme segmentation: split on char boundaries
    // For full grapheme cluster support, use unicode-segmentation crate
    let mut result = Vec::new();
    let mut chars = s.char_indices().peekable();
    while let Some((start, _)) = chars.next() {
        let end = chars.peek().map_or(s.len(), |&(i, _)| i);
        result.push(&s[start..end]);
    }
    result
}

fn bv_blob_to_hex(s: &str) -> String {
    s.as_bytes().iter().map(|b| format!("{:02x}", b)).collect()
}

fn bv_blob_from_hex(hex: &str) -> String {
    let bytes: Vec<u8> = (0..hex.len()).step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i+2], 16).unwrap_or(0))
        .collect();
    String::from_utf8_lossy(&bytes).to_string()
}

fn bv_base64_encode(s: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = s.as_bytes();
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}

fn bv_base64_decode(s: &str) -> Vec<u8> {
    fn val(c: u8) -> u32 {
        match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62, b'/' => 63, _ => 0,
        }
    }
    let bytes: Vec<u8> = s.bytes().filter(|&b| b != b'=' && b != b'\\n' && b != b'\\r').collect();
    let mut result = Vec::new();
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 { break; }
        let a = val(chunk[0]); let b = val(chunk[1]);
        let c = if chunk.len() > 2 { val(chunk[2]) } else { 0 };
        let d = if chunk.len() > 3 { val(chunk[3]) } else { 0 };
        let triple = (a << 18) | (b << 12) | (c << 6) | d;
        result.push(((triple >> 16) & 0xFF) as u8);
        if chunk.len() > 2 { result.push(((triple >> 8) & 0xFF) as u8); }
        if chunk.len() > 3 { result.push((triple & 0xFF) as u8); }
    }
    result
}

fn bv_blob_xor(a: &str, b: &str) -> String {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let out: Vec<u8> = ab.iter().zip(bb.iter()).map(|(x, y)| x ^ y).collect();
    String::from_utf8_lossy(&out).to_string()
}

fn bv_blob_ct_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() { return false; }
    let mut diff = 0u8;
    for (x, y) in ab.iter().zip(bb.iter()) { diff |= x ^ y; }
    diff == 0
}

// Canonical structural equality used by List.contains/index_of/replace/
// before/after/starts_with/ends_with. Matches the JS reference impl in
// src/codegen/javascript/runtime/equality.js: numeric values compare via
// BvDecimal alignment (1 == 1.0 == 1.00); arrays recurse; objects use
// PartialEq for identity / structural fallback.
fn bv_eq(a: &Value, b: &Value) -> bool {
    if let (Value::Array(aa), Value::Array(bb)) = (a, b) {
        if aa.len() != bb.len() { return false; }
        return aa.iter().zip(bb.iter()).all(|(x, y)| bv_eq(x, y));
    }
    if a.is_number() && b.is_number() {
        let da = BvDecimal::from_value(a);
        let db = BvDecimal::from_value(b);
        return da.cmp_(&db) == 0;
    }
    a == b
}

fn bv_cmp(a: &Value, b: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    if a.is_number() && b.is_number() {
        let da = BvDecimal::from_value(a);
        let db = BvDecimal::from_value(b);
        return match da.cmp_(&db) { i if i < 0 => Ordering::Less, i if i > 0 => Ordering::Greater, _ => Ordering::Equal };
    }
    if let (Some(sa), Some(sb)) = (a.as_str(), b.as_str()) {
        return sa.cmp(sb);
    }
    Ordering::Equal
}

fn bv_list_size(v: &Value) -> BigInt {
    BigInt::from(v.as_array().map_or(0, |a| a.len()))
}
fn bv_list_empty(v: &Value) -> bool {
    v.as_array().map_or(true, |a| a.is_empty())
}
fn bv_list_first(v: &Value) -> Value {
    v.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)
}
fn bv_list_last(v: &Value) -> Value {
    v.as_array().and_then(|a| a.last()).cloned().unwrap_or(Value::Null)
}
fn bv_list_at(v: &Value, n: usize) -> Value {
    v.as_array().and_then(|a| a.get(n)).cloned().unwrap_or(Value::Null)
}
fn bv_list_take(v: &Value, n: usize) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let n = n.min(arr.len());
    Value::Array(arr[..n].to_vec())
}
fn bv_list_from(v: &Value, n: usize) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let n = n.min(arr.len());
    Value::Array(arr[n..].to_vec())
}
fn bv_list_slice(v: &Value, start: usize, end: Option<usize>) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let len = arr.len();
    let s = start.min(len);
    let e = end.map_or(len, |e| e.min(len)).max(s);
    Value::Array(arr[s..e].to_vec())
}
fn bv_list_reverse(v: &Value) -> Value {
    let mut arr = v.as_array().cloned().unwrap_or_default();
    arr.reverse();
    Value::Array(arr)
}
fn bv_list_repeat(v: &Value, n: usize) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::with_capacity(arr.len().saturating_mul(n));
    for _ in 0..n { out.extend(arr.iter().cloned()); }
    Value::Array(out)
}
fn bv_list_concat(a: &Value, b: &Value) -> Value {
    let mut out = a.as_array().cloned().unwrap_or_default();
    if let Some(bb) = b.as_array() { out.extend(bb.iter().cloned()); }
    Value::Array(out)
}
fn bv_list_append(v: &Value, x: &Value) -> Value {
    let mut out = v.as_array().cloned().unwrap_or_default();
    out.push(x.clone());
    Value::Array(out)
}
fn bv_list_prepend(v: &Value, x: &Value) -> Value {
    let mut out: Vec<Value> = Vec::with_capacity(v.as_array().map_or(0, |a| a.len()) + 1);
    out.push(x.clone());
    if let Some(arr) = v.as_array() { out.extend(arr.iter().cloned()); }
    Value::Array(out)
}
fn bv_list_index_of(v: &Value, needle: &Value) -> BigInt {
    if let Some(arr) = v.as_array() {
        for (i, e) in arr.iter().enumerate() {
            if bv_eq(e, needle) { return BigInt::from(i as i64); }
        }
    }
    BigInt::from(-1i64)
}
fn bv_list_contains(v: &Value, needle: &Value) -> bool {
    v.as_array().map_or(false, |a| a.iter().any(|e| bv_eq(e, needle)))
}
fn bv_list_starts_with(v: &Value, prefix: &Value) -> bool {
    let a = v.as_array().cloned().unwrap_or_default();
    let p = prefix.as_array().cloned().unwrap_or_default();
    if p.len() > a.len() { return false; }
    a.iter().zip(p.iter()).all(|(x, y)| bv_eq(x, y))
}
fn bv_list_ends_with(v: &Value, suffix: &Value) -> bool {
    let a = v.as_array().cloned().unwrap_or_default();
    let s = suffix.as_array().cloned().unwrap_or_default();
    if s.len() > a.len() { return false; }
    let off = a.len() - s.len();
    a[off..].iter().zip(s.iter()).all(|(x, y)| bv_eq(x, y))
}
fn bv_list_before(v: &Value, needle: &Value) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();
    for e in &arr {
        if bv_eq(e, needle) { return Value::Array(out); }
        out.push(e.clone());
    }
    Value::Array(out)
}
fn bv_list_after(v: &Value, needle: &Value) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    for (i, e) in arr.iter().enumerate() {
        if bv_eq(e, needle) {
            return Value::Array(arr[i+1..].to_vec());
        }
    }
    Value::Array(vec![])
}
fn bv_list_replace(v: &Value, needle: &Value, repl: &Value, all: bool) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::with_capacity(arr.len());
    let mut replaced = false;
    for e in arr.iter() {
        if (!replaced || all) && bv_eq(e, needle) {
            out.push(repl.clone());
            replaced = true;
        } else {
            out.push(e.clone());
        }
    }
    Value::Array(out)
}
fn bv_list_flatten(v: &Value) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();
    for e in arr.iter() {
        if let Some(inner) = e.as_array() {
            out.extend(inner.iter().cloned());
        }
    }
    Value::Array(out)
}
fn bv_list_unique(v: &Value) -> Value {
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();
    for e in arr.iter() {
        if !out.iter().any(|x| bv_eq(x, e)) { out.push(e.clone()); }
    }
    Value::Array(out)
}
fn bv_list_sort(v: &Value) -> Value {
    let mut arr = v.as_array().cloned().unwrap_or_default();
    arr.sort_by(|a, b| bv_cmp(a, b));
    Value::Array(arr)
}
fn bv_list_join(v: &Value, sep: &Value) -> String {
    let arr = v.as_array().cloned().unwrap_or_default();
    let sep_s = sep.as_str().unwrap_or("");
    arr.iter().map(|e| e.as_str().unwrap_or("").to_string()).collect::<Vec<_>>().join(sep_s)
}

${typeMemberOfFn}${matchTypesFn}${matchTypesPosFn}${listTypesOfFn}${structurePreamble}${wireHelpers}
struct Actor {
${structFields.join(',\n')},
}

impl Actor {
    fn new(binding: mpsc::Sender<Value>) -> Self {
        Actor { binding, ${newArgs.join(', ')} }
    }

${captureMethod}

    fn receive(&mut self, message: &Value) {
${receiveBody}
    }
${initMethod}
${handleOpMethod}

    fn dispatch(&mut self, message: &Value) {
        let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
        let op_val = message.get("op").unwrap();
        let (op_name, raw_payload): (String, Option<Value>) = if let Some(s) = op_val.as_str() {
            (s.to_string(), None)
        } else if let Some(arr) = op_val.as_array() {
            let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let payload = if arr.len() > 1 { Some(arr[0].clone()) } else { None };
            (name, payload)
        } else {
            return;
        };
        // Wire-to-internal normalization: strip '#' from system ops, then
        // "@subscribe"/"set" carry their selector in the to-field.
        let op_name = match op_name.as_str() {
            "#new" | "#set" | "#update" | "#call" => op_name[1..].to_string(),
            _ => op_name,
        };
        let op_name = match op_name.as_str() {
            "@subscribe" => {
                match message.get("to").and_then(|v| v.as_str()).and_then(extract_to_selector) {
                    Some(sel) => format!("subscribe{}", sel),
                    None => op_name,
                }
            }
            "set" => {
                match message.get("to").and_then(|v| v.as_str()).and_then(extract_to_selector) {
                    Some(sel) => format!("{}{}", op_name, sel),
                    None => op_name,
                }
            }
            _ => op_name,
        };
        let has_payload = match &raw_payload {
            Some(Value::Object(m)) => !m.is_empty(),
            Some(Value::Array(a)) => !a.is_empty(),
            _ => false,
        };
        if has_payload && message.get("bv-a").is_none() {
            let mut ex = Map::new();
            ex.insert(op_name.clone(), json!("schema_required"));
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("ex".to_string(), Value::Object(ex));
            resp.insert("to".to_string(), json!(from));
            let _ = self.binding.send(Value::Object(resp));
            return;
        }
        let payload = raw_payload.unwrap_or(json!({}));
${dispatchBlock}
    }
${fnMethods}${childMethodsCode}${subscribeDispatchMethod}${hasDotCallAwait ? `
    fn await_response(&mut self, target_id: &str) -> Value {
        loop {
            let mut buf = String::new();
            match self.reader.read_line(&mut buf) {
                Ok(0) => return Value::Null,
                Ok(_) => {
                    let line = buf.trim();
                    if line.is_empty() { continue; }
                    if let Ok(msg) = serde_json::from_str::<Value>(line) {
                        let msg_id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if let Some(re) = msg.get("re") {
                            if msg_id == target_id {
                                return re.clone();
                            }
                        }
                        if msg.get("ex").is_some() && msg_id == target_id {
                            panic!("ex_response");
                        }
                        self.receive(&msg);
                    }
                }
                Err(_) => return Value::Null,
            }
        }
    }

    fn await_new_response(&mut self, target_id: &str) -> Value {
        // Like await_response, but returns the actor address from
        // angle-delimited \`re\` field (falls back to \`from\`).
        loop {
            let mut buf = String::new();
            match self.reader.read_line(&mut buf) {
                Ok(0) => return Value::Null,
                Ok(_) => {
                    let line = buf.trim();
                    if line.is_empty() { continue; }
                    if let Ok(msg) = serde_json::from_str::<Value>(line) {
                        let msg_id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if msg_id == target_id {
                            return match msg.get("re").and_then(|v| v.as_str()) {
                                Some(s) if s.starts_with("#<") && s.ends_with('>') => Value::String(s[2..s.len()-1].to_string()),
                                _ => msg.get("from").cloned().unwrap_or(Value::Null)
                            };
                        }
                        self.receive(&msg);
                    }
                }
                Err(_) => return Value::Null,
            }
        }
    }` : ''}
}

fn main() {
    let (tx, rx) = mpsc::channel::<Value>();
    let handle = std::thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        for msg in rx {
            serde_json::to_writer(&mut out, &msg).unwrap();
            out.write_all(b"\\n").unwrap();
            out.flush().unwrap();
        }
    });
    let mut actor = Actor::new(tx);
${constructorParams.length > 0 ? `    if let Some(args_str) = std::env::args().nth(1) {
        if let Ok(args) = serde_json::from_str::<Value>(&args_str) {
            if let Some(arr) = args.as_array() {
${constructorParams.map((p, i) => `                if let Some(v) = arr.get(${i}) { actor.state.insert("${stateKey(p.name)}".to_string(), v.clone()); }`).join('\n')}
            }
        }
    }
` : ''}${stateInitLines.length > 0 ? stateInitLines.join('\n') + '\n' : ''}${hasDotCallAwait ? `    let mut buf = String::new();
    loop {
        buf.clear();
        match actor.reader.read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let line = buf.trim();
                if line.is_empty() { continue; }
                let message: Value = serde_json::from_str(line).unwrap();
                actor.receive(&message);
            }
            Err(_) => break,
        }
    }` : `    let stdin = io::stdin();
    let mut buf = String::new();
    loop {
        buf.clear();
        match stdin.lock().read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let line = buf.trim();
                if line.is_empty() { continue; }
                let message: Value = serde_json::from_str(line).unwrap();
                actor.receive(&message);
            }
            Err(_) => break,
        }
    }`}
    drop(actor);
    handle.join().unwrap();
}
`;
}

function codegenRust(ast) {
  setCtx(createRustContext());
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@'));
  const active = ast.actors.filter(a => a.functions.some(_isPublic) || a.functions.some(f => f.type === 'OnHandler') || (a.declarationReturn && a.declarationReturn.typeName));
  if (active.length === 0) return '';
  G.ctx.actorInfo = new Map();
  G.ctx.actorFnNames = new Set();
  G.ctx.typeDecls = new Map((ast.types || []).map(t => [t.name, t]));
  // Slice 15: imported types — registered under both the local and canonical
  // names so the bv_type_fields registry and TypeConstruction emit resolve
  // through either side of an `(Point: P)` rename. The validate pass already
  // rewrites callee identifiers to the canonical remote name.
  for (const [local, info] of Object.entries(ast.importedTypes || {})) {
    if (!G.ctx.typeDecls.has(local)) G.ctx.typeDecls.set(local, { name: info.remote, fields: info.decl.fields });
    if (!G.ctx.typeDecls.has(info.remote)) G.ctx.typeDecls.set(info.remote, { name: info.remote, fields: info.decl.fields });
  }
  G.ctx.dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  // Map dep alias -> interface (as declared in the constructor block). Used by
  // SubscribeCall to infer the target field's type so the re callback's
  // param gets a typed local, not a raw Value.
  G.ctx.dependencyInterfaces = new Map();
  for (const d of (ast.dependencies || [])) {
    if (d.interface) G.ctx.dependencyInterfaces.set(d.name, d.interface);
  }
  G.ctx.destructuredMembers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (d.destructures) {
      for (const entry of d.destructures) {
        G.ctx.destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
        G.ctx.dependencyNames.add(entry.local);
      }
    }
  }
  // Build actorNodes map for superclass resolution
  G.ctx.actorNodes = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  // Include actors that inherit public functions from superclasses even if they have none of their own
  const activeNames = new Set(active.map(a => a.name).filter(Boolean));
  for (const a of ast.actors) {
    if (a.name && !activeNames.has(a.name) && (a.supertypes || []).length > 0) {
      const hasInheritedPublic = (function check(actor) {
        for (const st of (actor.supertypes || [])) {
          const sup = G.ctx.actorNodes.get(st.supertype);
          if (!sup) continue;
          if (sup.functions.some(f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@')))) return true;
          if (check(sup)) return true;
        }
        return false;
      })(a);
      if (hasInheritedPublic) {
        active.push(a);
        activeNames.add(a.name);
      }
    }
  }
  G.ctx.childCounter = 0;
  for (const a of active) {
    if (a.name) {
      const asClauses = [...(a.asClauses || [])];
      if (a.declarationReturn && a.declarationReturn.typeName) {
        asClauses.push({ targetType: a.declarationReturn.typeName, negated: false, expr: a.declarationReturn.expr, memoized: true });
      }
      G.ctx.actorInfo.set(a.name, { actor: a, asClauses });
    }
    a.functions.filter(f => f.name && !_isPublic(f) && !f.actorDef && !f.emptyOverload).forEach(f => G.ctx.actorFnNames.add(f.name));
  }
  // Set publicFnNames for bare-name self-send routing
  const mainActor0 = active.find(a => !a.name) || active[0];
  G.ctx.publicFnNames = new Set(mainActor0.functions.filter(f => _isPublic(f) && !f.actorDef).map(f => f.name));
  for (const a of active) {
    a.functions.filter(f => _isPublic(f) && !f.actorDef).forEach(f => G.ctx.publicFnNames.add(f.name));
  }

  // ── Constructor overloads: promote actorDef FunctionDecls to synthetic actors ──
  G.ctx.constructorOverloads = new Map();
  const existingActorNames = new Set(active.filter(a => a.name).map(a => a.name));
  for (const a of active) {
    if (a.name) continue; // only check anonymous actor (file-level)
    const actorDefsByName = new Map();
    for (const fn of a.functions) {
      if (!fn.actorDef) continue;
      if (!actorDefsByName.has(fn.name)) actorDefsByName.set(fn.name, []);
      actorDefsByName.get(fn.name).push(fn);
    }
    for (const [baseName, fns] of actorDefsByName) {
      const hasPrimaryActor = existingActorNames.has(baseName);
      if (!G.ctx.constructorOverloads.has(baseName)) G.ctx.constructorOverloads.set(baseName, []);
      const overloads = G.ctx.constructorOverloads.get(baseName);
      for (let i = 0; i < fns.length; i++) {
        const fn = fns[i];
        if (!hasPrimaryActor && i === 0) {
          // No primary Actor exists (Function() initializer) — first clause becomes the primary
          const synActor = AST.actor(baseName, { ...fn.actorDef });
          active.push(synActor);
          existingActorNames.add(baseName);
          G.ctx.actorInfo.set(baseName, { actor: synActor, asClauses: synActor.asClauses || [] });
          G.ctx.actorNodes.set(baseName, synActor);
        } else {
          const mangledName = `${baseName}_ov${overloads.length}`;
          overloads.push({ mangledName, params: fn.actorDef.params || fn.params || [] });
          const synActor = AST.actor(mangledName, { ...fn.actorDef });
          active.push(synActor);
          existingActorNames.add(mangledName);
          G.ctx.actorInfo.set(mangledName, { actor: synActor, asClauses: synActor.asClauses || [] });
          G.ctx.actorNodes.set(mangledName, synActor);
        }
      }
    }
  }

  // Pre-merge superclass inheritance into actorInfo so main actor codegen sees merged params
  for (const a of active) {
    if (!a.name || !(a.supertypes?.length > 0)) continue;
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSuperclassChain(G.ctx.actorNodes, a);
    if (inheritedParams.length === 0 && inheritedFunctions.length === 0 && inheritedIngests.length === 0) continue;
    const ownParamNames = new Set((a.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(a.initParams || []),
    ];
    const ownFnNames = new Set(a.functions.map(f => f.name));
    const delegatedFunctions = [];
    const inlinedInherited = [];
    for (const f of inheritedFunctions) {
      if (ownFnNames.has(f.name) || f.name?.startsWith('#')) continue;
      if (wrappedBindings.length > 0 && f.name?.startsWith('@')) {
        delegatedFunctions.push(f);
      } else {
        inlinedInherited.push(f);
      }
    }
    const mergedFunctions = [...a.functions, ...inlinedInherited];
    const supertypeBindings = wrappedBindings.filter(wb => G.ctx.actorNodes?.get(wb.supertype));
    const mergedActor = {
      ...a,
      initParams: mergedParams,
      functions: mergedFunctions,
      _delegatedFunctions: delegatedFunctions,
      _supertypeBindings: supertypeBindings,
      _inheritedIngests: inheritedIngests,
    };
    // Merge inherited ingest state var decls into the subclass
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
    const info = G.ctx.actorInfo.get(a.name);
    G.ctx.actorInfo.set(a.name, { ...info, actor: mergedActor });
  }
  // Collect emit declarations from all actors
  G.ctx.emitNames = new Map();
  for (const a of active) {
    for (const s of (a.constructorBody || [])) {
      if (s.type === 'EmitDecl') G.ctx.emitNames.set(s.name, s);
    }
  }
  const mainActor = active.find(a => !a.name) || active[0];
  return genRustProgram(mainActor, active);
}

export { genRustProgram, codegenRust, createRustContext };
