// ── Type inference, SSA, and lambda closure analysis for Erlang codegen ──────

import { erlStateKey } from './preambles.js';
import { inferExprType } from '../../inference.js';

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  if (expr.type === 'NullLiteral') return 'null';
  return null;
}

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.name && !p.rest) env.set(p.name, p.type || null);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeName);
    if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) env.set(item.name, item.type);
      }
      // Infer types from StructureConstructor args when pattern items lack types
      if (s.source?.type === 'StructureConstructor') {
        const posArgs = (s.source.args || []).filter(a => a.positional);
        const namedArgs = (s.source.args || []).filter(a => !a.positional);
        for (const item of s.pattern) {
          if (item.discard || !item.name || env.has(item.name)) continue;
          if (item.positional && posArgs[item.idx]?.type) {
            env.set(item.name, posArgs[item.idx].type);
          } else if (item.named) {
            const match = namedArgs.find(a => a.key === item.name);
            if (match?.type) env.set(item.name, match.type);
          }
        }
      }
    }
    if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (inferred) env.set(s.name, inferred);
    }
    if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) env.set(item.name, item.type);
      }
    }
    if (s.type === 'RefDecl' && s.typeName) env.set(s.name, s.typeName);
    if (s.type === 'BareTypeDecl' && s.typeName) env.set(s.name, s.typeName);
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
      // Skip overload <</>>/Function() — they don't create new variable bindings
      if (s.value?.type === 'Function' && (s.value.overloadMode === 'append' || s.value.overloadMode === 'prepend' || s.value.emptyOverload)) continue;
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

function exprType(expr, typeEnv, _ctx) {
  if (!expr) return null;
  if (expr.type === 'RefRead') return typeEnv.get(expr.name) || null;
  return inferExprType(expr, typeEnv);
}

// Collect free variables from a Function AST node (same logic as JS codegen)
function erlCollectFreeVars(ctx, funcNode) {
  const paramNames = new Set((funcNode.params || []).map(p => p.name).filter(Boolean));
  const ids = new Set();
  const localDefs = new Set();

  function walkExpr(expr) {
    if (!expr) return;
    if (expr.type === 'Identifier' || expr.type === 'FnRef' || expr.type === 'RefRead' || expr.type === 'RefArg') { ids.add(expr.name); return; }
    if (expr.type === 'BinaryExpr') { walkExpr(expr.left); walkExpr(expr.right); return; }
    if (expr.type === 'FunctionCallExpr') { walkExpr(expr.callee); expr.args.forEach(walkExpr); return; }
    if (expr.type === 'IndexExpr') { walkExpr(expr.object); return; }
    if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
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
          if (f.value) walkExpr(f.value);
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
    if (expr.type === 'RefRead' && !localRefs.has(expr.name) && !ctx.stateVarNames.has(expr.name)) return true;
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
    if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
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
        if (f.value && hasRefRead(f.value)) return true;
      }
    }
  }
  if (funcNode.expr && hasRefRead(funcNode.expr)) return true;
  return false;
}

// Register a Function node as a lambda dispatch handler, return its label expression
// NOTE: uses genExpr via late binding on ctx to avoid circular dependency
function erlGenLambdaArgLabel(ctx, funcNode, typeEnv, sCtx) {
  const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
  const freeVars = erlCollectFreeVars(ctx, funcNode).filter(v => !ctx.actorFnNames.has(v));
  const captures = freeVars.map(v => ({ name: v, lambdaName }));
  for (const v of freeVars) {
    ctx.lambdaCaptureKeys.push(`_cap_${lambdaName}_${v}`);
  }
  ctx.lambdaHandlers.push({ name: lambdaName, fn: funcNode, captures });
  // If there are captures, emit put() calls as side effects before returning the label
  if (freeVars.length > 0) {
    const stores = freeVars.map(v => {
      const src = ctx.stateVarNames.has(v) ? `get(${erlStateKey(ctx, v)})` : ctx.genExpr(ctx, { type: 'Identifier', name: v }, typeEnv, sCtx);
      return `put('_cap_${lambdaName}_${v}', ${src})`;
    }).join(', ');
    return `begin ${stores}, <<"${lambdaName}">> end`;
  }
  return `<<"${lambdaName}">>`;
}

export {
  inferLiteralType,
  buildTypeEnv,
  buildSSAEnv,
  resolveSSAName,
  getSSANameForAssignment,
  exprType,
  erlCollectFreeVars,
  erlLambdaUsesOuterRefs,
  erlGenLambdaArgLabel,
};
