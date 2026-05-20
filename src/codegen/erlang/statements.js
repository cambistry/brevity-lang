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
import { inferExprType } from '../../inference.js';
import { parseDecimalLiteral } from '../decimal_utils.js';
import {
  erlSendVars,
  erlSetTarget,
  genExpr,
  genDotCallAwait,
  genChildDotCallAwait,
  genErlLambdaVarCall,
  genFunctionCallExpr,
  genActorFnCallExpr,
  genFunctionLiteral,
} from './expressions.js';

// Subscribe call-site codegen. `c.field.subscribe |v| { body }` emits:
// - A fresh correlation id (process-dict counter or unique_integer)
// - A fun(Re_) stored in {pending_subscribe, Id} that unpacks Re_ and runs
//   the body with params bound
// - An outbound subscribe@<field> message (remote dep: post to stdout with
//   `to: <alias>`; local child: call child_<c>_handle_op inline + invoke
//   the fun with the returned initial value)
// The main loop's `re` handler checks {pending_subscribe, Id} on every
// incoming re and invokes the stored fun, leaving the entry in place for
// subsequent replays.
// A class needs spawned instances (vs the flattened single-instance model)
// when its definition contains an @-cell whose type union includes Self,
// or when it makes a recursive Self() call. Such classes can't share the
// parent's flattened state — they need per-instance dicts.
function classNeedsSpawnedInstances(actor) {
  if (!actor) return false;
  // Self-bearing constructor params (incl. `<:P *List of Self>` and
  // `<peer *Self | null>`) imply per-instance state — multiple instances
  // can hold distinct refs without colliding under a flattened prefix.
  for (const p of (actor.initParams || [])) {
    if (typeof p.type !== 'string') continue;
    if (p.type === 'Self') return true;
    if (p.type.split('|').some(m => m.trim() === 'Self')) return true;
    if (/\bSelf\b/.test(p.type)) return true; // List of Self, etc.
  }
  // Inspect refDecls and stateVarDecls for Self-bearing types
  const decls = [
    ...(actor.constructorBody || []),
    ...(actor.stateVarDecls || []),
    ...(actor.initBody || []),
  ];
  for (const d of decls) {
    if ((d.type === 'RefDecl' || d.type === 'TypedAssign') && typeof d.typeName === 'string') {
      if (d.typeName === 'Self') return true;
      if (d.typeName.split('|').some(m => m.trim() === 'Self')) return true;
    }
  }
  // Inspect handler bodies for Self() calls
  function bodyHasSelfCall(body) {
    if (!Array.isArray(body)) return false;
    for (const node of body) {
      if (!node) continue;
      if (typeof node !== 'object') continue;
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && node.callee.name === 'Self') return true;
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v) && bodyHasSelfCall(v)) return true;
        if (v && typeof v === 'object' && bodyHasSelfCall([v])) return true;
      }
    }
    return false;
  }
  for (const fn of actor.functions || []) {
    if (bodyHasSelfCall(fn.body)) return true;
  }
  return false;
}

function genSubscribeCallStmt(ctx, expr, _typeEnv, _sCtx, I, outLines) {
  // Erlang variables are immutable within a clause; multiple subscribe calls
  // in the same body must use distinct binding names. Suffix everything with
  // a per-actor counter.
  if (ctx._subCounter === undefined) ctx._subCounter = 0;
  ctx._subCounter += 1;
  const nth = ctx._subCounter;
  const V = (base) => `${base}${nth}_`;
  const target = expr.target;
  // Self-subscribe: target is a bare @name / #name identifier referring to
  // this actor's own handler. No outbound wire message; we call handle_op
  // inline so the prologue registers the sub and the matching @/# arm
  // produces the initial re.
  const isSelfTarget = target?.type === 'Identifier' &&
    (target.name.startsWith('@') || target.name.startsWith('#'));
  if (!isSelfTarget && (target?.type !== 'DotAccessExpr' || target.object?.type !== 'Identifier')) {
    throw new Error('subscribe: target must be self (@name / #name) or <remoteOrChild>.<field>');
  }
  const objectName = isSelfTarget ? null : target.object.name;
  // Internal selector (for direct handle_op calls): compound subscribe@<name>.
  // Wire selector (for outbound posts): "@subscribe" — the @<field> goes
  // into the to-field space-delimited after the (angle-delimited) alias.
  const internalSelector = isSelfTarget
    ? 'subscribe' + target.name[0] + target.name.slice(1)
    : 'subscribe@' + target.property;
  const wireOp = '@subscribe';
  const toSelector = isSelfTarget ? target.name : ('@' + target.property);

  // Build the body's Erlang fun() — params destructured from Re_ positional.
  const params = expr.params || [];
  const bodyTypeEnv = new Map();
  for (const p of params) {
    if (p.name && !p.rest) bodyTypeEnv.set(p.name, p.type || null);
  }
  const bodySCtx = {
    restVars: new Set(),
    refVars: new Set(),
    childActorRefs: new Map(),
    selfSpawnedRefs: new Set(),
    ssaEnv: buildSSAEnv(expr.body),
  };
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = bodyTypeEnv;
  const funI = I + '        ';
  const bodyLines = genLocals(ctx, expr.body, bodyTypeEnv, bodySCtx, funI);
  ctx.currentTypeEnv = savedTypeEnv;

  const paramName = params[0]?.name ? erlVarName(params[0].name) : 'V_';

  outLines.push(`${I}${V('Sub_seq_')} = case get(bv_next_id_) of undefined -> 1; ${V('N_')} -> ${V('N_')} + 1 end,`);
  outLines.push(`${I}put(bv_next_id_, ${V('Sub_seq_')}),`);
  outLines.push(`${I}${V('Sub_id_')} = integer_to_binary(${V('Sub_seq_')}),`);
  outLines.push(`${I}put({pending_subscribe, ${V('Sub_id_')}}, fun(${V('Sub_re_')}) ->`);
  outLines.push(`${funI}${V('Sub_pos_')} = case ${V('Sub_re_')} of ${V('Sub_l_')} when is_list(${V('Sub_l_')}) -> ${V('Sub_l_')}; _ -> [${V('Sub_re_')}] end,`);
  outLines.push(`${funI}${paramName} = lists:nth(1, ${V('Sub_pos_')}),`);
  outLines.push(...bodyLines);
  if (outLines.length > 0 && outLines[outLines.length - 1].endsWith(',')) {
    outLines[outLines.length - 1] = outLines[outLines.length - 1].replace(/,$/, '');
  }
  outLines.push(`${I}end),`);

  // Build two op payloads: wireOpExpr uses the bare verb (for outbound wire),
  // internalOpExpr uses the compound selector (for inline handle_op calls on
  // the self and child paths, where the existing subscribe@/# prologue
  // pattern-matches the full compound). Without args the op is the selector
  // binary; with args it becomes `[ArgsShape, SelectorBinary]`.
  const args = expr.args || [];
  const positional = args.filter(a => a.positional);
  const named = args.filter(a => !a.positional);
  const genArgVal = a => a.expr
    ? genExpr(ctx, a.expr, bodyTypeEnv, bodySCtx)
    : erlVarName(a.name);
  const typeOf = a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null;
  const buildOpExpr = (opStr) => {
    if (positional.length === 0 && named.length === 0) return `<<"${opStr}">>`;
    if (named.length > 0 && positional.length === 0) {
      const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      return `[#{${fields}}, <<"${opStr}">>]`;
    }
    if (positional.length > 0 && named.length === 0) {
      const vals = positional.map(genArgVal).join(', ');
      return `[[${vals}], <<"${opStr}">>]`;
    }
    const vals = positional.map(genArgVal).join(', ');
    const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    return `[${vals}, #{${fields}}, <<"${opStr}">>]`;
  };
  const wireOpExpr = buildOpExpr(wireOp);
  const internalOpExpr = buildOpExpr(internalSelector);
  let payloadExpr = 'null';
  let bvaExpr = null;
  if (named.length > 0 && positional.length === 0) {
    const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    const bvaFields = named.map(a => `${erlString(a.name)} => ${typeOf(a) ? erlString(typeOf(a)) : 'null'}`).join(', ');
    payloadExpr = `#{${fields}}`;
    bvaExpr = `[#{${bvaFields}}]`;
  } else if (positional.length > 0 && named.length === 0) {
    const vals = positional.map(genArgVal).join(', ');
    const bvaVals = positional.map(a => typeOf(a) ? erlString(typeOf(a)) : 'null').join(', ');
    payloadExpr = `[${vals}]`;
    bvaExpr = `[[${bvaVals}]]`;
  } else if (positional.length > 0 && named.length > 0) {
    const vals = positional.map(genArgVal).join(', ');
    const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    const bvaVals = positional.map(a => typeOf(a) ? erlString(typeOf(a)) : 'null').join(', ');
    const bvaFields = named.map(a => `${erlString(a.name)} => ${typeOf(a) ? erlString(typeOf(a)) : 'null'}`).join(', ');
    payloadExpr = `[${vals}, #{${fields}}]`;
    bvaExpr = `[${bvaVals}, #{${bvaFields}}]`;
  }

  const isRemoteDep = !isSelfTarget &&
    ctx.dependencyNames?.has(objectName) && !ctx.stateVarNames?.has(objectName);
  const childActorType = !isSelfTarget && ctx.childVarToActor?.get(objectName);
  // Self/child direct dispatch passes the compound selector as handle_op's
  // first arg (so the subscribe@/# prologue pattern-matches). Remote posts
  // the bare verb on the wire, with the @field selector in the to-field.
  const selectorBin = `<<"${internalSelector}">>`;
  if (isSelfTarget) {
    // Self-dispatch: call handle_op inline. Sub_msg_'s op carries the compound
    // selector too so the prologue's args extraction (hd(op) when list) still
    // finds args at position 0.
    const bvaField = bvaExpr ? `, <<"bv-a">> => ${bvaExpr}` : '';
    outLines.push(`${I}${V('Sub_msg_')} = #{<<"id">> => ${V('Sub_id_')}, <<"op">> => ${internalOpExpr}${bvaField}},`);
    outLines.push(`${I}{ok, ${V('Sub_init_re_')}, _} = handle_op(${selectorBin}, ${V('Sub_msg_')}, ${payloadExpr}, ${V('Sub_id_')}, <<"__parent">>),`);
    outLines.push(`${I}(get({pending_subscribe, ${V('Sub_id_')}}))(${V('Sub_init_re_')}),`);
  } else if (isRemoteDep) {
    // Remote wire: bare verb in op, full address as "#<alias selector>".
    const bvaField = bvaExpr ? `, <<"bv-a">> => ${bvaExpr}` : '';
    const toBin = `<<"#<${objectName} ${toSelector}>">>`;
    outLines.push(`${I}${V('Sub_msg_')} = #{<<"id">> => ${V('Sub_id_')}, <<"op">> => ${wireOpExpr}, <<"to">> => ${toBin}${bvaField}},`);
    outLines.push(`${I}io:put_chars([json_encode(${V('Sub_msg_')}), $\\n]),`);
  } else if (childActorType) {
    const childName = childActorType.toLowerCase();
    const bvaField = bvaExpr ? `, <<"bv-a">> => ${bvaExpr}` : '';
    outLines.push(`${I}${V('Sub_msg_')} = #{<<"id">> => ${V('Sub_id_')}, <<"op">> => ${internalOpExpr}${bvaField}},`);
    outLines.push(`${I}{ok, ${V('Sub_init_re_')}, _} = child_${childName}_handle_op(${selectorBin}, ${V('Sub_msg_')}, ${payloadExpr}, ${V('Sub_id_')}, <<"__parent">>),`);
    outLines.push(`${I}(get({pending_subscribe, ${V('Sub_id_')}}))(${V('Sub_init_re_')}),`);
  } else {
    throw new Error(`subscribe: target '${objectName}' is not a known remote dep or local child actor`);
  }
}

// Function-body dep construction: t = Thing(args)
// Emits `new` outbound, awaits the reply (synchronously via await_new_response_),
// and binds the resulting actor address to the local erlang variable.
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
  // Emit `new` and synchronously await the reply (returning the instance addr).
  // Use a unique seq slot per call site so the var names don't collide.
  const seq = ctx.sendCounter++;
  lines.push(`${I}New_seq_${seq} = case get(send_seq_) of undefined -> 1; New_n_${seq} -> New_n_${seq} end,`);
  lines.push(`${I}put(send_seq_, New_seq_${seq} + 1),`);
  lines.push(`${I}New_id_${seq} = integer_to_binary(New_seq_${seq}),`);
  lines.push(`${I}New_msg_${seq} = #{<<"id">> => New_id_${seq}, <<"op">> => [${argsExpr}, <<"#new">>], <<"to">> => ${erlString(targetName)}},`);
  lines.push(`${I}io:put_chars([json_encode(New_msg_${seq}), $\n]),`);
  lines.push(`${I}${varName} = await_new_response_(New_id_${seq}),`);
}

function genErlAsSend(ctx, varName, typeName, target, I, lines) {
  const v = erlSendVars(ctx);
  lines.push(`${I}${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,`);
  lines.push(`${I}put(send_seq_, ${v.seq} + 1),`);
  lines.push(`${I}${v.id} = integer_to_binary(${v.seq}),`);
  lines.push(`${I}${v.msg} = #{<<"id">> => ${v.id}, <<"op">> => [${erlString(typeName)}, <<"as">>], <<"to">> => ${target}},`);
  lines.push(`${I}io:put_chars([json_encode(${v.msg}), $\n]),`);
  lines.push(`${I}${varName} = hd(await_response_(${v.id})),`);
}

function genErlDepConstructorAsAssign(ctx, s, varName, typeEnv, stmtCtx, I, lines) {
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
  const seq = ctx.sendCounter++;
  lines.push(`${I}New_seq_${seq} = case get(send_seq_) of undefined -> 1; New_n_${seq} -> New_n_${seq} end,`);
  lines.push(`${I}put(send_seq_, New_seq_${seq} + 1),`);
  lines.push(`${I}New_id_${seq} = integer_to_binary(New_seq_${seq}),`);
  lines.push(`${I}New_msg_${seq} = #{<<"id">> => New_id_${seq}, <<"op">> => [${argsExpr}, <<"#new">>], <<"to">> => ${erlString(targetName)}},`);
  lines.push(`${I}io:put_chars([json_encode(New_msg_${seq}), $\n]),`);
  lines.push(`${I}New_addr_${seq} = await_new_response_(New_id_${seq}),`);
  genErlAsSend(ctx, varName, s.typeName, `New_addr_${seq}`, I, lines);
}

function genLocals(ctx, body, typeEnv, sCtx, indent) {
  const I = indent;
  const lines = [];
  const ssaEnv = sCtx.ssaEnv || buildSSAEnv(body);
  // Track lambda start index for scoped overload resolution
  const savedLambdaStartIdx = ctx._lambdaStartIdx;
  ctx._lambdaStartIdx = ctx.lambdaHandlers?.length || 0;
  // Per-handler-body local actor vars from dep constructor calls
  ctx.localInstanceVars = new Set();

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    const stmtCtx = { ...sCtx, stmtIdx: i, ssaEnv };

    {
      const catchCode = tryGenErlCatchOrLabelStmt(ctx, s, typeEnv, stmtCtx, I);
      if (catchCode !== null) { lines.push(catchCode); continue; }
    }
    // ImplicitReturn(CatchExpr) at the tail of a body is treated as a statement
    // for Phase 1 — its value is discarded. The check above already handles
    // Phase-1 catch statements at any position.

    if (s.type === 'Reply' || s.type === 'ImplicitReturn' || s.type === 'Return') continue;

    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      // Handle lambda overload <</Function() before SSA to avoid spurious variable renaming
      if (s.value?.type === 'Function' && s.value.overloadMode === 'append') {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const freeVars = erlCollectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          for (const v of freeVars) {
            const capKey = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureKeys.push(capKey);
            const src = ctx.stateVarNames.has(v) ? `get(${erlStateKey(ctx, v)})` : genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, { ...sCtx, stmtIdx: i, ssaEnv });
            lines.push(`${I}put('${capKey}', ${src}),`);
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          ctx.lambdaHandlers.push(entry);
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

      // Self(args) — recursive spawn. Bind to a freshly-spawned PID running
      // ?MODULE:start_internal/1; dot-call dispatch routes via direct
      // {bv_dispatch, ...} Erlang messages.
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && s.value.callee.name === 'Self') {
        const argList = s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ');
        lines.push(`${I}${varName} = spawn(?MODULE, start_internal, [[${argList}]]),`);
        sCtx.selfSpawnedRefs?.add(s.name);
        continue;
      }

      // Typed-assign to a spawn-needing class from any expression that
      // yields a Value (e.g. `p Peer = peers.first`). Extract the embedded
      // PID/u32 and track the variable as a spawn-ref so .method() dispatch
      // routes via {bv_dispatch, ...}. The runtime value of an in-process
      // instance ref is the Erlang Pid itself.
      if (s.type === 'TypedAssign' && s.typeName && ctx.actorInfo?.has(s.typeName) &&
          classNeedsSpawnedInstances(ctx.actorInfo.get(s.typeName)?.actor) &&
          s.value && s.value.type !== 'FunctionCallExpr' &&
          s.value.type !== 'Identifier') {
        const raw = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}${varName} = ${raw},`);
        sCtx.selfSpawnedRefs?.add(s.name);
        if (sCtx.selfSpawnedClassMap) sCtx.selfSpawnedClassMap.set(s.name, s.typeName);
        continue;
      }

      // Typed dep constructor: n Integer = Service() → emit `new` then [Type, as]
      if (s.type === 'TypedAssign' && s.typeName && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name) && !ctx.destructuredMembers?.has(s.value.callee.name)) {
        genErlDepConstructorAsAssign(ctx, s, varName, typeEnv, stmtCtx, I, lines);
        continue;
      }

      // Dependency constructor: t = Thing(args) → emit `new` + await reply
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name) && !ctx.destructuredMembers?.has(s.value.callee.name)) {
        genErlDepConstructorAssign(ctx, s, varName, typeEnv, stmtCtx, I, lines);
        continue;
      }

      if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        const asClause = findErlAsClauseMatch(ctx, s.typeName, s.value.callee.name);
        if (asClause) {
          if (asClause.memoized) {
            const actorName = s.value.callee.name;
            const childPrefix = `child_${actorName.toLowerCase()}`;
            // Init the child actor first
            const initParams = ctx.actorInfo.get(actorName)?.actor?.initParams || [];
            const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
            if (s.value.args.length === 0) {
              lines.push(`${I}${childPrefix}_init(#{}),`);
            } else if (namedBag) {
              const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
              const namedFields = namedBag.fields || {};
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
              if (posArgs.length > 0 && mapEntries.length > 0) {
                lines.push(`${I}${childPrefix}_init([${posArgs.join(', ')}, #{${mapEntries.join(', ')}}]),`);
              } else if (mapEntries.length > 0) {
                lines.push(`${I}${childPrefix}_init(#{${mapEntries.join(', ')}}),`);
              } else {
                lines.push(`${I}${childPrefix}_init([${posArgs.join(', ')}]),`);
              }
            } else {
              const initArgs = s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ');
              lines.push(`${I}${childPrefix}_init([${initArgs}]),`);
            }
            // Extract memoized value via child dispatch
            lines.push(`${I}{ok, [${varName}], _} = ${childPrefix}_handle_op(<<"as">>, #{}, ${erlString(s.typeName)}, <<>>, <<>>),`);
            continue;
          }
          lines.push(`${I}${varName} = ${genExpr(ctx, asClause.expr, typeEnv, stmtCtx)},`);
          continue;
        }
      }

      // Typed assign from dependency service ref: n Integer = Counter → send [Type, as]
      if (s.type === 'TypedAssign' && s.typeName && s.value?.type === 'Identifier' && ctx.dependencyNames.has(s.value.name)) {
        if (ctx.destructuredMembers?.has(s.value.name)) {
          const { service, remote } = ctx.destructuredMembers.get(s.value.name);
          const to = erlString(service);
          const method = erlString('@' + remote);
          const v = erlSendVars(ctx);
          lines.push(`${I}${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,`);
          lines.push(`${I}put(send_seq_, ${v.seq} + 1),`);
          lines.push(`${I}${v.id} = integer_to_binary(${v.seq}),`);
          lines.push(`${I}${v.msg} = #{<<"id">> => ${v.id}, <<"op">> => ${method}, <<"to">> => ${to}},`);
          lines.push(`${I}io:put_chars([json_encode(${v.msg}), $\n]),`);
          lines.push(`${I}${varName} = maps:get(${erlString(s.name)}, await_response_(${v.id}), null),`);
          continue;
        }
        genErlAsSend(ctx, varName, s.typeName, erlString(s.value.name), I, lines);
        continue;
      }

      // Typed assign from in-file child actor ref: n Integer = c → child dispatch [Type, as]
      if (s.type === 'TypedAssign' && s.typeName && s.value?.type === 'Identifier' && stmtCtx.childActorRefs?.has(s.value.name)) {
        const actorName = stmtCtx.childActorRefs.get(s.value.name);
        const prefix = `child_${actorName.toLowerCase()}`;
        const n = ctx.ephCounter++;
        lines.push(`${I}{ok, Eph_as_re_${n}_, _} = ${prefix}_handle_op(<<"as">>, #{}, ${erlString(s.typeName)}, <<"0">>, <<"__parent">>),`);
        lines.push(`${I}${varName} = hd(Eph_as_re_${n}_),`);
        continue;
      }

      // Typed assign from remote actor ref (state var): n Integer = s → send [Type, as]
      if (s.type === 'TypedAssign' && s.typeName && s.value?.type === 'Identifier' && ctx.remoteInstanceVars?.has(s.value.name)) {
        const target = `get(${erlStateKey(ctx, s.value.name)})`;
        genErlAsSend(ctx, varName, s.typeName, target, I, lines);
        continue;
      }
      // Typed assign from local actor ref (handler-scoped): n Integer = t → send [Type, as]
      if (s.type === 'TypedAssign' && s.typeName && s.value?.type === 'Identifier' && ctx.localInstanceVars?.has(s.value.name)) {
        const resolved = resolveSSAName(s.value.name, ssaEnv);
        const target = erlVarName(resolved);
        genErlAsSend(ctx, varName, s.typeName, target, I, lines);
        continue;
      }

      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo.has(s.value.callee.name)) {
        // Non-ref actor construction — assign actor name atom to variable
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
        // If the class needs per-instance state (declares an @peer Self|null
        // cell, or contains Self() recursion), spawn a real Erlang process so
        // each instance has its own dict. Otherwise use the flattened model.
        const childActor = ctx.actorInfo.get(actorName)?.actor;
        const needsSpawn = classNeedsSpawnedInstances(childActor);
        if (needsSpawn) {
          let initArgsExpr;
          const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
          if (namedBag) {
            const initParams = childActor?.initParams || [];
            const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
            const namedFields = namedBag.fields || {};
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
              initArgsExpr = `#{${mapEntries.join(', ')}}`;
            } else if (posArgs.length > 0 && mapEntries.length > 0) {
              initArgsExpr = `[${posArgs.join(', ')}, #{${mapEntries.join(', ')}}]`;
            } else {
              initArgsExpr = `[${posArgs.join(', ')}]`;
            }
          } else if (s.value.args.length === 0) {
            initArgsExpr = '#{}';
          } else {
            initArgsExpr = `[${s.value.args.map(a => genExpr(ctx, a, typeEnv, stmtCtx)).join(', ')}]`;
          }
          lines.push(`${I}${varName} = spawn(?MODULE, start_internal_${actorName.toLowerCase()}, [${initArgsExpr}]),`);
          sCtx.selfSpawnedRefs?.add(s.name);
          // If any named arg corresponds to a host state cell AND the
          // class declared a SubscribeCall on that constructor param,
          // register the subscription with the host's cell_subs and
          // deliver the cell's current value to this fresh instance.
          const paramSubs = childActor?._paramSubscriptions || [];
          if (paramSubs.length > 0 && namedBag) {
            const namedFields = namedBag.fields || {};
            for (const ps of paramSubs) {
              const argExpr = namedFields[ps.paramName];
              if (!argExpr) continue;
              if (argExpr.type !== 'Identifier') continue;
              const cellName = argExpr.name;
              if (!ctx.stateVarNames.has(cellName)) continue;
              const subsKey = `{cell_subs, ${erlString(cellName)}}`;
              const stateRef = `get(${erlStateKey(ctx, cellName)})`;
              const sn = ctx.ephCounter++;
              lines.push(`${I}InpSubs_${sn}_ = case get(${subsKey}) of undefined -> []; L_${sn}_ -> L_${sn}_ end,`);
              lines.push(`${I}put(${subsKey}, InpSubs_${sn}_ ++ [{inproc, ${varName}, ${erlString(actorName.toLowerCase())}, ${erlString(ps.callbackName)}}]),`);
              lines.push(`${I}${varName} ! {bv_dispatch, self(), ${erlString(ps.callbackName)}, [${stateRef}], integer_to_binary(erlang:unique_integer([positive]))},`);
            }
          }
          continue;
        }
        if (sCtx.childActorRefs) sCtx.childActorRefs.set(s.name, actorName);
        const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || (childActor?._supertypeBindings?.length > 0) || (childActor?._inheritedIngests?.length > 0) || s.value.args.length > 0;
        if (hasInit) {
          const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
          if (namedBag) {
            const initParams = childActor?.initParams || [];
            const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
            const namedFields = namedBag.fields || {};
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
              lines.push(`${I}child_${actorName.toLowerCase()}_init([${posArgs.join(', ')}, #{${mapEntries.join(', ')}}]),`);
            } else {
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
        if (s.typeName === 'Object') {
          lines.push(`${I}${varName} = ${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)},`);
        } else {
          lines.push(`${I}${varName} = bv_object_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
        }
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = bv_object_one(${genActorFnCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.type === 'TypedAssign' && s.typeName === 'Object' && s.value?.type === 'ObjectConstructor') {
        lines.push(`${I}${varName} = ${genExpr(ctx, s.value, typeEnv, stmtCtx)},`);
      } else if (s.type === 'TypedAssign' && s.value?.type === 'ObjectConstructor') {
        lines.push(`${I}${varName} = bv_object_one(${genExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.lambdaVarNames.has(s.value.callee.name)) {
        lines.push(`${I}${varName} = bv_object_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && (() => {
        const ct = ctx.currentTypeEnv?.get(s.value.callee.name);
        return ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')));
      })()) {
        lines.push(`${I}${varName} = bv_object_one(${genErlLambdaVarCall(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'FunctionCallExpr') {
        lines.push(`${I}${varName} = bv_object_one(${genFunctionCallExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
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
        lines.push(`${I}${varName} = bv_object_one(${genChildDotCallAwait(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'DotAccessExpr' && s.value.object?.type === 'Identifier' && stmtCtx.childActorRefs?.has(s.value.object.name)) {
        // Bare field read on a child actor: v = c.val — same shape as no-args DotCallExpr
        lines.push(`${I}${varName} = bv_object_one(${genExpr(ctx, s.value, typeEnv, stmtCtx)}),`);
      } else if (s.value?.type === 'DotCallExpr') {
        // Use genDotCallAwait for remote calls that return values
        const dotObj = s.value.object;
        const dotObjName = dotObj.type === 'RefRead' ? dotObj.name : (dotObj.type === 'Identifier' ? dotObj.name : null);
        const needsAwait = dotObjName && (ctx.remoteInstanceVars.has(dotObjName) || ctx.localInstanceVars?.has(dotObjName));
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
      if (s.expr?.type === 'SubscribeCall') {
        genSubscribeCallStmt(ctx, s.expr, typeEnv, stmtCtx, I, lines);
      } else {
        lines.push(`${I}${genExpr(ctx, s.expr, typeEnv, stmtCtx)},`);
      }
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
      // Detect child actor construction: ref name = ActorName(args)
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
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${val}], _Id, _From),`);
      } else {
        const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
        lines.push(`${I}put(${erlSetTarget(ctx, s.name)}, ${val}),`);
        // In-process subscribers: cell_subs entries tagged {inproc, Pid,
        // Class, Callback} represent spawn-needing class instances whose
        // class body subscribed to this cell via a constructor-param ref.
        // Dispatch the new value to each.
        if (ctx.stateVarNames?.has(s.name)) {
          const subsKeyL = `{cell_subs, ${erlString(s.name)}}`;
          const sn = ctx.ephCounter++;
          lines.push(`${I}InprocSubs_${sn}_ = case get(${subsKeyL}) of undefined -> []; LL_${sn}_ -> LL_${sn}_ end,`);
          lines.push(`${I}lists:foreach(fun`);
          lines.push(`${I}    ({inproc, IpcPid_${sn}_, _IpcCls_${sn}_, IpcCb_${sn}_}) ->`);
          lines.push(`${I}        IpcPid_${sn}_ ! {bv_dispatch, self(), IpcCb_${sn}_, [get(${erlSetTarget(ctx, s.name)})], integer_to_binary(erlang:unique_integer([positive])) };`);
          lines.push(`${I}    (_) -> ok`);
          lines.push(`${I}end, InprocSubs_${sn}_),`);
        }
        // Private/state ref mutation triggers re-evaluation of any @/# fn
        // whose body captures this ref, per subscriber (with stored args).
        const derivedFns = ctx._refCapturedBy?.get(s.name);
        if (derivedFns && derivedFns.size > 0) {
          const dispatchFn = ctx.childStatePrefix ? `child_${ctx.childStatePrefix}_handle_op` : 'handle_op';
          // Multiple set sites within one handler body (e.g. `a <- 1; b <- 2`
          // where both trigger replay for the same derived fn) must use
          // distinct variable names — Erlang bindings don't rebind.
          if (ctx._fnReplayCounter === undefined) ctx._fnReplayCounter = 0;
          ctx._fnReplayCounter += 1;
          const nth = ctx._fnReplayCounter;
          for (const fnFullName of derivedFns) {
            const sfx = fnFullName.replace(/[^a-zA-Z0-9]/g, '') + nth;
            const fnKey = `{cell_subs, ${erlString(fnFullName.slice(1))}}`;
            const selectorBin = `<<"${fnFullName}">>`;
            lines.push(`${I}FnSubs${sfx}_ = case get(${fnKey}) of undefined -> []; FL${sfx}_ -> FL${sfx}_ end,`);
            // Skip inproc-tagged subs so they aren't accidentally treated
            // as remote subscribers (which would emit JSON to stdout) —
            // their notifications are handled separately above.
            lines.push(`${I}lists:foreach(fun`);
            lines.push(`${I}    ({inproc, _, _, _}) -> ok;`);
            lines.push(`${I}    ({FnSubId${sfx}_, FnSubFrom${sfx}_, FnSubArgs${sfx}_, FnSubBva${sfx}_}) ->`);
            lines.push(`${I}    FnOp${sfx}_ = case FnSubArgs${sfx}_ of null -> ${selectorBin}; _ -> [FnSubArgs${sfx}_, ${selectorBin}] end,`);
            lines.push(`${I}    FnMsg${sfx}_ = case FnSubBva${sfx}_ of null -> #{<<"id">> => FnSubId${sfx}_, <<"op">> => FnOp${sfx}_}; _ -> #{<<"id">> => FnSubId${sfx}_, <<"op">> => FnOp${sfx}_, <<"bv-a">> => FnSubBva${sfx}_} end,`);
            lines.push(`${I}    case ${dispatchFn}(${selectorBin}, FnMsg${sfx}_, FnSubArgs${sfx}_, FnSubId${sfx}_, <<"__parent">>) of`);
            lines.push(`${I}        {ok, FnRe${sfx}_, FnBva${sfx}_} ->`);
            lines.push(`${I}            case FnSubFrom${sfx}_ of`);
            lines.push(`${I}                <<"__parent">> ->`);
            lines.push(`${I}                    case get({pending_subscribe, FnSubId${sfx}_}) of`);
            lines.push(`${I}                        FnFun${sfx}_ when is_function(FnFun${sfx}_) -> FnFun${sfx}_(FnRe${sfx}_);`);
            lines.push(`${I}                        _ -> ok`);
            lines.push(`${I}                    end;`);
            lines.push(`${I}                _ ->`);
            lines.push(`${I}                    FnResp${sfx}_0 = #{<<"id">> => FnSubId${sfx}_, <<"re">> => FnRe${sfx}_, <<"to">> => FnSubFrom${sfx}_},`);
            lines.push(`${I}                    FnResp${sfx}_ = case FnBva${sfx}_ of null -> FnResp${sfx}_0; undefined -> FnResp${sfx}_0; _ -> FnResp${sfx}_0#{<<"bv-a">> => FnBva${sfx}_} end,`);
            lines.push(`${I}                    io:put_chars([json_encode(FnResp${sfx}_), $\\n])`);
            lines.push(`${I}            end;`);
            lines.push(`${I}        _ -> ok`);
            lines.push(`${I}    end`);
            lines.push(`${I}end, FnSubs${sfx}_),`);
          }
        }
      }
    }

    if (s.type === 'ActorSetStatement') {
      if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.name)) {
        const actorName = sCtx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
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
      // Internal selector for direct child_handle_op calls: set@<field>.
      // Wire shape for remote posts: op:"set" bare, to:"`alias` @field".
      const internalSetSelector = 'set@' + s.fieldName;
      const toSelector = '@' + s.fieldName;
      const val = genExpr(ctx, s.value, typeEnv, stmtCtx);
      // Synthetic in-process id/from: set is silent (no reply awaited) so
      // Id is unused; From=<<"__parent">> marks in-process routing, which
      // the child's cell_subs notification recognizes for local dispatch.
      if (sCtx.selfSpawnedRefs?.has(s.objectName)) {
        // Spawned-PID instance: send the set as a {bv_dispatch,...} Erlang
        // message. The set is silent (no reply awaited), but we still need
        // a valid Id so the receiving instance's bv_loop can match.
        const resolved = resolveSSAName(s.objectName, i, ssaEnv);
        const pidExpr = erlVarName(resolved);
        lines.push(`${I}${pidExpr} ! {bv_dispatch, self(), <<"${internalSetSelector}">>, [${val}], <<"0">>},`);
      } else if (sCtx.childActorRefs && sCtx.childActorRefs.has(s.objectName)) {
        const actorName = sCtx.childActorRefs.get(s.objectName);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${internalSetSelector}">>, #{}, [${val}], <<>>, <<"__parent">>),`);
      } else if (ctx.childVarToActor?.has(s.objectName)) {
        // Module-level child state var: c = C() at file init.
        const actorName = ctx.childVarToActor.get(s.objectName);
        lines.push(`${I}child_${actorName.toLowerCase()}_handle_op(<<"${internalSetSelector}">>, #{}, [${val}], <<>>, <<"__parent">>),`);
      } else if (ctx.dependencyNames?.has(s.objectName) && !ctx.stateVarNames?.has(s.objectName)) {
        // Remote dep: post to stdout with bare verb + angle-delimited alias + sel.
        // Include `bv-a` so the remote's schema_required check passes.
        const typeHint = s.value?.type === 'Identifier'
          ? (typeEnv.get(s.value.name) || null)
          : (inferLiteralType(s.value) || null);
        const bvaField = typeHint
          ? `, <<"bv-a">> => [[<<"${typeHint}">>]]`
          : '';
        const toBin = `<<"#<${s.objectName} ${toSelector}>">>`;
        lines.push(`${I}Set_msg_ = #{<<"op">> => [[${val}], <<"#set">>], <<"to">> => ${toBin}${bvaField}},`);
        lines.push(`${I}io:put_chars([json_encode(Set_msg_), $\\n]),`);
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


// Builds a `case is_truthy(cond) of true -> ...; false -> ... end` chain for
// an `if (cond) { -> val }` (or single-line) inside a repeat-while body. The
// branches emit `throw(...)` from `makeThrow(fields)`. The else / fallthrough
// produces `null` so the loop continues to the next iteration when no branch
// fired.
function buildErlWhileGuardCase(ctx, ifExpr, typeEnv, sCtx, makeThrow) {
  const cond = genExpr(ctx, ifExpr.cond, typeEnv, sCtx);

  function genBranchExpr(branchBody) {
    if (!Array.isArray(branchBody) || branchBody.length === 0) return 'null';
    const exprs = [];
    for (const s of branchBody) {
      if (s.type === 'Return') {
        exprs.push(makeThrow(s.fields));
      } else if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr') {
        exprs.push(buildErlWhileGuardCase(ctx, s.expr, typeEnv, sCtx, makeThrow));
      } else if (s.type === 'TypedAssign') {
        exprs.push(`${erlVarName(s.name)} = ${genExpr(ctx, s.value, typeEnv, sCtx)}`);
      } else if (s.type === 'SetStatement') {
        exprs.push(`put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
      } else if (s.type === 'StateAssign') {
        exprs.push(`put(${erlStateKey(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
      } else if (s.type === 'ExprStatement') {
        exprs.push(genExpr(ctx, s.expr, typeEnv, sCtx));
      }
    }
    return exprs.length === 1 ? exprs[0] : `begin ${exprs.join(', ')} end`;
  }

  const trueExpr = genBranchExpr(ifExpr.then?.body || []);
  let falseExpr = 'null';
  const elseBranch = ifExpr.else;
  if (elseBranch) {
    if (elseBranch.type === 'IfExpr') {
      falseExpr = buildErlWhileGuardCase(ctx, elseBranch, typeEnv, sCtx, makeThrow);
    } else if (elseBranch.body) {
      falseExpr = genBranchExpr(elseBranch.body);
    }
  }
  return `case is_truthy(${cond}) of true -> ${trueExpr}; false -> ${falseExpr} end`;
}

// ── catch / label-invoke (Phase 1: bare void exit) ───────────────────────────
//
// `catch #label { body }` lowers to a `try/catch` block; `#label` invocations
// throw a tagged tuple that the matching catch arm intercepts. Tag matching
// gives multi-level exit naturally — an inner try/catch matches only its own
// tag, so an outer label's throw bubbles past.

function lookupCatchTag(ctx, brevityName) {
  const stack = ctx.catchLabelStack || [];
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].brevityName === brevityName) return stack[i].tag;
  }
  throw new Error(`Label ${brevityName} is not in scope`);
}

function ifContainsLabelExitErl(node) {
  if (!node) return false;
  if (node.type === 'LabelInvoke') return true;
  if (node.type === 'IfBranch') {
    if (node.expr) return ifContainsLabelExitErl(node.expr);
    if (node.body) return node.body.some(catchBodyStmtHasLabelExitErl);
    return false;
  }
  if (node.type === 'IfExpr') return ifContainsLabelExitErl(node.then) || ifContainsLabelExitErl(node.else);
  return false;
}

function catchBodyStmtHasLabelExitErl(s) {
  if (!s) return false;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') return true;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExitErl(s.expr)) return true;
  return false;
}

export function genErlCatchStatement(ctx, catchExpr, typeEnv, sCtx, indent) {
  const idx = ctx.catchLabelCounter++;
  const safeName = catchExpr.label.replace(/[^a-zA-Z0-9]/g, '');
  const tag = `__brevity_catch_${safeName}_${idx}__`;
  const isValue = !catchExpr.isVoid;
  ctx.catchLabelStack.push({ brevityName: catchExpr.label, tag, isValue });
  const I = indent;
  const II = I + '    ';
  // Body emits a sequence of comma-separated Erlang expressions. For value-
  // carrying catch the LAST expression is the fall-through value; for void
  // catch we cap with `null`.
  const bodyExprs = [];
  const last = catchExpr.body.length - 1;
  for (let i = 0; i < catchExpr.body.length; i++) {
    const s = catchExpr.body[i];
    const isTail = i === last;
    const e = genErlCatchBodyExpr(ctx, s, typeEnv, sCtx, II, { isTail: isValue && isTail });
    if (e !== null && e !== '') bodyExprs.push(e);
  }
  if (!isValue) bodyExprs.push(`${II}null`);
  const catchClause = isValue
    ? `${II}throw:{'${tag}', __V_${idx}__} -> __V_${idx}__`
    : `${II}throw:'${tag}' -> null`;
  ctx.catchLabelStack.pop();
  return `${I}try\n${bodyExprs.join(',\n')}\n${I}catch\n${catchClause}\n${I}end,`;
}

function genErlCatchBodyExpr(ctx, s, typeEnv, sCtx, indent, opts = {}) {
  const { isTail = false } = opts;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') {
    const entry = (ctx.catchLabelStack || []).slice().reverse().find(e => e.brevityName === s.expr.label);
    if (!entry) throw new Error(`Label ${s.expr.label} is not in scope`);
    if (s.expr.valueExpr) {
      return `${indent}throw({'${entry.tag}', ${genExpr(ctx, s.expr.valueExpr, typeEnv, sCtx)}})`;
    }
    return `${indent}throw('${entry.tag}')`;
  }
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExitErl(s.expr)) {
    return genErlIfWithLabelExit(ctx, s.expr, typeEnv, sCtx, indent);
  }
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'CatchExpr') {
    // Inline a nested catch as an expression — return without trailing comma;
    // genErlCatchStatement already returns a `try ... end,` block. Strip the
    // trailing comma so it composes with the outer comma-join.
    const stmt = genErlCatchStatement(ctx, s.expr, typeEnv, sCtx, indent);
    return stmt.replace(/,$/, '');
  }
  if (s.type === 'WhileStatement') {
    // genWhileStatement returns a statement chunk ending with `loopName(),`.
    // Strip the trailing comma so we can join with the outer comma-pattern.
    const stmt = genWhileStatement(ctx, s, typeEnv, sCtx, indent);
    return stmt.replace(/,$/, '');
  }
  if (s.type === 'BareTypeDecl') return '';
  if (s.type === 'SetStatement') {
    return `${indent}put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`;
  }
  if (s.type === 'StateAssign') {
    return `${indent}put(${erlStateKey(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`;
  }
  if (s.type === 'TypedAssign' || s.type === 'Assign') {
    return `${indent}${erlVarName(s.name)} = ${genExpr(ctx, s.value, typeEnv, sCtx)}`;
  }
  if (s.type === 'RefDecl') {
    const val = s.value ? genExpr(ctx, s.value, typeEnv, sCtx) : 'null';
    return `${indent}put(${erlSetTarget(ctx, s.name)}, ${val})`;
  }
  if (s.type === 'ExprStatement') {
    return `${indent}${genExpr(ctx, s.expr, typeEnv, sCtx)}`;
  }
  if (s.type === 'ImplicitReturn') {
    // For value-carrying catch's tail, the expression IS the fall-through;
    // emitted bare (no extra wrapping). Erlang's `try` returns the last
    // expression of its body when no throw fires.
    void isTail;
    return `${indent}${genExpr(ctx, s.expr, typeEnv, sCtx)}`;
  }
  throw new Error(`Erlang catch body: unsupported statement ${s.type}`);
}

function genErlIfWithLabelExit(ctx, ifExpr, typeEnv, sCtx, indent) {
  const cond = genExpr(ctx, ifExpr.cond, typeEnv, sCtx);
  const I = indent;
  const II = I + '    ';
  const thenExpr = genErlBranchExpr(ctx, ifExpr.then, typeEnv, sCtx, II);
  let falseExpr;
  if (!ifExpr.else) {
    falseExpr = 'null';
  } else if (ifExpr.else.type === 'IfExpr') {
    falseExpr = '\n' + genErlIfWithLabelExit(ctx, ifExpr.else, typeEnv, sCtx, II).replace(/,$/, '');
  } else {
    falseExpr = '\n' + genErlBranchExpr(ctx, ifExpr.else, typeEnv, sCtx, II);
  }
  return `${I}case is_truthy(${cond}) of\n${II}true ->\n${thenExpr};\n${II}false ->${falseExpr}\n${I}end`;
}

function genErlBranchExpr(ctx, branch, typeEnv, sCtx, indent) {
  if (!branch) return `${indent}null`;
  if (branch.body) {
    const exprs = branch.body.map(s => genErlCatchBodyExpr(ctx, s, typeEnv, sCtx, indent)).filter(e => e);
    if (exprs.length === 0) return `${indent}null`;
    return exprs.join(',\n');
  }
  if (branch.expr) {
    if (branch.expr.type === 'LabelInvoke') {
      const entry = (ctx.catchLabelStack || []).slice().reverse().find(e => e.brevityName === branch.expr.label);
      if (!entry) throw new Error(`Label ${branch.expr.label} is not in scope`);
      if (branch.expr.valueExpr) {
        return `${indent}throw({'${entry.tag}', ${genExpr(ctx, branch.expr.valueExpr, typeEnv, sCtx)}})`;
      }
      return `${indent}throw('${entry.tag}')`;
    }
    return `${indent}${genExpr(ctx, branch.expr, typeEnv, sCtx)}`;
  }
  return `${indent}null`;
}

// Returns an Erlang statement-form (with trailing comma) if `s` is a catch
// statement, else null. Hook for body-walking sites in genLocals.
function tryGenErlCatchOrLabelStmt(ctx, s, typeEnv, sCtx, indent) {
  if (s.type === 'ExprStatement' || s.type === 'ImplicitReturn') {
    if (s.expr?.type === 'CatchExpr') return genErlCatchStatement(ctx, s.expr, typeEnv, sCtx, indent);
    if (s.expr?.type === 'LabelInvoke') {
      const tag = lookupCatchTag(ctx, s.expr.label);
      return `${indent}throw('${tag}'),`;
    }
    if (s.expr?.type === 'IfExpr' && ifContainsLabelExitErl(s.expr)) {
      return genErlIfWithLabelExit(ctx, s.expr, typeEnv, sCtx, indent) + ',';
    }
  }
  return null;
}

function genWhileStatement(ctx, node, typeEnv, sCtx, indent) {
  const I = indent;
  const loopId = ctx.whileCounter++;
  const loopName = `Loop_${loopId}`;

  const cond = genExpr(ctx, node.cond, typeEnv, sCtx);
  const trueCase = node.negated ? 'false' : 'true';
  const falseCase = node.negated ? 'true' : 'false';

  // ctx.whileEarlyThrow, when set, builds the `throw({...})` expression for an
  // early return inside this while body. Set by the enclosing fn (handle_op
  // arm or _fn method) before delegating to genLocals; cleared after.
  const makeThrow = ctx.whileEarlyThrow;

  const bodyLines = [];
  for (const s of node.body) {
    // Catch / label-invoke handling — emit as expressions (no trailing comma;
    // bodyLines join with comma below).
    if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') {
      const tag = lookupCatchTag(ctx, s.expr.label);
      bodyLines.push(`${I}            throw('${tag}')`);
      continue;
    }
    if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'CatchExpr') {
      // Nested block-label catch inside while body — emit as a `try ... end`
      // expression. genErlCatchStatement returns a chunk ending with `,` —
      // strip it so the comma-join below composes correctly.
      const stmt = genErlCatchStatement(ctx, s.expr, typeEnv, sCtx, `${I}            `);
      bodyLines.push(stmt.replace(/,$/, ''));
      continue;
    }
    if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExitErl(s.expr)) {
      bodyLines.push(genErlIfWithLabelExit(ctx, s.expr, typeEnv, sCtx, `${I}            `));
      continue;
    }
    if (s.type === 'WhileStatement') {
      // Nested repeat — strip the trailing comma from the chunk so it composes
      // as an expression in the while-body comma-join.
      bodyLines.push(genWhileStatement(ctx, s, typeEnv, sCtx, `${I}            `).replace(/,$/, ''));
      continue;
    }
    if (s.type === 'SetStatement') {
      bodyLines.push(`${I}            put(${erlSetTarget(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'StateAssign') {
      bodyLines.push(`${I}            put(${erlStateKey(ctx, s.name)}, ${genExpr(ctx, s.value, typeEnv, sCtx)})`);
    } else if (s.type === 'TypedAssign') {
      bodyLines.push(`${I}            ${erlVarName(s.name)} = ${genExpr(ctx, s.value, typeEnv, sCtx)}`);
    } else if (s.type === 'Return' && makeThrow) {
      bodyLines.push(`${I}            ${makeThrow(s.fields)}`);
    } else if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && makeThrow) {
      bodyLines.push(`${I}            ${buildErlWhileGuardCase(ctx, s.expr, typeEnv, sCtx, makeThrow)}`);
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
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
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
  // Destructured member call: :v = greet(name) → send + await response
  if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.destructuredMembers?.has(s.source.callee.name)) {
    const { service, remote } = ctx.destructuredMembers.get(s.source.callee.name);
    const to = erlString(service);
    const method = erlString('@' + remote);
    const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
    const namedBag = s.source.args.find(a => a.type === 'NamedArgsBag');
    let opExpr;
    if (callArgs.length === 0 && !namedBag) {
      opExpr = method;
    } else if (namedBag) {
      const fields = Object.entries(namedBag.fields).map(([k, v]) => `${erlString(k)} => ${genExpr(ctx, v, typeEnv, sCtx)}`).join(', ');
      opExpr = `[#{${fields}}, ${method}]`;
    } else {
      const vals = callArgs.map(a => genExpr(ctx, a, typeEnv, sCtx)).join(', ');
      opExpr = `[[${vals}], ${method}]`;
    }
    const v = erlSendVars(ctx);
    lines.push(`${I}${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,`);
    lines.push(`${I}put(send_seq_, ${v.seq} + 1),`);
    lines.push(`${I}${v.id} = integer_to_binary(${v.seq}),`);
    lines.push(`${I}${v.msg} = #{<<"id">> => ${v.id}, <<"op">> => ${opExpr}, <<"to">> => ${to}},`);
    lines.push(`${I}io:put_chars([json_encode(${v.msg}), $\n]),`);
    const reVar = `Dre_${stmtIdx}`;
    lines.push(`${I}${reVar} = await_response_(${v.id}),`);
    for (const item of s.pattern) {
      if (item.discard) continue;
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);
      const key = item.key || item.name;
      lines.push(`${I}${varName} = maps:get(${erlString(key)}, ${reVar}, null),`);
    }
    return;
  }

  // Typed-value source: tagged map `#{<<"__type">> => <<"Name">>, <<"x">> => ...}` —
  // read fields by name via maps:get. Validation in src/validate.js rejects
  // over-arity and undeclared-field references before reaching codegen.
  const sourceType = inferExprType(s.source, typeEnv);
  const typeDecl = (typeof sourceType === 'string' && ctx.typeDecls?.has(sourceType))
    ? ctx.typeDecls.get(sourceType) : null;
  if (typeDecl) {
    const fields = typeDecl.fields || [];
    let srcRef;
    if (s.source.type === 'Identifier') {
      srcRef = erlVarName(resolveSSAName(s.source.name, stmtIdx, ssaEnv));
    } else {
      srcRef = `Dtmp_${stmtIdx}`;
      lines.push(`${I}${srcRef} = ${genExpr(ctx, s.source, typeEnv, sCtx)},`);
    }
    for (const item of s.pattern) {
      if (item.discard) continue;
      const ssaName = getSSANameForAssignment(item.name, stmtIdx, ssaEnv);
      const varName = erlVarName(ssaName);
      let fieldName;
      if (item.named) fieldName = item.name;
      else if (item.key !== undefined) fieldName = item.key;
      else if (item.positional) fieldName = fields[item.idx].name;
      else continue;
      lines.push(`${I}${varName} = maps:get(${erlString(fieldName)}, ${srcRef}, null),`);
    }
    return;
  }

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
        // Fall back to the first positional value if the named key is
        // missing — mirrors JS Object.one semantics for handlers that
        // return a bare value rather than a named field.
        lines.push(`${I}${varName} = case maps:find(${erlString(item.name)}, ${tempName}_named) of {ok, V_${item.name}_${stmtIdx}_} -> V_${item.name}_${stmtIdx}_; error -> case ${tempName}_pos of [H_${item.name}_${stmtIdx}_|_] -> H_${item.name}_${stmtIdx}_; _ -> null end end,`);
      } else if (item.key !== undefined) {
        lines.push(`${I}${varName} = maps:get(${erlString(item.key)}, ${tempName}_named, null),`);
      } else if (item.positional) {
        lines.push(`${I}${varName} = lists:nth(${item.idx + 1}, ${tempName}_pos),`);
      }
    }
  } else {
    // Source is an object variable — resolve through SSA so the prefix
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
  if (node.type === 'DecimalLiteral') {
    const { coeff, scale } = parseDecimalLiteral(node.value);
    return `{bv_decimal, ${coeff}, ${scale}}`;
  }
  if (node.type === 'FloatLiteral') {
    const s = String(node.value);
    return s.includes('.') ? s : s + '.0';
  }
  if (node.type === 'StringLiteral') return erlString(node.value);
  if (node.type === 'BoolLiteral') return node.value ? 'true' : 'false';
  if (node.type === 'NullLiteral') return 'null';
  if (node.type === 'ObjectLiteral') return '#{}';
  return 'null';
}

function genParamDestructure(params, indent) {
  const I = indent;
  const lines = [];
  const hasPositional = params.some(p => p.positional && !p.rest);
  const hasRest = params.some(p => p.rest);

  if (hasRest) {
    lines.push(`${I}{Args_pos, Args_named} = bv_object_pack(Payload),`);
  } else if (hasPositional) {
    lines.push(`${I}{S_pos, S_named} = bv_object_pack(Payload),`);
  }

  const wrapParam = (expr, type) => type === 'Decimal' ? `bv_dec_from_number(${expr})` : expr;

  let posIdx = 0;
  for (const p of params) {
    if (p.rest) continue;
    if (p.positional) {
      if (p.defaultValue) {
        const dv = genErlDefaultValue(p.defaultValue);
        const raw = `case length(S_pos) > ${posIdx} of true -> lists:nth(${posIdx + 1}, S_pos); false -> ${dv} end`;
        lines.push(`${I}${erlVarName(p.name)} = ${wrapParam(raw, p.type)},`);
      } else {
        const raw = `lists:nth(${posIdx + 1}, S_pos)`;
        lines.push(`${I}${erlVarName(p.name)} = ${wrapParam(raw, p.type)},`);
      }
      posIdx++;
    } else if (hasPositional) {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genErlDefaultValue(p.defaultValue) : 'null';
      const raw = `maps:get(${erlString(key)}, S_named, ${dv})`;
      lines.push(`${I}${erlVarName(p.name)} = ${wrapParam(raw, p.type)},`);
    } else {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genErlDefaultValue(p.defaultValue) : 'null';
      const raw = `maps:get(${erlString(key)}, Payload, ${dv})`;
      lines.push(`${I}${erlVarName(p.name)} = ${wrapParam(raw, p.type)},`);
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
  // Empty fields → Void return on the wire (`re: []`).
  if (fields.length === 0) return '[]';
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
  const slotType = f.type
    || (f.name && typeEnv?.get(f.name))
    || (f.expr && inferExprType(f.expr, typeEnv));
  const wireWrap = (raw) => {
    if (typeof slotType !== 'string' || !ctx.typeDecls?.has(slotType)) return raw;
    const decl = ctx.typeDecls.get(slotType);
    const fieldList = (decl.fields || []).map(fl => erlString(fl.name)).join(', ');
    const allRequired = (decl.fields || []).every(fl => !fl.optional);
    return `bv_to_wire(${raw}, [${fieldList}], ${allRequired})`;
  };
  if (f.name) {
    let raw;
    if (f.name && f.name.startsWith('$')) raw = `get(${erlStateKey(ctx, f.name.slice(1))})`;
    else if (ctx.stateVarNames.has(f.name)) raw = `get(${erlStateKey(ctx, f.name)})`;
    else if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) raw = erlVarName(resolveSSAName(f.name, sCtx.stmtIdx, sCtx.ssaEnv));
    else raw = erlVarName(f.name);
    return wireWrap(raw);
  }
  if (f.expr) {
    const raw = genExpr(ctx, f.expr, typeEnv, sCtx);
    // Wrap self_send calls in bv_object_one to unwrap Object to scalar
    if (raw.includes('self_send(')) return `bv_object_one(${raw})`;
    return wireWrap(raw);
  }
  return 'null';
}

function genReplyNamedMap(ctx, named, typeEnv, sCtx) {
  const wireWrap = (raw, slotType) => {
    if (typeof slotType !== 'string' || !ctx.typeDecls?.has(slotType)) return raw;
    const decl = ctx.typeDecls.get(slotType);
    const fieldList = (decl.fields || []).map(fl => erlString(fl.name)).join(', ');
    const allRequired = (decl.fields || []).every(fl => !fl.optional);
    return `bv_to_wire(${raw}, [${fieldList}], ${allRequired})`;
  };
  const entries = named.map(f => {
    if ('sigil' in f) {
      let val;
      if (f.sigil.startsWith('$')) val = `get(${erlStateKey(ctx, f.sigil.slice(1))})`;
      else if (ctx.stateVarNames.has(f.sigil)) val = `get(${erlStateKey(ctx, f.sigil)})`;
      else if (sCtx?.refVars?.has(f.sigil)) val = `get(ref_${f.sigil})`;
      else if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined && sCtx.ssaEnv.assignments.some(a => a.name === f.sigil)) val = erlVarName(resolveSSAName(f.sigil, sCtx.stmtIdx, sCtx.ssaEnv));
      else if (typeEnv?.has(f.sigil)) val = erlVarName(f.sigil);
      else val = erlString(f.sigil);
      const slotType = f.type || typeEnv?.get(f.sigil);
      return `${erlString(f.sigil)} => ${wireWrap(val, slotType)}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genExpr(ctx, f.value, typeEnv, sCtx) : erlVarName(f.key);
      const slotType = f.type
        || (f.value?.type === 'Identifier' || f.value?.type === 'RefRead' ? typeEnv?.get(f.value.name) : null)
        || inferExprType(f.value, typeEnv);
      return `${erlString(f.key)} => ${wireWrap(val, slotType)}`;
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
  // Slice 13: shape-typed slots emit `::Name` so the receiver knows to
  // route the parallel payload through `bv_from_wire`.
  const tagFor = t => (typeof t === 'string' && ctx.typeDecls?.has(t)) ? `::${t}` : t;

  // Resolve a source-level local name to its current SSA-suffixed name.
  const ssaResolve = (name) => {
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv);
    }
    return name;
  };

  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferExprType(f.expr || f.value, typeEnv);
    if (!t) return null;
    posTypes.push(erlString(tagFor(t)));
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
      t = f.type || (valName ? typeEnv.get(valName) : null) || inferExprType(f.value, typeEnv);
      varExpr = valName ? erlVarName(ssaResolve(valName)) : null;
    }
    if (!key || !t) return null;
    if (isListOfAnythingType(t) && varExpr) {
      namedTypes.push(`${erlString(key)} => list_component_types(${varExpr})`);
    } else {
      namedTypes.push(`${erlString(key)} => ${erlString(tagFor(t))}`);
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
