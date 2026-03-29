// handlers.js — Handler and child actor generation for Rust codegen
import {
  G, buildTypeEnv, inferLiteralType, rustIdent, rustType, convertFromValue,
  toJsonValue, forceJsonWrap, rsStore, stateKey, analyzeFunctions,
  findMutableVars, needsStructure, fnReturnsFunction, needsDotCallAwait,
} from './types.js';
import {
  genRustExpr, genRustFnCallExpr, genRustDestructure, genRustFnMethod,
  genRustFnReturn, genRustCondition,
} from './expressions.js';
import {
  genRustLocals, genRustReBody, genRustBvaBody, genRustIfStatement,
} from './statements.js';

function genRustPublicFn({ name, params, body: rawBody }, fns) {
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement promotion
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    const isSilentEmit = lastExpr.type === 'FunctionCallExpr' && lastExpr.callee?.type === 'Identifier' && G.ctx.emitNames.has(lastExpr.callee.name) && G.ctx.emitNames.get(lastExpr.callee.name).silent;
    if (!isSilentEmit) {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }
  const typeEnv = buildTypeEnv(params, body);
  // Merge state var types for function-typed state var detection
  for (const n of G.ctx.stateVarNames) {
    const decl = G.ctx.stateVarDecls?.find(d => d.name === n);
    if (decl?.typeName) typeEnv.set(n, decl.typeName);
  }
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const typedParams = params.filter(p => p.type && !p.rest && !isListOfAny(p.type));
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);
  let guard = '';
  if (positionalTyped.length > 0) {
    const posTypes = positionalTyped.map(p => `"${p.type}"`).join(', ');
    const namedTypes = namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ');
    guard = ` if from == "__self" || from == "__test" || match_types_positional(message, &[${posTypes}], &[${namedTypes}])`;
  } else if (namedTyped.length > 0) {
    guard = ` if from == "__self" || from == "__test" || match_types(message, &[${namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`;
  }

  const lines = [];

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, fns);
  if (locals) lines.push(locals);

  if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      const spreadField = reply.fields.find(f => f.spread);
      const spreadName = spreadField.name;
      lines.push(`                re = Some(${spreadName}.splat());`);
      // Passthrough bv-a from incoming message
      lines.push(`                if let Some(bva) = message.get("bv-a") {`);
      lines.push(`                    if let Some(arr) = bva.as_array() {`);
      lines.push(`                        if !arr.is_empty() {`);
      lines.push(`                            bva_re = Some(Structure::splat_bva(&arr[0]));`);
      lines.push(`                        }`);
      lines.push(`                    }`);
      lines.push(`                }`);
    } else {
      // Pre-compute function-typed param calls to avoid block expressions inside json!
      const isFnType = t => t && (t === 'Function' || (typeof t === 'string' && t.includes('->')));
      let precomputeIdx = 0;
      for (const f of reply.fields) {
        if (f.expr?.type === 'FunctionCallExpr' && f.expr.callee?.type === 'Identifier') {
          const calleeTy = typeEnv.get(f.expr.callee.name);
          if (isFnType(calleeTy)) {
            const tmpVar = `_fncall_${precomputeIdx++}`;
            const callExpr = genRustExpr(f.expr, typeEnv);
            lines.push(`                let ${tmpVar} = ${callExpr};`);
            f._precomputed = tmpVar;
          }
        }
      }
      lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
      const bva = genRustBvaBody(reply.fields, typeEnv, refNames);
      if (bva) {
        lines.push(`                bva_re = Some(${bva});`);
      }
    }
  } else if (implicitReturn) {
    const raw = genRustExpr(implicitReturn.expr, typeEnv);
    const needsTmp = implicitReturn.expr.type === 'FunctionCallExpr' || implicitReturn.expr.type === 'DotCallExpr';
    if (needsTmp) {
      lines.push(`                let _impl_ret = ${raw};`);
      lines.push(`                re = Some(json!([_impl_ret]));`);
    } else {
      lines.push(`                re = Some(json!([${forceJsonWrap(raw)}]));`);
    }
  }
  lines.push('                handled = true;');

  return `            "${name}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(publicFns, privateFns, preInitLambdas = []) {
  // Reset lambda state for this dispatch
  G.ctx.lambdaCounter = 0;
  G.ctx.lambdaHandlers = [];
  G.ctx.lambdaVarNames = new Set();

  // Pre-register init body lambdas so they get handler arms
  for (const pil of preInitLambdas) {
    G.ctx.lambdaHandlers.push({ name: pil.lambdaName, fn: pil.fn });
  }

  const allFns = [...publicFns, ...privateFns];
  const arms = allFns.map(h => genRustPublicFn(h, privateFns));

  // Add lambda handler arms (registered during call site codegen + pre-init)
  for (const lh of G.ctx.lambdaHandlers) {
    const { name, fn: fnNode, captures } = lh;
    const params = fnNode.params || [];
    const lambdaLines = [];

    // Load captured variables from actor state
    if (captures && captures.length > 0) {
      for (const cap of captures) {
        const capKey = `_cap_${cap.lambdaName}_${cap.name}`;
        lambdaLines.push(`                let ${rustIdent(cap.name)} = self.state.get("${capKey}").cloned().unwrap_or(Value::Null).as_i64().unwrap_or(0);`);
      }
    }

    // Destructure params from _s
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      const accessor = `_s.positional.get(${i}).cloned().unwrap_or(Value::Null)`;
      if (p.type) {
        lambdaLines.push(`                let ${rustIdent(p.name)}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      } else {
        lambdaLines.push(`                let ${rustIdent(p.name)} = ${accessor};`);
      }
    }

    // Generate body — use full body codegen for multi-statement lambdas
    const capTypeEnv = new Map([
      ...params.map(p => [p.name, p.type]),
      ...(captures || []).map(c => [c.name, 'Integer']),
    ]);
    if (fnNode.body && fnNode.body.length > 0) {
      const reply = fnNode.body.find(s => s.type === 'Reply');
      const mutableVars = findMutableVars(fnNode.body);
      const functionAnalysis = analyzeFunctions(fnNode.body, mutableVars, capTypeEnv);
      const locals = genRustLocals(fnNode.body, capTypeEnv, functionAnalysis, mutableVars, '                ', privateFns);
      if (locals) lambdaLines.push(locals);
      if (reply) {
        const refNames = new Set();
        lambdaLines.push(`                re = Some(${genRustReBody(reply.fields, capTypeEnv, refNames)});`);
        const bva = genRustBvaBody(reply.fields, capTypeEnv, refNames);
        if (bva) lambdaLines.push(`                bva_re = Some(${bva});`);
      } else {
        // Implicit return — last expression in body
        const implRet = fnNode.body.find(s => s.type === 'ImplicitReturn');
        if (implRet) {
          const retType = fnNode.returnType;
          const raw = genRustExpr(implRet.expr, capTypeEnv);
          const val = retType ? toJsonValue(raw, retType) : `json!(${raw})`;
          lambdaLines.push(`                re = Some(json!([${forceJsonWrap(val)}]));`);
        }
      }
    } else if (fnNode.expr) {
      const retType = fnNode.returnType;
      const raw = genRustExpr(fnNode.expr, capTypeEnv);
      const val = retType ? toJsonValue(raw, retType) : `json!(${raw})`;
      lambdaLines.push(`                re = Some(json!([${forceJsonWrap(val)}]));`);
    }
    lambdaLines.push('                handled = true;');

    arms.push(`            "${name}" => {\n${lambdaLines.join('\n')}\n            }`);
  }

  arms.push('            _ => {}');
  return arms.join('\n');
}

function genRustChildPublicFn(fn) {
  const { name, params, body } = fn;
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const lines = [];
  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars);
  if (locals) lines.push(locals);

  if (reply) {
    lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
  }

  return `            "${name}" => {\n${lines.join('\n')}\n            }`;
}

function genRustChildDispatch(actor) {
  const publicFns = actor.functions.filter(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::')));
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  const name = actor.name.toLowerCase();
  const arms = publicFns.map(h => genRustChildPublicFn(h));
  // Add on-handler arms
  for (const h of onHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body);
    const I = '                ';
    const hLines = [];
    if (h.params.length > 0) {
      hLines.push(`${I}let _s = Structure::pack(payload);`);
      for (const p of h.params) {
        const accessor = p.positional
          ? `_s.positional.get(0).cloned().unwrap_or(Value::Null)`
          : `_s.named.get("${p.name}").cloned().unwrap_or(Value::Null)`;
        if (p.type) {
          hLines.push(`${I}let ${rustIdent(p.name)}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
        } else {
          hLines.push(`${I}let ${rustIdent(p.name)} = ${accessor};`);
        }
      }
    }
    const mutableVars = findMutableVars(h.body);
    const funcAnalysis = analyzeFunctions(h.body, mutableVars, typeEnv);
    const locals = genRustLocals(h.body, typeEnv, funcAnalysis, mutableVars, I, []);
    if (locals) hLines.push(locals);
    // Check if on-handler has a reply (emit-with-return-value)
    const hReply = h.body.find(s => s.type === 'Reply');
    if (hReply) {
      const refNames = new Set();
      hLines.push(`${I}re = Some(${genRustReBody(hReply.fields, typeEnv, refNames)});`);
    } else {
      hLines.push(`${I}// on-handler — silent`);
    }
    arms.push(`            "${h.eventName}" => {\n${hLines.join('\n')}\n            }`);
  }
  arms.push('            _ => {}');
  const hasParams = publicFns.some(h => h.params.length > 0) || onHandlers.some(h => h.params.length > 0);

  return `
    fn child_${name}_dispatch(&mut self, op: &str, ${hasParams ? 'payload' : '_payload'}: &Value) -> Value {
        let mut re: Option<Value> = None;
        match op {
${arms.join('\n')}
        }
        re.unwrap_or(Value::Null)
    }`;
}

function genRustChildInit(actor) {
  const constructorParams = actor.initParams || [];
  const initBody = actor.initBody || [];
  if (constructorParams.length === 0 && initBody.length === 0) return '';

  const name = actor.name.toLowerCase();
  const lines = [];

  // Destructure constructor params from args
  for (let i = 0; i < constructorParams.length; i++) {
    const p = constructorParams[i];
    const accessor = `args.as_array().and_then(|a| a.get(${i})).cloned().unwrap_or(Value::Null)`;
    lines.push(`        let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
  }

  // Store constructor params as state (unprefixed — parent code reads these too)
  for (const p of constructorParams) {
    lines.push(`        self.state.insert("${p.name}".to_string(), json!(${p.name}));`);
  }

  // Constructor body statements
  const initTypeEnv = new Map();
  for (const d of actor.stateVarDecls || []) {
    initTypeEnv.set(d.name, d.typeName);
  }
  for (const p of constructorParams) {
    initTypeEnv.set(p.name, p.type);
  }
  for (const s of initBody) {
    if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, initTypeEnv);
      const t = initTypeEnv.get(s.name);
      lines.push(`        self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    }
  }

  return `
    fn child_${name}_init(&mut self, args: &Value) {
${lines.join('\n')}
    }`;
}

function genRustChildMethods(allActors) {
  const childActors = allActors.filter(a => a.name && G.ctx.actorInfo.has(a.name));
  if (childActors.length === 0) return '';
  const savedStateVarNames = G.ctx.stateVarNames;
  let savedDecls = G.ctx.stateVarDecls;
  const savedRemoteInstanceVars = G.ctx.remoteInstanceVars;
  const savedChildStatePrefix = G.ctx.childStatePrefix;
  const parts = [];
  for (const actor of childActors) {
    // Set state var names for this child actor
    const childStateDecls = actor.stateVarDecls || [];
    const childParams = actor.initParams || [];
    G.ctx.stateVarNames = new Set([
      ...childStateDecls.map(v => v.name),
      ...childParams.map(p => p.name),
    ]);
    savedDecls = G.ctx.stateVarDecls;
    G.ctx.stateVarDecls = [...childStateDecls, ...childParams.map(p => ({ name: p.name, typeName: p.type || 'Anything' }))];
    G.ctx.childStatePrefix = actor.name.toLowerCase();
    G.ctx.childConstructorParams = new Set(childParams.map(p => p.name));
    // For constructs proxy children, bare params (type Anything) are remote instance refs
    G.ctx.remoteInstanceVars = new Set();
    const isConstructsProxy = [...G.ctx.constructsMap.values()].some(c => c.proxyName === actor.name);
    if (isConstructsProxy) {
      for (const p of childParams) {
        if (p.type === 'Anything') G.ctx.remoteInstanceVars.add(p.name);
      }
    }
    const init = genRustChildInit(actor);
    if (init) parts.push(init);
    parts.push(genRustChildDispatch(actor));
  }
  G.ctx.stateVarNames = savedStateVarNames;
  G.ctx.remoteInstanceVars = savedRemoteInstanceVars;
  G.ctx.stateVarDecls = savedDecls;
  G.ctx.childStatePrefix = savedChildStatePrefix;

  // Generate child_dispatch routing method
  if (childActors.length > 0) {
    const arms = childActors.map(a => {
      const name = a.name.toLowerCase();
      return `            "${name}" => self.child_${name}_dispatch(op_name, payload),`;
    }).join('\n');
    parts.push(`
    fn child_dispatch(&mut self, child_name: &str, op_name: &str, payload: &Value) -> Value {
        match child_name {
${arms}
            _ => Value::Null,
        }
    }`);
  }

  // Generate emit methods — each emit declaration gets a method that dispatches to subscribers
  // In Rust, subscriptions are known at compile time from on-handlers
  const allEmitDecls = new Map();
  for (const a of childActors) {
    for (const s of (a.constructorBody || [])) {
      if (s.type === 'EmitDecl') allEmitDecls.set(s.name, { decl: s, actor: a });
    }
  }
  for (const [eventName, { decl, actor: emitActor }] of allEmitDecls) {
    // Find all on-handlers that subscribe to this emit
    const subscribers = [];
    for (const a of childActors) {
      for (const f of a.functions.filter(f => f.type === 'OnHandler' && f.eventName === eventName)) {
        subscribers.push({ handler: f, actor: a });
      }
    }
    if (subscribers.length > 0) {
      if (decl.silent) {
        const dispatchLines = subscribers.map(({ actor: subActor }) => {
          const name = subActor.name.toLowerCase();
          return `        self.child_${name}_dispatch("${eventName}", payload);`;
        }).join('\n');
        parts.push(`
    fn emit_${eventName}(&mut self, payload: &Value) -> Value {
${dispatchLines}
        Value::Null
    }`);
      } else {
        // Non-silent emit: return the first subscriber's result
        const firstSub = subscribers[0];
        const name = firstSub.actor.name.toLowerCase();
        parts.push(`
    fn emit_${eventName}(&mut self, payload: &Value) -> Value {
        self.child_${name}_dispatch("${eventName}", payload)
    }`);
      }
    } else {
      parts.push(`
    fn emit_${eventName}(&mut self, _payload: &Value) -> Value {
        Value::Null
    }`);
    }
  }

  return parts.join('\n');
}

export { genRustPublicFn, genRustDispatch, genRustChildPublicFn, genRustChildDispatch, genRustChildInit, genRustChildMethods };
