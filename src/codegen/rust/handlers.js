// handlers.js — Handler and child actor generation for Rust codegen
import {
  G, buildTypeEnv, inferLiteralType, rustIdent, rustSsaResolve, rustType, convertFromValue,
  toJsonValue, forceJsonWrap, stateKey, analyzeFunctions,
  findMutableVars, classNeedsSpawnedInstances,
} from './types.js';
import { intFromValue } from './int_repr.js';
import { inferExprType } from '../../inference.js';
import { resolveSuperclassChain } from '../../subclass.js';
import {
  genRustExpr, genRustDestructure, genRustDefaultValue,
  genRustCondition, isRustGuardIf,
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
  G.ctx.refNames = refNames;

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

  // subscribe registration is handled by the generic prologue in handle_op
  // (see genSubscribePrologue). No per-fn registration code here.

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  // Early-return form for handle_op: returns (Option<Value>, Option<Value>, bool).
  // Used by genRustWhileStatement when a `repeat while` body contains a Return.
  const refNamesForRet = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));
  const publicRetExpr = (fields, te) => {
    const reBody = genRustReBody(fields, te, refNamesForRet);
    const bvaBody = genRustBvaBody(fields, te, refNamesForRet);
    const bvaPart = bvaBody ? `Some(${bvaBody})` : 'None';
    return `(Some(${reBody}), ${bvaPart}, true)`;
  };
  // Conditional-return guards: ImplicitReturn(IfExpr) with block bodies
  // containing Return nodes. A *leading* guard (body[0] is one) needs to run
  // BEFORE the locals so side-effecting assignments (e.g. Self()-spawn,
  // child dispatch) don't execute on the early-return path. Subsequent
  // guards run after the locals (they may legitimately depend on locals).
  const guards = body.filter(s =>
    s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr),
  );
  const hasLeadingGuard = body.length > 0 && body[0] === guards[0];
  let leadingGuardLines = null;
  let trailingGuards = guards;
  function makeReturnLines(returnFields, branchIndent) {
    const reBody = genRustReBody(returnFields, typeEnv, refNames);
    const bvaBody = genRustBvaBody(returnFields, typeEnv, refNames);
    const out = [];
    out.push(`${branchIndent}re = Some(${reBody});`);
    if (bvaBody) out.push(`${branchIndent}bva_re = Some(${bvaBody});`);
    out.push(`${branchIndent}handled = true;`);
    out.push(`${branchIndent}return (re, bva_re, handled);`);
    return out.join('\n');
  }
  function genBranchLines(branchBody, branchIndent) {
    const out = [];
    for (const bs of branchBody) {
      if (bs.type === 'ImplicitReturn' && bs.expr?.type === 'IfExpr' && isRustGuardIf(bs.expr)) {
        out.push(genGuardBlock(bs.expr, branchIndent));
      } else if (bs.type === 'Return') {
        out.push(makeReturnLines(bs.fields, branchIndent));
      } else if (bs.type === 'TypedAssign') {
        const val = genRustExpr(bs.value, typeEnv);
        out.push(`${branchIndent}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
      } else if (bs.type === 'Assign') {
        const val = genRustExpr(bs.value, typeEnv);
        out.push(`${branchIndent}let ${rustIdent(bs.name)} = ${val};`);
      }
    }
    return out.join('\n');
  }
  function genGuardBlock(ifExpr, blockIndent) {
    const bI = blockIndent;
    const bII = bI + '    ';
    const cond = genRustCondition(ifExpr.cond, typeEnv, {});
    const thenLines = genBranchLines(ifExpr.then?.body || [], bII);
    let elseSection = '';
    if (ifExpr.else) {
      if (ifExpr.else.type === 'IfExpr') {
        elseSection = ` else {\n${genGuardBlock(ifExpr.else, bII)}\n${bI}}`;
      } else if (ifExpr.else.body) {
        const elseLines = genBranchLines(ifExpr.else.body, bII);
        elseSection = ` else {\n${elseLines}\n${bI}}`;
      }
    }
    return `${bI}if ${cond} {\n${thenLines}\n${bI}}${elseSection}`;
  }
  if (hasLeadingGuard) {
    leadingGuardLines = genGuardBlock(guards[0].expr, '                ');
    trailingGuards = guards.slice(1);
  }
  if (leadingGuardLines) lines.push(leadingGuardLines);

  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, fns, publicRetExpr);
  if (locals) lines.push(locals);

  if (trailingGuards.length > 0) {
    for (const g of trailingGuards) {
      lines.push(genGuardBlock(g.expr, '                '));
    }
  }

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
            const convert = convertFromValue(callExpr, expectedType);
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
  } else if (implicitReturn && guards.length === 0) {
    const raw = genRustExpr(implicitReturn.expr, typeEnv);
    const retType = inferExprType(implicitReturn.expr, typeEnv);
    const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
    const needsTmp = implicitReturn.expr.type === 'FunctionCallExpr' || implicitReturn.expr.type === 'DotCallExpr';
    if (needsTmp) {
      lines.push(`                let _impl_ret = ${raw};`);
      const tmpVal = retType ? toJsonValue('_impl_ret', retType) : 'bv_val(_impl_ret)';
      lines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(tmpVal)}]));`);
    } else {
      lines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
    }
  }
  // set@<cell>: after mutation, replay new value to each registered subscriber
  // using the stored id. Notification shape matches the getter (positional
  // `re` with optional `bv-a` type tag). Derived fn replay for this cell is
  // emitted by the underlying SetStatement codegen (set@<cell>'s body is
  // `<cell> <- _v`), so no additional fn replay here.
  if (name && name.startsWith('set@')) {
    const cellName = name.slice('set@'.length);
    const cellStateKey = stateKey('@' + cellName);
    const cellType = params[0]?.type;
    const bvaLine = cellType
      ? `                    _resp.insert("bv-a".to_string(), json!([${JSON.stringify(cellType)}]));`
      : '';
    lines.push(`                let _subs = self.cell_subs.get(${JSON.stringify(cellName)}).cloned().unwrap_or_default();`);
    lines.push(`                for (_sub_id, _sub_from, _, _) in _subs {`);
    lines.push(`                    let _cur = self.state.get("${cellStateKey}").cloned().unwrap_or(Value::Null);`);
    lines.push(`                    if _sub_from == "__parent" {`);
    lines.push(`                        if let Some(slot_val) = self.state.get(&format!("_sub_slot_{}", _sub_id)).cloned() {`);
    lines.push(`                            let slot = slot_val.as_i64().unwrap_or(-1);`);
    lines.push(`                            self.dispatch_sub(slot, &json!([_cur]));`);
    lines.push(`                        }`);
    lines.push(`                    } else {`);
    lines.push(`                        let mut _resp = Map::new();`);
    lines.push(`                        _resp.insert("id".to_string(), json!(_sub_id));`);
    lines.push(`                        _resp.insert("re".to_string(), json!([_cur]));`);
    lines.push(`                        _resp.insert("to".to_string(), json!(_sub_from));`);
    if (bvaLine) lines.push(bvaLine);
    lines.push(`                        let _ = self.binding.send(Value::Object(_resp));`);
    lines.push(`                    }`);
    lines.push(`                }`);
  }
  lines.push('                handled = true;');
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  return `            "${name}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(publicFns, privateFns, preInitLambdas = [], constructorParams = [], asClauses = [], declarationReturn = null) {
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
        lambdaLines.push(`                let ${rustIdent(cap.name)} = ${intFromValue(`self.state.get("${capKey}").cloned().unwrap_or(Value::Null)`)};`);
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
      const guards = fnNode.body.filter(s =>
        s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr),
      );
      const mutableVars = findMutableVars(fnNode.body);
      const functionAnalysis = analyzeFunctions(fnNode.body, mutableVars, capTypeEnv);
      const savedSsaScope = G.ctx.ssaScope;
      const savedSsaCounts = G.ctx.ssaCounts;
      // Lambda inlined inside handle_op match arm: early returns short-circuit
      // handle_op via the `(re, bva_re, handled)` tuple.
      const lambdaRetExpr = (fields, te) => {
        const refNames = new Set();
        const reBody = genRustReBody(fields, te, refNames);
        const bvaBody = genRustBvaBody(fields, te, refNames);
        const bvaPart = bvaBody ? `Some(${bvaBody})` : 'None';
        return `(Some(${reBody}), ${bvaPart}, true)`;
      };
      const locals = genRustLocals(fnNode.body, capTypeEnv, functionAnalysis, mutableVars, '                ', privateFns, lambdaRetExpr);
      if (locals) lambdaLines.push(locals);
      if (reply) {
        const refNames = new Set();
        lambdaLines.push(`                re = Some(${genRustReBody(reply.fields, capTypeEnv, refNames)});`);
        const bva = genRustBvaBody(reply.fields, capTypeEnv, refNames);
        if (bva) lambdaLines.push(`                bva_re = Some(${bva});`);
      } else if (guards.length > 0) {
        // Conditional-return lambda: emit early-return `if cond { re = ...; handled = true; return (re, bva_re, handled); }`
        // chains for each guard, then a fallthrough using the terminal Return node.
        const termReturn = fnNode.body.find(s => s.type === 'Return');
        const I = '                ';

        function makeReturnFromFields(fields) {
          const refNames = new Set();
          const reBody = genRustReBody(fields, capTypeEnv, refNames);
          return `re = Some(${reBody}); handled = true; return (re, bva_re, handled);`;
        }

        function genBranchLines(branchBody, branchIndent) {
          const out = [];
          for (const bs of branchBody) {
            if (bs.type === 'ImplicitReturn' && bs.expr?.type === 'IfExpr' && isRustGuardIf(bs.expr)) {
              out.push(genGuardBlock(bs.expr, branchIndent));
            } else if (bs.type === 'Return') {
              out.push(`${branchIndent}${makeReturnFromFields(bs.fields)}`);
            } else if (bs.type === 'TypedAssign') {
              const val = genRustExpr(bs.value, capTypeEnv);
              out.push(`${branchIndent}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
            } else if (bs.type === 'Assign') {
              const val = genRustExpr(bs.value, capTypeEnv);
              out.push(`${branchIndent}let ${rustIdent(bs.name)} = ${val};`);
            }
          }
          return out.join('\n');
        }

        function genGuardBlock(ifExpr, blockIndent) {
          const bI = blockIndent;
          const bII = bI + '    ';
          const cond = genRustCondition(ifExpr.cond, capTypeEnv, {});
          const thenLines = genBranchLines(ifExpr.then?.body || [], bII);
          let elseSection = '';
          if (ifExpr.else) {
            if (ifExpr.else.type === 'IfExpr') {
              elseSection = ` else {\n${genGuardBlock(ifExpr.else, bII)}\n${bI}}`;
            } else if (ifExpr.else.body) {
              const elseLines = genBranchLines(ifExpr.else.body, bII);
              elseSection = ` else {\n${elseLines}\n${bI}}`;
            }
          }
          return `${bI}if ${cond} {\n${thenLines}\n${bI}}${elseSection}`;
        }

        for (const g of guards) {
          lambdaLines.push(genGuardBlock(g.expr, I));
        }
        if (termReturn) {
          const refNames = new Set();
          lambdaLines.push(`${I}re = Some(${genRustReBody(termReturn.fields, capTypeEnv, refNames)});`);
        }
      } else {
        // Implicit return — last expression in body
        const implRet = fnNode.body.find(s => s.type === 'ImplicitReturn');
        if (implRet) {
          const retType = fnNode.returnType || inferExprType(implRet.expr, capTypeEnv);
          const raw = genRustExpr(implRet.expr, capTypeEnv);
          const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
          lambdaLines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
        }
      }
      G.ctx.ssaScope = savedSsaScope;
      G.ctx.ssaCounts = savedSsaCounts;
    } else if (fnNode.expr) {
      const retType = fnNode.returnType || inferExprType(fnNode.expr, capTypeEnv);
      const raw = genRustExpr(fnNode.expr, capTypeEnv);
      const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
      lambdaLines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
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

  // As-clause dispatch arms for self-as type coercion
  for (const clause of asClauses) {
    const val = genRustExpr(clause.expr, {});
    const jsonVal = toJsonValue(val, inferLiteralType(clause.expr));
    if (clause.negated) {
      arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() != "${clause.targetType}" => {\n                re = Some(json!([${jsonVal}]));\n                bva_re = Some(json!([payload.as_str().unwrap()]));\n                handled = true;\n            }`);
    } else {
      arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() == "${clause.targetType}" => {\n                re = Some(json!([${jsonVal}]));\n                bva_re = Some(json!(["${clause.targetType}"]));\n                handled = true;\n            }`);
    }
  }
  // Memoized return-as dispatch arm
  if (declarationReturn && declarationReturn.typeName) {
    const t = declarationReturn.typeName;
    arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() == "${t}" => {\n                re = Some(json!([self.state.get("${stateKey('__returnAs')}").cloned().unwrap_or(Value::Null)]));\n                bva_re = Some(json!(["${t}"]));\n                handled = true;\n            }`);
  }

  arms.push('            _ => {}');
  return arms.join('\n');
}

function genRustChildPublicFn(fn, eCtx) {
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
  G.ctx.refNames = refNames;

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
          const convert = convertFromValue(callExpr, expectedType);
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
    const raw = genRustExpr(implicitReturn.expr, typeEnv, eCtx);
    const retType = inferExprType(implicitReturn.expr, typeEnv);
    const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
    const needsTmp = implicitReturn.expr.type === 'FunctionCallExpr' || implicitReturn.expr.type === 'DotCallExpr';
    if (needsTmp) {
      lines.push(`                let _impl_ret = ${raw};`);
      const tmpVal = retType ? toJsonValue('_impl_ret', retType) : 'bv_val(_impl_ret)';
      lines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(tmpVal)}]));`);
    } else {
      lines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
    }
  }
  // subscribe registration handled by prologue in the child dispatch.
  // set@<cell>: after mutation, notify each registered subscriber. In-process
  // (from == "__parent") routes to the parent's dispatch_sub via the stored
  // _sub_slot mapping. Remote subscribers post via binding.send. Derived fn
  // replay for this cell is emitted by the underlying SetStatement codegen
  // (set@<cell>'s body is `<cell> <- _v`), so no fn replay here.
  if (name.startsWith('set@')) {
    const cellName = name.slice('set@'.length);
    const subsKey = `${G.ctx.childStatePrefix || ''}_cell_subs_${cellName}`;
    const cellStateKey = stateKey('@' + cellName);
    const cellType = fn.params?.[0]?.type;
    const bvaLine = cellType
      ? `                        _resp.insert("bv-a".to_string(), json!([${JSON.stringify(cellType)}]));`
      : '';
    lines.push(`                let _subs_snapshot = self.state.get("${subsKey}").and_then(|v| v.as_array().cloned()).unwrap_or_default();`);
    lines.push(`                for _sub in &_subs_snapshot {`);
    lines.push(`                    let _sub_id = _sub.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();`);
    lines.push(`                    let _sub_from = _sub.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string();`);
    lines.push(`                    let _cur = self.state.get("${cellStateKey}").cloned().unwrap_or(Value::Null);`);
    lines.push(`                    if _sub_from == "__parent" {`);
    lines.push(`                        if let Some(slot_val) = self.state.get(&format!("_sub_slot_{}", _sub_id)).cloned() {`);
    lines.push(`                            let slot = slot_val.as_i64().unwrap_or(-1);`);
    lines.push(`                            self.dispatch_sub(slot, &json!([_cur]));`);
    lines.push(`                        }`);
    lines.push(`                    } else {`);
    lines.push(`                        let mut _resp = Map::new();`);
    lines.push(`                        _resp.insert("id".to_string(), json!(_sub_id));`);
    lines.push(`                        _resp.insert("re".to_string(), json!([_cur]));`);
    lines.push(`                        _resp.insert("to".to_string(), json!(_sub_from));`);
    if (bvaLine) lines.push(bvaLine);
    lines.push(`                        let _ = self.binding.send(Value::Object(_resp));`);
    lines.push(`                    }`);
    lines.push(`                }`);
  }
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  return `            "${name}" => {\n${lines.join('\n')}\n            }`;
}

function genRustChildDispatch(actor) {
  const _isPublicFn = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@'));
  const publicFns = actor.functions.filter(f => _isPublicFn(f));
  const privateFns = actor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !_isPublicFn(f));
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  const name = actor.name.toLowerCase();
  // Build eCtx with wrapped superclass bindings so DotAccessExpr on them resolves
  const supertypeBindings = actor._supertypeBindings || [];
  const childActorRefs = new Map();
  for (const wb of supertypeBindings) {
    childActorRefs.set(wb.name || wb.supertype, wb.supertype);
  }
  const eCtx = childActorRefs.size > 0 ? { childActorRefs } : undefined;
  const arms = [...publicFns, ...privateFns].map(h => genRustChildPublicFn(h, eCtx));
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
  // Generate delegation arms for inherited functions from wrapped superclasses
  const delegatedFunctions = actor._delegatedFunctions || [];
  for (const f of delegatedFunctions) {
    const wb = supertypeBindings[0]; // Use the first (primary) wrapped binding
    if (wb) {
      arms.push(`            "${f.name}" => {\n                re = Some(self.child_dispatch("${wb.supertype.toLowerCase()}", "${f.name}", payload, "", "__parent"));\n            }`);
    }
  }

  // As-clause dispatch arms for child actor self-as type coercion
  for (const clause of (actor.asClauses || [])) {
    const val = genRustExpr(clause.expr, {});
    const jsonVal = toJsonValue(val, inferLiteralType(clause.expr));
    if (clause.negated) {
      arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() != "${clause.targetType}" => {\n                re = Some(json!([${jsonVal}]));\n            }`);
    } else {
      arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() == "${clause.targetType}" => {\n                re = Some(json!([${jsonVal}]));\n            }`);
    }
  }
  // Memoized return-as dispatch arm for child actor
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const t = actor.declarationReturn.typeName;
    const sk = stateKey('__returnAs');
    arms.push(`            "as" if payload.is_string() && payload.as_str().unwrap() == "${t}" => {\n                re = Some(json!([self.state.get("${sk}").cloned().unwrap_or(Value::Null)]));\n            }`);
  }

  arms.push('            _ => {}');

  return `
    fn child_${name}_dispatch(&mut self, op: &str, payload: &Value, id: &str, from: &str) -> Value {
        // Generic subscribe prologue for this child: intercept
        // subscribe@<T> / subscribe#<T>, stash the sub in _cell_subs_<T>
        // (prefixed by child name), and recurse with the rewritten op.
        if op.starts_with("subscribe@") || op.starts_with("subscribe#") {
            let sigil = op.chars().nth("subscribe".len()).unwrap_or('@');
            let target = &op["subscribe".len() + 1..];
            let sub_args = payload.clone();
            let sub_bva = Value::Null;
            let subs_key = format!("${name}_cell_subs_{}", target);
            let mut subs = self
                .state
                .get(&subs_key)
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            subs.push(json!({
                "id": id,
                "from": from,
                "args": sub_args,
                "bva": sub_bva,
            }));
            self.state.insert(subs_key, Value::Array(subs));
            let rewritten = format!("{}{}", sigil, target);
            return self.child_${name}_dispatch(&rewritten, payload, id, from);
        }
        let _ = id; let _ = from;
        let _ = payload;
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
  const hasReturnAs = !!(actor.declarationReturn && actor.declarationReturn.typeName);
  if (constructorParams.length === 0 && initBody.length === 0 && supertypeBindings.length === 0 && inheritedIngests.length === 0 && !hasReturnAs) return '';

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
    const storeVal = p.type === 'Integer' ? `bv_bigint_to_value(&${p.name})` : `json!(${p.name})`;
    lines.push(`        self.state.insert("${stateKey(p.name)}".to_string(), ${storeVal});`);
  }

  // Service block statements — split around IngestExpr
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
    // Subclass provides a value for its superclass's ingest — assign directly to the inherited state var
    const ingest = inheritedIngests[0];
    const val = genRustExpr(actor.declarationReturn.expr, initTypeEnv);
    const t = ingest.typeName;
    lines.push(`        self.state.insert("${stateKey(ingest.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
  } else if (inheritedIngests.length > 0) {
    // Subclass doesn't provide a return — use superclass's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        const val = genRustExpr(ingest.defaultValue, initTypeEnv);
        lines.push(`        self.state.insert("${stateKey(ingest.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, ingest.typeName))});`);
      }
    }
  }

  // Memoized return-as value
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const val = genRustExpr(actor.declarationReturn.expr, initTypeEnv);
    const t = actor.declarationReturn.typeName;
    lines.push(`        self.state.insert("${stateKey('__returnAs')}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
  }

  // Service coercion aliases — copy ref state to alias.
  // Constructor coercions have no runtime presence (they're compile-time
  // aliases handled by ctx.constructorCoercions during `new` emission).
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && !s.constructorParams) {
      const refName = s.ref?.name || s.ref;
      lines.push(`        self.state.insert("${stateKey(s.name)}".to_string(), self.state.get("${stateKey(refName)}").cloned().unwrap_or(Value::Null));`);
    }
  }

  // Auto-create wrapped superclass instances
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
          const argExprs = superParams.map(p => p.type === 'Integer' ? `bv_bigint_to_value(&${p.name})` : `json!(${p.name})`);
          lines.push(`        self.child_${wb.supertype.toLowerCase()}_init(&Value::Array(vec![${argExprs.join(', ')}]));`);
        } else {
          lines.push(`        self.child_${wb.supertype.toLowerCase()}_init(&json!([]));`);
        }
      }
      // Store the wrapped binding name as a reference to the superclass's child dispatch name
      lines.push(`        self.state.insert("${stateKey(wb.name)}".to_string(), json!("${wb.supertype.toLowerCase()}"));`);
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

function genRustChildMethods(allActors) {
  const childActors = allActors.filter(a => a.name && G.ctx.actorInfo.has(a.name));
  if (childActors.length === 0) return '';
  const savedStateVarNames = G.ctx.stateVarNames;
  let savedDecls = G.ctx.stateVarDecls;
  const savedRemoteInstanceVars = G.ctx.remoteInstanceVars;
  const savedChildStatePrefix = G.ctx.childStatePrefix;
  const parts = [];
  for (const actor of childActors) {
    // ── Resolve superclass inheritance ──────────────────────────────────
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSuperclassChain(G.ctx.actorNodes, actor);

    // Merge inherited params (prepend) — skip any that the subclass redefines
    const ownParamNames = new Set((actor.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(actor.initParams || []),
    ];

    // Merge inherited functions — subclass's own functions take precedence
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

    // Build wrapped superclass bindings list
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
    // Make currentActorName reflect the child so self-target subscribe
    // inference (findFnReturnType in statements.js) resolves correctly.
    const savedCurrentActorName = G.ctx.currentActorName;
    G.ctx.currentActorName = actor.name || '';
    // Build ref-captured-by for this child's non-silent @/# fns.
    const _collectRefReads = (node, acc) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) _collectRefReads(n, acc); return; }
      if (node.type === 'RefRead' && node.name) acc.add(node.name);
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        _collectRefReads(node[k], acc);
      }
    };
    const _childSilent = new Set();
    for (const fn of (mergedActor.functions || [])) {
      if (!fn.name) continue;
      const hasReply = fn.body?.some(s => s.type === 'Reply');
      const hasImplicit = fn.body?.some(s => s.type === 'ImplicitReturn');
      const hasSilent = fn.body?.some(s => s.type === 'SilentTerminator');
      if (hasSilent && !hasReply && !hasImplicit) _childSilent.add(fn.name);
    }
    const savedRefCapturedBy = G.ctx._refCapturedBy;
    const _childRefCapturedBy = new Map();
    for (const fn of (mergedActor.functions || [])) {
      if (!fn.name) continue;
      const isPub = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
      const isPriv = fn.name.startsWith('#');
      if (!isPub && !isPriv) continue;
      if (_childSilent.has(fn.name)) continue;
      const acc = new Set();
      _collectRefReads(fn.body, acc);
      for (const refName of acc) {
        if (!_childRefCapturedBy.has(refName)) _childRefCapturedBy.set(refName, new Set());
        _childRefCapturedBy.get(refName).add(fn.name);
      }
    }
    G.ctx._refCapturedBy = _childRefCapturedBy;
    G.ctx.remoteInstanceVars = new Set();

    // Add merged non-public function names to actorFnNames so expression codegen routes through self_send
    const savedActorFnNames = new Set(G.ctx.actorFnNames);
    const allChildPrivateFns = mergedActor.functions.filter(f => f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update' && !f.name.startsWith('set@') && !f.name.startsWith('subscribe@'));
    for (const f of allChildPrivateFns) {
      G.ctx.actorFnNames.add(f.name);
    }

    const init = genRustChildInit(mergedActor);
    if (init) parts.push(init);
    // Set child self-send prefix so private function calls route through child dispatch
    const childPrivFns = mergedActor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update' && !f.name.startsWith('set@') && !f.name.startsWith('subscribe@'));
    if (childPrivFns.length > 0) {
      G.ctx.childSelfSendPrefix = actor.name.toLowerCase();
    }
    parts.push(genRustChildDispatch(mergedActor));
    G.ctx.childSelfSendPrefix = null;

    // Per-instance wrappers for spawn-needing classes — swap the instance's
    // state HashMap into self.state, run the existing init/dispatch (which
    // already use self.state with prefixed keys), then swap back. The
    // recursive swap-restore is safe under nested dispatch because each
    // call uses local std::mem::take to stash and replace.
    if (classNeedsSpawnedInstances(mergedActor)) {
      const lc = mergedActor.name.toLowerCase();
      parts.push(`
    fn child_${lc}_init_at(&mut self, instance_id: u32, args: &Value) {
        let saved_state = std::mem::take(&mut self.state);
        self.state = self.${lc}_instances.remove(&instance_id).unwrap_or_default();
        self.child_${lc}_init(args);
        let new_state = std::mem::take(&mut self.state);
        self.${lc}_instances.insert(instance_id, new_state);
        self.state = saved_state;
    }

    fn child_${lc}_dispatch_at(&mut self, instance_id: u32, op: &str, payload: &Value, id: &str, from: &str) -> Value {
        let saved_state = std::mem::take(&mut self.state);
        self.state = self.${lc}_instances.remove(&instance_id).unwrap_or_default();
        let result = self.child_${lc}_dispatch(op, payload, id, from);
        let new_state = std::mem::take(&mut self.state);
        self.${lc}_instances.insert(instance_id, new_state);
        self.state = saved_state;
        result
    }`);
    }

    // Restore actorFnNames
    G.ctx.actorFnNames = savedActorFnNames;
    G.ctx.currentActorName = savedCurrentActorName;
    G.ctx._refCapturedBy = savedRefCapturedBy;
  }
  G.ctx.stateVarNames = savedStateVarNames;
  G.ctx.remoteInstanceVars = savedRemoteInstanceVars;
  G.ctx.stateVarDecls = savedDecls;
  G.ctx.childStatePrefix = savedChildStatePrefix;

  // Generate child_dispatch routing method
  if (childActors.length > 0) {
    const arms = childActors.map(a => {
      const name = a.name.toLowerCase();
      return `            "${name}" => self.child_${name}_dispatch(op_name, payload, id, from),`;
    }).join('\n');
    parts.push(`
    fn child_dispatch(&mut self, child_name: &str, op_name: &str, payload: &Value, id: &str, from: &str) -> Value {
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
          return `        self.child_${name}_dispatch("${eventName}", payload, "", "__parent");`;
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
        self.child_${name}_dispatch("${eventName}", payload, "", "__parent")
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
