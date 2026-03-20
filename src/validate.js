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

  for (const fn of actor.functions) {
    const outerNames = collectScopeNames(fn.params, fn.body);
    validateBody(fn.body, outerNames, actorInfo);
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
  const publicNames = new Set();
  const privateNames = new Set();
  for (const fn of actor.functions) {
    if (fn.public) {
      publicNames.add(fn.name);
    } else {
      if (privateNames.has(fn.name)) {
        throw new Error(`Duplicate function name '${fn.name}'`);
      }
      privateNames.add(fn.name);
    }
  }
  for (const name of publicNames) {
    if (privateNames.has(name)) {
      throw new Error(`Duplicate function name '${name}'`);
    }
  }
}

function checkSilentTopLevelUsage(actor) {
  const silentFns = new Set();
  for (const fn of actor.functions.filter(f => !f.public)) {
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    if (!hasReply && !hasImplicit) silentFns.add(fn.name);
  }
  if (silentFns.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentFns.has(s.value.callee.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
      if (s.type === 'ExprStatement' && s.expr?.type === 'FunctionCallExpr' && s.expr.callee?.name && silentFns.has(s.expr.callee.name)) {
        throw new Error("Silent function invocation requires 'spawn'");
      }
    }
  }
}

// Walk an expression tree looking for calls to silent functions
function findSilentCallInExpr(expr, silentNames) {
  if (!expr) return null;
  if (expr.type === 'FunctionCallExpr' && expr.callee?.name && silentNames.has(expr.callee.name)) {
    return expr.callee.name;
  }
  // Recurse into sub-expressions
  if (expr.type === 'BinaryExpr') {
    return findSilentCallInExpr(expr.left, silentNames) || findSilentCallInExpr(expr.right, silentNames);
  }
  if (expr.type === 'FunctionCallExpr') {
    for (const a of (expr.args || [])) {
      const found = findSilentCallInExpr(a, silentNames) || findSilentCallInExpr(a.expr, silentNames);
      if (found) return found;
    }
  }
  if (expr.type === 'IfExpr') {
    return findSilentCallInExpr(expr.cond, silentNames)
      || findSilentCallInExpr(expr.then?.expr, silentNames)
      || findSilentCallInExpr(expr.else?.expr, silentNames);
  }
  return null;
}

function checkSilentFunctionUsage(actor) {
  // Collect silent private functions (spacious)
  const silentNames = new Set();
  for (const fn of actor.functions.filter(f => !f.public)) {
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    if (!hasReply && !hasImplicit) silentNames.add(fn.name);
  }

  // Collect silent lambdas
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'Function' && s.value.returnType === '.') {
        silentNames.add(s.name);
      }
    }
  }
  if (silentNames.size === 0) return;

  for (const fn of actor.functions) {
    for (const s of fn.body) {
      // Direct assignment: x = silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign' || s.type === 'DestructureAssign') &&
          s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && silentNames.has(s.value.callee.name)) {
        throw new Error(`Cannot assign result of silent function '${s.value.callee.name}' — it has no return value`);
      }

      // Used in expression: x = 1 + silent()
      if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value) {
        // Skip direct call (caught above), check sub-expressions
        if (s.value.type !== 'FunctionCallExpr') {
          const found = findSilentCallInExpr(s.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used in an expression — it has no return value`);
        }
      }

      // Used as argument: double(silent())
      if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
          s.value?.type === 'FunctionCallExpr' && !silentNames.has(s.value.callee?.name)) {
        for (const a of (s.value.args || [])) {
          const arg = a.expr || a;
          const found = findSilentCallInExpr(arg, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as an argument — it has no return value`);
        }
      }

      // Used as return value: -> silent()
      if (s.type === 'Reply') {
        for (const f of s.fields) {
          const found = findSilentCallInExpr(f.expr || f.value, silentNames);
          if (found) throw new Error(`Silent function '${found}' cannot be used as a return value — it has no return value`);
        }
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

    // as-clause type check on TypedAssign + FunctionCallExpr (actor instantiation)
    if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && actorInfo) {
      checkAsClauseMatch(s.typeName, s.value.callee.name, actorInfo);
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
