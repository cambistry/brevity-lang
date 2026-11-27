import { nextLambdaNumber } from '../lambda_numbers.js';
import { exitsOuterLabel } from '../label_exits.js';
// ── Type inference, SSA, and lambda closure analysis for Erlang codegen ──────

import { erlStateKey, erlString, erlJson } from './preambles.js';
import { wireLabel, selfAddress } from '../wire_labels.js';
import { inferType } from '../../type_infer.js';
import { isDynamicTy, tyMembers, wireTypes } from '../ty_tags.js';
import { typeTag, typeText, envTypeOf } from '../enc_names.js';

// The Erlang generator reads encoded types (src/type_enc.js): a type env maps a
// name to its encoded type, and `typeDecls` keys a declared type by its address.

// Wire tag for a type-valued slot (src/codegen/enc_names.js, typeTag). Returns a
// plain JS string; the caller applies erlString.
const erlTypeTag = (ctx, t) => typeTag(ctx, t);

// The runtime tag of `valueExpr`, whose declared type `t` is a union or `Anything`.
function erlTyOf(ctx, t, valueExpr) {
  const members = tyMembers(t, u => erlTypeTag(ctx, u), ctx.typeDecls, u => typeText(u, ctx.depAliases))
    .map(([k, tag]) => `{${erlString(k)}, ${erlString(tag)}}`).join(', ');
  return `bv_ty_of(${valueExpr}, [${members}])`;
}

// A slot's tag: the declared type's when it is one, else the value's at runtime
// (`valueExpr`, or no tag when there is nothing safe to read).
function erlSlotTag(ctx, t, valueExpr) {
  if (!isDynamicTy(t)) { const tag = erlTypeTag(ctx, t); return tag ? erlJson(tag) : 'null'; }
  return valueExpr ? erlTyOf(ctx, t, valueExpr) : 'null';
}

// Wrap a value expression with `bv_to_wire` when its type is a type decl;
// null otherwise so the caller keeps the plain value.
function erlTypeWireWrap(ctx, valueExpr, t) {
  const types = wireTypes(t, ctx.typeDecls);
  if (types.length === 0) return null;
  const wire = (v, name) => {
    const decl = ctx.typeDecls.get(name);
    const fieldList = (decl.fields || []).map(fl => erlString(fl.name)).join(', ');
    return `bv_to_wire(${v}, [${fieldList}])`;
  };
  if (ctx.typeDecls.has(t)) return wire(valueExpr, t);
  // A union: the value's own `__type` says which type's fields to send.
  const arms = [...new Map(types.map(n => [ctx.typeDecls.get(n).key, n])).entries()].map(([k, n]) => `#{<<"__type">> := ${erlString(k)}} -> ${wire('W_', n)}`).join('; ');
  return `(fun(W_) -> case W_ of ${arms}; _ -> W_ end end)(${valueExpr})`;
}

// A literal's encoded type; undefined for anything else.
function inferLiteralType(expr) {
  switch (expr?.type) {
    case 'IntLiteral': return 'Integer';
    case 'StringLiteral': return 'Text';
    case 'FloatLiteral': return 'Float';
    case 'DecimalLiteral': return 'Decimal';
    case 'BoolLiteral': return 'Boolean';
    case 'NullLiteral': return null;
    case 'TypeConstruction': return expr.typeNameEnc;
    case 'PresenceCheck': return 'Boolean';
    default: return undefined;
  }
}

// A scope's names and their encoded types. A param with no type is in scope, untyped.
function buildTypeEnv(params, body, typeDecls = null) {
  const env = new Map();
  const known = (t) => t !== undefined;
  for (const p of params) {
    if (p.name && !p.rest) env.set(p.name, envTypeOf(p));
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeNameEnc);
    if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && known(item.typeEnc)) env.set(item.name, item.typeEnc);
      }
      // Typed-value source: propagate each field's declared type to the
      // destructured local.
      if (typeDecls) {
        const src = s.source;
        let srcType;
        if (src?.type === 'TypeConstruction') srcType = src.typeNameEnc;
        else if (src?.type === 'Identifier' && env.has(src.name)) srcType = env.get(src.name);
        const srcDecl = known(srcType) ? typeDecls.get(srcType) ?? null : null;
        if (srcDecl) {
          const fields = srcDecl.fields || [];
          for (const item of s.pattern) {
            if (item.discard || !item.name || env.has(item.name)) continue;
            let field;
            if (item.named) field = fields.find(f => f.name === item.name);
            else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
            else if (item.positional) field = fields[item.idx];
            // Skip propagation for optional fields — keep the local
            // polymorphic so `??` / `(expr)?` see absence.
            if (known(field?.paramTypeEnc) && !field.optional) env.set(item.name, field.paramTypeEnc);
          }
        }
      }
      // Infer types from ObjectConstructor args when pattern items lack types
      if (s.source?.type === 'ObjectConstructor') {
        const posArgs = (s.source.args || []).filter(a => a.positional);
        const namedArgs = (s.source.args || []).filter(a => !a.positional);
        for (const item of s.pattern) {
          if (item.discard || !item.name || env.has(item.name)) continue;
          if (item.positional && known(posArgs[item.idx]?.typeEnc)) {
            env.set(item.name, posArgs[item.idx].typeEnc);
          } else if (item.named) {
            const match = namedArgs.find(a => a.key === item.name);
            if (known(match?.typeEnc)) env.set(item.name, match.typeEnc);
          }
        }
      }
    }
    if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (known(inferred)) env.set(s.name, inferred);
    }
    if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && known(item.typeEnc)) env.set(item.name, item.typeEnc);
      }
    }
    if (s.type === 'RefDecl' && known(s.typeNameEnc)) env.set(s.name, s.typeNameEnc);
    if (s.type === 'BareTypeDecl' && known(s.typeNameEnc)) env.set(s.name, s.typeNameEnc);
  }
  return env;
}

// ── SSA name mangling ───────────────────────────────────────────────────────

function buildSSAEnv(body) {
  // Track how many times each variable is assigned; generate SSA names
  const counts = new Map();
  const assignments = []; // [{stmtIdx, name, ssaName}]

  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      // Skip overload <</Function() — they don't create new variable bindings
      if (s.value?.type === 'Function' && (s.value.overloadMode === 'append' || s.value.emptyOverload)) continue;
      const n = counts.get(s.name) || 0;
      const ssaName = `${s.name}__${n + 1}`;
      counts.set(s.name, n + 1);
      assignments.push({ stmtIdx: i, name: s.name, ssaName });
    }
    if (s.type === 'DestructureAssign' || s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard) continue;
        if (item.name) {
          const n = counts.get(item.name) || 0;
          const ssaName = `${item.name}__${n + 1}`;
          counts.set(item.name, n + 1);
          assignments.push({ stmtIdx: i, name: item.name, ssaName });
        }
      }
    }
  }

  return { counts, assignments };
}

// A branch's binds are its own. They get names no other branch uses, numbered
// from just past stmtIdx, where the branch sits, so reads inside the branch see
// them and reads outside don't. Binds later in the enclosing body aren't visible.
function branchSSAEnv(ctx, body, stmtIdx, ssaEnv) {
  const id = ctx.ifScopeCounter++;
  const own = buildSSAEnv(body).assignments.map(a => ({
    ...a,
    stmtIdx: stmtIdx + 1 + a.stmtIdx,
    ssaName: `${a.name}__b${id}_${a.ssaName.slice(a.name.length + 2)}`,
  }));
  const visible = (ssaEnv?.assignments ?? []).filter(a => a.stmtIdx <= stmtIdx);
  return { counts: ssaEnv?.counts ?? new Map(), assignments: [...visible, ...own] };
}

function resolveSSAName(name, stmtIdx, ssaEnv) {
  // Find the most recent SSA assignment for `name` before stmtIdx
  let best = name; // default: first assignment
  for (const a of ssaEnv.assignments) {
    if (a.name === name && a.stmtIdx <= stmtIdx) best = a.ssaName;
  }
  return best;
}

function getSSANameForAssignment(name, stmtIdx, ssaEnv) {
  for (const a of ssaEnv.assignments) {
    if (a.name === name && a.stmtIdx === stmtIdx) return a.ssaName;
  }
  return name;
}

// An expression's encoded type; undefined when unknown.
function exprType(expr, typeEnv, _ctx) {
  if (!expr) return undefined;
  if (expr.type === 'RefRead') return typeEnv.get(expr.name);
  return inferType(expr, typeEnv);
}

// Collect free variables from a Function AST node (same logic as JS codegen)
function erlCollectFreeVars(ctx, funcNode) {
  const paramNames = new Set((funcNode.params || []).map(p => p.name).filter(Boolean));
  const ids = new Set();
  const localDefs = new Set();

  function walkExpr(expr) {
    if (!expr) return;
    // A name of an enclosing actor (src/outer_reads.js) is a message to that actor,
    // not a binding the function captures.
    if ((expr.type === 'Identifier' || expr.type === 'RefRead') && expr.outer) return;
    if (expr.type === 'Identifier' || expr.type === 'FnRef' || expr.type === 'RefRead' || expr.type === 'RefArg') { ids.add(expr.name); return; }
    if (expr.type === 'BinaryExpr') { walkExpr(expr.left); walkExpr(expr.right); return; }
    if (expr.type === 'FunctionCallExpr') { if (!expr.outerFnCall) walkExpr(expr.callee); expr.args.forEach(walkExpr); return; }
    if (expr.type === 'IndexExpr') { walkExpr(expr.object); return; }
    if (expr.type === 'ObjectConstructor' || expr.type === 'ObjectLiteral') {
      expr.args.forEach(a => { if (a.expr) walkExpr(a.expr); });
      return;
    }
    if (expr.type === 'ListLiteral') { expr.elements.forEach(walkExpr); return; }
    if (expr.type === 'OverExpr') { walkExpr(expr.collection); walkExpr(expr.fn); return; }
    if (expr.type === 'ReduceExpr') { if (expr.initial) walkExpr(expr.initial); walkExpr(expr.collection); walkExpr(expr.fn); return; }
    if (expr.type === 'DotCallExpr') {
      expr.args.forEach(a => { if (a.name) ids.add(a.name); if (a.expr) walkExpr(a.expr); });
      return;
    }
    if (expr.type === 'NamedArgsBag') { Object.values(expr.fields).forEach(walkExpr); return; }
    if (expr.type === 'IfExpr') {
      walkExpr(expr.cond);
      if (expr.then) { if (expr.then.expr) walkExpr(expr.then.expr); if (expr.then.body) walkBody(expr.then.body); }
      if (expr.else) {
        if (expr.else.type === 'IfExpr') walkExpr(expr.else);
        else { if (expr.else.expr) walkExpr(expr.else.expr); if (expr.else.body) walkBody(expr.else.body); }
      }
      return;
    }
    if (expr.type === 'Function') {
      erlCollectFreeVars(ctx, expr).forEach(v => ids.add(v));
      return;
    }
  }

  function walkBody(body) {
    for (const s of body) {
      if (s.type === 'TypedAssign' || s.type === 'Assign') {
        walkExpr(s.value);
        localDefs.add(s.name);
      } else if (s.type === 'ImplicitReturn') {
        walkExpr(s.expr);
      } else if (s.type === 'Reply' || s.type === 'Return') {
        for (const f of s.fields) {
          if (f.value ?? f.expr) walkExpr(f.value ?? f.expr);
          if ('sigil' in f) ids.add(f.sigil);
        }
      } else if (s.type === 'DestructureAssign') {
        walkExpr(s.source);
        s.pattern.forEach(item => { if (!item.discard && item.name) localDefs.add(item.name); });
      } else if (s.type === 'ListDestructure') {
        walkExpr(s.source);
        s.pattern.forEach(item => { if (!item.discard && item.name) localDefs.add(item.name); });
      } else if (s.type === 'StateAssign') {
        walkExpr(s.value);
      } else if (s.type === 'SetStatement') {
        ids.add(s.name);
        walkExpr(s.value);
      } else if (s.type === 'WhileStatement') {
        walkExpr(s.cond);
        if (s.body) walkBody(s.body);
      } else if (s.type === 'RefDecl') {
        if (s.value) walkExpr(s.value);
        localDefs.add(s.name);
      }
    }
  }

  if (funcNode.expr) walkExpr(funcNode.expr);
  if (funcNode.body) walkBody(funcNode.body);
  return [...ids].filter(v => !paramNames.has(v) && !localDefs.has(v) && !ctx.actorFnNames.has(v) && !ctx.stateVarNames.has(v));
}

// Check if a lambda references outer refs — these can't be lifted to dispatch handlers
function erlLambdaUsesOuterRefs(ctx, funcNode) {
  // One that exits an enclosing `catch` runs inline, where its label is.
  if (exitsOuterLabel(funcNode)) return true;
  const body = funcNode.body || [];
  const localRefs = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') localRefs.add(s.name);
  }
  for (const s of body) {
    if (s.type === 'SetStatement' && !localRefs.has(s.name) && !ctx.stateVarNames.has(s.name)) {
      return true;
    }
    if (s.type === 'ActorSetStatement') {
      return true;
    }
  }
  function hasRefRead(expr) {
    if (!expr) return false;
    // An enclosing actor's cell (src/outer_reads.js) is read by message, not captured.
    if (expr.type === 'RefRead' && !expr.outer && !localRefs.has(expr.name) && !ctx.stateVarNames.has(expr.name)) return true;
    if (expr.type === 'RefArg') return true;
    if (expr.type === 'BinaryExpr') return hasRefRead(expr.left) || hasRefRead(expr.right);
    if (expr.type === 'FunctionCallExpr') {
      if (hasRefRead(expr.callee)) return true;
      return expr.args.some(a => hasRefRead(a));
    }
    if (expr.type === 'OverExpr') return hasRefRead(expr.collection) || hasRefRead(expr.fn);
    if (expr.type === 'ReduceExpr') return (expr.initial && hasRefRead(expr.initial)) || hasRefRead(expr.collection) || hasRefRead(expr.fn);
    if (expr.type === 'IfExpr') {
      if (hasRefRead(expr.cond)) return true;
      if (expr.then?.expr && hasRefRead(expr.then.expr)) return true;
      if (expr.else?.expr && hasRefRead(expr.else.expr)) return true;
      if (expr.else?.type === 'IfExpr' && hasRefRead(expr.else)) return true;
      return false;
    }
    if (expr.type === 'ObjectConstructor' || expr.type === 'ObjectLiteral') {
      return expr.args.some(a => a.expr && hasRefRead(a.expr));
    }
    if (expr.type === 'ListLiteral') return expr.elements.some(hasRefRead);
    if (expr.type === 'Function') return erlLambdaUsesOuterRefs(ctx, expr);
    return false;
  }
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      if (hasRefRead(s.value)) return true;
    }
    if (s.type === 'ImplicitReturn' && hasRefRead(s.expr)) return true;
    if (s.type === 'Reply' || s.type === 'Return') {
      for (const f of s.fields) {
        if (f.ref) return true;
        if (hasRefRead(f.value ?? f.expr)) return true;
      }
    }
  }
  if (funcNode.expr && hasRefRead(funcNode.expr)) return true;
  return false;
}

// Register a Function node as a lambda dispatch handler, return its label expression
// NOTE: uses genExpr via late binding on ctx to avoid circular dependency
// `wire: true` marks a lambda that flows into a type field or a cross-actor
// call argument and may be routed through CAM. It is encoded as a relative
// self-address `#<:@N>` (the host's perspective translation promotes it to
// `#<selfAddr:@N>` on the way out), and its dispatch arm is keyed by the `@N`
// selector. A non-wire lambda keeps its bare `_lambda_N` local dispatch key
// (used directly in self_send). The internal `_lambda_N` name is kept for
// capture keys regardless.
function erlGenLambdaArgLabel(ctx, funcNode, typeEnv, sCtx, { wire = false } = {}) {
  const n = nextLambdaNumber(ctx);
  const lambdaName = `_lambda_${n}`;
  const selector = wire ? `@${n}` : null;
  const freeVars = erlCollectFreeVars(ctx, funcNode).filter(v => !ctx.actorFnNames.has(v));
  const captures = freeVars.map(v => ({ name: v, lambdaName }));
  for (const v of freeVars) {
    ctx.lambdaCaptureKeys.push(`_cap_${lambdaName}_${v}`);
  }
  ctx.lambdaHandlers.push({ name: lambdaName, selector, fn: funcNode, captures });
  const labelValue = wire ? `#<${selfAddress(selector)}>` : wireLabel(lambdaName);
  // If there are captures, emit put() calls as side effects before returning the label
  if (freeVars.length > 0) {
    const stores = freeVars.map(v => {
      const src = ctx.stateVarNames.has(v) ? `get(${erlStateKey(ctx, v)})` : ctx.genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, sCtx);
      return `put('_cap_${lambdaName}_${v}', ${src})`;
    }).join(', ');
    return `begin ${stores}, <<"${labelValue}">> end`;
  }
  return `<<"${labelValue}">>`;
}

export {
  inferLiteralType,
  buildTypeEnv,
  buildSSAEnv,
  branchSSAEnv,
  resolveSSAName,
  getSSANameForAssignment,
  exprType,
  erlCollectFreeVars,
  erlLambdaUsesOuterRefs,
  erlGenLambdaArgLabel,
  erlTypeTag,
  erlTypeWireWrap,
  erlTyOf,
  erlSlotTag,
};
