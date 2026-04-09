// handlers.js — Handler and child actor generation for Rust codegen
import {
  G, buildTypeEnv, inferLiteralType, rustIdent, rustSsaResolve, rustType, convertFromValue,
  toJsonValue, forceJsonWrap, stateKey, analyzeFunctions,
  findMutableVars,
} from './types.js';
import {
  genRustExpr, genRustDestructure, genRustDefaultValue,
} from './expressions.js';
import {
  genRustLocals, genRustReBody, genRustBvaBody,
} from './statements.js';

function genRustPublicFn({ name, params, body: rawBody, actorDef, emptyOverload }, fns, { hasOverloads = false } = {}) {
  // Skip actorDef constructor clauses — dispatched via actor instantiation
  if (actorDef) return null;
  // Skip empty Function() initializers — no dispatch arm
  if (emptyOverload) return null;

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
  // Build arity guard for overloaded functions
  if (hasOverloads && params.length > 0) {
    const posParams = params.filter(p => p.positional && !p.rest);
    const posCount = posParams.length;
    const requiredPosCount = posParams.filter(p => !p.defaultValue).length;
    const namedParams = params.filter(p => !p.positional && !p.rest);
    const namedKeys = namedParams.filter(p => !p.defaultValue).map(p => p.key || p.name);
    const totalNamedCount = namedParams.length;
    const checks = [];
    if (posCount > 0) {
      if (requiredPosCount === posCount) {
        checks.push(`_s.positional.len() == ${posCount}`);
      } else {
        checks.push(`_s.positional.len() >= ${requiredPosCount} && _s.positional.len() <= ${posCount}`);
      }
    }
    for (const k of namedKeys) checks.push(`_s.named.contains_key("${k}")`);
    if (namedParams.length > 0) checks.push(`_s.named.len() <= ${totalNamedCount}`);
    // Type check for external callers
    const requiredPosTypedCount = positionalTyped.filter(p => !p.defaultValue).length;
    const hasOptionalTyped = requiredPosTypedCount < positionalTyped.length;
    if (positionalTyped.length > 0) {
      const posTypes = positionalTyped.map(p => `"${p.type}"`).join(', ');
      const namedTypes = namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ');
      const typeCheck = hasOptionalTyped
        ? `match_types_positional_min(message, &[${posTypes}], &[${namedTypes}], ${requiredPosTypedCount})`
        : `match_types_positional(message, &[${posTypes}], &[${namedTypes}])`;
      guard = ` if ${checks.join(' && ')} && (from == "__self" || from == "__test" || ${typeCheck})`;
    } else if (namedTyped.length > 0) {
      const requiredNamedTyped = namedTyped.filter(p => !p.defaultValue);
      const typeCheck = `match_types(message, &[${requiredNamedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`;
      guard = ` if ${checks.join(' && ')} && (from == "__self" || from == "__test" || ${typeCheck})`;
    } else if (checks.length > 0) {
      guard = ` if ${checks.join(' && ')}`;
    }
  } else if (positionalTyped.length > 0) {
    const requiredPosTypedCount = positionalTyped.filter(p => !p.defaultValue).length;
    const hasOptionalTyped = requiredPosTypedCount < positionalTyped.length;
    const posTypes = positionalTyped.map(p => `"${p.type}"`).join(', ');
    const namedTypes = namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ');
    if (hasOptionalTyped) {
      guard = ` if from == "__self" || from == "__test" || match_types_positional_min(message, &[${posTypes}], &[${namedTypes}], ${requiredPosTypedCount})`;
    } else {
      guard = ` if from == "__self" || from == "__test" || match_types_positional(message, &[${posTypes}], &[${namedTypes}])`;
    }
  } else if (namedTyped.length > 0) {
    const requiredNamedTyped = namedTyped.filter(p => !p.defaultValue);
    guard = ` if from == "__self" || from == "__test" || match_types(message, &[${requiredNamedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`;
  }

  const lines = [];

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, fns);
  if (locals) lines.push(locals);

  if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      const spreadField = reply.fields.find(f => f.spread);
      const spreadName = rustSsaResolve(spreadField.name);
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
      // Pre-compute function-typed param calls and DotCallExpr to avoid block expressions inside json!
      const isFnType = t => t && (t === 'Function' || (typeof t === 'string' && t.includes('->')));
      let precomputeIdx = 0;

      // Recursively walk expression tree to pre-compute local function calls and actor fn calls
      // that produce block expressions incompatible with json! macro
      const precomputeExprCalls = (expr, expectedType) => {
        if (!expr) return;
        if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier') {
          const calleeName = expr.callee.name;
          // Local function definition (e.g. #value = { "ten" }) — inline body
          const localFn = functionAnalysis.fnDefs.get(calleeName);
          if (localFn && !G.ctx.actorFnNames.has(calleeName)) {
            const fnNode = localFn.node;
            const fnBody = fnNode.body || [];
            const fnReply = fnBody.find(s => s.type === 'Reply');
            let implRet = fnBody.find(s => s.type === 'ImplicitReturn');
            if (!implRet && !fnReply && fnBody.length > 0 && fnBody[fnBody.length - 1].type === 'ExprStatement') {
              implRet = { expr: fnBody[fnBody.length - 1].expr };
            }
            if (implRet) {
              const tmpVar = `_pvfn_${precomputeIdx++}`;
              const val = genRustExpr(implRet.expr, typeEnv);
              const t = implRet.expr.type === 'StringLiteral' ? 'Text' : null;
              lines.push(`                let ${tmpVar} = ${t === 'Text' ? val + '.to_string()' : val};`);
              expr._precomputed = tmpVar;
            } else if (fnReply) {
              // Private function with explicit reply — dispatch through self_send
              const tmpVar = `_pvfn_${precomputeIdx++}`;
              const callExpr = `self.self_send("${calleeName}", &Value::Object(Map::new()))`;
              lines.push(`                let ${tmpVar} = Structure::pack(&${callExpr}).one();`);
              expr._precomputed = tmpVar;
            }
            return;
          }
          // Actor-level function call — pre-compute to avoid block in json!
          if (G.ctx.actorFnNames.has(calleeName)) {
            const tmpVar = `_pvfn_${precomputeIdx++}`;
            const callExpr = genRustExpr(expr, typeEnv);
            // Convert Value to scalar type for use in binary expressions
            const convert = expectedType === 'Integer' ? `${callExpr}.as_i64().unwrap_or(0)` :
                            expectedType === 'Text' ? `${callExpr}.as_str().unwrap_or("").to_string()` :
                            (expectedType === 'Float' || expectedType === 'Decimal') ? `${callExpr}.as_f64().unwrap_or(0.0)` :
                            callExpr;
            lines.push(`                let ${tmpVar} = ${convert};`);
            expr._precomputed = tmpVar;
            return;
          }
        }
        // Walk children
        if (expr.type === 'BinaryExpr') {
          precomputeExprCalls(expr.left, expectedType);
          precomputeExprCalls(expr.right, expectedType);
        }
        if (expr.args) expr.args.forEach(a => precomputeExprCalls(a.expr || a, expectedType));
      };

      for (const f of reply.fields) {
        // Walk the full expression tree for each field (named fields use f.value, positional use f.expr)
        const fieldExpr = f.expr || f.value;
        if (fieldExpr) precomputeExprCalls(fieldExpr, f.type);
        if (fieldExpr?.type === 'FunctionCallExpr' && fieldExpr.callee?.type === 'Identifier') {
          const calleeTy = typeEnv.get(fieldExpr.callee.name);
          if (isFnType(calleeTy) && !fieldExpr._precomputed) {
            const tmpVar = `_fncall_${precomputeIdx++}`;
            const callExpr = genRustExpr(fieldExpr, typeEnv);
            lines.push(`                let ${tmpVar} = ${callExpr};`);
            f._precomputed = tmpVar;
          }
        }
        // DotCallExpr on uses/remote targets produce multi-line blocks — hoist them out
        if (fieldExpr?.type === 'DotCallExpr') {
          const tmpVar = `_fncall_${precomputeIdx++}`;
          const callExpr = genRustExpr(fieldExpr, typeEnv);
          lines.push(`                let ${tmpVar} = ${callExpr};`);
          f._precomputed = tmpVar;
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
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  return `            "${name}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(publicFns, privateFns, preInitLambdas = [], constructorParams = []) {
  // Reset lambda state for this dispatch
  G.ctx.lambdaCounter = 0;
  G.ctx.lambdaHandlers = [];
  G.ctx.lambdaVarNames = new Set();

  // Pre-register init body lambdas so they get handler arms
  for (const pil of preInitLambdas) {
    G.ctx.lambdaHandlers.push({ name: pil.lambdaName, fn: pil.fn });
  }

  const allFns = [...publicFns, ...privateFns].filter(h => !h.actorDef && !h.emptyOverload);

  // Group functions by name to detect overloads
  const grouped = new Map();
  for (const h of allFns) {
    if (!grouped.has(h.name)) grouped.set(h.name, []);
    grouped.get(h.name).push(h);
  }

  const arms = [];
  for (const [, variants] of grouped) {
    const hasOverloads = variants.length > 1;
    for (const h of variants) {
      const arm = genRustPublicFn(h, privateFns, { hasOverloads });
      if (arm) arms.push(arm);
    }
  }

  // Add lambda handler arms (registered during call site codegen + pre-init)
  // Use index loop since nested lambdas may add new handlers during iteration
  const lambdaEntries = [];
  for (let li = 0; li < G.ctx.lambdaHandlers.length; li++) {
    const lh = G.ctx.lambdaHandlers[li];
    if (lh.fn.emptyOverload) continue;
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
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `_s.positional.get(${i}).cloned().unwrap_or(${dv})`;
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
      const savedSsaScope = G.ctx.ssaScope;
      const savedSsaCounts = G.ctx.ssaCounts;
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
      G.ctx.ssaScope = savedSsaScope;
      G.ctx.ssaCounts = savedSsaCounts;
    } else if (fnNode.expr) {
      const retType = fnNode.returnType;
      const raw = genRustExpr(fnNode.expr, capTypeEnv);
      const val = retType ? toJsonValue(raw, retType) : `json!(${raw})`;
      lambdaLines.push(`                re = Some(json!([${forceJsonWrap(val)}]));`);
    }
    lambdaLines.push('                handled = true;');

    lambdaEntries.push({ name, inner: lambdaLines.join('\n'), params });
  }

  // Group lambda entries by name for arity-based dispatch
  const lambdasByName = new Map();
  for (const entry of lambdaEntries) {
    if (!lambdasByName.has(entry.name)) lambdasByName.set(entry.name, []);
    lambdasByName.get(entry.name).push(entry);
  }
  for (const [lName, handlers] of lambdasByName) {
    if (handlers.length === 1) {
      arms.push(`            "${lName}" => {\n${handlers[0].inner}\n            }`);
    } else {
      // Multiple handlers with same label — arity-based dispatch
      for (const h of handlers) {
        const posParams = h.params.filter(p => p.positional !== false);
        const posCount = posParams.length;
        const requiredPosCount = posParams.filter(p => !p.defaultValue).length;
        if (requiredPosCount === posCount) {
          arms.push(`            "${lName}" if _s.positional.len() == ${posCount} => {\n${h.inner}\n            }`);
        } else {
          arms.push(`            "${lName}" if _s.positional.len() >= ${requiredPosCount} && _s.positional.len() <= ${posCount} => {\n${h.inner}\n            }`);
        }
      }
    }
  }

  // Auto-generate accessor arms for constructor params
  for (const p of constructorParams) {
    if (p.suppressAccessor) continue;
    if (p.key && !p.accessor) continue;
    const accessorName = p.accessor || p.name;
    const sk = stateKey(p.name);
    arms.push(`            "@${accessorName}" => {\n                re = Some(json!({"${accessorName}": self.state.get("${sk}").cloned().unwrap_or(Value::Null)}));\n                handled = true;\n            }`);
  }

  arms.push('            _ => {}');
  return arms.join('\n');
}

function genRustChildPublicFn(fn) {
  const { name, params, body: rawBody } = fn;
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    implicitReturn = { type: 'ImplicitReturn', expr: rawBody[rawBody.length - 1].expr, typeName: null };
    body = rawBody.slice(0, -1);
  }
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const lines = [];
  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);
  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars);
  if (locals) lines.push(locals);

  if (reply) {
    // Pre-compute reply field expressions that contain function calls producing block expressions
    let precomputeIdx = 0;
    const exprNeedsPrecompute = (expr) => {
      if (!expr) return false;
      if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier') {
        const calleeName = expr.callee.name;
        if (G.ctx.actorFnNames.has(calleeName)) return true;
        if (functionAnalysis.fnDefs.has(calleeName)) return true;
      }
      if (expr.type === 'BinaryExpr') return exprNeedsPrecompute(expr.left) || exprNeedsPrecompute(expr.right);
      if (expr.type === 'DotCallExpr') return true;
      return false;
    };

    // Pre-compute individual function calls, converting Values to scalar types
    const precomputeFnCalls = (expr, expectedType) => {
      if (!expr) return;
      if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier') {
        const calleeName = expr.callee.name;
        const localFn = functionAnalysis.fnDefs.get(calleeName);
        if (localFn && !G.ctx.actorFnNames.has(calleeName)) {
          const fnNode = localFn.node;
          const fnBody = fnNode.body || [];
          let implRet = fnBody.find(s => s.type === 'ImplicitReturn');
          if (!implRet && fnBody.length > 0 && fnBody[fnBody.length - 1].type === 'ExprStatement') {
            implRet = { expr: fnBody[fnBody.length - 1].expr };
          }
          if (implRet) {
            const tmpVar = `_pvfn_${precomputeIdx++}`;
            const val = genRustExpr(implRet.expr, typeEnv);
            const t = implRet.expr.type === 'StringLiteral' ? 'Text' : null;
            lines.push(`                let ${tmpVar} = ${t === 'Text' ? val + '.to_string()' : val};`);
            expr._precomputed = tmpVar;
          }
          return;
        }
        if (G.ctx.actorFnNames.has(calleeName)) {
          const tmpVar = `_pvfn_${precomputeIdx++}`;
          const callExpr = genRustExpr(expr, typeEnv);
          const convert = expectedType === 'Integer' ? `${callExpr}.as_i64().unwrap_or(0)` :
                          expectedType === 'Text' ? `${callExpr}.as_str().unwrap_or("").to_string()` :
                          (expectedType === 'Float' || expectedType === 'Decimal') ? `${callExpr}.as_f64().unwrap_or(0.0)` :
                          callExpr;
          lines.push(`                let ${tmpVar} = ${convert};`);
          expr._precomputed = tmpVar;
          return;
        }
      }
      if (expr.type === 'BinaryExpr') {
        precomputeFnCalls(expr.left, expectedType);
        precomputeFnCalls(expr.right, expectedType);
      }
      if (expr.args) expr.args.forEach(a => precomputeFnCalls(a.expr || a, expectedType));
    };

    for (const f of reply.fields) {
      const fieldExpr = f.expr || f.value;
      if (!fieldExpr) continue;
      if (exprNeedsPrecompute(fieldExpr)) {
        precomputeFnCalls(fieldExpr, f.type);
      }
    }

    lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
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
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  return `            "${name}" => {\n${lines.join('\n')}\n            }`;
}

function genRustChildDispatch(actor) {
  const _isPublicFn = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const publicFns = actor.functions.filter(f => _isPublicFn(f));
  const privateFns = actor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !_isPublicFn(f));
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  const name = actor.name.toLowerCase();
  const arms = [...publicFns, ...privateFns].map(h => genRustChildPublicFn(h));
  // Add on-handler arms
  for (const h of onHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body);
    const I = '                ';
    const hLines = [];
    if (h.params.length > 0) {
      hLines.push(`${I}let _s = Structure::pack(payload);`);
      for (const p of h.params) {
        const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
        const accessor = p.positional
          ? `_s.positional.get(0).cloned().unwrap_or(${dv})`
          : `_s.named.get("${p.name}").cloned().unwrap_or(${dv})`;
        if (p.type) {
          hLines.push(`${I}let ${rustIdent(p.name)}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
        } else {
          hLines.push(`${I}let ${rustIdent(p.name)} = ${accessor};`);
        }
      }
    }
    const mutableVars = findMutableVars(h.body);
    const funcAnalysis = analyzeFunctions(h.body, mutableVars, typeEnv);
    const savedSsaScope = G.ctx.ssaScope;
    const savedSsaCounts = G.ctx.ssaCounts;
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
    G.ctx.ssaScope = savedSsaScope;
    G.ctx.ssaCounts = savedSsaCounts;
    arms.push(`            "${h.eventName}" => {\n${hLines.join('\n')}\n            }`);
  }
  // Auto-generate accessor arms for child constructor params
  const childConstructorParams = actor.initParams || [];
  for (const p of childConstructorParams) {
    if (p.suppressAccessor) continue;
    if (p.key && !p.accessor) continue;
    const accessorName = p.accessor || p.name;
    const sk = stateKey(p.name);
    arms.push(`            "@${accessorName}" => {\n                re = Some(json!({"${accessorName}": self.state.get("${sk}").cloned().unwrap_or(Value::Null)}));\n            }`);
  }
  // Generate delegation arms for inherited functions from wrapped supertypes
  const delegatedFunctions = actor._delegatedFunctions || [];
  const supertypeBindings = actor._supertypeBindings || [];
  for (const f of delegatedFunctions) {
    const wb = supertypeBindings[0]; // Use the first (primary) wrapped binding
    if (wb) {
      arms.push(`            "${f.name}" => {\n                re = Some(self.child_dispatch("${wb.supertype.toLowerCase()}", "${f.name}", payload));\n            }`);
    }
  }

  arms.push('            _ => {}');
  const hasParams = publicFns.some(h => h.params.length > 0) || onHandlers.some(h => h.params.length > 0) || delegatedFunctions.length > 0;

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
  const supertypeBindings = actor._supertypeBindings || [];
  const inheritedIngests = actor._inheritedIngests || [];
  if (constructorParams.length === 0 && initBody.length === 0 && supertypeBindings.length === 0 && inheritedIngests.length === 0) return '';

  const name = actor.name.toLowerCase();
  const lines = [];

  // Destructure constructor params from args (sequential index — call sites flatten args in param order)
  for (let i = 0; i < constructorParams.length; i++) {
    const p = constructorParams[i];
    const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
    // For optional params, treat null as "not provided" → use default
    const accessor = p.defaultValue
      ? `args.as_array().and_then(|a| a.get(${i})).and_then(|v| if v.is_null() { None } else { Some(v.clone()) }).unwrap_or(${dv})`
      : `args.as_array().and_then(|a| a.get(${i})).cloned().unwrap_or(${dv})`;
    lines.push(`        let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
  }

  // Store constructor params as state (unprefixed — parent code reads these too)
  for (const p of constructorParams) {
    lines.push(`        self.state.insert("${p.name}".to_string(), json!(${p.name}));`);
  }

  // Constructor body statements — split around IngestExpr
  const initTypeEnv = new Map();
  for (const d of actor.stateVarDecls || []) {
    initTypeEnv.set(d.name, d.typeName);
  }
  for (const p of constructorParams) {
    initTypeEnv.set(p.name, p.type);
  }

  let ownIngestInfo = null;
  const preIngestBody = [];
  const postIngestBody = [];
  let pastIngest = false;
  for (const s of initBody) {
    if (s.value?.type === 'IngestExpr') {
      ownIngestInfo = { name: s.name, defaultValue: s.value.defaultValue };
      pastIngest = true;
      continue;
    }
    (pastIngest ? postIngestBody : preIngestBody).push(s);
  }

  // Pre-ingest body statements
  for (const s of preIngestBody) {
    if (s.type === 'StateAssign') {
      if (s.value?.type === 'FunctionCallExpr' && G.ctx.actorInfo.has(s.value.callee?.name)) {
        const childName = s.value.callee.name.toLowerCase();
        const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
        const argsJson = positionalArgs.length > 0
          ? `json!([${positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, initTypeEnv), inferLiteralType(a)))).join(', ')}])`
          : 'json!([])';
        lines.push(`        self.child_${childName}_init(&${argsJson});`);
      } else {
        const val = genRustExpr(s.value, initTypeEnv);
        const t = initTypeEnv.get(s.name);
        lines.push(`        self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    }
  }

  // Handle ingest value assignment
  if (ownIngestInfo) {
    if (ownIngestInfo.defaultValue) {
      const val = genRustExpr(ownIngestInfo.defaultValue, initTypeEnv);
      const t = initTypeEnv.get(ownIngestInfo.name);
      lines.push(`        self.state.insert("${stateKey(ownIngestInfo.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else {
      lines.push(`        self.state.insert("${stateKey(ownIngestInfo.name)}".to_string(), Value::Null);`);
    }
    // Post-ingest body statements
    for (const s of postIngestBody) {
      if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, initTypeEnv);
        const t = initTypeEnv.get(s.name);
        lines.push(`        self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    }
  } else if (inheritedIngests.length > 0 && actor.declarationReturn) {
    // Subtype provides a value for its supertype's ingest — assign directly to the inherited state var
    const ingest = inheritedIngests[0];
    const val = genRustExpr(actor.declarationReturn.expr, initTypeEnv);
    const t = ingest.typeName;
    lines.push(`        self.state.insert("${stateKey(ingest.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
  } else if (inheritedIngests.length > 0) {
    // Subtype doesn't provide a return — use supertype's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        const val = genRustExpr(ingest.defaultValue, initTypeEnv);
        lines.push(`        self.state.insert("${stateKey(ingest.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, ingest.typeName))});`);
      }
    }
  }

  // Service coercion aliases — copy ref state to alias
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion') {
      const refName = s.ref?.name || s.ref;
      lines.push(`        self.state.insert("${s.name}".to_string(), self.state.get("${refName}").cloned().unwrap_or(Value::Null));`);
    }
  }

  // Auto-create wrapped supertype instances
  for (const wb of supertypeBindings) {
    const superActor = G.ctx.actorNodes?.get(wb.supertype);
    if (superActor) {
      const mergedSuper = G.ctx.actorInfo.get(wb.supertype)?.actor || superActor;
      const superParams = mergedSuper.initParams || [];
      const superInitBody = mergedSuper.initBody || [];
      const superHasOnHandlers = mergedSuper.functions.some(f => f.type === 'OnHandler');
      const superHasBindings = (mergedSuper._supertypeBindings || []).length > 0;
      const needsInit = superParams.length > 0 || superInitBody.length > 0 || superHasOnHandlers || superHasBindings;
      if (needsInit) {
        if (superParams.length > 0) {
          const args = superParams.map(p => `json!(${p.name})`).join(', ');
          lines.push(`        self.child_${wb.supertype.toLowerCase()}_init(&json!([${args}]));`);
        } else {
          lines.push(`        self.child_${wb.supertype.toLowerCase()}_init(&json!([]));`);
        }
      }
      // Store the wrapped binding name as a reference to the supertype's child dispatch name
      lines.push(`        self.state.insert("${wb.name}".to_string(), json!("${wb.supertype.toLowerCase()}"));`);
    }
  }

  return `
    fn child_${name}_init(&mut self, args: &Value) {
${lines.join('\n')}
    }`;
}

// Deep-clone an AST node, stripping any codegen-internal _precomputed annotations
function deepCloneAst(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => key === '_precomputed' ? undefined : value));
}

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

function genRustChildMethods(allActors) {
  const childActors = allActors.filter(a => a.name && G.ctx.actorInfo.has(a.name));
  if (childActors.length === 0) return '';
  const savedStateVarNames = G.ctx.stateVarNames;
  let savedDecls = G.ctx.stateVarDecls;
  const savedRemoteInstanceVars = G.ctx.remoteInstanceVars;
  const savedChildStatePrefix = G.ctx.childStatePrefix;
  const parts = [];
  for (const actor of childActors) {
    // ── Resolve supertype inheritance ──────────────────────────────────
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSupertypeChain(G.ctx, actor);

    // Merge inherited params (prepend) — skip any that the subtype redefines
    const ownParamNames = new Set((actor.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(actor.initParams || []),
    ];

    // Merge inherited functions — subtype's own functions take precedence
    const ownFnNames = new Set(actor.functions.map(f => f.name));
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
    const mergedFunctions = [
      ...actor.functions,
      ...inlinedInherited.map(f => deepCloneAst(f)),
    ];

    // Build wrapped supertype bindings list
    const supertypeBindings = [];
    for (const wb of wrappedBindings) {
      const superActor = G.ctx.actorNodes?.get(wb.supertype);
      if (superActor) supertypeBindings.push(wb);
    }

    const mergedActor = {
      ...actor,
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

    // Update actorInfo so statement codegen sees merged params when generating init calls
    const savedActorInfo = G.ctx.actorInfo.get(actor.name);
    G.ctx.actorInfo.set(actor.name, { ...savedActorInfo, actor: mergedActor });

    // Set state var names for this child actor
    const childStateDecls = mergedActor.stateVarDecls || [];
    const childParams = mergedActor.initParams || [];
    const childCoercions = (mergedActor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
    G.ctx.stateVarNames = new Set([
      ...childStateDecls.map(v => v.name),
      ...childParams.map(p => p.name),
      ...childCoercions.map(s => s.name),
      ...supertypeBindings.map(wb => wb.name),
    ]);
    savedDecls = G.ctx.stateVarDecls;
    G.ctx.stateVarDecls = [
      ...childStateDecls,
      ...childParams.map(p => ({ name: p.name, typeName: p.type || 'Anything' })),
      ...childCoercions.map(s => ({ name: s.name, typeName: 'Anything' })),
      ...supertypeBindings.map(wb => ({ name: wb.name, typeName: 'Anything' })),
    ];
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

    // Add merged non-public function names to actorFnNames so expression codegen routes through self_send
    const savedActorFnNames = new Set(G.ctx.actorFnNames);
    const allChildPrivateFns = mergedActor.functions.filter(f => f.name && !f.name.startsWith('@') && !f.name.startsWith('::'));
    for (const f of allChildPrivateFns) {
      G.ctx.actorFnNames.add(f.name);
    }

    const init = genRustChildInit(mergedActor);
    if (init) parts.push(init);
    // Set child self-send prefix so private function calls route through child dispatch
    const childPrivFns = mergedActor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !f.name.startsWith('@') && !f.name.startsWith('::'));
    if (childPrivFns.length > 0) {
      G.ctx.childSelfSendPrefix = actor.name.toLowerCase();
    }
    parts.push(genRustChildDispatch(mergedActor));
    G.ctx.childSelfSendPrefix = null;

    // Restore actorFnNames
    G.ctx.actorFnNames = savedActorFnNames;
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
  for (const [eventName, { decl }] of allEmitDecls) {
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

export { genRustPublicFn, genRustDispatch, genRustChildPublicFn, genRustChildDispatch, genRustChildInit, genRustChildMethods, resolveSupertypeChain };
