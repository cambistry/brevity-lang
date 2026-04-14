// ── Statement codegen for Erlang ─────────────────────────────────────────────

import { erlVarName, erlString, isListOfAnythingType, erlStateKey } from './preambles.js';
import {
  inferLiteralType,
  buildSSAEnv,
  resolveSSAName,
  getSSANameForAssignment,
  erlCollectFreeVars,
  erlLambdaUsesOuterRefs,
} from './types.js';
import {
  erlSetTarget,
  genExpr,
  genDotCallAwait,
  genChildDotCallAwait,
  genErlLambdaVarCall,
  genFunctionCallExpr,
  genActorFnCallExpr,
  genFunctionLiteral,
} from './expressions.js';

// Function-body dep construction: t = Thing(args)
// Emits ::new outbound, awaits the reply (synchronously via await_new_response_),
// and binds the resulting instance address to the local erlang variable.
// Tracks the local in ctx.localInstanceVars so subsequent t.method() calls in
// this body route to that address.
function genErlDepConstructorAssign(ctx, s, varName, typeEnv, stmtCtx, I, lines) {
  const calleeName = s.value.callee.name;
  const targetName = ctx.constructorCoercions?.get(calleeName) || calleeName;
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  let argsExpr;
  if (positionalArgs.length === 0 && !namedBag) {
    argsExpr = '#{}';
  } else if (namedBag) {
    const fields = Object.entries(namedBag.fields)
      .map(([k, v]) => `${erlString(k)} => ${genExpr(ctx, v, typeEnv, stmtCtx)}`).join(', ');
    if (positionalArgs.length > 0) {
      argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ')}, #{${fields}}]`;
    } else {
      argsExpr = `#{${fields}}`;
    }
  } else {
    argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ')}]`;
  }
  ctx.localInstanceVars.add(s.name);
  // Emit ::new and synchronously await the reply (returning the instance addr).
  // Use a unique seq slot per call site so the var names don't collide.
  const seq = ctx.sendCounter++;
  lines.push(`${I}New_seq_${seq} = case get(send_seq_) of undefined -> 1; New_n_${seq} -> New_n_${seq} end,`);
  lines.push(`${I}put(send_seq_, New_seq_${seq} + 1),`);
  lines.push(`${I}New_id_${seq} = integer_to_binary(New_seq_${seq}),`);
  lines.push(`${I}New_msg_${seq} = #{<<"id">> => New_id_${seq}, <<"op">> => [${argsExpr}, <<"::new">>], <<"to">> => ${erlString(targetName)}},`);
  lines.push(`${I}io:format("~s~n", [json_encode(New_msg_${seq})]),`);
  lines.push(`${I}${varName} = await_new_response_(New_id_${seq}),`);
}

function genLocals(ctx, body, typeEnv, sCtx, indent) {
  const I = indent;
  const lines = [];
  const ssaEnv = sCtx.ssaEnv || buildSSAEnv(body);
  // Track lambda start index for scoped overload resolution
  const savedLambdaStartIdx = ctx._lambdaStartIdx;
  ctx._lambdaStartIdx = ctx.lambdaHandlers?.length || 0;
  // Per-handler-body local instance vars from dep constructor calls
  ctx.localInstanceVars = new Set();

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    const stmtCtx = { ...sCtx, stmtIdx: i, ssaEnv };

    if (s.type === 'Reply' || s.type === 'ImplicitReturn' || s.type === 'Return') continue;

    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      // Handle lambda overload <</>>/Function() before SSA to avoid spurious variable renaming
      if (s.value?.type === 'Function' && (s.value.overloadMode === 'append' || s.value.overloadMode === 'prepend')) {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const overloadMode = s.value.overloadMode;
          const freeVars = erlCollectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          for (const v of freeVars) {
            const capKey = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureKeys.push(capKey);
            const src = ctx.stateVarNames.has(v) ? `get(${erlStateKey(ctx, v)})` : genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, { ...sCtx, stmtIdx: i, ssaEnv });
            lines.push(`${I}put('${capKey}', ${src}),`);
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          if (overloadMode === 'prepend') {
            const idx = ctx.lambdaHandlers.indexOf(existing);
            ctx.lambdaHandlers.splice(idx, 0, entry);
          } else {
            ctx.lambdaHandlers.push(entry);
          }
          continue; // Skip SSA variable emission — reuse existing label
        }
      }
      if (s.value?.type === 'Function' && s.value.emptyOverload) {
        // Function() initializer — register label, skip SSA renaming
        const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
        ctx.lambdaVarNames.add(s.name);
        ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: [] });
        const varName = erlVarName(s.name);
        lines.push(`${I}${varName} = <<"${lambdaName}">>,`);
        continue;
      }

      const ssaName = getSSANameForAssignment(s.name, i, ssaEnv);
      const varName = erlVarName(ssaName);

      // Dependency constructor: t = Thing(args) → emit ::new + await reply
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name)) {
        genErlDepConstructorAssign(ctx, s, varName, typeEnv, stmtCtx, I, lines);
        continue;
      }

      if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        const asClause = findErlAsClauseMatch(ctx, s.typeName, s.value.callee.name);
        if (asClause) {
          lines.push(`${I}${varName} = ${genExpr(ctx, asClause.expr, typeEnv, stmtCtx)},`);
          continue;
        }
      }

      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        // Non-ref actor instantiation — assign actor name atom to variable
        let actorName = s.value.callee.name;
        // Constructor overload dispatch: select variant by arity/types
        if (ctx.constructorOverloads?.has(actorName)) {
          const overloads = ctx.constructorOverloads.get(actorName);
          const argCount = s.value.args.filter(a => a.type !== 'NamedArgsBag').length;
          const inferArgType = arg => {
            if (arg.type === 'IntLiteral') return 'Integer';
            if (arg.type === 'StringLiteral') return 'Text';
            if (arg.type === 'DecimalLiteral') return 'Decimal';
            if (arg.type === 'BoolLiteral') return 'Boolean';
            return null;
          };
          const argTypes = s.value.args.filter(a => a.type !== 'NamedArgsBag').map(inferArgType);
          // Check primary actor first
          const primaryInfo = ctx.actorInfo.get(actorName);
          const primaryParams = (primaryInfo?.actor?.initParams || []).filter(p => p.positional);
          // Build candidates: primary first, then overloads
          const candidates = [
            { className: actorName, params: primaryParams },
            ...overloads.map(ov => {
              const ovInfo = ctx.actorInfo.get(ov.mangledName);
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
        if (sCtx.childActorRefs) sCtx.childActorRefs.set(s.name, actorName);
        const childActor = ctx.actorInfo.get(actorName)?.actor;
        const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || (childActor?._supertypeBindings?.length > 0) || (childActor?._inheritedIngests?.length > 0) || s.value.args.length > 0;
        if (hasInit) {
          // Unpack named args — generate map for keyed params, list for positional
          const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
          if (namedBag) {
            const initParams = childActor?.initParams || [];
            const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
            const namedFields = namedBag.fields || {};
            // Build map entries for named args, positional list for the rest
            const mapEntries = [];
            const posArgs = [];
            let posIdx = 0;
            for (const p of initParams) {
              const lookupKey = p.key || p.name;
              if (namedFields[lookupKey]) {
                mapEntries.push(`${erlString(lookupKey)} => ${genExpr(ctx, namedFields[lookupKey], typeEnv, stmtCtx)}`);
              } else if (posIdx < positionalArgs.length) {
                posArgs.push(genExpr(ctx, positionalArgs[posIdx++], typeEnv, stmtCtx));
              }
            }
            if (mapEntries.length > 0 && posArgs.length === 0) {
              lines.push(`${I}child_${actorName.toLowerCase()}_init(#{${mapEntries.join(', ')}}),`);
            } else if (posArgs.length > 0 && mapEntries.length > 0) {
              // Mixed positional + named: pass as [pos1, pos2, ..., #{named => val}]
              lines.push(`${I}child_${actorName.toLowerCase()}_init([${posArgs.join(', ')}, #{${mapEntries.join(', ')}}]),`);
            } else {
              // All positional
              lines.push(`${I}child_${actorName.toLowerCase()}_init([${posArgs.join(', ')}]),`);
            }
          } else {
            if (s.value.args.length === 0) {
              lines.push(`${I}child_${actorName.toLowerCase()}_init(#{}),`);
            } else {
              const initArgs = s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ');
              lines.push(`${I}child_${actorName.toLowerCase()}_init([${initArgs}]),`);
            }
          }
        }
        lines.push(`${I}${varName} = ${erlString(actorName.toLowerCase())},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        if (s.typeName === 'Structure') {
          lines.push(`${I}${varName} = ${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)},`);
        } else {
          lines.push(`${I}${varName} = structure_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
        }
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = structure_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.type === 'TypedAssign' && s.typeName === 'Structure' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'StructureConstructor') {
        lines.push(`${I}${varName} = structure_one(${genExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.lambdaVarNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = structure_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && (() => {
        const ct = ctx.currentTypeEnv?.get(s.value.callee.name);
        return ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')));
      })()) {
        lines.push(`${I}${varName} = structure_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr') {
        lines.push(`${I}${varName} = structure_one(${genFunctionCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'Function') {
        // Note: overloadMode and emptyOverload are handled before SSA above (with continue)
        if (erlLambdaUsesOuterRefs(ctx, s.value)) {
          lines.push(`${I}${varName} = ${genFunctionLiteral(ctx, s.value, typeEnv, stmtCtx, s.name)},`);
        } else {
          const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
          ctx.lambdaVarNames.add(s.name);
          const freeVars = erlCollectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          for (const v of freeVars) {
            const capKey = `_cap_${lambdaName}_${v}`;
            ctx.lambdaCaptureKeys.push(capKey);
            const src = ctx.stateVarNames.has(v) ? `get(${erlStateKey(ctx, v)})` : genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, stmtCtx);
            lines.push(`${I}put('${capKey}', ${src}),`);
          }
          ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName })) });
          lines.push(`${I}${varName} = <<"${lambdaName}">>,`);
        }
      } else if (s.value?.type === 'DotCallExpr' && (
        (s.value.object.type === 'FunctionCallExpr' && s.value.object.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.object.callee.name)) ||
        (s.value.object.type === 'RefRead' && stmtCtx.childActorRefs?.has(s.value.object.name)) ||
        (s.value.object.type === 'Identifier' && stmtCtx.childActorRefs?.has(s.value.object.name))
      )) {
        lines.push(`${I}${varName} = structure_one(${genChildDotCallAwait(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'DotAccessExpr' && s.value.object?.type === 'Identifier' && stmtCtx.childActorRefs?.has(s.value.object.name)) {
        // Bare field read on a child actor: v = c.val — same shape as no-args DotCallExpr
        lines.push(`${I}${varName} = structure_one(${genExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'DotCallExpr') {
        // Use genDotCallAwait for remote/constructs calls that return values
        const dotObj = s.value.object;
        const dotObjName = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
        const needsAwait = dotObjName && (ctx.remoteInstanceVars.has(dotObjName) || ctx.constructsProxyVars.has(dotObjName) || ctx.localInstanceVars?.has(dotObjName));
        if (needsAwait) {
          const tmpVar = `Tmp_${i}`;
          const awaitExpr = genDotCallAwait(ctx, s.value, typeEnv, stmtCtx);
          lines.push(`${I}${tmpVar} = ${awaitExpr},`);
          lines.push(`${I}{${tmpVar}_pos, ${tmpVar}_named} = ${tmpVar},`);
          lines.push(`${I}${varName} = maps:get(${erlString(s.name)}, ${tmpVar}_named, null),`);
        } else {
          lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
        }
      } else {
        lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
      }
    }

    if (s.type === 'DestructureAssign') {
      genDestructureAssign(ctx, s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }

    if (s.type === 'ExprStatement') {
      lines.push(`${I}${genExpr(ctx, s.expr, typeEnv, stmtCtx)},`);
    }

    if (s.type === 'SpawnStatement') {
      if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genExpr(ctx, s.call, typeEnv, stmtCtx)},`);
      } else {
        lines.push(`${I}${genActorFnCallExpr(ctx, s.call, typeEnv, stmtCtx)},`);
      }
    }

    if (s.type === 'ListDestructure') {
      genListDestructure(ctx, s, typeEnv, stmtCtx, ssaEnv, I, lines, i);
    }

    if (s.type === 'RefDecl') {
      if (sCtx.refVars) sCtx.refVars.add(s.name);
      // Detect child actor instantiation: ref name = ActorName(args)
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        const actorName = s.value.callee.name;
        if (sCtx.childActorRefs) sCtx.childActorRefs.set(s.name, actorName);
        const childActor = ctx.actorInfo.get(actorName)?.actor;
        const childHasInit = s.value.args.length > 0 || (childActor?.initBody?.length > 0) || (childActor?._supertypeBindings?.length > 0) || (childActor?._inheritedIngests?.length > 0);
        if (childHasInit) {
          const initArgs = s.value.args.length > 0 ? s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ') : '';
          lines.push(`${I}child_${actorName.toLowerCase()}_init([${initArgs}]),`);
        }
      } else {
        const val = s.value ? genExpr(ctx, s.value, typeEnv, stmtCtx) : 'null';
        lines.push(`${I}put(${erlSetTarget(ctx, s.name)}, ${val}),`);
      }
    }

    if (s.type === 'SetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${val}], _Id, _From),`);
      } else {
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}put(${erlSetTarget(ctx, s.name)}, ${val}),`);
      }
    }

    if (s.type === 'ActorSetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const posArgs = s.args.filter(a => a.positional).map(a => genExpr(ctx, a.expr, typeEnv, stmtCtx));
        const namedArgs = s.args.filter(a => !a.positional);
        let payload;
        if (namedArgs.length > 0) {
          const namedMap = namedArgs.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, stmtCtx)}`).join(', ');
          if (posArgs.length > 0) {
            payload = `[${posArgs.join(', ')}, #{${namedMap}}]`;
          } else {
            payload = `#{${namedMap}}`;
          }
        } else {
          payload = `[${posArgs.join(', ')}]`;
        }
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, ${payload}, _Id, _From),`);
      }
    }

    if (s.type === 'ActorFieldSet') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.objectName)) {
        const actorName = sCtx.childActorRefs.get(s.objectName);
        const wireOp = 'set@' + s.fieldName;
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${val}], _Id, _From),`);
      }
    }

    if (s.type === 'StateAssign') {
      if (s.value?.type === 'FunctionCallExpr' && ctx.actorInfo?.has(s.value.callee?.name)) {
        // Local child actor construction — call child init function
        const childName = s.value.callee.name.toLowerCase();
        const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
        const argsExpr = positionalArgs.length > 0
          ? `[${positionalArgs.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ')}]`
          : '[]';
        lines.push(`${I}child_${childName}_init(${argsExpr}),`);
      } else {
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}put(${erlStateKey(ctx, s.name)}, ${val}),`);
      }
    }

    if (s.type === 'WhileStatement') {
      lines.push(genWhileStatement(ctx, s, typeEnv, stmtCtx, I));
    }

    if (s.type === 'BareTypeDecl') {
      // Type annotation only — no Erlang code needed
    }

    if (s.type === 'IfStatement') {
      lines.push(genIfStatement(ctx, s, typeEnv, stmtCtx, I));
    }
  }

  ctx._lambdaStartIdx = savedLambdaStartIdx;
  return lines;
}


function genWhileStatement(ctx, node, typeEnv, sCtx, indent) {
  const I = indent;
  const loopId = ctx.whileCounter++;
  const loopName = `Loop_${loopId}`;

  const cond = genExpr(ctx, node.cond, typeEnv, sCtx);
  const trueCase = node.negated ? 'false' : 'true';
  const falseCase = node.negated ? 'true' : 'false';

  const bodyLines = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      bodyLines.push(`${I}            put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'StateAssign') {
      bodyLines.push(`${I}            put(${erlStateKey(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'TypedAssign') {
      bodyLines.push(`${I}            ${erlVarName(s.name)} = ${genExpr(ctx, s.value, typeEnv, sCtx)}`);
    } else if (s.type === 'ExprStatement') {
      bodyLines.push(`${I}            ${genExpr(ctx, s.expr, typeEnv, sCtx)}`);
    }
  }
  bodyLines.push(`${I}            ${loopName}_f()`);

  return `${I}${loopName} = fun ${loopName}_f() ->\n` +
    `${I}    case is_truthy(${cond}) of\n` +
    `${I}        ${trueCase} ->\n` +
    bodyLines.join(',\n') + `;\n` +
    `${I}        ${falseCase} -> null\n` +
    `${I}    end\n` +
    `${I}end,\n` +
    `${I}${loopName}(),`;
}

function genIfStatement(ctx, node, typeEnv, sCtx, indent) {
  const I = indent;
  const cond = genExpr(ctx, node.cond, typeEnv, sCtx);
  const bodyLines = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      if (sCtx?.childActorRefs?.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        bodyLines.push(`child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${genExpr(ctx, s.value, typeEnv, sCtx)}], _Id, _From)`);
      } else {
        bodyLines.push(`put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
      }
    } else if (s.type === 'StateAssign') {
      bodyLines.push(`put(${erlStateKey(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    }
  }
  return `${I}case is_truthy(${cond}) of true -> ${bodyLines.join(', ')}; false -> null end,`;
}

function genListDestructure(ctx, s, typeEnv, sCtx, ssaEnv, I, lines, stmtIdx) {
  const srcExpr = genExpr(ctx, s.source, typeEnv, sCtx);
  const pattern = s.pattern;
  let hasRest = false;

  // Build an Erlang pattern match
  // [a, b, _] = List  → match against [A, B, _]
  // [h, ...t] = List  → match against [H|T]
  // [h, _, ...t] = List → head + skip + tail

  let cur = `Ld_${stmtIdx}`;
  lines.push(`${I}${cur} = ${srcExpr},`);

  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name) {
        const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
        const varName = erlVarName(ssaName);
        lines.push(`${I}${varName} = case ${cur} of [] -> null; _ -> ${cur} end,`);
      }
      break;
    }
    if (!item.discard && item.name) {
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);
      lines.push(`${I}${varName} = hd(${cur}),`);
    }
    if (i < pattern.length - 1) {
      const next = `Ld_${stmtIdx}_${i}`;
      lines.push(`${I}${next} = tl(${cur}),`);
      cur = next;
    }
  }

  // Arity check: if no rest and more than one element, check tail is empty
  if (!hasRest && pattern.length > 0) {
    lines.push(`${I}case tl(${cur}) of [] -> ok; _ -> error(list_destructure_arity) end,`);
  }
}

function genDestructureAssign(ctx, s, typeEnv, sCtx, ssaEnv, I, lines, stmtIdx) {
  const isDotCall = s.source.type === 'DotCallExpr';
  const srcExpr = isDotCall ? genDotCallAwait(ctx, s.source, typeEnv, sCtx) : genExpr(ctx, s.source, typeEnv, sCtx);
  const isActorFnCall = s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name);

  if (isDotCall || isActorFnCall) {
    const tempName = `Tmp_${stmtIdx}`;
    lines.push(`${I}${tempName} = ${srcExpr},`);
    const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
    const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);
    if (hasPosItems || hasNamedItems) {
      lines.push(`${I}{${tempName}_pos, ${tempName}_named} = ${tempName},`);
    }

    for (const item of s.pattern) {
      if (item.discard) continue;
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);

      if (item.named) {
        lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${tempName}_named, null),`);
      } else if (item.key !== undefined) {
        lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${tempName}_named, null),`);
      } else if (item.positional) {
        lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${tempName}_pos),`);
      }
    }
  } else {
    // Source is a structure variable — resolve through SSA so the prefix
    // matches the actual binding name (e.g. S__1, not raw S).
    const srcName = s.source.type === 'Identifier'
      ? erlVarName(resolveSSAName(s.source.name, stmtIdx, ssaEnv))
      : srcExpr;
    const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
    const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);

    if (hasPosItems || hasNamedItems) {
      // Need to check if source already has _pos/_named suffix from rest binding
      const isRestVar = s.source.type === 'Identifier' && (
        sCtx.restVars?.has(s.source.name)
      );
      if (isRestVar) {
        // Already destructured: Args_pos, Args_named
        const prefix = erlVarName(resolveSSAName(s.source.name, stmtIdx, ssaEnv));
        for (const item of s.pattern) {
          if (item.discard) continue;
          const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
          const varName = erlVarName(ssaName);
          if (item.named) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${prefix}_named, null),`);
          } else if (item.key !== undefined) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${prefix}_named, null),`);
          } else if (item.positional) {
            lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${prefix}_pos),`);
          }
        }
      } else {
        // If source is not a simple identifier, assign to temp first
        let prefix;
        if (s.source.type === 'Identifier') {
          prefix = srcName;
          lines.push(`${I}{${prefix}_d_pos, ${prefix}_d_named} = ${srcName},`);
        } else {
          prefix = `Dtmp_${stmtIdx}`;
          lines.push(`${I}${prefix} = ${srcExpr},`);
          lines.push(`${I}{${prefix}_d_pos, ${prefix}_d_named} = ${prefix},`);
        }
        for (const item of s.pattern) {
          if (item.discard) continue;
          const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
          const varName = erlVarName(ssaName);
          if (item.named) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.name)}, ${prefix}_d_named, null),`);
          } else if (item.key !== undefined) {
            lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${prefix}_d_named, null),`);
          } else if (item.positional) {
            lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${prefix}_d_pos),`);
          }
        }
      }
    }
  }
}

function genErlDefaultValue(node) {
  if (node.type === 'IntLiteral') return String(node.value);
  if (node.type === 'DecimalLiteral') return String(node.value);
  if (node.type === 'FloatLiteral') {
    const s = String(node.value);
    return s.includes('.') ? s : s + '.0';
  }
  if (node.type === 'StringLiteral') return erlString(node.value);
  if (node.type === 'BoolLiteral') return node.value ? 'true' : 'false';
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'StructureLiteral') return '#{}';
  return 'null';
}

function genParamDestructure(params, indent) {
  const I = indent;
  const lines = [];
  const hasPositional = params.some(p => p.positional && !p.rest);
  const hasRest = params.some(p => p.rest);

  if (hasRest) {
    lines.push(`${I}{Args_pos, Args_named} = structure_pack(Payload),`);
  } else if (hasPositional) {
    lines.push(`${I}{S_pos, S_named} = structure_pack(Payload),`);
  }

  let posIdx = 0;
  for (const p of params) {
    if (p.rest) continue;
    if (p.positional) {
      if (p.defaultValue) {
        const dv = genErlDefaultValue(p.defaultValue);
        lines.push(`${I}${erlVarName(p.name)} = case length(S_pos) > ${posIdx} of true -> lists:nth(${posIdx + 1}, S_pos); false -> ${dv} end,`);
      } else {
        lines.push(`${I}${erlVarName(p.name)} = lists:nth(${posIdx + 1}, S_pos),`);
      }
      posIdx++;
    } else if (hasPositional) {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genErlDefaultValue(p.defaultValue) : 'null';
      lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, S_named, ${dv}),`);
    } else {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genErlDefaultValue(p.defaultValue) : 'null';
      lines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, Payload, ${dv}),`);
    }
  }

  return lines;
}

function findErlAsClauseMatch(ctx, targetType, actorName) {
  if (!ctx.actorInfo.has(actorName)) return null;
  const info = ctx.actorInfo.get(actorName);
  if (!info.asClauses || info.asClauses.length === 0) return null;
  if (targetType === actorName) return null;
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return clause;
    if (clause.negated && clause.targetType !== targetType) return clause;
  }
  return null;
}

// ── Reply field codegen ─────────────────────────────────────────────────────

function genReplyBody(ctx, fields, typeEnv, sCtx) {
  const spread = fields.find(f => f.spread);
  if (spread) {
    if (sCtx?.restVars?.has(spread.name)) {
      return `structure_splat({${erlVarName(spread.name)}_pos, ${erlVarName(spread.name)}_named})`;
    }
    const resolved = sCtx?.ssaEnv && sCtx.stmtIdx !== undefined
      ? resolveSSAName(spread.name, sCtx.stmtIdx, sCtx.ssaEnv)
      : spread.name;
    return `structure_splat(${erlVarName(resolved)})`;
  }

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  if (pos.length > 0 && named.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, sCtx)).join(', ');
    const namedMap = genReplyNamedMap(ctx, named, typeEnv, sCtx);
    return `[${posVals}, ${namedMap}]`;
  } else if (pos.length > 0) {
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, sCtx)).join(', ');
    return `[${posVals}]`;
  } else {
    return genReplyNamedMap(ctx, named, typeEnv, sCtx);
  }
}

function genReplyFieldVal(ctx, f, typeEnv, sCtx) {
  if (f.name) {
    if (f.name && f.name.startsWith('$')) return `get(${erlStateKey(ctx, f.name.slice(1))})`;
    if (ctx.stateVarNames.has(f.name)) return `get(${erlStateKey(ctx, f.name)})`;
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) return erlVarName(resolveSSAName(f.name, sCtx.stmtIdx, sCtx.ssaEnv));
    return erlVarName(f.name);
  }
  if (f.expr) {
    const raw = genExpr(ctx, f.expr, typeEnv, sCtx);
    // Wrap self_send calls in structure_one to unwrap Structure to scalar
    if (raw.includes('self_send(')) return `structure_one(${raw})`;
    return raw;
  }
  return 'null';
}

function genReplyNamedMap(ctx, named, typeEnv, sCtx) {
  const entries = named.map(f => {
    if ('sigil' in f) {
      let val;
      if (f.sigil.startsWith('$')) val = `get(${erlStateKey(ctx, f.sigil.slice(1))})`;
      else if (ctx.stateVarNames.has(f.sigil)) val = `get(${erlStateKey(ctx, f.sigil)})`;
      else if (sCtx?.refVars?.has(f.sigil)) val = `get(ref_${f.sigil})`;
      else if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined && sCtx.ssaEnv.assignments.some(a => a.name === f.sigil)) val = erlVarName(resolveSSAName(f.sigil, sCtx.stmtIdx, sCtx.ssaEnv));
      else if (typeEnv?.has(f.sigil)) val = erlVarName(f.sigil);
      else val = erlString(f.sigil);
      return `${erlString(f.sigil)} => ${val}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genExpr(ctx, f.value, typeEnv, sCtx) : erlVarName(f.key);
      return `${erlString(f.key)} => ${val}`;
    }
    return '';
  }).filter(Boolean);
  return `#{${entries.join(', ')}}`;
}

function genBvaBody(ctx, fields, typeEnv, sCtx) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // handled separately

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  // Resolve a source-level local name to its current SSA-suffixed name.
  const ssaResolve = (name) => {
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv);
    }
    return name;
  };

  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferLiteralType(f.expr || f.value);
    if (!t) return null;
    posTypes.push(erlString(t));
  }

  const namedTypes = [];
  for (const f of named) {
    let key, t, varExpr;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varExpr = ctx.stateVarNames.has(f.sigil) ? `get(${erlStateKey(ctx, f.sigil)})` : erlVarName(ssaResolve(f.sigil));
    } else if (f.key !== undefined) {
      key = f.key;
      const valName = f.value?.type === 'Identifier' ? f.value.name : (f.value?.type === 'RefRead' ? f.value.name : null);
      t = f.type || (valName ? typeEnv.get(valName) : null) || inferLiteralType(f.value);
      varExpr = valName ? erlVarName(ssaResolve(valName)) : null;
    }
    if (!key || !t) return null;
    if (isListOfAnythingType(t) && varExpr) {
      namedTypes.push(`${erlString(key)} => list_component_types(${varExpr})`);
    } else {
      namedTypes.push(`${erlString(key)} => ${erlString(t)}`);
    }
  }

  if (pos.length > 0 && named.length > 0) {
    return `[${posTypes.join(', ')}, #{${namedTypes.join(', ')}}]`;
  } else if (pos.length > 0) {
    return `[${posTypes.join(', ')}]`;
  } else if (named.length > 0) {
    return `#{${namedTypes.join(', ')}}`;
  }
  return null;
}

export {
  genLocals,
  genParamDestructure,
  genWhileStatement,
  genIfStatement,
  genListDestructure,
  genDestructureAssign,
  findErlAsClauseMatch,
  genReplyBody,
  genReplyFieldVal,
  genReplyNamedMap,
  genBvaBody,
  erlSetTarget,
  genErlDefaultValue,
};
