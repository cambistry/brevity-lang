// Shared semantic validation pass — runs between parse() and codegen.
// Every target (JS, Erlang, Rust) gets the same checks.

import { parseInterface } from './codegen/javascript/types.js';
import { parseDecimalLiteral, isTerminatingDivision } from './codegen/decimal_utils.js';
import { MATH_METHODS } from './math_methods.js';

export function validate(ast, options = {}) {
  // Build actor info map for cross-actor as-clause checking
  const actorInfo = new Map();
  for (const actor of ast.actors) {
    if (actor.name && actor.asClauses && actor.asClauses.length > 0) {
      actorInfo.set(actor.name, { asClauses: actor.asClauses });
    }
  }

  // Build remote interfaces and constructor params from declarations
  const dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  // destructuredMembers: localName → { service: depName, remote: remoteName }
  const destructuredMembers = new Map();
  for (const d of (ast.dependencies || [])) {
    if (d.destructures) {
      for (const entry of d.destructures) {
        destructuredMembers.set(entry.local, { service: d.name, remote: entry.remote });
        dependencyNames.add(entry.local);
      }
    }
  }
  const remotesParsed = {};
  const factoryDecls = {};
  for (const d of (ast.dependencies || [])) {
    if (d.interface) {
      const { iface, asTypes } = splitAsTypes(d.interface);
      remotesParsed[d.name] = parseInterface(iface);
      if (asTypes.length > 0) remotesParsed[d.name].__asTypes = asTypes;
    }
    if (d.constructorParams) factoryDecls[d.name] = d.constructorParams;
  }
  // Collect dep names whose manifest is provided inline by a constructor
  // coercion (`Coerced = Dep as <ctor> -> { iface }`). These are exempt from
  // the bare-* / # interface check below.
  const coercedDeps = new Set();
  for (const actor of ast.actors) {
    for (const s of (actor.constructorBody || [])) {
      if (s.type === 'ServiceCoercion' && s.constructorParams) {
        const refName = s.ref?.name || s.ref;
        if (refName) coercedDeps.add(refName);
      }
    }
  }
  if (options.remotes) {
    // Build path → alias map from declarations for resolving path-keyed remotes
    const pathToAlias = new Map();
    for (const d of (ast.dependencies || [])) {
      if (d.path) pathToAlias.set(d.path, d.name);
    }
    const ingestRemote = (alias, service, params) => {
      if (typeof service !== 'string') {
        remotesParsed[alias] = service;
        return;
      }
      if (params) {
        const ctorParams = parseParamsDocument(params);
        if (ctorParams) factoryDecls[alias] = ctorParams;
        const { iface, asTypes } = splitAsTypes(service);
        remotesParsed[alias] = parseInterface(iface);
        if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
      } else {
        const ctorManifest = parseConstructorManifest(service);
        if (ctorManifest) {
          factoryDecls[alias] = ctorManifest.constructorParams;
          const { iface, asTypes } = splitAsTypes(ctorManifest.service);
          remotesParsed[alias] = parseInterface(iface);
          if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
        } else {
          const { iface, asTypes } = splitAsTypes(service);
          remotesParsed[alias] = parseInterface(iface);
          if (asTypes.length > 0) remotesParsed[alias].__asTypes = asTypes;
        }
      }
    };
    if (Array.isArray(options.remotes)) {
      // New format: [{ path, params?, service }, ...]
      for (const { path, service, params } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) ingestRemote(alias, service, params);
      }
    } else {
      for (const [name, iface] of Object.entries(options.remotes)) {
        ingestRemote(name, iface);
      }
    }
  }

  // Check that all bare * / # dependencies have an interface (inline, via
  // options.remotes, or supplied by a constructor coercion).
  for (const d of (ast.dependencies || [])) {
    if (d.path && !d.interface && !remotesParsed[d.name] && !coercedDeps.has(d.name)) {
      throw new Error(`Dependency '${d.name}' (${d.path}) requires an interface — supply it inline or via options.remotes`);
    }
  }

  // ── Overload validation ──────────────────────────────────────────────────
  // Check: duplicate = (create) on same name is a redefinition error.
  // Check: << / >> without prior = (create) is an error.
  // Applies to functions within each actor and to actors (constructors) at top level.
  // Collect all constructor names created at top level (actors with = create)
  const topLevelActorCreates = new Set();
  for (const actor of ast.actors) {
    if (actor.name && (!actor.overloadMode || actor.overloadMode === 'create')) {
      topLevelActorCreates.add(actor.name);
    }
  }
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    const fnCreated = new Set();
    // Seed with constructor names — a constructor = create satisfies << on functions
    if (!actor.name) { // anonymous file-level actor
      for (const n of topLevelActorCreates) fnCreated.add(n);
    }
    for (const fn of actor.functions) {
      if (!fn.name) continue;
      const mode = fn.overloadMode || 'create';
      if (mode === 'create') {
        if (fnCreated.has(fn.name) && !topLevelActorCreates.has(fn.name)) {
          throw new Error(`Duplicate definition of '${fn.name}' — use '<< |params| body' to add an overload clause`);
        }
        fnCreated.add(fn.name);
      } else {
        if (!fnCreated.has(fn.name)) {
          throw new Error(`'${fn.name}' ${mode === 'append' ? '<<' : '>>'} used before '${fn.name}' is defined with '='`);
        }
      }
    }
  }
  {
    const ctorCreated = new Set();
    for (const actor of ast.actors) {
      if (!actor.name) continue;
      const mode = actor.overloadMode || 'create';
      if (mode === 'create') {
        if (ctorCreated.has(actor.name)) {
          throw new Error(`Duplicate definition of '${actor.name}' — use '<< <params> { body }' to add an overload clause`);
        }
        ctorCreated.add(actor.name);
      } else {
        if (!ctorCreated.has(actor.name)) {
          throw new Error(`'${actor.name}' ${mode === 'append' ? '<<' : '>>'} used before '${actor.name}' is defined with '='`);
        }
      }
    }
  }

  // ── Optional arg ordering: required positionals must precede optional ones ──
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (!fn.params) continue;
      const posParams = fn.params.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
    // Check constructor params too
    if (actor.initParams) {
      const posParams = actor.initParams.filter(p => p.positional);
      let seenOptional = false;
      for (const p of posParams) {
        if (p.defaultValue) { seenOptional = true; continue; }
        if (seenOptional) {
          throw new Error(`Required positional param '${p.name}' cannot follow optional param — move it before optional params or give it a default`);
        }
      }
    }
  }

  // ── Reorder for >> (prepend) — after validation, before codegen ─────────
  // >> clauses must be tried before existing same-name clauses.
  function reorderPrepends(arr, nameKey = 'name') {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].overloadMode === 'prepend') {
        const name = arr[i][nameKey];
        const firstIdx = arr.findIndex(x => x[nameKey] === name);
        if (firstIdx < i) {
          const [item] = arr.splice(i, 1);
          arr.splice(firstIdx, 0, item);
          i--;
        }
      }
    }
  }
  for (const actor of ast.actors) {
    if (actor.functions) reorderPrepends(actor.functions);
  }
  reorderPrepends(ast.actors);

  // Build actor public method map and ref-param requirements for * validation
  const actorMethods = new Map(); // actorName → Set of public method names
  const actorMethodSigs = new Map(); // actorName → Map(methodName → params[])
  const actorRefRequirements = new Map(); // actorName → { params, requirements, callSites }
  for (const actor of ast.actors) {
    if (!actor.name) continue;
    // Collect public methods and their signatures (params + returns)
    const methods = new Set();
    const sigs = new Map();
    for (const fn of actor.functions) {
      if (fn.name?.startsWith('@')) {
        methods.add(fn.name);
        // Extract return type info from Reply nodes
        const reply = fn.body?.find(s => s.type === 'Reply');
        const returns = reply ? reply.fields.map(f => ({ name: f.key || f.name, type: f.type })).filter(f => f.type) : null;
        sigs.set(fn.name, { params: fn.params || [], returns });
      }
    }
    actorMethods.set(actor.name, methods);
    actorMethodSigs.set(actor.name, sigs);

    // Collect ref param names, what methods the actor calls on them, and the call args
    const refParams = (actor.initParams || []).filter(p => p.ref);
    if (refParams.length > 0) {
      const refParamNames = new Set(refParams.map(p => p.name));
      const requirements = new Map(); // paramName → Set of called methods
      const callSites = []; // { paramName, method, args, fnParams }
      for (const pName of refParamNames) requirements.set(pName, new Set());
      // Walk all functions to find DotCallExpr on ref params
      for (const fn of actor.functions) {
        collectRefCalls(fn.body, refParamNames, requirements, callSites, fn.params);
      }
      actorRefRequirements.set(actor.name, { params: actor.initParams, requirements, callSites });
    }
  }

  // ── Subtype validation ──────────────────────────────────────────────────
  const actorByName = new Map(ast.actors.filter(a => a.name).map(a => [a.name, a]));
  for (const actor of ast.actors) {
    if (!actor.supertypes || actor.supertypes.length === 0) continue;
    for (const st of actor.supertypes) {
      const superActor = actorByName.get(st.supertype);
      if (!superActor) continue;

      // Arg type override rejection: subtype params with same name must have same type
      const superParams = new Map((superActor.initParams || []).map(p => [p.name, p]));
      for (const p of (actor.initParams || [])) {
        const sp = superParams.get(p.name);
        if (sp && sp.type && p.type && sp.type !== p.type) {
          throw new Error(`Subtype '${actor.name}' cannot change type of inherited arg '${p.name}' from '${sp.type}' to '${p.type}'`);
        }
      }

      // Public function return type rejection: overridden functions must return same type
      // Compare both explicit Reply returns and implicit returns
      for (const fn of actor.functions) {
        if (!fn.name?.startsWith('@')) continue;
        const superFn = superActor.functions.find(f => f.name === fn.name);
        if (!superFn) continue;

        // Get return type from super function (Reply or ImplicitReturn)
        const superReply = superFn.body?.find(s => s.type === 'Reply');
        const superImplicit = superFn.body?.find(s => s.type === 'ImplicitReturn');
        const ownReply = fn.body?.find(s => s.type === 'Reply');
        const ownImplicit = fn.body?.find(s => s.type === 'ImplicitReturn');

        // Compare implicit return types
        if (superImplicit && ownImplicit) {
          const superType = superImplicit.typeName || inferExprType(superImplicit.expr);
          const ownType = ownImplicit.typeName || inferExprType(ownImplicit.expr);
          if (superType && ownType && superType !== ownType) {
            throw new Error(`Subtype '${actor.name}' cannot change return type of '${fn.name}' from '${superType}' to '${ownType}'`);
          }
        }

        // Compare Reply returns
        if (superReply && ownReply) {
          for (const sf of superReply.fields) {
            const of2 = ownReply.fields.find(f => (f.key || f.name) === (sf.key || sf.name));
            if (of2 && of2.type && sf.type && of2.type !== sf.type) {
              throw new Error(`Subtype '${actor.name}' cannot change return type of '${fn.name}' field '${sf.key || sf.name}' from '${sf.type}' to '${of2.type}'`);
            }
          }
        }
      }

      // Accessor type rejection: subtype function overriding an auto-accessor must preserve type
      for (const sp of (superActor.initParams || [])) {
        if (sp.suppressAccessor) continue;
        const accessorName = sp.accessor || sp.name;
        if (sp.key && !sp.accessor) continue; // alias suppresses accessor
        const overrideFn = actor.functions.find(f => f.name === '@' + accessorName);
        if (overrideFn) {
          const reply = overrideFn.body?.find(s => s.type === 'Reply');
          const implicitReturn = overrideFn.body?.find(s => s.type === 'ImplicitReturn');
          if (reply) {
            for (const f of reply.fields) {
              if (f.type && f.type !== sp.type) {
                throw new Error(`Subtype '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${sp.type}' to '${f.type}'`);
              }
            }
          } else if (implicitReturn) {
            const irType = implicitReturn.typeName || inferExprType(implicitReturn.expr);
            if (irType && irType !== sp.type) {
              throw new Error(`Subtype '${actor.name}' cannot change type of inherited accessor '@${accessorName}' from '${sp.type}' to '${irType}'`);
            }
          }
        }
      }

      // Private function access: subtype cannot reference supertype's # functions
      const superPrivates = new Set(superActor.functions.filter(f => f.name?.startsWith('#')).map(f => f.name));
      if (superPrivates.size > 0) {
        for (const fn of actor.functions) {
          checkPrivateAccess(fn.body, superPrivates, actor.name);
        }
      }
    }
  }

  // Collect all named actor (constructor) names for silent-function exclusion
  // Include names from actorDef FunctionDecls (Function() + << constructor clauses)
  const constructorNames = new Set(ast.actors.filter(a => a.name).map(a => a.name));
  for (const actor of ast.actors) {
    if (!actor.functions) continue;
    for (const fn of actor.functions) {
      if (fn.actorDef) constructorNames.add(fn.name);
    }
  }

  for (const actor of ast.actors) {
    validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames, actorByName, destructuredMembers);
  }

  // ── Decimal division / exponentiation termination checks ──────────────
  checkDecimalTermination(ast);
}

// ── Decimal termination check ────────────────────────────────────────────
// Walk the AST looking for DecimalLiteral / DecimalLiteral or
// DecimalLiteral ** negative-IntLiteral where the result is non-terminating.

function checkDecimalTermination(ast) {
  function walkExpr(expr) {
    if (!expr || typeof expr !== 'object') return;
    if (expr.type === 'BinaryExpr') {
      walkExpr(expr.left);
      walkExpr(expr.right);
      if (expr.op === '/') {
        const lDec = expr.left.type === 'DecimalLiteral';
        const rDec = expr.right.type === 'DecimalLiteral';
        const lInt = expr.left.type === 'IntLiteral';
        const rInt = expr.right.type === 'IntLiteral';
        if ((lDec || lInt) && (rDec || rInt) && (lDec || rDec)) {
          const lv = parseDecimalLiteral(expr.left.value);
          const rv = parseDecimalLiteral(expr.right.value);
          if (!isTerminatingDivision(lv.coeff, lv.scale, rv.coeff, rv.scale)) {
            throw new Error(`Non-terminating decimal division: ${expr.left.value} / ${expr.right.value}`);
          }
        }
      }
      // Note: negative exponent (e.g. 3.0 ** -1) is checked at runtime only,
      // because the parser does not support unary minus / negative literals.
      return;
    }
    // ── Math method compile-time checks ─────────────────────────────────
    if (expr.type === 'MathMethodExpr') {
      const meta = MATH_METHODS.get(expr.method);
      if (meta && meta.accepts === 'float-decimal' && expr.args.length >= 1) {
        const arg = expr.args[0];
        if (arg.type === 'IntLiteral') {
          throw new Error(`Math.${expr.method}() does not accept Integer — value is already whole`);
        }
        // Also catch typed Integer parameters (known from the type environment at the actor level)
      }
      for (const a of expr.args) walkExpr(a);
      return;
    }
    for (const val of Object.values(expr)) {
      if (Array.isArray(val)) {
        for (const item of val) walkExpr(item);
      } else if (val && typeof val === 'object' && val.type) {
        walkExpr(val);
      }
    }
  }

  for (const actor of ast.actors) {
    for (const fn of (actor.functions || [])) {
      for (const s of (fn.body || [])) walkExpr(s);
    }
    for (const s of (actor.constructorBody || [])) walkExpr(s);
    for (const s of (actor.initBody || [])) walkExpr(s);
    for (const d of (actor.stateVarDecls || [])) {
      if (d.value) walkExpr(d.value);
    }
  }
}

// ── Constructor manifest parsing ──────────────────────────────────────────
//
// A # dependency's manifest from options.remotes has the shape
//   <:p Type, ...> -> { method: sig, ... }
// matching the inline form. This helper splits it into ctor params + the
// inner service interface string. Returns null if the input isn't shaped
// like a constructor manifest (so the caller can fall back to a plain service).

function splitAsTypes(service) {
  const t = service.trim();
  let depth = 0;
  let braceEnd = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
  }
  if (braceEnd === -1) return { iface: t, asTypes: [] };
  const iface = t.slice(0, braceEnd + 1);
  const rest = t.slice(braceEnd + 1).trim();
  const asTypes = [];
  for (const part of rest.split('|')) {
    const name = part.trim();
    if (name) asTypes.push(name);
  }
  return { iface, asTypes };
}

function parseParamsDocument(params) {
  const t = params.trim();
  if (!t.startsWith('<') || !t.endsWith('>')) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const result = [];
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^:(\w+)\s+(\w+)$/) || trimmed.match(/^(\w+)\s+(\w+)$/);
    if (m) result.push({ name: m[1], type: m[2] });
  }
  return result;
}

function parseConstructorManifest(s) {
  const t = s.trim();
  if (!t.startsWith('<')) return null;
  let depth = 0;
  let i = 0;
  for (; i < t.length; i++) {
    if (t[i] === '<') depth++;
    else if (t[i] === '>') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  const paramsStr = t.slice(1, i).trim();
  let j = i + 1;
  while (j < t.length && /\s/.test(t[j])) j++;
  if (t.slice(j, j + 2) !== '->') return null;
  j += 2;
  while (j < t.length && /\s/.test(t[j])) j++;
  const service = t.slice(j);
  const constructorParams = [];
  if (paramsStr) {
    for (const part of paramsStr.split(',')) {
      const trimmed = part.trim();
      const m = trimmed.match(/^:(\w+)\s+(\w+)$/) || trimmed.match(/^(\w+)\s+(\w+)$/);
      if (m) constructorParams.push({ name: m[1], type: m[2] });
    }
  }
  return { constructorParams, service };
}

// ── Expression type inference (for validation) ────────────────────────────

function inferExprType(expr) {
  if (!expr) return null;
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  return null;
}

// ── Private function access check ──────────────────────────────────────────

function checkPrivateAccess(body, superPrivates, subtypeName) {
  if (!body) return;
  for (const node of body) {
    walkForPrivateAccess(node, superPrivates, subtypeName);
  }
}

function walkForPrivateAccess(node, superPrivates, subtypeName) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier' && superPrivates.has(node.name)) {
    throw new Error(`Subtype '${subtypeName}' cannot access private function '${node.name}' from supertype`);
  }
  if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && superPrivates.has(node.callee.name)) {
    throw new Error(`Subtype '${subtypeName}' cannot access private function '${node.callee.name}' from supertype`);
  }
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) walkForPrivateAccess(item, superPrivates, subtypeName);
    } else if (val && typeof val === 'object' && val.type) {
      walkForPrivateAccess(val, superPrivates, subtypeName);
    }
  }
}

// ── Ref param method collection ────────────────────────────────────────────

function collectRefCalls(body, refParamNames, requirements, callSites, fnParams) {
  for (const s of body) {
    collectRefCallsInNode(s, refParamNames, requirements, callSites, fnParams, body);
  }
}

function collectRefCallsInNode(node, refParamNames, requirements, callSites, fnParams, body) {
  if (!node || typeof node !== 'object') return;
  // DotCallExpr on a ref param: super.method()
  if (node.type === 'DotCallExpr' && node.object?.type === 'Identifier' && refParamNames.has(node.object.name)) {
    const method = node.method.startsWith('@') ? node.method : '@' + node.method;
    requirements.get(node.object.name).add(method);
    callSites.push({ paramName: node.object.name, method, args: node.args || [], fnParams, body });
  }
  // Recurse into all object values
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const item of val) collectRefCallsInNode(item, refParamNames, requirements, callSites, fnParams, body);
    } else if (val && typeof val === 'object' && val.type) {
      collectRefCallsInNode(val, refParamNames, requirements, callSites, fnParams, body);
    }
  }
}

// ── Actor-level checks ─────────────────────────────────────────────────────

function validateActor(actor, actorInfo, dependencyNames, remotesParsed, factoryDecls, actorMethods, actorMethodSigs, actorRefRequirements, constructorNames = new Set(), actorByName = new Map(), destructuredMembers = new Map()) {
  checkNamespaceConflict(actor);
  checkSilentTopLevelUsage(actor, constructorNames);
  checkSilentFunctionUsage(actor, constructorNames);
  checkXmlConstructorCalls(actor, constructorNames, actorByName);
  checkAsClauses(actor);

  // ── Per-actor augmented dep sets ────────────────────────────────────────
  // Constructor coercions (`Coerced = Thing as <ctor> -> { iface }`) introduce
  // synthetic local deps. They are construction-capable and have a service
  // interface, so add them to the per-actor copies of dependencyNames /
  // remotesParsed / factoryDecls used for the rest of validation.
  const localDepNames = new Set(dependencyNames);
  const localRemotes = { ...remotesParsed };
  const localFactoryDecls = { ...factoryDecls };
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion' && s.constructorParams) {
      localDepNames.add(s.name);
      localFactoryDecls[s.name] = s.constructorParams;
      // parseServiceConstraint produces { method: { params, returns } }, but
      // remotesParsed is { method: [{ params, returns }, ...] } (array of
      // overloads). Wrap each entry in an array.
      const wrapped = {};
      for (const [m, sig] of Object.entries(s.constraint)) wrapped[m] = [sig];
      localRemotes[s.name] = wrapped;
    }
  }

  // Validate constructor calls in constructorBody (top-level init)
  const initTypeEnv = buildTypeEnv([], actor.constructorBody || []);
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      const depName = s.value.callee.name;
      // For destructured members, skip constructor validation — these are
      // function calls routed to the source service, not dep constructor calls
      if (destructuredMembers.has(depName)) continue;
      if (localFactoryDecls[depName]) {
        validateConstructorCall(s.value, localFactoryDecls, initTypeEnv);
      } else {
        throw new Error(
          `Cannot construct '${depName}' — its dependency declaration has no constructor signature. ` +
          `Use '<"path": (${depName}) #>' with a manifest in options.remotes, ` +
          `or '<"path": (${depName}) <:param Type> -> { ... }>' inline.`,
        );
      }
    }
  }

  // Build state var type env from constructorBody for use in function validation
  const stateTypeEnv = new Map();
  for (const s of (actor.constructorBody || [])) {
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && s.typeName) {
      stateTypeEnv.set(s.name, s.typeName);
    }
    // Infer instance type from constructor calls against declared dependencies
    // (or against constructor coercions, which are in localDepNames):
    //   t = Thing(args)    →  t : Thing
    //   t = Coerced(args)  →  t : Coerced
    if ((s.type === 'RefDecl' || s.type === 'TypedAssign') && !s.typeName &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        localDepNames.has(s.value.callee.name)) {
      stateTypeEnv.set(s.name, s.value.callee.name);
    }
  }
  for (const d of (actor.stateVarDecls || [])) {
    if (d.typeName) stateTypeEnv.set(d.name, d.typeName);
  }

  // Collect service coercion constraints: alias → { constraint, refName }
  const coercionConstraints = new Map();
  for (const s of (actor.constructorBody || [])) {
    if (s.type === 'ServiceCoercion') {
      coercionConstraints.set(s.name, { constraint: s.constraint, refName: s.ref?.name || s.ref });
    }
  }

  for (const fn of actor.functions) {
    const outerNames = collectScopeNames(fn.params, fn.body);
    const typeEnv = buildTypeEnv(fn.params, fn.body);
    // Merge state var types so instance variables are visible
    for (const [k, v] of stateTypeEnv) {
      if (!typeEnv.has(k)) typeEnv.set(k, v);
    }
    validateBody(fn.body, outerNames, actorInfo, localDepNames, localRemotes, localFactoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints);
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
      privateNames.add(fn.name);
    }
  }
  for (const name of publicNames) {
    if (privateNames.has(name)) {
      throw new Error(`Duplicate function name '${name}'`);
    }
  }
}

function checkXmlConstructorCalls(actor, constructorNames, actorByName) {
  // Walk all function bodies looking for xmlConstructor calls
  function walkExpr(expr) {
    if (!expr) return;
    if (expr.type === 'FunctionCallExpr' && expr.xmlConstructor) {
      const name = expr.callee?.name;
      if (!name) return;
      if (!constructorNames.has(name)) {
        throw new Error(`XML tag <${name} /> can only be used with constructors, not functions`);
      }
      // Check that the constructor doesn't have positional params
      const targetActor = actorByName.get(name);
      if (targetActor) {
        const posParams = (targetActor.initParams || []).filter(p => p.positional);
        if (posParams.length > 0) {
          throw new Error(`XML tag <${name} /> cannot be used with constructors that have positional params — use named params (name: Type) instead`);
        }
      }
    }
    // Recurse into sub-expressions
    if (expr.args) for (const a of expr.args) walkExpr(a.expr || a);
    if (expr.fields) for (const k of Object.keys(expr.fields)) walkExpr(expr.fields[k]);
    if (expr.left) walkExpr(expr.left);
    if (expr.right) walkExpr(expr.right);
    if (expr.object) walkExpr(expr.object);
    if (expr.callee) walkExpr(expr.callee);
    if (expr.collection) walkExpr(expr.collection);
    if (expr.fn) walkExpr(expr.fn);
    if (expr.cond) walkExpr(expr.cond);
    if (expr.then) walkExpr(expr.then?.expr);
    if (expr.else) walkExpr(expr.else?.expr);
  }
  for (const fn of actor.functions) {
    for (const s of fn.body) {
      if (s.value) walkExpr(s.value);
      if (s.expr) walkExpr(s.expr);
    }
  }
}

function checkSilentTopLevelUsage(actor, constructorNames = new Set()) {
  const silentFns = new Set();
  // Collect names that have overload clauses — empty Function() initializers aren't silent
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    // Skip constructor overload clauses and constructor names
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
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

function checkSilentFunctionUsage(actor, constructorNames = new Set()) {
  // Collect silent private functions (lineal)
  const silentNames = new Set();
  const overloadedNames = new Set();
  for (const fn of actor.functions) {
    if (fn.overloadMode || fn.actorDef) overloadedNames.add(fn.name);
  }
  for (const fn of actor.functions.filter(f => f.name && !f.name.startsWith('@'))) {
    if (fn.actorDef) continue;
    if (constructorNames.has(fn.name)) continue;
    // Skip empty Function() initializers that have overload clauses
    if (fn.body.length === 0 && fn.params.length === 0 && overloadedNames.has(fn.name)) continue;
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

function inferArgType(expr, typeEnv) {
  if (!expr) return null;
  const lit = inferLiteralType(expr);
  if (lit) return lit;
  // Resolve identifiers from the type environment
  if (expr.type === 'Identifier' && typeEnv?.has(expr.name)) return typeEnv.get(expr.name);
  return null;
}

// ── Body-level checks ───────────────────────────────────────────────────────

function validateBody(body, outerNames, actorInfo, dependencyNames, remotesParsed, factoryDecls, typeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints) {
  checkTypeConsistency(body);

  // Build a local map of variable → actor type from assignments like: a = A()
  const localActorTypes = new Map();
  for (const s of body) {
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        actorMethods?.has(s.value.callee.name)) {
      localActorTypes.set(s.name, s.value.callee.name);
    }
  }

  const isRemoteSend = (expr) =>
    expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && dependencyNames.has(expr.object.name);

  // Treat `t.method()` as a remote send when `t` is a local instance of a declared dep:
  //   t = Thing(args)  →  t : Thing  →  t.method() routes to a Thing instance
  // Returns the dep name (so callers can look up parsed remotes), or null.
  const instanceDepName = (expr) => {
    if (expr?.type !== 'DotCallExpr' || expr.object?.type !== 'Identifier') return null;
    const objName = expr.object.name;
    if (dependencyNames.has(objName)) return null; // already a direct dep
    const t = typeEnv.get(objName);
    return (t && dependencyNames.has(t)) ? t : null;
  };

  // Wraps an instance method call into a direct-dep-shaped expr so the
  // existing remote-call validators can use it without further changes.
  const asDepCall = (expr) => {
    if (isRemoteSend(expr)) return expr;
    const dep = instanceDepName(expr);
    if (!dep) return null;
    return { ...expr, object: { type: 'Identifier', name: dep } };
  };

  for (const s of body) {
    // ── Ref param validation at instantiation site ──────────────────
    // When b = B(a) and B has * ref params, check that a has the required methods
    if ((s.type === 'Assign' || s.type === 'TypedAssign') &&
        s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
        actorRefRequirements?.has(s.value.callee.name)) {
      const targetActor = s.value.callee.name;
      const { params, requirements, callSites } = actorRefRequirements.get(targetActor);
      // Resolve positional and named args to their corresponding ref params
      const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
      const namedFields = namedBag?.fields || {};
      let posIdx = 0;
      for (const p of params) {
        let argExpr = null;
        if (p.ref) {
          const lookupKey = p.key || p.name;
          if (namedFields[lookupKey]) {
            argExpr = namedFields[lookupKey];
          } else if (p.positional && posIdx < positionalArgs.length) {
            argExpr = positionalArgs[posIdx];
          }
        }
        if (p.positional) posIdx++;
        if (!argExpr || !requirements.has(p.name)) continue;
        // Resolve the arg to an actor type
        const argActorName = argExpr.type === 'Identifier' ? localActorTypes.get(argExpr.name) : null;
        if (!argActorName || !actorMethods.has(argActorName)) continue;
        const availableMethods = actorMethods.get(argActorName);
        const requiredMethods = requirements.get(p.name);
        const missing = [...requiredMethods].filter(m => !availableMethods.has(m));
        if (missing.length > 0) {
          throw new Error(
            `'${targetActor}' requires ${missing.map(m => `'${m}'`).join(', ')} on ref param '${p.name}', ` +
            `but '${argActorName}' does not have ${missing.length === 1 ? 'it' : 'them'}`,
          );
        }
        // ── Arg type checking on ref param call sites ────────────────
        const targetSigs = actorMethodSigs.get(argActorName);
        if (!targetSigs) continue;
        for (const site of callSites) {
          if (site.paramName !== p.name) continue;
          const methodSig = targetSigs.get(site.method);
          if (!methodSig) continue;
          // Build type env for the wrapper function scope to resolve variable types
          const siteTypeEnv = buildTypeEnv(site.fnParams || [], site.body || []);
          // Match call args to method params by name
          for (const callArg of site.args) {
            const argName = callArg.name;
            const argType = inferArgType(callArg.expr, siteTypeEnv);
            if (!argType) continue; // can't infer — skip, no false positives
            const methodParam = methodSig.params.find(mp => mp.name === argName);
            if (!methodParam || !methodParam.type) continue;
            if (argType !== methodParam.type) {
              throw new Error(
                `Type mismatch in '${targetActor}': ref param '${p.name}' calls '${site.method}' ` +
                `with '${argName}: ${argType}', but '${argActorName}.${site.method}' expects '${argName}: ${methodParam.type}'`,
              );
            }
          }
        }
        // ── Inline constraint validation ─────────────────────────────
        if (p.constraint) {
          for (const [methodName, spec] of Object.entries(p.constraint)) {
            // Check method exists
            if (!availableMethods.has(methodName)) {
              throw new Error(
                `'${targetActor}' constraint on '${p.name}' requires '${methodName}', ` +
                `but '${argActorName}' does not have it`,
              );
            }
            // Check param types
            const sig = targetSigs.get(methodName);
            if (sig && spec.params) {
              for (const cp of spec.params) {
                const ap = sig.params.find(sp => sp.name === cp.name);
                if (ap && cp.type && ap.type && cp.type !== ap.type) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' param '${cp.name}' is '${ap.type}', ` +
                    `but constraint on '${p.name}' expects '${cp.type}'`,
                  );
                }
              }
            }
            // Check return types
            if (sig && spec.returns && sig.returns) {
              for (const cr of spec.returns) {
                const ar = sig.returns.find(sr => sr.name === cr.name);
                if (ar && cr.type && ar.type && cr.type !== ar.type) {
                  throw new Error(
                    `Type mismatch: '${argActorName}.${methodName}' returns '${cr.name}: ${ar.type}', ` +
                    `but constraint on '${p.name}' expects '${cr.name}: ${cr.type}'`,
                  );
                }
              }
            }
          }
        }
      }
    }

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
        && dependencyNames.has(callExpr.callee.name) && factoryDecls[callExpr.callee.name]) {
      validateConstructorCall(callExpr, factoryDecls, typeEnv);
    }

    // as-clause type check on TypedAssign + FunctionCallExpr (actor instantiation)
    if (s.type === 'TypedAssign' && s.value?.type === 'FunctionCallExpr' && s.value.callee?.name && actorInfo) {
      checkAsClauseMatch(s.typeName, s.value.callee.name, actorInfo);
    }
    // as-type check for dependency typed assign: n Integer = Dep or n Integer = Dep()
    if (s.type === 'TypedAssign' && s.typeName) {
      const depName = s.value?.type === 'Identifier' ? s.value.name
        : (s.value?.type === 'FunctionCallExpr' ? s.value.callee?.name : null);
      if (depName && dependencyNames.has(depName) && remotesParsed[depName]) {
        const asTypes = remotesParsed[depName].__asTypes;
        if (asTypes && !asTypes.includes(s.typeName)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${s.typeName}'`);
        } else if (!asTypes && !actorInfo?.has(depName)) {
          throw new Error(`No matching 'self-as' clause in service '${depName}' for type '${s.typeName}'`);
        }
      }
    }

    // ── Service coercion constraint checking ──────────────────────────
    // Check DotCallExpr on coercion aliases against the cast's constraint
    if (coercionConstraints?.size > 0) {
      const coercionDot = s.type === 'DestructureAssign' ? s.source : (s.type === 'ExprStatement' ? s.expr : s.value);
      if (coercionDot?.type === 'DotCallExpr') {
        const objName = (coercionDot.object?.type === 'Identifier' || coercionDot.object?.type === 'RefRead') ? coercionDot.object.name : null;
        if (objName && coercionConstraints.has(objName)) {
          const { constraint } = coercionConstraints.get(objName);
          const methodName = '@' + coercionDot.method;
          const spec = constraint[methodName] || constraint[coercionDot.method];
          if (spec && spec.params) {
            for (const callArg of coercionDot.args) {
              const argName = callArg.name;
              const argType = inferArgType(callArg.expr, typeEnv);
              if (!argType) continue;
              const specParam = spec.params.find(sp => sp.name === argName);
              if (specParam && specParam.type && argType !== specParam.type) {
                throw new Error(
                  `Type mismatch: cast '${objName}' constrains '${methodName}' param '${argName}' to '${specParam.type}', ` +
                  `but got '${argType}'`,
                );
              }
            }
          }
        }
      }
    }

    // ── Remote call validation ──────────────────────────────────────
    // Check DotCallExpr on declared dependencies or instance variables
    const dotCall = s.type === 'ExprStatement' ? s.expr : s.value;
    if (dotCall?.type === 'DotCallExpr') {
      const objName = (dotCall.object?.type === 'Identifier' || dotCall.object?.type === 'RefRead') ? dotCall.object.name : null;
      // Direct dependency call: Remote.call()
      if (isRemoteSend(dotCall)) {
        validateRemoteCall(dotCall, remotesParsed, typeEnv);
      }
      // Instance call: view.open() where view is typed as a dependency name
      if (objName && !dependencyNames.has(objName)) {
        const objType = typeEnv.get(objName);
        if (objType && dependencyNames.has(objType) && remotesParsed[objType]) {
          // Validate against the instance interface
          const instanceExpr = { ...dotCall, object: { type: 'Identifier', name: objType } };
          validateRemoteCall(instanceExpr, remotesParsed, typeEnv);
        }
      }
    }

    // Reject returning result of remote send when silent or no interface
    if (s.type === 'Reply') {
      for (const f of s.fields) {
        const dep = asDepCall(f.expr);
        if (dep) checkRemoteSendAssignable(dep, remotesParsed);
      }
    }
    if (s.type === 'ImplicitReturn') {
      const dep = asDepCall(s.expr);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Reject assigning result of remote send when not allowed
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr') {
      const dep = asDepCall(s.value);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }
    if (s.type === 'DestructureAssign' && s.source?.type === 'DotCallExpr') {
      const dep = asDepCall(s.source);
      if (dep) checkRemoteSendAssignable(dep, remotesParsed);
    }

    // Function literal validation
    if ((s.type === 'TypedAssign' || s.type === 'Assign') && s.value?.type === 'Function' && s.value.body) {
      checkRebind(s.value.body, outerNames, 'a function');
      checkWhileReturnType(s.value);
      const fnScope = collectScopeNames(s.value.params || [], s.value.body);
      const fnTypeEnv = buildTypeEnv(s.value.params || [], s.value.body);
      validateBody(s.value.body, fnScope, actorInfo, dependencyNames, remotesParsed, factoryDecls, fnTypeEnv, actorMethods, actorMethodSigs, actorRefRequirements, coercionConstraints);
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

// ── Constructor call validation (constructs keyword) ─────────────────────

function validateConstructorCall(expr, factoryDecls, _typeEnv) {
  const name = expr.callee.name;
  const declaredParams = factoryDecls[name];
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
  const requiredPositional = sigPositional.filter(p => !p.optional).length;

  // Check positional count (accounting for optional params)
  if (callPositional.length < requiredPositional || callPositional.length > sigPositional.length) {
    const sigStr = `(${sig.params.map(p => p.name ? `${p.name}: ${p.type}` : p.type).join(', ')})`;
    throw new Error(`'${name}()' arguments don't match constructor signature: ${sigStr}. Expected ${requiredPositional === sigPositional.length ? sigPositional.length : requiredPositional + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
  }

  // Check named args match (optional named args don't need to be provided)
  const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
  const allNamedKeys = new Set(sigNamed.map(p => p.name));
  const callNamedKeys = new Set(callNamed.keys());
  const missing = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
  const extra = [...callNamedKeys].filter(k => !allNamedKeys.has(k));
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
  if (!parsed) return; // no interface — no arg validation
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
    const requiredPos = sigPositional.filter(p => !p.optional).length;
    if (callPositional.length < requiredPos || callPositional.length > sigPositional.length) {
      errors.push(`expected ${requiredPos === sigPositional.length ? sigPositional.length : requiredPos + '-' + sigPositional.length} positional arg(s), got ${callPositional.length}`);
      continue;
    }
    const requiredNamedKeys = new Set(sigNamed.filter(p => !p.optional).map(p => p.name));
    const sigNamedKeys = new Set(sigNamed.map(p => p.name));
    const missingNamed = [...requiredNamedKeys].filter(k => !callNamedKeys.has(k));
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
    throw new Error(`Cannot use the result of '${actorName}.${expr.method}()' — '${actorName}' has no declared interface.`);
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
      `while always evaluates to null — use '${fnNode.returnType} | null' as the return type`,
    );
  }
}
