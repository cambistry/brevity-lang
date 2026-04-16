// program.js — Program assembly and entry for Rust codegen
import * as AST from '../../ast.js';
import {
  G, createRustContext, setCtx, MATCH_TYPES_FN, MATCH_TYPES_POSITIONAL_FN,
  RUST_STRUCTURE_PREAMBLE, LIST_TYPES_OF_FN,
  inferLiteralType,
  toJsonValue, forceJsonWrap, fnReturnsFunction,
  needsDotCallAwait,
} from './types.js';
import {
  genRustExpr, genRustFnMethod,
} from './expressions.js';
import {
  genRustDispatch,
  genRustChildMethods,
  resolveSupertypeChain,
} from './handlers.js';

function genRustProgram(actor, allActors) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@'));
  const publicFns = actor.functions.filter(_isPublic);
  const privateFns = actor.functions.filter(f => !_isPublic(f) && !f.actorDef && !f.emptyOverload);
  const hasFns = privateFns.length > 0;
  const childActors = (allActors || []).filter(a => a.name && G.ctx.actorInfo.has(a.name));
  const anyChildStateful = childActors.some(a => (a.stateVarDecls || []).length > 0);
  const isStateful = (actor.stateVarDecls && actor.stateVarDecls.length > 0) || anyChildStateful;
  const needsRefs = publicFns.some(h => h.body.some(s => s.type === 'RefDecl' || s.type === 'SetStatement' || s.type === 'RefRead'))
    || publicFns.some(h => h.body.some(s => s.type === 'WhileStatement' && s.body.some(ws => ws.type === 'SetStatement')));
  const allDispatchFns = [...publicFns, ...privateFns];
  const needsMatchTypes = allDispatchFns.some(h => {
    const typed = h.params.filter(p => p.type && !p.rest);
    return typed.length > 0 && !typed.some(p => p.positional);
  });
  const needsMatchTypesPos = allDispatchFns.some(h => h.params.some(p => p.type && !p.rest && p.positional));
  const needsListTypesOf = publicFns.some(h => {
    const isListOfAny = t => t === 'List of Anything' || t === 'List';
    return h.body.some(s => s.type === 'TypedAssign' && isListOfAny(s.typeName));
  });
  const matchTypesFn = needsMatchTypes ? '\n' + MATCH_TYPES_FN + '\n' : '';
  const matchTypesPosFn = needsMatchTypesPos ? '\n' + MATCH_TYPES_POSITIONAL_FN + '\n' : '';
  const listTypesOfFn = needsListTypesOf ? '\n' + LIST_TYPES_OF_FN + '\n' : '';
  // Always include Structure — handle_op uses Structure::pack
  const structurePreamble = '\n' + RUST_STRUCTURE_PREAMBLE + '\n';
  const mainActorStateful = actor.stateVarDecls && actor.stateVarDecls.length > 0;
  const constructorParams = actor.initParams || [];
  // Collect service coercion aliases from the service block. Constructor
  // coercions (those carrying constructorParams) are not runtime state —
  // they only exist as compile-time aliases for an underlying dep.
  const allCoercions = (actor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
  const serviceCoercions = allCoercions.filter(s => !s.constructorParams);
  const constructorCoercions = allCoercions.filter(s => s.constructorParams);
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
  G.ctx.constructsProxyVars = new Set();
  G.ctx.constructsVarToProxy = new Map();
  // Constructor coercions: alias name → underlying dep name. Treat the alias
  // as a dep so `t = Coerced(args)` enters the construction path; substitute
  // the underlying dep for `new` addressing.
  G.ctx.constructorCoercions = new Map();
  for (const c of constructorCoercions) {
    const underlying = c.ref?.name || c.ref;
    G.ctx.constructorCoercions.set(c.name, underlying);
    G.ctx.dependencyNames.add(c.name);
  }
  for (const s of (actor.initBody || [])) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.dependencyNames.has(s.value.callee.name)) {
      const cDecl = G.ctx.constructsMap.get(s.value.callee.name);
      if (!cDecl) {
        G.ctx.remoteInstanceVars.add(s.name);
      } else {
        G.ctx.constructsProxyVars.add(s.name);
        G.ctx.constructsVarToProxy.set(s.name, cDecl.proxyName.toLowerCase());
      }
    }
  }
  // Constructs proxy: bare params in proxy child actor are remote instance refs
  const isConstructsProxyActor = [...G.ctx.constructsMap.values()].some(c => c.proxyName === actor.name);
  if (isConstructsProxyActor) {
    for (const p of (actor.initParams || [])) {
      if (p.type === 'Anything') G.ctx.remoteInstanceVars.add(p.name);
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
  const matchArms = genRustDispatch(publicFns, privateFns, _preInitLambdas, constructorParams);
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
  structFields.push('    send_seq: std::cell::Cell<i64>');
  newArgs.push('send_seq: std::cell::Cell::new(1)');
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
      if (s.type === 'StateAssign' && (G.ctx.remoteInstanceVars.has(s.name) || G.ctx.constructsProxyVars.has(s.name))) {
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
        stateInitLines.push(`        let new_op = json!([${argsJson}, "new"]);`);
        stateInitLines.push(`        let new_msg = json!({"id": new_id, "op": new_op, "to": "${callee}"});`);
        stateInitLines.push(`        let _ = actor.binding.send(new_msg);`);
        stateInitLines.push(`    }`);
        continue;
      }
      if (s.type === 'StateAssign') {
        // Check if this was pre-registered as a lambda
        const preInit = _preInitLambdas.find(p => p.stateVar === s.name);
        if (preInit) {
          stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), json!("${preInit.lambdaName}"));`);
        } else if (s.value?.type === 'StructureConstructor' || s.value?.type === 'StructureLiteral') {
          // Store Structure as wire-format JSON (Structure type is not serializable)
          const positional = s.value.args.filter(a => a.positional);
          const named = s.value.args.filter(a => a.key !== undefined);
          if (positional.length === 1 && named.length === 0) {
            const val = genRustExpr(positional[0].expr, initTypeEnv);
            const pt = positional[0].type || inferLiteralType(positional[0].expr);
            stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), json!([${toJsonValue(val, pt)}]));`);
          } else {
            const val = genRustExpr(s.value, initTypeEnv);
            stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), { let _s = ${val}; _s.to_json() });`);
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
          stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        }
      }
    }
  }
  const initMethod = '';

  // Capture — serialize actor state
  const captureFields = [...G.ctx.stateVarNames].map(n =>
    `m.insert("${n}".to_string(), self.state.get("${n}").cloned().unwrap_or(Value::Null));`,
  ).join(' ');
  const captureMethod = `    fn capture(&self) -> Value {
        let mut m = Map::new();
        ${captureFields}
        Value::Object(m)
    }

    fn hydrate(&mut self, state: &Value) {
${[...G.ctx.stateVarNames].map(n =>
  `        if let Some(v) = state.get("${n}") { self.state.insert("${n}".to_string(), v.clone()); }`,
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
    const getClauses = r.stateVars.map(v =>
      `                        "${v.name}" => (self.state.get("${r.prefix}_${v.name}").cloned().unwrap_or(Value::Null), Some("${v.typeName || 'Anything'}")),`,
    ).join('\n');
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
                            self.child_${r.prefix}_dispatch("set", &p);
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
            let val = self.state.get(name).cloned().unwrap_or(Value::Null);
            let bv_type: Option<&str> = match name {
${[...G.ctx.stateVarNames].map(n => {
  const decl = G.ctx.stateVarDecls.find(d => d.name === n);
  const t = decl?.typeName || 'Anything';
  return `                "${n}" => Some("${t}"),`;
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
            self.handle_op("set", &json!({}), &payload, "__test");
        } else if let Some(upd_val) = test.get("update") {
            let payload = if upd_val.is_array() { upd_val.clone() } else if upd_val.is_object() { upd_val.clone() } else { json!([upd_val]) };
            self.handle_op("update", &json!({}), &payload, "__test");
        } else if let Some(op) = test.get("op") {
            let (op_name, payload): (String, Value) = if let Some(s) = op.as_str() {
                (s.to_string(), json!({}))
            } else if let Some(arr) = op.as_array() {
                let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
                let p = if arr.len() > 1 { arr[0].clone() } else { json!({}) };
                (name, p)
            } else { return; };
            let (re, bva_re, handled) = self.handle_op(&op_name, &json!({}), &payload, "__test");
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
  const allNewVars = new Set([...G.ctx.remoteInstanceVars, ...G.ctx.constructsProxyVars]);
  const remoteNewChecks = [...allNewVars].map(name => {
    if (G.ctx.constructsProxyVars.has(name)) {
      // Constructs proxy: store address, init child, register remote route
      const cDecl = [...G.ctx.constructsMap.values()].find(c => {
        const initStmt = (actor.initBody || []).find(s => s.name === name);
        return initStmt && c.factory === initStmt.value?.callee?.name;
      });
      const proxyName = cDecl ? cDecl.proxyName : name;
      return `if let Some(pending_id) = self.state.get("_pending_new_${name}") {
                if message.get("id") == Some(pending_id) {
                    let addr = message.get("from").cloned().unwrap_or(Value::Null);
                    self.state.insert("${name}".to_string(), addr.clone());
                    self.state.remove("_pending_new_${name}");
                    self.child_${proxyName.toLowerCase()}_init(&json!([addr]));
                    if let Some(addr_str) = message.get("from").and_then(|v| v.as_str()) {
                        self.state.insert(format!("_remote_route_{}", addr_str), json!("${proxyName.toLowerCase()}"));
                    }
                    return;
                }
            }`;
    }
    return `if let Some(pending_id) = self.state.get("_pending_new_${name}") {
                if message.get("id") == Some(pending_id) {
                    self.state.insert("${name}".to_string(), message.get("from").cloned().unwrap_or(Value::Null));
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
  const receiveBody = `        if message.get("re").is_some() {
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
        ${G.ctx.constructsProxyVars.size > 0 ? `if let Some(from_addr) = message.get("from").and_then(|v| v.as_str()) {
            let route_key = format!("_remote_route_{}", from_addr);
            if let Some(child_name) = self.state.get(&route_key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
                let op_val = message.get("op").unwrap_or(&Value::Null);
                let (op_name, payload): (String, Value) = if let Some(s) = op_val.as_str() {
                    (s.to_string(), json!({}))
                } else if let Some(arr) = op_val.as_array() {
                    let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let p = if arr.len() > 1 { arr[0].clone() } else { json!({}) };
                    (name, p)
                } else {
                    ("".to_string(), json!({}))
                };
                self.child_dispatch(&child_name, &op_name, &payload);
                return;
            }
        }
        ` : ''}self.dispatch(message);`;

  // Handle op — shared match logic for dispatch and self_send
  const handleOpMethod = `    fn handle_op(&mut self, op_name: &str, message: &Value, payload: &Value, from: &str) -> (Option<Value>, Option<Value>, bool) {
        let _s = Structure::pack(payload);
        let _bva_msg = message.get("bv-a");
        let mut re: Option<Value> = None;
        let mut bva_re: Option<Value> = None;
        let mut handled = false;
        match op_name {
${matchArms}
        }
        (re, bva_re, handled)
    }

    fn call_fn(&mut self, fn_val: &Value, payload: &Value) -> Value {
        let fn_name = fn_val.as_str().unwrap_or("");
        self.self_send(fn_name, payload)
    }

    fn self_send(&mut self, op_name: &str, payload: &Value) -> Value {
        let empty_msg = json!({});
        let (re, _bva, _handled) = self.handle_op(op_name, &empty_msg, payload, "__self");
        re.unwrap_or(Value::Null)
    }`;

  // Dispatch body — calls handle_op, routes results
  const dispatchBlock = `        let result = catch_unwind(AssertUnwindSafe(|| {
            self.handle_op(op_name.as_str(), message, &payload, from)
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

  return `use serde_json::{json, Value, Map};
use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::panic::{catch_unwind, AssertUnwindSafe};
${matchTypesFn}${matchTypesPosFn}${listTypesOfFn}${structurePreamble}
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
${fnMethods}${childMethodsCode}${hasDotCallAwait ? `
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
        // Like await_response, but returns the \`from\` field — used for
        // \`new\` replies that supply the new instance address.
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
                            return msg.get("from").cloned().unwrap_or(Value::Null);
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
${stateInitLines.length > 0 ? stateInitLines.join('\n') + '\n' : ''}${hasDotCallAwait ? `    let mut buf = String::new();
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
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@'));
  const active = ast.actors.filter(a => a.functions.some(_isPublic) || a.functions.some(f => f.type === 'OnHandler'));
  if (active.length === 0) return '';
  G.ctx.actorInfo = new Map();
  G.ctx.actorFnNames = new Set();
  G.ctx.dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  // Build actorNodes map for supertype resolution
  G.ctx.actorNodes = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  // Include actors that inherit public functions from supertypes even if they have none of their own
  const activeNames = new Set(active.map(a => a.name).filter(Boolean));
  for (const a of ast.actors) {
    if (a.name && !activeNames.has(a.name) && (a.supertypes || []).length > 0) {
      const hasInheritedPublic = (function check(actor) {
        for (const st of (actor.supertypes || [])) {
          const sup = G.ctx.actorNodes.get(st.supertype);
          if (!sup) continue;
          if (sup.functions.some(f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@')))) return true;
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
  // Build constructs map: factory name → ConstructsDecl
  G.ctx.constructsMap = new Map();
  for (const c of (ast.constructsDecls || [])) {
    G.ctx.constructsMap.set(c.factory, c);
  }
  G.ctx.childCounter = 0;
  for (const a of active) {
    if (a.name) {
      G.ctx.actorInfo.set(a.name, { actor: a, asClauses: a.asClauses || [] });
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

  // Pre-merge supertype inheritance into actorInfo so main actor codegen sees merged params
  for (const a of active) {
    if (!a.name || !(a.supertypes?.length > 0)) continue;
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSupertypeChain(G.ctx, a);
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
