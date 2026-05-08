// ── Program-level codegen for Erlang ─────────────────────────────────────────

import * as AST from '../../ast.js';
import { resolveSuperclassChain } from '../../subclass.js';
import { PREAMBLE, erlVarName, erlString, erlStateKey } from './preambles.js';
import {
  buildTypeEnv,
  buildSSAEnv,
  resolveSSAName,
} from './types.js';
import {
  genExpr,
} from './expressions.js';
import {
  genLocals,
  genParamDestructure,
  genErlDefaultValue,
  genReplyBody,
  genReplyFieldVal,
  genBvaBody,
} from './statements.js';

// ── Conditional return chain builder ────────────────────────────────────────

function hasErlBlockBodies(ifExpr) {
  if (ifExpr.then?.body) return true;
  const e = ifExpr.else;
  if (!e) return false;
  if (e.type === 'IfExpr') return hasErlBlockBodies(e);
  return e.body !== undefined;
}

// True when any WhileStatement in `body` contains a Return (or a conditional
// return via ImplicitReturn(IfExpr) with block bodies). Used to decide
// whether to wrap the enclosing fn body in `try ... catch throw:... end` so
// the early exit can short-circuit the loop and the fn together.
function bodyHasErlWhileEarlyReturn(body) {
  if (!Array.isArray(body)) return false;
  for (const s of body) {
    if (!s) continue;
    if (s.type === 'WhileStatement' && Array.isArray(s.body)) {
      for (const ws of s.body) {
        if (!ws) continue;
        if (ws.type === 'Return') return true;
        if (ws.type === 'ImplicitReturn' && ws.expr?.type === 'IfExpr' && hasErlBlockBodies(ws.expr)) return true;
        if (ws.type === 'WhileStatement' && bodyHasErlWhileEarlyReturn([ws])) return true;
      }
    }
  }
  return false;
}

// Build the throw expression for an early return inside a while body in a
// handle_op match arm. `fields` are the `->` reply fields. The throw carries
// the dispatch return shape so the surrounding catch can re-raise it.
function makeErlOpReturnThrow(ctx, fields, typeEnv, sCtx) {
  const reBody = genReplyBody(ctx, fields, typeEnv, sCtx);
  const bvaBody = genBvaBody(ctx, fields, typeEnv, sCtx);
  return `throw({'__brevity_op_return__', ${reBody}, ${bvaBody || 'null'}})`;
}

// Build the throw for an early return inside a while body in a private _fn
// method. The carried value is `{[positional], #{named}}`.
function makeErlFnReturnThrow(ctx, fields, typeEnv, sCtx) {
  const ret = makeErlFnRet(ctx, fields, typeEnv, sCtx);
  return `throw({'__brevity_fn_return__', ${ret}})`;
}

// Builds nested `case is_truthy(cond) of true -> ...; false -> ... end` chains
// for if-guards with block bodies containing Return nodes.
//
// guards:       ImplicitReturn(IfExpr) nodes in source order
// typeEnv/sCtx: typing context for genExpr
// I:            base indentation (e.g. '    ') for the outermost case
// makeRet:      (fields) => string — Erlang expression for a Return/Reply node's fields
// makeFinalRet: () => string — Erlang expression for the fallthrough after all guards
// Used in genChildActorCode to gate emission of start_internal_<class>/
// bv_loop_<class>. Same logic as classNeedsSpawnedInstances in statements.js
// (kept duplicated so program.js doesn't depend on statements internals).
function classNeedsSpawnedInstancesProgram(actor) {
  if (!actor) return false;
  for (const p of (actor.initParams || [])) {
    if (typeof p.type !== 'string') continue;
    if (p.type === 'Self') return true;
    if (p.type.split('|').some(m => m.trim() === 'Self')) return true;
    if (/\bSelf\b/.test(p.type)) return true;
  }
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
  function bodyHasSelfCall(body) {
    if (!Array.isArray(body)) return false;
    for (const node of body) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && node.callee.name === 'Self') return true;
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v) && bodyHasSelfCall(v)) return true;
        if (v && typeof v === 'object' && !Array.isArray(v) && bodyHasSelfCall([v])) return true;
      }
    }
    return false;
  }
  for (const fn of actor.functions || []) {
    if (bodyHasSelfCall(fn.body)) return true;
  }
  return false;
}

function buildErlCaseChain(ctx, guards, typeEnv, sCtx, I, makeRet, makeFinalRet) {
  const replyCtx = { ...sCtx, stmtIdx: 99999 };

  function genBranchBody(branchBody, indent) {
    const branchGuards = branchBody.filter(s =>
      s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasErlBlockBodies(s.expr),
    );
    if (branchGuards.length > 0) {
      const branchTermRet = branchBody.find(s => s.type === 'Return');
      const branchFinal = branchTermRet
        ? () => makeRet(branchTermRet.fields)
        : makeFinalRet;
      return buildLevel(branchGuards, 0, indent, branchFinal);
    }
    const termRet = branchBody.find(s => s.type === 'Return');
    return termRet ? makeRet(termRet.fields) : null;
  }

  function buildLevel(guardsList, idx, indent, fallthrough) {
    if (idx >= guardsList.length) return fallthrough();
    const ii = indent + '    ';
    const { expr: ifExpr } = guardsList[idx];
    const condExpr = genExpr(ctx, ifExpr.cond, typeEnv, replyCtx);

    const thenBody = ifExpr.then?.body || [];
    const elseBranch = ifExpr.else;
    const elseBody = elseBranch?.body || [];

    const trueExpr = genBranchBody(thenBody, ii) ?? buildLevel(guardsList, idx + 1, ii, fallthrough);
    const falseExpr = elseBranch
      ? (genBranchBody(elseBody, ii) ?? buildLevel(guardsList, idx + 1, ii, fallthrough))
      : buildLevel(guardsList, idx + 1, ii, fallthrough);

    return `case is_truthy(${condExpr}) of\n${ii}true -> ${trueExpr};\n${ii}false -> ${falseExpr}\n${indent}end`;
  }

  return buildLevel(guards, 0, I, makeFinalRet);
}

// makeRet callback for genFn context: returns {[posVals], #{namedPairs}}
function makeErlFnRet(ctx, fields, typeEnv, replyCtx) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);
  const posVals = pos.map(f => {
    if (f.expr) return genExpr(ctx, f.expr, typeEnv, replyCtx);
    if (f.name) return erlVarName(f.name);
    return 'null';
  });
  const namedPairs = named.map(f => {
    if ('sigil' in f) return `${erlString(f.sigil)} => ${erlVarName(f.sigil)}`;
    if (f.key !== undefined) return `${erlString(f.key)} => ${genExpr(ctx, f.value, typeEnv, replyCtx)}`;
    return '';
  }).filter(Boolean);
  return `{[${posVals.join(', ')}], #{${namedPairs.join(', ')}}}`;
}

// makeRet callback for dispatch context: returns {ok, Re, null} where Re is
// either a positional list `[v1, v2]` or a named map `#{k => v}`.
function makeErlDispatchRet(ctx, fields, typeEnv, replyCtx) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && f.key !== undefined);
  if (named.length > 0 && pos.length === 0) {
    const namedPairs = named.map(f => {
      const val = f.value !== undefined
        ? genExpr(ctx, f.value, typeEnv, replyCtx)
        : (f.expr ? genExpr(ctx, f.expr, typeEnv, replyCtx) : 'null');
      return `${erlString(f.key)} => ${val}`;
    });
    return `{ok, #{${namedPairs.join(', ')}}, null}`;
  }
  const posVals = pos.map(f => {
    if (f.expr) return genExpr(ctx, f.expr, typeEnv, replyCtx);
    if (f.name) return erlVarName(f.name);
    return 'null';
  });
  return `{ok, [${posVals.join(', ')}], null}`;
}

// ── Public function codegen ──────────────────────────────────────────────────

function genPublicFn(ctx, fn) {
  // Simple public function — no type check needed, used when single function per op with no typed params
  const inner = genPublicFnInner(ctx, fn);
  return `handle_op(${erlString(fn.name)}, Message, Payload, _Id, _From) ->\n${inner}`;
}

// ── Function codegen ────────────────────────────────────────────────────────

function genFn(ctx, fn) {
  const { name: op, params, body: rawBody } = fn;
  const typeEnv = buildTypeEnv(params, rawBody, ctx.typeDecls);
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  const hasSilentFn = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilentFn && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    implicitReturn = { type: 'ImplicitReturn', expr: rawBody[rawBody.length - 1].expr, typeName: null };
    body = rawBody.slice(0, -1);
  }
  const I = '    ';

  const restVars = new Set();
  const refVars = new Set();
  const childActorRefs = new Map();
  const sCtx = { restVars, refVars, childActorRefs, selfSpawnedRefs: new Set(), ssaEnv: buildSSAEnv(body) };

  // Destructure from Structure arg
  const paramLines = [];
  let posIdx = 0;
  for (const p of params) {
    if (p.positional) {
      if (p.defaultValue) {
        const dv = genErlDefaultValue(p.defaultValue);
        paramLines.push(`${I}${erlVarName(p.name)} = case length(S_pos) > ${posIdx} of true -> lists:nth(${posIdx + 1}, S_pos); false -> ${dv} end,`);
      } else {
        paramLines.push(`${I}${erlVarName(p.name)} = lists:nth(${posIdx + 1}, S_pos),`);
      }
      posIdx++;
    } else {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genErlDefaultValue(p.defaultValue) : 'null';
      paramLines.push(`${I}${erlVarName(p.name)} = maps:get(${erlString(key)}, S_named, ${dv}),`);
    }
  }

  // While-body early return: throws `{__brevity_fn_return__, RetExpr}` from
  // inside the loop, caught by the wrapping try/catch below.
  const fnHasEarlyWhile = bodyHasErlWhileEarlyReturn(body);
  const savedWhileEarlyThrow = ctx.whileEarlyThrow;
  if (fnHasEarlyWhile) {
    const throwCtx = { ...sCtx, stmtIdx: body.length };
    ctx.whileEarlyThrow = (fields) => makeErlFnReturnThrow(ctx, fields, typeEnv, throwCtx);
  }
  const localLines = genLocals(ctx, body, typeEnv, sCtx, I);
  ctx.whileEarlyThrow = savedWhileEarlyThrow;

  // Reply as Structure
  const paramNames = new Set(params.map(p => p.name));
  let retExpr;

  // Check for conditional return guards (ImplicitReturn wrapping IfExpr with block bodies)
  const erlGuards = rawBody.filter(s =>
    s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasErlBlockBodies(s.expr),
  );

  if (erlGuards.length > 0) {
    const replyCtx = { ...sCtx, stmtIdx: body.length };
    const makeRet = (fields) => makeErlFnRet(ctx, fields, typeEnv, replyCtx);

    let makeFinalRet;
    if (reply) {
      const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
      const pos = reply.fields.filter(f => f.positional);
      const named = reply.fields.filter(f => !f.positional && !f.spread);
      const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, fnReplyCtx)).join(', ');
      const namedPairs = named.map(f => {
        if ('sigil' in f) {
          if (ctx.stateVarNames.has(f.sigil)) return `${erlString(f.sigil)} => get(${erlStateKey(ctx, f.sigil)})`;
          if (fnReplyCtx.ssaEnv?.assignments.some(a => a.name === f.sigil)) return `${erlString(f.sigil)} => ${erlVarName(resolveSSAName(f.sigil, fnReplyCtx.stmtIdx, fnReplyCtx.ssaEnv))}`;
          if (typeEnv?.has(f.sigil) || paramNames.has(f.sigil)) return `${erlString(f.sigil)} => ${erlVarName(f.sigil)}`;
          return `${erlString(f.sigil)} => ${erlString(f.sigil)}`;
        }
        if (f.key !== undefined) {
          const val = f.value ? genExpr(ctx, f.value, typeEnv, fnReplyCtx) : erlVarName(f.key);
          return `${erlString(f.key)} => ${val}`;
        }
        return '';
      }).filter(Boolean).join(', ');
      makeFinalRet = () => `{[${posVals}], #{${namedPairs}}}`;
    } else {
      const nonGuardImpl = rawBody.filter(s =>
        s.type === 'ImplicitReturn' && !(s.expr?.type === 'IfExpr' && hasErlBlockBodies(s.expr)),
      ).pop();
      if (nonGuardImpl) {
        const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
        const raw = genExpr(ctx, nonGuardImpl.expr, typeEnv, fnReplyCtx);
        const isCall = nonGuardImpl.expr.type === 'FunctionCallExpr';
        const val = isCall ? `structure_one(${raw})` : raw;
        makeFinalRet = () => `{[${val}], #{}}`;
      } else {
        makeFinalRet = () => '{[], #{}}';
      }
    }

    retExpr = buildErlCaseChain(ctx, erlGuards, typeEnv, sCtx, I, makeRet, makeFinalRet);
  } else if (reply) {
    const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
    const pos = reply.fields.filter(f => f.positional);
    const named = reply.fields.filter(f => !f.positional && !f.spread);
    const posVals = pos.map(f => genReplyFieldVal(ctx, f, typeEnv, fnReplyCtx)).join(', ');
    const namedPairs = named.map(f => {
      if ('sigil' in f) {
        if (ctx.stateVarNames.has(f.sigil)) return `${erlString(f.sigil)} => get(${erlStateKey(ctx, f.sigil)})`;
        if (fnReplyCtx.ssaEnv?.assignments.some(a => a.name === f.sigil)) return `${erlString(f.sigil)} => ${erlVarName(resolveSSAName(f.sigil, fnReplyCtx.stmtIdx, fnReplyCtx.ssaEnv))}`;
        if (typeEnv?.has(f.sigil) || paramNames.has(f.sigil)) return `${erlString(f.sigil)} => ${erlVarName(f.sigil)}`;
        return `${erlString(f.sigil)} => ${erlString(f.sigil)}`;
      }
      if (f.key !== undefined) {
        const val = f.value ? genExpr(ctx, f.value, typeEnv, fnReplyCtx) : erlVarName(f.key);
        return `${erlString(f.key)} => ${val}`;
      }
      return '';
    }).filter(Boolean).join(', ');
    retExpr = `{[${posVals}], #{${namedPairs}}}`;
  } else if (implicitReturn) {
    const fnReplyCtx = { ...sCtx, stmtIdx: body.length };
    const raw = genExpr(ctx, implicitReturn.expr, typeEnv, fnReplyCtx);
    const isCall = implicitReturn.expr.type === 'FunctionCallExpr';
    const val = isCall ? `structure_one(${raw})` : raw;
    retExpr = `{[${val}], #{}}`;
  } else {
    retExpr = '{[], #{}}';
  }

  const allLines = [];
  if (paramLines.length > 0) allLines.push(paramLines.join('\n'));
  if (fnHasEarlyWhile) {
    // localLines emit trailing commas already, so concat with `\n` and append
    // retExpr (which has no leading comma but follows the last localLine's `,`).
    allLines.push(`${I}try`);
    if (localLines.length > 0) allLines.push(localLines.join('\n'));
    allLines.push(`${I}    ${retExpr}`);
    allLines.push(`${I}catch`);
    allLines.push(`${I}    throw:{'__brevity_fn_return__', R_} -> R_`);
    allLines.push(`${I}end`);
  } else {
    if (localLines.length > 0) allLines.push(localLines.join('\n'));
    allLines.push(`${I}${retExpr}`);
  }

  const fnBaseName = op.startsWith('#') ? `pv_${op.slice(1)}` : op;
  return `${fnBaseName}_fn({S_pos, S_named}) ->\n${allLines.join('\n')}.`;
}

// ── Program codegen ─────────────────────────────────────────────────────────

// Generic subscribe prologue: two handle_op clauses that intercept
// subscribe@<target> / subscribe#<target>, stash {Id, From, Args} in the
// cell_subs list, and recurse with the rewritten op so the normal @/# arm
// runs. Args come from the incoming op-array payload (null for no-arg
// subscribe). Route (the JS _route callback) has no Erlang analogue — the
// in-process path uses {pending_subscribe, Id} as before.
function genSubscribePrologue(fnName) {
  const extractArgs = `case maps:get(<<"op">>, Message, null) of
            List_ when is_list(List_), length(List_) > 1 -> hd(List_);
            _ -> null
        end`;
  return [
    `${fnName}(<<"subscribe@", Target_/binary>>, Message, Payload, Id, From) ->
    SubArgs_ = ${extractArgs},
    SubBva_ = maps:get(<<"bv-a">>, Message, null),
    CellSubs_ = case get({cell_subs, Target_}) of undefined -> []; L_ -> L_ end,
    put({cell_subs, Target_}, CellSubs_ ++ [{Id, From, SubArgs_, SubBva_}]),
    ${fnName}(<<"@", Target_/binary>>, Message, Payload, Id, From)`,
    `${fnName}(<<"subscribe#", Target_/binary>>, Message, Payload, Id, From) ->
    SubArgs_ = ${extractArgs},
    SubBva_ = maps:get(<<"bv-a">>, Message, null),
    CellSubs_ = case get({cell_subs, Target_}) of undefined -> []; L_ -> L_ end,
    put({cell_subs, Target_}, CellSubs_ ++ [{Id, From, SubArgs_, SubBva_}]),
    ${fnName}(<<"#", Target_/binary>>, Message, Payload, Id, From)`,
  ];
}

function genDispatch(ctx, publicFns) {
  // Group public functions by op name
  const grouped = new Map();
  for (const h of publicFns) {
    // Skip actorDef constructor clauses — dispatched via actor instantiation
    if (h.actorDef) continue;
    // Skip empty Function() initializers — no dispatch arm
    if (h.emptyOverload) continue;
    if (!grouped.has(h.name)) grouped.set(h.name, []);
    grouped.get(h.name).push(h);
  }

  const clauses = [...genSubscribePrologue('handle_op')];
  for (const [op, variants] of grouped) {
    if (variants.length === 1 && !variants[0].params.some(p => p.type && !p.rest)) {
      // Single function, no type check needed — simple clause
      clauses.push(genPublicFn(ctx, variants[0], false));
    } else {
      const hasOverloads = variants.length > 1;
      // Multiple variants or type-checked — generate pub_/priv_ helper functions
      const isWireOp = op === 'set' || op === 'update';
      const prefix = isWireOp ? 'self' : op.startsWith('@') ? 'pub' : 'priv';
      const baseName = isWireOp ? op : op.startsWith('@') ? op.slice(1) : op.startsWith('#') ? op.slice(1) : op;
      const tryFns = [];
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `${prefix}_${baseName}_${i}`;
        const innerBody = genPublicFnInner(ctx, h, { hasOverloads });
        tryFns.push({ fnName, body: innerBody });
      }

      // Chain: try first, if nomatch try next, etc.
      let chainExpr = '    {error, ' + erlString(op) + '}';
      for (let i = tryFns.length - 1; i >= 0; i--) {
        const fn = tryFns[i];
        chainExpr = `    case ${fn.fnName}(Message, Payload, _From) of\n        nomatch ->\n    ${chainExpr};\n        Result -> Result\n    end`;
      }

      clauses.push(`handle_op(${erlString(op)}, Message, Payload, _Id, _From) ->\n${chainExpr}`);

      // Add the try functions as separate top-level functions
      for (let i = 0; i < variants.length; i++) {
        const h = variants[i];
        const fnName = `${prefix}_${baseName}_${i}`;
        const inner = genPublicFnInner(ctx, h, { hasOverloads });
        clauses.push(`${fnName}(Message, Payload, From) ->\n${inner}`);
      }
    }
  }

  // As-clause dispatch arms for self-as type coercion
  const asClauses = ctx.asClauses || [];
  for (const clause of asClauses) {
    const val = genExpr(ctx, clause.expr, {}, {});
    if (clause.negated) {
      clauses.push(`handle_op(<<"as">>, _Message, Payload, _Id, _From) when is_binary(Payload) andalso Payload =/= ${erlString(clause.targetType)} ->\n    {ok, [${val}], [Payload]}`);
    } else {
      clauses.push(`handle_op(<<"as">>, _Message, ${erlString(clause.targetType)}, _Id, _From) ->\n    {ok, [${val}], [${erlString(clause.targetType)}]}`);
    }
  }
  // Memoized return-as dispatch arm
  if (ctx.mainActorReturnAs) {
    const t = ctx.mainActorReturnAs;
    clauses.push(`handle_op(<<"as">>, _Message, ${erlString(t)}, _Id, _From) ->\n    {ok, [get(${erlStateKey(ctx, '__returnAs')})], [${erlString(t)}]}`);
  }

  // Catch-all clause
  clauses.push(`handle_op(Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}`);

  return clauses;
}

function genPublicFnInner(ctx, fn, { skipTypeCheck = false, hasOverloads = false } = {}) {
  const { params, body: rawBody } = fn;
  const typeEnv = buildTypeEnv(params, rawBody, ctx.typeDecls);
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement in braced body acts as implicit return (unless explicitly silent)
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    const isSilentEmit = lastExpr.type === 'FunctionCallExpr' && lastExpr.callee?.type === 'Identifier' && ctx.emitNames.has(lastExpr.callee.name) && ctx.emitNames.get(lastExpr.callee.name).silent;
    if (!isSilentEmit) {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }

  // Build type check expression
  const typedParams = params.filter(p => p.type && !p.rest);
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);

  let typeCheck = '';
  if (!skipTypeCheck) {
    if (positionalTyped.length > 0) {
      const posTypes = positionalTyped.map(p => erlString(p.type)).join(', ');
      const namedTypes = namedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
      const requiredPosTyped = positionalTyped.filter(p => !p.defaultValue).length;
      if (requiredPosTyped < positionalTyped.length) {
        typeCheck = `(From =:= <<"__self">> orelse From =:= <<"__test">> orelse match_types_positional(Message, [${posTypes}], [${namedTypes}], ${requiredPosTyped}))`;
      } else {
        typeCheck = `(From =:= <<"__self">> orelse From =:= <<"__test">> orelse match_types_positional(Message, [${posTypes}], [${namedTypes}]))`;
      }
    } else if (namedTyped.length > 0) {
      const requiredNamedTyped = namedTyped.filter(p => !p.defaultValue);
      const pairs = requiredNamedTyped.map(p => `{${erlString(p.key || p.name)}, ${erlString(p.type)}}`).join(', ');
      typeCheck = `(From =:= <<"__self">> orelse From =:= <<"__test">> orelse match_types(Message, [${pairs}]))`;
    }
  }

  // Build arity check for overloads — always applied (not bypassed by From)
  let arityCheck = '';
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
        checks.push(`length(S_pos) =:= ${posCount}`);
      } else {
        checks.push(`length(S_pos) >= ${requiredPosCount} andalso length(S_pos) =< ${posCount}`);
      }
    }
    for (const k of namedKeys) checks.push(`maps:is_key(${erlString(k)}, S_named)`);
    if (namedParams.length > 0) checks.push(`maps:size(S_named) =< ${totalNamedCount}`);
    if (checks.length > 0) arityCheck = checks.join(' andalso ');
  }

  const I = '    ';
  const lines = [];
  const restVars = new Set();
  const refVars = new Set();
  for (const p of params) {
    if (p.rest) restVars.add(p.name);
  }
  const childActorRefs = new Map();
  const sCtx = { restVars, refVars, childActorRefs, selfSpawnedRefs: new Set(), ssaEnv: buildSSAEnv(body) };

  const paramLines = genParamDestructure(params, I);
  lines.push(...paramLines);
  const savedTypeEnv = ctx.currentTypeEnv;
  // Merge state var types so function-typed state vars are detected
  for (const [k, v] of ctx.stateVarTypeEnv) typeEnv.set(k, v);
  ctx.currentTypeEnv = typeEnv;
  // subscribe registration is handled by the generic prologue clause in
  // handle_op (see genSubscribePrologue). No per-fn registration code here.
  // While-body early return: throws `{__brevity_op_return__, Re, Bva}` from
  // inside the loop, caught by the wrapping try/catch around the body below.
  const opHasEarlyWhile = bodyHasErlWhileEarlyReturn(body);
  const savedWhileEarlyThrow = ctx.whileEarlyThrow;
  if (opHasEarlyWhile) {
    const throwCtx = { ...sCtx, stmtIdx: body.length };
    ctx.whileEarlyThrow = (fields) => makeErlOpReturnThrow(ctx, fields, typeEnv, throwCtx);
  }
  const localLines = genLocals(ctx, body, typeEnv, sCtx, I);
  ctx.whileEarlyThrow = savedWhileEarlyThrow;
  // If the body has a leading early-return guard (ImplicitReturn(IfExpr) with
  // a Return-bodied true branch), the assignments must run inside the
  // guard's `false ->` branch — not unconditionally before it. This matches
  // the JS early-return semantics; without it, side effects in assignments
  // (e.g. Self()-spawn) execute even on the early-return path.
  const hasLeadingGuard = body.length > 0
    && body[0].type === 'ImplicitReturn'
    && body[0].expr?.type === 'IfExpr'
    && hasErlBlockBodies(body[0].expr);
  if (!hasLeadingGuard) {
    lines.push(...localLines);
  }
  // set@<cell>: after mutation, replay new value to each registered subscriber
  // using the stored id. Notification shape matches the getter (positional Re
  // + optional bv-a type tag).
  if (fn.name && fn.name.startsWith('set@')) {
    const cellName = fn.name.slice('set@'.length);
    const key = `{cell_subs, ${erlString(cellName)}}`;
    const cellType = params[0]?.type;
    const bvaPart = cellType ? `, <<"bv-a">> => [${erlString(cellType)}]` : '';
    // State key path — child actor state uses a prefix (state_<child>_<cell>);
    // top-level uses plain state_<cell>. childStatePrefix is set during child
    // actor codegen.
    const stateKeyRef = erlStateKey(ctx, '@' + cellName);
    lines.push(`${I}CellSubs_ = case get(${key}) of undefined -> []; L_ -> L_ end,`);
    lines.push(`${I}lists:foreach(fun({SubId_, SubFrom_, _SubArgs_, _SubBva_}) ->`);
    lines.push(`${I}    case SubFrom_ of`);
    lines.push(`${I}        <<"__parent">> ->`);
    // In-process subscriber: invoke the parent actor's registered fun directly,
    // bypassing stdout. The parent registered the fun under {pending_subscribe, SubId_}.
    lines.push(`${I}            case get({pending_subscribe, SubId_}) of`);
    lines.push(`${I}                Sub_fun_ when is_function(Sub_fun_) -> Sub_fun_([get(${stateKeyRef})]);`);
    lines.push(`${I}                _ -> ok`);
    lines.push(`${I}            end;`);
    lines.push(`${I}        _ ->`);
    lines.push(`${I}            Resp_ = #{<<"id">> => SubId_, <<"re">> => [get(${stateKeyRef})], <<"to">> => SubFrom_${bvaPart}},`);
    lines.push(`${I}            io:put_chars([json_encode(Resp_), $\\n])`);
    lines.push(`${I}    end`);
    lines.push(`${I}end, CellSubs_),`);
    // Derived fn replay for this cell is emitted by the underlying
    // SetStatement codegen (set@<cell>'s body is `<cell> <- _v`), so no
    // additional replay block here.
  }

  let replyExpr, bvaExpr;
  if (reply) {
    // Set stmtIdx to body length so SSA resolves to the latest binding
    const replyCtx = { ...sCtx, stmtIdx: body.length };
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      const spreadField = reply.fields.find(f => f.spread);
      const sn = erlVarName(resolveSSAName(spreadField.name, body.length, sCtx.ssaEnv));
      if (restVars.has(spreadField.name)) {
        // restVars holds the source-level prefix (e.g. Args), not an SSA-suffixed
        // form, so use the raw name for the _pos/_named suffix path.
        const rawSn = erlVarName(spreadField.name);
        replyExpr = `structure_splat({${rawSn}_pos, ${rawSn}_named})`;
      } else {
        replyExpr = `structure_splat(${sn})`;
      }
      bvaExpr = null;
    } else {
      replyExpr = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
      bvaExpr = genBvaBody(ctx, reply.fields, typeEnv, replyCtx);
    }
  }

  // Check for conditional return guards
  const erlGuards = rawBody.filter(s =>
    s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasErlBlockBodies(s.expr),
  );

  let replyBlock;
  if (erlGuards.length > 0) {
    const replyCtx = { ...sCtx, stmtIdx: body.length };
    const makeRet = (fields) => makeErlDispatchRet(ctx, fields, typeEnv, replyCtx);

    // When a leading guard owns the assignments, the case's `false` branch
    // emits them as a comma-sequenced prefix before the final return.
    const finalRetPrefix = hasLeadingGuard && localLines.length > 0
      ? localLines.join('\n') + '\n'
      : '';

    let makeFinalRet;
    if (reply) {
      const replyCtxF = { ...sCtx, stmtIdx: body.length };
      const replyExprF = genReplyBody(ctx, reply.fields, typeEnv, replyCtxF);
      const bvaExprF = genBvaBody(ctx, reply.fields, typeEnv, replyCtxF);
      makeFinalRet = () => `${finalRetPrefix}${I}{ok, ${replyExprF}, ${bvaExprF || 'null'}}`;
    } else if (implicitReturn) {
      const replyCtxF = { ...sCtx, stmtIdx: body.length };
      const raw = genExpr(ctx, implicitReturn.expr, typeEnv, replyCtxF);
      const isCall = implicitReturn.expr.type === 'FunctionCallExpr';
      const val = isCall ? `structure_one(${raw})` : raw;
      makeFinalRet = () => `${finalRetPrefix}${I}{ok, [${val}], null}`;
    } else {
      makeFinalRet = () => `${finalRetPrefix}${I}{ok, null, null}`;
    }

    replyBlock = `${I}${buildErlCaseChain(ctx, erlGuards, typeEnv, sCtx, I, makeRet, makeFinalRet)}`;
  } else if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      replyBlock = `${I}Re = ${replyExpr},\n` +
        `${I}BvaRe = case maps:find(<<"bv-a">>, Message) of\n` +
        `${I}    {ok, [BvaFirst|_]} -> structure_splat_bva(BvaFirst);\n` +
        `${I}    _ -> null\n` +
        `${I}end,\n` +
        `${I}{ok, Re, BvaRe}`;
    } else if (bvaExpr) {
      replyBlock = `${I}Re = ${replyExpr},\n${I}{ok, Re, ${bvaExpr}}`;
    } else {
      replyBlock = `${I}Re = ${replyExpr},\n${I}{ok, Re, null}`;
    }
  } else if (implicitReturn) {
    const replyCtx = { ...sCtx, stmtIdx: body.length };
    const raw = genExpr(ctx, implicitReturn.expr, typeEnv, replyCtx);
    const isCall = implicitReturn.expr.type === 'FunctionCallExpr';
    const val = isCall ? `structure_one(${raw})` : raw;
    replyBlock = `${I}{ok, [${val}], null}`;
  } else if (hasSilent) {
    replyBlock = `${I}{ok, null, null}`;
  } else {
    // Void return: no reply, no implicit return, no silent terminator → empty
    // positional reply (`re: []`), distinct from silent (suppresses reply).
    replyBlock = `${I}{ok, [], null}`;
  }

  ctx.currentTypeEnv = savedTypeEnv;

  if (arityCheck) {
    // For overloaded functions: hoist structure_pack before the condition,
    // remove it from param lines, and add arity check to condition
    const bodyLines = lines.filter(l => !l.includes('structure_pack(Payload)'));
    const bodyBlock = bodyLines.length > 0 ? bodyLines.join('\n') + '\n' + replyBlock : replyBlock;
    const hasPositional = params.some(p => p.positional && !p.rest);
    const hasRest = params.some(p => p.rest);
    const structPackLine = hasRest
      ? `${I}{Args_pos, Args_named} = structure_pack(Payload),`
      : hasPositional
        ? `${I}{S_pos, S_named} = structure_pack(Payload),`
        : `${I}{S_pos, S_named} = structure_pack(Payload),`;
    const fullCondition = typeCheck ? `${arityCheck} andalso ${typeCheck}` : arityCheck;
    return `${structPackLine}\n${I}case ${fullCondition} of\n${I}    true ->\n${bodyBlock.split('\n').map(l => '        ' + l).join('\n')};\n${I}    false ->\n${I}        nomatch\n${I}end`;
  }

  let innerBody = lines.length > 0 ? lines.join('\n') + '\n' + replyBlock : replyBlock;

  if (opHasEarlyWhile) {
    // Wrap the body in `try ... catch throw:{__brevity_op_return__, Re_, Bva_}
    // -> {ok, Re_, Bva_} end` so a Return inside a `repeat while` short-circuits
    // the loop and the handler in one step. The body's trailing `,` (from the
    // last local line) before replyBlock is already correct for try-block
    // statement chaining.
    innerBody = `${I}try\n${innerBody}\n${I}catch\n${I}    throw:{'__brevity_op_return__', Re_, Bva_} -> {ok, Re_, Bva_}\n${I}end`;
  }

  if (typeCheck) {
    return `${I}case ${typeCheck} of\n${I}    true ->\n${innerBody.split('\n').map(l => '        ' + l).join('\n')};\n${I}    false ->\n${I}        nomatch\n${I}end`;
  }
  return innerBody;
}

function genCamInit(ctx, actor) {
  const initBody = actor.initBody || [];
  const initParams = actor.initParams || [];
  const stateVarDecls = actor.stateVarDecls || [];

  const stateVarEnv = new Map(stateVarDecls.map(d => ['$' + d.name, d.typeName]));
  const typeEnv = buildTypeEnv(initParams, initBody, ctx.typeDecls);
  // Merge state var types into typeEnv
  for (const [k, v] of stateVarEnv) typeEnv.set(k, v);

  const I = '    ';
  const lines = [];
  lines.push(`handle_cam_init(Message) ->`);
  lines.push(`${I}Id = maps:get(<<"id">>, Message, <<>>),`);
  lines.push(`${I}From = maps:get(<<"from">>, Message, <<>>),`);

  if (initParams.length > 0) {
    lines.push(`${I}CamVal = maps:get(<<"cam">>, Message, null),`);
    lines.push(`${I}Payload = case CamVal of`);
    lines.push(`${I}    L when is_list(L), length(L) > 1 -> hd(L);`);
    lines.push(`${I}    _ -> #{}`);
    lines.push(`${I}end,`);
    const paramLines = genParamDestructure(initParams, I);
    lines.push(...paramLines);
  }

  // Generate init body statements (StateAssign, TypedAssign, etc.)
  const sCtx = { restVars: new Set(), refVars: new Set(), ssaEnv: buildSSAEnv(initBody) };
  const localLines = genLocals(ctx, initBody, typeEnv, sCtx, I);
  lines.push(...localLines);

  // Memoized return-as value for main actor
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const val = genExpr(ctx, actor.declarationReturn.expr, typeEnv, sCtx);
    lines.push(`${I}put(${erlStateKey(ctx, '__returnAs')}, ${val}),`);
  }

  lines.push(`${I}put(bv_initialized_, true),`);
  lines.push(`${I}Resp = #{<<"id">> => Id, <<"re">> => <<"init">>, <<"to">> => From},`);
  lines.push(`${I}io:put_chars([json_encode(Resp), $\n]).`);

  return lines.join('\n');
}

function genChildHandleOp(ctx, actor) {
  const name = actor.name.toLowerCase();
  const prefix = `child_${name}`;
  const clauses = [...genSubscribePrologue(`${prefix}_handle_op`)];

  // Set emit names for this child actor
  const savedEmitNames = ctx.emitNames;
  ctx.emitNames = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'EmitDecl') ctx.emitNames.set(s.name, s);
  }

  const _isPublicFn = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update');
  const childPublicFns = actor.functions.filter(f => _isPublicFn(f));
  const childPrivateFns = actor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !_isPublicFn(f));

  // Ref-captured-by for this child's non-silent @/# fns (same as main actor).
  const collectRefReads = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) collectRefReads(n, acc); return; }
    if (node.type === 'RefRead' && node.name) acc.add(node.name);
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      collectRefReads(node[k], acc);
    }
  };
  const silentFnNames = new Set();
  for (const fn of [...childPublicFns, ...childPrivateFns]) {
    if (!fn.name) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (hasSilent && !hasReply && !hasImplicit) silentFnNames.add(fn.name);
  }
  const savedRefCapturedBy = ctx._refCapturedBy;
  const refCapturedBy = new Map();
  for (const fn of [...childPublicFns, ...childPrivateFns]) {
    if (!fn.name) continue;
    const isPub = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
    const isPriv = fn.name.startsWith('#');
    if (!isPub && !isPriv) continue;
    if (silentFnNames.has(fn.name)) continue;
    const acc = new Set();
    collectRefReads(fn.body, acc);
    for (const refName of acc) {
      if (!refCapturedBy.has(refName)) refCapturedBy.set(refName, new Set());
      refCapturedBy.get(refName).add(fn.name);
    }
  }
  ctx._refCapturedBy = refCapturedBy;

  // Set child self_send prefix so actorFnNames calls route to child dispatch
  const savedSelfSendPrefix = ctx.selfSendPrefix;
  if (childPrivateFns.length > 0) {
    ctx.selfSendPrefix = prefix;
  }

  for (const h of childPublicFns) {
    const inner = genPublicFnInner(ctx, h, { skipTypeCheck: true });
    clauses.push(`${prefix}_handle_op(${erlString(h.name)}, _Message, Payload, _Id, _From) ->\n${inner}`);
  }
  // Add private function dispatch clauses for child actor
  for (const h of childPrivateFns) {
    const inner = genPublicFnInner(ctx, h, { skipTypeCheck: true });
    clauses.push(`${prefix}_handle_op(${erlString(h.name)}, _Message, Payload, _Id, _From) ->\n${inner}`);
  }

  ctx.selfSendPrefix = savedSelfSendPrefix;
  ctx._refCapturedBy = savedRefCapturedBy;

  // On-handler clauses
  const childOnHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  for (const h of childOnHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body, ctx.typeDecls);
    const I = '    ';
    const hLines = [];
    const restVars = new Set();
    const refVars = new Set();
    const childActorRefs = new Map();
    const sCtx = { restVars, refVars, childActorRefs, selfSpawnedRefs: new Set(), ssaEnv: buildSSAEnv(h.body) };
    const paramLines = genParamDestructure(h.params, I);
    hLines.push(...paramLines);
    const localLines = genLocals(ctx, h.body, typeEnv, sCtx, I);
    hLines.push(...localLines);
    // Check if on-handler has a reply (emit-with-return-value)
    const reply = h.body.find(s => s.type === 'Reply');
    if (reply) {
      const replyCtx = { ...sCtx, stmtIdx: h.body.indexOf(reply) };
      const reExpr = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
      hLines.push(`${I}{ok, ${reExpr}, null}`);
    } else {
      hLines.push(`${I}{ok, null, null}`);
    }
    const innerBody = hLines.join('\n');
    const sourceIsRemote = ctx.remoteInstanceVars.has(h.source);
    if (sourceIsRemote) {
      const stateRef = `get(${erlStateKey(ctx, h.source)})`;
      const guardedBody = `    case From =:= ${stateRef} of\n        true ->\n${innerBody.split('\n').map(l => '        ' + l).join('\n')};\n        false ->\n            {ok, null, null}\n    end`;
      clauses.push(`${prefix}_handle_op(${erlString(h.eventName)}, _Message, Payload, _Id, From) ->\n${guardedBody}`);
    } else {
      clauses.push(`${prefix}_handle_op(${erlString(h.eventName)}, _Message, Payload, _Id, <<"__emit">>) ->\n${innerBody}`);
    }
  }

  // Auto-generate accessor clauses for child constructor params
  const childConstructorParams = actor.initParams || [];
  for (const p of childConstructorParams) {
    if (p.suppressAccessor) continue;
    if (p.key && !p.accessor) continue;
    const accessorName = p.accessor || p.name;
    const stateKey = erlStateKey(ctx, p.name);
    clauses.push(`${prefix}_handle_op(${erlString('@' + accessorName)}, _Message, _Payload, _Id, _From) ->\n    {ok, #{${erlString(accessorName)} => get(${stateKey})}, null}`);
  }

  // Generate delegation clauses for inherited functions from wrapped superclasses
  const delegatedFunctions = actor._delegatedFunctions || [];
  const supertypeBindings = actor._supertypeBindings || [];
  for (const f of delegatedFunctions) {
    // Forward to the wrapped superclass's child dispatch
    const wb = supertypeBindings[0]; // Use the first (primary) wrapped binding
    if (wb) {
      clauses.push(`${prefix}_handle_op(${erlString(f.name)}, Message, Payload, Id, From) ->\n    child_dispatch(${erlString(wb.supertype.toLowerCase())}, ${erlString(f.name)}, Message, Payload, Id, From)`);
    }
  }

  // As-clause dispatch arms for child actor self-as type coercion
  for (const clause of (actor.asClauses || [])) {
    const val = genExpr(ctx, clause.expr, {}, {});
    if (clause.negated) {
      clauses.push(`${prefix}_handle_op(<<"as">>, _Message, Payload, _Id, _From) when is_binary(Payload) andalso Payload =/= ${erlString(clause.targetType)} ->\n    {ok, [${val}], [Payload]}`);
    } else {
      clauses.push(`${prefix}_handle_op(<<"as">>, _Message, ${erlString(clause.targetType)}, _Id, _From) ->\n    {ok, [${val}], [${erlString(clause.targetType)}]}`);
    }
  }
  // Memoized return-as dispatch arm for child actor
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const t = actor.declarationReturn.typeName;
    clauses.push(`${prefix}_handle_op(<<"as">>, _Message, ${erlString(t)}, _Id, _From) ->\n    {ok, [get(${erlStateKey(ctx, '__returnAs')})], [${erlString(t)}]}`);
  }

  // Catch-all clause
  clauses.push(`${prefix}_handle_op(Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}`);

  ctx.emitNames = savedEmitNames;
  return clauses.join(';\n') + '.';
}

function genChildInit(ctx, actor) {
  const name = actor.name.toLowerCase();
  const constructorParams = actor.initParams || [];
  const initBody = actor.initBody || [];
  const supertypeBindings = actor._supertypeBindings || [];
  const inheritedIngests = actor._inheritedIngests || [];

  const hasOnHandlers = actor.functions.some(f => f.type === 'OnHandler');
  const hasReturnAs = !!(actor.declarationReturn && actor.declarationReturn.typeName);
  if (constructorParams.length === 0 && initBody.length === 0 && !hasOnHandlers && supertypeBindings.length === 0 && inheritedIngests.length === 0 && !hasReturnAs) return '';

  const I = '    ';
  const lines = [];
  lines.push(`child_${name}_init(Payload) ->`);

  // Destructure constructor params from Payload
  const paramLines = genParamDestructure(constructorParams, I);
  lines.push(...paramLines);

  // Store constructor params as state
  for (const p of constructorParams) {
    lines.push(`${I}put(${erlStateKey(ctx, p.name)}, ${erlVarName(p.name)}),`);
  }

  // Split init body into pre-ingest, ingest, and post-ingest phases
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
  const typeEnv = buildTypeEnv(constructorParams, initBody.filter(s => s.value?.type !== 'IngestExpr'), ctx.typeDecls);
  const sCtx = { restVars: new Set(), refVars: new Set(), ssaEnv: buildSSAEnv(preIngestBody) };
  const preLines = genLocals(ctx, preIngestBody, typeEnv, sCtx, I);
  lines.push(...preLines);

  // Handle ingest value assignment
  if (ownIngestInfo) {
    if (ownIngestInfo.defaultValue) {
      // Ingest with default — use default value (subclasses override via their own init)
      const defaultVal = genExpr(ctx, ownIngestInfo.defaultValue, typeEnv, sCtx);
      lines.push(`${I}put(${erlStateKey(ctx, ownIngestInfo.name)}, ${defaultVal}),`);
    } else {
      // No default — value must be provided by subclass (no-op here, subclass writes state directly)
      lines.push(`${I}put(${erlStateKey(ctx, ownIngestInfo.name)}, null),`);
    }
    // Post-ingest body statements
    const postSCtx = { restVars: new Set(), refVars: new Set(), ssaEnv: buildSSAEnv(postIngestBody) };
    const postLines = genLocals(ctx, postIngestBody, typeEnv, postSCtx, I);
    lines.push(...postLines);
  } else if (inheritedIngests.length > 0 && actor.declarationReturn) {
    // Subclass provides a value for its superclass's ingest — assign directly to the inherited state var
    const ingest = inheritedIngests[0];
    const val = genExpr(ctx, actor.declarationReturn.expr, typeEnv, sCtx);
    lines.push(`${I}put(${erlStateKey(ctx, ingest.name)}, ${val}),`);
  } else if (inheritedIngests.length > 0) {
    // Subclass doesn't provide a return — use superclass's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        const defaultVal = genExpr(ctx, ingest.defaultValue, typeEnv, sCtx);
        lines.push(`${I}put(${erlStateKey(ctx, ingest.name)}, ${defaultVal}),`);
      }
    }
  }

  // Memoized return-as value
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const val = genExpr(ctx, actor.declarationReturn.expr, typeEnv, sCtx);
    lines.push(`${I}put(${erlStateKey(ctx, '__returnAs')}, ${val}),`);
  }

  // Service coercion aliases — copy ref state to alias.
  // Constructor coercions have no runtime presence (compile-time aliases only).
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && !s.constructorParams) {
      const refName = s.ref?.name || s.ref;
      lines.push(`${I}put(${erlStateKey(ctx, s.name)}, get(${erlStateKey(ctx, refName)})),`);
    }
  }

  // Auto-create wrapped superclass instances
  for (const wb of supertypeBindings) {
    const superActor = ctx.actorNodes?.get(wb.supertype);
    if (superActor) {
      // Use the merged actor from actorInfo if available (has merged params/bindings)
      const mergedSuper = ctx.actorInfo.get(wb.supertype)?.actor || superActor;
      const superParams = (mergedSuper.initParams || []);
      const superInitBody = mergedSuper.initBody || [];
      const superHasOnHandlers = mergedSuper.functions.some(f => f.type === 'OnHandler');
      const superHasBindings = (mergedSuper._supertypeBindings || []).length > 0;
      // Only call child_X_init if the superclass actually generates one
      const needsInit = superParams.length > 0 || superInitBody.length > 0 || superHasOnHandlers || superHasBindings;
      if (needsInit) {
        if (superParams.length > 0) {
          const hasNamed = superParams.some(p => !p.positional);
          if (hasNamed) {
            const fields = superParams.map(p => `${erlString(p.key || p.name)} => ${erlVarName(p.name)}`).join(', ');
            lines.push(`${I}child_${wb.supertype.toLowerCase()}_init(#{${fields}}),`);
          } else {
            const args = superParams.map(p => erlVarName(p.name)).join(', ');
            lines.push(`${I}child_${wb.supertype.toLowerCase()}_init([${args}]),`);
          }
        } else {
          lines.push(`${I}child_${wb.supertype.toLowerCase()}_init(#{}),`);
        }
      }
      // Store the wrapped binding name as a reference to the superclass's child dispatch name
      lines.push(`${I}put(${erlStateKey(ctx, wb.name)}, ${erlString(wb.supertype.toLowerCase())}),`);
    }
  }

  // Subscribe to emits from wrapped children (on handlers)
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');
  for (const h of onHandlers) {
    lines.push(`${I}subscribe_(${erlString(h.eventName)}, fun(_EvName, _EvPayload) -> child_${name}_handle_op(_EvName, #{}, _EvPayload, <<"0">>, <<"__emit">>) end),`);
  }

  lines.push(`${I}ok.`);

  return lines.join('\n');
}

function genChildActorCode(ctx, actors) {
  const sections = [];
  const savedStateVarNames = ctx.stateVarNames;
  let savedTypeEnv = ctx.stateVarTypeEnv;
  const savedRemoteInstanceVars = ctx.remoteInstanceVars;
  const savedChildStatePrefix = ctx.childStatePrefix;
  for (const [name] of ctx.actorInfo) {
    const actor = actors.find(a => a.name === name);
    if (!actor) continue;

    // ── Resolve superclass inheritance ──────────────────────────────────
    const { inheritedParams, inheritedFunctions, wrappedBindings, inheritedIngests } = resolveSuperclassChain(ctx.actorNodes, actor);

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
      ...inlinedInherited,
    ];

    // Build wrapped superclass bindings list
    const supertypeBindings = [];
    for (const wb of wrappedBindings) {
      const superActor = ctx.actorNodes?.get(wb.supertype);
      if (superActor) supertypeBindings.push(wb);
    }

    // Subscribe-on-param transform: SubscribeCall in init/constructor body
    // whose target is a constructor param ref-typed `*(...) Self!` (or Self-
    // bearing union, or `List of Self!`) is synthesized into a public
    // handler `@__sub_<param>` so the host can dispatch notifications to
    // this instance via the standard child_<class>_dispatch_at path.
    // Constructor body and init body often duplicate the same SubscribeCall
    // (parser populates both). Keep a per-class set of seen callback names
    // so we only emit one handler per param.
    const paramSubInfo = []; // {paramName, callbackName, paramType}
    const seenCallbacks = new Set();
    const transformSubscribeOnParam = (body) => {
      if (!Array.isArray(body)) return body;
      const out = [];
      for (const s of body) {
        if (s?.type === 'ExprStatement' && s.expr?.type === 'SubscribeCall' &&
            s.expr.target?.type === 'Identifier' &&
            (actor.initParams || []).some(p => p.name === s.expr.target.name)) {
          const paramName = s.expr.target.name;
          const callbackName = '@__sub_' + paramName;
          const sub = s.expr;
          if (!seenCallbacks.has(callbackName)) {
            seenCallbacks.add(callbackName);
            mergedFunctions.push({
              type: 'FunctionDecl',
              name: callbackName,
              params: sub.params || [],
              body: sub.body || [],
            });
            const paramType = (actor.initParams || []).find(p => p.name === paramName)?.type;
            paramSubInfo.push({ paramName, callbackName, paramType });
          }
          continue; // drop the SubscribeCall from the body
        }
        out.push(s);
      }
      return out;
    };
    const transformedConstructorBody = transformSubscribeOnParam(actor.constructorBody || []);
    const transformedInitBody = transformSubscribeOnParam(actor.initBody || []);

    const mergedActor = {
      ...actor,
      initParams: mergedParams,
      functions: mergedFunctions,
      constructorBody: transformedConstructorBody,
      initBody: transformedInitBody,
      _delegatedFunctions: delegatedFunctions,
      _supertypeBindings: supertypeBindings,
      _inheritedIngests: inheritedIngests,
      _paramSubscriptions: paramSubInfo,
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
    const savedActorInfo = ctx.actorInfo.get(name);
    ctx.actorInfo.set(name, { ...savedActorInfo, actor: mergedActor });

    // Set state var names and type env for this child actor
    const childStateDecls = mergedActor.stateVarDecls || [];
    const childParams = mergedActor.initParams || [];
    const childCoercions = (mergedActor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
    ctx.stateVarNames = new Set([
      ...childStateDecls.map(v => v.name),
      ...childParams.map(p => p.name),
      ...childCoercions.map(s => s.name),
      ...supertypeBindings.map(wb => wb.name),
    ]);
    savedTypeEnv = ctx.stateVarTypeEnv;
    ctx.stateVarTypeEnv = new Map([
      ...childStateDecls.map(v => [v.name, v.typeName]),
      ...childParams.map(p => [p.name, p.type || 'Anything']),
      ...childCoercions.map(s => [s.name, 'Anything']),
      ...supertypeBindings.map(wb => [wb.name, 'Anything']),
    ]);
    ctx.childStatePrefix = name.toLowerCase();
    ctx.childConstructorParams = new Set(childParams.map(p => p.name));
    ctx.remoteInstanceVars = new Set();

    // Add merged non-public function names to actorFnNames so expression codegen routes through self_send
    const savedActorFnNames = new Set(ctx.actorFnNames);
    const allChildPrivateFns = mergedActor.functions.filter(f => f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update');
    for (const f of allChildPrivateFns) {
      ctx.actorFnNames.add(f.name);
    }

    // Note: child private functions are dispatched via child_X_handle_op clauses (generated in genChildHandleOp).
    // No standalone genFn needed — child_X_self_send routes through child_X_handle_op.

    // Generate init function
    const initFn = genChildInit(ctx, mergedActor);
    if (initFn) sections.push(initFn);

    // Generate public function dispatch
    sections.push(genChildHandleOp(ctx, mergedActor));

    // Generate child-specific self_send if child has private functions
    const childPrivFns = mergedActor.functions.filter(f => f.type === 'FunctionDecl' && f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update');
    if (childPrivFns.length > 0) {
      const prefix = `child_${name.toLowerCase()}`;
      sections.push(`${prefix}_self_send(OpName, Payload) ->\n    {ok, Re, _Bva} = ${prefix}_handle_op(OpName, #{}, Payload, <<"0">>, <<"__self">>),\n    structure_pack(Re).`);
    }

    // Generate per-class start_internal_<class>/1 + bv_loop_<class>/0 so
    // each instance of <class> can run as its own Erlang process. Each
    // process owns its own dict, so prefix-keyed state never collides
    // between instances. Only emit when the class actually needs spawned
    // instances (Self() recursion or a Self-typed @-cell).
    if (classNeedsSpawnedInstancesProgram(mergedActor)) {
      const lowerName = name.toLowerCase();
      const initCall = initFn ? `child_${lowerName}_init(Args_)` : 'ok';
      sections.push(`start_internal_${lowerName}(Args_) ->\n    ${initCall},\n    bv_loop_${lowerName}().\n\nbv_loop_${lowerName}() ->\n    receive\n        {bv_dispatch, From_, Op_, Payload_, Id_} ->\n            Result_ = child_${lowerName}_handle_op(Op_, #{<<"op">> => Op_}, Payload_, Id_, <<"__bv_internal">>),\n            case Result_ of\n                {ok, Re_, _Bva_} -> From_ ! {bv_reply, Id_, Re_};\n                _ -> From_ ! {bv_error, Id_}\n            end,\n            bv_loop_${lowerName}();\n        bv_stop -> ok\n    end.`);
    }

    // Restore actorFnNames
    ctx.actorFnNames = savedActorFnNames;
  }
  ctx.stateVarNames = savedStateVarNames;
  ctx.stateVarTypeEnv = savedTypeEnv;
  ctx.remoteInstanceVars = savedRemoteInstanceVars;
  ctx.childStatePrefix = savedChildStatePrefix;
  ctx.childConstructorParams = null;

  // Generate child_dispatch routing function
  if (ctx.actorInfo.size > 0) {
    const dispatchClauses = [...ctx.actorInfo.keys()].map(name =>
      `child_dispatch(${erlString(name.toLowerCase())}, Op, Message, Payload, Id, From) ->\n    child_${name.toLowerCase()}_handle_op(Op, Message, Payload, Id, From)`,
    );
    dispatchClauses.push('child_dispatch(_, Op, _Message, _Payload, _Id, _From) ->\n    {error, Op}');
    sections.push(dispatchClauses.join(';\n') + '.');
  }

  return sections.length > 0 ? '\n' + sections.join('\n\n') + '\n' : '';
}

function genLambdaHandlerInner(ctx, lName, lVarName, fnNode, captures) {
  const params = fnNode.params || [];
  const I = '    ';
  const lines = [];

  // Destructure params from Structure
  if (params.length > 0) {
    const paramDestructLines = genParamDestructure(params, I);
    lines.push(...paramDestructLines);
  }

  // Self-reference constant for recursive lambdas
  if (lVarName) {
    lines.push(`${I}${erlVarName(lVarName)} = <<"${lName}">>,`);
  }

  // Load captures from process dictionary
  if (captures && captures.length > 0) {
    for (const cap of captures) {
      lines.push(`${I}${erlVarName(cap.name)} = get('_cap_${cap.lambdaName}_${cap.name}'),`);
    }
  }

  // Generate body using genFn-style codegen
  const body = fnNode.body || [];
  const typeEnv = buildTypeEnv(params, body, ctx.typeDecls);
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;

  if (body.length > 0) {
    const reply = body.find(s => s.type === 'Reply');
    const returnNode = body.find(s => s.type === 'Return');
    const implicitReturn = body.find(s => s.type === 'ImplicitReturn');
    const ssaEnv = buildSSAEnv(body);
    const sCtx = { restVars: new Set(), refVars: new Set(), childActorRefs: new Map(), selfSpawnedRefs: new Set(), ssaEnv };
    // Lambdas dispatch through handle_op so their early returns share the
    // op_return throw shape; the wrap below catches it and produces {ok,Re,Bva}.
    const lambdaHasEarlyWhile = bodyHasErlWhileEarlyReturn(body);
    const savedWhileEarlyThrow = ctx.whileEarlyThrow;
    if (lambdaHasEarlyWhile) {
      const throwCtx = { ...sCtx, stmtIdx: body.length };
      ctx.whileEarlyThrow = (fields) => makeErlOpReturnThrow(ctx, fields, typeEnv, throwCtx);
    }
    const localLines = genLocals(ctx, body, typeEnv, sCtx, I);
    ctx.whileEarlyThrow = savedWhileEarlyThrow;
    if (lambdaHasEarlyWhile) {
      // Wrap the body+reply in try/catch so a Return inside a `repeat while`
      // short-circuits the loop and the lambda dispatch in one step.
      lines.push(`${I}try`);
      lines.push(...localLines);
    } else {
      lines.push(...localLines);
    }

    // Check for conditional return guards
    const erlGuards = body.filter(s =>
      s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasErlBlockBodies(s.expr),
    );

    if (erlGuards.length > 0) {
      const replyCtx = { ...sCtx, stmtIdx: body.length };
      const makeRet = (fields) => makeErlDispatchRet(ctx, fields, typeEnv, replyCtx);
      let makeFinalRet;
      if (reply) {
        const replyExprF = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
        const bvaExprF = genBvaBody(ctx, reply.fields, typeEnv, replyCtx);
        makeFinalRet = () => `{ok, ${replyExprF}, ${bvaExprF || 'null'}}`;
      } else if (returnNode) {
        const retExprF = genReplyBody(ctx, returnNode.fields, typeEnv, replyCtx);
        makeFinalRet = () => `{ok, ${retExprF}, null}`;
      } else {
        makeFinalRet = () => '{ok, null, null}';
      }
      lines.push(`${I}${buildErlCaseChain(ctx, erlGuards, typeEnv, sCtx, I, makeRet, makeFinalRet)}`);
    } else if (reply) {
      const replyCtx = { ...sCtx, stmtIdx: body.length };
      const replyExpr = genReplyBody(ctx, reply.fields, typeEnv, replyCtx);
      const bvaExpr = genBvaBody(ctx, reply.fields, typeEnv, replyCtx);
      lines.push(`${I}Re = ${replyExpr},`);
      lines.push(`${I}{ok, Re, ${bvaExpr || 'null'}}`);
    } else if (returnNode) {
      const retCtx = { ...sCtx, stmtIdx: body.length };
      const replyExpr = genReplyBody(ctx, returnNode.fields, typeEnv, retCtx);
      const bvaExpr = genBvaBody(ctx, returnNode.fields, typeEnv, retCtx);
      lines.push(`${I}Re = ${replyExpr},`);
      lines.push(`${I}{ok, Re, ${bvaExpr || 'null'}}`);
    } else if (implicitReturn) {
      const retCtx = { ...sCtx, stmtIdx: body.length };
      const retExpr = genExpr(ctx, implicitReturn.expr, typeEnv, retCtx);
      lines.push(`${I}{ok, [${retExpr}], null}`);
    } else if (fnNode.returnType === '.') {
      lines.push(`${I}{ok, null, null}`);
    } else {
      // Last typed assign as return value
      const bodyStmts = body.filter(s => s.type !== 'ImplicitReturn' && s.type !== 'Reply');
      if (bodyStmts.length > 0) {
        const last = bodyStmts[bodyStmts.length - 1];
        if (last.type === 'TypedAssign' || last.type === 'Assign') {
          const lastSSA = resolveSSAName(last.name, body.length, ssaEnv);
          lines.push(`${I}{ok, [${erlVarName(lastSSA)}], null}`);
        } else if (last.type === 'WhileStatement') {
          lines.push(`${I}{ok, [null], null}`);
        } else {
          lines.push(`${I}{ok, null, null}`);
        }
      } else {
        lines.push(`${I}{ok, null, null}`);
      }
    }
    if (lambdaHasEarlyWhile) {
      lines.push(`${I}catch`);
      lines.push(`${I}    throw:{'__brevity_op_return__', Re_, Bva_} -> {ok, Re_, Bva_}`);
      lines.push(`${I}end`);
    }
  } else if (fnNode.expr) {
    const retExpr = genExpr(ctx, fnNode.expr, typeEnv, { stmtIdx: 0 });
    if (fnNode.returnType === '.') {
      lines.push(`${I}${retExpr},`);
      lines.push(`${I}{ok, null, null}`);
    } else {
      lines.push(`${I}{ok, [${retExpr}], null}`);
    }
  } else {
    lines.push(`${I}{ok, null, null}`);
  }

  ctx.currentTypeEnv = savedTypeEnv;
  return lines.join('\n');
}

function genProgram(ctx, actor, allActors, options = {}) {
  // Reset state for this program
  ctx.lambdaCounter = 0;
  ctx.sendCounter = 0;
  ctx.lambdaHandlers = [];
  ctx.lambdaVarNames = new Set();
  ctx.lambdaCaptureKeys = [];

  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update');
  const isFnDecl = f => f.type === 'FunctionDecl';
  const privateFns = actor.functions.filter(f => isFnDecl(f) && !_isPublic(f) && !f.actorDef && !f.emptyOverload);
  const publicFns = actor.functions.filter(f => isFnDecl(f) && _isPublic(f));

  // Ref-captured-by map: for every non-silent @/# fn that reads a state ref,
  // record refName -> Set<fnFullName>. Used by set sites (set@<cell> and raw
  // SetStatement on state refs) to re-evaluate derived fns per subscriber.
  const collectRefReads = (node, acc) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) collectRefReads(n, acc); return; }
    if (node.type === 'RefRead' && node.name) acc.add(node.name);
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      collectRefReads(node[k], acc);
    }
  };
  const silentFnNames = new Set();
  for (const fn of [...publicFns, ...privateFns]) {
    if (!fn.name) continue;
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (hasSilent && !hasReply && !hasImplicit) silentFnNames.add(fn.name);
  }
  const refCapturedBy = new Map();
  for (const fn of [...publicFns, ...privateFns]) {
    if (!fn.name) continue;
    const isPub = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
    const isPriv = fn.name.startsWith('#');
    if (!isPub && !isPriv) continue;
    if (silentFnNames.has(fn.name)) continue;
    const acc = new Set();
    collectRefReads(fn.body, acc);
    for (const refName of acc) {
      if (!refCapturedBy.has(refName)) refCapturedBy.set(refName, new Set());
      refCapturedBy.get(refName).add(fn.name);
    }
  }
  ctx._refCapturedBy = refCapturedBy;
  const onHandlers = actor.functions.filter(f => f.type === 'OnHandler');

  // Collect emit declarations from constructorBody
  const emitDecls = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'EmitDecl') emitDecls.set(s.name, s);
  }
  ctx.emitNames = emitDecls;
  const hasFns = privateFns.length > 0;
  const stateVarDecls = actor.stateVarDecls || [];
  const constructorParams = actor.initParams || [];
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
  ];
  // const isStateful = allStateNames.length > 0;
  ctx.stateVarNames = new Set(allStateNames);
  // Slice 10: shape-typed state cells need typeName lookup at expression
  // codegen time so DotAccessExpr can resolve a `*Point` cell to its decl.
  ctx.stateVarDecls = stateVarDecls;
  ctx.remoteInstanceVars = new Set();
  // Constructor coercions: alias name → underlying dep name. Add the alias
  // to dependencyNames so `t = Coerced(args)` enters the construction path;
  // substitute the underlying dep at `new` emission.
  ctx.constructorCoercions = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && s.constructorParams) {
      const underlying = s.ref?.name || s.ref;
      ctx.constructorCoercions.set(s.name, underlying);
      ctx.dependencyNames.add(s.name);
    }
  }
  const initBody = actor.initBody || [];
  // Map state var -> child actor class name, so later codegen (e.g. c.val
  // method routing, subscribe) can find the actor behind a state var.
  ctx.childVarToActor = new Map();
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name) && !ctx.destructuredMembers?.has(s.value.callee.name)) {
      ctx.remoteInstanceVars.add(s.name);
    } else if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorInfo?.has(s.value.callee.name)) {
      ctx.childVarToActor.set(s.name, s.value.callee.name);
    }
  }
  ctx.stateVarTypeEnv = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);

  // Set main actor return-as type before dispatch generation
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    ctx.mainActorReturnAs = actor.declarationReturn.typeName;
  }

  // Generate child actor code
  const childActorSection = genChildActorCode(ctx, allActors);

  // Generate all function dispatch clauses (public + private via self-send)
  const allClauses = genDispatch(ctx, [...publicFns, ...privateFns]);

  // Generate lambda handler clauses (registered during codegen above)
  // Use index loop since nested lambdas may add new handlers during iteration
  // Phase 1: generate all handler bodies (may register nested handlers)
  const lambdaEntries = []; // { name, inner, params }
  for (let li = 0; li < ctx.lambdaHandlers.length; li++) {
    const lh = ctx.lambdaHandlers[li];
    if (lh.fn.emptyOverload) continue;
    const inner = genLambdaHandlerInner(ctx, lh.name, lh.varName, lh.fn, lh.captures);
    lambdaEntries.push({ name: lh.name, inner, params: lh.fn.params || [] });
  }
  // Phase 2: group by label name for arity-based dispatch
  const lambdasByName = new Map();
  for (const entry of lambdaEntries) {
    if (!lambdasByName.has(entry.name)) lambdasByName.set(entry.name, []);
    lambdasByName.get(entry.name).push(entry);
  }
  for (const [lName, handlers] of lambdasByName) {
    if (handlers.length === 1) {
      allClauses.splice(allClauses.length - 1, 0,
        `handle_op(<<"${lName}">>, _Message, Payload, _Id, _From) ->\n${handlers[0].inner}`,
      );
    } else {
      // Multiple handlers with same label — arity-based dispatch
      const tryFns = handlers.map((h, i) => {
        const fnName = `lambda_${lName.replace(/^_lambda_/, '')}_ov${i}`;
        const posParams = h.params.filter(p => p.positional !== false);
        const posCount = posParams.length;
        const requiredPosCount = posParams.filter(p => !p.defaultValue).length;
        return { fnName, body: h.inner, posCount, requiredPosCount };
      });
      let chainExpr = '    {error, ' + erlString(lName) + '}';
      for (let i = tryFns.length - 1; i >= 0; i--) {
        const fn = tryFns[i];
        chainExpr = `    case ${fn.fnName}(Payload) of\n        nomatch ->\n    ${chainExpr};\n        Result -> Result\n    end`;
      }
      allClauses.splice(allClauses.length - 1, 0,
        `handle_op(<<"${lName}">>, _Message, Payload, _Id, _From) ->\n${chainExpr}`,
      );
      for (const fn of tryFns) {
        const arityGuardExpr = fn.requiredPosCount === fn.posCount
          ? `length(S_pos) =:= ${fn.posCount}`
          : `length(S_pos) >= ${fn.requiredPosCount} andalso length(S_pos) =< ${fn.posCount}`;
        const arityGuard = `    {S_pos, S_named} = structure_pack(Payload),\n    case ${arityGuardExpr} of\n        true ->\n${fn.body.split('\n').map(l => '        ' + l).join('\n')};\n        false ->\n            nomatch\n    end`;
        allClauses.splice(allClauses.length - 1, 0,
          `${fn.fnName}(Payload) ->\n${arityGuard}`,
        );
      }
    }
  }

  // Generate on-handler dispatch clauses
  for (const h of onHandlers) {
    const typeEnv = buildTypeEnv(h.params, h.body, ctx.typeDecls);
    const I = '    ';
    const lines = [];
    const restVars = new Set();
    const refVars = new Set();
    const childActorRefs = new Map();
    const sCtx = { restVars, refVars, childActorRefs, selfSpawnedRefs: new Set(), ssaEnv: buildSSAEnv(h.body) };
    const paramLines = genParamDestructure(h.params, I);
    lines.push(...paramLines);
    const localLines = genLocals(ctx, h.body, typeEnv, sCtx, I);
    lines.push(...localLines);
    const hasSilent = h.body.some(s => s.type === 'SilentTerminator');
    let replyBlock;
    if (!hasSilent) {
      const reply = h.body.find(s => s.type === 'Reply');
      if (reply) {
        const replyCtx = { ...sCtx, stmtIdx: h.body.length };
        replyBlock = `${I}Re = ${genReplyBody(ctx, reply.fields, typeEnv, replyCtx)},\n${I}{ok, Re, null}`;
      } else {
        replyBlock = `${I}{ok, null, null}`;
      }
    } else {
      replyBlock = `${I}{ok, null, null}`;
    }
    const innerBody = lines.length > 0 ? lines.join('\n') + '\n' + replyBlock : replyBlock;
    allClauses.splice(allClauses.length - 1, 0,
      `handle_op(${erlString(h.eventName)}, Message, Payload, _Id, <<"__emit">>) ->\n${innerBody}`,
    );
  }

  // Auto-generate accessor dispatch clauses for constructor params
  for (const p of constructorParams) {
    if (p.suppressAccessor) continue;
    if (p.key && !p.accessor) continue;
    const accessorName = p.accessor || p.name;
    const stateKey = erlStateKey(ctx, p.name);
    allClauses.splice(allClauses.length - 1, 0,
      `handle_op(${erlString('@' + accessorName)}, _Message, _Payload, _Id, _From) ->\n    {ok, #{${erlString(accessorName)} => get(${stateKey})}, null}`,
    );
  }

  // Generate private function defs — skip overloaded private functions
  // (they're already handled by dispatch helper functions like priv_X_0, priv_X_1)
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
  const fnDefs = hasFns ? privateFns.filter(f => !overloadedPrivNames.has(f.name) && !f.emptyOverload).map(f => genFn(ctx, f)) : [];

  // Generate state initialization lines (run at startup before read_loop)
  const stateInitLines = [];
  for (const v of stateVarDecls) {
    if (v.isRef && actor.initBody) {
      const initStmt = actor.initBody.find(s => s.name === v.name);
      if (initStmt) {
        if (ctx.remoteInstanceVars.has(v.name)) {
          // Remote construction: send `new`, read reply, extract from
          const calleeName = initStmt.value.callee.name;
          // Constructor coercions resolve to the underlying dep name for `new`
          const callee = ctx.constructorCoercions.get(calleeName) || calleeName;
          const positionalArgs = initStmt.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedBag = initStmt.value.args.find(a => a.type === 'NamedArgsBag');
          let argsExpr;
          if (positionalArgs.length === 0 && !namedBag) {
            argsExpr = '#{}';
          } else if (namedBag) {
            const fields = Object.entries(namedBag.fields).map(([k, v]) => `${erlString(k)} => ${genExpr(ctx, v, new Map(), {})}`).join(', ');
            if (positionalArgs.length > 0) {
              argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}, #{${fields}}]`;
            } else {
              argsExpr = `#{${fields}}`;
            }
          } else {
            argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}]`;
          }
          stateInitLines.push(`    New_seq_${v.name} = case get(send_seq_) of undefined -> 1; New_n_${v.name} -> New_n_${v.name} end`);
          stateInitLines.push(`    put(send_seq_, New_seq_${v.name} + 1)`);
          stateInitLines.push(`    New_id_${v.name} = integer_to_binary(New_seq_${v.name})`);
          stateInitLines.push(`    New_msg_${v.name} = #{<<"id">> => New_id_${v.name}, <<"op">> => [${argsExpr}, <<"#new">>], <<"to">> => ${erlString(callee)}}`);
          stateInitLines.push(`    io:put_chars([json_encode(New_msg_${v.name}), $\\n])`);
          stateInitLines.push(`    put(pending_new_${v.name}, New_id_${v.name})`);
          stateInitLines.push(`    put(${erlStateKey(ctx, v.name)}, null)`);
        } else if (initStmt.value?.type === 'FunctionCallExpr' && ctx.actorInfo.has(initStmt.value.callee?.name)) {
          // Local child actor construction — call child init function
          const childName = initStmt.value.callee.name.toLowerCase();
          const positionalArgs = initStmt.value.args.filter(a => a.type !== 'NamedArgsBag');
          const argsExpr = positionalArgs.length > 0
            ? `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}]`
            : '[]';
          stateInitLines.push(`    child_${childName}_init(${argsExpr})`);
        } else {
          const val = genExpr(ctx, initStmt.value, new Map(), {});
          stateInitLines.push(`    put(${erlStateKey(ctx, v.name)}, ${val})`);
        }
      }
    }
  }
  // Non-ref state vars (e.g. public constants, module-level child actors).
  for (const v of stateVarDecls) {
    if (v.isRef || !actor.initBody) continue;
    const initStmt = actor.initBody.find(s => s.name === v.name);
    if (!initStmt || !initStmt.value) continue;
    // Child actor construction at module scope: c = C() — dispatch through
    // child_<c>_init; there's no bare Erlang `C()` function.
    const val = initStmt.value;
    if (val.type === 'FunctionCallExpr' && val.callee?.type === 'Identifier' && ctx.actorInfo?.has(val.callee.name)) {
      const childName = val.callee.name.toLowerCase();
      const positionalArgs = val.args.filter(a => a.type !== 'NamedArgsBag');
      const argsExpr = positionalArgs.length > 0
        ? `[${positionalArgs.map(a => genExpr(ctx, a, new Map(), {})).join(', ')}]`
        : '[]';
      stateInitLines.push(`    child_${childName}_init(${argsExpr})`);
      continue;
    }
    const valExpr = genExpr(ctx, val, new Map(), {});
    stateInitLines.push(`    put(${erlStateKey(ctx, v.name)}, ${valExpr})`);
  }
  for (const p of constructorParams) {
    stateInitLines.push(`    put(${erlStateKey(ctx, p.name)}, null)`);
  }
  // File-level scalar params: override nulls from constructor args (JSON array,
  // indexed by initParams declaration order). Missing indices keep the null.
  // argsApplyLines: applies args from an Erlang list variable CtorArgs_
  const argsApplyLines = [];
  if (constructorParams.length > 0) {
    const putLines = constructorParams.map((p, i) =>
      `            (case length(CtorArgs_) > ${i} of true -> put(${erlStateKey(ctx, p.name)}, lists:nth(${i + 1}, CtorArgs_)); false -> ok end)`,
    ).join(',\n');
    // For main/0: read from BREVITY_ARGS env var (backwards compat)
    stateInitLines.push(`    case os:getenv("BREVITY_ARGS") of
        false -> ok;
        CtorArgsStr_ ->
            CtorArgs_ = json_decode(list_to_binary(CtorArgsStr_)),
${putLines},
            ok
    end`);
    // For start/1: apply args directly from parameter
    argsApplyLines.push(`    case StartArgs_ of
        [] -> ok;
        CtorArgs_ ->
${putLines},
            ok
    end`);
  }

  // Memoized return-as value for main actor
  if (actor.declarationReturn && actor.declarationReturn.typeName) {
    const raTypeEnv = new Map([
      ...stateVarDecls.map(v => [v.name, v.typeName]),
      ...constructorParams.map(p => [p.name, p.type || 'Anything']),
    ]);
    const val = genExpr(ctx, actor.declarationReturn.expr, raTypeEnv, {});
    stateInitLines.push(`    put(${erlStateKey(ctx, '__returnAs')}, ${val})`);
  }

  // Capture function — serializes actor state
  const captureFields = allStateNames.map(n => `${erlString(n)} => get(${erlStateKey(ctx, n)})`).join(', ');
  const captureFn = `capture() ->
    #{${captureFields}}.`;

  // Hydrate function — restores actor state from captured data
  const hydrateLines = allStateNames.map(n =>
    `    case maps:find(${erlString(n)}, State) of {ok, V_${erlVarName(n)}} -> put(${erlStateKey(ctx, n)}, V_${erlVarName(n)}); error -> ok end`,
  );
  const hydrateFn = allStateNames.length > 0
    ? `hydrate(State) ->\n${hydrateLines.join(',\n')}.`
    : `hydrate(_State) ->\n    ok.`;

  // Test harness function — get/set/update/op
  const stateTypeMap = new Map([
    ...stateVarDecls.map(v => [v.name, v.typeName]),
    ...constructorParams.map(p => [p.name, p.type || 'Anything']),
  ]);
  const testGetClauses = allStateNames.map(n =>
    `        ${erlString(n)} -> get(${erlStateKey(ctx, n)})`,
  ).join(';\n');
  const testTypeClauses = allStateNames.map(n =>
    `        ${erlString(n)} -> ${erlString(stateTypeMap.get(n) || 'Anything')}`,
  ).join(';\n');
  // Build target routing for child actor refs
  const childRefRoutes = [];
  function buildChildRoutes(initBody, actors, pathPrefix, depth) {
    if (depth > 3) return;
    for (const s of initBody) {
      if (s.type !== 'StateAssign' || !s.value?.type === 'FunctionCallExpr') continue;
      const calleeName = s.value?.callee?.name;
      if (!calleeName) continue;
      const childActor = actors.find(a => a.name === calleeName);
      if (!childActor) continue;
      const prefix = calleeName.toLowerCase();
      const path = pathPrefix ? `${pathPrefix}.${s.name}` : s.name;
      const childStateVars = (childActor.stateVarDecls || []).filter(v => v.isRef);
      const childTypes = new Map(childStateVars.map(v => [v.name, v.typeName]));
      childRefRoutes.push({ path, prefix, stateVars: childStateVars, typeMap: childTypes });
      // Recurse into child actor's initBody for nested targets
      if (childActor.initBody) buildChildRoutes(childActor.initBody, actors, path, depth + 1);
    }
  }
  buildChildRoutes(initBody, allActors, '', 0);

  let targetRouting = '';
  if (childRefRoutes.length > 0) {
    const targetClauses = childRefRoutes.map(r => {
      const getClauses = r.stateVars.map(v => {
        const childCtx = { ...ctx, childStatePrefix: r.prefix };
        return `                            ${erlString(v.name)} -> get(${erlStateKey(childCtx, v.name)})`;
      }).join(';\n');
      const typeClauses = r.stateVars.map(v =>
        `                            ${erlString(v.name)} -> ${erlString(v.typeName || 'Anything')}`,
      ).join(';\n');
      return `            ${erlString(r.path)} ->
                case maps:find(<<"get">>, Test) of
                    {ok, TName} ->
                        TVal = case TName of
${getClauses};
                            _ -> null
                        end,
                        TType = case TName of
${typeClauses};
                            _ -> null
                        end,
                        TResp0 = #{<<"id">> => Id, <<"re">> => TVal, <<"to">> => From},
                        TResp = case TType of null -> TResp0; _ -> TResp0#{<<"bv-a">> => TType} end,
                        io:put_chars([json_encode(TResp), $\n]);
                    error ->
                        case maps:find(<<"set">>, Test) of
                            {ok, TSV} ->
                                TP = case TSV of L when is_list(L) -> L; M when is_map(M) -> M; _ -> [TSV] end,
                                child_${r.prefix}_handle_op(<<"set">>, #{}, TP, Id, <<"__test">>),
                                ok;
                            error -> ok
                        end
                end`;
    }).join(';\n');
    targetRouting = `    case maps:find(<<"target">>, Test) of
        {ok, Target} ->
            case Target of
${targetClauses};
                _ -> ok
            end;
        error ->\n`;
  }

  const targetRoutingEnd = childRefRoutes.length > 0 ? '\n    end' : '';
  const testFn = `handle_test(Test, Message) ->
    Id = maps:get(<<"id">>, Message, <<>>),
    From = maps:get(<<"from">>, Message, <<>>),
${targetRouting}    case maps:find(<<"get">>, Test) of
        {ok, Name} ->
            RawVal = case Name of
${testGetClauses || '                _ -> null'};
                _ -> null
            end,
            Val = RawVal,
            BvType = case Name of
${testTypeClauses || '                _ -> null'};
                _ -> null
            end,
            Resp0 = #{<<"id">> => Id, <<"re">> => Val, <<"to">> => From},
            Resp = case BvType of null -> Resp0; _ -> Resp0#{<<"bv-a">> => BvType} end,
            io:put_chars([json_encode(Resp), $\n]);
        error ->
    case maps:find(<<"set">>, Test) of
        {ok, SetVal} ->
            SetPayload = case SetVal of
                L when is_list(L) -> L;
                M when is_map(M) -> M;
                _ -> [SetVal]
            end,
            handle_op(<<"set">>, #{}, SetPayload, Id, <<"__test">>),
            ok;
        error ->
    case maps:find(<<"update">>, Test) of
        {ok, UpdVal} ->
            UpdPayload = case is_list(UpdVal) of true -> UpdVal; false -> case is_map(UpdVal) of true -> UpdVal; false -> [UpdVal] end end,
            handle_op(<<"update">>, #{}, UpdPayload, Id, <<"__test">>),
            ok;
        error ->
    case maps:find(<<"op">>, Test) of
        {ok, Op} ->
            {OpName, Payload} = case Op of
                S when is_binary(S) -> {S, #{}};
                L when is_list(L) -> {lists:last(L), if length(L) > 1 -> hd(L); true -> #{} end}
            end,
            Result3 = handle_op(OpName, #{}, Payload, Id, <<"__test">>),
            handle_result(Result3, Id, From, OpName);
        error -> ok
    end end end end${targetRoutingEnd}.`;

  // Op dispatch function
  const opDispatchName = 'dispatch';

  const dispatchInner = `    HasPayload = case Payload of
        M when is_map(M), map_size(M) > 0 -> true;
        Lst when is_list(Lst), length(Lst) > 0 -> true;
        _ -> false
    end,
    case HasPayload andalso not maps:is_key(<<"bv-a">>, Message) of
        true ->
            Ex = #{OpName => <<"schema_required">>},
            Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},
            io:put_chars([json_encode(Resp), $\n]);
        false ->
            Payload2 = bv_unwire_payload(Message, Payload),
            Result = handle_op(OpName, Message, Payload2, Id, From),
            handle_result(Result, Id, From, OpName)
    end`;

  const dispatchBody = `${opDispatchName}(Message) ->
    Id = maps:get(<<"id">>, Message, <<>>),
    From = maps:get(<<"from">>, Message, <<>>),
    OpVal = maps:get(<<"op">>, Message, null),
    {OpName0, Payload} = case OpVal of
        S when is_binary(S) -> {S, #{}};
        L when is_list(L) ->
            OpN = lists:last(L),
            P = if length(L) > 1 -> hd(L); true -> #{} end,
            {OpN, P};
        _ -> {<<"">>, #{}}
    end,
    %% Wire-to-internal normalization: strip '#' from system ops, then
    %% "@subscribe"/"set" carry their selector in the to-field.
    OpName0_s = case OpName0 of
        <<"#new">> -> <<"new">>;
        <<"#set">> -> <<"set">>;
        <<"#update">> -> <<"update">>;
        <<"#call">> -> <<"call">>;
        _ -> OpName0
    end,
    OpName = case OpName0_s of
        <<"@subscribe">> ->
            case extract_to_selector_(maps:get(<<"to">>, Message, null)) of
                nomatch -> OpName0_s;
                Sel_ -> <<"subscribe", Sel_/binary>>
            end;
        <<"set">> ->
            case extract_to_selector_(maps:get(<<"to">>, Message, null)) of
                nomatch -> OpName0_s;
                Sel_ -> <<"set", Sel_/binary>>
            end;
        _ -> OpName0_s
    end,
${dispatchInner}.

handle_result({ok, Re, BvaRe}, Id, From, _OpName) when Re =/= null ->
    Resp0 = #{<<"id">> => Id, <<"re">> => Re, <<"to">> => From},
    Resp = case BvaRe of
        null -> Resp0;
        _ -> Resp0#{<<"bv-a">> => BvaRe}
    end,
    io:put_chars([json_encode(Resp), $\n]);
handle_result({ok, null, _}, _Id, _From, _OpName) ->
    ok;
handle_result({error, UnhandledOp}, Id, From, _OpName) ->
    Ex = #{UnhandledOp => <<"unhandled">>},
    Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},
    io:put_chars([json_encode(Resp), $\n]);
handle_result(_, _Id, _From, _OpName) ->
    ok.`;

  let dispatchFinal;
  {
    dispatchFinal = dispatchBody.replace(
      '            Payload2 = bv_unwire_payload(Message, Payload),\n            Result = handle_op(OpName, Message, Payload2, Id, From),\n            handle_result(Result, Id, From, OpName)',
      '            Payload2 = bv_unwire_payload(Message, Payload),\n            Result = try handle_op(OpName, Message, Payload2, Id, From)\n            catch _:_ ->\n                {caught_error, OpName}\n            end,\n            handle_result(Result, Id, From, OpName)',
    ).replace(
      'handle_result(_, _Id, _From, _OpName) ->\n    ok.',
      'handle_result({caught_error, Op}, Id, From, _OpName) ->\n    Ex = #{Op => <<"error">>},\n    Resp = #{<<"id">> => Id, <<"ex">> => Ex, <<"to">> => From},\n    io:put_chars([json_encode(Resp), $\n]);\nhandle_result(_, _Id, _From, _OpName) ->\n    ok.',
    );
  }

  const statefulDispatch = '';

  // Generate and add on-handler subscription init lines
  const onInitLines = onHandlers.map(h => {
    return `    subscribe_(${erlString(h.eventName)}, fun(_EvName, _EvPayload) -> handle_op(_EvName, #{}, _EvPayload, <<"0">>, <<"__emit">>) end)`;
  });
  stateInitLines.push(...onInitLines);
  const stateInitSection = stateInitLines.length > 0
    ? stateInitLines.join(',\n') + ',\n'
    : '';
  // Build start/1 init section: same as stateInitSection but with direct args
  // Replace the BREVITY_ARGS block in-place (preserving ordering with returnAs etc.)
  const startInitLines = stateInitLines.map(l =>
    l.includes('os:getenv') && argsApplyLines.length > 0 ? argsApplyLines.join(',\n') : l,
  ).filter(l => !(l.includes('os:getenv') && argsApplyLines.length === 0));
  const startInitSection = startInitLines.length > 0
    ? startInitLines.join(',\n') + ',\n'
    : '';
  // Generate `new` reply handling for remote instance vars
  const allNewVars = new Set(ctx.remoteInstanceVars);
  // Persistent subscribe continuations: when a `re` arrives whose id is
  // registered under {pending_subscribe, Id}, invoke the stored fun with the
  // reply value and LEAVE the entry in the dict (unlike new-replies which are
  // one-shot).
  const subscribeReplyCheck = `case get({pending_subscribe, Re_msg_id_}) of
                                Sub_fun_ when is_function(Sub_fun_) -> Sub_fun_(maps:get(<<"re">>, Message, null));
                                _ -> ok
                            end`;
  let newReplyHandler = `{ok, _} ->\n                            Re_msg_id_ = maps:get(<<"id">>, Message, <<>>),\n                            ${subscribeReplyCheck}`;
  if (allNewVars.size > 0) {
    const checks = [...allNewVars].map(name => {
      return `case get(pending_new_${name}) of
                                ReplyId_${name} when ReplyId_${name} =:= Re_msg_id_ ->
                                    put(${erlStateKey(ctx, name)}, case maps:get(<<"re">>, Message, null) of
                                        <<"#<", AddrRest_${name}/binary>> ->
                                            AddrLen_${name} = byte_size(AddrRest_${name}) - 1,
                                            <<AddrVal_${name}:AddrLen_${name}/binary, ">">> = AddrRest_${name},
                                            AddrVal_${name};
                                        _ -> maps:get(<<"from">>, Message, null)
                                    end),
                                    erase(pending_new_${name});
                                _ -> ok
                            end`;
    });
    newReplyHandler = `{ok, _} ->\n                            Re_msg_id_ = maps:get(<<"id">>, Message, <<>>),\n                            ${subscribeReplyCheck},\n                            ${checks.join(',\n                            ')}`;
  }
  const mainLoop = `start(StartArgs_) ->
${startInitSection}    read_loop().

main() ->
${stateInitSection}    read_loop().

%% Internal entry for Self()-spawned actors. Initializes state from Erlang
%% args (no env-var path), then enters a direct Erlang-message loop.
start_internal(StartArgs_) ->
${startInitSection}    bv_loop().

bv_loop() ->
    receive
        {bv_dispatch, From_, Op_, Payload_, Id_} ->
            Result_ = handle_op(Op_, #{<<"op">> => Op_}, Payload_, Id_, <<"__bv_internal">>),
            case Result_ of
                {ok, Re_, _Bva_} -> From_ ! {bv_reply, Id_, Re_};
                _ -> From_ ! {bv_error, Id_}
            end,
            bv_loop();
        bv_stop -> ok
    end.

read_loop() ->
    case io:get_line("") of
        eof -> ok;
        {error, _} -> ok;
        Line ->
            Bin = unicode:characters_to_binary(string:trim(Line)),
            case Bin of
                <<>> -> read_loop();
                _ ->
                    Message = json_decode(Bin),
                    case maps:find(<<"re">>, Message) of
                        ${newReplyHandler};
                        error ->
                        case maps:find(<<"ex">>, Message) of
                            {ok, _ExVal} ->
                                ${allNewVars.size > 0
      ? `Ex_msg_id_ = maps:get(<<"id">>, Message, <<>>),\n                                ${[...allNewVars].map(name =>
          `case get(pending_new_${name}) of Ex_msg_id_ -> erase(pending_new_${name}); _ -> ok end`,
        ).join(',\n                                ')},\n                                ok`
      : 'ok'};
                            error ->
                            case maps:get(<<"cam">>, Message, null) of
                                <<"capture">> ->
                                    Id = maps:get(<<"id">>, Message, <<>>),
                                    From = maps:get(<<"from">>, Message, <<>>),
                                    Resp = #{<<"id">> => Id, <<"re">> => capture(), <<"to">> => From},
                                    io:put_chars([json_encode(Resp), $\n]);
                                CamList when is_list(CamList) ->
                                    case lists:last(CamList) of
                                        <<"hydrate">> ->
                                            Id = maps:get(<<"id">>, Message, <<>>),
                                            From = maps:get(<<"from">>, Message, <<>>),
                                            State = hd(CamList),
                                            hydrate(State),
                                            Resp = #{<<"id">> => Id, <<"re">> => <<"hydrate">>, <<"to">> => From},
                                            io:put_chars([json_encode(Resp), $\n]);
                                        _ -> dispatch(Message)
                                    end;
                                _ ->
                            case maps:get(<<"test">>, Message, null) of
                                null -> dispatch(Message);
                                Test -> handle_test(Test, Message)
                            end
                            end
                        end
                    end,
                    read_loop()
            end
    end.`;

  const fnSection = fnDefs.length > 0 ? '\n' + fnDefs.join('\n\n') + '\n' : '';

  // Separate handle_op clauses from pub_*/priv_* helper functions
  const handleOpClauses = [];
  const helperFns = [];
  for (const c of allClauses) {
    if (c.startsWith('handle_op(')) {
      handleOpClauses.push(c);
    } else {
      helperFns.push(c);
    }
  }

  const helperSection = helperFns.length > 0 ? '\n' + helperFns.map(f => f + '.').join('\n\n') + '\n' : '';

  // self_send helper — routes through dispatch, returns Structure
  const needsSelfSend = privateFns.length > 0 || ctx.lambdaHandlers.length > 0 || ctx.publicFnNames.size > 0;
  const selfSendFn = needsSelfSend ? `
self_send(OpName, Payload) ->
    {ok, Re, _Bva} = handle_op(OpName, #{}, Payload, <<"0">>, <<"__self">>),
    structure_pack(Re).
` : '';

  const hasEmits = emitDecls.size > 0 || allActors.some(a => (a.constructorBody || []).some(s => s.type === 'EmitDecl')) || allActors.some(a => a.functions.some(f => f.type === 'OnHandler'));
  const emitFns = hasEmits ? `
subscribe_(Event, Callback) ->
    Subs = case get({emit_subs, Event}) of undefined -> []; S -> S end,
    put({emit_subs, Event}, [Callback|Subs]).

emit_(Event, Payload) ->
    Subs = case get({emit_subs, Event}) of undefined -> []; S -> S end,
    lists:foreach(fun(Cb) -> Cb(Event, Payload) end, Subs),
    null.

emit_await_(Event, Payload) ->
    Subs = case get({emit_subs, Event}) of undefined -> []; S -> S end,
    case Subs of
        [] -> null;
        [Cb|_] ->
            {ok, Re, _Bva} = Cb(Event, Payload),
            structure_pack(Re)
    end.
` : '';


  // Slice 12+13: per-program shape registry. `bv_type_fields/1` returns the
  // declared field list for a given type so `bv_unwire_payload/2` can walk
  // bv-a annotations and reconstruct ::Name-tagged values from wire form.
  const typeArms = (ctx.typeDecls ? [...ctx.typeDecls.values()] : []).map(t => {
    const fields = (t.fields || []).map(f => erlString(f.name)).join(', ');
    return `bv_type_fields(${erlString(t.name)}) -> [${fields}];`;
  }).join('\n');
  const bvTypeFieldsBlock = `${typeArms}\nbv_type_fields(_) -> undefined.\n\n` +
`bv_unwire_payload(Message, Payload) ->
    case maps:find(<<"bv-a">>, Message) of
        {ok, [Types | _]} when is_map(Types) andalso is_map(Payload) ->
            maps:fold(fun
                (K, <<"::", Name/binary>>, Acc) ->
                    case bv_type_fields(Name) of
                        undefined -> Acc;
                        Fields ->
                            case maps:find(K, Acc) of
                                {ok, V} -> Acc#{K => bv_from_wire(<<"::", Name/binary>>, V, Fields)};
                                _ -> Acc
                            end
                    end;
                (_K, _Tag, Acc) -> Acc
            end, Payload, Types);
        {ok, [Types | _]} when is_list(Types) andalso is_list(Payload) ->
            lists:zipwith(fun
                (<<"::", Name/binary>>, V) ->
                    case bv_type_fields(Name) of
                        undefined -> V;
                        Fields -> bv_from_wire(<<"::", Name/binary>>, V, Fields)
                    end;
                (_Tag, V) -> V
            end, lists:sublist(Types, length(Payload)), lists:sublist(Payload, length(Types)));
        _ -> Payload
    end.

`;

  const moduleName = options.moduleName || 'brevity_actor';
  const exportList = ['main/0', 'start/1', 'start_internal/1'];
  for (const [n, info] of ctx.actorInfo) {
    if (classNeedsSpawnedInstancesProgram(info.actor || info)) {
      exportList.push(`start_internal_${n.toLowerCase()}/1`);
    }
  }
  return `-module(${moduleName}).
-export([${exportList.join(', ')}]).
${PREAMBLE}
${bvTypeFieldsBlock}
${fnSection}${childActorSection}${helperSection}
${handleOpClauses.join(';\n')}.

${selfSendFn}${emitFns}
${captureFn}

${hydrateFn}

${testFn}

${statefulDispatch}${dispatchFinal}

${mainLoop}
`;
}

function createErlContext() {
  return {
    actorInfo: new Map(),           // name -> { asClauses: [] }
    actorFnNames: new Set(),
    publicFnNames: new Set(),       // public function names (with @ prefix) for bare-name self-send
    constructorOverloads: new Map(), // baseName → [{ mangledName, params }]
    stateVarNames: new Set(),
    dependencyNames: new Set(),
    remoteInstanceVars: new Set(),
    // Per-handler-body locals bound to dep constructor calls (set inside
    // genStatements; reset on each handler body so it doesn't leak).
    localInstanceVars: new Set(),
    sendCounter: 0,
    ephCounter: 0,
    lambdaCounter: 0,
    lambdaHandlers: [],             // { name, varName, fn, captures }
    lambdaVarNames: new Set(),      // variable names holding lambda label binaries
    lambdaCaptureKeys: [],          // process dictionary keys for captures
    currentTypeEnv: null,           // set during handler codegen for function-typed param detection
    stateVarTypeEnv: new Map(),     // state var name → type, for function-typed detection
    emitNames: new Map(),           // emit declarations: name → EmitDecl
    childStatePrefix: '',           // set during child actor codegen for state key namespacing
    childConstructorParams: null,   // set of constructor param names (shared with parent, not prefixed)
    fnWhileCounter: 0,
    fnScopeCounter: 0,
    ifScopeCounter: 0,
    whileCounter: 0,
    // Active catch labels — outermost first. Each entry:
    //   { brevityName: '#label', tag: '__brevity_catch_<name>_<n>__' }
    // Throws bubble through nested try/catch via tag matching.
    catchLabelStack: [],
    catchLabelCounter: 0,
  };
}

export function codegenErlang(ast, options = {}) {
  const _hasPublicOrOn = a => a.functions.some(f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update')) || a.functions.some(f => f.type === 'OnHandler') || (a.declarationReturn && a.declarationReturn.typeName);
  const active = ast.actors.filter(_hasPublicOrOn);
  if (active.length === 0) return '';

  const ctx = createErlContext();

  // Wire late bindings for circular dependencies
  ctx.genExpr = genExpr;
  ctx.genLocals = genLocals;

  // Set up child actor info
  ctx.actorInfo = new Map();
  ctx.ephCounter = 0;
  ctx.actorNodes = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  ctx.typeDecls = new Map((ast.types || []).map(t => [t.name, t]));
  // Slice 15: imported types — register under both local and canonical names
  // so bv_type_fields/1 and TypeConstruction emit resolve through either
  // side of an `(Point: P)` rename. The validate pass already rewrites the
  // callee identifier to the canonical remote name.
  for (const [local, info] of Object.entries(ast.importedTypes || {})) {
    if (!ctx.typeDecls.has(local)) ctx.typeDecls.set(local, { name: info.remote, fields: info.decl.fields });
    if (!ctx.typeDecls.has(info.remote)) ctx.typeDecls.set(info.remote, { name: info.remote, fields: info.decl.fields });
  }

  // Include actors that inherit public functions from superclasses even if they have none of their own
  const activeNames = new Set(active.map(a => a.name).filter(Boolean));
  for (const a of ast.actors) {
    if (a.name && !activeNames.has(a.name) && (a.supertypes || []).length > 0) {
      // Check if any superclass (transitively) has public functions
      const hasInheritedPublic = (function check(actor) {
        for (const st of (actor.supertypes || [])) {
          const sup = ctx.actorNodes.get(st.supertype);
          if (!sup) continue;
          if (sup.functions.some(f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update'))) return true;
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

  for (const a of active) {
    if (a.name) {
      const asClauses = [...(a.asClauses || [])];
      if (a.declarationReturn && a.declarationReturn.typeName) {
        asClauses.push({ targetType: a.declarationReturn.typeName, negated: false, expr: a.declarationReturn.expr, memoized: true });
      }
      ctx.actorInfo.set(a.name, { actor: a, asClauses });
    }
  }

  ctx.dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  ctx.destructuredMembers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (d.destructures) {
      for (const entry of d.destructures) {
        ctx.destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
        ctx.dependencyNames.add(entry.local);
      }
    }
  }
  const mainActor = active.find(a => !a.name) || active[0];
  ctx.asClauses = mainActor.asClauses || [];
  const _isPrivate = f => f.name && !f.name.startsWith('@') && f.name !== 'set' && f.name !== 'update';
  const _isPublicFn = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update');
  ctx.actorFnNames = new Set(mainActor.functions.filter(_isPrivate).map(f => f.name));
  ctx.publicFnNames = new Set(mainActor.functions.filter(f => _isPublicFn(f) && !f.actorDef).map(f => f.name));
  for (const a of active) {
    a.functions.filter(_isPrivate).forEach(f => ctx.actorFnNames.add(f.name));
    a.functions.filter(f => _isPublicFn(f) && !f.actorDef).forEach(f => ctx.publicFnNames.add(f.name));
  }

  // ── Constructor overloads: promote actorDef FunctionDecls to synthetic actors ──
  ctx.constructorOverloads = new Map(); // baseName → [{ mangledName, params }]
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
      if (!ctx.constructorOverloads.has(baseName)) ctx.constructorOverloads.set(baseName, []);
      const overloads = ctx.constructorOverloads.get(baseName);
      for (let i = 0; i < fns.length; i++) {
        const fn = fns[i];
        if (!hasPrimaryActor && i === 0) {
          // No primary Actor exists (Function() initializer) — first clause becomes the primary
          const synActor = AST.actor(baseName, { ...fn.actorDef });
          active.push(synActor);
          existingActorNames.add(baseName);
          ctx.actorInfo.set(baseName, { actor: synActor, asClauses: synActor.asClauses || [] });
          ctx.actorNodes.set(baseName, synActor);
        } else {
          const mangledName = `${baseName}_ov${overloads.length}`;
          overloads.push({ mangledName, params: fn.actorDef.params || fn.params || [] });
          const synActor = AST.actor(mangledName, { ...fn.actorDef });
          active.push(synActor);
          existingActorNames.add(mangledName);
          ctx.actorInfo.set(mangledName, { actor: synActor, asClauses: synActor.asClauses || [] });
          ctx.actorNodes.set(mangledName, synActor);
        }
      }
    }
  }

  return genProgram(ctx, mainActor, active, options);
}

export {
  createErlContext,
  genProgram,
  genPublicFn,
  genPublicFnInner,
  genFn,
  genDispatch,
  genCamInit,
  genChildInit,
  genChildHandleOp,
  genChildActorCode,
  genLambdaHandlerInner,
};
