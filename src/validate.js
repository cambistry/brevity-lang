// Shared semantic validation pass — runs between parse() and codegen.
// Every target (JS, Erlang, Rust) gets the same checks.

import { parseServiceManifest } from './codegen/javascript/types.js';

export function validate(ast, options = {}) {
  // Build actor info map for cross-actor as-clause checking
  const actorInfo = new Map();
  for (const actor of ast.actors) {
    if (actor.name && actor.asClauses && actor.asClauses.length > 0) {
      actorInfo.set(actor.name, { asClauses: actor.asClauses });
    }
  }

  // Build remote manifests and constructor params from declarations
  const usesNames = new Set((ast.useDecls || []).map(u => u.name));
  const remotesParsed = {};
  const usesConstructors = {};
  for (const u of (ast.useDecls || [])) {
    if (u.manifest) remotesParsed[u.name] = parseServiceManifest(u.manifest);
    if (u.constructorParams) usesConstructors[u.name] = u.constructorParams;
  }
  if (options.remotes) {
    for (const [name, manifest] of Object.entries(options.remotes)) {
      remotesParsed[name] = typeof manifest === 'string' ? parseServiceManifest(manifest) : manifest;
    }
  }

  for (const actor of ast.actors) {
    validateActor(actor, actorInfo, usesNames, remotesParsed, usesConstructors);
  }
}

// ── Actor-level checks ─────────────────────────────────────────────────────

function validateActor(actor, actorInfo, usesNames, remotesParsed, usesConstructors) {
  checkNamespaceConflict(actor);
  checkSilentTopLevelUsage(actor);
  checkSilentFunctionUsage(actor);
  checkAsClauses(actor);

  // Validate constructor calls in constructorBody (top-level init)
  const initTypeEnv = buildTypeEnv([], actor.constructorBody || []);
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        usesNames.has(s.value.callee.name) && usesConstructors[s.value.callee.name]) {
      validateConstructorCall(s.value, usesConstructors, initTypeEnv);
    }
  }

  // Build state var type env from constructorBody for use in function validation
  const stateTypeEnv = new Map();
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && s.typeName) {
      stateTypeEnv.set(s.name, s.typeName);
    }
  }
  for (const d of (actor.stateVarDecls || [])) {
    if (d.typeName) stateTypeEnv.set(d.name, d.typeName);
  }

  for (const fn of actor.functions) {
    const outerNames = collectScopeNames(fn.params, fn.body);
    const typeEnv = buildTypeEnv(fn.params, fn.body);
    // Merge state var types so instance variables are visible
    for (const [k, v] of stateTypeEnv) {
      if (!typeEnv.has(k)) typeEnv.set(k, v);
    }
    validateBody(fn.body, outerNames, actorInfo, usesNames, remotesParsed, usesConstructors, typeEnv);
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
  throw new Error(`No matching 'self-as' clause in actor '${actorName}' for type '${targetType}'`);
}

function checkNamespaceConflict(actor) {
  const publicNames = new Set();
  const privateNames = new Set();
  for (const fn of actor.functions) {
    if (!fn.name) continue; // OnHandler etc.
    if (fn.name.startsWith('@')) {
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
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
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
  // Collect silent private functions (lineal)
  const silentNames = new Set();
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
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

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.rest) continue;
    if (p.name && p.type) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      env.set(s.name, s.typeName);
    } else if (s.type === 'RefDecl' && s.typeName) {
      env.set(s.name, s.typeName);
    } else if (s.type === 'Assign') {
      const t = inferLiteralType(s.value);
      if (t) env.set(s.name, t);
    }
  }
  return env;
}

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

function validateBody(body, outerNames, actorInfo, usesNames, remotesParsed, usesConstructors, typeEnv) {
  checkTypeConsistency(body);

  const isRemoteSend = (expr) =>
    expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && usesNames.has(expr.object.name);

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

    // Constructor call validation in function bodies
    const callExpr = s.type === 'ExprStatement' ? s.expr : s.value;
    if (callExpr?.type === 'FunctionCallExpr' && callExpr.callee?.type === 'Identifier'
        && usesNames.has(callExpr.callee.name) && usesConstructors[callExpr.callee.name]) {
      validateConstructorCall(callExpr, usesConstructors, typeEnv);
    }

    // as-clause type check on TypedAssign + FunctionCallExpr (actor instantiation)
    if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && actorInfo) {
      checkAsClauseMatch(s.typeName, s.value.callee.name, actorInfo);
    }

    // ── Remote call validation ──────────────────────────────────────
    // Check DotCallExpr on uses actors or instance variables
    const dotCall = s.type === 'ExprStatement' ? s.expr : s.value;
    if (dotCall?.type === 'DotCallExpr') {
      const objName = (dotCall.object?.type === 'Identifier' || dotCall.object?.type === 'RefRead') ? dotCall.object.name : null;
      // Direct uses call: Remote.call()
      if (isRemoteSend(dotCall)) {
        validateRemoteCall(dotCall, remotesParsed, typeEnv);
      }
      // Instance call: view.open() where view is typed as a uses name
      if (objName && !usesNames.has(objName)) {
        const objType = typeEnv.get(objName);
        if (objType && usesNames.has(objType) && remotesParsed[objType]) {
          // Validate against the instance manifest
          const instanceExpr = { ...dotCall, object: { type: 'Identifier', name: objType } };
          validateRemoteCall(instanceExpr, remotesParsed, typeEnv);
        }
      }
    }

    // Reject returning result of remote send when silent or no manifest
    if (s.type === 'Reply') {
      for (const f of s.fields) {
        if (isRemoteSend(f.expr)) {
          checkRemoteSendAssignable(f.expr, remotesParsed);
        }
      }
    }
    if (s.type === 'ImplicitReturn' && isRemoteSend(s.expr)) {
      checkRemoteSendAssignable(s.expr, remotesParsed);
    }

    // Reject assigning result of remote send when not allowed
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && isRemoteSend(s.value)) {
      checkRemoteSendAssignable(s.value, remotesParsed);
    }
    if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr' && isRemoteSend(s.source)) {
      checkRemoteSendAssignable(s.source, remotesParsed);
    }

    // Function literal validation
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function' && s.value.body) {
      checkRebind(s.value.body, outerNames, 'a function');
      checkWhileReturnType(s.value);
      const fnScope = collectScopeNames(s.value.params || [], s.value.body);
      const fnTypeEnv = buildTypeEnv(s.value.params || [], s.value.body);
      validateBody(s.value.body, fnScope, actorInfo, usesNames, remotesParsed, usesConstructors, fnTypeEnv);
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

// ── Constructor call validation ───────────────────────────────────────────

function validateConstructorCall(expr, usesConstructors, typeEnv) {
  const name = expr.callee.name;
  const declaredParams = usesConstructors[name];
  if (!declaredParams) return;

  // Build a single signature from the constructor params
  const sig = { params: declaredParams.map(p => ({ name: p.key || p.name, type: p.type })) };

  // Extract call args — may come from parseCallArgs (NamedArgsBag) or parseSendArgs (direct)
  const callNamed = new Map();
  const callPositional = [];
  for (const a of expr.args) {
    if (a.type === 'NamedArgsBag') {
      for (const [k, v] of Object.entries(a.fields)) {
        callNamed.set(k, { expr: v, typeName: null });
      }
    } else if (a.positional === false && a.name) {
      callNamed.set(a.name, { expr: a.expr, typeName: a.typeName });
    } else {
      callPositional.push(a);
    }
  }

  const sigPositional = sig.params.filter(p => !p.name);
  const sigNamed = sig.params.filter(p => p.name);

  // Check positional count
  if (callPositional.length !== sigPositional.length) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type).join(', ')})`;
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. Expected ${sigPositional.length} positional arg(s), got ${callPositional.length}`);
  }

  // Check named args match
  const sigNamedKeys = new Set(sigNamed.map(p => p.name));
  const callNamedKeys = new Set(callNamed.keys());
  const missing = [...sigNamedKeys].filter(k => !callNamedKeys.has(k));
  const extra = [...callNamedKeys].filter(k => !sigNamedKeys.has(k));
  if (missing.length > 0 || extra.length > 0) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type).join(', ')})`;
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(', ')}`);
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. ${parts.join('; ')}`);
  }

  // Check types
  const argType = (a) => {
    if (a.typeName) return a.typeName;
    if (a.expr) return inferLiteralType(a.expr);
    return null;
  };

  for (const sp of sigNamed) {
    const ca = callNamed.get(sp.name);
    if (!ca) continue;
    const ct = argType(ca);
    if (ct && sp.type && ct !== sp.type) {
      throw new Error(`'${name}()' constructor arg '${sp.name}': expected ${sp.type}, got ${ct}`);
    }
  }
}

// ── Remote call validation ────────────────────────────────────────────────

function validateRemoteCall(expr, remotesParsed, typeEnv) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) return; // no manifest — no arg validation
  const methodName = expr.method;
  const sigs = parsed[methodName];
  if (!sigs) {
    throw new Error(`'${actorName}' has no function '${methodName}'. Available: ${Object.keys(parsed).join(', ') || 'none'}`);
  }
  const callPositional = expr.args.filter(a => a.positional !== false && a.type !== 'NamedArgsBag');
  const callNamed = expr.args.filter(a => a.positional === false || a.type === 'NamedArgsBag');
  const callNamedKeys = new Set();
  for (const a of callNamed) {
    if (a.type === 'NamedArgsBag') {
      for (const k of Object.keys(a.fields || {})) callNamedKeys.add(k);
    } else if (a.name) {
      callNamedKeys.add(a.name);
    }
  }
  const argType = (a) => {
    if (a.typeName) return a.typeName;
    const name = a.expr?.type === 'Identifier' ? a.expr.name : (a.name || null);
    if (name && typeEnv) return typeEnv.get(name) || null;
    if (a.expr) return inferLiteralType(a.expr);
    return null;
  };
  const errors = [];
  for (const sig of sigs) {
    const sigPositional = sig.params.filter(p => !p.name);
    const sigNamed = sig.params.filter(p => p.name);
    if (callPositional.length !== sigPositional.length) {
      errors.push(`expected ${sigPositional.length} positional arg(s), got ${callPositional.length}`);
      continue;
    }
    const sigNamedKeys = new Set(sigNamed.map(p => p.name));
    const missingNamed = [...sigNamedKeys].filter(k => !callNamedKeys.has(k));
    const extraNamed = [...callNamedKeys].filter(k => !sigNamedKeys.has(k));
    if (missingNamed.length > 0 || extraNamed.length > 0) {
      const parts = [];
      if (missingNamed.length) parts.push(`missing: ${missingNamed.join(', ')}`);
      if (extraNamed.length) parts.push(`unexpected: ${extraNamed.join(', ')}`);
      errors.push(parts.join('; '));
      continue;
    }
    let typeMismatch = false;
    for (let i = 0; i < callPositional.length; i++) {
      const callType = argType(callPositional[i]);
      const sigType = sigPositional[i]?.type;
      if (callType && sigType && callType !== sigType) {
        errors.push(`positional arg ${i + 1}: expected ${sigType}, got ${callType}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    for (const a of callNamed) {
      const aName = a.name;
      if (!aName) continue;
      const callType = argType(a);
      const sigParam = sigNamed.find(p => p.name === aName);
      if (callType && sigParam?.type && callType !== sigParam.type) {
        errors.push(`named arg '${aName}': expected ${sigParam.type}, got ${callType}`);
        typeMismatch = true;
        break;
      }
    }
    if (typeMismatch) continue;
    return; // match found
  }
  const sigStrs = sigs.map(s => {
    const parts = s.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type);
    return `(${parts.join(', ')})`;
  });
  throw new Error(`'${actorName}.${methodName}()' arguments don't match any signature: ${sigStrs.join(' | ')}. ${errors[0]}`);
}

function checkRemoteSendAssignable(expr, remotesParsed) {
  const actorName = expr.object.name;
  const parsed = remotesParsed[actorName];
  if (!parsed) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — '${actorName}' has no declared manifest. Add a manifest to 'uses ${actorName}' or use '${actorName}.${expr.method}() .' for a silent send.`);
  }
  const sigs = parsed[expr.method];
  if (sigs && sigs.every(s => s.returns === null)) {
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — it is declared as silent (-> .).`);
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
