// Shared semantic validation pass — runs between parse() and codegen.
// Every target (JS, Erlang, Rust) gets the same checks.

export function validate(ast) {
  // Build actor info map for cross-actor as-clause checking
  const actorInfo = new Map();
  for (const actor of ast.actors) {
    if (actor.name && actor.asClauses && actor.asClauses.length > 0) {
      actorInfo.set(actor.name, { asClauses: actor.asClauses });
    }
  }

  for (const actor of ast.actors) {
    validateActor(actor, actorInfo);
  }
}

// ── Actor-level checks ─────────────────────────────────────────────────────

function validateActor(actor, actorInfo) {
  checkNamespaceConflict(actor);
  checkSilentTopLevelUsage(actor);
  checkSilentFunctionUsage(actor);
  checkAsClauses(actor);

  for (const h of actor.handlers) {
    const outerNames = collectScopeNames(h.params, h.body);
    validateBody(h.body, outerNames, actorInfo);
  }
  for (const p of (actor.procs || [])) {
    const outerNames = collectScopeNames(p.params, p.body);
    validateBody(p.body, outerNames, actorInfo);
  }
}

function checkAsClauses(actor) {
  const clauses = actor.asClauses || [];
  if (clauses.length === 0) return;
  const seen = new Set();
  for (const c of clauses) {
    if (c.negated) continue;
    if (seen.has(c.targetType)) {
      throw new Error(`Duplicate 'as ${c.targetType}' clause in actor '${actor.name}'`);
    }
    seen.add(c.targetType);
  }
}

function checkAsClauseMatch(targetType, actorName, actorInfo) {
  const info = actorInfo.get(actorName);
  if (!info) return; // no as clauses — normal actor instantiation
  if (targetType === actorName) return; // identity — no cast needed
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return; // positive match
    if (clause.negated && clause.targetType !== targetType) return; // negated catch-all
  }
  throw new Error(`No matching 'as' clause in actor '${actorName}' for type '${targetType}'`);
}

function checkNamespaceConflict(actor) {
  const handlerOps = new Set(actor.handlers.map(h => h.op));
  for (const proc of (actor.procs || [])) {
    if (handlerOps.has(proc.op)) {
      throw new Error(`'${proc.op}' is declared as both an 'on' handler and a function`);
    }
  }
}

function checkSilentTopLevelUsage(actor) {
  const silentProcs = new Set();
  for (const proc of (actor.procs || [])) {
    const hasReply = proc.body.some(s => s.type === 'Reply');
    const hasImplicit = proc.body.some(s => s.type === 'ImplicitReturn');
    if (!hasReply && !hasImplicit) silentProcs.add(proc.op);
  }
  if (silentProcs.size === 0) return;

  const allBodies = [
    ...actor.handlers.map(h => h.body),
    ...(actor.procs || []).map(p => p.body),
  ];
  for (const body of allBodies) {
    for (const s of body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'ProcCallExpr' && silentProcs.has(s.value.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
      if (s.type === 'ExprStatement' && s.expr?.type === 'ProcCallExpr' && silentProcs.has(s.expr.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
    }
  }
}

function checkSilentFunctionUsage(actor) {
  const silentFunctions = new Set();
  const allBodies = [
    ...actor.handlers.map(h => h.body),
    ...(actor.procs || []).map(p => p.body),
  ];
  for (const body of allBodies) {
    for (const s of body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'Function' && s.value.returnType === '.') {
        silentFunctions.add(s.name);
      }
    }
  }
  if (silentFunctions.size === 0) return;

  for (const body of allBodies) {
    for (const s of body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'DestructureAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentFunctions.has(s.value.callee.name)) {
        throw new Error(`Cannot assign result of silent function '${s.value.callee.name}' — it has no return value`);
      }
    }
  }
}

// ── Scope name collection (mirrors buildTypeEnv in codegen.js) ──────────

function collectScopeNames(params, body) {
  const names = new Set();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.type) names.add(p.name);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      names.add(s.name);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) { names.add(item.name); continue; }
        if (s.source?.type === 'StructureConstructor') {
          let t;
          if (item.positional) t = s.source.args.filter(a => a.positional)[item.idx]?.type;
          else if (item.named) t = s.source.args.find(a => a.key === item.name)?.type;
          else if (item.key !== undefined) t = s.source.args.find(a => a.key === item.key)?.type;
          if (t) names.add(item.name);
        }
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) names.add(item.name);
      }
    } else if (s.type === 'Assign') {
      if (inferLiteralType(s.value)) names.add(s.name);
    } else if (s.type === 'RefDecl' && s.typeName) {
      names.add(s.name);
    }
  }
  return names;
}

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral')     return 'Integer';
  if (expr.type === 'StringLiteral')  return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral')   return 'Float';
  if (expr.type === 'BoolLiteral')    return 'Boolean';
  if (expr.type === 'NullLiteral')    return 'null';
  return null;
}

// ── Body-level checks ───────────────────────────────────────────────────────

function validateBody(body, outerNames, actorInfo) {
  checkTypeConsistency(body);

  for (const s of body) {
    // Structure arity check on plain Assign
    if (s.type === 'Assign' && s.value?.type === 'StructureConstructor') {
      const positionals = s.value.args.filter(a => a.positional);
      if (positionals.length > 1) {
        throw new Error(`Cannot assign ${positionals.length}-arity Structure to '${s.name}' — use ': Structure' type annotation`);
      }
    }

    // Named-field check on DestructureAssign
    if (s.type === 'DestructureAssign') {
      checkNamedFields(s.pattern, s.source);
    }

    // as-clause type check on TypedAssign + ProcCallExpr (actor instantiation)
    if (s.type === 'TypedAssign' && s.value?.type === 'ProcCallExpr' && actorInfo) {
      checkAsClauseMatch(s.typeName, s.value.name, actorInfo);
    }

    // Function literal validation
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function' && s.value.body) {
      checkRebind(s.value.body, outerNames, 'a function');
      checkWhileReturnType(s.value);
      const fnScope = collectScopeNames(s.value.params || [], s.value.body);
      validateBody(s.value.body, fnScope, actorInfo);
    }

    // IfExpr re-bind check
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'IfExpr') {
      checkRebindInIf(s.value, outerNames);
    }

    // WhileStatement re-bind check
    if (s.type === 'WhileStatement' && s.body) {
      checkRebind(s.body, outerNames, 'a while block');
    }
  }
}

// ── Type consistency ────────────────────────────────────────────────────────

function checkTypeConsistency(body) {
  const typeMap = new Map();
  function checkAndSet(name, typeName) {
    if (typeMap.has(name) && typeMap.get(name) !== typeName) {
      throw new Error(`Conflicting type declarations for '${name}': '${typeMap.get(name)}' vs '${typeName}'`);
    }
    typeMap.set(name, typeName);
  }
  for (const s of body) {
    if (s.type === 'BareTypeDecl') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'TypedAssign') {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'RefDecl' && s.typeName) {
      checkAndSet(s.name, s.typeName);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name && item.type) checkAndSet(item.name, item.type);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && !item.rest && item.name && item.type) checkAndSet(item.name, item.type);
      }
    }
  }
}

// ── Named-field check ───────────────────────────────────────────────────────

function checkNamedFields(pattern, source) {
  if (source.type !== 'StructureConstructor') return;
  const literalKeys = new Set(source.args.filter(a => a.key !== undefined).map(a => a.key));
  for (const item of pattern) {
    const key = item.key !== undefined ? item.key : item.named ? item.name : null;
    if (key !== null && !literalKeys.has(key)) {
      throw new Error(`Field '${key}' not found in Structure literal`);
    }
  }
}

// ── Re-bind guards ──────────────────────────────────────────────────────────

function checkRebind(body, outerNames, scopeLabel) {
  for (const s of body) {
    if (s.type === 'Assign' && outerNames.has(s.name)) {
      throw new Error(`Cannot re-bind '${s.name}' from inside ${scopeLabel} — use '${s.name} : Type = ...' to shadow it`);
    }
    if (s.type === 'WhileStatement' && s.body) {
      checkRebind(s.body, outerNames, 'a while block');
    }
  }
}

function checkRebindInIf(ifExpr, outerNames) {
  if (ifExpr.then?.body) {
    checkRebind(ifExpr.then.body, outerNames, 'an if block');
  }
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      checkRebindInIf(ifExpr.else, outerNames);
    } else if (ifExpr.else.body) {
      checkRebind(ifExpr.else.body, outerNames, 'an if block');
    }
  }
}

// ── While-null return type check ────────────────────────────────────────────

function checkWhileReturnType(fnNode) {
  if (!fnNode.body || fnNode.body.length === 0) return;
  // Find the last non-BareTypeDecl statement (matches codegen.js _lastIsWhile tracking)
  let last = null;
  for (const s of fnNode.body) {
    if (s.type !== 'BareTypeDecl') last = s;
  }
  if (!last || last.type !== 'WhileStatement') return;
  if (fnNode.returnType && !fnNode.returnType.endsWith(' | null')) {
    throw new Error(
      `while always evaluates to null — use '${fnNode.returnType} | null' as the return type`
    );
  }
}
