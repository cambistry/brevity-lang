// statements.js — Statement generation for Rust codegen
import { inferExprType } from '../../inference.js';
import {
  G, inferLiteralType, rustIdent, mintRustSsa, rustSsaResolve, rustType, convertFromValue, toJsonValue,
  forceJsonWrap, rsStore, stateKey, findRsAsClauseMatch, substituteCaptures,
  buildTypeEnv, fnReturnsFunction, resolveVarExpr, classNeedsSpawnedInstances,
} from './types.js';
import { intToValue, valueArray } from './int_repr.js';
import {
  genRustExpr, genRustIfExpr,
  genRustFnReturn, genRustFnCallExpr, genRecursiveFnDef,
  genRustCondition, isRustGuardIf, buildRustGuardChainExpr,
} from './expressions.js';

function genRustDefaultExpr(param, typeEnv) {
  let expr = genRustExpr(param.defaultValue, typeEnv);
  const pt = param.type || inferLiteralType(param.defaultValue);
  if (pt === 'Text' && param.defaultValue?.type === 'StringLiteral') expr += '.to_string()';
  return expr;
}

function genRustAsSend(varName, typeName, targetExpr, I, lines) {
  lines.push(`${I}let ${varName}: ${rustType(typeName)} = {`);
  lines.push(`${I}    let seq = self.send_seq.get();`);
  lines.push(`${I}    self.send_seq.set(seq + 1);`);
  lines.push(`${I}    let send_id = seq.to_string();`);
  lines.push(`${I}    let mut send_msg = Map::new();`);
  lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
  lines.push(`${I}    send_msg.insert("op".to_string(), json!(["${typeName}", "as"]));`);
  lines.push(`${I}    send_msg.insert("to".to_string(), json!(${targetExpr}));`);
  lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
  lines.push(`${I}    let _re = self.await_response(&send_id);`);
  lines.push(`${I}    let _as_val: Value = if let Some(arr) = _re.as_array() { arr.first().cloned().unwrap_or(Value::Null) } else { Value::Null };`);
  lines.push(`${I}    ${convertFromValue('_as_val', typeName)}`);
  lines.push(`${I}};`);
}

// --- Extracted handlers for genRustTypedAssign ---

// Branch 2: as-clause interception
function handleTypedAssign_AsClause(s, typeEnv, I, lines) {
  const asClause = findRsAsClauseMatch(s.typeName, s.value.callee.name);
  if (!asClause) return false;
  if (asClause.memoized) {
    const actorName = s.value.callee.name;
    const childActor = G.ctx.actorInfo.get(actorName)?.actor;
    const hasReturnAs = !!(childActor?.declarationReturn && childActor.declarationReturn.typeName);
    const hasInitNeeded = s.value.args.length > 0 || childActor?._supertypeBindings?.length > 0 || childActor?._inheritedIngests?.length > 0 || childActor?.initParams?.length > 0 || hasReturnAs;
    if (hasInitNeeded) {
      const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
      if (s.value.args.length > 0) {
        const initArgExprs = positionalArgs.map(a => genRustExpr(a, typeEnv));
        lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${valueArray(initArgExprs)});`);
      } else {
        lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!({}));`);
      }
    }
    const childCall = `self.child_${actorName.toLowerCase()}_dispatch("as", &json!("${s.typeName}"), "", "__parent")`;
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${convertFromValue(`${childCall}.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)`, s.typeName)};`);
    return true;
  }
  let val = genRustExpr(asClause.expr, typeEnv);
  if ((s.typeName === 'Text' || s.typeName === 'Blob') && asClause.expr.type === 'StringLiteral') val += '.to_string()';
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${val};`);
  return true;
}

// Branch 3: Dep service ref assign
function handleTypedAssign_DepServiceRef(s, I, lines) {
  if (G.ctx.destructuredMembers?.has(s.value.name)) {
    const { service, remote } = G.ctx.destructuredMembers.get(s.value.name);
    const method = JSON.stringify('@' + remote);
    const to = JSON.stringify(service);
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {`);
    lines.push(`${I}    let seq = self.send_seq.get();`);
    lines.push(`${I}    self.send_seq.set(seq + 1);`);
    lines.push(`${I}    let send_id = seq.to_string();`);
    lines.push(`${I}    let mut send_msg = Map::new();`);
    lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
    lines.push(`${I}    send_msg.insert("op".to_string(), json!(${method}));`);
    lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
    lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
    lines.push(`${I}    let _re = self.await_response(&send_id);`);
    lines.push(`${I}    ${convertFromValue(`_re.get("${s.name}").cloned().unwrap_or(Value::Null)`, s.typeName)}`);
    lines.push(`${I}};`);
    G.ctx.needsAwaitNew = true;
    return true;
  }
  genRustAsSend(mintRustSsa(s.name), s.typeName, `self.state.get("${stateKey(s.value.name)}").and_then(|v| v.as_str()).unwrap_or("${s.value.name}")`, I, lines);
  G.ctx.needsAwaitNew = true;
  return true;
}

// Branch 4: Child actor ref assign
function handleTypedAssign_ChildActorRef(s, sCtx, I, lines) {
  const actorName = sCtx.childActorRefs.get(s.value.name);
  const childCall = `self.child_${actorName.toLowerCase()}_dispatch("as", &json!("${s.typeName}"), "", "__parent")`;
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${convertFromValue(`${childCall}.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)`, s.typeName)};`);
  return true;
}

// Branch 5: Remote instance var assign
function handleTypedAssign_RemoteInstanceVar(s, I, lines) {
  genRustAsSend(mintRustSsa(s.name), s.typeName, `self.state.get("${stateKey(s.value.name)}").and_then(|v| v.as_str()).unwrap_or("")`, I, lines);
  G.ctx.needsAwaitNew = true;
  return true;
}

// Branch 6: Local instance var assign
function handleTypedAssign_LocalInstanceVar(s, I, lines) {
  genRustAsSend(mintRustSsa(s.name), s.typeName, `${rustSsaResolve(s.value.name)}.as_str().unwrap_or("")`, I, lines);
  G.ctx.needsAwaitNew = true;
  return true;
}

// Branch 7: Actor instantiation with constructor overloads
function handleTypedAssign_ActorInstantiation(s, typeEnv, sCtx, I, lines) {
  let actorName = s.value.callee.name;
  // Constructor overload dispatch
  if (G.ctx.constructorOverloads?.has(actorName)) {
    const overloads = G.ctx.constructorOverloads.get(actorName);
    const argCount = s.value.args.filter(a => a.type !== 'NamedArgsBag').length;
    const inferArgType = arg => {
      if (arg.type === 'IntLiteral') return 'Integer';
      if (arg.type === 'StringLiteral') return 'Text';
      if (arg.type === 'DecimalLiteral') return 'Decimal';
      if (arg.type === 'BoolLiteral') return 'Boolean';
      return null;
    };
    const argTypes = s.value.args.filter(a => a.type !== 'NamedArgsBag').map(inferArgType);
    const primaryInfo = G.ctx.actorInfo.get(actorName);
    const primaryParams = (primaryInfo?.actor?.initParams || []).filter(p => p.positional);
    const candidates = [
      { className: actorName, params: primaryParams },
      ...overloads.map(ov => {
        const ovInfo = G.ctx.actorInfo.get(ov.mangledName);
        const ovParams = (ovInfo?.actor?.initParams || ov.params || []).filter(p => p.positional);
        return { className: ov.mangledName, params: ovParams };
      }),
    ];
    const match = candidates.find(c => {
      if (c.params.length !== argCount) return false;
      for (let j = 0; j < argCount; j++) {
        if (argTypes[j] && c.params[j]?.type && c.params[j].type !== 'Anything' && argTypes[j] !== c.params[j].type) return false;
      }
      return true;
    });
    if (match) actorName = match.className;
  }
  const childActor = G.ctx.actorInfo.get(actorName)?.actor;
  const needsSpawn = classNeedsSpawnedInstances(childActor);

  // Build init args expression once, used by both flattened and spawn paths
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  let initArgsExpr;
  if (namedBag && childActor?.initParams) {
    const namedFields = namedBag.fields || {};
    const argExprs = [];
    let posIdx = 0;
    for (const p of childActor.initParams) {
      const key = p.key || p.name;
      if (namedFields[key]) {
        argExprs.push(genRustExpr(namedFields[key], typeEnv));
      } else if (p.positional && posIdx < positionalArgs.length) {
        argExprs.push(genRustExpr(positionalArgs[posIdx], typeEnv));
        posIdx++;
      } else {
        argExprs.push('null');
      }
    }
    initArgsExpr = valueArray(argExprs);
  } else if (s.value.args.length > 0) {
    const args = positionalArgs.map(a => genRustExpr(a, typeEnv));
    initArgsExpr = valueArray(args);
  } else {
    initArgsExpr = 'json!({})';
  }

  if (needsSpawn) {
    // Spawn-needing class: allocate an instance id, init at that id, and
    // bind the variable to the id (u32). Downstream dispatch routes via
    // child_<class>_dispatch_at(id, ...). Track in selfSpawnedRefs so
    // dispatch sites pick the per-instance path. If a Self-bearing param
    // arg references a host state cell, register the new instance as an
    // in-process subscriber and immediately deliver the cell's current
    // value via the synthesized @__sub_<param> callback.
    const lc = actorName.toLowerCase();
    const idVar = mintRustSsa(s.name);
    const paramSubs = childActor?._paramSubscriptions || [];
    const subRegLines = [];
    if (paramSubs.length > 0 && namedBag) {
      const namedFields = namedBag.fields || {};
      for (const ps of paramSubs) {
        const argExpr = namedFields[ps.paramName];
        if (!argExpr) continue;
        if (argExpr.type !== 'Identifier' && argExpr.type !== 'RefRead') continue;
        const cellName = argExpr.name;
        if (!G.ctx.stateVarNames?.has(cellName)) continue;
        subRegLines.push(`${I}    self.inproc_cell_subs.entry(${JSON.stringify(cellName)}.to_string()).or_insert_with(Vec::new).push((${JSON.stringify(actorName.toLowerCase())}.to_string(), _id, ${JSON.stringify(ps.callbackName)}.to_string()));`);
        subRegLines.push(`${I}    let _initial_val = self.state.get(${JSON.stringify(stateKey(cellName))}).cloned().unwrap_or(Value::Null);`);
        subRegLines.push(`${I}    self.child_${lc}_dispatch_at(_id, ${JSON.stringify(ps.callbackName)}, &Value::Array(vec![_initial_val]), "", "__parent");`);
      }
    }
    lines.push(`${I}let ${idVar}: u32 = {`);
    lines.push(`${I}    let _id = self.${lc}_next_id.get();`);
    lines.push(`${I}    self.${lc}_next_id.set(_id + 1);`);
    lines.push(`${I}    self.${lc}_instances.insert(_id, std::collections::HashMap::new());`);
    lines.push(`${I}    self.child_${lc}_init_at(_id, &${initArgsExpr});`);
    if (subRegLines.length > 0) lines.push(...subRegLines);
    lines.push(`${I}    _id`);
    lines.push(`${I}};`);
    if (!sCtx.selfSpawnedRefs) sCtx.selfSpawnedRefs = new Map();
    sCtx.selfSpawnedRefs.set(s.name, actorName);
    return true;
  }

  // Flattened path: existing behavior — single-instance, prefix-keyed state.
  sCtx.childActorRefs.set(s.name, actorName);
  const hasInitNeeded = s.value.args.length > 0 || childActor?._supertypeBindings?.length > 0 || childActor?._inheritedIngests?.length > 0 || childActor?.initParams?.length > 0;
  if (hasInitNeeded) {
    lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${initArgsExpr});`);
  }
  return true;
}

// Branch 8: IfExpr assign
function handleTypedAssign_IfExpr(s, typeEnv, I, lines) {
  const ifVal = genRustIfExpr(s.value, typeEnv, null, I, rustType(s.typeName));
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${ifVal};`);
}

// Branch 9: Actor fn call (with function-typed args inlining)
function handleTypedAssign_ActorFnCall(s, typeEnv, fnDefs, I, lines, fns) {
  // Check if any args are function-typed (Function, FnRef) — need fn inlining
  const hasFunctionArgs = s.value.args.some(a =>
    a.type === 'Function' || a.type === 'FnRef');
  const fnDef = hasFunctionArgs && fns ? fns.find(f => f.name === s.value.callee.name) : null;
  if (fnDef && hasFunctionArgs) {
    // Inline the fn body, resolving function params
    const fnParams = fnDef.params || [];
    const fnBody = fnDef.body || [];
    const fnReply = fnBody.find(bs => bs.type === 'Reply');
    const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
    const namedBagP = s.value.args.find(a => a.type === 'NamedArgsBag');
    const blockLines = [];
    const fnFunctionParams = new Map();
    let pPosIdx = 0;
    for (const pp of fnParams) {
      let arg;
      if (pp.positional) {
        arg = callArgs[pPosIdx++];
      } else if (namedBagP && namedBagP.fields && (pp.key || pp.name) in namedBagP.fields) {
        arg = namedBagP.fields[pp.key || pp.name];
      }
      if (arg?.type === 'Function') {
        fnFunctionParams.set(pp.name, { kind: 'inline', node: arg });
        continue;
      }
      if (arg?.type === 'FnRef') {
        const resolved = fnDefs.get(arg.name);
        if (resolved) {
          fnFunctionParams.set(pp.name, { kind: 'inline', node: resolved.node });
        } else {
          fnFunctionParams.set(pp.name, { kind: 'method', name: arg.name });
        }
        continue;
      }
      const pt = pp.type || inferLiteralType(arg) || (pp.defaultValue ? inferLiteralType(pp.defaultValue) : null);
      let argExpr = arg ? genRustExpr(arg, typeEnv) : (pp.defaultValue ? genRustDefaultExpr(pp, typeEnv) : 'Value::Null');
      if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
      if (pt) {
        blockLines.push(`${I}    let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
      } else {
        blockLines.push(`${I}    let ${rustIdent(pp.name)} = ${argExpr};`);
      }
    }
    // Process fn body statements
    const fnTypeEnv = buildTypeEnv(fnParams, fnBody);
    // Helper to resolve function params in nested expressions
    function genExprResolvingFunctions(expr) {
      if (expr.type === 'FunctionCallExpr') {
        const callee = expr.callee?.name;
        const cp = callee ? fnFunctionParams.get(callee) : null;
        if (cp && cp.kind === 'inline') {
          const func = cp.node;
          const fparams = func.params || [];
          const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
          const bindings = [];
          let fIdx = 0;
          for (const fp of fparams) {
            const farg = fargs[fIdx++];
            const fargExpr = farg ? genExprResolvingFunctions(farg) : (fp.defaultValue ? genRustDefaultExpr(fp, typeEnv) : 'Value::Null');
            const fpt = fp.type || inferLiteralType(farg) || (fp.defaultValue ? inferLiteralType(fp.defaultValue) : null);
            if (fpt) bindings.push(`let ${rustIdent(fp.name)}: ${rustType(fpt)} = ${fargExpr};`);
            else bindings.push(`let ${rustIdent(fp.name)} = ${fargExpr};`);
          }
          let fret = func.expr;
          if (!fret && func.body) {
            const ir = func.body.find(st => st.type === 'ImplicitReturn');
            if (ir) fret = ir.expr;
          }
          const retCode = fret ? genExprResolvingFunctions(fret) : 'Value::Null';
          if (bindings.length > 0) return `{ ${bindings.join(' ')} ${retCode} }`;
          return retCode;
        }
        if (cp && cp.kind === 'method') {
          const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
          const argVals = fargs.map(a => forceJsonWrap(genExprResolvingFunctions(a)));
          return `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
        }
      }
      return genRustExpr(expr, fnTypeEnv);
    }
    for (const bs of fnBody) {
      if (bs.type === 'Reply') continue;
      if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
        const innerCallee = bs.value.callee?.name;
        const cp = innerCallee ? fnFunctionParams.get(innerCallee) : null;
        if (cp) {
          if (cp.kind === 'inline') {
            const innerFunc = cp.node;
            const innerParams = innerFunc.params || [];
            const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
            const innerLines = [];
            let iiIdx = 0;
            for (const ip of innerParams) {
              const iarg = innerArgs[iiIdx++];
              const itype = ip.type || inferLiteralType(iarg) || (ip.defaultValue ? inferLiteralType(ip.defaultValue) : null);
              const iexpr = iarg ? genRustExpr(iarg, fnTypeEnv) : (ip.defaultValue ? genRustDefaultExpr(ip, fnTypeEnv) : 'Value::Null');
              if (itype) {
                innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
              } else {
                innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
              }
            }
            let innerRetExprB = innerFunc.expr;
            if (!innerRetExprB && innerFunc.body) {
              const implRetB = innerFunc.body.find(st => st.type === 'ImplicitReturn');
              if (implRetB) innerRetExprB = implRetB.expr;
            }
            const innerExpr = innerRetExprB ? genRustExpr(innerRetExprB, fnTypeEnv) : 'Value::Null';
            const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
            if (innerLines.length > 0) {
              const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
              blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerBlock};`);
            } else {
              blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerExpr};`);
            }
          } else if (cp.kind === 'method') {
            const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
            const argVals = innerArgs.map(a => forceJsonWrap(genRustExpr(a, fnTypeEnv)));
            const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
            const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
            blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${rtype ? convertFromValue(fnCall, rtype) : fnCall};`);
          }
          continue;
        }
      }
      if (bs.type === 'TypedAssign') {
        blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
      } else if (bs.type === 'Assign') {
        blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
      }
    }
    // Extract return value from fn reply, using function-aware resolver
    if (fnReply) {
      const retFields = fnReply.fields.filter(f => f.positional);
      if (retFields.length === 1) {
        const rf = retFields[0];
        const rfExpr = rf.expr || (rf.name ? { type: 'Identifier', name: rf.name } : null);
        if (rfExpr) {
          blockLines.push(`${I}    ${genExprResolvingFunctions(rfExpr)}`);
        }
      }
    }
    const block = `{\n${blockLines.join('\n')}\n${I}}`;
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${block};`);
  } else {
    const callExpr = genRustFnCallExpr(s.value, typeEnv);
    if (s.typeName === 'Structure') {
      lines.push(`${I}let ${mintRustSsa(s.name)} = ${callExpr};`);
    } else {
      const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
      lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${converted};`);
    }
  }
}

// Branch 10: Structure type assign
function handleTypedAssign_StructureType(s, typeEnv, I, lines) {
  const sVal = genRustExpr(s.value, typeEnv);
  lines.push(`${I}let ${mintRustSsa(s.name)} = ${sVal};`);
}

// Branch 11: StructureConstructor value
function handleTypedAssign_StructureConstructor(s, typeEnv, I, lines) {
  const expr = genRustExpr(s.value, typeEnv);
  const converted = convertFromValue(`${expr}.one()`, s.typeName);
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${converted};`);
}

// Branch 12: FunctionCallExpr (tracked fn inlining)
function handleTypedAssign_FunctionCallExpr(s, typeEnv, fnDefs, I, lines) {
  const calleeName = s.value.callee?.name;
  const tracked = calleeName ? fnDefs.get(calleeName) : null;
  if (tracked && tracked.recursive) {
    // Call the generated recursive function directly
    const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
    const argExprs = callArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${rustIdent(calleeName)}(${argExprs});`);
  } else if (tracked) {
    // Inline the closure body with param bindings in a block expression
    const funcNode = tracked.node;
    const funcParams = funcNode.params || [];
    const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
    const namedArgsBag = s.value.args.find(a => a.type === 'NamedArgsBag');

    // Conditional-return guards: ImplicitReturn(IfExpr) with block bodies containing Return nodes.
    const guards = (funcNode.body || []).filter(st =>
      st.type === 'ImplicitReturn' && st.expr?.type === 'IfExpr' && isRustGuardIf(st.expr),
    );

    // Separate return expression from body statements
    let innerExpr;
    let returnNode = null;
    let bodyStmts = [];
    if (funcNode.body) {
      bodyStmts = funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return');
      const implRet = guards.length === 0 ? funcNode.body.find(st => st.type === 'ImplicitReturn') : null;
      returnNode = funcNode.body.find(st => st.type === 'Return');
      innerExpr = implRet ? implRet.expr : null;
      // If no ImplicitReturn, use last body statement's variable as return
      if (!innerExpr && !returnNode && bodyStmts.length > 0) {
        const lastStmt = bodyStmts[bodyStmts.length - 1];
        if (lastStmt.type === 'SetStatement') {
          // Set returns the new ref value
          innerExpr = { type: 'RefRead', name: lastStmt.name };
        } else if (lastStmt.name) {
          innerExpr = { type: 'Identifier', name: lastStmt.name };
        } else {
          // Body has statements but no named return — evaluate to null
          innerExpr = { type: 'NullLiteral' };
        }
      }
    } else {
      innerExpr = funcNode.expr;
    }

    if (innerExpr || returnNode || guards.length > 0) {
      const hasBlockContent = funcParams.length > 0 || bodyStmts.length > 0;
      const blockLines = [];

      // Save outer SSA scope. Call-site arguments below are still
      // computed in the OUTER scope (so a `fn(x)` arg references the
      // outer x via its SSA name). After the args are pre-computed
      // we'll push a child SSA scope for the inlined block body.
      const innerSsaScopeBefore = G.ctx.ssaScope;
      const innerSsaCountsBefore = G.ctx.ssaCounts;

      // Inlined-lambda early returns from `repeat while` need to land at the
      // lambda call site, not at the enclosing handle_op/_fn. Wrap the body
      // in a labeled block and override the while-body return form so the
      // emitted statement is `break 'lbl Structure { ... }` instead of
      // `return (...)`.
      const wrapInLabeledBlock = bodyHasWhileEarlyReturn(funcNode.body);
      let inlinedLabel = null;
      const savedWhileRetKeyword = G.ctx.whileRetKeyword;
      const savedMakeRetExpr = G.ctx.makeRetExpr;
      if (wrapInLabeledBlock) {
        G.ctx.lambdaInlineCounter = (G.ctx.lambdaInlineCounter || 0) + 1;
        inlinedLabel = `lbl_inline_${G.ctx.lambdaInlineCounter}`;
        G.ctx.whileRetKeyword = `break '${inlinedLabel}`;
        G.ctx.makeRetExpr = (fields, te) => genRustFnReturn(fields, te);
      }

      // Bind function params to call-site arguments
      const fnParams = new Map();
      let posIdx = 0;
      for (let pi = 0; pi < funcParams.length; pi++) {
        const param = funcParams[pi];
        let arg;
        const lookupKey = param.key || param.name;
        if (param.positional) {
          arg = callArgs[posIdx++];
        } else if (namedArgsBag && namedArgsBag.fields && lookupKey in namedArgsBag.fields) {
          arg = namedArgsBag.fields[lookupKey];
        }
        // Track function args (Function literal, FnRef)
        if (arg?.type === 'Function') {
          fnParams.set(param.name, { kind: 'inline', node: arg });
          continue;
        }
        if (arg?.type === 'FnRef') {
          if (G.ctx.actorFnNames.has(arg.name)) {
            fnParams.set(param.name, { kind: 'method', name: arg.name });
          } else {
            const resolved = fnDefs.get(arg.name);
            if (resolved) {
              fnParams.set(param.name, { kind: 'inline', node: resolved.node });
            } else {
              fnParams.set(param.name, { kind: 'method', name: arg.name });
            }
          }
          continue;
        }
        const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null) || (param.defaultValue ? inferLiteralType(param.defaultValue) : null);
        let argExpr = arg ? genRustExpr(arg, typeEnv) : (param.defaultValue ? genRustDefaultExpr(param, typeEnv) : 'Value::Null');
        if (paramType) {
          if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
          blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
          typeEnv.set(param.name, paramType);
        } else {
          blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
        }
      }

      // Push child SSA scope for the inlined block body. Inner
      // bindings (params, body locals) are emitted as plain names so
      // Rust's lexical scoping picks them up. Identity-mapping each
      // inner name in the SSA scope makes genRustExpr resolve to the
      // plain name when the body references it. The outer scope is
      // copied first so non-shadowed outer names still resolve via
      // their SSA suffix.
      const childScope = new Map(innerSsaScopeBefore);
      for (const fp of funcParams) childScope.set(fp.name, fp.name);
      for (const bs of bodyStmts) {
        if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.name) childScope.set(bs.name, bs.name);
      }
      G.ctx.ssaScope = childScope;
      G.ctx.ssaCounts = new Map(innerSsaCountsBefore || []);

      // Track nested function definitions within inlined body
      const innerFnDefs = new Map();
      for (const bs of bodyStmts) {
        if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
          innerFnDefs.set(bs.name, bs.value);
        }
      }

      // Emit body statements (excluding ImplicitReturn/Return)
      for (const bs of bodyStmts) {
        // Skip nested function definitions — they'll be inlined at call sites
        if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function' && innerFnDefs.has(bs.name)) {
          continue;
        }
        // Handle calls to nested function definitions
        if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
          const innerCallee = bs.value.callee?.name;
          const innerFn = innerCallee ? innerFnDefs.get(innerCallee) : null;
          if (innerFn) {
            // Inline the nested function
            const nfParams = innerFn.params || [];
            const nfArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
            const nfLines = [];
            let nfPosIdx = 0;
            for (const np of nfParams) {
              const narg = nfArgs[nfPosIdx++];
              const ntype = np.type || inferLiteralType(narg) || (narg?.type === 'Identifier' ? typeEnv.get(narg.name) : null) || (np.defaultValue ? inferLiteralType(np.defaultValue) : null);
              const nexpr = narg ? genRustExpr(narg, typeEnv) : (np.defaultValue ? genRustDefaultExpr(np, typeEnv) : 'Value::Null');
              if (ntype) {
                nfLines.push(`${I}        let ${rustIdent(np.name)}: ${rustType(ntype)} = ${nexpr};`);
              } else {
                nfLines.push(`${I}        let ${rustIdent(np.name)} = ${nexpr};`);
              }
            }
            let nfRetExpr = innerFn.expr;
            if (!nfRetExpr && innerFn.body) {
              const implRetN = innerFn.body.find(st => st.type === 'ImplicitReturn');
              if (implRetN) nfRetExpr = implRetN.expr;
            }
            const nfExpr = nfRetExpr ? genRustExpr(nfRetExpr, typeEnv) : 'Value::Null';
            const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
            if (nfLines.length > 0) {
              const nfBlock = `{\n${nfLines.join('\n')}\n${I}        ${nfExpr}\n${I}    }`;
              if (rtype) {
                blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfBlock};`);
              } else {
                blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfBlock};`);
              }
            } else {
              if (rtype) {
                blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfExpr};`);
              } else {
                blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfExpr};`);
              }
            }
            continue;
          }
        }
        // Handle function param calls: f(n) where f is a function arg
        if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
          const innerCallee = bs.value.callee?.name;
          const cp = innerCallee ? fnParams.get(innerCallee) : null;
          if (cp) {
            if (cp.kind === 'inline') {
              // Inline the function
              const innerFunc = cp.node;
              const innerParams = innerFunc.params || [];
              const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
              const innerLines = [];
              let iposIdx = 0;
              for (const ip of innerParams) {
                const iarg = innerArgs[iposIdx++];
                const itype = ip.type || inferLiteralType(iarg) || (iarg?.type === 'Identifier' ? typeEnv.get(iarg.name) : null) || (ip.defaultValue ? inferLiteralType(ip.defaultValue) : null);
                const iexpr = iarg ? genRustExpr(iarg, typeEnv) : (ip.defaultValue ? genRustDefaultExpr(ip, typeEnv) : 'Value::Null');
                if (itype) {
                  innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
                } else {
                  innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
                }
              }
              let innerRetExprH = innerFunc.expr;
              if (!innerRetExprH && innerFunc.body) {
                const implRetH = innerFunc.body.find(st => st.type === 'ImplicitReturn');
                if (implRetH) innerRetExprH = implRetH.expr;
              }
              const innerExpr = innerRetExprH ? genRustExpr(innerRetExprH, typeEnv) : 'Value::Null';
              const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
              if (innerLines.length > 0) {
                const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
                if (rtype) {
                  blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerBlock};`);
                } else {
                  blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerBlock};`);
                }
              } else {
                if (rtype) {
                  blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerExpr};`);
                } else {
                  blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerExpr};`);
                }
              }
            } else if (cp.kind === 'method') {
              // Call the actor fn
              const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
              const argVals = innerArgs.map(a => {
                const raw = genRustExpr(a, typeEnv);
                const t = a.type === 'Identifier' ? typeEnv.get(a.name) : inferLiteralType(a);
                return forceJsonWrap(toJsonValue(raw, t));
              });
              const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
              const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
              if (rtype) {
                blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${convertFromValue(fnCall, rtype)};`);
              } else {
                blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${fnCall};`);
              }
            }
            continue;
          }
        }
        if (bs.type === 'TypedAssign') {
          const bsVal = substituteCaptures(bs.value, tracked.captures);
          if (bs.typeName === 'Structure' && bsVal.type === 'FunctionCallExpr') {
            blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bsVal, typeEnv)};`);
          } else {
            blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bsVal, typeEnv)};`);
          }
        } else if (bs.type === 'Assign') {
          const bsVal = substituteCaptures(bs.value, tracked.captures);
          const knownType = inferLiteralType(bs.value);
          if (knownType) {
            blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bsVal, typeEnv)};`);
          } else {
            blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bsVal, typeEnv)};`);
          }
        } else if (bs.type === 'WhileStatement') {
          blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `, G.ctx.makeRetExpr));
        } else if (bs.type === 'StateAssign') {
          const bsVal = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
          blockLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
        } else if (bs.type === 'SetStatement') {
          const bsVal = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
          const bk = G.ctx.stateVarNames.has(bs.name) ? stateKey(bs.name) : bs.name;
          blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${bk}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
        } else if (bs.type === 'ExprStatement') {
          if (bs.expr.type === 'IfExpr') {
            blockLines.push(genRustIfStatement(bs.expr, typeEnv, `${I}    `));
          } else {
            blockLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
          }
        }
      }

      if (guards.length > 0) {
        // Conditional-return: emit if/else if/else chain producing a Structure,
        // then extract via .one() and convert to target type.
        const chainExpr = buildRustGuardChainExpr(
          guards,
          returnNode,
          typeEnv,
          `${I}        `,
          (fields, te) => genRustFnReturn(fields, te),
        );
        // Pop child SSA scope before minting outer binding
        G.ctx.ssaScope = innerSsaScopeBefore;
        G.ctx.ssaCounts = innerSsaCountsBefore;
        if (s.typeName === 'Structure') {
          blockLines.push(`${I}    ${chainExpr}`);
          lines.push(`${I}let ${mintRustSsa(s.name)} = {\n${blockLines.join('\n')}\n${I}};`);
        } else {
          blockLines.push(`${I}    let _ret = ${chainExpr};`);
          const converted = convertFromValue(`_ret.one()`, s.typeName);
          blockLines.push(`${I}    ${converted}`);
          lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
        }
      } else if (returnNode) {
        // Return node: build a Structure from fields, then extract as needed
        const retStructExpr = genRustFnReturn(returnNode.fields, typeEnv);
        // Pop child SSA scope before minting outer binding
        G.ctx.ssaScope = innerSsaScopeBefore;
        G.ctx.ssaCounts = innerSsaCountsBefore;
        if (wrapInLabeledBlock) {
          // Body lines emitted `break 'lbl Structure {...}` for early returns;
          // terminal value is the fallthrough Structure.
          blockLines.push(`${I}    ${retStructExpr}`);
          const labeledBlock = `'${inlinedLabel}: {\n${blockLines.join('\n')}\n${I}}`;
          if (s.typeName === 'Structure') {
            lines.push(`${I}let ${mintRustSsa(s.name)} = ${labeledBlock};`);
          } else {
            const converted = convertFromValue(`(${labeledBlock}).one()`, s.typeName);
            lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${converted};`);
          }
        } else if (s.typeName === 'Structure') {
          blockLines.push(`${I}    ${retStructExpr}`);
          lines.push(`${I}let ${mintRustSsa(s.name)} = {\n${blockLines.join('\n')}\n${I}};`);
        } else {
          const converted = convertFromValue(`${retStructExpr}.one()`, s.typeName);
          blockLines.push(`${I}    ${converted}`);
          lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
        }
      } else if (hasBlockContent) {
        // Return expression as block value (still inside child scope so
        // inner shadows resolve to plain names that Rust scopes locally).
        const substituted = substituteCaptures(innerExpr, tracked.captures);
        const valExpr = genRustExpr(substituted, typeEnv);
        // For Integer target with matching Integer expression, pass BigInt directly
        // For other types, go through json!() → convertFromValue
        const exprType = inferExprType(substituted, typeEnv);
        // RefRead/StateVar return Value at runtime — must convert even when types match
        const isValueExpr = substituted.type === 'RefRead' || substituted.type === 'StateVar';
        let converted;
        if (s.typeName === 'Integer' && exprType === 'Integer' && !isValueExpr) {
          converted = valExpr;
        } else if (s.typeName === 'Integer') {
          converted = isValueExpr ? convertFromValue(valExpr, 'Integer') : convertFromValue(`bv_val(${valExpr})`, 'Integer');
        } else {
          converted = isValueExpr ? convertFromValue(valExpr, s.typeName) : convertFromValue(`json!(${valExpr})`, s.typeName);
        }
        blockLines.push(`${I}    ${converted}`);
        // Pop child scope before minting outer binding
        G.ctx.ssaScope = innerSsaScopeBefore;
        G.ctx.ssaCounts = innerSsaCountsBefore;
        lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
      } else {
        // No params, no body — simple inline
        const substituted = substituteCaptures(innerExpr, tracked.captures);
        const valExpr = genRustExpr(substituted, typeEnv);
        const exprType2 = inferExprType(substituted, typeEnv);
        const isValueExpr2 = substituted.type === 'RefRead' || substituted.type === 'StateVar';
        let converted;
        if (s.typeName === 'Integer' && exprType2 === 'Integer' && !isValueExpr2) {
          converted = valExpr;
        } else if (s.typeName === 'Integer') {
          converted = isValueExpr2 ? convertFromValue(valExpr, 'Integer') : convertFromValue(`bv_val(${valExpr})`, 'Integer');
        } else {
          converted = isValueExpr2 ? convertFromValue(valExpr, s.typeName) : convertFromValue(`json!(${valExpr})`, s.typeName);
        }
        // Pop child scope
        G.ctx.ssaScope = innerSsaScopeBefore;
        G.ctx.ssaCounts = innerSsaCountsBefore;
        lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${converted};`);
      }
      // Restore inlined-lambda labeled-block context (no-op when not set).
      G.ctx.whileRetKeyword = savedWhileRetKeyword;
      G.ctx.makeRetExpr = savedMakeRetExpr;
    }
  } else {
    const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
    let val = genRustExpr(s.value, typeEnv, exprCtx);
    const isIterExpr = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
    const isFnCall = s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier';
    const calleeFnTyped = isFnCall && (() => {
      const ct = typeEnv.get(s.value.callee.name);
      if (ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')))) return true;
      // Lambda vars dispatch through call_fn and return Value
      if (G.ctx.lambdaVarNames.has(s.value.callee.name)) return true;
      // We're already past the actorFnNames / fnDefs paths — any remaining
      // Identifier callee (untyped local, call-result local) routes through
      // call_fn, which returns a Value. Wrap with convertFromValue.
      const cn = s.value.callee.name;
      if (cn && !G.ctx.actorInfo?.has(cn) && !G.ctx.publicFnNames?.has('@' + cn)
          && !G.ctx.destructuredMembers?.has(cn) && !G.ctx.dependencyNames?.has(cn)) {
        return true;
      }
      return false;
    })();
    if (isIterExpr && s.typeName && rustType(s.typeName) !== 'Value') {
      val = convertFromValue(val, s.typeName);
    } else if (calleeFnTyped && s.typeName && rustType(s.typeName) !== 'Value') {
      val = convertFromValue(val, s.typeName);
    } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
      val = convertFromValue(val, s.typeName);
    } else if ((s.typeName === 'Text' || s.typeName === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
    if (!isIterExpr && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `bv_val(${val})`;
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${val};`);
  }
}

// Branch 13: DotCallExpr on remote
function handleTypedAssign_DotCallExpr(s, I, lines) {
  const expr = s.value;
  const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
  // Remote instance: send + await_response
  const to = `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
  const method = JSON.stringify(expr.method);
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {`);
  lines.push(`${I}    let seq = self.send_seq.get();`);
  lines.push(`${I}    self.send_seq.set(seq + 1);`);
  lines.push(`${I}    let send_id = seq.to_string();`);
  lines.push(`${I}    let mut send_msg = Map::new();`);
  lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
  lines.push(`${I}    send_msg.insert("op".to_string(), json!(${method}));`);
  lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
  lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
  lines.push(`${I}    let _re = self.await_response(&send_id);`);
  lines.push(`${I}    ${convertFromValue(`_re.get("${s.name}").cloned().unwrap_or(Value::Null)`, s.typeName)}`);
  lines.push(`${I}};`);
}

// Branch 14: Generic fallthrough
function handleTypedAssign_Generic(s, typeEnv, fnDefs, I, lines) {
  // Value-carrying catch on RHS — emit the labeled-block expression with the
  // target type threaded through so break/tail values are coerced correctly.
  if (s.value.type === 'CatchExpr' && !s.value.isVoid) {
    const val = genRustValueCatchExpr(s.value, typeEnv, s.typeName);
    lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${val};`);
    return;
  }
  const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
  let val = genRustExpr(s.value, typeEnv, exprCtx);
  const isIterExpr2 = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
  if (isIterExpr2 && s.typeName && rustType(s.typeName) !== 'Value') {
    val = convertFromValue(val, s.typeName);
  } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
    val = convertFromValue(val, s.typeName);
  } else if ((s.typeName === 'Text' || s.typeName === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
  if (!isIterExpr2 && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `bv_val(${val})`;
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = ${val};`);
}

// --- End extracted handlers ---

function genRustTypedAssign(s, typeEnv, fnDefs, sCtx, I, lines, i, body, mutableVars, fns, _functionAnalysis) {
      // Branch 1: dep constructor (tiny, keep inline)
      if (s.typeName && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.dependencyNames.has(s.value.callee.name) && !G.ctx.destructuredMembers?.has(s.value.callee.name)) {
        genRustDepConstructorAsAssign(s, typeEnv, I, lines);
        return true;
      }

      // Branch 2: as-clause interception
      if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        if (handleTypedAssign_AsClause(s, typeEnv, I, lines)) return true;
      }

      // Branch 3: dep service ref assign
      if (s.typeName && s.value?.type === 'Identifier' && G.ctx.dependencyNames.has(s.value.name)) {
        return handleTypedAssign_DepServiceRef(s, I, lines);
      }

      // Branch 4: child actor ref assign
      if (s.typeName && s.value?.type === 'Identifier' && sCtx?.childActorRefs?.has(s.value.name)) {
        return handleTypedAssign_ChildActorRef(s, sCtx, I, lines);
      }

      // Branch 5: remote instance var assign
      if (s.typeName && s.value?.type === 'Identifier' && G.ctx.remoteInstanceVars?.has(s.value.name)) {
        return handleTypedAssign_RemoteInstanceVar(s, I, lines);
      }

      // Branch 6: local instance var assign
      if (s.typeName && s.value?.type === 'Identifier' && G.ctx.localInstanceVars?.has(s.value.name)) {
        return handleTypedAssign_LocalInstanceVar(s, I, lines);
      }

      // Branch 6.5: Self() recursive spawn — allocate an instance in the
      // file class's self_instances pool, init at that id, bind the var to
      // the u32 id. Downstream dispatch routes via handle_op_at(id, ...).
      if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && s.value.callee.name === 'Self') {
        const argExprs = s.value.args.map(a => genRustExpr(a, typeEnv));
        const argsExpr = argExprs.length === 0 ? 'json!([])' : valueArray(argExprs);
        const idVar = mintRustSsa(s.name);
        lines.push(`${I}let ${idVar}: u32 = {`);
        lines.push(`${I}    let _id = self.self_next_id.get();`);
        lines.push(`${I}    self.self_next_id.set(_id + 1);`);
        lines.push(`${I}    self.self_instances.insert(_id, std::collections::HashMap::new());`);
        lines.push(`${I}    self.self_init_at(_id, &${argsExpr});`);
        lines.push(`${I}    _id`);
        lines.push(`${I}};`);
        if (!sCtx.selfSpawnedRefs) sCtx.selfSpawnedRefs = new Map();
        sCtx.selfSpawnedRefs.set(s.name, '__self__');
        return true;
      }

      // Branch 6.6: typed-assign to a spawn-needing class from any other
      // expression (e.g. `p Peer = peers.first`). The source returns a
      // Value; we extract its u64 (the instance id) and bind p to a u32.
      // Tracks the var as selfSpawnedRefs so subsequent .method() calls
      // route via dispatch_at.
      if (s.type === 'TypedAssign' && s.typeName && G.ctx.actorInfo?.has(s.typeName) &&
          classNeedsSpawnedInstances(G.ctx.actorInfo.get(s.typeName)?.actor) &&
          s.value && s.value.type !== 'FunctionCallExpr' &&
          s.value.type !== 'Identifier') {
        const raw = genRustExpr(s.value, typeEnv);
        const idVar = mintRustSsa(s.name);
        lines.push(`${I}let ${idVar}: u32 = (${raw}).as_u64().unwrap_or(0) as u32;`);
        if (!sCtx.selfSpawnedRefs) sCtx.selfSpawnedRefs = new Map();
        sCtx.selfSpawnedRefs.set(s.name, s.typeName);
        return true;
      }

      // Branch 7: actor instantiation with constructor overloads
      if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        return handleTypedAssign_ActorInstantiation(s, typeEnv, sCtx, I, lines);
      }

      // Branches 8-14: value-type assigns (if/else chain returning false)
      if (s.value.type === 'IfExpr') {
        handleTypedAssign_IfExpr(s, typeEnv, I, lines);
      } else if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.value.callee.name)) {
        handleTypedAssign_ActorFnCall(s, typeEnv, fnDefs, I, lines, fns);
      } else if (s.typeName === 'Structure') {
        handleTypedAssign_StructureType(s, typeEnv, I, lines);
      } else if (s.value.type === 'StructureConstructor') {
        handleTypedAssign_StructureConstructor(s, typeEnv, I, lines);
      } else if (s.value.type === 'FunctionCallExpr') {
        handleTypedAssign_FunctionCallExpr(s, typeEnv, fnDefs, I, lines);
      } else if (s.value?.type === 'DotCallExpr' && (() => {
        const dotObj = s.value.object;
        const dn = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
        return dn && G.ctx.remoteInstanceVars.has(dn);
      })()) {
        handleTypedAssign_DotCallExpr(s, I, lines);
      } else {
        handleTypedAssign_Generic(s, typeEnv, fnDefs, I, lines);
      }
      return false;
}

// Handles DestructureAssign statements.

function genRustDestructureAssign(s, typeEnv, sCtx, I, lines, i, fnDefs) {
      // Typed-value source: tagged Value::Object — read fields by name and
      // convert to the field's declared type. Validation in src/validate.js
      // rejects over-arity and undeclared-field references before reaching codegen.
      {
        const sourceType = inferExprType(s.source, typeEnv);
        const typeDecl = (typeof sourceType === 'string' && G.ctx.typeDecls?.has(sourceType))
          ? G.ctx.typeDecls.get(sourceType) : null;
        if (typeDecl) {
          const fields = typeDecl.fields || [];
          let srcRef;
          if (s.source.type === 'Identifier') {
            srcRef = genRustExpr(s.source, typeEnv);
          } else {
            srcRef = `_dv${G.ctx.fnTempCounter++}`;
            lines.push(`${I}let ${srcRef}: Value = ${genRustExpr(s.source, typeEnv)};`);
          }
          for (const item of s.pattern) {
            if (item.discard) continue;
            let field;
            if (item.named) field = fields.find(f => f.name === item.name);
            else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
            else if (item.positional) field = fields[item.idx];
            else continue;
            const fieldName = field.name;
            // Optional fields stay as Value so `??` / `(expr)?` can see
            // absence; only required fields get the typed binding.
            const ftype = item.type || (field.optional ? null : field.paramType);
            const accessor = `(${srcRef}).get(${JSON.stringify(fieldName)}).cloned().unwrap_or(Value::Null)`;
            if (ftype) {
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(ftype)} = ${convertFromValue(accessor, ftype)};`);
            } else {
              lines.push(`${I}let ${mintRustSsa(item.name)}: Value = ${accessor};`);
            }
          }
          return;
        }
      }
      // Destructured member call: :v = greet(name) → send + await response
      if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && G.ctx.destructuredMembers?.has(s.source.callee.name)) {
        const { service, remote } = G.ctx.destructuredMembers.get(s.source.callee.name);
        const to = JSON.stringify(service);
        const method = JSON.stringify('@' + remote);
        const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = s.source.args.find(a => a.type === 'NamedArgsBag');
        let opExpr;
        if (callArgs.length === 0 && !namedBag) {
          opExpr = `json!(${method})`;
        } else if (namedBag) {
          // Values route through toJsonValue so that BigInt (and other types
          // without a direct serde::Serialize impl) are converted to
          // serde_json::Value via the runtime helpers instead of being
          // embedded raw inside a `json!` literal.
          const namedInserts = Object.entries(namedBag.fields).map(([k, v]) => {
            const raw = genRustExpr(v, typeEnv);
            const t = inferLiteralType(v) || inferExprType(v, typeEnv);
            return `_nm.insert("${k}".to_string(), ${toJsonValue(raw, t || 'Anything')});`;
          }).join(' ');
          opExpr = `{ let mut _nm = Map::new(); ${namedInserts} Value::Array(vec![Value::Object(_nm), json!(${method})]) }`;
        } else {
          const vals = callArgs.map(a => {
            const raw = genRustExpr(a, typeEnv);
            const t = inferLiteralType(a) || inferExprType(a, typeEnv);
            return toJsonValue(raw, t || 'Anything');
          });
          opExpr = `Value::Array(vec![Value::Array(vec![${vals.join(', ')}]), json!(${method})])`;
        }
        lines.push(`${I}let _re = {`);
        lines.push(`${I}    let seq = self.send_seq.get();`);
        lines.push(`${I}    self.send_seq.set(seq + 1);`);
        lines.push(`${I}    let send_id = seq.to_string();`);
        lines.push(`${I}    let mut send_msg = Map::new();`);
        lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
        lines.push(`${I}    send_msg.insert("op".to_string(), ${opExpr});`);
        lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
        lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
        lines.push(`${I}    self.await_response(&send_id)`);
        lines.push(`${I}};`);
        G.ctx.needsAwaitNew = true;
        for (const item of s.pattern) {
          if (item.discard) continue;
          const key = item.key || item.name;
          const accessor = `_re.get("${key}").cloned().unwrap_or(Value::Null)`;
          if (item.type) {
            lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
          } else {
            lines.push(`${I}let ${mintRustSsa(item.name)} = ${accessor};`);
          }
        }
        return;
      }
      if (s.source.type === 'FunctionCallExpr') {
        // Inline function and destructure the result
        const calleeName = s.source.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagD = s.source.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const fnReturnNode = funcNode.body ? funcNode.body.find(st => st.type === 'Return') : null;
          const fnImplRet = funcNode.body ? funcNode.body.find(st => st.type === 'ImplicitReturn') : null;

          const tempName = `_fr${G.ctx.fnTempCounter++}`;
          const blockLines = [];
          let posIdxD = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxD++];
            } else if (namedArgsBagD && namedArgsBagD.fields && lookupKey in namedArgsBagD.fields) {
              arg = namedArgsBagD.fields[lookupKey];
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null) || (param.defaultValue ? inferLiteralType(param.defaultValue) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : (param.defaultValue ? genRustDefaultExpr(param, typeEnv) : 'Value::Null');
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
            }
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'TypedAssign') {
              if (bs.typeName === 'Structure' && bs.value.type === 'FunctionCallExpr') {
                blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'Assign') {
              const knownType = inferLiteralType(bs.value);
              if (knownType) {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'SetStatement') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
              const bk = G.ctx.stateVarNames.has(bs.name) ? stateKey(bs.name) : bs.name;
              blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${bk}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'WhileStatement') {
              blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
            }
          }
          if (fnReturnNode) {
            blockLines.push(`${I}    ${genRustFnReturn(fnReturnNode.fields, typeEnv)}`);
          } else if (fnImplRet) {
            const valExpr = genRustExpr(fnImplRet.expr, typeEnv);
            blockLines.push(`${I}    Structure { positional: vec![json!(${valExpr})], named: Map::new() }`);
          }
          lines.push(`${I}let ${tempName} = {\n${blockLines.join('\n')}\n${I}};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        } else if (calleeName && G.ctx.emitNames.has(calleeName)) {
          // Emit call in destructure context — emit_await returns Structure
          const tempName = `_r${G.ctx.fnTempCounter++}`;
          const emitExpr = genRustExpr(s.source, typeEnv);
          lines.push(`${I}let ${tempName} = Structure::pack(&${emitExpr});`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        } else if (calleeName && (G.ctx.actorFnNames.has(calleeName) || G.ctx.publicFnNames?.has('@' + calleeName))) {
          // Public function call without @ prefix — route through self_send to @name
          const effectiveSource = G.ctx.publicFnNames?.has('@' + calleeName) && !G.ctx.actorFnNames.has(calleeName)
            ? { ...s.source, callee: { ...s.source.callee, name: '@' + calleeName } }
            : s.source;
          const tempName = `_r${G.ctx.fnTempCounter++}`;
          const callExpr = genRustFnCallExpr(effectiveSource, typeEnv);
          lines.push(`${I}let ${tempName} = ${callExpr};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        }
      } else if (s.source.type === 'DotCallExpr') {
        const expr = s.source;
        const dotName = (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') ? expr.object.name : null;
        // Spawn-needing instance: dispatch via _at, with the variable
        // (a u32 instance id) as the first argument.
        if (dotName && sCtx?.selfSpawnedRefs?.has(dotName)) {
          const spawnClass = sCtx.selfSpawnedRefs.get(dotName);
          const method = JSON.stringify('@' + expr.method);
          const positional = expr.args.filter(a => a.positional);
          const named = expr.args.filter(a => !a.positional);
          const wrapArg = (e) => { const raw = genRustExpr(e, typeEnv); const t = inferLiteralType(e) || inferExprType(e, typeEnv); return toJsonValue(raw, t || 'Anything'); };
          let payload;
          if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(a => wrapArg(a.expr));
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
            payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
          } else if (positional.length > 0) {
            payload = valueArray(positional.map(a => wrapArg(a.expr)));
          } else if (named.length > 0) {
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
            payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
          } else {
            payload = 'json!({})';
          }
          const tempName = `_dc${G.ctx.fnTempCounter++}`;
          const idVar = rustSsaResolve(dotName);
          if (spawnClass === '__self__') {
            lines.push(`${I}let (${tempName}_re_opt, _, _) = self.handle_op_at(${idVar}, ${method}, &json!({}), &${payload}, "__parent", "");`);
            lines.push(`${I}let ${tempName} = ${tempName}_re_opt.unwrap_or(Value::Null);`);
          } else {
            const lc = spawnClass.toLowerCase();
            lines.push(`${I}let ${tempName} = self.child_${lc}_dispatch_at(${idVar}, ${method}, &${payload}, "", "__parent");`);
          }
          // Destructure the response — fall back to first positional when
          // the named key is missing (mirrors JS Structure.one).
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `(${tempName}).get(${JSON.stringify(key)}).cloned().or_else(|| (${tempName}).as_array().and_then(|a| a.first().cloned())).unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${mintRustSsa(item.name)} = ${accessor};`);
            }
          }
          return;
        }
        const isChild = (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && G.ctx.actorInfo.has(expr.object.callee.name)) ||
                        (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
                        (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name));
        if (isChild) {
          // Child actor dispatch — call local method directly
          let actorName;
          if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
            actorName = sCtx.childActorRefs.get(expr.object.name);
          } else {
            actorName = expr.object.callee.name;
          }
          if (expr.object.type === 'FunctionCallExpr') {
            const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
            const hasInit = expr.object.args.length > 0 || childActorObj?._supertypeBindings?.length > 0 || childActorObj?._inheritedIngests?.length > 0 || childActorObj?.initParams?.length > 0;
            if (hasInit) {
              if (expr.object.args.length > 0) {
                const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
                lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${valueArray(initArgs.split(', '))});`);
              } else {
                lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!({}));`);
              }
            }
          }
          const method = JSON.stringify('@' + expr.method);
          // Build payload from method args
          const positional = expr.args.filter(a => a.positional);
          const named = expr.args.filter(a => !a.positional);
          let payload;
          const wrapArg = (expr) => { const raw = genRustExpr(expr, typeEnv); const t = inferLiteralType(expr) || inferExprType(expr, typeEnv); return toJsonValue(raw, t || 'Anything'); };
          if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(a => wrapArg(a.expr));
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
            payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
          } else if (positional.length > 0) {
            const posVals = positional.map(a => wrapArg(a.expr));
            payload = valueArray(posVals);
          } else if (named.length > 0) {
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
            payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
          } else {
            payload = 'json!({})';
          }
          const tempName = `_dc${G.ctx.fnTempCounter++}`;
          lines.push(`${I}let ${tempName} = self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload}, "", "__parent");`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${mintRustSsa(item.name)} = ${accessor};`);
            }
          }
        } else {
          // External DotCallExpr await: send outgoing message, then await response on stdin
          const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
          // Check for wrapped child dispatch
          {const isWrappedChildD = dotObjName && G.ctx.stateVarNames.has(dotObjName) && (G.ctx.stateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !G.ctx.actorInfo.has(dotObjName) && !G.ctx.remoteInstanceVars.has(dotObjName)));
          if (isWrappedChildD) {
            const childRef = `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
            const method = JSON.stringify('@' + expr.method);
            const named = expr.args.filter(a => !a.positional);
            const positional = expr.args.filter(a => a.positional);
            const wrapArgWC = (expr) => { const raw = genRustExpr(expr, typeEnv); const t = inferLiteralType(expr) || inferExprType(expr, typeEnv); return toJsonValue(raw, t || 'Anything'); };
            let payload;
            if (positional.length === 0 && named.length === 0) {
              payload = 'json!({})';
            } else if (named.length > 0) {
              const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgWC(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
              if (positional.length > 0) {
                const posVals = positional.map(a => wrapArgWC(a.expr));
                payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
              } else {
                payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
              }
            } else {
              const posVals = positional.map(a => wrapArgWC(a.expr));
              payload = valueArray(posVals);
            }
            const tempName = `_dc${G.ctx.fnTempCounter++}`;
            lines.push(`${I}let _cn = ${childRef};`);
            lines.push(`${I}let ${tempName} = self.child_dispatch(&_cn, ${method}, &${payload}, "", "__parent");`);
            for (const item of s.pattern) {
              if (item.discard) continue;
              const key = item.key || item.name;
              const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
              if (item.type) {
                lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
              } else {
                lines.push(`${I}let ${mintRustSsa(item.name)} = ${accessor};`);
              }
            }
          } else {
          const isRemoteInst = dotObjName && G.ctx.remoteInstanceVars.has(dotObjName);
          const isLocalInst = dotObjName && G.ctx.localInstanceVars?.has(dotObjName);
          const named = expr.args.filter(a => !a.positional);
          const to = isLocalInst
            ? `${rustSsaResolve(dotObjName)}.as_str().unwrap_or("").to_string()`
            : isRemoteInst
              ? `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string().to_string()`
              : `${JSON.stringify(expr.object.name)}.to_string()`;
          const method = JSON.stringify('@' + expr.method);
          const positional = expr.args.filter(a => a.positional);
          const genArgValW = a => { const v = a.expr ? genRustExpr(a.expr, typeEnv) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv); const t = a.type || (a.expr ? inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) : typeEnv.get(a.name)); return toJsonValue(v, t || 'Anything'); };
          let opJson;
          if (positional.length === 0 && named.length === 0) {
            opJson = `json!(${method})`;
          } else if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(genArgValW);
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${genArgValW(a)});`).join(' ');
            opJson = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); _arr.push(json!(${method})); Value::Array(_arr) }`;
          } else if (named.length > 0) {
            const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${genArgValW(a)});`).join(' ');
            opJson = `{ let mut _nm = Map::new(); ${namedInserts} Value::Array(vec![Value::Object(_nm), json!(${method})]) }`;
          } else {
            const posVals = positional.map(genArgValW);
            opJson = `Value::Array(vec![Value::Array(vec![${posVals.join(', ')}]), json!(${method})])`;
          }
          const tempName = `_dc${G.ctx.fnTempCounter++}`;
          lines.push(`${I}let ${tempName}_id = {`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let send_id = seq.to_string();`);
          lines.push(`${I}    let mut send_msg = Map::new();`);
          lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
          lines.push(`${I}    send_msg.insert("op".to_string(), ${opJson});`);
          lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
          if (!isRemoteInst && (positional.length > 0 || named.length > 0)) {
            let bvaJson;
            if (positional.length > 0 && named.length > 0) {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([${posBva}, {${namedBva}}])`;
            } else if (named.length > 0) {
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([{${namedBva}}])`;
            } else {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              bvaJson = `json!([[${posBva}]])`;
            }
            lines.push(`${I}    send_msg.insert("bv-a".to_string(), ${bvaJson});`);
          }
          lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
          lines.push(`${I}    send_id`);
          lines.push(`${I}};`);
          lines.push(`${I}let ${tempName} = self.await_response(&${tempName}_id);`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${mintRustSsa(item.name)} = ${accessor};`);
            }
          }
          } // close isWrappedChildD else
          } // close isConstructsProxyD else block scope
        }
      } else {
        const srcExpr = genRustExpr(s.source, typeEnv);
        for (const item of s.pattern) {
          if (item.discard) continue;
          const itemType = typeEnv.get(item.name) || null;
          const rType = rustType(itemType);
          if (item.named) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${mintRustSsa(item.name)}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.key !== undefined) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${mintRustSsa(item.name)}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.positional) {
            const accessor = `${srcExpr}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${mintRustSsa(item.name)}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          }
        }
      }
}

// Handles Assign + FunctionCallExpr variants (actor info, actor fn names, and general fn calls).

// Function-body dep construction: t = Thing(args)
// Emits `new` outbound, awaits the reply (synchronous via await_new_response),
// and binds the resulting instance address to a local rust var. Tracks the
// local in G.ctx.localInstanceVars so subsequent t.method() calls in this
// body route to that address.
function genRustDepConstructorAsAssign(s, typeEnv, I, lines) {
  const calleeName = s.value.callee.name;
  const targetName = G.ctx.constructorCoercions?.get(calleeName) || calleeName;
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  let argsJson;
  if (positionalArgs.length === 0 && !namedBag) {
    argsJson = 'json!({})';
  } else if (namedBag) {
    const fields = Object.entries(namedBag.fields).map(([k, v]) =>
      `"${k}": ${forceJsonWrap(toJsonValue(genRustExpr(v, typeEnv), inferLiteralType(v)))}`).join(', ');
    if (positionalArgs.length > 0) {
      const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, typeEnv), inferLiteralType(a)))).join(', ');
      argsJson = `json!([${vals}, {${fields}}])`;
    } else {
      argsJson = `json!({${fields}})`;
    }
  } else {
    const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, typeEnv), inferLiteralType(a)))).join(', ');
    argsJson = `json!([${vals}])`;
  }
  G.ctx.needsAwaitNew = true;
  G.ctx.needsAwaitNew = true;
  lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(s.typeName)} = {`);
  lines.push(`${I}    let seq = self.send_seq.get();`);
  lines.push(`${I}    self.send_seq.set(seq + 1);`);
  lines.push(`${I}    let new_id = seq.to_string();`);
  lines.push(`${I}    let mut new_msg = Map::new();`);
  lines.push(`${I}    new_msg.insert("id".to_string(), json!(new_id.clone()));`);
  lines.push(`${I}    new_msg.insert("op".to_string(), json!([${argsJson}, "#new"]));`);
  lines.push(`${I}    new_msg.insert("to".to_string(), json!("${targetName}"));`);
  lines.push(`${I}    let _ = self.binding.send(Value::Object(new_msg));`);
  lines.push(`${I}    let addr = self.await_new_response(&new_id);`);
  lines.push(`${I}    let seq2 = self.send_seq.get();`);
  lines.push(`${I}    self.send_seq.set(seq2 + 1);`);
  lines.push(`${I}    let as_id = seq2.to_string();`);
  lines.push(`${I}    let mut as_msg = Map::new();`);
  lines.push(`${I}    as_msg.insert("id".to_string(), json!(as_id.clone()));`);
  lines.push(`${I}    as_msg.insert("op".to_string(), json!(["${s.typeName}", "as"]));`);
  lines.push(`${I}    as_msg.insert("to".to_string(), json!(addr.as_str().unwrap_or("")));`);
  lines.push(`${I}    let _ = self.binding.send(Value::Object(as_msg));`);
  lines.push(`${I}    let _re = self.await_response(&as_id);`);
  lines.push(`${I}    let _as_val: Value = if let Some(arr) = _re.as_array() { arr.first().cloned().unwrap_or(Value::Null) } else { Value::Null };`);
  lines.push(`${I}    ${convertFromValue('_as_val', s.typeName)}`);
  lines.push(`${I}};`);
}

function genRustDepConstructorAssign(s, typeEnv, I, lines) {
  const calleeName = s.value.callee.name;
  const targetName = G.ctx.constructorCoercions?.get(calleeName) || calleeName;
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  let argsJson;
  if (positionalArgs.length === 0 && !namedBag) {
    argsJson = 'json!({})';
  } else if (namedBag) {
    const fields = Object.entries(namedBag.fields).map(([k, v]) =>
      `"${k}": ${forceJsonWrap(toJsonValue(genRustExpr(v, typeEnv), inferLiteralType(v)))}`).join(', ');
    if (positionalArgs.length > 0) {
      const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, typeEnv), inferLiteralType(a)))).join(', ');
      argsJson = `json!([${vals}, {${fields}}])`;
    } else {
      argsJson = `json!({${fields}})`;
    }
  } else {
    const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, typeEnv), inferLiteralType(a)))).join(', ');
    argsJson = `json!([${vals}])`;
  }
  G.ctx.localInstanceVars.add(s.name);
  G.ctx.needsAwaitNew = true;
  lines.push(`${I}let ${mintRustSsa(s.name)}: Value = {`);
  lines.push(`${I}    let seq = self.send_seq.get();`);
  lines.push(`${I}    self.send_seq.set(seq + 1);`);
  lines.push(`${I}    let new_id = seq.to_string();`);
  lines.push(`${I}    let mut send_msg = Map::new();`);
  lines.push(`${I}    send_msg.insert("id".to_string(), json!(new_id.clone()));`);
  lines.push(`${I}    send_msg.insert("op".to_string(), json!([${argsJson}, "#new"]));`);
  lines.push(`${I}    send_msg.insert("to".to_string(), json!("${targetName}"));`);
  lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
  lines.push(`${I}    self.await_new_response(&new_id)`);
  lines.push(`${I}};`);
}

function genRustAssignFnCall(s, typeEnv, sCtx, I, lines, fnDefs, body, mutableVars, fns, i) {
      // Dependency constructor: t = Thing(args) → emit `new` + await reply
      if (s.value.callee?.type === 'Identifier' && G.ctx.dependencyNames.has(s.value.callee.name) && !G.ctx.destructuredMembers?.has(s.value.callee.name)) {
        genRustDepConstructorAssign(s, typeEnv, I, lines);
        return;
      }
      if (s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        // Non-ref actor instantiation — assign actor name string
        let actorName = s.value.callee.name;
        // Constructor overload dispatch: select variant by arity/types
        if (G.ctx.constructorOverloads?.has(actorName)) {
          const overloads = G.ctx.constructorOverloads.get(actorName);
          const argCount = s.value.args.filter(a => a.type !== 'NamedArgsBag').length;
          const inferArgType = arg => {
            if (arg.type === 'IntLiteral') return 'Integer';
            if (arg.type === 'StringLiteral') return 'Text';
            if (arg.type === 'DecimalLiteral') return 'Decimal';
            if (arg.type === 'BoolLiteral') return 'Boolean';
            return null;
          };
          const argTypes = s.value.args.filter(a => a.type !== 'NamedArgsBag').map(inferArgType);
          const primaryInfo = G.ctx.actorInfo.get(actorName);
          const primaryParams = (primaryInfo?.actor?.initParams || []).filter(p => p.positional);
          const candidates = [
            { className: actorName, params: primaryParams },
            ...overloads.map(ov => {
              const ovInfo = G.ctx.actorInfo.get(ov.mangledName);
              const ovParams = (ovInfo?.actor?.initParams || ov.params || []).filter(p => p.positional);
              return { className: ov.mangledName, params: ovParams };
            }),
          ];
          const match = candidates.find(c => {
            if (c.params.length !== argCount) return false;
            for (let j = 0; j < argCount; j++) {
              if (argTypes[j] && c.params[j]?.type && c.params[j].type !== 'Anything' && argTypes[j] !== c.params[j].type) return false;
            }
            return true;
          });
          if (match) actorName = match.className;
        }
        sCtx.childActorRefs.set(s.name, actorName);
        const childActor = G.ctx.actorInfo.get(actorName)?.actor;
        const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || s.value.args.length > 0 || (childActor?._supertypeBindings?.length > 0) || (childActor?._inheritedIngests?.length > 0);
        if (hasInit) {
          // Unpack named args into positional order matching constructor params
          const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
          let resolvedArgs;
          if (namedBag) {
            const initParams = childActor?.initParams || [];
            const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
            const namedFields = namedBag.fields || {};
            resolvedArgs = [];
            let posIdx = 0;
            for (const p of initParams) {
              const lookupKey = p.key || p.name;
              if (namedFields[lookupKey]) resolvedArgs.push(namedFields[lookupKey]);
              else if (p.positional && posIdx < positionalArgs.length) resolvedArgs.push(positionalArgs[posIdx++]);
              else resolvedArgs.push({ type: 'NullLiteral' }); // placeholder for omitted optional — init uses default
            }
            for (; posIdx < positionalArgs.length; posIdx++) resolvedArgs.push(positionalArgs[posIdx]);
          } else {
            resolvedArgs = s.value.args;
          }
          const initArgs = resolvedArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${valueArray(initArgs.split(', '))});`);
        }
        lines.push(`${I}let ${mintRustSsa(s.name)} = Value::String("${actorName.toLowerCase()}".to_string());`);
      } else if (s.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.value.callee.name)) {
        const fnDef = fns ? fns.find(f => f.name === s.value.callee.name) : null;
        if (fnDef && fnReturnsFunction(fnDef)) {
          // Inline fn body at call site, tracking returned function
          const fnParams = fnDef.params || [];
          const fnBody = fnDef.body || [];
          const fnReply = fnBody.find(bs => bs.type === 'Reply');
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');

          // Bind fn params at current scope
          let pPosIdx = 0;
          for (const pp of fnParams) {
            const arg = pp.positional ? callArgs[pPosIdx++] : null;
            const pt = pp.type || inferLiteralType(arg) || (pp.defaultValue ? inferLiteralType(pp.defaultValue) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : (pp.defaultValue ? genRustDefaultExpr(pp, typeEnv) : 'Value::Null');
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            lines.push(`${I}let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
          }

          // Process fn body: emit non-function statements, track function literals
          const fnLocalFunctions = new Map();
          for (const bs of fnBody) {
            if (bs.type === 'Reply') continue;
            if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
              fnLocalFunctions.set(bs.name, { node: bs.value, defIdx: i });
            } else if (bs.type === 'TypedAssign') {
              let val = genRustExpr(bs.value, typeEnv);
              if ((bs.typeName === 'Text' || bs.typeName === 'Blob') && bs.value.type === 'StringLiteral') val += '.to_string()';
              lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
            } else if (bs.type === 'Assign') {
              lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
            }
          }

          // Find the returned function from Reply and register it under the call-site name
          if (fnReply) {
            const retField = fnReply.fields.find(f =>
              f.type === 'Function' || (typeof f.type === 'string' && f.type?.includes('->')));
            if (retField) {
              const retFunction = fnLocalFunctions.get(retField.name);
              if (retFunction) {
                fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
              }
            }
          }
        } else {
          // Normal function call through Structure
          const knownType = typeEnv.get(s.name);
          if (knownType) {
            const callExpr = genRustFnCallExpr(s.value, typeEnv);
            const converted = convertFromValue(`${callExpr}.one()`, knownType);
            lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${converted};`);
          } else {
            const callExpr = genRustFnCallExpr(s.value, typeEnv);
            lines.push(`${I}let ${mintRustSsa(s.name)} = ${callExpr};`);
          }
        }
      } else {
        // General Assign + FunctionCallExpr (not actor info, not actor fn name)
        const calleeName = s.value.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        // A tracked fn returns a Function either via explicit returnType or via
        // an ImplicitReturn whose typeName is Function (the `inner as Function` form).
        const trackedReturnsFn = tracked && (() => {
          const rt = tracked.node.returnType;
          if (rt === 'Function' || (typeof rt === 'string' && rt.includes('->'))) return true;
          const implRet = (tracked.node.body || []).find(bs => bs.type === 'ImplicitReturn');
          const tn = implRet?.typeName;
          return tn === 'Function' || (typeof tn === 'string' && tn.includes('->'));
        })();
        if (trackedReturnsFn) {
          // Function-returning function: inline body at outer scope, track returned function
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const funcBody = funcNode.body || [];

          // Bind function params at current scope
          let posIdx = 0;
          for (const param of funcParams) {
            const arg = param.positional ? callArgs[posIdx++] : null;
            const pt = param.type || inferLiteralType(arg) || (param.defaultValue ? inferLiteralType(param.defaultValue) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : (param.defaultValue ? genRustDefaultExpr(param, typeEnv) : 'Value::Null');
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            lines.push(`${I}let ${rustIdent(param.name)}: ${rustType(pt)} = ${argExpr};`);
          }

          // Process body: emit non-function statements, track function literals
          const localFnDefs = new Map();
          for (const bs of funcBody) {
            if (bs.type === 'ImplicitReturn') continue;
            if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
              localFnDefs.set(bs.name, { node: bs.value, defIdx: i });
            } else if (bs.type === 'TypedAssign') {
              let val = genRustExpr(bs.value, typeEnv);
              if ((bs.typeName === 'Text' || bs.typeName === 'Blob') && bs.value.type === 'StringLiteral') val += '.to_string()';
              lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
            } else if (bs.type === 'Assign') {
              lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
            }
          }

          // Find returned function from ImplicitReturn
          const implRet = funcBody.find(bs => bs.type === 'ImplicitReturn');
          if (implRet && implRet.expr?.type === 'Identifier') {
            const retFunction = localFnDefs.get(implRet.expr.name);
            if (retFunction) {
              fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
            }
          }
        } else {
          // Normal function call in Assign
          const knownType = typeEnv.get(s.name);
          if (knownType) {
            let val = genRustExpr(s.value, typeEnv);
            if ((knownType === 'Text' || knownType === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
            if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `bv_val(${val})`;
            lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${val};`);
          } else {
            const val = genRustExpr(s.value, typeEnv);
            lines.push(`${I}let ${mintRustSsa(s.name)}: Value = ${val};`);
          }
        }
      }
}

// Handles Assign/TypedAssign + DotCallExpr on child actors.

function genRustAssignChildDotCall(s, typeEnv, sCtx, I, lines) {
      const expr = s.value;
      let actorName;
      if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
        actorName = sCtx.childActorRefs.get(expr.object.name);
      } else {
        actorName = expr.object.callee.name;
        {
          const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
          const hasInit = expr.object.args.length > 0 || childActorObj?._supertypeBindings?.length > 0 || childActorObj?._inheritedIngests?.length > 0 || childActorObj?.initParams?.length > 0;
          if (hasInit) {
            if (expr.object.args.length > 0) {
              const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
              lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${valueArray(initArgs.split(', '))});`);
            } else {
              lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!({}));`);
            }
          }
        }
      }
      const method = JSON.stringify('@' + expr.method);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let payload;
      const wrapArgDC = (expr) => { const raw = genRustExpr(expr, typeEnv); const t = inferLiteralType(expr) || inferExprType(expr, typeEnv); return toJsonValue(raw, t || 'Anything'); };
      if (positional.length > 0 && named.length > 0) {
        const posVals = positional.map(a => wrapArgDC(a.expr));
        const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgDC(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
        payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
      } else if (positional.length > 0) {
        const posVals = positional.map(a => wrapArgDC(a.expr));
        payload = valueArray(posVals);
      } else if (named.length > 0) {
        const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgDC(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
        payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
      } else {
        payload = 'json!({})';
      }
      const childCall = `self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload}, "", "__parent")`;
      const knownType = typeEnv.get(s.name);
      if (knownType) {
        // Extract single value: child dispatch returns a json object, use Structure to extract the one value
        const accessor = `{ let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() }`;
        lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
      } else {
        // Untyped: extract single positional value
        lines.push(`${I}let ${mintRustSsa(s.name)} = { let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() };`);
      }
}

// Handles Assign/TypedAssign + DotCallExpr on remote instances.

function genRustAssignRemoteDotCall(s, typeEnv, I, lines) {
      const expr = s.value;
      const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
      const isLocalInst = G.ctx.localInstanceVars?.has(dotObjName);
      const knownType = typeEnv.get(s.name);
      // Remote / local instance: send + await_response
      const to = isLocalInst
        ? `${rustSsaResolve(dotObjName)}.as_str().unwrap_or("").to_string()`
        : `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
      const method = JSON.stringify(expr.method);
      const opJson = `json!(${method})`;
      lines.push(`${I}let _await_id = {`);
      lines.push(`${I}    let seq = self.send_seq.get();`);
      lines.push(`${I}    self.send_seq.set(seq + 1);`);
      lines.push(`${I}    let send_id = seq.to_string();`);
      lines.push(`${I}    let mut send_msg = Map::new();`);
      lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
      lines.push(`${I}    send_msg.insert("op".to_string(), ${opJson});`);
      lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
      lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
      lines.push(`${I}    send_id`);
      lines.push(`${I}};`);
      lines.push(`${I}let _await_re = self.await_response(&_await_id);`);
      const accessor = `_await_re.get("${s.name}").cloned().unwrap_or(Value::Null)`;
      if (knownType) {
        lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
      } else {
        lines.push(`${I}let ${mintRustSsa(s.name)} = ${accessor};`);
      }
}

// --- End of extracted helper functions ---

// IMPORTANT: genRustLocals SETS G.ctx.ssaScope and G.ctx.ssaCounts and
// leaves them set on return so the caller can use the same scope when
// emitting the reply / implicit return. Callers must save and restore both
// themselves.
function genRustLocals(body, typeEnv, functionAnalysis, mutableVars, indent, fns, makeRetExpr = null) {
  const { fnDefs, skipSet, capturePoints } = functionAnalysis;
  const sCtx = { childActorRefs: new Map() };
  const lines = [];
  const I = indent || '                ';
  // Track lambda start index for scoped overload resolution
  const savedLambdaStartIdx = G.ctx._lambdaStartIdx;
  G.ctx._lambdaStartIdx = G.ctx.lambdaHandlers?.length || 0;
  // Fresh SSA scope for this body walk
  G.ctx.ssaScope = new Map();
  G.ctx.ssaCounts = new Map();
  // Per-handler-body local instance vars from dep constructor calls
  G.ctx.localInstanceVars = new Set();
  // Stash the active early-return expression maker on the context so nested
  // helpers (e.g. handleTypedAssign_FunctionCallExpr → inlined lambdas with a
  // `repeat while` Return) can pick it up without threading another param.
  const savedMakeRetExpr = G.ctx.makeRetExpr;
  G.ctx.makeRetExpr = makeRetExpr;

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // Emit capture points for fnDefs defined at this index
    if (capturePoints.has(i)) {
      for (const cp of capturePoints.get(i)) {
        lines.push(`${I}let ${cp.capName}: ${cp.rustType} = ${rustSsaResolve(cp.varName)};`);
      }
    }

    // Catch / label-invoke statements bypass the standard pipeline.
    {
      const catchCode = tryGenRustCatchOrLabelStmt(s, typeEnv, I);
      if (catchCode !== null) { lines.push(catchCode); continue; }
    }

    // Handle lambda overload <</Function() before skipSet to avoid interfering with function pipeline
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function') {
      if (s.value.overloadMode === 'append') {
        const existing = G.ctx.lambdaHandlers.slice(G.ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          // Store captures for overloaded lambda
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: [] };
          G.ctx.lambdaCounter++;
          G.ctx.lambdaHandlers.push(entry);
          continue; // Skip — reuse existing label
        }
      }
      if (s.value.emptyOverload) {
        // Function() initializer — register label, no handler arm
        const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
        G.ctx.lambdaVarNames.add(s.name);
        G.ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: [] });
        lines.push(`${I}let ${mintRustSsa(s.name)} = Value::String("${lambdaName}".to_string());`);
        continue;
      }
      // Check if this original function assignment is followed by overload operators
      // If so, register it as a lambda handler instead of inlining
      const hasOverload = body.slice(i + 1).some(ss =>
        (ss.type === 'Assign' || ss.type === 'TypedAssign') &&
        ss.name === s.name &&
        ss.value?.type === 'Function' &&
        ss.value.overloadMode === 'append',
      );
      if (hasOverload) {
        const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
        G.ctx.lambdaVarNames.add(s.name);
        G.ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: [] });
        lines.push(`${I}let ${mintRustSsa(s.name)} = Value::String("${lambdaName}".to_string());`);
        continue;
      }
    }

    // Skip statements that are part of the function pipeline
    // But emit recursive fnDefs as actual Rust functions
    if (skipSet.has(i)) {
      if (s.type === 'Assign' || s.type === 'TypedAssign') {
        const tracked = fnDefs.get(s.name);
        if (tracked && tracked.recursive) {
          lines.push(`${I}${genRecursiveFnDef(s.name, tracked.node, typeEnv).split('\n').join('\n' + I)}`);
        } else if (tracked && s.value.type === 'Function') {
          // Convert to a lambda-handler binding only when the function value
          // is needed beyond pure inlining: returned via Reply, captured into
          // a Structure, called by name with a non-inlinable callsite, or
          // referenced as a value (e.g. passed as an arg). Walks the rest of
          // the body for any non-inlining reference.
          let needsBinding = false;
          const matchesIdent = (n) => n?.type === 'Identifier' && n.name === s.name;
          const walkRefs = (node) => {
            if (!node || needsBinding) return;
            if (Array.isArray(node)) { for (const n of node) walkRefs(n); return; }
            if (typeof node !== 'object') return;
            if (matchesIdent(node)) { needsBinding = true; return; }
            // Reply/sigil field shorthand `:fn` parses as { name: 'fn', positional: true }
            // (no `expr`). Treat name match in a Reply context as a value reference.
            if (node.type === 'Reply') {
              for (const f of (node.fields || [])) {
                if (f.name === s.name) { needsBinding = true; return; }
                walkRefs(f);
              }
              return;
            }
            // FunctionCallExpr: callee being s.name is an inlinable callsite — the
            // function pipeline handles it. Don't treat it as a value reference.
            if (node.type === 'FunctionCallExpr') {
              for (const a of (node.args || [])) walkRefs(a);
              return;
            }
            for (const key of Object.keys(node)) walkRefs(node[key]);
          };
          for (let j = 0; j < body.length && !needsBinding; j++) {
            if (j === i) continue;
            walkRefs(body[j]);
          }
          if (needsBinding) {
            // Register lambda as a dispatch handler with captured variables
            const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
            const fnNode = tracked.node;
            // Find free variables (identifiers used but not defined as params or locals)
            const freeVars = [];
            const paramNames = new Set((fnNode.params || []).map(p => p.name));
            // Collect variables assigned inside the lambda body — these are locals, not captures
            const bodyLocals = new Set();
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') bodyLocals.add(bs.name);
            }
            const localScope = new Set([...paramNames, ...bodyLocals]);
            function walkForIdents(expr, innerScope = localScope) {
              if (!expr) return;
              if (expr.type === 'Identifier' && !innerScope.has(expr.name)) freeVars.push(expr.name);
              if (expr.type === 'BinaryExpr') { walkForIdents(expr.left, innerScope); walkForIdents(expr.right, innerScope); }
              if (expr.type === 'FunctionCallExpr') {
                if (expr.callee) walkForIdents(expr.callee, innerScope);
                for (const a of (expr.args || [])) walkForIdents(a, innerScope);
              }
              // Nested Function: recurse into its body, with that function's
              // params + body-locals added to scope. Free vars of the nested
              // fn that aren't in the outer's local scope still bubble up so
              // the outer lambda captures them for the nested lambda's use.
              if (expr.type === 'Function') {
                const nestedParams = new Set((expr.params || []).map(p => p.name));
                const nestedLocals = new Set();
                if (expr.body) for (const bs of expr.body) {
                  if (bs.type === 'TypedAssign' || bs.type === 'Assign') nestedLocals.add(bs.name);
                }
                const nestedScope = new Set([...innerScope, ...nestedParams, ...nestedLocals]);
                if (expr.body) for (const bs of expr.body) {
                  if (bs.type === 'ImplicitReturn') walkForIdents(bs.expr, nestedScope);
                  if (bs.type === 'TypedAssign' || bs.type === 'Assign') walkForIdents(bs.value, nestedScope);
                  if (bs.expr) walkForIdents(bs.expr, nestedScope);
                }
                if (expr.expr) walkForIdents(expr.expr, nestedScope);
              }
            }
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'ImplicitReturn') walkForIdents(bs.expr);
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') walkForIdents(bs.value);
              if (bs.expr) walkForIdents(bs.expr);
            }
            if (fnNode.expr) walkForIdents(fnNode.expr);
            // Deduplicate and filter out actor function names (those are self-sends, not captures)
            const uniqueFreeVars = [...new Set(freeVars)].filter(v => !G.ctx.actorFnNames.has(v));
            // Store captures in actor state — resolve through OUTER scope
            // before descending into the lambda body.
            for (const v of uniqueFreeVars) {
              const capType = typeEnv.get(v);
              const capVal = rustSsaResolve(v);
              const capJson = capType === 'Integer' ? intToValue(capVal) : `json!(${capVal})`;
              lines.push(`${I}self.state.insert("_cap_${lambdaName}_${v}".to_string(), ${capJson});`);
            }
            G.ctx.lambdaHandlers.push({ name: lambdaName, fn: fnNode, captures: uniqueFreeVars.map(v => ({ name: v, lambdaName })) });
            G.ctx.lambdaVarNames.add(s.name);
            lines.push(`${I}let ${mintRustSsa(s.name)} = Value::String("${lambdaName}".to_string());`);
          }
        }
      }
      continue;
    }

    if (s.type === 'TypedAssign') {
      if (genRustTypedAssign(s, typeEnv, fnDefs, sCtx, I, lines, i, body, mutableVars, fns, functionAnalysis)) continue;
    } else if (s.type === 'DestructureAssign') {
      genRustDestructureAssign(s, typeEnv, sCtx, I, lines, i, fnDefs);
    } else if (s.type === 'Assign' && s.value.type === 'FunctionCallExpr') {
      genRustAssignFnCall(s, typeEnv, sCtx, I, lines, fnDefs, body, mutableVars, fns, i);
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && (
      (s.value.object.type === 'FunctionCallExpr' && s.value.object.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.object.callee.name)) ||
      (s.value.object.type === 'RefRead' && sCtx.childActorRefs.has(s.value.object.name)) ||
      (s.value.object.type === 'Identifier' && sCtx.childActorRefs.has(s.value.object.name))
    )) {
      genRustAssignChildDotCall(s, typeEnv, sCtx, I, lines);
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotAccessExpr' && s.value.object?.type === 'Identifier' && sCtx.childActorRefs.has(s.value.object.name)) {
      // Bare field read on a child actor: v = c.val — dispatch the synthesized
      // getter "@field" and pack the wire reply to extract the single positional.
      const actorName = sCtx.childActorRefs.get(s.value.object.name);
      const method = JSON.stringify('@' + s.value.property);
      const childCall = `self.child_${actorName.toLowerCase()}_dispatch(${method}, &json!({}), "", "__parent")`;
      const accessor = `{ let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() }`;
      const knownType = (s.type === 'TypedAssign') ? s.typeName : typeEnv.get(s.name);
      if (knownType) {
        lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
      } else {
        lines.push(`${I}let ${mintRustSsa(s.name)} = ${accessor};`);
      }
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && (() => {
      const dotObj = s.value.object;
      const dn = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
      const match = dn && (G.ctx.remoteInstanceVars.has(dn) || G.ctx.localInstanceVars?.has(dn));
      return match;
    })()) {
      genRustAssignRemoteDotCall(s, typeEnv, I, lines);
    } else if (s.type === 'Assign') {
      const isStructLiteral = s.value.type === 'StructureLiteral' || s.value.type === 'StructureConstructor';
      if (isStructLiteral) {
        const rhs = genRustExpr(s.value, typeEnv);
        lines.push(`${I}let ${mintRustSsa(s.name)} = ${rhs};`);
      } else {
        // Use known type from typeEnv for proper Rust type
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          let val = genRustExpr(s.value, typeEnv);
          if ((knownType === 'Text' || knownType === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
          if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `bv_val(${val})`;
          lines.push(`${I}let ${mintRustSsa(s.name)}: ${rustType(knownType)} = ${val};`);
        } else {
          const val = genRustExpr(s.value, typeEnv);
          lines.push(`${I}let ${mintRustSsa(s.name)}: Value = ${val};`);
        }
      }
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'WhileStatement') {
      lines.push(genRustWhileStatement(s, typeEnv, I, makeRetExpr));
    } else if (s.type === 'RefDecl') {
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorInfo.has(s.value.callee.name)) {
        // Child actor ref — track mapping, call init if needed
        sCtx.childActorRefs.set(s.name, s.value.callee.name);
        const actorName = s.value.callee.name;
        {
          const childActorObj = G.ctx.actorInfo.get(actorName)?.actor;
          if (s.value.args.length > 0 || childActorObj?._supertypeBindings?.length > 0) {
            const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
            lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&${valueArray(initArgs.split(', '))});`);
          }
        }
      } else {
        const val = s.value ? genRustExpr(s.value, typeEnv) : 'Value::Null';
        const t = s.typeName || inferLiteralType(s.value);
        // Local refs (self.refs) use bare names; only state slots (self.state) get the namespace prefix.
        const k = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
        lines.push(`${I}${rsStore(s.name)}.insert("${k}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    } else if (s.type === 'SetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        const val = genRustExpr(s.value, typeEnv);
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &${valueArray([val])}, "", "__parent");`);
      } else if (!G.ctx.stateVarNames.has(s.name) && !G.ctx.refNames?.has(s.name)) {
        throw new Error(`Cannot set '${s.name}' — only 'ref' variables and actor instances support '<-'`);
      } else if (s.value?.type === 'Function') {
        // Lambda assignment to state/ref var — register handler, store label
        const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
        G.ctx.lambdaHandlers.push({ name: lambdaName, fn: s.value });
        const kk = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
        lines.push(`${I}${rsStore(s.name)}.insert("${kk}".to_string(), json!("${lambdaName}"));`);
      } else {
        // If the RHS is a list literal containing spawn-needing actor
        // constructions, hoist each spawn into a `let` binding before the
        // state insert. The spawn IIFEs use `&mut self` internally, which
        // collides with the outer `self.state.insert` borrow if inlined.
        if (s.value?.type === 'ListLiteral' &&
            s.value.elements.some(e => e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && G.ctx.actorInfo?.has(e.callee.name) && classNeedsSpawnedInstances(G.ctx.actorInfo.get(e.callee.name)?.actor))) {
          const elemNames = [];
          for (let ei = 0; ei < s.value.elements.length; ei++) {
            const e = s.value.elements[ei];
            const ev = `_sv${ei}_${G.ctx.fnTempCounter++}`;
            elemNames.push(ev);
            const inner = genRustExpr(e, typeEnv);
            lines.push(`${I}let ${ev} = ${inner};`);
          }
          const kk = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
          lines.push(`${I}${rsStore(s.name)}.insert("${kk}".to_string(), Value::Array(vec![${elemNames.map(n => `bv_val(${n})`).join(', ')}]));`);
        } else {
          const val = genRustExpr(s.value, typeEnv);
          const t = typeEnv.get(s.name) || inferLiteralType(s.value);
          const kk = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
          lines.push(`${I}${rsStore(s.name)}.insert("${kk}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        }
        // In-process subscribers: dispatch the new value to each spawn-
        // needing instance subscribed to this cell via constructor-param
        // ref. Only emitted in the file class context — child class state
        // mutations don't share the host's inproc_cell_subs map (the
        // Actor field is a single map and subs registered on the host's
        // cell of the same name shouldn't fire when the child writes to
        // its own state slot).
        if (G.ctx.stateVarNames.has(s.name) && !G.ctx.childStatePrefix) {
          lines.push(`${I}{`);
          lines.push(`${I}    let _subs = self.inproc_cell_subs.get(${JSON.stringify(s.name)}).cloned().unwrap_or_default();`);
          lines.push(`${I}    let _new_val = self.state.get(${JSON.stringify(stateKey(s.name))}).cloned().unwrap_or(Value::Null);`);
          lines.push(`${I}    for (_cls, _id, _cb) in _subs {`);
          // Dispatch via the right child class's dispatch_at. Build a
          // match on the class string to call the appropriate method.
          for (const [actorName] of (G.ctx.actorInfo || new Map())) {
            const lc = actorName.toLowerCase();
            const classInfo = G.ctx.actorInfo.get(actorName);
            if (classInfo && classNeedsSpawnedInstances(classInfo.actor || classInfo)) {
              lines.push(`${I}        if _cls == ${JSON.stringify(lc)} {`);
              lines.push(`${I}            self.child_${lc}_dispatch_at(_id, &_cb, &Value::Array(vec![_new_val.clone()]), "", "__parent");`);
              lines.push(`${I}        }`);
            }
          }
          lines.push(`${I}    }`);
          lines.push(`${I}}`);
        }
        // Derived fn replay: for every non-silent @/# fn that captures this
        // ref, re-dispatch per subscriber with their stored args so their
        // handlers get the updated computed value.
        const derivedFns = G.ctx._refCapturedBy?.get(s.name);
        if (derivedFns && derivedFns.size > 0) {
          const childPrefix = G.ctx.childStatePrefix;
          const inChild = !!childPrefix;
          const dispatchCall = inChild
            ? `self.child_${childPrefix}_dispatch(_fn_op, &_fn_payload, &_fn_sub_id, "__parent")`
            : `{ let (r, _, _) = self.handle_op(_fn_op, &_fn_msg, &_fn_payload, "__parent", &_fn_sub_id); r.unwrap_or(Value::Null) }`;
          const subsKeyFor = (fnFull) => inChild
            ? `format!("${childPrefix}_cell_subs_{}", "${fnFull.slice(1)}")`
            : null;
          for (const fnFullName of derivedFns) {
            const selector = fnFullName;
            const bare = fnFullName.slice(1);
            if (inChild) {
              // Child subs are stored as JSON array of {id, from, args, bva}.
              lines.push(`${I}{`);
              lines.push(`${I}    let _fn_subs = self.state.get(&${subsKeyFor(fnFullName)}).and_then(|v| v.as_array().cloned()).unwrap_or_default();`);
              lines.push(`${I}    for _sub in _fn_subs {`);
              lines.push(`${I}        let _fn_sub_id = _sub.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();`);
              lines.push(`${I}        let _fn_sub_from = _sub.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string();`);
              lines.push(`${I}        let _fn_sub_args = _sub.get("args").cloned().unwrap_or(Value::Null);`);
              lines.push(`${I}        let _fn_op = "${selector}";`);
              lines.push(`${I}        let _fn_payload = _fn_sub_args.clone();`);
              lines.push(`${I}        let _fn_re = ${dispatchCall};`);
              lines.push(`${I}        if _fn_sub_from == "__parent" {`);
              lines.push(`${I}            if let Some(slot_val) = self.state.get(&format!("_sub_slot_{}", _fn_sub_id)).cloned() {`);
              lines.push(`${I}                let slot = slot_val.as_i64().unwrap_or(-1);`);
              lines.push(`${I}                self.dispatch_sub(slot, &_fn_re);`);
              lines.push(`${I}            }`);
              lines.push(`${I}        } else {`);
              lines.push(`${I}            let mut _fn_resp = Map::new();`);
              lines.push(`${I}            _fn_resp.insert("id".to_string(), json!(_fn_sub_id));`);
              lines.push(`${I}            _fn_resp.insert("re".to_string(), _fn_re);`);
              lines.push(`${I}            _fn_resp.insert("to".to_string(), json!(_fn_sub_from));`);
              lines.push(`${I}            let _ = self.binding.send(Value::Object(_fn_resp));`);
              lines.push(`${I}        }`);
              lines.push(`${I}    }`);
              lines.push(`${I}}`);
            } else {
              // Main actor subs are stored in cell_subs as (id, from, args, bva).
              lines.push(`${I}{`);
              lines.push(`${I}    let _fn_subs = self.cell_subs.get(${JSON.stringify(bare)}).cloned().unwrap_or_default();`);
              lines.push(`${I}    for (_fn_sub_id, _fn_sub_from, _fn_sub_args, _fn_sub_bva) in _fn_subs {`);
              lines.push(`${I}        let _fn_op = "${selector}";`);
              lines.push(`${I}        let _fn_payload = _fn_sub_args.clone();`);
              lines.push(`${I}        let mut _fn_msg = Map::new();`);
              lines.push(`${I}        _fn_msg.insert("id".to_string(), json!(_fn_sub_id.clone()));`);
              lines.push(`${I}        _fn_msg.insert("op".to_string(), json!(_fn_op));`);
              lines.push(`${I}        if !_fn_sub_bva.is_null() { _fn_msg.insert("bv-a".to_string(), _fn_sub_bva.clone()); }`);
              lines.push(`${I}        let _fn_msg_v = Value::Object(_fn_msg);`);
              lines.push(`${I}        let (_fn_re_opt, _fn_bva_opt, _) = self.handle_op(_fn_op, &_fn_msg_v, &_fn_payload, "__parent", &_fn_sub_id);`);
              lines.push(`${I}        let _fn_re = _fn_re_opt.unwrap_or(Value::Null);`);
              lines.push(`${I}        if _fn_sub_from == "__parent" {`);
              lines.push(`${I}            if let Some(slot_val) = self.state.get(&format!("_sub_slot_{}", _fn_sub_id)).cloned() {`);
              lines.push(`${I}                let slot = slot_val.as_i64().unwrap_or(-1);`);
              lines.push(`${I}                self.dispatch_sub(slot, &_fn_re);`);
              lines.push(`${I}            }`);
              lines.push(`${I}        } else {`);
              lines.push(`${I}            let mut _fn_resp = Map::new();`);
              lines.push(`${I}            _fn_resp.insert("id".to_string(), json!(_fn_sub_id));`);
              lines.push(`${I}            _fn_resp.insert("re".to_string(), _fn_re);`);
              lines.push(`${I}            if let Some(_b) = _fn_bva_opt { _fn_resp.insert("bv-a".to_string(), _b); }`);
              lines.push(`${I}            _fn_resp.insert("to".to_string(), json!(_fn_sub_from));`);
              lines.push(`${I}            let _ = self.binding.send(Value::Object(_fn_resp));`);
              lines.push(`${I}        }`);
              lines.push(`${I}    }`);
              lines.push(`${I}}`);
            }
          }
        }
      }
    } else if (s.type === 'ActorSetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        const posArgExprs = s.args.filter(a => a.positional).map(a => {
          const raw = genRustExpr(a.expr, typeEnv);
          const t = inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv);
          return toJsonValue(raw, t || 'Anything');
        });
        const namedArgs = s.args.filter(a => !a.positional);
        if (namedArgs.length > 0) {
          const namedInserts = namedArgs.map(a => {
            const raw = genRustExpr(a.expr, typeEnv);
            const t = inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv);
            return `_nm.insert("${a.name}".to_string(), ${toJsonValue(raw, t || 'Anything')});`;
          }).join(' ');
          if (posArgExprs.length > 0) {
            lines.push(`${I}{ let mut _arr: Vec<Value> = vec![${posArgExprs.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &Value::Array(_arr), "", "__parent"); }`);
          } else {
            lines.push(`${I}{ let mut _nm = Map::new(); ${namedInserts} self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &Value::Object(_nm), "", "__parent"); }`);
          }
        } else {
          lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &${valueArray(posArgExprs)}, "", "__parent");`);
        }
      }
    } else if (s.type === 'ActorFieldSet') {
      // c.field <- v — dispatch the synthesized setter. Internal selector
      // (for direct child_dispatch calls) is compound "set@field"; remote
      // wire shape is bare "set" op, full address as "#<alias selector>".
      const internalSetSelector = 'set@' + s.fieldName;
      const toSelector = '@' + s.fieldName;
      const val = genRustExpr(s.value, typeEnv);
      if (sCtx.selfSpawnedRefs?.has(s.objectName)) {
        // Spawn-needing instance: dispatch the set via the per-instance
        // handler. The set is silent; we discard the return value.
        // The value being assigned (e.g. another instance ref) may itself
        // be a u32 instance id — convert to Value::Number for the payload.
        const spawnClass = sCtx.selfSpawnedRefs.get(s.objectName);
        const idVar = rustSsaResolve(s.objectName);
        const valIsSpawnRef = s.value?.type === 'Identifier' && sCtx.selfSpawnedRefs?.has(s.value.name);
        const valWrapped = valIsSpawnRef
          ? `Value::Number(serde_json::Number::from(${val}))`
          : toJsonValue(val, inferLiteralType(s.value) || inferExprType(s.value, typeEnv) || 'Anything');
        if (spawnClass === '__self__') {
          lines.push(`${I}let _ = self.handle_op_at(${idVar}, "${internalSetSelector}", &json!({}), &Value::Array(vec![${valWrapped}]), "__parent", "");`);
        } else {
          const lc = spawnClass.toLowerCase();
          lines.push(`${I}self.child_${lc}_dispatch_at(${idVar}, "${internalSetSelector}", &Value::Array(vec![${valWrapped}]), "", "__parent");`);
        }
      } else if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.objectName)) {
        const actorName = sCtx.childActorRefs.get(s.objectName);
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${internalSetSelector}", &${valueArray([val])}, "", "__parent");`);
      } else if (G.ctx.childVarToActor?.has(s.objectName)) {
        // Module-level state var holding a child actor instance.
        const actorName = G.ctx.childVarToActor.get(s.objectName);
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${internalSetSelector}", &${valueArray([val])}, "", "__parent");`);
      } else if (G.ctx.dependencyNames?.has(s.objectName) && !G.ctx.stateVarNames?.has(s.objectName)) {
        // Remote dep declared via `*( "Alias": (Alias) { ... } )`: post the
        // set message via binding.send with bare "set" op and the full
        // address as "#<alias selector>" (hash-angle delimited).
        // Include bv-a with the value's type so the remote's schema/type
        // check passes. Route val through toJsonValue so typed RHS (e.g.
        // BigInt) lands as a serializable Value in the op payload.
        const typeHint = s.value?.type === 'Identifier'
          ? (typeEnv.get(s.value.name) || null)
          : (inferLiteralType(s.value) || null);
        const valAsValue = toJsonValue(val, typeHint || 'Anything');
        const bvaPart = typeHint
          ? `\n${I}    set_msg.insert("bv-a".to_string(), json!([[${JSON.stringify(typeHint)}]]));`
          : '';
        const toFieldStr = '#<' + s.objectName + ' ' + toSelector + '>';
        lines.push(`${I}{`);
        lines.push(`${I}    let mut set_msg = Map::new();`);
        lines.push(`${I}    set_msg.insert("op".to_string(), Value::Array(vec![Value::Array(vec![${valAsValue}]), json!("#set")]));`);
        lines.push(`${I}    set_msg.insert("to".to_string(), json!(${JSON.stringify(toFieldStr)}));${bvaPart}`);
        lines.push(`${I}    let _ = self.binding.send(Value::Object(set_msg));`);
        lines.push(`${I}}`);
      }
    } else if (s.type === 'ListDestructure') {
      lines.push(genRustListDestructure(s, typeEnv, I));
    } else if (s.type === 'IfStatement') {
      const cond = genRustCondition(s.cond, typeEnv);
      const bodyLines = [];
      for (const bs of s.body) {
        if (bs.type === 'SetStatement') {
          if (sCtx.childActorRefs && sCtx.childActorRefs.has(bs.name)) {
            const actorName = sCtx.childActorRefs.get(bs.name);
            const wireOp = bs.updateOp === '<|' ? 'update' : 'set';
            const val = genRustExpr(bs.value, typeEnv);
            bodyLines.push(`${I}    self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &${valueArray([val])}, "", "__parent");`);
          } else {
            const val = genRustExpr(bs.value, typeEnv);
            const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
            const bk = G.ctx.stateVarNames.has(bs.name) ? stateKey(bs.name) : bs.name;
            bodyLines.push(`${I}    ${rsStore(bs.name)}.insert("${bk}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
          }
        } else if (bs.type === 'StateAssign') {
          const val = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
          bodyLines.push(`${I}    self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        } else if (bs.type === 'ExprStatement') {
          bodyLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
        }
      }
      lines.push(`${I}if ${cond} {\n${bodyLines.join('\n')}\n${I}}`);
    } else if (s.type === 'SpawnStatement') {
      if (s.call.type === 'FunctionCallExpr' && s.call.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.call.callee.name)) {
        const callExpr = genRustFnCallExpr(s.call, typeEnv);
        lines.push(`${I}let _ = ${callExpr};`);
      } else if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genRustExpr(s.call, typeEnv)};`);
      }
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'SubscribeCall') {
        const target = s.expr.target;
        const isSelfTarget = target?.type === 'Identifier' &&
          (target.name.startsWith('@') || target.name.startsWith('#'));
        if (!isSelfTarget && (target?.type !== 'DotAccessExpr' || target.object?.type !== 'Identifier')) {
          throw new Error('subscribe: target must be self (@name / #name) or <remoteOrChild>.<field>');
        }
        const objectName = isSelfTarget ? null : target.object.name;
        // Internal selector (for direct handle_op / child_dispatch calls):
        // compound "subscribe@<name>" / "subscribe#<name>".
        // Wire op (for outbound binding.send): "@subscribe" — the
        // @<field> goes into the to-field space-delimited after the
        // angle-delimited alias.
        const internalSelector = isSelfTarget
          ? 'subscribe' + target.name[0] + target.name.slice(1)
          : 'subscribe@' + target.property;
        const wireOp = '@subscribe';
        const toSelector = isSelfTarget ? target.name : ('@' + target.property);

        // Infer the target's return type so the dispatch_sub body destructures
        // the re value into a typed local (e.g. BigInt for Integer cells), not
        // a raw Value. Without this, SetStatement assignments to typed state
        // vars hit type mismatches in generated Rust.
        const findFnReturnType = (actorName, fnName) => {
          let actor;
          if (actorName && G.ctx.actorInfo?.has(actorName)) {
            actor = G.ctx.actorInfo.get(actorName).actor;
          } else if (actorName === (G.ctx.currentActorName || '')) {
            actor = G.ctx.currentActor;
          }
          if (!actor) return null;
          const fn = actor.functions?.find(f => f.name === fnName);
          if (!fn) return null;
          const reply = fn.body?.find(st => st.type === 'Reply');
          if (reply && reply.fields?.length === 1) return reply.fields[0].type || null;
          const impl = fn.body?.find(st => st.type === 'ImplicitReturn');
          if (impl) {
            if (impl.typeName) return impl.typeName;
            // Walk the body with a type env seeded from the actor's state refs
            // so `{ body * 2 }` resolves to Integer when body is *Integer.
            // Normalize RefRead to Identifier so inferExprType's Identifier
            // typeEnv lookup finds the ref.
            const localEnv = new Map();
            for (const sv of (actor.stateVarDecls || [])) {
              if (sv.name && sv.typeName) localEnv.set(sv.name, sv.typeName);
            }
            for (const p of (fn.params || [])) {
              if (p.name && p.type) localEnv.set(p.name, p.type);
            }
            const norm = (node) => {
              if (!node || typeof node !== 'object') return node;
              if (Array.isArray(node)) return node.map(norm);
              if (node.type === 'RefRead') {
                return { type: 'Identifier', name: node.name };
              }
              const out = {};
              for (const k of Object.keys(node)) out[k] = norm(node[k]);
              return out;
            };
            const inferred = inferExprType(norm(impl.expr), localEnv);
            if (inferred) return inferred;
          }
          return null;
        };
        // Pull `fieldName: <type>` or `fieldName: *<type>` out of a dep's
        // declared interface string (`{ val: *Integer }`). Crude but
        // sufficient for type-naming the re callback param.
        const findRemoteFieldType = (depName, fieldName) => {
          const iface = G.ctx.dependencyInterfaces?.get(depName);
          if (!iface) return null;
          // Match either `field: *Type` (cell) or `field: (args) -> Type` (fn).
          const cellRe = new RegExp(`\\b${fieldName}\\s*:\\s*(\\w+)\\s*!`);
          const mCell = iface.match(cellRe);
          if (mCell) return mCell[1];
          const fnRe = new RegExp(`\\b${fieldName}\\s*:\\s*\\([^)]*\\)\\s*->\\s*\\(?\\s*(?::?\\w+\\s+)?(\\w+)`);
          const mFn = iface.match(fnRe);
          if (mFn) return mFn[1];
          return null;
        };
        let inferredParamType = null;
        if (isSelfTarget) {
          inferredParamType = findFnReturnType(G.ctx.currentActorName || '', target.name);
        } else {
          const childActorType = G.ctx.childVarToActor?.get(objectName);
          if (childActorType) {
            inferredParamType = findFnReturnType(childActorType, '@' + target.property);
          } else if (G.ctx.dependencyNames?.has(objectName)) {
            inferredParamType = findRemoteFieldType(objectName, target.property);
          }
        }
        const slotParams = [...(s.expr.params || [])];
        if (slotParams[0] && !slotParams[0].type && inferredParamType) {
          slotParams[0] = { ...slotParams[0], type: inferredParamType };
        }

        // Register the subscribe handler slot; body is emitted later into a
        // match inside receive().
        if (!G.ctx.subscribeSlots) G.ctx.subscribeSlots = [];
        const slot = G.ctx.subscribeSlots.length;
        G.ctx.subscribeSlots.push({
          slot,
          params: slotParams,
          body: s.expr.body,
        });

        // Build op + payload + bva from the subscribe's caller-side args.
        const args = s.expr.args || [];
        const positional = args.filter(a => a.positional);
        const named = args.filter(a => !a.positional);
        const wrapArg = (a) => {
          const raw = genRustExpr(a.expr, typeEnv);
          const t = a.typeName || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) || 'Anything';
          return toJsonValue(raw, t);
        };
        const typeOf = (a) => a.typeName || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) || null;
        // Build two opExpr forms: wireOpExpr (bare "subscribe" for outbound
        // posts) and internalOpExpr (compound selector for inline handle_op /
        // child_dispatch, where the subscribe@/# prologue pattern-matches the
        // full compound).
        const buildOpExpr = (opStr) => {
          if (positional.length === 0 && named.length === 0) {
            return `json!(${JSON.stringify(opStr)})`;
          }
          if (named.length > 0 && positional.length === 0) {
            const inserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a)});`).join(' ');
            return `{ let mut _nm = Map::new(); ${inserts} Value::Array(vec![Value::Object(_nm), json!(${JSON.stringify(opStr)})]) }`;
          }
          if (positional.length > 0 && named.length === 0) {
            const vals = positional.map(wrapArg).join(', ');
            return `Value::Array(vec![Value::Array(vec![${vals}]), json!(${JSON.stringify(opStr)})])`;
          }
          const vals = positional.map(wrapArg).join(', ');
          const inserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArg(a)});`).join(' ');
          return `{ let mut _nm = Map::new(); ${inserts} Value::Array(vec![${vals}, Value::Object(_nm), json!(${JSON.stringify(opStr)})]) }`;
        };
        const wireOpExpr = buildOpExpr(wireOp);
        const internalOpExpr = buildOpExpr(internalSelector);
        let payloadExpr = 'Value::Null';
        let bvaExpr = null;
        if (named.length > 0 && positional.length === 0) {
          const pInserts = named.map(a => `_pnm.insert("${a.name}".to_string(), ${wrapArg(a)});`).join(' ');
          payloadExpr = `{ let mut _pnm = Map::new(); ${pInserts} Value::Object(_pnm) }`;
          const bvaInserts = named.map(a => `_bn.insert("${a.name}".to_string(), json!(${JSON.stringify(typeOf(a))}));`).join(' ');
          bvaExpr = `{ let mut _bn = Map::new(); ${bvaInserts} Value::Array(vec![Value::Object(_bn)]) }`;
        } else if (positional.length > 0 && named.length === 0) {
          const vals = positional.map(wrapArg).join(', ');
          payloadExpr = `Value::Array(vec![${vals}])`;
          const bvaVals = positional.map(a => `json!(${JSON.stringify(typeOf(a))})`).join(', ');
          bvaExpr = `Value::Array(vec![Value::Array(vec![${bvaVals}])])`;
        } else if (positional.length > 0 && named.length > 0) {
          const vals = positional.map(wrapArg).join(', ');
          payloadExpr = `{ let mut _pnm = Map::new(); ${named.map(a => `_pnm.insert("${a.name}".to_string(), ${wrapArg(a)});`).join(' ')} Value::Array(vec![${vals}, Value::Object(_pnm)]) }`;
          const bvaVals = positional.map(a => `json!(${JSON.stringify(typeOf(a))})`).join(', ');
          const bvaInserts = named.map(a => `_bn.insert("${a.name}".to_string(), json!(${JSON.stringify(typeOf(a))}));`).join(' ');
          bvaExpr = `{ let mut _bn = Map::new(); ${bvaInserts} Value::Array(vec![${bvaVals}, Value::Object(_bn)]) }`;
        }

        const isRemoteDep = !isSelfTarget &&
          G.ctx.dependencyNames?.has(objectName) && !G.ctx.stateVarNames?.has(objectName);
        const childActorType = !isSelfTarget && G.ctx.childVarToActor?.get(objectName);

        if (isSelfTarget) {
          // Self-dispatch: call handle_op inline with the compound selector
          // so the subscribe@/# prologue fires. sub_msg's op carries the
          // compound too for the prologue's args extraction.
          lines.push(`${I}{`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let sub_id = seq.to_string();`);
          lines.push(`${I}    self.state.insert(format!("_sub_slot_{}", sub_id), json!(${slot}));`);
          lines.push(`${I}    let mut sub_msg = Map::new();`);
          lines.push(`${I}    sub_msg.insert("id".to_string(), json!(sub_id.clone()));`);
          lines.push(`${I}    sub_msg.insert("op".to_string(), ${internalOpExpr});`);
          if (bvaExpr) lines.push(`${I}    sub_msg.insert("bv-a".to_string(), ${bvaExpr});`);
          lines.push(`${I}    let (initial, _, _) = self.handle_op(${JSON.stringify(internalSelector)}, &Value::Object(sub_msg), &${payloadExpr}, "__parent", &sub_id);`);
          lines.push(`${I}    if let Some(re_val) = initial { self.dispatch_sub(${slot}, &re_val); }`);
          lines.push(`${I}}`);
        } else if (isRemoteDep) {
          // Remote wire: bare "subscribe" op, full address as "#<alias selector>".
          const toFieldStr = '#<' + objectName + ' ' + toSelector + '>';
          lines.push(`${I}{`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let sub_id = seq.to_string();`);
          lines.push(`${I}    self.state.insert(format!("_sub_slot_{}", sub_id), json!(${slot}));`);
          lines.push(`${I}    let mut sub_msg = Map::new();`);
          lines.push(`${I}    sub_msg.insert("id".to_string(), json!(sub_id));`);
          lines.push(`${I}    sub_msg.insert("op".to_string(), ${wireOpExpr});`);
          lines.push(`${I}    sub_msg.insert("to".to_string(), json!(${JSON.stringify(toFieldStr)}));`);
          if (bvaExpr) lines.push(`${I}    sub_msg.insert("bv-a".to_string(), ${bvaExpr});`);
          lines.push(`${I}    let _ = self.binding.send(Value::Object(sub_msg));`);
          lines.push(`${I}}`);
        } else if (childActorType) {
          const _actorType = childActorType;
          lines.push(`${I}{`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let sub_id = seq.to_string();`);
          lines.push(`${I}    self.state.insert(format!("_sub_slot_{}", sub_id), json!(${slot}));`);
          lines.push(`${I}    let initial = self.child_${_actorType.toLowerCase()}_dispatch(${JSON.stringify(internalSelector)}, &${payloadExpr}, &sub_id, "__parent");`);
          lines.push(`${I}    self.dispatch_sub(${slot}, &initial);`);
          lines.push(`${I}}`);
        } else {
          throw new Error(`subscribe: target '${objectName}' is not a known remote dep, local child actor, or self`);
        }
        continue;
      }
      if (s.expr.type === 'DotCallExpr' && (() => {
        const dotObjName = s.expr.object.type === 'RefRead' ? s.expr.object.name : (s.expr.object.type === 'Identifier' ? s.expr.object.name : null);
        return dotObjName && sCtx.selfSpawnedRefs?.has(dotObjName);
      })()) {
        // Fire-and-forget DotCallExpr on a spawn-needing instance.
        const expr = s.expr;
        const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
        const spawnClass = sCtx.selfSpawnedRefs.get(dotObjName);
        const idVar = rustSsaResolve(dotObjName);
        const method = JSON.stringify('@' + expr.method);
        const positional = expr.args.filter(a => a.positional);
        const named = expr.args.filter(a => !a.positional);
        const wrapArgSA = (e) => { const raw = genRustExpr(e, typeEnv); const t = inferLiteralType(e) || inferExprType(e, typeEnv); return toJsonValue(raw, t || 'Anything'); };
        let payload;
        if (positional.length > 0 && named.length > 0) {
          const posVals = positional.map(a => wrapArgSA(a.expr));
          const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgSA(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
          payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
        } else if (positional.length > 0) {
          payload = valueArray(positional.map(a => wrapArgSA(a.expr)));
        } else if (named.length > 0) {
          const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgSA(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
          payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
        } else {
          payload = 'json!({})';
        }
        if (spawnClass === '__self__') {
          lines.push(`${I}let _ = self.handle_op_at(${idVar}, ${method}, &json!({}), &${payload}, "__parent", "");`);
        } else {
          const lc = spawnClass.toLowerCase();
          lines.push(`${I}self.child_${lc}_dispatch_at(${idVar}, ${method}, &${payload}, "", "__parent");`);
        }
      } else if (s.expr.type === 'DotCallExpr' && (() => {
        const dotObjName = s.expr.object.type === 'RefRead' ? s.expr.object.name : (s.expr.object.type === 'Identifier' ? s.expr.object.name : null);
        return dotObjName && sCtx.childActorRefs.has(dotObjName);
      })()) {
        // Fire-and-forget DotCallExpr on local child actor
        const expr = s.expr;
        const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : expr.object.name;
        const actorName = sCtx.childActorRefs.get(dotObjName);
        const method = JSON.stringify('@' + expr.method);
        const positional = expr.args.filter(a => a.positional);
        const named = expr.args.filter(a => !a.positional);
        let payload;
        const wrapArgSA = (expr) => { const raw = genRustExpr(expr, typeEnv); const t = inferLiteralType(expr) || inferExprType(expr, typeEnv); return toJsonValue(raw, t || 'Anything'); };
        if (positional.length > 0 && named.length > 0) {
          const posVals = positional.map(a => wrapArgSA(a.expr));
          const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgSA(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
          payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
        } else if (positional.length > 0) {
          const posVals = positional.map(a => wrapArgSA(a.expr));
          payload = valueArray(posVals);
        } else if (named.length > 0) {
          const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${wrapArgSA(a.expr || { type: 'Identifier', name: a.name })});`).join(' ');
          payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
        } else {
          payload = 'json!({})';
        }
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload}, "", "__parent");`);
      } else if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else if (s.expr.type === 'FunctionCallExpr' && s.expr.callee?.type === 'Identifier'
                 && G.ctx.actorFnNames?.has(s.expr.callee.name)
                 && !fnDefs.get(s.expr.callee.name)) {
        // Direct private-fn call in statement position: value is discarded, so
        // emit without `.one()` (which would panic on a void/empty reply).
        lines.push(`${I}${genRustFnCallExpr(s.expr, typeEnv)};`);
      } else if (s.expr.type === 'FunctionCallExpr') {
        // Inline function for side effects
        const calleeName = s.expr.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.expr.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagE = s.expr.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const blockLines = [];
          // Build ref param mapping: param.name → original ref name
          const refParamMap = new Map();
          let posIdxE = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxE++];
            } else if (namedArgsBagE && namedArgsBagE.fields && lookupKey in namedArgsBagE.fields) {
              arg = namedArgsBagE.fields[lookupKey];
            }
            if (param.ref && arg?.type === 'RefArg') {
              refParamMap.set(param.name, arg.name);
              // Emit a read binding so the param name is available in body expressions
              const refReadExpr = `${rsStore(arg.name)}.get("${arg.name}").cloned().unwrap_or(Value::Null)`;
              if (param.type) {
                blockLines.push(`${I}let ${rustIdent(param.name)}: ${rustType(param.type)} = ${convertFromValue(refReadExpr, param.type)};`);
              } else {
                blockLines.push(`${I}let ${rustIdent(param.name)} = ${refReadExpr};`);
              }
              continue;
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null) || (param.defaultValue ? inferLiteralType(param.defaultValue) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : (param.defaultValue ? genRustDefaultExpr(param, typeEnv) : 'Value::Null');
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}let ${param.name} = ${argExpr};`);
            }
          }
          // Rewrite RefRead nodes in expressions that refer to ref params → use local let binding
          function rewriteRefReads(node) {
            if (!node || typeof node !== 'object') return node;
            if (node.type === 'RefRead' && refParamMap.has(node.name)) {
              return { type: 'Identifier', name: node.name };
            }
            const copy = Array.isArray(node) ? [...node] : { ...node };
            for (const key of Object.keys(copy)) {
              if (key === 'type') continue;
              copy[key] = rewriteRefReads(copy[key]);
            }
            return copy;
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'SetStatement') {
              if (sCtx.childActorRefs && sCtx.childActorRefs.has(bs.name)) {
                const actorName = sCtx.childActorRefs.get(bs.name);
                const wireOp = bs.updateOp === '<|' ? 'update' : 'set';
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                blockLines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &${valueArray([bsVal])}, "", "__parent");`);
              } else {
                const refName = refParamMap.get(bs.name) || bs.name;
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                const t = typeEnv.get(refName) || typeEnv.get(bs.name) || inferLiteralType(bs.value);
                const ek = G.ctx.stateVarNames.has(refName) ? stateKey(refName) : refName;
                blockLines.push(`${I}${rsStore(refName)}.insert("${ek}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              }
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}self.state.insert("${stateKey(bs.name)}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'ExprStatement') {
              blockLines.push(`${I}${genRustExpr(bs.expr, typeEnv)};`);
            }
          }
          if (blockLines.length > 0) lines.push(blockLines.join('\n'));
        } else {
          lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
        }
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    }
  }
  G.ctx._lambdaStartIdx = savedLambdaStartIdx;
  G.ctx.makeRetExpr = savedMakeRetExpr;
  return lines.join('\n');
}

function genRustWhileStatement(node, typeEnv, I, makeRetExpr = null) {
  const lines = [];
  const cond = genRustCondition(node.cond, typeEnv);
  const whileCond = node.negated ? `!(${cond})` : cond;
  // Early-return statement keyword: defaults to `return`, but inlined lambda
  // blocks override with `break 'label` so the early exit lands at the
  // enclosing block expression rather than at the surrounding handle_op or
  // _fn method.
  const retKeyword = G.ctx.whileRetKeyword || 'return';
  lines.push(`${I}loop {`);
  lines.push(`${I}    if !(${whileCond}) { break; }`);
  for (const s of node.body) {
    {
      const catchCode = tryGenRustCatchOrLabelStmt(s, typeEnv, `${I}    `);
      if (catchCode !== null) { lines.push(catchCode); continue; }
    }
    if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}    self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      const sk2 = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
      lines.push(`${I}    ${rsStore(s.name)}.insert("${sk2}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'TypedAssign') {
      // Branch-local — use plain rustIdent (validator forbids rebinding from
      // a while body, so no SSA needed inside the branch).
      let val = genRustExpr(s.value, typeEnv);
      if ((s.typeName === 'Text' || s.typeName === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}    let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      const val = genRustExpr(s.value, typeEnv);
      lines.push(`${I}    let ${rustIdent(s.name)} = ${val};`);
    } else if (s.type === 'Return' && makeRetExpr) {
      lines.push(`${I}    ${retKeyword} ${makeRetExpr(s.fields, typeEnv)};`);
    } else if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr) && makeRetExpr) {
      lines.push(buildWhileGuardBlock(s.expr, typeEnv, `${I}    `, makeRetExpr, retKeyword));
    } else if (s.type === 'WhileStatement') {
      lines.push(genRustWhileStatement(s, typeEnv, `${I}    `, makeRetExpr));
    } else if (s.type === 'ExprStatement') {
      lines.push(`${I}    ${genRustExpr(s.expr, typeEnv)};`);
    }
  }
  lines.push(`${I}}`);
  return lines.join('\n');
}

// Detects: any WhileStatement in `body` whose loop body contains a Return
// node, or an ImplicitReturn(IfExpr) where the if's branches early-return.
// Used by inlined-lambda emission to decide whether to wrap the inlined
// block in a labeled `'lbl: { ... }` so the early exit lands at the lambda
// call site rather than at the surrounding handle_op / _fn method.
function bodyHasWhileEarlyReturn(body) {
  if (!Array.isArray(body)) return false;
  for (const s of body) {
    if (!s) continue;
    if (s.type === 'WhileStatement' && Array.isArray(s.body)) {
      for (const ws of s.body) {
        if (!ws) continue;
        if (ws.type === 'Return') return true;
        if (ws.type === 'ImplicitReturn' && ws.expr?.type === 'IfExpr' && isRustGuardIf(ws.expr)) return true;
        if (ws.type === 'WhileStatement' && bodyHasWhileEarlyReturn([ws])) return true;
      }
    }
  }
  return false;
}

function buildWhileGuardBlock(ifExpr, typeEnv, indent, makeRetExpr, retKeyword) {
  const I = indent;
  const II = I + '    ';
  const cond = genRustCondition(ifExpr.cond, typeEnv, {});

  function genBranchLines(branchBody, branchIndent) {
    const out = [];
    for (const s of branchBody) {
      if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr)) {
        out.push(buildWhileGuardBlock(s.expr, typeEnv, branchIndent, makeRetExpr, retKeyword));
      } else if (s.type === 'Return') {
        out.push(`${branchIndent}${retKeyword} ${makeRetExpr(s.fields, typeEnv)};`);
      } else if (s.type === 'TypedAssign') {
        const val = genRustExpr(s.value, typeEnv);
        out.push(`${branchIndent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
      } else if (s.type === 'Assign') {
        const val = genRustExpr(s.value, typeEnv);
        out.push(`${branchIndent}let ${rustIdent(s.name)} = ${val};`);
      }
    }
    return out.join('\n');
  }

  const thenLines = genBranchLines(ifExpr.then?.body || [], II);
  let elseSection = '';
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      elseSection = ` else {\n${buildWhileGuardBlock(ifExpr.else, typeEnv, II, makeRetExpr, retKeyword)}\n${I}}`;
    } else if (ifExpr.else.body) {
      const elseLines = genBranchLines(ifExpr.else.body, II);
      elseSection = ` else {\n${elseLines}\n${I}}`;
    }
  }
  return `${I}if ${cond} {\n${thenLines}\n${I}}${elseSection}`;
}

// ── catch / label-invoke (Phase 1: bare void exit) ───────────────────────────
//
// `catch #label { body }` → `'lbl_<name>_<n>: { body }`
// `#label`                → `break 'lbl_<name>_<n>;`
// `if cond #label`        → `if cond { break 'lbl_<name>_<n>; }`

function lookupCatchRsLabel(brevityName) {
  const stack = G.ctx.catchLabelStack || [];
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].brevityName === brevityName) return stack[i].rsLabel;
  }
  throw new Error(`Label ${brevityName} is not in scope`);
}

function ifContainsLabelExitRs(node) {
  if (!node) return false;
  if (node.type === 'LabelInvoke') return true;
  if (node.type === 'IfBranch') {
    if (node.expr) return ifContainsLabelExitRs(node.expr);
    if (node.body) return node.body.some(catchBodyStmtHasLabelExit);
    return false;
  }
  if (node.type === 'IfExpr') return ifContainsLabelExitRs(node.then) || ifContainsLabelExitRs(node.else);
  return false;
}

function catchBodyStmtHasLabelExit(s) {
  if (!s) return false;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') return true;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExitRs(s.expr)) return true;
  return false;
}

function genRustCatchStatement(catchExpr, typeEnv, I) {
  const idx = G.ctx.catchLabelCounter++;
  const safeName = catchExpr.label.replace(/[^a-zA-Z0-9]/g, '');
  const rsLabel = `lbl_${safeName}_${idx}`;
  G.ctx.catchLabelStack.push({ brevityName: catchExpr.label, rsLabel });
  const lines = [`${I}'${rsLabel}: {`];
  for (const s of catchExpr.body) {
    lines.push(genRustCatchBodyStmt(s, typeEnv, I + '    '));
  }
  lines.push(`${I}}`);
  G.ctx.catchLabelStack.pop();
  return lines.join('\n');
}

function genRustCatchBodyStmt(s, typeEnv, I) {
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') {
    const entry = (G.ctx.catchLabelStack || []).slice().reverse().find(e => e.brevityName === s.expr.label);
    if (!entry) throw new Error(`Label ${s.expr.label} is not in scope`);
    if (s.expr.valueExpr) {
      const raw = genRustExpr(s.expr.valueExpr, typeEnv);
      const v = coerceToCatchType(raw, s.expr.valueExpr, typeEnv, entry.targetType);
      return `${I}break '${entry.rsLabel} ${v};`;
    }
    return `${I}break '${entry.rsLabel};`;
  }
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExitRs(s.expr)) {
    return genRustIfWithLabelExit(s.expr, typeEnv, I);
  }
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'CatchExpr') {
    return genRustCatchStatement(s.expr, typeEnv, I);
  }
  if (s.type === 'WhileStatement') {
    return genRustWhileStatement(s, typeEnv, I, G.ctx.makeRetExpr || null);
  }
  if (s.type === 'BareTypeDecl') return '';
  if (s.type === 'RefDecl') {
    const val = s.value ? genRustExpr(s.value, typeEnv) : 'Value::Null';
    const t = s.typeName || inferLiteralType(s.value);
    const k = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
    return `${I}${rsStore(s.name)}.insert("${k}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`;
  }
  if (s.type === 'StateAssign') {
    const val = genRustExpr(s.value, typeEnv);
    const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
    return `${I}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`;
  }
  if (s.type === 'SetStatement') {
    const val = genRustExpr(s.value, typeEnv);
    const t = typeEnv.get(s.name) || inferLiteralType(s.value);
    const sk = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
    return `${I}${rsStore(s.name)}.insert("${sk}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`;
  }
  if (s.type === 'Assign') {
    const val = genRustExpr(s.value, typeEnv);
    return `${I}let ${rustIdent(s.name)} = ${val};`;
  }
  if (s.type === 'TypedAssign') {
    let val = genRustExpr(s.value, typeEnv);
    if ((s.typeName === 'Text' || s.typeName === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
    return `${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`;
  }
  if (s.type === 'ExprStatement') {
    return `${I}${genRustExpr(s.expr, typeEnv)};`;
  }
  if (s.type === 'ImplicitReturn') {
    return `${I}let _ = ${genRustExpr(s.expr, typeEnv)};`;
  }
  throw new Error(`Rust catch body: unsupported statement ${s.type}`);
}

function genRustIfWithLabelExit(ifExpr, typeEnv, I) {
  const cond = genRustCondition(ifExpr.cond, typeEnv);
  const II = I + '    ';
  const thenLines = genRustBranchAsStmts(ifExpr.then, typeEnv, II);
  let code = `${I}if ${cond} {\n${thenLines}\n${I}}`;
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      const inner = genRustIfWithLabelExit(ifExpr.else, typeEnv, I);
      code += ` else ` + inner.replace(/^[ ]*/, '');
    } else {
      const elseLines = genRustBranchAsStmts(ifExpr.else, typeEnv, II);
      code += ` else {\n${elseLines}\n${I}}`;
    }
  }
  return code;
}

function genRustBranchAsStmts(branch, typeEnv, I) {
  if (!branch) return '';
  if (branch.body) {
    return branch.body.map(s => genRustCatchBodyStmt(s, typeEnv, I)).join('\n');
  }
  if (branch.expr) {
    if (branch.expr.type === 'LabelInvoke') {
      const entry = (G.ctx.catchLabelStack || []).slice().reverse().find(e => e.brevityName === branch.expr.label);
      if (!entry) throw new Error(`Label ${branch.expr.label} is not in scope`);
      if (branch.expr.valueExpr) {
        const raw = genRustExpr(branch.expr.valueExpr, typeEnv);
        const v = coerceToCatchType(raw, branch.expr.valueExpr, typeEnv, entry.targetType);
        return `${I}break '${entry.rsLabel} ${v};`;
      }
      return `${I}break '${entry.rsLabel};`;
    }
    return `${I}let _ = ${genRustExpr(branch.expr, typeEnv)};`;
  }
  return '';
}

// Coerce a value-expression to the catch's declared Rust type. If the
// declared type is Value (or absent), pass through; if it's a non-Value
// type and the expression already returns Value (RefRead/StateVar/etc.),
// run it through convertFromValue.
function coerceToCatchType(rawExpr, exprNode, typeEnv, targetType) {
  if (!targetType || rustType(targetType) === 'Value') return rawExpr;
  // RefRead and StateVar emit Value-typed expressions; route through the
  // standard convertFromValue helper.
  if (exprNode?.type === 'RefRead' || exprNode?.type === 'StateVar' || exprNode?.type === 'Identifier') {
    return convertFromValue(rawExpr, targetType);
  }
  return rawExpr;
}

// Value-carrying catch as a Rust expression. Lowers to a labeled block
// expression: `'lbl: { stmts; tail_expr }`. Body's tail ImplicitReturn
// becomes the block's value; LabelInvoke(expr) emits `break 'lbl <expr>`.
//
// `targetType` is the declared type of the catch's consumer (e.g. the LHS of
// a typed assign). When provided, break/tail values are coerced to match —
// otherwise Rust's type checker rejects mixed Value/BigInt expressions inside
// the block.
export function genRustValueCatchExpr(catchExpr, typeEnv, targetType = null) {
  const idx = G.ctx.catchLabelCounter++;
  const safeName = catchExpr.label.replace(/[^a-zA-Z0-9]/g, '');
  const rsLabel = `lbl_${safeName}_${idx}`;
  G.ctx.catchLabelStack.push({ brevityName: catchExpr.label, rsLabel, targetType });
  const body = catchExpr.body;
  const lines = [`'${rsLabel}: {`];
  const last = body.length - 1;
  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    if (i === last && s.type === 'ImplicitReturn' &&
        !(s.expr?.type === 'IfExpr' && ifContainsLabelExitRs(s.expr)) &&
        s.expr?.type !== 'LabelInvoke' && s.expr?.type !== 'CatchExpr') {
      const raw = genRustExpr(s.expr, typeEnv);
      const tail = coerceToCatchType(raw, s.expr, typeEnv, targetType);
      lines.push(`    ${tail}`);
    } else {
      lines.push(genRustCatchBodyStmt(s, typeEnv, '    '));
    }
  }
  lines.push('}');
  G.ctx.catchLabelStack.pop();
  return lines.join('\n');
}

// Returns a Rust statement string if `s` is a catch-related statement, else null.
//
// Value-carrying catch in ImplicitReturn position is NOT handled here — the
// caller is responsible for routing it through the value path (genRustExpr +
// the implicit-return reply). Only void catch is statement-emitted here.
function tryGenRustCatchOrLabelStmt(s, typeEnv, I) {
  if (s.type === 'ExprStatement' || s.type === 'ImplicitReturn') {
    if (s.expr?.type === 'CatchExpr') {
      if (!s.expr.isVoid && s.type === 'ImplicitReturn') return null;
      return genRustCatchStatement(s.expr, typeEnv, I);
    }
    if (s.expr?.type === 'LabelInvoke') {
      const rsLabel = lookupCatchRsLabel(s.expr.label);
      return `${I}break '${rsLabel};`;
    }
    if (s.expr?.type === 'IfExpr' && ifContainsLabelExitRs(s.expr)) {
      return genRustIfWithLabelExit(s.expr, typeEnv, I);
    }
  }
  return null;
}

function genRustListDestructure(node, typeEnv, I) {
  const lines = [];
  const src = genRustExpr(node.source, typeEnv);
  const tempBase = `_ld${G.ctx.fnTempCounter++}`;
  lines.push(`${I}let ${tempBase} = ${src};`);

  const pattern = node.pattern;
  const hasRest = pattern.some(p => p.rest);
  let cur = tempBase;

  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      // Rest: take remaining as array (or null if empty)
      if (!item.discard && item.name) {
        const rType = rustType(item.type);
        lines.push(`${I}let ${mintRustSsa(item.name)}: ${rType} = ${cur};`);
      }
      break;
    }
    // Extract head — panic if list is empty
    lines.push(`${I}if ${cur}.as_array().map(|a| a.is_empty()).unwrap_or(true) { panic!("list_destructure_empty"); }`);
    if (!item.discard && item.name) {
      const accessor = `${cur}.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)`;
      lines.push(`${I}let ${mintRustSsa(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
    }
    // Advance to tail
    if (i < pattern.length - 1) {
      const next = `${tempBase}_${i}`;
      lines.push(`${I}let ${next}: Value = ${cur}.as_array().map(|a| if a.len() > 1 { json!(&a[1..]) } else { Value::Null }).unwrap_or(Value::Null);`);
      cur = next;
    }
  }

  // Arity check: if no rest and more than one element, check tail is empty
  if (!hasRest && pattern.length > 0) {
    lines.push(`${I}if ${cur}.as_array().map(|a| a.len()).unwrap_or(0) > 1 { panic!("list_destructure_arity"); }`);
  }

  return lines.join('\n');
}

function genRustIfStatementBody(branch, typeEnv, I) {
  const lines = [];
  const stmts = branch.body || (branch.expr ? [{ type: 'ExprStatement', expr: branch.expr }] : []);
  for (const s of stmts) {
    if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      const sk3 = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
      lines.push(`${I}${rsStore(s.name)}.insert("${sk3}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    } else if (s.type === 'TypedAssign') {
      // Branch-local — use plain rustIdent (validator forbids rebinding outer
      // names from inside an if body).
      let val = genRustExpr(s.value, typeEnv);
      if ((s.typeName === 'Text' || s.typeName === 'Blob') && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      const val = genRustExpr(s.value, typeEnv);
      lines.push(`${I}let ${rustIdent(s.name)} = ${val};`);
    }
  }
  return lines.join('\n');
}

function genRustIfStatement(expr, typeEnv, I) {
  const cond = genRustCondition(expr.cond, typeEnv);
  const thenBody = genRustIfStatementBody(expr.then, typeEnv, `${I}    `);
  let code = `${I}if ${cond} {\n${thenBody}\n${I}}`;
  if (expr.else) {
    if (expr.else.type === 'IfExpr') {
      code += ` else ` + genRustIfStatement(expr.else, typeEnv, I).trimStart();
    } else {
      const elseBody = genRustIfStatementBody(expr.else, typeEnv, `${I}    `);
      code += ` else {\n${elseBody}\n${I}}`;
    }
  }
  return code;
}

function genRustReBody(fields, typeEnv, refNames) {
  refNames = refNames || new Set();
  // Empty fields → Void return on the wire (`re: []`).
  if (fields.length === 0) return 'Value::Array(vec![])';
  const spread = fields.find(f => f.spread);
  if (spread) return `${rustSsaResolve(spread.name)}.splat()`;

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  function resolveFieldName(name) {
    if (name.startsWith('$')) return resolveVarExpr(name);
    if (G.ctx.stateVarNames.has(name)) return `self.state.get("${stateKey(name)}").cloned().unwrap_or(Value::Null)`;
    if (refNames.has(name)) return `self.refs.get("${name}").cloned().unwrap_or(Value::Null)`;
    return null;
  }

  // Slice 12: shape-typed reply slot — wrap its value with `bv_to_wire`
  // (positional list when all-required, named map when any optional). The
  // codegen passes the field set per call so no runtime registry is needed.
  function shapeWireWrap(rawExpr, t) {
    if (typeof t !== 'string' || !G.ctx.typeDecls?.has(t)) return null;
    const decl = G.ctx.typeDecls.get(t);
    const fieldList = (decl.fields || []).map(f => `"${f.name}"`).join(', ');
    const allRequired = (decl.fields || []).every(f => !f.optional);
    return `bv_to_wire(&${rawExpr}, &[${fieldList}], ${allRequired})`;
  }

  function reFieldVal(f) {
    const slotType = f.type
      || (f.name && typeEnv?.get(f.name))
      || (f.expr && inferExprType(f.expr, typeEnv));
    if (f.name) {
      const resolved = resolveFieldName(f.name);
      const base = resolved || `bv_val(${rustSsaResolve(f.name)}.clone())`;
      const wrapped = shapeWireWrap(`(${base})`, slotType);
      return wrapped || base;
    }
    if (f._precomputed) return f._precomputed;
    if (f.expr) {
      const val = genRustExpr(f.expr, typeEnv);
      const wrapped = shapeWireWrap(`(${val})`, slotType);
      if (wrapped) return wrapped;
      return `bv_val(${val})`;
    }
    return 'Value::Null';
  }

  if (pos.length > 0 && named.length > 0) {
    // Mixed: [pos1, pos2, {key: val}] — use Value::Array + Map for BigInt safety
    const posVals = pos.map(reFieldVal);
    const namedInserts = named.map(f => {
      if ('sigil' in f) {
        const val = resolveFieldName(f.sigil) || (typeEnv.has(f.sigil) ? rustSsaResolve(f.sigil) : JSON.stringify(f.sigil));
        const t = f.type || typeEnv.get(f.sigil);
        const wrapped = toJsonValue(val, t);
        const needsClone = wrapped === val && /^[a-z_]\w*$/i.test(val);
        return `_nm.insert("${f.sigil}".to_string(), ${needsClone ? `${val}.clone()` : wrapped});`;
      }
      if (f.key !== undefined) {
        const val = genRustExpr(f.value, typeEnv);
        const t = inferExprType(f.value, typeEnv);
        return `_nm.insert("${f.key}".to_string(), ${toJsonValue(val, t)});`;
      }
      return '';
    }).filter(Boolean).join(' ');
    return `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
  } else if (pos.length > 0) {
    // Positional only: [val1, val2]
    const posVals = pos.map(reFieldVal);
    return `Value::Array(vec![${posVals.join(', ')}])`;
  } else {
    // Named only: {key: val} — always use Map construction since any value could be BigInt
    {
      const inserts = [];
      for (const f of named) {
        if ('sigil' in f) {
          const val = resolveFieldName(f.sigil) || (typeEnv.has(f.sigil) ? rustSsaResolve(f.sigil) : JSON.stringify(f.sigil));
          // Use bv_val() universally — handles both BigInt and Value
          const isSimpleVar = /^[a-z_]\w*$/i.test(val);
          const wrapped = `bv_val(${isSimpleVar ? `${val}.clone()` : val})`;
          const slotType = f.type || typeEnv.get(f.sigil);
          const shaped = shapeWireWrap(`(${wrapped})`, slotType);
          inserts.push(`_re_map.insert("${f.sigil}".to_string(), ${shaped || wrapped});`);
        } else if (f.key !== undefined) {
          const val = genRustExpr(f.value, typeEnv);
          const isSimpleVar = /^[a-z_]\w*$/i.test(val);
          const wrapped = `bv_val(${isSimpleVar ? `${val}.clone()` : val})`;
          const slotType = f.type
            || ((f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? typeEnv.get(f.value.name) : null)
            || inferExprType(f.value, typeEnv);
          const shaped = shapeWireWrap(`(${wrapped})`, slotType);
          inserts.push(`_re_map.insert("${f.key}".to_string(), ${shaped || wrapped});`);
        }
      }
      return `{ let mut _re_map = Map::new(); ${inserts.join(' ')} Value::Object(_re_map) }`;
    }
  }
}

function genRustBvaBody(fields, typeEnv, refNames) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // bv-a handled separately for spread

  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  // Slice 13: shape-typed slots emit `::Name` so the receiver routes the
  // payload through `bv_from_wire`. Primitive tags stay unprefixed.
  const tagFor = t => (typeof t === 'string' && G.ctx.typeDecls?.has(t)) ? `::${t}` : t;

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  let hasDynamic = false;

  // Collect types for positional fields
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferExprType(f.expr, typeEnv);
    if (!t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      const varName = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      posTypes.push({ dynamic: true, expr: `list_types_of(&${rustSsaResolve(varName)})` });
    } else {
      posTypes.push({ dynamic: false, val: JSON.stringify(tagFor(t)) });
    }
  }

  // Collect types for named fields
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || (f.value?.type === 'Identifier' || f.value?.type === 'RefRead' ? typeEnv.get(f.value.name) : null) || (f.value?.type === 'StateVar' ? typeEnv.get('$' + f.value.name) : null) || inferExprType(f.value, typeEnv);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!key || !t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      if (!varName) return null;
      const resolved = G.ctx.stateVarNames.has(varName) ? `self.state.get("${stateKey(varName)}").cloned().unwrap_or(Value::Null)` : (refNames.has(varName) ? `self.refs.get("${varName}").cloned().unwrap_or(Value::Null)` : rustSsaResolve(varName));
      namedTypes.push({ dynamic: true, key, expr: `list_types_of(&${resolved})` });
    } else {
      namedTypes.push({ dynamic: false, key, val: `"${tagFor(t)}"` });
    }
  }

  if (!hasDynamic) {
    // Static bv-a — use json! macro
    if (pos.length > 0 && named.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}, {${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}}])`;
    } else if (pos.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}])`;
    } else if (named.length > 0) {
      return `json!({${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}})`;
    }
    return null;
  }

  // Dynamic bv-a — build at runtime with Map
  if (named.length > 0 && pos.length === 0) {
    const pairs = namedTypes.map(n => {
      if (n.dynamic) {
        return `bva_map.insert("${n.key}".to_string(), ${n.expr});`;
      } else {
        return `bva_map.insert("${n.key}".to_string(), json!(${n.val}));`;
      }
    });
    return `{ let mut bva_map = Map::new(); ${pairs.join(' ')} Value::Object(bva_map) }`;
  }
  // For now, return null for complex dynamic cases (pos + named with dynamic)
  return null;
}

export { genRustTypedAssign, genRustDestructureAssign, genRustAssignFnCall, genRustAssignChildDotCall, genRustAssignRemoteDotCall, genRustLocals, genRustWhileStatement, genRustListDestructure, genRustIfStatementBody, genRustIfStatement, genRustReBody, genRustBvaBody };
