import { inferLiteralType, buildTypeEnv } from './types.js';
import {
  CALL_LIKE, genExpr, genDestructure, genDestructureAssign,
  genListDestructureAssign, genReBody,
  collectFreeVars, wrapWithCapture, lambdaUsesOuterRefs,
  jsIdent,
} from './expressions.js';

export function makeBindingContext(body, initialDeclared, indent) {
  const assignCounts = new Map();
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      assignCounts.set(s.name, (assignCounts.get(s.name) || 0) + 1);
    }
  }
  const declared = new Set(initialDeclared);
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'BareTypeDecl') {
      declared.add(s.name);
    } else if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (!item.discard && item.name) declared.add(item.name);
      }
    } else if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (!item.discard && item.name) declared.add(item.name);
      }
    }
  }
  const initialized = new Set();
  const emitBinding = (name, rhs) => {
    const jsName = jsIdent(name);
    if (initialized.has(name)) return `\n${indent}${jsName} = ${rhs};`;
    initialized.add(name);
    if (declared.has(name) && assignCounts.get(name) == null) return `\n${indent}let ${jsName} = ${rhs};`;
    const kind = assignCounts.get(name) > 1 ? 'let' : 'const';
    return `\n${indent}${kind} ${jsName} = ${rhs};`;
  };
  return { assignCounts, declared, initialized, emitBinding };
}

export function genFunctionBodyCode(ctx, params, body, outerEnv = null, declaredReturnType = null) {
  const { env: typeEnv } = buildTypeEnv(params, body);
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;
  const destr = genDestructure(ctx, params, '  ');
  const { emitBinding } = makeBindingContext(
    body, params.map(p => p.name).filter(Boolean), '  ',
  );
  let code = '';
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  let _lastTypedName = null;
  let _lastIsWhile = false;
  let _lastSetName = null;
  for (const s of body) {
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
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        code += `\n  ${s.name}.value.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      } else if (ctx.stateVarNames.has(s.name)) {
        code += `\n  this.#${s.name} = ${genExpr(ctx, s.value)};`;
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
            const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
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
      code += `\n  this.#${s.name} = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'WhileStatement') {
      _lastTypedName = null;
      _lastIsWhile = true;
      _lastSetName = null;
      code += genWhileStatement(ctx, s, '  ', outerEnv);
    } else if (s.type === 'Return') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      code += `\n  return Structure.pack(${genReBody(ctx, s.fields, typeEnv, declaredReturnType)});`;
    } else if (s.type === 'ImplicitReturn') {
      _lastTypedName = null;
      _lastIsWhile = false;
      _lastSetName = null;
      if (declaredReturnType === '.') {
        code += `\n  ${genExpr(ctx, s.expr)};`;
      } else {
        code += `\n  return Structure.pack([${genExpr(ctx, s.expr)}]);`;
      }
    }
  }
  if (declaredReturnType !== '.') {
    if (_lastTypedName !== null) {
      code += `\n  return Structure.pack([${_lastTypedName}]);`;
    } else if (_lastSetName !== null) {
      code += `\n  return Structure.pack([${_lastSetName}.value]);`;
    } else if (_lastIsWhile) {
      code += `\n  return Structure.pack([null]);`;
    }
  }
  ctx.currentTypeEnv = savedTypeEnv;
  return `async (_s) => {${destr}${code}\n}`;
}

export function genIfBlockBody(ctx, body, tmpVar, _outerEnv) {
  let code = '';
  let _rIdx = 0;
  let lastTypedName = null;
  for (const s of body) {
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
      code += `\n        this.#${s.name} = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'SetStatement') {
      lastTypedName = null;
      code += ctx.stateVarNames.has(s.name)
        ? `\n        this.#${s.name} = ${genExpr(ctx, s.value)};`
        : `\n        ${s.name}.value = ${genExpr(ctx, s.value)};`;
    } else if (s.type === 'RefDecl') {
      lastTypedName = null;
      const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
      code += `\n        const ${s.name} = {value: ${rhs}};`;
    } else if (s.type === 'ImplicitReturn') {
      lastTypedName = null;
      code += `\n        ${tmpVar} = ${genExpr(ctx, s.expr)};`;
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

export function genWhileStatement(ctx, node, indent, outerEnv) {
  const condCode = genExpr(ctx, node.cond);
  const inner = indent + '  ';
  let code;
  if (node.negated) {
    code = `\n${indent}while ((${condCode}) === false || (${condCode}) === null) {`;
  } else {
    code = `\n${indent}while ((${condCode}) !== false && (${condCode}) !== null) {`;
  }
  for (const s of node.body) {
    if (s.type === 'StateAssign') {
      code += `\n${inner}this.#${s.name} = ${genExpr(ctx, s.value)};`;
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
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        code += `\n${inner}${s.name}.value.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      } else if (ctx.stateVarNames.has(s.name)) {
        code += `\n${inner}this.#${s.name} = ${genExpr(ctx, s.value)};`;
      } else {
        code += `\n${inner}${s.name}.value = ${genExpr(ctx, s.value)};`;
      }
    } else if (s.type === 'WhileStatement') {
      code += genWhileStatement(ctx, s, inner, outerEnv);
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

export function genTypedAssignStmt(ctx, s, emitBinding, outerEnv, indent, counters) {
  // as-clause interception: TypedAssign + FunctionCallExpr naming an actor with as clauses
  if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorNames.has(s.value.callee.name)) {
    const clause = findAsClauseMatch(ctx, s.typeName, s.value.callee.name);
    if (clause) return emitBinding(s.name, genExpr(ctx, clause.expr));
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
      // Overload append/prepend: reuse existing label for this variable (scoped to current body)
      if (overloadMode === 'append' || overloadMode === 'prepend') {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          let captureCode = '';
          for (const v of freeVars) {
            const fieldName = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureFields.push(fieldName);
            const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
            captureCode += `\n${indent}this.#${fieldName} = ${src};`;
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          if (overloadMode === 'prepend') {
            // Insert before the first handler with this label
            const idx = ctx.lambdaHandlers.indexOf(existing);
            ctx.lambdaHandlers.splice(idx, 0, entry);
          } else {
            ctx.lambdaHandlers.push(entry);
          }
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
        const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
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
    return prefix + emitBinding(s.name, `${tmpVar}.named[${JSON.stringify(s.name)}] !== undefined ? ${tmpVar}.named[${JSON.stringify(s.name)}] : Structure.one(${tmpVar}, ${JSON.stringify(s.name)})`);
  }
  if (CALL_LIKE.has(s.value.type))
    return emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
  if (s.value.type === 'StructureConstructor')
    return emitBinding(s.name, `(${genExpr(ctx, s.value)}).positional[0]`);
  return emitBinding(s.name, genExpr(ctx, s.value));
}

export function genLocals(ctx, body, outerEnv) {
  const { assignCounts, declared, initialized, emitBinding } = makeBindingContext(
    body, outerEnv.keys(), '        ',
  );
  let _tmpIdx = 0;
  let _ldIdx = 0;
  const counters = { ifIdx: 0 };
  // Track lambda handler start index for scoped overload lookups
  const _lambdaStartIdx = ctx.lambdaHandlers.length;
  ctx._lambdaStartIdx = _lambdaStartIdx;
  ctx.childActorVars = new Map();
  const refVars = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') {
      refVars.add(s.name);
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorNames.has(s.value.callee.name))
        ctx.childActorVars.set(s.name, true);
    }
    if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorNames.has(s.value.callee.name))
      ctx.childActorVars.set(s.name, false);
  }
  const stmts = body.filter(s => s.type === 'Assign' || s.type === 'DestructureAssign' || s.type === 'TypedAssign' || s.type === 'ListDestructure' || s.type === 'StateAssign' || s.type === 'WhileStatement' || s.type === 'RefDecl' || s.type === 'SetStatement' || s.type === 'ActorSetStatement' || s.type === 'IfStatement' || s.type === 'ExprStatement' || s.type === 'SpawnStatement');
  return stmts.map(s => {
    if (s.type === 'RefDecl') {
      const rhs = s.value ? genExpr(ctx, s.value) : 'undefined';
      return `\n        const ${s.name} = {value: ${rhs}};`;
    }
    if (s.type === 'SetStatement') {
      if (ctx.childActorVars.has(s.name)) {
        const target = ctx.childActorVars.get(s.name) ? `${s.name}.value` : s.name;
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        return `\n        ${target}.receive({ op: [[${genExpr(ctx, s.value)}], "${wireOp}"], from: '__parent' });`;
      }
      if (ctx.stateVarNames.has(s.name)) {
        return `\n        this.#${s.name} = ${genExpr(ctx, s.value)};`;
      }
      if (!refVars.has(s.name)) {
        throw new Error(`Cannot set '${s.name}' — only 'ref' variables and actor instances support '<-'`);
      }
      return `\n        ${s.name}.value = ${genExpr(ctx, s.value)};`;
    }
    if (s.type === 'ActorSetStatement') {
      const target = ctx.childActorVars.get(s.name) ? `${s.name}.value` : s.name;
      const wireOp = s.updateOp === '<|' ? '::update' : '::set';
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
          if (ctx.childActorVars.has(stmt.name)) {
            const wireOp = stmt.updateOp === '<|' ? '::update' : '::set';
            code += `\n          ${stmt.name}.value.receive({ op: [[${genExpr(ctx, stmt.value)}], "${wireOp}"], from: '__parent' });`;
          } else {
            code += `\n          ${stmt.name}.value = ${genExpr(ctx, stmt.value)};`;
          }
        }
      }
      code += `\n        }`;
      return code;
    }
    if (s.type === 'ExprStatement') {
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
      return genWhileStatement(ctx, s, '        ', outerEnv);
    }
    if (s.type === 'StateAssign') {
      return `\n        this.#${s.name} = ${genExpr(ctx, s.value)};`;
    }
    if (s.type === 'ListDestructure') {
      return genListDestructureAssign(ctx, s, _ldIdx++);
    }
    if (s.type === 'DestructureAssign') {
      if (CALL_LIKE.has(s.source.type) || s.source.type === 'StructureConstructor') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = ${genExpr(ctx, s.source)};` + genDestructureAssign(ctx, s, tmp);
      }
      if (s.source.type === 'DotCallExpr') {
        const tmp = `_r${_tmpIdx++}`;
        return `\n        const ${tmp} = Structure.pack(await ${genExpr(ctx, s.source)});` + genDestructureAssign(ctx, s, tmp);
      }
      return genDestructureAssign(ctx, s);
    }
    if (s.type === 'TypedAssign') {
      return genTypedAssignStmt(ctx, s, emitBinding, outerEnv, '        ', counters);
    }
    // Plain assign
    if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.actorNames.has(s.value.callee.name)) {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    // Lambda overload << / >> — must be checked before the initialized shortcut
    if (s.value.type === 'Function' && s.value.overloadMode) {
      // Falls through to the Function handler below
    } else if (initialized.has(s.name) || (declared.has(s.name) && assignCounts.has(s.name))) {
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
      // Overload append/prepend: reuse existing label for this variable (scoped to current body)
      if (overloadMode === 'append' || overloadMode === 'prepend') {
        const existing = ctx.lambdaHandlers.slice(ctx._lambdaStartIdx || 0).find(h => h.varName === s.name);
        if (existing) {
          const lambdaName = existing.name;
          const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
          let captureCode = '';
          for (const v of freeVars) {
            const fieldName = `_cap_${lambdaName}_ov${ctx.lambdaCounter}_${v}`;
            ctx.lambdaCaptureFields.push(fieldName);
            const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
            captureCode += `\n        this.#${fieldName} = ${src};`;
          }
          const entry = { name: lambdaName, varName: s.name, fn: s.value, captures: freeVars.map(v => ({ name: v, lambdaName: `${lambdaName}_ov${ctx.lambdaCounter}` })) };
          ctx.lambdaCounter++;
          if (overloadMode === 'prepend') {
            const idx = ctx.lambdaHandlers.indexOf(existing);
            ctx.lambdaHandlers.splice(idx, 0, entry);
          } else {
            ctx.lambdaHandlers.push(entry);
          }
          return captureCode;
        }
      }
      const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
      ctx.lambdaVarNames.add(s.name);
      const freeVars = collectFreeVars(ctx, s.value).filter(v => v !== s.name && !ctx.actorFnNames.has(v));
      // Store captures in actor private fields
      let captureCode = '';
      for (const v of freeVars) {
        const fieldName = `_cap_${lambdaName}_${v}`;
        ctx.lambdaCaptureFields.push(fieldName);
        const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
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
    if (CALL_LIKE.has(s.value.type)) {
      return emitBinding(s.name, `Structure.one(${genExpr(ctx, s.value)}, ${JSON.stringify(s.name)})`);
    }
    if (inferLiteralType(s.value) !== null) {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    if (s.value.type === 'FnRef') {
      return emitBinding(s.name, genExpr(ctx, s.value));
    }
    throw new Error(`Variable '${s.name}' requires a type annotation — use '${s.name} : Type = ...'`);
  }).join('');
}

export function isRemoteSend(ctx, expr) {
  return expr?.type === 'DotCallExpr' && expr.object?.type === 'Identifier' && ctx.usesNames.has(expr.object.name);
}
