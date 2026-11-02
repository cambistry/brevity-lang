// handlers.js — Handler and child actor generation for Rust codegen
import {
  G, buildTypeEnv, inferLiteralType, rustIdent, rustSsaResolve, rustType, convertFromValue,
  toJsonValue, forceJsonWrap, stateKey, analyzeFunctions,
  findMutableVars, classNeedsSpawnedInstances,
} from './types.js';
import { intFromValue } from './int_repr.js';
import { inferExprType } from '../../inference.js';
import { resolveSuperclassChain, withInheritedState } from '../../subclass.js';
import {
  genRustExpr, genRustDestructure, genRustDefaultValue,
  genRustCondition, isRustGuardIf, inRustBranchScope, genRustBranchBind, precomputeGuardedFnCall,
  rustCellNotifyLines,
} from './expressions.js';
import {
  genRustLocals, genRustReBody, genRustBvaBody,
} from './statements.js';

// A param typed as a class of this file holds one of its actors.
const classParamsOf = (params = []) => params.filter(p => G.ctx.actorInfo?.has(p.type)).map(p => [p.name, p.type]);

function genRustPublicFn({ name, params, body: rawBody, actorDef, emptyOverload }, fns, { hasOverloads = false } = {}) {
  // Skip actorDef constructor clauses — dispatched via actor construction
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
        ? `${untaggedOk(params, 'message')}match_types_positional_min(message, &[${posTypes}], &[${namedTypes}], ${requiredPosTypedCount})`
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
      guard = ` if from == "__self" || from == "__test" || ${untaggedOk(params, 'message')}match_types_positional_min(message, &[${posTypes}], &[${namedTypes}], ${requiredPosTypedCount})`;
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
  function makeReturnLines(returnFields, branchIndent, branchEnv = typeEnv) {
    // An early exit from a silent handler sends no reply.
    if (hasSilent) return `${branchIndent}return (None, None, true);`;
    const reBody = genRustReBody(returnFields, branchEnv, refNames);
    const bvaBody = genRustBvaBody(returnFields, branchEnv, refNames);
    const out = [];
    out.push(`${branchIndent}re = Some(${reBody});`);
    if (bvaBody) out.push(`${branchIndent}bva_re = Some(${bvaBody});`);
    out.push(`${branchIndent}handled = true;`);
    out.push(`${branchIndent}return (re, bva_re, handled);`);
    return out.join('\n');
  }
  const genGuardBlock = (ifExpr, blockIndent) => rustGuardBlock(ifExpr, blockIndent, typeEnv, makeReturnLines);
  G.ctx.enclosingLocals = null;
  if (hasLeadingGuard) {
    leadingGuardLines = genGuardBlock(guards[0].expr, '                ');
    trailingGuards = guards.slice(1);
  }
  if (leadingGuardLines) lines.push(leadingGuardLines);

  G.ctx.classParams = classParamsOf(params);
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, fns, publicRetExpr);
  G.ctx.classParams = null;
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
      lines.push(`                re = Some(bv_val(&${spreadName}));`);
      // Passthrough bv-a from incoming message
      if (!spreadField.localObject) {
        lines.push(`                if let Some(bva) = message.get("bv-a") {`);
        lines.push(`                    if let Some(arr) = bva.as_array() {`);
        lines.push(`                        if !arr.is_empty() {`);
        lines.push(`                            bva_re = Some(BvObject::splat_bva(&arr[0]));`);
        lines.push(`                        }`);
        lines.push(`                    }`);
        lines.push(`                }`);
      }
    } else {
      // Pre-compute function-typed param calls and DotCallExpr to avoid block expressions inside json!
      const isFnType = t => t && (t === 'Function' || (typeof t === 'string' && /[-=~]>/.test(t)));
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
            if (precomputeGuardedFnCall(expr, fnBody, typeEnv, functionAnalysis, `_pvfn_${precomputeIdx}`, lines)) { precomputeIdx++; return; }
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
              lines.push(`                let ${tmpVar} = BvObject::pack(&${callExpr}).one();`);
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
        if (expr.type === 'AsExpr') precomputeExprCalls(expr.expr, expectedType);
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
    // Handler body is bare `Self` — reply with the class wire address as a
    // bare value (mirrors #new's reply shape: bare `re`, bare `bv-a` tag).
    // Skip the standard positional array wrapping.
    const isBareSelfReturn = implicitReturn.expr.type === 'Identifier'
      && implicitReturn.expr.name === 'Self';
    if (isBareSelfReturn) {
      lines.push(`                re = Some(${genRustExpr(implicitReturn.expr, typeEnv)});`);
      lines.push(`                bva_re = Some(Value::String("Class".to_string()));`);
    } else {
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
  } else if (!hasSilent) {
    // No reply, no implicit return, no silent terminator → Void return.
    // Mirrors the JS codegen default: `re = []` so the handler still posts a
    // (value-less) reply, distinct from silent (which suppresses the reply).
    lines.push('                re = Some(Value::Array(vec![]));');
  }
  // new@<class>: the reply is the new actor's address, in local form.
  if (name && name.startsWith('new@')) {
    const selector = name.slice('new@'.length);
    lines.push(`                let _addr = format!("@${selector}/{}", bv_inst_id(&${rustSsaResolve('_inst')}));`);
    lines.push(`                self.published_instances.insert(_addr.clone());`);
    lines.push(`                re = Some(Value::String(format!("#<{}>", _addr)));`);
    lines.push(`                bva_re = Some(json!(${JSON.stringify(`#<@${selector}>`)}));`);
  }
  // set@<cell>: after mutation, replay new value to each registered subscriber
  // using the stored id. Notification shape matches the getter (positional
  // `re` with optional `bv-a` type tag). Derived fn replay for this cell is
  // emitted by the underlying SetStatement codegen (set@<cell>'s body is
  // `<cell> <- _v`), so no additional fn replay here.
  if (name && name.startsWith('set@')) {
    lines.push(...rustCellNotifyLines(name.slice('set@'.length), params[0]?.type));
  }
  lines.push('                handled = true;');
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  // `#new` carries no tags: the caller checked its args against the doc.
  if (name?.startsWith('new@')) guard = '';
  // Outside, only `@name` is exposed.
  const isPrivate = !/^(@|set$|update$|set@|subscribe@|new@)/.test(name);
  if (isPrivate) guard = guard ? ` if !bv_from_wire_caller(from) && (${guard.replace(/^ if /, '')})` : ' if !bv_from_wire_caller(from)';
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

        function makeReturnFromFields(fields, env = capTypeEnv) {
          const refNames = new Set();
          const reBody = genRustReBody(fields, env, refNames);
          return `re = Some(${reBody}); handled = true; return (re, bva_re, handled);`;
        }

        const genBranchLines = (branchBody, branchIndent) => inRustBranchScope(() => {
          const out = [];
          const env = new Map(capTypeEnv);
          for (const bs of branchBody) {
            if (bs.type === 'ImplicitReturn' && bs.expr?.type === 'IfExpr' && isRustGuardIf(bs.expr)) {
              out.push(genGuardBlock(bs.expr, branchIndent));
            } else if (bs.type === 'Return') {
              out.push(`${branchIndent}${makeReturnFromFields(bs.fields, env)}`);
            } else if (bs.type === 'TypedAssign' || bs.type === 'Assign') {
              out.push(genRustBranchBind(bs, env, branchIndent));
            }
          }
          return out.join('\n');
        });

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
      } else if (fnNode.body.some(s => s.type === 'Return')) {
        const refNames = new Set();
        const ret = fnNode.body.find(s => s.type === 'Return');
        lambdaLines.push(`                re = Some(${genRustReBody(ret.fields, capTypeEnv, refNames)});`);
        const bva = genRustBvaBody(ret.fields, capTypeEnv, refNames);
        if (bva) lambdaLines.push(`                bva_re = Some(${bva});`);
      } else {
        // Implicit return — last expression in body
        const implRet = fnNode.body.find(s => s.type === 'ImplicitReturn');
        if (implRet) {
          const retType = fnNode.returnType || inferExprType(implRet.expr, capTypeEnv);
          const raw = genRustExpr(implRet.expr, capTypeEnv);
          const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
          lambdaLines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
        } else if (fnNode.returnType === '()') {
          // Void lambda — body ran for side effects, reply with empty `re: []`.
          lambdaLines.push('                re = Some(Value::Array(vec![]));');
        }
      }
      G.ctx.ssaScope = savedSsaScope;
      G.ctx.ssaCounts = savedSsaCounts;
    } else if (fnNode.expr) {
      const retType = fnNode.returnType || inferExprType(fnNode.expr, capTypeEnv);
      const raw = genRustExpr(fnNode.expr, capTypeEnv);
      const val = retType ? toJsonValue(raw, retType) : `bv_val(${raw})`;
      lambdaLines.push(`                re = Some(Value::Array(vec![${forceJsonWrap(val)}]));`);
    } else if (fnNode.returnType === '()') {
      // Void lambda with no body and no expr — emit empty reply.
      lambdaLines.push('                re = Some(Value::Array(vec![]));');
    }
    lambdaLines.push('                handled = true;');

    // A wire lambda is dispatched by its `@N` selector (locally via ref-field
    // self-dispatch, or on the wire after perspective translation); a local
    // lambda by its bare `_lambda_N` name.
    lambdaEntries.push({ name: lh.selector || name, inner: lambdaLines.join('\n'), params });
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
    if (!p.accessor) continue;
    const accessorName = p.accessor;
    const sk = stateKey(p.name);
    arms.push(`            "@${accessorName}" => {\n                re = Some(Value::Array(vec![self.state.get("${sk}").cloned().unwrap_or(Value::Null)]));\n                handled = true;\n            }`);
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

// A conditional-return guard: an `if` whose branches return. `makeReturnLines` says
// how a return leaves the enclosing function.
function rustGuardBlock(ifExpr, bI, typeEnv, makeReturnLines) {
  const bII = bI + '    ';
  const enclosing = G.ctx.enclosingLocals || { childActorRefs: new Map() };
  const branch = (branchBody) => inRustBranchScope(() => {
    const out = [];
    const env = new Map(typeEnv);
    const walk = (bs) => genRustLocals([bs], env, analyzeFunctions([bs], new Set(), env), findMutableVars([bs]), bII, undefined, null, enclosing);
    for (const bs of branchBody) {
      if (bs.type === 'ImplicitReturn' && bs.expr?.type === 'IfExpr' && isRustGuardIf(bs.expr)) {
        out.push(rustGuardBlock(bs.expr, bII, env, makeReturnLines));
      } else if (bs.type === 'Return') {
        out.push(makeReturnLines(bs.fields, bII, env));
      } else if (bs.type === 'TypedAssign' || bs.type === 'Assign') {
        out.push(genRustBranchBind(bs, env, bII));
      } else {
        // Writes and calls: anything else a branch does before it returns.
        const code = walk(bs);
        if (code) out.push(code);
      }
    }
    return out.join('\n');
  });
  const cond = genRustCondition(ifExpr.cond, typeEnv, {});
  const thenLines = branch(ifExpr.then?.body || []);
  let elseSection = '';
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      elseSection = ` else {\n${rustGuardBlock(ifExpr.else, bII, typeEnv, makeReturnLines)}\n${bI}}`;
    } else if (ifExpr.else.body) {
      elseSection = ` else {\n${branch(ifExpr.else.body)}\n${bI}}`;
    }
  }
  return `${bI}if ${cond} {\n${thenLines}\n${bI}}${elseSection}`;
}

// With nothing required, a call can leave out every arg, and so every tag.
function untaggedOk(params, message) {
  return params.some(p => !p.defaultValue && !p.rest) ? '' : `${message}.get("bv-a").is_none() || `;
}

// A call from outside an instance has its tags checked, as a file handler's are.
// In-process callers pass values, not tags. Overloads fall through to the next arm.
function childTagGuard({ name, params }) {
  if (name.startsWith('new@')) return '';
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const typed = params.filter(p => p.type && !p.rest && !isListOfAny(p.type));
  const pos = typed.filter(p => p.positional);
  const named = typed.filter(p => !p.positional);
  const pair = p => `("${p.key || p.name}", "${p.type}")`;
  let check;
  if (pos.length > 0) {
    const required = pos.filter(p => !p.defaultValue).length;
    const posTypes = pos.map(p => `"${p.type}"`).join(', ');
    check = `${untaggedOk(params, 'self.wire_msg')}match_types_positional_min(&self.wire_msg, &[${posTypes}], &[${named.map(pair).join(', ')}], ${required})`;
  } else if (named.length > 0) {
    check = `match_types(&self.wire_msg, &[${named.filter(p => !p.defaultValue).map(pair).join(', ')}])`;
  } else {
    return '';
  }
  return ` if !bv_from_wire_caller(from) || ${check}`;
}

function genRustChildPublicFn(fn, eCtx, classTypes = new Map(), isPublic = false) {
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
  for (const [n, t] of classTypes) if (!typeEnv.has(n)) typeEnv.set(n, t);
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));
  G.ctx.refNames = refNames;

  const lines = [];
  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);
  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  // A child's arm runs inside a function returning its reply Value, so an early
  // return is a plain `return`. The parent gets typed values decoded.
  const childReply = (fields, te) => {
    const reBody = genRustReBody(fields, te, refNames);
    const bvaBody = genRustBvaBody(fields, te, refNames);
    if (!bvaBody) return reBody;
    const unwire = bvaBody.includes('::') ? `if from == "__parent" { bv_unwire_reply(&_r, &${bvaBody}) } else { _r }` : '_r';
    return `{ let _r = ${reBody}; ${tagWireReply(bvaBody)} ${unwire} }`;
  };
  const childGuards = body.filter(s => s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr));
  G.ctx.enclosingLocals = null;
  const genChildGuard = (g) => rustGuardBlock(g.expr, '                ', typeEnv, (fields, bI, env = typeEnv) => `${bI}return ${childReply(fields, env)};`);
  const leadingChildGuard = body[0] === childGuards[0] ? childGuards[0] : null;
  if (leadingChildGuard) lines.push(genChildGuard(leadingChildGuard));
  G.ctx.classParams = classParamsOf(params);
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, undefined, childReply);
  G.ctx.classParams = null;
  if (locals) lines.push(locals);
  for (const g of childGuards) if (g !== leadingChildGuard) lines.push(genChildGuard(g));

  if (reply) {
    // Pre-compute reply field expressions that contain function calls producing block expressions
    let precomputeIdx = 0;
    const exprNeedsPrecompute = (expr) => {
      if (expr?.type === 'AsExpr') return exprNeedsPrecompute(expr.expr);
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
          if (precomputeGuardedFnCall(expr, fnBody, typeEnv, functionAnalysis, `_pvfn_${precomputeIdx}`, lines)) { precomputeIdx++; return; }
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
      if (expr.type === 'AsExpr') precomputeFnCalls(expr.expr, expectedType);
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
    // In process there's no bv-a channel, so the parent gets typed values decoded.
    const childBva = genRustBvaBody(reply.fields, typeEnv, refNames);
    if (childBva) lines.push(`                ${tagWireReply(childBva)}`);
    const spreadField = reply.fields.find(f => f.spread);
    if (spreadField && !spreadField.localObject) {
      lines.push(`                if bv_from_wire_caller(from) { self.wire_tag = self.wire_msg.get("bv-a").and_then(|b| b.as_array()).and_then(|a| a.first()).map(BvObject::splat_bva); }`);
    }
    if (childBva?.includes('::')) {
      lines.push(`                if from == "__parent" { re = re.map(|_r| bv_unwire_reply(&_r, &${childBva})); }`);
    }
  } else if (implicitReturn && !childGuards.includes(implicitReturn)) {
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
    lines.push(...rustCellNotifyLines(name.slice('set@'.length), fn.params?.[0]?.type, G.ctx.childStatePrefix || ''));
  }
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  // Outside, only `@name` is exposed.
  return `            "${name}"${isPublic ? childTagGuard(fn) : ' if !bv_from_wire_caller(from)'} => {\n${lines.join('\n')}\n            }`;
}

function tagWireReply(bvaBody) {
  return `if bv_from_wire_caller(from) { self.wire_tag = Some(${bvaBody}); }`;
}

function genRustChildDispatch(actor) {
  const _isPublicFn = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@') || f.name.startsWith('new@'));
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
  // Class param and state types, so handler bodies see e.g. Text params as Text.
  const classTypes = new Map();
  for (const p of (actor.initParams || [])) if (p.type) classTypes.set(p.name, p.type);
  for (const d of (actor.stateVarDecls || [])) if (d.typeName) classTypes.set(d.name, d.typeName);
  const arms = [
    ...publicFns.map(h => genRustChildPublicFn(h, eCtx, classTypes, true)),
    ...privateFns.map(h => genRustChildPublicFn(h, eCtx, classTypes)),
  ];
  // Add on-handler arms
  for (const h of onHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body);
    const I = '                ';
    const hLines = [];
    if (h.params.length > 0) {
      hLines.push(`${I}let _s = BvObject::pack(payload);`);
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
    if (!p.accessor) continue;
    const accessorName = p.accessor;
    const sk = stateKey(p.name);
    arms.push(`            "@${accessorName}" => {\n                re = Some(Value::Array(vec![self.state.get("${sk}").cloned().unwrap_or(Value::Null)]));\n            }`);
  }
  // Generate delegation arms for inherited functions from wrapped superclasses
  const delegatedFunctions = actor._delegatedFunctions || [];
  for (const f of delegatedFunctions) {
    const wb = supertypeBindings[0]; // Use the first (primary) wrapped binding
    if (wb) {
      arms.push(`            "${f.name}"${childTagGuard(f)} => {\n                re = Some(self.child_dispatch("${wb.supertype.toLowerCase()}", "${f.name}", payload, "", "__parent"));\n            }`);
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

  arms.push('            _ => { if bv_from_wire_caller(from) { self.wire_unhandled = true; } }');

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

  const isInstanceCall = (e) => e?.type === 'DotCallExpr' && e.object?.type === 'FunctionCallExpr' && G.ctx.actorInfo.has(e.object.callee?.name);

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
      } else if (isInstanceCall(s.value?.type === 'AsExpr' ? s.value.expr : s.value)) {
        // A call on a new instance binds the instance and then the reply, as in a handler.
        const name = 'cell_call';
        const call = s.value.type === 'AsExpr' ? s.value.expr : s.value;
        const binds = [
          { type: 'Assign', name: 'cell_recv', value: call.object },
          { type: 'Assign', name, value: { ...call, object: { type: 'Identifier', name: 'cell_recv' } } },
        ];
        const bound = genRustLocals(binds, initTypeEnv, analyzeFunctions(binds, new Set(), initTypeEnv), findMutableVars(binds), '            ');
        const read = { type: 'Identifier', name };
        const val = genRustExpr(s.value.type === 'AsExpr' ? { ...s.value, expr: read } : read, initTypeEnv);
        lines.push(`        {\n${bound}\n            let _v = ${forceJsonWrap(toJsonValue(val, initTypeEnv.get(s.name)))};\n            self.state.insert("${stateKey(s.name)}".to_string(), _v);\n        }`);
      } else {
        const val = genRustExpr(s.value, initTypeEnv);
        const t = initTypeEnv.get(s.name);
        lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, t))}; self.state.insert("${stateKey(s.name)}".to_string(), _v); }`);
      }
    }
  }

  // Handle ingest value assignment
  if (ownIngestInfo) {
    if (ownIngestInfo.defaultValue) {
      const val = genRustExpr(ownIngestInfo.defaultValue, initTypeEnv);
      const t = initTypeEnv.get(ownIngestInfo.name);
      lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, t))}; self.state.insert("${stateKey(ownIngestInfo.name)}".to_string(), _v); }`);
    } else {
      lines.push(`        self.state.insert("${stateKey(ownIngestInfo.name)}".to_string(), Value::Null);`);
    }
    // Post-ingest body statements
    for (const s of postIngestBody) {
      if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, initTypeEnv);
        const t = initTypeEnv.get(s.name);
        lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, t))}; self.state.insert("${stateKey(s.name)}".to_string(), _v); }`);
      }
    }
  } else if (inheritedIngests.length > 0 && actor.declarationReturn) {
    // Subclass provides a value for its superclass's ingest — assign directly to the inherited state var
    const ingest = inheritedIngests[0];
    const val = genRustExpr(actor.declarationReturn.expr, initTypeEnv);
    const t = ingest.typeName;
    lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, t))}; self.state.insert("${stateKey(ingest.name)}".to_string(), _v); }`);
  } else if (inheritedIngests.length > 0) {
    // Subclass doesn't provide a return — use superclass's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        const val = genRustExpr(ingest.defaultValue, initTypeEnv);
        lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, ingest.typeName))}; self.state.insert("${stateKey(ingest.name)}".to_string(), _v); }`);
      }
    }
  }

  // Memoized return-as value
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const val = genRustExpr(actor.declarationReturn.expr, initTypeEnv);
    const t = actor.declarationReturn.typeName;
    lines.push(`        { let _v = ${forceJsonWrap(toJsonValue(val, t))}; self.state.insert("${stateKey('__returnAs')}".to_string(), _v); }`);
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

  // Auto-create wrapped superclass actors
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

  // `on <param>.<event>`: register this instance with the emitter instance
  // the param holds, so the emitter's emit reaches it.
  for (const f of (actor.functions || []).filter(f => f.type === 'OnHandler')) {
    if (!constructorParams.some(p => p.name === f.source)) continue;
    lines.push(`        if let Some(_cur) = self.current_${name}_instance { let _src: Value = bv_val(${f.source}.clone()); if let Some(_s) = _src.as_str() { self.emit_subs.entry(_s.to_string()).or_insert_with(Vec::new).push((format!("${name}/{}", _cur), ${JSON.stringify(f.eventName)}.to_string())); } }`);
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
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests, inheritedState, inheritedInit } = resolveSuperclassChain(G.ctx.actorNodes, actor);

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

    // Subscribe-on-param transform was applied as a pre-pass in program.js
    // before genRustDispatch, so the file class's @run handler sees the
    // child's _paramSubscriptions when emitting construction sites. Here
    // we just propagate the transformed body and existing subscription
    // metadata into mergedActor.
    const mergedActor = {
      ...actor,
      initParams: mergedParams,
      functions: mergedFunctions,
      _delegatedFunctions: delegatedFunctions,
      _supertypeBindings: supertypeBindings,
      _inheritedIngests: inheritedIngests,
    };

    Object.assign(mergedActor, withInheritedState(mergedActor, { inheritedState, inheritedInit }));

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
      if (fn.name.endsWith('.') || (hasSilent && !hasReply && !hasImplicit)) _childSilent.add(fn.name);
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
    const allChildPrivateFns = mergedActor.functions.filter(f => f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update' && !f.name.startsWith('set@') && !f.name.startsWith('subscribe@') && !f.name.startsWith('new@'));
    for (const f of allChildPrivateFns) {
      G.ctx.actorFnNames.add(f.name);
    }
    for (const f of mergedActor.functions) if (f.name?.startsWith('@') && !f.actorDef && !f.emptyOverload) G.ctx.actorFnNames.add(f.name);

    // Set child self-send prefix so a call to the class's own function routes through child dispatch
    G.ctx.childSelfSendPrefix = actor.name.toLowerCase();
    const init = genRustChildInit(mergedActor);
    if (init) parts.push(init);
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
        let saved_current = self.current_${lc}_instance.replace(instance_id);
        self.inst_depth += 1;
        self.state = self.${lc}_instances.remove(&instance_id).unwrap_or_default();
        let outcome = catch_unwind(AssertUnwindSafe(|| { ${init ? `self.child_${lc}_init(args);` : 'let _ = args;'} }));
        let new_state = std::mem::take(&mut self.state);
        if outcome.is_ok() { self.${lc}_instances.insert(instance_id, new_state); }
        self.state = saved_state;
        self.current_${lc}_instance = saved_current;
        self.inst_depth -= 1;
        self.flush_pending_subs();
        // A failed construction leaves no actor and takes no address, and the
        // caller receives the failure.
        if outcome.is_err() {
            if self.${lc}_next_id.get() == instance_id + 1 { self.${lc}_next_id.set(instance_id); }
            panic!("ex_response");
        }
    }

    fn child_${lc}_dispatch_at(&mut self, instance_id: u32, op: &str, payload: &Value, id: &str, from: &str) -> Value {
        let saved_state = std::mem::take(&mut self.state);
        let saved_current = self.current_${lc}_instance.replace(instance_id);
        self.inst_depth += 1;
        self.state = self.${lc}_instances.remove(&instance_id).unwrap_or_default();
        let outcome = catch_unwind(AssertUnwindSafe(|| self.child_${lc}_dispatch(op, payload, id, from)));
        let new_state = std::mem::take(&mut self.state);
        self.${lc}_instances.insert(instance_id, new_state);
        self.state = saved_state;
        self.current_${lc}_instance = saved_current;
        self.inst_depth -= 1;
        self.flush_pending_subs();
        // A failure leaves both actors intact. A call that receives one fails in
        // turn, so a failed as keeps its message only on the handler it happened in.
        let result = match outcome {
            Ok(v) => v,
            Err(e) if from != "__parent" => std::panic::resume_unwind(e),
            Err(_) => panic!("ex_response"),
        };
        // A self-return has an empty Object for its reply and no other reply does.
        // We're the parent, so its address, in our frame, is this handle.
        if result.as_object().is_some_and(|o| o.is_empty()) { return bv_inst_ref("${lc}", instance_id); }
        result
    }

    // Allocate a fresh instance, run init, register any subscribe-on-param
    // subscriptions on host's inproc_cell_subs, and return the new u32
    // instance id. Used in expression position (e.g. inside a list literal)
    // where wrapping the spawn in a block expression would create a borrow
    // conflict with the surrounding self.<state>.insert call.
    fn spawn_${lc}_instance(&mut self, args: &Value) -> u32 {
        let _id = self.${lc}_next_id.get();
        self.${lc}_next_id.set(_id + 1);
        self.${lc}_instances.insert(_id, std::collections::HashMap::new());
        self.child_${lc}_init_at(_id, args);
        _id
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
    // A child reference is an instance ref "<class>/<id>" (or, for routes
    // that predate instances, a bare class name).
    const arms = childActors.map(a => {
      const name = a.name.toLowerCase();
      // An instance already dispatching has its state swapped in: call it
      // directly rather than through its (emptied) pool entry.
      return `            "${name}" => match _inst { Some(_i) if self.current_${name}_instance != Some(_i) => self.child_${name}_dispatch_at(_i, op_name, payload, id, from), _ => self.child_${name}_dispatch(op_name, payload, id, from) },`;
    }).join('\n');
    parts.push(`
    fn child_dispatch(&mut self, child_name: &str, op_name: &str, payload: &Value, id: &str, from: &str) -> Value {
        let (_class, _inst) = match child_name.split_once('/') {
            Some((c, i)) => (c, i.parse::<u32>().ok()),
            None => (child_name, None),
        };
        match _class {
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
  // Subscribers registered themselves with the emitting instance at init
  // (emit_subs, keyed by the emitter's instance ref).
  for (const [eventName, { decl, actor: emitter }] of allEmitDecls) {
    const lc = emitter.name.toLowerCase();
    parts.push(`
    fn emit_${eventName}(&mut self, payload: &Value) -> Value {
        let _me = format!("${lc}/{}", self.current_${lc}_instance.unwrap_or(0));
        let _subs: Vec<(String, String)> = self.emit_subs.get(&_me).cloned().unwrap_or_default().into_iter().filter(|(_, ev)| ev == ${JSON.stringify(eventName)}).collect();
        let mut _first = Value::Null;
        for (_i, (_sub, _ev)) in _subs.iter().enumerate() {
            let _r = self.child_dispatch(_sub, _ev, payload, "", "__parent");
            if _i == 0 { _first = _r; }
        }
        ${decl.silent ? 'let _ = _first; Value::Null' : '_first'}
    }`);
  }

  return parts.join('\n');
}

export { genRustPublicFn, genRustDispatch, genRustChildPublicFn, genRustChildDispatch, genRustChildInit, genRustChildMethods };
