// ── Expression codegen for Erlang ────────────────────────────────────────────

import { erlVarName, erlString, erlStateKey } from './preambles.js';
import {
  resolveSSAName,
  exprType,
  inferLiteralType,
  erlCollectFreeVars,
  erlLambdaUsesOuterRefs,
  erlGenLambdaArgLabel,
} from './types.js';

function erlSendVars(ctx) {
  const n = ctx.sendCounter++;
  return { seq: `Send_seq_${n}`, n: `Send_n_${n}`, id: `Send_id_${n}`, op: `Send_op_${n}`, bva: `Send_bva_${n}`, msg: `Send_msg_${n}` };
}

// Helper: resolve set target — state vars use state_ prefix, local refs use ref_ prefix
function erlSetTarget(ctx, name) {
  return ctx.stateVarNames.has(name) ? erlStateKey(ctx, name) : `ref_${name}`;
}

function genExpr(ctx, expr, typeEnv, sCtx) {
  if (!expr) return 'null';

  if (expr.type === 'StringLiteral') return erlString(expr.value);
  if (expr.type === 'IntLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral') {
    const s = String(expr.value);
    return s.includes('.') ? s : s + '.0';
  }
  if (expr.type === 'BoolLiteral') return expr.value ? 'true' : 'false';
  if (expr.type === 'NullLiteral') return 'null';

  if (expr.type === 'Identifier') {
    const name = expr.name;
    if (ctx.stateVarNames.has(name)) return `get(${erlStateKey(ctx, name)})`;
    // Resolve SSA if context has ssaEnv
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return erlVarName(resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv));
    }
    return erlVarName(name);
  }

  if (expr.type === 'BinaryExpr') {
    let left = genExprScalar(ctx, expr.left, typeEnv, sCtx);
    let right = genExprScalar(ctx, expr.right, typeEnv, sCtx);
    // Check if this is string concatenation
    const leftType = exprType(expr.left, typeEnv, ctx);
    const rightType = exprType(expr.right, typeEnv, ctx);
    if (expr.op === '+' && (leftType === 'Text' || rightType === 'Text')) {
      return `<<${left}/binary, ${right}/binary>>`;
    }
    if (expr.op === '/') return `(${left} div ${right})`;
    if (expr.op === '===') return `(${left} =:= ${right})`;
    if (expr.op === '!==') return `(${left} =/= ${right})`;
    if (expr.op === '<=') return `(${left} =< ${right})`;
    return `(${left} ${expr.op} ${right})`;
  }

  if (expr.type === 'IndexExpr') {
    const obj = genExpr(ctx, expr.object, typeEnv, sCtx);
    if (expr.key !== null) {
      return `maps:get(${erlString(expr.key)}, ${obj}_named, null)`;
    }
    return `lists:nth(${expr.index + 1}, ${obj}_pos)`;
  }

  if (expr.type === 'StructureConstructor') {
    return genStructureConstructor(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && expr.callee.name === '__tick__') {
    return 'timer:sleep(0)';
  }

  // Emit invocation
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.emitNames.has(expr.callee.name)) {
    const emitDecl = ctx.emitNames.get(expr.callee.name);
    const eventName = erlString(expr.callee.name);
    const emitFn = emitDecl.silent ? 'emit_' : 'emit_await_';
    if (expr.args.length > 0) {
      const fields = emitDecl.params.map((p, i) => {
        const val = i < expr.args.length ? genExpr(ctx, expr.args[i], typeEnv, sCtx) : 'null';
        return `${erlString(p.name)} => ${val}`;
      }).join(', ');
      return `${emitFn}(${eventName}, #{${fields}})`;
    }
    return `${emitFn}(${eventName}, #{})`;
  }

  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.actorFnNames.has(expr.callee.name)) {
    return genActorFnCallExpr(ctx, expr, typeEnv, sCtx);
  }

  // Lambda var call → self_send through dispatch
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.lambdaVarNames.has(expr.callee.name)) {
    return genErlLambdaVarCall(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FunctionCallExpr') {
    // Check if callee is function-typed — route through self_send
    if (expr.callee?.type === 'Identifier') {
      const calleeType = ctx.currentTypeEnv?.get(expr.callee.name);
      const isFnTyped = calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->')));
      if (isFnTyped) {
        return genErlLambdaVarCall(ctx, expr, typeEnv, sCtx);
      }
    }
    return genFunctionCallExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'Function') {
    if (erlLambdaUsesOuterRefs(ctx, expr)) {
      return genFunctionLiteral(ctx, expr, typeEnv, sCtx);
    }
    return erlGenLambdaArgLabel(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return '[]';
    const elems = expr.elements.map(e => genExpr(ctx, e, typeEnv, sCtx));
    return `[${elems.join(', ')}]`;
  }

  if (expr.type === 'OverExpr') {
    return genOverExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'ReduceExpr') {
    return genReduceExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'IfExpr') {
    return genIfExpr(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'FnRef') {
    if (ctx.actorFnNames.has(expr.name)) {
      return `fun(Item_) -> structure_one(self_send(${erlString(expr.name)}, [Item_])) end`;
    }
    if (ctx.lambdaVarNames.has(expr.name)) {
      const varRef = genExpr(ctx, { type: 'Identifier', name: expr.name }, typeEnv, sCtx);
      return `fun(Item_) -> structure_one(self_send(${varRef}, [Item_])) end`;
    }
    return erlVarName(expr.name);
  }

  if (expr.type === 'RefRead') {
    if (ctx.stateVarNames.has(expr.name)) return `get(${erlStateKey(ctx, expr.name)})`;
    return `get(ref_${expr.name})`;
  }

  if (expr.type === 'StateVar') {
    return `get(${erlStateKey(ctx, expr.name)})`;
  }

  if (expr.type === 'StructureLiteral') {
    return genStructureConstructor(ctx, expr, typeEnv, sCtx);
  }

  if (expr.type === 'DecimalLiteral') {
    return String(expr.value);
  }

  if (expr.type === 'RefArg') {
    return `ref_${expr.name}`;
  }

  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemote = dotObjName && ctx.remoteInstanceVars.has(dotObjName);
    const isChild = !isRemote && ((expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorInfo.has(expr.object.callee.name)) ||
      (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
      (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name)));
    if (isChild) return genChildDotCallAwait(ctx, expr, typeEnv, sCtx);
    // Wrapped child param: state var holding a child actor name atom
    const isWrappedChild = !isRemote && dotObjName && ctx.stateVarNames.has(dotObjName) && ctx.stateVarTypeEnv.get(dotObjName) === 'Anything';
    if (isWrappedChild) {
      const childRef = `get(${erlStateKey(ctx, dotObjName)})`;
      const method = erlString('@' + expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = '#{}';
      } else if (named.length > 0) {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return `${erlString(a.name)} => ${val}`;
        }).join(', ');
        payload = `#{${fields}}`;
      } else {
        const vals = positional.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return val;
        }).join(', ');
        payload = `[${vals}]`;
      }
      return `begin
        {ok, _Wr_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Wr_re)
    end`;
    }
    // Constructs proxy var: dispatch through child_dispatch (fire-and-forget)
    const isConstructsProxy = dotObjName && ctx.constructsProxyVars.has(dotObjName);
    if (isConstructsProxy) {
      const childRef = erlString(ctx.constructsVarToProxy.get(dotObjName));
      const method = erlString('@' + expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = '#{}';
      } else if (named.length > 0) {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
          return `${erlString(a.name)} => ${val}`;
        }).join(', ');
        payload = `#{${fields}}`;
      } else {
        const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
        payload = `[${vals}]`;
      }
      return `begin
        {ok, _Cp_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Cp_re)
    end`;
    }
    if (isRemote) {
      const to = `get(${erlStateKey(ctx, dotObjName)})`;
      const method = erlString(expr.method);
      const named = expr.args.filter(a => !a.positional);
      const positional = expr.args.filter(a => a.positional);
      let opExpr;
      if (positional.length === 0 && named.length === 0) {
        opExpr = method;
      } else if (named.length > 0) {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
        opExpr = `[#{${fields}}, ${method}]`;
      } else {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        const vals = positional.map(genArgVal).join(', ');
        opExpr = `[[${vals}], ${method}]`;
      }
      const v = erlSendVars(ctx);
      return `begin
        ${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,
        put(send_seq_, ${v.seq} + 1),
        ${v.msg} = #{<<"id">> => integer_to_binary(${v.seq}), <<"op">> => ${opExpr}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v.msg})]),
        null
    end`;
    }
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    const to = erlString(expr.object.name);
    const method = erlString('@' + expr.method);
    const v2 = erlSendVars(ctx);
    if (positional.length === 0 && named.length === 0) {
      return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.msg} = #{<<"id">> => integer_to_binary(${v2.seq}), <<"op">> => ${method}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        null
    end`;
    }
    const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
    let opExpr, bvaExpr;
    if (positional.length > 0 && named.length > 0) {
      const posVals = positional.map(genArgVal).join(', ');
      const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[${posVals}, #{${namedFields}}, ${method}]`;
      const posBva = positional.map(a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null').join(', ');
      const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null'}`).join(', ');
      bvaExpr = `[${posBva}, #{${namedBva}}]`;
    } else if (named.length > 0) {
      const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[#{${namedFields}}, ${method}]`;
      const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null'}`).join(', ');
      bvaExpr = `[#{${namedBva}}]`;
    } else {
      const posVals = positional.map(genArgVal).join(', ');
      opExpr = `[[${posVals}], ${method}]`;
      const posBva = positional.map(a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null').join(', ');
      bvaExpr = `[[${posBva}]]`;
    }
    return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.op} = ${opExpr},
        ${v2.bva} = ${bvaExpr},
        ${v2.msg} = #{<<"id">> => integer_to_binary(${v2.seq}), <<"op">> => ${v2.op}, <<"to">> => ${to}, <<"bv-a">> => ${v2.bva}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        null
    end`;
  }

  throw new Error(`Unsupported Erlang expression: ${expr.type}`);
}

function genDotCallAwait(ctx, expr, typeEnv, sCtx) {
  const objName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
  const isRemote = objName && ctx.remoteInstanceVars.has(objName);
  const isChild = !isRemote && ((expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorInfo.has(expr.object.callee.name)) ||
    (expr.object.type === 'RefRead' && sCtx?.childActorRefs?.has(expr.object.name)) ||
    (expr.object.type === 'Identifier' && sCtx?.childActorRefs?.has(expr.object.name)));
  if (isChild) return genChildDotCallAwait(ctx, expr, typeEnv, sCtx);
  // Wrapped child param: dispatch through child_dispatch
  const isWrappedChild = !isRemote && objName && ctx.stateVarNames.has(objName) && ctx.stateVarTypeEnv.get(objName) === 'Anything';
  if (isWrappedChild) {
    const childRef = `get(${erlStateKey(ctx, objName)})`;
    const method = erlString('@' + expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let payload;
    if (positional.length === 0 && named.length === 0) {
      payload = '#{}';
    } else if (named.length > 0) {
      const fields = named.map(a => {
        const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        return `${erlString(a.name)} => ${val}`;
      }).join(', ');
      payload = `#{${fields}}`;
    } else {
      const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
      payload = `[${vals}]`;
    }
    return `begin
        {ok, _Wr_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Wr_re)
    end`;
  }
  // Constructs proxy var: dispatch through child_dispatch
  const isConstructsProxy = objName && ctx.constructsProxyVars.has(objName);
  if (isConstructsProxy) {
    const childRef = erlString(ctx.constructsVarToProxy.get(objName));
    const method = erlString('@' + expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let payload;
    if (positional.length === 0 && named.length === 0) {
      payload = '#{}';
    } else if (named.length > 0) {
      const fields = named.map(a => {
        const val = a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
        return `${erlString(a.name)} => ${val}`;
      }).join(', ');
      payload = `#{${fields}}`;
    } else {
      const vals = positional.map(a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name)).join(', ');
      payload = `[${vals}]`;
    }
    return `begin
        {ok, _Cp_re, _} = child_dispatch(${childRef}, ${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(_Cp_re)
    end`;
  }
  if (isRemote) {
    const to = `get(${erlStateKey(ctx, objName)})`;
    const method = erlString(expr.method);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    let opExpr;
    if (positional.length === 0 && named.length === 0) {
      opExpr = method;
    } else if (named.length > 0) {
      const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
      const fields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
      opExpr = `[#{${fields}}, ${method}]`;
    } else {
      const genArgVal = a => a.expr ? genExpr(ctx, a.expr, typeEnv, sCtx) : erlVarName(a.name);
      const vals = positional.map(genArgVal).join(', ');
      opExpr = `[[${vals}], ${method}]`;
    }
    const v = erlSendVars(ctx);
    return `begin
        ${v.seq} = case get(send_seq_) of undefined -> 1; ${v.n} -> ${v.n} end,
        put(send_seq_, ${v.seq} + 1),
        ${v.id} = integer_to_binary(${v.seq}),
        ${v.msg} = #{<<"id">> => ${v.id}, <<"op">> => ${opExpr}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v.msg})]),
        structure_pack(await_response_(${v.id}))
    end`;
  }
  const named = expr.args.filter(a => !a.positional);
  const positional = expr.args.filter(a => a.positional);
  const to = erlString(expr.object.name);
  const method = erlString('@' + expr.method);
  const v2 = erlSendVars(ctx);
  if (positional.length === 0 && named.length === 0) {
    // No args — op is just the method string, no bv-a
    return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.id} = integer_to_binary(${v2.seq}),
        ${v2.msg} = #{<<"id">> => ${v2.id}, <<"op">> => ${method}, <<"to">> => ${to}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        structure_pack(await_response_(${v2.id}))
    end`;
  }
  const genArgVal = a => a.expr ? genExpr(ctx, a.expr, null, null) : erlVarName(a.name);
  let opExpr, bvaExpr;
  if (positional.length > 0 && named.length > 0) {
    const posVals = positional.map(genArgVal).join(', ');
    const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    opExpr = `[${posVals}, #{${namedFields}}, ${method}]`;
    const posBva = positional.map(a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null').join(', ');
    const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null'}`).join(', ');
    bvaExpr = `[${posBva}, #{${namedBva}}]`;
  } else if (named.length > 0) {
    const namedFields = named.map(a => `${erlString(a.name)} => ${genArgVal(a)}`).join(', ');
    opExpr = `[#{${namedFields}}, ${method}]`;
    const namedBva = named.map(a => `${erlString(a.name)} => ${a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null'}`).join(', ');
    bvaExpr = `[#{${namedBva}}]`;
  } else {
    const posVals = positional.map(genArgVal).join(', ');
    opExpr = `[[${posVals}], ${method}]`;
    const posBva = positional.map(a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) ? erlString(a.typeName || inferLiteralType(a.expr)) : 'null').join(', ');
    bvaExpr = `[[${posBva}]]`;
  }
  return `begin
        ${v2.seq} = case get(send_seq_) of undefined -> 1; ${v2.n} -> ${v2.n} end,
        put(send_seq_, ${v2.seq} + 1),
        ${v2.id} = integer_to_binary(${v2.seq}),
        ${v2.op} = ${opExpr},
        ${v2.bva} = ${bvaExpr},
        ${v2.msg} = #{<<"id">> => ${v2.id}, <<"op">> => ${v2.op}, <<"to">> => ${to}, <<"bv-a">> => ${v2.bva}},
        io:format("~s~n", [json_encode(${v2.msg})]),
        structure_pack(await_response_(${v2.id}))
    end`;
}

function genChildDotCallAwait(ctx, expr, typeEnv, sCtx) {
  let actorName;
  let initCall = '';
  if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
    // ref or non-ref variable: actor name comes from the childActorRefs mapping, init already done
    actorName = sCtx.childActorRefs.get(expr.object.name);
  } else {
    // ephemeral FunctionCallExpr: actor name is the callee name
    actorName = expr.object.callee.name;
    if (expr.object.args.length > 0) {
      const prefix = `child_${actorName.toLowerCase()}`;
      const initArgs = expr.object.args.map(a => genExpr(ctx, a, typeEnv, sCtx)).join(', ');
      initCall = `${prefix}_init([${initArgs}]),\n        `;
    }
  }
  const prefix = `child_${actorName.toLowerCase()}`;
  const method = erlString('@' + expr.method);
  const n = ctx.ephCounter++;
  const reVar = `Eph_re_${n}_`;

  // Build payload from method args
  const positional = expr.args.filter(a => a.positional);
  const named = expr.args.filter(a => !a.positional);
  let payload;
  if (positional.length > 0 && named.length > 0) {
    const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
    const namedMap = named.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, sCtx)}`).join(', ');
    payload = `[${posVals}, #{${namedMap}}]`;
  } else if (positional.length > 0) {
    const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
    payload = `[${posVals}]`;
  } else if (named.length > 0) {
    const namedMap = named.map(a => `${erlString(a.name)} => ${genExpr(ctx, a.expr, typeEnv, sCtx)}`).join(', ');
    payload = `#{${namedMap}}`;
  } else {
    payload = '#{}';
  }

  return `begin
        ${initCall}{ok, ${reVar}, _} = ${prefix}_handle_op(${method}, #{}, ${payload}, <<"0">>, <<"__parent">>),
        structure_pack(${reVar})
    end`;
}

function genStructureConstructor(ctx, expr, typeEnv, sCtx) {
  const positional = expr.args.filter(a => a.positional);
  const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Function');
  const fnArgs = expr.args.filter(a => a.type === 'Function');

  const posVals = positional.map(a => genExpr(ctx, a.expr, typeEnv, sCtx)).join(', ');
  const namedPairs = [...named, ...fnArgs].map(a => {
    const val = genExpr(ctx, a.expr, typeEnv, sCtx);
    return `${erlString(a.key)} => ${val}`;
  }).join(', ');

  return `{[${posVals}], #{${namedPairs}}}`;
}

// Generate an expression that evaluates to a scalar (not Structure)
// Wraps self_send calls with structure_one
function genExprScalar(ctx, expr, typeEnv, sCtx) {
  const raw = genExpr(ctx, expr, typeEnv, sCtx);
  if (raw.startsWith('self_send(')) return `structure_one(${raw})`;
  if (raw.startsWith('case is_binary(')) return `structure_one(${raw})`;
  return raw;
}

// Lambda var call → self_send with the label stored in the variable
function genErlLambdaVarCall(ctx, expr, typeEnv, sCtx) {
  const callee = genExpr(ctx, expr.callee, typeEnv, sCtx);
  if (expr.args.length === 0) {
    return `self_send(${callee}, #{})`;
  }
  const posArgs = expr.args.filter(a => a.type !== 'NamedArgsBag').map(a => {
    if (a.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, a)) return erlGenLambdaArgLabel(ctx, a, typeEnv, sCtx);
    return genExprScalar(ctx, a, typeEnv, sCtx);
  });
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  if (namedBag) {
    const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
      `${erlString(k)} => ${genExprScalar(ctx, v, typeEnv, sCtx)}`
    );
    if (posArgs.length > 0) {
      return `self_send(${callee}, [${posArgs.join(', ')}, #{${namedEntries.join(', ')}}])`;
    }
    return `self_send(${callee}, #{${namedEntries.join(', ')}})`;
  }
  return `self_send(${callee}, [${posArgs.join(', ')}])`;
}

// Runtime dispatch: if callee is a binary (lambda label), use self_send; otherwise direct call
function genErlRuntimeFunctionCall(ctx, expr, typeEnv, sCtx) {
  // Only use runtime check if the callee could plausibly be a lambda label
  // If we know it's always a closure (not in lambda var names), use direct call
  return genFunctionCallExpr(ctx, expr, typeEnv, sCtx);
}

function genActorFnCallExpr(ctx, expr, typeEnv, sCtx) {
  const name = expr.callee.name;
  // Self-send: call through dispatch, return Structure
  if (expr.args.length === 0) {
    return `self_send(${erlString(name)}, #{})`;
  }
  const posArgs = expr.args.filter(a => a.type !== 'NamedArgsBag').map(a => {
    if (a.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, a)) return erlGenLambdaArgLabel(ctx, a, typeEnv, sCtx);
    return genExpr(ctx, a, typeEnv, sCtx);
  });
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  if (namedBag) {
    const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
      `${erlString(k)} => ${genExpr(ctx, v, typeEnv, sCtx)}`
    );
    if (posArgs.length > 0) {
      return `self_send(${erlString(name)}, [${posArgs.join(', ')}, #{${namedEntries.join(', ')}}])`;
    }
    // Named-only: pass as map, not wrapped in list
    return `self_send(${erlString(name)}, #{${namedEntries.join(', ')}})`;
  }
  return `self_send(${erlString(name)}, [${posArgs.join(', ')}])`;
}


function genFunctionLiteral(ctx, expr, typeEnv, sCtx, selfName, outerRenames) {
  const params = expr.params || [];
  const scopeId = ctx.fnScopeCounter++;
  const prefix = `Fn${scopeId}_`;

  // Track ref params — reads/writes go through process dictionary key
  const refParams = new Set();

  // Build a renaming map: inner var names → prefixed names (to avoid Erlang shadowing)
  const innerRenames = new Map();
  const paramNames = params.map(p => {
    if (p.ref) {
      refParams.add(p.name);
      const renamed = prefix + 'Ref_' + erlVarName(p.name);
      innerRenames.set(p.name, renamed);
      return renamed;
    }
    const renamed = prefix + erlVarName(p.name);
    innerRenames.set(p.name, renamed);
    return renamed;
  }).join(', ');

  // For self-referencing functions, map self name to the named fun identifier
  if (selfName) {
    const selfRenamed = prefix + erlVarName(selfName);
    innerRenames.set(selfName, selfRenamed);
  }

  function innerVarName(name) {
    if (innerRenames.has(name)) return innerRenames.get(name);
    // Check outer scope renames for captured/closed-over variables
    if (outerRenames && outerRenames.has(name)) return outerRenames.get(name);
    return erlVarName(name);
  }

  // Check if body references self (for named fun generation)
  const selfReferenced = selfName && JSON.stringify(expr.body || expr.expr).includes(`"name":"${selfName}"`);

  function genInnerExpr(e) {
    if (!e) return 'null';
    // Self-reference: use named fun identifier
    if (selfReferenced && e.type === 'Identifier' && e.name === selfName) {
      return innerRenames.get(selfName) + '_f';
    }
    if (e.type === 'Identifier') return innerVarName(e.name);
    if (e.type === 'RefRead') {
      // If this ref is a ref param, read via passed key; otherwise use outer ref
      if (refParams.has(e.name)) return `get(${innerVarName(e.name)})`;
      return `get(${erlSetTarget(ctx, e.name)})`;
    }
    if (e.type === 'StringLiteral') return erlString(e.value);
    if (e.type === 'IntLiteral') return String(e.value);
    if (e.type === 'FloatLiteral') return e.value.toString().includes('.') ? String(e.value) : e.value + '.0';
    if (e.type === 'BoolLiteral') return e.value ? 'true' : 'false';
    if (e.type === 'BinaryExpr') {
      const left = genInnerExpr(e.left);
      const right = genInnerExpr(e.right);
      if (e.op === '/') return `(${left} div ${right})`;
      if (e.op === '===') return `(${left} =:= ${right})`;
      if (e.op === '!==') return `(${left} =/= ${right})`;
      if (e.op === '<=') return `(${left} =< ${right})`;
      return `(${left} ${e.op} ${right})`;
    }
    if (e.type === 'FunctionCallExpr') {
      const callee = genInnerExpr(e.callee);
      const posArgs = (e.args || []).filter(a => a.type !== 'NamedArgsBag').map(a => genInnerExpr(a));
      const namedBag = (e.args || []).find(a => a.type === 'NamedArgsBag');
      if (namedBag) {
        const namedArgs = Object.values(namedBag.fields).map(v => genInnerExpr(v));
        return `${callee}(${[...posArgs, ...namedArgs].join(', ')})`;
      }
      return `${callee}(${posArgs.join(', ')})`;
    }
    if (e.type === 'NullLiteral') return 'null';
    if (e.type === 'DecimalLiteral') return String(e.value);
    if (e.type === 'IfExpr') {
      const cond = genInnerExpr(e.cond);
      const thenCode = genInnerIfBranch(e.then);
      let elseCode;
      if (!e.else) elseCode = 'null';
      else if (e.else.type === 'IfExpr') elseCode = genInnerExpr(e.else);
      else elseCode = genInnerIfBranch(e.else);
      return `case is_truthy(${cond}) of true -> ${thenCode}; false -> ${elseCode} end`;
    }
    if (e.type === 'Function') return genFunctionLiteral(ctx, e, typeEnv, ctx, undefined, innerRenames);
    if (e.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && ctx.actorFnNames.has(e.callee.name)) {
      const args = e.args.filter(a => a.type !== 'NamedArgsBag').map(a => genInnerExpr(a));
      const namedBag = e.args.find(a => a.type === 'NamedArgsBag');
      const namedMap = namedBag
        ? `#{${Object.entries(namedBag.fields).map(([k, v]) => `${erlString(k)} => ${genInnerExpr(v)}`).join(', ')}}`
        : '#{}';
      return `self_send(${erlString(e.callee.name)}, [${args.join(', ')}])`;
    }
    // Fallback to outer genExpr for complex expressions
    return genExpr(ctx, e, typeEnv, sCtx);
  }

  function genInnerIfBranch(branch) {
    if (!branch) return 'null';
    if (branch.expr) {
      if (branch.expr.type === 'FunctionCallExpr') return `structure_one(${genInnerExpr(branch.expr)})`;
      return genInnerExpr(branch.expr);
    }
    if (branch.body) {
      const parts = [];
      for (const s of branch.body) {
        if (s.type === 'TypedAssign' || s.type === 'Assign') {
          const renamed = prefix + erlVarName(s.name);
          innerRenames.set(s.name, renamed);
          parts.push(`${renamed} = ${genInnerExpr(s.value)}`);
        } else if (s.type === 'ImplicitReturn') {
          parts.push(genInnerExpr(s.expr));
        }
      }
      return parts.join(', ');
    }
    return 'null';
  }

  let bodyExpr;
  if (expr.body && expr.body.length > 0) {
    const implRet = expr.body.find(s => s.type === 'ImplicitReturn');
    const bodyStmts = expr.body.filter(s => s.type !== 'ImplicitReturn');

    if (bodyStmts.length > 0 || implRet) {
      const lines = [];
      let hasReturn = false;
      for (let si = 0; si < bodyStmts.length; si++) {
        const s = bodyStmts[si];
        // Early return: stop processing after a Return node
        if (s.type === 'Return') {
          lines.push(genFnReturnExpr(s.fields, genInnerExpr, innerVarName));
          hasReturn = true;
          break;
        }
        if (s.type === 'TypedAssign' || s.type === 'Assign') {
          const renamed = prefix + erlVarName(s.name);
          innerRenames.set(s.name, renamed);
          if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
            const args = s.value.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${renamed} = structure_one(self_send(${erlString(s.value.callee.name)}, [${args}]))`);
          } else {
            lines.push(`${renamed} = ${genInnerExpr(s.value)}`);
          }
        }
        if (s.type === 'DestructureAssign') {
          const tmpName = `${prefix}Dtmp_${si}`;
          const isActorFnCall = s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name);
          if (isActorFnCall) {
            const args = s.source.args.map(a => genInnerExpr(a)).join(', ');
            lines.push(`${tmpName} = self_send(${erlString(s.source.callee.name)}, [${args}])`);
          } else {
            lines.push(`${tmpName} = ${genInnerExpr(s.source)}`);
          }
          const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
          const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);
          if (hasPosItems || hasNamedItems) {
            lines.push(`{${tmpName}_pos, ${tmpName}_named} = ${tmpName}`);
          }
          for (const item of s.pattern) {
            if (item.discard) continue;
            const renamed = prefix + erlVarName(item.name);
            innerRenames.set(item.name, renamed);
            if (item.named || item.key !== undefined) {
              const key = item.key || item.name;
              lines.push(`${renamed} = maps:get(${erlString(key)}, ${tmpName}_named, null)`);
            } else if (item.positional) {
              lines.push(`${renamed} = lists:nth(${(item.idx || 0) + 1}, ${tmpName}_pos)`);
            }
          }
        }
        if (s.type === 'SetStatement') {
          if (sCtx?.childActorRefs?.has(s.name)) {
            const actorName = sCtx.childActorRefs.get(s.name);
            const wireOp = s.updateOp === '<|' ? '::update' : '::set';
            lines.push(`child_${actorName.toLowerCase()}_handle_op(<<"${wireOp}">>, #{}, [${genInnerExpr(s.value)}], _Id, _From)`);
          } else if (refParams.has(s.name)) {
            lines.push(`put(${innerVarName(s.name)}, ${genInnerExpr(s.value)})`);
          } else {
            lines.push(`put(${erlSetTarget(ctx, s.name)}, ${genInnerExpr(s.value)})`);
          }
        }
        if (s.type === 'StateAssign') {
          lines.push(`put(${erlStateKey(ctx, s.name)}, ${genInnerExpr(s.value)})`);
        }
        if (s.type === 'WhileStatement') {
          lines.push(genFnWhileStatement(ctx, s, genInnerExpr, prefix));
        }
        if (s.type === 'ExprStatement') {
          lines.push(genInnerExpr(s.expr));
        }
        if (s.type === 'IfStatement') {
          const ifLines = [];
          for (const bs of s.body) {
            if (bs.type === 'SetStatement') {
              if (refParams.has(bs.name)) {
                ifLines.push(`put(${innerVarName(bs.name)}, ${genInnerExpr(bs.value)})`);
              } else {
                ifLines.push(`put(${erlSetTarget(ctx, bs.name)}, ${genInnerExpr(bs.value)})`);
              }
            } else if (bs.type === 'StateAssign') {
              ifLines.push(`put(${erlStateKey(ctx, bs.name)}, ${genInnerExpr(bs.value)})`);
            }
          }
          lines.push(`case is_truthy(${genInnerExpr(s.cond)}) of true -> ${ifLines.join(', ')}; false -> null end`);
        }
      }
      if (expr.returnType === '.') {
        // No-return function: just execute side effects, return ok
        lines.push('ok');
      } else if (!hasReturn && implRet) {
        lines.push(genInnerExpr(implRet.expr));
      } else if (bodyStmts.length > 0) {
        const last = bodyStmts[bodyStmts.length - 1];
        if (last.type === 'SetStatement') {
          // Set returns the new value — read back
          if (refParams.has(last.name)) {
            lines.push(`get(${innerVarName(last.name)})`);
          } else {
            lines.push(`get(${erlSetTarget(ctx, last.name)})`);
          }
        } else if (last.name) {
          lines.push(innerVarName(last.name));
        }
      }
      bodyExpr = lines.join(', ');
    } else {
      bodyExpr = 'null';
    }
  } else if (expr.expr) {
    if (expr.returnType === '.') {
      bodyExpr = `${genInnerExpr(expr.expr)}, ok`;
    } else {
      bodyExpr = genInnerExpr(expr.expr);
    }
  } else {
    bodyExpr = 'null';
  }

  // Self-referencing function: use a named fun
  if (selfReferenced) {
    const innerSelfName = innerRenames.get(selfName);
    return `fun ${innerSelfName}_f(${paramNames}) -> ${bodyExpr} end`;
  }
  return `fun(${paramNames}) -> ${bodyExpr} end`;
}

function genFunctionCallExpr(ctx, expr, typeEnv, sCtx) {
  const callee = genExpr(ctx, expr.callee, typeEnv, sCtx);
  const posArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag').map(a => genExpr(ctx, a, typeEnv, sCtx));
  const namedBag = (expr.args || []).find(a => a.type === 'NamedArgsBag');
  // Runtime dispatch: when callee is an Identifier that could hold a lambda label binary
  // Only apply when lambda handlers exist (meaning lambdas are being lifted)
  if (ctx.lambdaHandlers.length > 0 && expr.callee?.type === 'Identifier' && !ctx.actorFnNames.has(expr.callee.name) && !ctx.lambdaVarNames.has(expr.callee.name) && !ctx.stateVarNames.has(expr.callee.name)) {
    let selfSendPayload;
    if (posArgs.length === 0 && !namedBag) {
      selfSendPayload = '#{}';
    } else if (namedBag) {
      const namedEntries = Object.entries(namedBag.fields).map(([k, v]) =>
        `${erlString(k)} => ${genExpr(ctx, v, typeEnv, sCtx)}`
      );
      if (posArgs.length > 0) {
        selfSendPayload = `[${posArgs.join(', ')}, #{${namedEntries.join(', ')}}]`;
      } else {
        selfSendPayload = `#{${namedEntries.join(', ')}}`;
      }
    } else {
      selfSendPayload = `[${posArgs.join(', ')}]`;
    }
    const directCall = namedBag
      ? `${callee}(${[...posArgs, ...Object.values(namedBag.fields).map(v => genExpr(ctx, v, typeEnv, sCtx))].join(', ')})`
      : `${callee}(${posArgs.join(', ')})`;
    return `case is_binary(${callee}) of true -> structure_one(self_send(${callee}, ${selfSendPayload})); false -> ${directCall} end`;
  }
  if (namedBag) {
    const namedArgs = Object.values(namedBag.fields).map(v => genExpr(ctx, v, typeEnv, sCtx));
    const allArgs = [...posArgs, ...namedArgs];
    return `${callee}(${allArgs.join(', ')})`;
  }
  return `${callee}(${posArgs.join(', ')})`;
}

function genOverExpr(ctx, expr, typeEnv, sCtx) {
  const list = genExpr(ctx, expr.collection, typeEnv, sCtx);
  let fn;
  if (expr.fn.type === 'FnRef' && ctx.actorFnNames.has(expr.fn.name)) {
    fn = `fun(Item_) -> structure_one(self_send(${erlString(expr.fn.name)}, [Item_])) end`;
  } else if (expr.fn.type === 'FnRef' && ctx.lambdaVarNames.has(expr.fn.name)) {
    const varRef = genExpr(ctx, { type: 'Identifier', name: expr.fn.name }, typeEnv, sCtx);
    fn = `fun(Item_) -> structure_one(self_send(${varRef}, [Item_])) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else if (expr.fn.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, expr.fn)) {
    const label = erlGenLambdaArgLabel(ctx, expr.fn, typeEnv, sCtx);
    fn = `fun(Item_) -> structure_one(self_send(${label}, [Item_])) end`;
  } else {
    fn = genExpr(ctx, expr.fn, typeEnv, sCtx);
  }
  return `brevity_map(${list}, ${fn})`;
}

function genReduceExpr(ctx, expr, typeEnv, sCtx) {
  const list = genExpr(ctx, expr.collection, typeEnv, sCtx);
  let fn;
  if (expr.fn.type === 'FnRef' && ctx.actorFnNames.has(expr.fn.name)) {
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${erlString(expr.fn.name)}, [Acc_, Item_])) end`;
  } else if (expr.fn.type === 'FnRef' && ctx.lambdaVarNames.has(expr.fn.name)) {
    const varRef = genExpr(ctx, { type: 'Identifier', name: expr.fn.name }, typeEnv, sCtx);
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${varRef}, [Acc_, Item_])) end`;
  } else if (expr.fn.type === 'FnRef') {
    fn = erlVarName(expr.fn.name);
  } else if (expr.fn.type === 'Function' && !erlLambdaUsesOuterRefs(ctx, expr.fn)) {
    const label = erlGenLambdaArgLabel(ctx, expr.fn, typeEnv, sCtx);
    fn = `fun(Item_, Acc_) -> structure_one(self_send(${label}, [Acc_, Item_])) end`;
  } else {
    fn = genExpr(ctx, expr.fn, typeEnv, sCtx);
  }
  if (expr.initial) {
    const init = genExpr(ctx, expr.initial, typeEnv, sCtx);
    return `brevity_foldl(${list}, ${init}, ${fn})`;
  }
  return `brevity_foldl1(${fn}, ${list})`;
}


function genIfExpr(ctx, expr, typeEnv, sCtx) {
  const cond = genExpr(ctx, expr.cond, typeEnv, sCtx);
  const thenCode = genIfBranch(ctx, expr.then, typeEnv, sCtx);
  let elseCode;
  if (!expr.else) {
    elseCode = 'null';
  } else if (expr.else.type === 'IfExpr') {
    elseCode = genIfExpr(ctx, expr.else, typeEnv, sCtx);
  } else {
    elseCode = genIfBranch(ctx, expr.else, typeEnv, sCtx);
  }
  return `case is_truthy(${cond}) of true -> ${thenCode}; false -> ${elseCode} end`;
}

function genIfBranch(ctx, branch, typeEnv, sCtx) {
  if (!branch) return 'null';
  // Simple expression form
  if (branch.expr) {
    // Function calls return structures; unwrap when used as value
    // Function calls may return structures from Return nodes
    if (branch.expr.type === 'FunctionCallExpr') {
      return `structure_one(${genExpr(ctx, branch.expr, typeEnv, sCtx)})`;
    }
    return genExpr(ctx, branch.expr, typeEnv, sCtx);
  }
  // Block form with body
  if (branch.body) return genIfBlockBody(ctx, branch.body, typeEnv, sCtx);
  return 'null';
}

function genIfBlockBody(ctx, body, typeEnv, sCtx) {
  const scopeId = ctx.ifScopeCounter++;
  const prefix = `If${scopeId}_`;
  const innerRenames = new Map();

  function innerVarName(name) {
    if (innerRenames.has(name)) return innerRenames.get(name);
    // Fall back to outer SSA resolution
    if (sCtx?.ssaEnv && sCtx.stmtIdx !== undefined) {
      return erlVarName(resolveSSAName(name, sCtx.stmtIdx, sCtx.ssaEnv));
    }
    return erlVarName(name);
  }

  function genInner(e) {
    if (!e) return 'null';
    if (e.type === 'Identifier') return innerVarName(e.name);
    if (e.type === 'RefRead') return `get(${erlSetTarget(ctx, e.name)})`;
    if (e.type === 'StringLiteral') return erlString(e.value);
    if (e.type === 'IntLiteral') return String(e.value);
    if (e.type === 'FloatLiteral') return e.value.toString().includes('.') ? String(e.value) : e.value + '.0';
    if (e.type === 'BoolLiteral') return e.value ? 'true' : 'false';
    if (e.type === 'NullLiteral') return 'null';
    if (e.type === 'BinaryExpr') {
      const left = genInner(e.left);
      const right = genInner(e.right);
      if (e.op === '/') return `(${left} div ${right})`;
      if (e.op === '===') return `(${left} =:= ${right})`;
      if (e.op === '!==') return `(${left} =/= ${right})`;
      if (e.op === '<=') return `(${left} =< ${right})`;
      return `(${left} ${e.op} ${right})`;
    }
    if (e.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' && ctx.actorFnNames.has(e.callee.name)) {
      const args = e.args.map(a => genInner(a)).join(', ');
      return `self_send(${erlString(e.callee.name)}, [${args}])`;
    }
    // Fall back to outer genExpr for complex expressions
    return genExpr(ctx, e, typeEnv, sCtx);
  }

  const lines = [];
  let lastAssignVar = null;

  for (let si = 0; si < body.length; si++) {
    const s = body[si];
    if (s.type === 'ImplicitReturn') {
      lines.push(genInner(s.expr));
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      const renamed = prefix + erlVarName(s.name);
      innerRenames.set(s.name, renamed);
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.value.callee.name)) {
        const args = s.value.args.map(a => genInner(a)).join(', ');
        lines.push(`${renamed} = structure_one(self_send(${erlString(s.value.callee.name)}, [${args}]))`);
      } else {
        lines.push(`${renamed} = ${genInner(s.value)}`);
      }
      lastAssignVar = renamed;
      continue;
    }
    if (s.type === 'DestructureAssign') {
      const tmpName = `${prefix}Dtmp_${si}`;
      if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.actorFnNames.has(s.source.callee.name)) {
        const args = s.source.args.map(a => genInner(a)).join(', ');
        lines.push(`${tmpName} = self_send(${erlString(s.source.callee.name)}, [${args}])`);
      } else {
        lines.push(`${tmpName} = ${genInner(s.source)}`);
      }
      const hasPosItems = s.pattern.some(p => p.positional && !p.rest);
      const hasNamedItems = s.pattern.some(p => p.named || p.key !== undefined);
      if (hasPosItems || hasNamedItems) {
        lines.push(`{${tmpName}_pos, ${tmpName}_named} = ${tmpName}`);
      }
      for (const item of s.pattern) {
        if (item.discard) continue;
        const renamed = prefix + erlVarName(item.name);
        innerRenames.set(item.name, renamed);
        if (item.named || item.key !== undefined) {
          const key = item.key || item.name;
          lines.push(`${renamed} = maps:get(${erlString(key)}, ${tmpName}_named, null)`);
        } else if (item.positional) {
          lines.push(`${renamed} = lists:nth(${(item.idx || 0) + 1}, ${tmpName}_pos)`);
        }
      }
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'StateAssign') {
      lines.push(`put(${erlStateKey(ctx, s.name)}, ${genInner(s.value)})`);
      lastAssignVar = null;
      continue;
    }
    if (s.type === 'SetStatement') {
      lines.push(`put(${erlSetTarget(ctx, s.name)}, ${genInner(s.value)})`);
      lastAssignVar = null;
      continue;
    }
  }

  // If body had no ImplicitReturn, use last assigned var
  if (lastAssignVar && (lines.length === 0 || !body.some(s => s.type === 'ImplicitReturn'))) {
    lines.push(lastAssignVar);
  }

  return lines.join(', ');
}

// Generate return expression for function Return nodes
function genFnReturnExpr(fields, genInner, innerVarName) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);

  // All returns go through structure tuples for consistent structure_one() unwrapping
  const posVals = pos.map(f => {
    if (f.name) return innerVarName(f.name);
    if (f.expr) return genInner(f.expr);
    if (f.value) return genInner(f.value);
    return 'null';
  });
  const namedEntries = named.map(f => {
    if ('sigil' in f) {
      return `${erlString(f.sigil)} => ${innerVarName(f.sigil)}`;
    }
    if (f.key !== undefined) {
      const val = f.value ? genInner(f.value) : (f.name ? innerVarName(f.name) : 'null');
      return `${erlString(f.key)} => ${val}`;
    }
    return '';
  }).filter(Boolean);

  if (posVals.length > 0 && namedEntries.length > 0) {
    return `{[${posVals.join(', ')}], #{${namedEntries.join(', ')}}}`;
  } else if (posVals.length > 0) {
    return `{[${posVals.join(', ')}], #{}}`;
  } else {
    return `{[], #{${namedEntries.join(', ')}}}`;
  }
}

// Generate while loop inside a function body
function genFnWhileStatement(ctx, node, genInner, prefix) {
  const loopId = ctx.fnWhileCounter++;
  const loopName = `${prefix}Loop_${loopId}`;
  const cond = genInner(node.cond);
  const trueCase = node.negated ? 'false' : 'true';
  const falseCase = node.negated ? 'true' : 'false';

  const bodyParts = [];
  for (const s of node.body) {
    if (s.type === 'SetStatement') {
      bodyParts.push(`put(${erlSetTarget(ctx, s.name)}, ${genInner(s.value)})`);
    } else if (s.type === 'StateAssign') {
      bodyParts.push(`put(${erlStateKey(ctx, s.name)}, ${genInner(s.value)})`);
    }
  }
  bodyParts.push(`${loopName}_f()`);

  return `${loopName} = fun ${loopName}_f() -> case is_truthy(${cond}) of ${trueCase} -> ${bodyParts.join(', ')}; ${falseCase} -> null end end, ${loopName}()`;
}

export {
  erlSendVars,
  erlSetTarget,
  genExpr,
  genDotCallAwait,
  genChildDotCallAwait,
  genStructureConstructor,
  genExprScalar,
  genErlLambdaVarCall,
  genErlRuntimeFunctionCall,
  genFunctionCallExpr,
  genActorFnCallExpr,
  genFunctionLiteral,
  genOverExpr,
  genReduceExpr,
  genIfExpr,
  genIfBranch,
  genIfBlockBody,
  genFnReturnExpr,
  genFnWhileStatement,
};
