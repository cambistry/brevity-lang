import { inferLiteralType, buildTypeEnv } from './types.js';
import {
  CALL_LIKE, genExpr, genDestructure, genDestructureAssign,
  genListDestructureAssign, genReBody,
  collectFreeVars, wrapWithCapture, lambdaUsesOuterRefs,
  jsIdent, mintSsaNameIn, stateKey,
} from './expressions.js';

// Escape a string for use inside a #<...> wire address.
const encAddr = (s) => s.replace(/\\/g, '\\\\').replace(/>/g, '\\>');

// Subscribe call-site codegen. `c.x.subscribe |v| { ... }` posts
// op:"@subscribe" to c's address, with the selector `@x` appended to the `to`
// field (space-delimited; angles wrap the DI'd alias for remote targets).
// Registers a persistent pending entry keyed by a fresh id, and routes each
// incoming `re` to the handler body with params bound from the positional
// payload. The statement produces no value and is not assignable.
export function genSubscribeCall(ctx, expr) {
  const target = expr.target;
  // Self-subscribe: target is a bare @name or #name identifier referring to
  // this actor's own public or private handler. No wire op is posted; the
  // subscription is registered in-process and the handler is invoked via a
  // self-directed receive so the initial `re` flows back through the normal
  // pending-handler path.
  const isSelfTarget = target?.type === 'Identifier' &&
    (target.name.startsWith('@') || target.name.startsWith('#'));
  // Cell-handle subscribe: target is a bare identifier naming a state var
  // that holds a `{host, cell}` handle (passed in from a constructor whose
  // arg was a public @-cell of the host). Selector and routing target are
  // both read from the handle at runtime.
  const isCellHandleTarget = !isSelfTarget && target?.type === 'Identifier' &&
    ctx.stateVarNames?.has(target.name);
  if (!isSelfTarget && !isCellHandleTarget &&
      (target?.type !== 'DotAccessExpr' || target.object?.type !== 'Identifier')) {
    throw new Error('subscribe: target must be self (@name / #name), a cell-handle param, or <remoteOrChild>.<field>');
  }
  const objectName = isSelfTarget || isCellHandleTarget ? null : target.object.name;
  // Wire shape: op is "@subscribe"; the @/#-prefixed selector lives in
  // the `to` field (space-delimited after the addr, if any). Dispatch
  // prologue strips the @ sigil and re-synthesizes the internal
  // `subscribe@<name>` / `subscribe#<name>` opName so the handler
  // machinery runs unchanged.
  const selector = '@subscribe';
  // The `to`-field selector: self uses bare @name/#name (sigil-preserving);
  // remote prefixes with `@<property>` (public selectors only on remote).
  // Cell-handle reads the cell name from the runtime handle, so it's set later.
  const toSelector = isSelfTarget ? target.name :
    isCellHandleTarget ? null : ('@' + target.property);
  const fnCode = genFunctionBodyCode(ctx, expr.params, expr.body, null, '.');
  const pendingSetup = `
          const _sub_id = String(++this.#nextId);
          this.#pending.set(_sub_id, {
            persistent: true,
            handler: async (_re) => {
              const _s = { positional: Array.isArray(_re) ? _re : [], named: (_re && !Array.isArray(_re) && typeof _re === 'object') ? _re : {} };
              await (${fnCode})(_s);
            }
          });`;

  // Parameterized subscribe: args ride on the op as `[argsPayload, selector]`,
  // with `bv-a` paralleling the payload shape. Mirrors the DotCallExpr remote
  // pattern in expressions.js.
  const args = expr.args || [];
  const positional = args.filter(a => a.positional);
  const named = args.filter(a => !a.positional);
  let opExpr;
  let bvaField = '';
  if (positional.length === 0 && named.length === 0) {
    opExpr = JSON.stringify(selector);
  } else {
    const genArgVal = a => a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames?.has(a.name) ? `this.#${stateKey(a.name)}` : a.name);
    const typeOf = a => a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null;
    const posVals = positional.map(genArgVal).join(', ');
    const namedFields = named.map(a => `${a.name}: ${genArgVal(a)}`).join(', ');
    const posBva = positional.map(a => JSON.stringify(typeOf(a))).join(', ');
    const namedBva = named.map(a => `${a.name}: ${JSON.stringify(typeOf(a))}`).join(', ');
    if (positional.length > 0 && named.length > 0) {
      opExpr = `[${posVals}, {${namedFields}}, ${JSON.stringify(selector)}]`;
      bvaField = `, 'bv-a': [${posBva}, {${namedBva}}]`;
    } else if (named.length > 0) {
      opExpr = `[{${namedFields}}, ${JSON.stringify(selector)}]`;
      bvaField = `, 'bv-a': [{${namedBva}}]`;
    } else {
      opExpr = `[[${posVals}], ${JSON.stringify(selector)}]`;
      bvaField = `, 'bv-a': [[${posBva}]]`;
    }
  }

  // Self-subscribe: no wire post — deliver the subscribe directly to our own
  // receive loop. Prologue registers (id, from) and rewrites opName so the
  // local @/# handler arm produces the initial `re`; _route delivers that
  // back into our own pending correlation. `to` is the bare selector (local).
  if (isSelfTarget) {
    const toExpr = JSON.stringify(toSelector);
    return `
        {${pendingSetup}
          this.receive({ id: _sub_id, op: ${opExpr}, to: ${toExpr}, from: '__parent', _route: (msg) => this.receive(msg)${bvaField} });
        }`;
  }
  // Cell-handle subscribe: target is a state var holding `{host, cell}`. The
  // `to` selector and routing target are read from the handle at runtime.
  // Replies route back through this actor's receive (parent dispatch).
  if (isCellHandleTarget) {
    const handle = `this.#${stateKey(target.name)}`;
    return `
        {${pendingSetup}
          ${handle}.host.receive({ id: _sub_id, op: ${opExpr}, to: ('@' + ${handle}.cell), from: '__parent', _route: (msg) => this.receive(msg)${bvaField} });
        }`;
  }
  // Remote dep (declared via `*( "Alias": (Alias) { ... } )`): post through
  // binding addressed to "#<alias selector>" — hash-angle delimited.
  if (ctx.dependencyNames?.has(objectName) && !ctx.stateVarNames?.has(objectName)) {
    const toExpr = JSON.stringify('#<' + encAddr(objectName) + ' ' + encAddr(toSelector) + '>');
    return `
        {${pendingSetup}
          this.#binding.post({ id: _sub_id, op: ${opExpr}, to: ${toExpr}${bvaField} });
        }`;
  }
  // Local or state-held child actor instance: route via child.receive. `to`
  // is the bare selector — the child is the receiver, so no alias needed.
  let childTarget;
  if (ctx.stateVarNames?.has(objectName)) {
    childTarget = `this.#${stateKey(objectName)}`;
  } else {
    const resolved = ctx.ssaScope?.get(objectName) || jsIdent(objectName);
    childTarget = ctx.childActorVars?.get(objectName) ? `${resolved}.value` : resolved;
  }
  const toExpr = JSON.stringify(toSelector);
  return `
        {${pendingSetup}
          ${childTarget}.receive({ id: _sub_id, op: ${opExpr}, to: ${toExpr}, from: '__parent', _route: (msg) => this.receive(msg)${bvaField} });
        }`;
}



// SSA / uniform 1-indexed binding context.
//
// Every user-level binding emits as `const ${name}__${n} = ${rhs}` where n
// starts at 1. There is no "first binding has no suffix" special case — this
// makes the naming collision-proof (a user-written `x__1` becomes `x__1__1`)
// and matches the Erlang backend.
//
// The scope map (`scope`) tracks source-name → current SSA name. genExpr
// reads from ctx.ssaScope to resolve identifier references to the right
// SSA-suffixed name. Outer-scope names passed in via `initialDeclared`
// (e.g. function parameters, captured free vars) are entered as identity
// mappings so they pass through unchanged.
//
// Both `scope` and `counts` are stored on ctx so helpers (destructure,
// list-destructure, etc) can mint SSA names without holding a reference to
// the binding context object. Use `mintSsaName(ctx, name)` to advance the
// count and update the scope without emitting a `const` line.
export function makeBindingContext(body, initialDeclared, indent) {
  const scope = new Map();
  for (const name of initialDeclared) scope.set(name, jsIdent(name));
  const counts = new Map();
  const seen = (name) => counts.has(name);
  const emitBinding = (name, rhs) => {
    const ssaName = mintSsaNameIn(scope, counts, name);
    return `\n${indent}const ${ssaName} = ${rhs};`;
  };
  return { scope, counts, seen, emitBinding };
}



// Returns true when a function body contains a statement whose codegen emits
// an early `return Structure.pack(...)` that would short-circuit the
// enclosing JS function. Top-level conditional return AND a `Return` (or
// nested conditional return) inside a `repeat while` body both qualify.
export function bodyHasEarlyReturn(body) {
  for (const s of body) {
    if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasBlockBodies(s.expr)) return true;
    if (s.type === 'WhileStatement' && Array.isArray(s.body) && whileBodyHasEarlyReturn(s.body)) return true;
  }
  return false;
}

function whileBodyHasEarlyReturn(body) {
  for (const s of body) {
    if (s.type === 'Return') return true;
    if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasBlockBodies(s.expr)) return true;
    if (s.type === 'WhileStatement' && Array.isArray(s.body) && whileBodyHasEarlyReturn(s.body)) return true;
  }
  return false;
}

export function hasBlockBodies(ifExpr) {
  if (ifExpr.then?.body) return true;
  const e = ifExpr.else;
  if (!e) return false;
  if (e.type === 'IfExpr') return hasBlockBodies(e);
  return e.body != null;
}

export function genFunctionBodyCode(ctx, params, body, outerEnv = null, declaredReturnType = null) {
  const { env: typeEnv } = buildTypeEnv(params, body, null, null, ctx.typeDecls);
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;
  // Save parent SSA scope; lambda body has its own fresh scope. Parameters
  // pass through unsuffixed (they're JS function-locals via destructuring),
  // so they enter the scope as identity mappings via makeBindingContext's
  // initialDeclared.
  const savedSsaScope = ctx.ssaScope;
  const savedSsaCounts = ctx.ssaCounts;
  const destr = genDestructure(ctx, params, '  ');
  const bindingCtx = makeBindingContext(
    body, params.map(p => p.name).filter(Boolean), '  ',
  );
  const { emitBinding } = bindingCtx;
  ctx.ssaScope = bindingCtx.scope;
  ctx.ssaCounts = bindingCtx.counts;
  let code = '';
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  let _lastTypedName = null;
  let _lastIsWhile = false;
  let _lastSetName = null;
  for (const s of body) {
    // Value-carrying catch in assignment / function-tail positions — emit
    // a hoisted JS local, run the labeled block, then thread the result.
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'CatchExpr' && !s.value.isVoid) {
      _lastTypedName = s.type === 'TypedAssign' ? s.name : null;
      _lastIsWhile = false;
      _lastSetName = null;
      const tmp = `_catch_r${ctx.catchLabelCounter}`;
      code += genCatchValueIntoTemp(ctx, s.value, '  ', outerEnv, counters, tmp);
      code += `\n  const ${jsIdent(s.name)} = ${tmp};`;
      ctx.ssaScope?.set(s.name, jsIdent(s.name));
      continue;
    }
    if (s.type === 'ImplicitReturn' && s.expr?.type === 'CatchExpr' && !s.expr.isVoid) {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      const tmp = `_catch_r${ctx.catchLabelCounter}`;
      code += genCatchValueIntoTemp(ctx, s.expr, '  ', outerEnv, counters, tmp);
      code += `\n  return Structure.pack([${tmp}]);`;
      continue;
    }
    const catchCode = tryGenCatchOrLabelStmt(ctx, s, '  ', outerEnv, counters);
    if (catchCode !== null) {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      code += catchCode;
      continue;
    }
    if (s.type === 'BareTypeDecl') {
      continue; // no JS output — type annotation only
    } else if (s.type === 'RefDecl') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
      code += `\n  const ${s.name} = {value: ${rhs}};`;
    } else if (s.type === 'SetStatement') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = s.name;
      if (ctx.childActorVars.has(s.name)) {
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        code += `\n  ${s.name}.value.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      } else if (ctx.stateVarNames.has(s.name)) {
        code += `\n  this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
      } else {
        code += `\n  ${s.name}.value = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'ListDestructure') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      code += genListDestructureAssign(ctx, s, _ldIdx++, '  ');
    } else if (s.type === 'Assign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      if (s.value.type === 'StructureLiteral') {
        code += emitBinding(s.name, genExpr(ctx, s.value));
      } else if (s.value.type === 'ListLiteral') {
        code += emitBinding(s.name, genExpr(ctx, s.value));
      } else if (s.value.type === 'StructureConstructor') {
        code += emitBinding(s.name, `(${genExpr(ctx, s.value)}).positional[0]`);
      } else if (CALL_LIKE.has(s.value.type)) {
        code += emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
      } else if (s.value.type === 'Function') {
        if (lambdaUsesOuterRefs(ctx, s.value)) {
          if (s.value.body) {
            const fnCode = genFunctionBodyCode(ctx, s.value.params, s.value.body, outerEnv, s.value.returnType);
            code += emitBinding(s.name, wrapWithCapture(ctx, fnCode, s.value, s.name));
          } else {
            const destr2 = genDestructure(ctx, s.value.params, '  ');
            if (s.value.returnType === '.') {
              code += emitBinding(s.name, wrapWithCapture(ctx, `async (_s) => {${destr2}\n  ${genExpr(ctx, s.value.expr)};\n}`, s.value, s.name));
            } else {
              code += emitBinding(s.name, wrapWithCapture(ctx, `async (_s) => {${destr2}\n  return Structure.pack([${genExpr(ctx, s.value.expr)}]);\n}`, s.value, s.name));
            }
          }
        } else {
          const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
          ctx.lambdaVarNames.add(s.name);
          const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          for (const v of freeVars) {
            const fieldName = `_cap_${lambdaName}_${v}`;
            ctx.lambdaCaptureFields.push(fieldName);
            // Resolve the captured name through the OUTER scope (current
            // ctx.ssaScope) — we haven't descended into the lambda body yet.
            const src = ctx.stateVarNames.has(v) ? `this.#${stateKey(v)}` : (ctx.ssaScope?.get(v) || jsIdent(v));
            code += `\n  this.#${fieldName} = ${src};`;
          }
          ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName })) });
          code += emitBinding(s.name, `"${lambdaName}"`);
        }
      } else {
        code += emitBinding(s.name, genExpr(ctx, s.value));
      }
    } else if (s.type === 'TypedAssign') {
      _lastTypedName = s.name;
      _lastIsWhile = false;
      _lastSetName = null;
      code += genTypedAssignStmt(ctx, s, emitBinding, typeEnv, '  ', counters);
    } else if (s.type === 'DestructureAssign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        code += `\n  const ${tmp} = ${genExpr(ctx, s.source)};`;
        code += genDestructureAssign(ctx, s, tmp, '  ');
      } else {
        code += genDestructureAssign(ctx, s, undefined, '  ');
      }
    } else if (s.type === 'StateAssign') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      code += `\n  this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'WhileStatement') {
      _lastTypedName = null;
      _lastIsWhile = true;
      _lastSetName = null;
      code += genWhileStatement(ctx, s, '  ', outerEnv, counters);
    } else if (s.type === 'Return') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      code += `\n  return Structure.pack(${genReBody(ctx, s.fields, typeEnv, declaredReturnType)});`;
    } else if (s.type === 'ImplicitReturn') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      if (s.expr.type === 'IfExpr') {
        const tmpVar = `_if${counters.ifIdx++}`;
        const chainCode = genIfChain(ctx, s.expr, tmpVar, outerEnv).replace(/\n {8}/g, '\n  ');
        code += `\n  let ${tmpVar} = null;\n  ${chainCode}`;
        if (!hasBlockBodies(s.expr)) {
          code += `\n  return Structure.pack([${tmpVar}]);`;
        }
      } else if (declaredReturnType === '.') {
        code += `\n  ${genExpr(ctx, s.expr)};`;
      } else {
        const exprCode = genExpr(ctx, s.expr);
        const isChildSend = exprCode.includes('this.#childSend');
        const isSelfSend = exprCode.includes('this.#send(');
        const needsAwait = isChildSend || isSelfSend;
        // A child-send returns a wire-shape reply (named or positional). To
        // produce a single positional value for the surrounding `over` /
        // assignment context, extract via Structure.one with named fallback.
        // Method name comes from the DotCallExpr — used as the named-fallback key.
        if (isChildSend && s.expr.type === 'DotCallExpr') {
          const key = JSON.stringify(s.expr.method);
          code += `\n  { const _r = Structure.pack(await ${exprCode}); const _v = _r.named[${key}] !== undefined ? _r.named[${key}] : Structure.one(_r, ${key}); return Structure.pack([_v]); }`;
        } else {
          code += `\n  return Structure.pack([${needsAwait ? 'await ' : ''}${exprCode}]);`;
        }
      }
    }
  }
  if (declaredReturnType !== '.' && declaredReturnType !== '()') {
    if (_lastTypedName !== null) {
      // Resolve through SSA scope so the return references the latest binding.
      const resolved = ctx.ssaScope?.get(_lastTypedName) || jsIdent(_lastTypedName);
      code += `\n  return Structure.pack([${resolved}]);`;
    } else if (_lastSetName !== null) {
      code += `\n  return Structure.pack([${_lastSetName}.value]);`;
    }
  }
  ctx.currentTypeEnv = savedTypeEnv;
  ctx.ssaScope = savedSsaScope;
  ctx.ssaCounts = savedSsaCounts;
  return `async (_s) => {${destr}${code}\n}`;
}

export function genIfBlockBody(ctx, body, tmpVar, _outerEnv) {
  let code = '';
  let _rIdx = 0;
  let _innerIfIdx = 0;
  let lastTypedName = null;
  for (const s of body) {
    const catchCode = tryGenCatchOrLabelStmt(ctx, s, '        ', _outerEnv, { ifIdx: 0 });
    if (catchCode !== null) { lastTypedName = null; code += catchCode; continue; }
    if (s.type === 'BareTypeDecl') continue;
    if (s.type === 'TypedAssign') {
      lastTypedName = s.name;
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n        const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n        const ${s.name} = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'Assign') {
      lastTypedName = null;
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n        const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n        const ${s.name} = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'DestructureAssign') {
      lastTypedName = null;
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_rIdx++}`;
        code += `\n        const ${tmp} = ${genExpr(ctx, s.source)};`;
        code += genDestructureAssign(ctx, s, tmp);
      } else {
        code += genDestructureAssign(ctx, s);
      }
    } else if (s.type === 'StateAssign') {
      lastTypedName = null;
      code += `\n        this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'SetStatement') {
      lastTypedName = null;
      code += ctx.stateVarNames.has(s.name)
        ? `\n        this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`
        : `\n        ${jsIdent(s.name)}.value = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'RefDecl') {
      lastTypedName = null;
      const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
      code += `\n        const ${s.name} = {value: ${rhs}};`;
    } else if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasBlockBodies(s.expr)) {
      lastTypedName = null;
      const innerVar = `${tmpVar}_n${_innerIfIdx++}`;
      code += `\n        let ${innerVar} = null;\n        `;
      code += genIfChain(ctx, s.expr, innerVar, _outerEnv);
    } else if (s.type === 'ImplicitReturn') {
      lastTypedName = null;
      code += `\n        ${tmpVar} = ${genExpr(ctx, s.expr)};`;
    } else if (s.type === 'Return') {
      lastTypedName = null;
      code += `\n        return Structure.pack(${genReBody(ctx, s.fields, ctx.currentTypeEnv)});`;
    }
  }
  if (lastTypedName !== null) {
    code += `\n        ${tmpVar} = ${lastTypedName};`;
  }
  return code;
}

export function genIfChain(ctx, ifExpr, tmpVar, outerEnv) {
  const condCode = genExpr(ctx, ifExpr.cond);
  const truthy = `(${condCode}) !== false && (${condCode}) !== null`;

  const genBranch = (branch) => {
    if (!branch) return `\n        ${tmpVar} = null;`;
    if (branch.type === 'IfExpr') return `\n        ` + genIfChain(ctx, branch, tmpVar, outerEnv);
    if (branch.body)              return genIfBlockBody(ctx, branch.body, tmpVar, outerEnv);
    const raw = genExpr(ctx, branch.expr);
    const val = CALL_LIKE.has(branch.expr.type) ? `Structure.one(${raw}, '_')` : raw;
    return `\n        ${tmpVar} = ${val};`;
  };

  let code = `if (${truthy}) {`;
  code += genBranch(ifExpr.then);
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      code += `\n        } else ` + genIfChain(ctx, ifExpr.else, tmpVar, outerEnv);
    } else {
      code += `\n        } else {`;
      code += genBranch(ifExpr.else);
      code += `\n        }`;
    }
  } else {
    code += `\n        }`;
  }
  return code;
}

export function genWhileStatement(ctx, node, indent, outerEnv, counters = { ifIdx: 0 }) {
  const condCode = genExpr(ctx, node.cond);
  const inner = indent + '  ';
  let code;
  if (node.negated) {
    code = `\n${indent}while ((${condCode}) === false || (${condCode}) === null) {`;
  } else {
    code = `\n${indent}while ((${condCode}) !== false && (${condCode}) !== null) {`;
  }
  for (const s of node.body) {
    const catchCode = tryGenCatchOrLabelStmt(ctx, s, inner, outerEnv, counters);
    if (catchCode !== null) { code += catchCode; continue; }
    if (s.type === 'StateAssign') {
      code += `\n${inner}this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'TypedAssign') {
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n${inner}const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n${inner}const ${s.name} = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'Assign') {
      if (CALL_LIKE.has(s.value.type)) {
        code += `\n${inner}const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
      } else {
        code += `\n${inner}const ${s.name} = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'SetStatement') {
      if (ctx.childActorVars.has(s.name)) {
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        code += `\n${inner}${s.name}.value.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      } else if (ctx.stateVarNames.has(s.name)) {
        code += `\n${inner}this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
      } else {
        code += `\n${inner}${jsIdent(s.name)}.value = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'WhileStatement') {
      code += genWhileStatement(ctx, s, inner, outerEnv, counters);
    } else if (s.type === 'Return') {
      code += `\n${inner}return Structure.pack(${genReBody(ctx, s.fields, ctx.currentTypeEnv)});`;
    } else if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasBlockBodies(s.expr)) {
      const tmpVar = `_if${counters.ifIdx++}`;
      const chainCode = genIfChain(ctx, s.expr, tmpVar, outerEnv).replace(/\n {8}/g, `\n${inner}`);
      code += `\n${inner}let ${tmpVar} = null;\n${inner}${chainCode}`;
    } else if (s.type === 'ExprStatement') {
      code += `\n${inner}${genExpr(ctx, s.expr)};`;
    }
  }
  code += `\n${indent}}`;
  return code;
}

export function findAsClauseMatch(ctx, targetType, actorName) {
  if (!ctx.actorNames.has(actorName)) return null;
  const info = ctx.actorNames.get(actorName);
  if (!info.asClauses || info.asClauses.length === 0) return null;
  if (targetType === actorName) return null; // identity — no cast
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return clause;
    if (clause.negated && clause.targetType !== targetType) return clause;
  }
  return null; // validation should have caught this
}

// Detect: name = Dep(args) where Dep is a declared dependency. The construction
// must emit `new` and bind the result address to a function-local var.
function isDepConstructorCall(ctx, s) {
  if (s.value?.type !== 'FunctionCallExpr' || s.value.callee?.type !== 'Identifier') return false;
  const name = s.value.callee.name;
  if (!ctx.dependencyNames.has(name)) return false;
  if (ctx.destructuredMembers?.has(name)) return false;
  return true;
}

// Emit a function-local dep construction:
//   const t = await this.#sendNew({a: 5}, "Thing");
// Tracks t in ctx.localInstanceVars so subsequent t.method() calls in this
// body route via `this.#send(op, t)` instead of `this.#send(op, this.#t)`.
function genDepConstructorAssign(ctx, s, emitBinding) {
  const calleeName = s.value.callee.name;
  const targetName = ctx.constructorCoercions?.get(calleeName) || calleeName;
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  let argsExpr;
  if (positionalArgs.length === 0 && !namedBag) {
    argsExpr = '{}';
  } else if (namedBag) {
    const fields = Object.entries(namedBag.fields).map(([k, v]) => `${k}: ${genExpr(ctx, v)}`).join(', ');
    if (positionalArgs.length > 0) {
      argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}, {${fields}}]`;
    } else {
      argsExpr = `{${fields}}`;
    }
  } else {
    argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}]`;
  }
  ctx.localInstanceVars.add(s.name);
  return emitBinding(s.name, `await this.#sendNew(${argsExpr}, ${JSON.stringify(targetName)})`);
}

function genDepConstructorAsAssign(ctx, s, emitBinding) {
  const calleeName = s.value.callee.name;
  const targetName = ctx.constructorCoercions?.get(calleeName) || calleeName;
  const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
  let argsExpr;
  if (positionalArgs.length === 0 && !namedBag) {
    argsExpr = '{}';
  } else if (namedBag) {
    const fields = Object.entries(namedBag.fields).map(([k, v]) => `${k}: ${genExpr(ctx, v)}`).join(', ');
    if (positionalArgs.length > 0) {
      argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}, {${fields}}]`;
    } else {
      argsExpr = `{${fields}}`;
    }
  } else {
    argsExpr = `[${positionalArgs.map(a => genExpr(ctx, a)).join(', ')}]`;
  }
  const tmpRef = `_ref_${s.name}`;
  const newLine = `const ${tmpRef} = await this.#sendNew(${argsExpr}, ${JSON.stringify(targetName)});`;
  const asLine = emitBinding(s.name, `(await this.#send([${JSON.stringify(s.typeName)}, "as"], ${tmpRef}))[0]`);
  return `\n        ${newLine}${asLine}`;
}

export function genTypedAssignStmt(ctx, s, emitBinding, outerEnv, indent, counters) {
  // Typed dep constructor: n Integer = Service() → sendNew then send [Type, as]
  if (isDepConstructorCall(ctx, s) && s.typeName) {
    return genDepConstructorAsAssign(ctx, s, emitBinding);
  }
  // Untyped dep constructor: t = Service() → just sendNew
  if (isDepConstructorCall(ctx, s)) return genDepConstructorAssign(ctx, s, emitBinding);
  // as-clause interception: TypedAssign + FunctionCallExpr naming an actor with as clauses
  if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorNames.has(s.value.callee.name)) {
    const clause = findAsClauseMatch(ctx, s.typeName, s.value.callee.name);
    if (clause) {
      if (clause.memoized) {
        const tmpRef = `_ref_${s.name}`;
        const createExpr = genExpr(ctx, s.value);
        const newLine = `const ${tmpRef} = ${createExpr};`;
        const asLine = emitBinding(s.name, `(await this.#childSend(${tmpRef}, [${JSON.stringify(s.typeName)}, "as"]))[0]`);
        return `\n        ${newLine}${asLine}`;
      }
      return emitBinding(s.name, genExpr(ctx, clause.expr));
    }
  }
  // Typed assign of Self() or a known actor ctor (when no as-clause matched
  // above) — bind the actor instance directly. Structure.one would interpret
  // the instance as a structure-pack and crash on s.positional.length.
  if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' &&
      (s.value.callee.name === 'Self' || ctx.actorNames.has(s.value.callee.name))) {
    return emitBinding(s.name, genExpr(ctx, s.value));
  }
  // Typed assign from service dependency: n Integer = Counter → send [Type, as]
  // For destructured members, route to the source service with the remote op name
  if (s.value.type === 'Identifier' && ctx.dependencyNames.has(s.value.name) && s.typeName) {
    if (ctx.destructuredMembers?.has(s.value.name)) {
      const { service, remote } = ctx.destructuredMembers.get(s.value.name);
      return emitBinding(s.name, `(await this.#send(${JSON.stringify('@' + remote)}, ${JSON.stringify(service)}))[0]`);
    }
    const target = ctx.stateVarNames.has(s.value.name) ? `this.#${stateKey(s.value.name)}` : JSON.stringify(s.value.name);
    return emitBinding(s.name, `(await this.#send([${JSON.stringify(s.typeName)}, "as"], ${target}))[0]`);
  }
  // Typed assign from child actor ref: n Integer = c → childSend [Type, as]
  if (s.value.type === 'Identifier' && s.typeName) {
    const varName = s.value.name;
    if (ctx.childActorVars?.has(varName)) {
      const resolved = ctx.ssaScope?.get(varName) || varName;
      const target = ctx.childActorVars.get(varName) ? `${resolved}.value` : resolved;
      return emitBinding(s.name, `(await this.#childSend(${target}, [${JSON.stringify(s.typeName)}, "as"]))[0]`);
    }
    if (ctx.localInstanceVars?.has(varName)) {
      const resolved = ctx.ssaScope?.get(varName) || varName;
      return emitBinding(s.name, `(await this.#send([${JSON.stringify(s.typeName)}, "as"], ${resolved}))[0]`);
    }
    if (ctx.remoteInstanceVars?.has(varName)) {
      return emitBinding(s.name, `(await this.#send([${JSON.stringify(s.typeName)}, "as"], this.#${stateKey(varName)}))[0]`);
    }
  }
  if (s.value.type === 'IfExpr') {
    const tmpVar = `_if${counters.ifIdx++}`;
    return (
      `\n${indent}let ${tmpVar} = null;` +
      `\n${indent}` + genIfChain(ctx, s.value, tmpVar, outerEnv).replace(/\n {8}/g, `\n${indent}`) +
      emitBinding(s.name, tmpVar)
    );
  }
  if (s.typeName === 'Structure') return emitBinding(s.name, genExpr(ctx, s.value));
  // Function-typed variable assignment → lambda dispatch handler
  if (s.value.type === 'Function') {
    const overloadMode = s.value.overloadMode;
    const isFnType = s.typeName === 'Function' || (typeof s.typeName === 'string' && s.typeName.includes('->'));
    if ((isFnType || overloadMode) && !lambdaUsesOuterRefs(ctx, s.value)) {
      // Overload append: reuse existing label for this variable (scoped to current body)
      if (overloadMode === 'append') {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          let captureCode = '';
          for (const v of freeVars) {
            const fieldName = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureFields.push(fieldName);
            const src = ctx.stateVarNames.has(v) ? `this.#${stateKey(v)}` : (ctx.ssaScope?.get(v) || jsIdent(v));
            captureCode += `\n${indent}this.#${fieldName} = ${src};`;
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          ctx.lambdaHandlers.push(entry);
          return captureCode;
        }
      }
      // Create: new lambda label
      const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
      ctx.lambdaVarNames.add(s.name);
      const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
      let captureCode = '';
      for (const v of freeVars) {
        const fieldName = `_cap_${lambdaName}_${v}`;
        ctx.lambdaCaptureFields.push(fieldName);
        const src = ctx.stateVarNames.has(v) ? `this.#${stateKey(v)}` : (ctx.ssaScope?.get(v) || jsIdent(v));
        captureCode += `\n${indent}this.#${fieldName} = ${src};`;
      }
      ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName })) });
      // Empty Function() initializer: body is empty, no binding needed (will be populated by << / >>)
      if (s.value.params.length === 0 && (!s.value.body || s.value.body.length === 0) && !s.value.expr) {
        return captureCode + emitBinding(s.name, `"${lambdaName}"`);
      }
      return captureCode + emitBinding(s.name, `"${lambdaName}"`);
    }
  }
  if (s.value.type === 'DotCallExpr') {
    const tmpVar = `_tmp_${s.name}`;
    const inner = `Structure.pack(await ${genExpr(ctx, s.value)})`;
    const prefix = `const ${tmpVar} = ${inner};\n        `;
    let valExpr = `${tmpVar}.named[${JSON.stringify(s.name)}] !== undefined ? ${tmpVar}.named[${JSON.stringify(s.name)}] : Structure.one(${tmpVar}, ${JSON.stringify(s.name)})`;
    // List-typed reply from a child actor arrives as a JS array (the sender
    // ran _List.toArray on its outbound). Convert back to a cons cell here so
    // the bound local can be passed straight into _bv_list_* helpers.
    if (typeof s.typeName === 'string' && /^List(\b|$)/.test(s.typeName)) {
      valExpr = `(v => Array.isArray(v) ? _List.from(v) : v)(${valExpr})`;
    }
    return prefix + emitBinding(s.name, valExpr);
  }
  // Destructured member call: v = greet(name) → same as DotCallExpr but callee is bare ident
  if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.destructuredMembers?.has(s.value.callee.name)) {
    const tmpVar = `_tmp_${s.name}`;
    const inner = `Structure.pack(await ${genExpr(ctx, s.value)})`;
    const prefix = `const ${tmpVar} = ${inner};\n        `;
    return prefix + emitBinding(s.name, `${tmpVar}.named[${JSON.stringify(s.name)}] !== undefined ? ${tmpVar}.named[${JSON.stringify(s.name)}] : Structure.one(${tmpVar}, ${JSON.stringify(s.name)})`);
  }
  // Bare field read on a child actor: v = c.val (same shape as no-args DotCallExpr)
  if (s.value.type === 'DotAccessExpr' && s.value.object?.type === 'Identifier' && ctx.childActorVars?.has(s.value.object.name)) {
    const tmpVar = `_tmp_${s.name}`;
    const inner = `Structure.pack(await ${genExpr(ctx, s.value)})`;
    const prefix = `const ${tmpVar} = ${inner};\n        `;
    return prefix + emitBinding(s.name, `${tmpVar}.named[${JSON.stringify(s.name)}] !== undefined ? ${tmpVar}.named[${JSON.stringify(s.name)}] : Structure.one(${tmpVar}, ${JSON.stringify(s.name)})`);
  }
  if (CALL_LIKE.has(s.value.type))
    return emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
  if (s.value.type === 'StructureConstructor')
    return emitBinding(s.name, `(${genExpr(ctx, s.value)}).positional[0]`);
  return emitBinding(s.name, genExpr(ctx, s.value));
}

// IMPORTANT: genLocals SETS ctx.ssaScope and ctx.ssaCounts and leaves them
// set on return so the caller can use the same scope when emitting the
// reply / implicit return. Callers must save and restore both themselves.
export function genLocals(ctx, body, outerEnv) {
  const bindingCtx = makeBindingContext(
    body, outerEnv.keys(), '        ',
  );
  const { emitBinding, seen } = bindingCtx;
  ctx.ssaScope = bindingCtx.scope;
  ctx.ssaCounts = bindingCtx.counts;
  // Per-handler-body fresh set; collected as dep constructor calls are emitted
  ctx.localInstanceVars = new Set();
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  // Track lambda handler start index for scoped overload lookups
  const _lambdaStartIdx = ctx.lambdaHandlers.length;
  ctx._lambdaStartIdx = _lambdaStartIdx;
  ctx.childActorVars = new Map();
  const isActorCtorCall = (e) =>
    e?.type === 'FunctionCallExpr' && e.callee?.type === 'Identifier' &&
    (ctx.actorNames.has(e.callee.name) || e.callee.name === 'Self');
  const refVars = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') {
      refVars.add(s.name);
      if (isActorCtorCall(s.value))
        ctx.childActorVars.set(s.name, true);
    }
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && isActorCtorCall(s.value))
      ctx.childActorVars.set(s.name, false);
    // A TypedAssign whose declared type is an actor class binds an actor
    // ref — e.g., `p Peer = peers.first()` returns the head Peer instance.
    // Mark it so `p.method()` later compiles as #childSend, not #send.
    if (s.type === 'TypedAssign' && typeof s.typeName === 'string' && ctx.actorNames.has(s.typeName))
      ctx.childActorVars.set(s.name, false);
  }
  const stmts = body.filter(s => s.type === 'Assign' || s.type === 'DestructureAssign' || s.type === 'TypedAssign' || s.type === 'ListDestructure' || s.type === 'StateAssign' || s.type === 'WhileStatement' || s.type === 'RefDecl' || s.type === 'SetStatement' || s.type === 'ActorSetStatement' || s.type === 'ActorFieldSet' || s.type === 'IfStatement' || s.type === 'ExprStatement' || s.type === 'SpawnStatement' || (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && hasBlockBodies(s.expr)) || (s.type === 'ImplicitReturn' && (s.expr?.type === 'CatchExpr' || s.expr?.type === 'LabelInvoke')) || (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && ifContainsLabelExit(s.expr)));
  const result = stmts.map(s => {
    // Value-carrying catch on RHS of (Typed)Assign — emit hoisted local first.
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'CatchExpr' && !s.value.isVoid) {
      const tmp = `_catch_r${ctx.catchLabelCounter}`;
      const block = genCatchValueIntoTemp(ctx, s.value, '        ', outerEnv, counters, tmp);
      return block + `\n        const ${jsIdent(s.name)} = ${tmp};`;
    }
    // Value-carrying catch as the handler-tail ImplicitReturn — emit the
    // labeled block + result temp + `re = [_tmp];`. The reply line in
    // genPublicFn is suppressed when this branch fires.
    if (s.type === 'ImplicitReturn' && s.expr?.type === 'CatchExpr' && !s.expr.isVoid) {
      const tmp = `_catch_r${ctx.catchLabelCounter}`;
      const block = genCatchValueIntoTemp(ctx, s.expr, '        ', outerEnv, counters, tmp);
      return block + `\n        re = [${tmp}];`;
    }
    const catchCode = tryGenCatchOrLabelStmt(ctx, s, '        ', outerEnv, counters);
    if (catchCode !== null) return catchCode;
    if (s.type === 'RefDecl') {
      const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
      return `\n        const ${s.name} = {value: ${rhs}};`;
    }
    if (s.type === 'SetStatement') {
      const resolved = ctx.ssaScope?.get(s.name) || jsIdent(s.name);
      if (ctx.childActorVars.has(s.name)) {
        const target = ctx.childActorVars.get(s.name) ? `${resolved}.value` : resolved;
        const wireOp = s.updateOp === '<|' ? 'update' : 'set';
        return `\n        ${target}.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      }
      if (ctx.stateVarNames.has(s.name)) {
        // Private (or public) state-ref mutation may trigger re-evaluation of
        // any non-silent public fn whose body captures this ref. For each
        // such fn, re-dispatch @fn per registered subscriber with their
        // stored args so they receive the updated derived value.
        let replay = '';
        const derivedFns = ctx._refCapturedBy?.get(s.name);
        if (derivedFns && derivedFns.size > 0) {
          for (const fnFullName of derivedFns) {
            const fnKey = JSON.stringify(fnFullName.slice(1));
            const fnOpAt = JSON.stringify(fnFullName);
            replay += `
        { const _fnSubs = this.#_cellSubs?.get(${fnKey}); if (_fnSubs) for (const _sub of _fnSubs) {
          const _op = _sub.args != null ? [_sub.args, ${fnOpAt}] : ${fnOpAt};
          this.#dispatch({ id: _sub.id, op: _op, from: '__parent', _replyTo: _sub.from, _route: _sub.route || ((m) => this.#binding.post(m)) });
        } }`;
          }
        }
        return `\n        this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};${replay}`;
      }
      if (!refVars.has(s.name)) {
        throw new Error(`Cannot set '${s.name}' — only 'ref' variables and actor instances support '<-'`);
      }
      return `\n        ${resolved}.value = ${genExpr(ctx, s.value)};`;
    }
    if (s.type === 'ActorFieldSet') {
      // Wire shape: op is bare "set"; the `@<field>` selector lives in the
      // `to` field (space-delimited after the addr, if any). Dispatch
      // prologue re-synthesizes the internal `set@<field>` opName.
      const wireOp = 'set';
      const toSelector = '@' + s.fieldName;
      const v = genExpr(ctx, s.value);
      // Remote dep (imported via *( "Alias": (Alias) { ... } )): post via
      // binding addressed to "<<alias selector>>" — the whole address is one
      // hash-angle delimited "#<alias selector>". Include `bv-a` so the
      // remote's schema check succeeds.
      if (ctx.dependencyNames?.has(s.objectName) && !ctx.stateVarNames?.has(s.objectName)) {
        const inferred = inferLiteralType(s.value);
        const envType = s.value?.type === 'Identifier' ? ctx.currentTypeEnv?.get(s.value.name) : null;
        const typeHint = inferred || envType || null;
        const bvaField = typeHint ? `, 'bv-a': [[${JSON.stringify(typeHint)}]]` : '';
        const toExpr = JSON.stringify('#<' + encAddr(s.objectName) + ' ' + encAddr(toSelector) + '>');
        return `\n        this.#binding.post({ op: [[${v}], "#set"], to: ${toExpr}${bvaField} });`;
      }
      let target;
      if (ctx.stateVarNames?.has(s.objectName)) {
        target = `this.#${stateKey(s.objectName)}`;
      } else {
        const resolved = ctx.ssaScope?.get(s.objectName) || jsIdent(s.objectName);
        target = ctx.childActorVars?.get(s.objectName) ? `${resolved}.value` : resolved;
      }
      // Child actor: bare selector (child is the receiver; no alias needed).
      const toExpr = JSON.stringify(toSelector);
      return `\n        ${target}.receive({ op: [[${v}], ${JSON.stringify(wireOp)}], to: ${toExpr}, from: '__parent' });`;
    }
    if (s.type === 'ActorSetStatement') {
      const resolved = ctx.ssaScope?.get(s.name) || jsIdent(s.name);
      const target = ctx.childActorVars.get(s.name) ? `${resolved}.value` : resolved;
      const wireOp = s.updateOp === '<|' ? 'update' : 'set';
      const pos = s.args.filter(a => a.positional).map(a => genExpr(ctx, a.expr));
      const named = s.args.filter(a => !a.positional);
      let payload;
      if (named.length > 0) {
        const obj = named.map(a => `${a.name}: ${genExpr(ctx, a.expr)}`).join(', ');
        if (pos.length > 0) {
          payload = `[${pos.join(', ')}, {${obj}}]`;
        } else {
          payload = `{${obj}}`;
        }
      } else {
        payload = `[${pos.join(', ')}]`;
      }
      return `\n        ${target}.receive({ op: [${payload}, "${wireOp}"], from: '__parent' });`;
    }
    if (s.type === 'IfStatement') {
      const condCode = genExpr(ctx, s.cond);
      const truthy = `(${condCode}) !== false && (${condCode}) !== null`;
      let code = `\n        if (${truthy}) {`;
      for (const stmt of s.body) {
        if (stmt.type === 'SetStatement') {
          const stmtResolved = ctx.ssaScope?.get(stmt.name) || jsIdent(stmt.name);
          if (ctx.childActorVars.has(stmt.name)) {
            const wireOp = stmt.updateOp === '<|' ? 'update' : 'set';
            code += `\n          ${stmtResolved}.value.receive({ op: [[${genExpr(ctx, stmt.value)}], "${wireOp}"], from: '__parent' });`;
          } else {
            code += `\n          ${stmtResolved}.value = ${genExpr(ctx, stmt.value)};`;
          }
        }
      }
      code += `\n        }`;
      return code;
    }
    if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr') {
      const tmpVar = `_if${counters.ifIdx++}`;
      const chainCode = genIfChain(ctx, s.expr, tmpVar, outerEnv);
      return `\n        let ${tmpVar} = null;\n        ${chainCode}`;
    }
    if (s.type === 'ExprStatement') {
      if (s.expr?.type === 'SubscribeCall') {
        return genSubscribeCall(ctx, s.expr);
      }
      const code = genExpr(ctx, s.expr);
      // Await child actor calls so side effects complete before continuing
      const needsAwait = code.includes('#childSend') || code.includes('#send(');
      return `\n        ${needsAwait ? 'await ' : ''}${code};`;
    }
    if (s.type === 'SpawnStatement') {
      const call = s.call;
      if (call.type === 'DotCallExpr') {
        return `\n        ${genExpr(ctx, call)};`;
      }
      const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
      const op = call.args.length === 0
        ? `"${call.callee.name}"`
        : `[[${call.args.map(genArg).join(', ')}], "${call.callee.name}"]`;
      return `\n        this.#selfSend(${op});`;
    }
    if (s.type === 'WhileStatement') {
      return genWhileStatement(ctx, s, '        ', outerEnv, counters);
    }
    if (s.type === 'StateAssign') {
      return `\n        this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
    }
    if (s.type === 'ListDestructure') {
      return genListDestructureAssign(ctx, s, _ldIdx++);
    }
    if (s.type === 'DestructureAssign') {
      // Destructured member call: :v = greet(name) → same await path as DotCallExpr
      if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && ctx.destructuredMembers?.has(s.source.callee.name)) {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = Structure.pack(await ${genExpr(ctx, s.source)});` + genDestructureAssign(ctx, s, tmp);
      }
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = ${genExpr(ctx, s.source)};` + genDestructureAssign(ctx, s, tmp);
      }
      if (s.source.type === 'DotCallExpr') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = Structure.pack(await ${genExpr(ctx, s.source)});` + genDestructureAssign(ctx, s, tmp);
      }
      // Bare field read on a child actor: :v = c.val — same handling as DotCallExpr
      if (s.source.type === 'DotAccessExpr' && s.source.object?.type === 'Identifier' && ctx.childActorVars?.has(s.source.object.name)) {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = Structure.pack(await ${genExpr(ctx, s.source)});` + genDestructureAssign(ctx, s, tmp);
      }
      return genDestructureAssign(ctx, s);
    }
    if (s.type === 'TypedAssign') {
      return genTypedAssignStmt(ctx, s, emitBinding, outerEnv, '        ', counters);
    }
    // Plain assign
    // Dependency constructor: t = Thing(args) → `new` + local instance binding
    if (isDepConstructorCall(ctx, s)) return genDepConstructorAssign(ctx, s, emitBinding);
    if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && (ctx.actorNames.has(s.value.callee.name) || s.value.callee.name === 'Self')) {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    // Lambda overload << / >> — must be checked before the seen() shortcut.
    // After the first emission of `name`, treat further plain Assigns as
    // value rebindings (no new lambda handler created). Under SSA every
    // emission is a fresh binding anyway; this gate just routes Function
    // literals on rebinds through the value path rather than registering
    // them as new dispatch handlers.
    if (s.value.type === 'Function' && s.value.overloadMode) {
      // Falls through to the Function handler below
    } else if (seen(s.name)) {
      if (s.value.type === 'StructureConstructor') {
        return emitBinding(s.name, `(${genExpr(ctx, s.value)}).positional[0]`);
      }
      if (CALL_LIKE.has(s.value.type)) {
        return emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
      }
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'StructureLiteral') {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'ListLiteral') {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'StructureConstructor') {
      throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
    }
    if (s.value.type === 'Function') {
      const overloadMode = s.value.overloadMode;
      // Lambdas that set outer refs must remain closures (can't be lifted)
      if (!overloadMode && lambdaUsesOuterRefs(ctx, s.value)) {
        if (s.value.body) {
          const fnCode = genFunctionBodyCode(ctx, s.value.params, s.value.body, outerEnv, s.value.returnType);
          return emitBinding(s.name, wrapWithCapture(ctx, fnCode, s.value, s.name));
        }
        const destr = genDestructure(ctx, s.value.params, '  ');
        if (s.value.returnType === '.') {
          return emitBinding(s.name, wrapWithCapture(ctx, `async (_s) => {${destr}\n  ${genExpr(ctx, s.value.expr)};\n}`, s.value, s.name));
        }
        return emitBinding(s.name, wrapWithCapture(ctx, `async (_s) => {${destr}\n  return Structure.pack([${genExpr(ctx, s.value.expr)}]);\n}`, s.value, s.name));
      }
      // Overload append: reuse existing label for this variable (scoped to current body)
      if (overloadMode === 'append') {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          let captureCode = '';
          for (const v of freeVars) {
            const fieldName = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureFields.push(fieldName);
            const src = ctx.stateVarNames.has(v) ? `this.#${stateKey(v)}` : (ctx.ssaScope?.get(v) || jsIdent(v));
            captureCode += `\n        this.#${fieldName} = ${src};`;
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          ctx.lambdaHandlers.push(entry);
          return captureCode;
        }
      }
      const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
      ctx.lambdaVarNames.add(s.name);
      const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
      // Store captures in actor private fields. The free var name is
      // resolved through the OUTER scope (current ctx.ssaScope) — we store
      // the snapshot at lambda creation time before descending into body.
      let captureCode = '';
      for (const v of freeVars) {
        const fieldName = `_cap_${lambdaName}_${v}`;
        ctx.lambdaCaptureFields.push(fieldName);
        const src = ctx.stateVarNames.has(v) ? `this.#${stateKey(v)}` : (ctx.ssaScope?.get(v) || jsIdent(v));
        captureCode += `\n        this.#${fieldName} = ${src};`;
      }
      ctx.lambdaHandlers.push({ name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName })) });
      return captureCode + emitBinding(s.name, `"${lambdaName}"`);
    }
    if (s.value.type === 'IndexExpr') {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'DotCallExpr') {
      return emitBinding(s.name, `Structure.one(Structure.pack(await ${genExpr(ctx, s.value)}), ${JSON.stringify(s.name)})`);
    }
    // Bare field read on a child actor: v = c.val — same shape as no-args DotCallExpr
    if (s.value.type === 'DotAccessExpr' && s.value.object?.type === 'Identifier' && ctx.childActorVars?.has(s.value.object.name)) {
      return emitBinding(s.name, `Structure.one(Structure.pack(await ${genExpr(ctx, s.value)}), ${JSON.stringify(s.name)})`);
    }
    if (CALL_LIKE.has(s.value.type)) {
      return emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
    }
    if (inferLiteralType(s.value) !== null) {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'TypeConstruction') {
      // RHS carries its own type tag — bind directly without re-annotation.
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'FnRef') {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
  }).join('');
  return result;
}

export function isRemoteSend(ctx, expr) {
  if (expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && ctx.dependencyNames.has(expr.object.name)) return true;
  if (expr?.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && ctx.destructuredMembers?.has(expr.callee.name)) return true;
  return false;
}

// ── catch / label-invoke ──────────────────────────────────────────────────────
//
// Phase 1: void catch only. `catch #label { body }` lowers to a labeled JS
// block; `#label` invocations inside the body lower to `break <jsLabel>;`.
//
// All forms are statement-level: a void catch carries no value, so it never
// reaches genExpr. Dispatch is exposed via tryGenCatchOrLabelStmt(ctx, s, …)
// which returns a JS string for catch-related statements or null otherwise.

function lookupCatchEntry(ctx, brevityName) {
  for (let i = ctx.catchLabelStack.length - 1; i >= 0; i--) {
    if (ctx.catchLabelStack[i].brevityName === brevityName) return ctx.catchLabelStack[i];
  }
  throw new Error(`Label ${brevityName} is not in scope`);
}

function lookupCatchJsLabel(ctx, brevityName) {
  return lookupCatchEntry(ctx, brevityName).jsName;
}

function ifContainsLabelExit(node) {
  if (!node) return false;
  if (node.type === 'LabelInvoke') return true;
  if (node.type === 'IfBranch') {
    if (node.expr) return ifContainsLabelExit(node.expr);
    if (node.body) return node.body.some(s => bodyStmtHasLabelExit(s));
    return false;
  }
  if (node.type === 'IfExpr') return ifContainsLabelExit(node.then) || ifContainsLabelExit(node.else);
  return false;
}

function bodyStmtHasLabelExit(s) {
  if (!s) return false;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') return true;
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExit(s.expr)) return true;
  return false;
}

function genCatchBodyStmt(ctx, s, indent, outerEnv, counters, opts = {}) {
  const isLast = !!opts.isLast;
  // Statement-level label invocation → break (with optional value assignment).
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'LabelInvoke') {
    const entry = lookupCatchEntry(ctx, s.expr.label);
    if (s.expr.valueExpr && entry.resultVar) {
      return `\n${indent}${entry.resultVar} = ${genExpr(ctx, s.expr.valueExpr)};\n${indent}break ${entry.jsName};`;
    }
    return `\n${indent}break ${entry.jsName};`;
  }
  // if-cond with label-exit branch → emit as control-flow if-statement
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'IfExpr' && ifContainsLabelExit(s.expr)) {
    return genIfStmtWithLabelExit(ctx, s.expr, indent, outerEnv, counters);
  }
  // Nested catch
  if ((s.type === 'ExprStatement' || s.type === 'ImplicitReturn') && s.expr?.type === 'CatchExpr') {
    return genCatchStatement(ctx, s.expr, indent, outerEnv, counters);
  }
  // repeat while/until
  if (s.type === 'WhileStatement') {
    return genWhileStatement(ctx, s, indent, outerEnv, counters);
  }
  if (s.type === 'BareTypeDecl') return '';
  if (s.type === 'RefDecl') {
    const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
    return `\n${indent}const ${s.name} = {value: ${rhs}};`;
  }
  if (s.type === 'Assign') {
    if (CALL_LIKE.has(s.value.type)) {
      return `\n${indent}const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
    }
    return `\n${indent}const ${s.name} = ${genExpr(ctx, s.value)};`;
  }
  if (s.type === 'TypedAssign') {
    if (CALL_LIKE.has(s.value.type)) {
      return `\n${indent}const ${s.name} = Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)});`;
    }
    return `\n${indent}const ${s.name} = ${genExpr(ctx, s.value)};`;
  }
  if (s.type === 'StateAssign') {
    return `\n${indent}this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
  }
  if (s.type === 'SetStatement') {
    if (ctx.childActorVars?.has(s.name)) {
      const wireOp = s.updateOp === '<|' ? 'update' : 'set';
      return `\n${indent}${s.name}.value.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
    }
    if (ctx.stateVarNames.has(s.name)) {
      return `\n${indent}this.#${stateKey(s.name)} = ${genExpr(ctx, s.value)};`;
    }
    return `\n${indent}${jsIdent(s.name)}.value = ${genExpr(ctx, s.value)};`;
  }
  if (s.type === 'Return') {
    return `\n${indent}return Structure.pack(${genReBody(ctx, s.fields, ctx.currentTypeEnv)});`;
  }
  if (s.type === 'ExprStatement') {
    const code = genExpr(ctx, s.expr);
    const needsAwait = code.includes('#childSend') || code.includes('#send(');
    return `\n${indent}${needsAwait ? 'await ' : ''}${code};`;
  }
  if (s.type === 'ImplicitReturn') {
    // Value-carrying catch: the tail expression IS the fall-through value;
    // earlier ImplicitReturns degrade to discarded statements.
    const entry = ctx.catchLabelStack[ctx.catchLabelStack.length - 1];
    if (isLast && entry?.resultVar) {
      return `\n${indent}${entry.resultVar} = ${genExpr(ctx, s.expr)};`;
    }
    return `\n${indent}${genExpr(ctx, s.expr)};`;
  }
  throw new Error(`catch body: unsupported statement ${s.type}`);
}

function genIfStmtWithLabelExit(ctx, ifExpr, indent, outerEnv, counters) {
  const cond = genExpr(ctx, ifExpr.cond);
  const truthy = `(${cond}) !== false && (${cond}) !== null`;
  let code = `\n${indent}if (${truthy}) {`;
  code += genBranchAsStmts(ctx, ifExpr.then, indent + '  ', outerEnv, counters);
  code += `\n${indent}}`;
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      // Recurse — strip the leading newline of the recursive call to emit `else if`.
      const inner = genIfStmtWithLabelExit(ctx, ifExpr.else, indent, outerEnv, counters);
      code += ` else ` + inner.replace(/^\n[ ]*/, '');
    } else {
      code += ` else {`;
      code += genBranchAsStmts(ctx, ifExpr.else, indent + '  ', outerEnv, counters);
      code += `\n${indent}}`;
    }
  }
  return code;
}

function genBranchAsStmts(ctx, branch, indent, outerEnv, counters) {
  if (!branch) return '';
  if (branch.body) {
    let code = '';
    for (const s of branch.body) code += genCatchBodyStmt(ctx, s, indent, outerEnv, counters);
    return code;
  }
  if (branch.expr) {
    if (branch.expr.type === 'LabelInvoke') {
      const entry = lookupCatchEntry(ctx, branch.expr.label);
      if (branch.expr.valueExpr && entry.resultVar) {
        return `\n${indent}${entry.resultVar} = ${genExpr(ctx, branch.expr.valueExpr)};\n${indent}break ${entry.jsName};`;
      }
      return `\n${indent}break ${entry.jsName};`;
    }
    return `\n${indent}${genExpr(ctx, branch.expr)};`;
  }
  return '';
}

// Emit a catch as a statement-form labeled block. When `resultVar` is provided,
// the block is value-carrying: the tail ImplicitReturn assigns to resultVar,
// and `#label(expr)` invocations write through resultVar before breaking.
// When `resultVar` is null, the catch is void.
export function genCatchStatement(ctx, catchExpr, indent, outerEnv, counters, resultVar = null) {
  const idx = ctx.catchLabelCounter++;
  const safeName = catchExpr.label.replace(/[^a-zA-Z0-9]/g, '');
  const jsName = `_lbl_${safeName}_${idx}`;
  ctx.catchLabelStack.push({ brevityName: catchExpr.label, jsName, resultVar });
  let code = `\n${indent}${jsName}: {`;
  const last = catchExpr.body.length - 1;
  for (let i = 0; i < catchExpr.body.length; i++) {
    code += genCatchBodyStmt(ctx, catchExpr.body[i], indent + '  ', outerEnv, counters, { isLast: i === last });
  }
  code += `\n${indent}}`;
  ctx.catchLabelStack.pop();
  return code;
}

// Returns a JS-statement string if `s` is a catch-related statement that
// should bypass the standard expression/return path; otherwise null.
//
// Statement-level catch is always discarded (void semantics). For value-
// carrying catch in assignment / function-tail positions, callers route
// through dedicated helpers (genCatchAssign / genCatchReturn) instead.
export function tryGenCatchOrLabelStmt(ctx, s, indent, outerEnv, counters) {
  if (s.type === 'ExprStatement' || s.type === 'ImplicitReturn') {
    if (s.expr?.type === 'CatchExpr') {
      // ImplicitReturn(CatchExpr value-carrying) at the function tail wants
      // to return the catch's value — caller should detect that case before
      // calling this dispatcher. Plain statement contexts discard the value.
      return genCatchStatement(ctx, s.expr, indent, outerEnv, counters);
    }
    if (s.expr?.type === 'LabelInvoke') {
      const entry = lookupCatchEntry(ctx, s.expr.label);
      if (s.expr.valueExpr && entry.resultVar) {
        return `\n${indent}${entry.resultVar} = ${genExpr(ctx, s.expr.valueExpr)};\n${indent}break ${entry.jsName};`;
      }
      return `\n${indent}break ${entry.jsName};`;
    }
    if (s.expr?.type === 'IfExpr' && ifContainsLabelExit(s.expr)) {
      return genIfStmtWithLabelExit(ctx, s.expr, indent, outerEnv, counters);
    }
  }
  return null;
}

// Emit a value-carrying catch into a fresh JS local, returning the JS
// fragment (with the result variable named via `resultVar`).
// Caller is expected to consume `resultVar` afterward.
export function genCatchValueIntoTemp(ctx, catchExpr, indent, outerEnv, counters, resultVar) {
  const declLine = `\n${indent}let ${resultVar};`;
  const labeled = genCatchStatement(ctx, catchExpr, indent, outerEnv, counters, resultVar);
  return declLine + labeled;
}
