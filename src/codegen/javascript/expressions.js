import { inferLiteralType, checkReplyFieldTypes } from './types.js';

export const CALL_LIKE = new Set(['FunctionCallExpr']);

export function collectFreeVars(ctx, funcNode) {
  const paramNames = new Set(funcNode.params.map(p => p.name).filter(Boolean));
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
      collectFreeVars(ctx, expr).forEach(v => ids.add(v));
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
      } else if (s.type === 'ActorSetStatement') {
        ids.add(s.name);
        for (const a of s.args) walkExpr(a.expr);
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

export function wrapWithCapture(ctx, code, funcNode, selfName) {
  const freeVars = collectFreeVars(ctx, funcNode).filter(v => v !== selfName);
  if (freeVars.length === 0) return code;
  return `((${freeVars.join(', ')}) => ${code})(${freeVars.join(', ')})`;
}

// Check if a lambda references outer refs (read or write) — these can't be lifted to dispatch handlers
// because refs need live cell access (for mutation visibility)
export function lambdaUsesOuterRefs(ctx, funcNode) {
  collectFreeVars(ctx, funcNode);
  // Check if any free vars are ref-declared in outer scope
  // We detect this by checking if the AST uses RefRead/SetStatement on free vars
  const body = funcNode.body || [];
  const localRefs = new Set();
  for (const s of body) {
    if (s.type === 'RefDecl') localRefs.add(s.name);
  }
  // Check body for SetStatement on outer refs or child actors
  for (const s of body) {
    if (s.type === 'SetStatement' && !localRefs.has(s.name) && !ctx.stateVarNames.has(s.name)) {
      return true;
    }
    if (s.type === 'ActorSetStatement') {
      return true;
    }
  }
  // Check for RefRead on free vars (reading outer refs)
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
    if (expr.type === 'Function') return lambdaUsesOuterRefs(ctx, expr);
    return false;
  }
  for (const s of body) {
    if (s.type === 'Assign' || s.type === 'TypedAssign') {
      if (hasRefRead(s.value)) return true;
    }
    if (s.type === 'ImplicitReturn' && hasRefRead(s.expr)) return true;
    if (s.type === 'Reply' || s.type === 'Return') {
      for (const f of s.fields) {
        if (f.ref) return true; // sigil ref
        if (f.value && hasRefRead(f.value)) return true;
      }
    }
  }
  // Also check single-expression body
  if (funcNode.expr && hasRefRead(funcNode.expr)) return true;
  return false;
}

// Register a Function node as a lambda dispatch handler, return its label string expression
export function genLambdaArgLabel(ctx, funcNode) {
  const lambdaName = `_lambda_${ctx.lambdaCounter++}`;
  const freeVars = collectFreeVars(ctx, funcNode).filter(v => !ctx.actorFnNames.has(v));
  const captures = freeVars.map(v => ({ name: v, lambdaName }));
  for (const v of freeVars) {
    const fieldName = `_cap_${lambdaName}_${v}`;
    ctx.lambdaCaptureFields.push(fieldName);
  }
  ctx.lambdaHandlers.push({ name: lambdaName, fn: funcNode, captures });
  // If there are captures, emit an IIFE that stores them and returns the label
  if (freeVars.length > 0) {
    const stores = freeVars.map(v => {
      const src = ctx.stateVarNames.has(v) ? `this.#${v}` : v;
      return `this.#_cap_${lambdaName}_${v} = ${src}`;
    }).join(', ');
    return `(${stores}, "${lambdaName}")`;
  }
  return `"${lambdaName}"`;
}

// For over/reduce fn args: wrap lambda labels in self-send closures for _List.mapAsync/foldAsync
export function genLambdaAwareFnArg(ctx, fnExpr) {
  if (fnExpr.type === 'FnRef' && ctx.lambdaVarNames.has(fnExpr.name)) {
    return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${fnExpr.name}])))`;
  }
  if (fnExpr.type === 'Function') {
    if (lambdaUsesOuterRefs(ctx, fnExpr)) return genExpr(ctx, fnExpr);
    // Register as lambda handler and wrap in self-send closure
    const label = genLambdaArgLabel(ctx, fnExpr);
    return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${label}])))`;
  }
  return genExpr(ctx, fnExpr);
}

export function genExpr(ctx, expr) {
  if (expr.type === 'StringLiteral')  return JSON.stringify(expr.value);
  if (expr.type === 'Identifier')     return ctx.stateVarNames.has(expr.name) ? `this.#${expr.name}` : expr.name;
  if (expr.type === 'RefRead')       return ctx.stateVarNames.has(expr.name) ? `this.#${expr.name}` : `${expr.name}.value`;
  if (expr.type === 'RefArg')        return expr.name;
  if (expr.type === 'IntLiteral')     return String(expr.value);
  if (expr.type === 'DecimalLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral')   return String(expr.value);
  if (expr.type === 'NullLiteral')    return 'null';
  if (expr.type === 'BoolLiteral')    return expr.value ? 'true' : 'false';
  if (expr.type === 'FnRef') {
    if (ctx.actorFnNames.has(expr.name)) return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), "${expr.name}"])))`;
    if (ctx.lambdaVarNames.has(expr.name)) return `(async (_s) => Structure.pack(await this.#selfSend([Structure.splat(_s), ${expr.name}])))`;

    return expr.name;
  }
  if (expr.type === 'StateVar')  return `this.#${expr.name}`;
  if (expr.type === 'OverExpr') {
    const fnCode = genLambdaAwareFnArg(ctx, expr.fn);
    return `await _List.mapAsync(${genExpr(ctx, expr.collection)}, ${fnCode})`;
  }
  if (expr.type === 'ReduceExpr') {
    const init = expr.initial ? genExpr(ctx, expr.initial) : 'null';
    const fnCode = genLambdaAwareFnArg(ctx, expr.fn);
    return `await _List.foldAsync(${genExpr(ctx, expr.collection)}, ${init}, ${fnCode})`;
  }
  if (expr.type === 'BinaryExpr') {
    const left = CALL_LIKE.has(expr.left.type) ? `Structure.one(${genExpr(ctx, expr.left)}, '_')` : genExpr(ctx, expr.left);
    const right = CALL_LIKE.has(expr.right.type) ? `Structure.one(${genExpr(ctx, expr.right)}, '_')` : genExpr(ctx, expr.right);
    return `${left} ${expr.op} ${right}`;
  }
  if (expr.type === 'IndexExpr') {
    const obj = genExpr(ctx, expr.object);
    if (expr.key !== null) return `${obj}.named[${JSON.stringify(expr.key)}]`;
    return `${obj}.positional[${expr.index}]`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return '_List.empty';
    return `_List.from([${expr.elements.map(e => genExpr(ctx, e)).join(', ')}])`;
  }
  if (expr.type === 'StructureLiteral') {
    return genExpr(ctx, { ...expr, type: 'StructureConstructor' });
  }
  if (expr.type === 'StructureConstructor') {
    const positional = expr.args.filter(a => a.positional);
    const named = expr.args.filter(a => a.key !== undefined);
    const posVals = positional.map(a => genExpr(ctx, a.expr)).join(', ');
    const posTypes = positional.length > 0
      ? `[${positional.map(a => JSON.stringify(a.type)).join(', ')}]`
      : 'null';
    const namedVals = named.map(a => `${JSON.stringify(a.key)}: ${genExpr(ctx, a.expr)}`).join(', ');
    const namedTypes = named.length > 0
      ? `{${named.map(a => `${JSON.stringify(a.key)}: ${JSON.stringify(a.type)}`).join(', ')}}`
      : 'null';
    return `{ positional: [${posVals}], named: {${namedVals}}, positional_types: ${posTypes}, named_types: ${namedTypes} }`;
  }
  if (expr.type === 'FunctionCallExpr') {
    if (expr.callee?.type === 'Identifier') {
      const name = expr.callee.name;
      // __tick__ intrinsic
      if (name === '__tick__') return 'await new Promise(r => setTimeout(r, 0))';
      // Emit invocation — route to subscribers
      if (ctx.emitNames.has(name)) {
        const emitDecl = ctx.emitNames.get(name);
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        let payload = '{}';
        if (expr.args.length > 0) {
          // Build named payload matching emit declaration params
          const fields = emitDecl.params.map((p, i) => {
            const val = i < expr.args.length ? genArg(expr.args[i]) : 'null';
            return `${JSON.stringify(p.name)}: ${val}`;
          }).join(', ');
          payload = `{${fields}}`;
        }
        const method = emitDecl.silent ? '#emit' : '#emitAwait';
        return `await this.${method}(${JSON.stringify(name)}, ${payload})`;
      }
      // Primitive type constructors — unwrap to the inner value
      const _primitiveTypes = new Set(['Integer', 'Float', 'Text', 'Boolean']);
      if (_primitiveTypes.has(name) && expr.args.length === 1) {
        return genExpr(ctx, expr.args[0]);
      }
      // Actor instantiation — constructor args passed directly
      if (ctx.actorNames.has(name)) {
        const binding = `{post: (msg) => this.receive(msg)}`;
        if (expr.args.length > 0) {
          const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
          // If the call uses named args, reorder to match constructor param order
          const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
          if (namedBag) {
            const info = ctx.actorNames.get(name);
            const initParams = info.initParams || [];
            const namedFields = namedBag.fields; // object: { key: valueExpr }
            const positionalArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
            const orderedArgs = [];
            for (const p of initParams) {
              // For aliased params (key: alias), the call uses the key; otherwise the name
              const lookupKey = p.key || p.name;
              if (namedFields[lookupKey]) orderedArgs.push(genArg(namedFields[lookupKey]));
              else if (positionalArgs.length > 0) orderedArgs.push(genArg(positionalArgs.shift()));
            }
            for (const a of positionalArgs) orderedArgs.push(genArg(a));
            const vals = orderedArgs.join(', ');
            return `await ${name}.create(${binding}, ${vals})`;
          }
          const vals = expr.args.map(genArg).join(', ');
          return `await ${name}.create(${binding}, ${vals})`;
        }
        return `await ${name}.create(${binding})`;
      }
      // Self-send: private function call goes through dispatch
      if (ctx.actorFnNames.has(name)) {
        const genArg = arg => {
          if (arg.type === 'Function') return genLambdaArgLabel(ctx, arg);
          return CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        };
        const op = expr.args.length === 0
          ? `"${name}"`
          : `[[${expr.args.map(genArg).join(', ')}], "${name}"]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
      // Lambda var call → self-send through dispatch
      if (ctx.lambdaVarNames.has(name)) {
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        const op = expr.args.length === 0
          ? name
          : `[[${expr.args.map(genArg).join(', ')}], ${name}]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
    }
    // Check if callee is function-typed (parameter or variable) — route through self-send
    if (expr.callee?.type === 'Identifier') {
      const calleeName = expr.callee.name;
      const calleeExpr = genExpr(ctx, expr.callee);
      const calleeType = ctx.currentTypeEnv?.get(calleeName);
      const isFnTyped = calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->')));
      if (isFnTyped) {
        const genArg = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
        const op = expr.args.length === 0
          ? calleeExpr
          : `[[${expr.args.map(genArg).join(', ')}], ${calleeExpr}]`;
        return `Structure.pack(await this.#selfSend(${op}))`;
      }
    }
    const genArg = arg => {
      if (arg.type === 'Function') return genLambdaArgLabel(ctx, arg);
      return CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
    };
    // If callee is a local variable, it may hold a string label (lambda) or closure at runtime
    if (expr.callee?.type === 'Identifier') {
      const calleeName = expr.callee.name;
      const calleeExpr = ctx.stateVarNames.has(calleeName) ? `this.#${calleeName}` : calleeName;
      const genArgSS = arg => CALL_LIKE.has(arg.type) ? `Structure.one(${genExpr(ctx, arg)}, '_')` : genExpr(ctx, arg);
      const hasRefArg = expr.args.some(a => a.type === 'RefArg') ||
        expr.args.some(a => a.type === 'NamedArgsBag' && Object.values(a.fields).some(v => v.type === 'RefArg'));
      // Build payload for the closure path (handles ref args)
      let closurePayload;
      if (expr.args.length === 0) {
        closurePayload = 'Structure.pack(null)';
      } else if (hasRefArg) {
        const pos = expr.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
        const posVals = pos.map(genArgSS).join(', ');
        const namedVals = namedBag ? genExpr(ctx, namedBag) : '{}';
        closurePayload = `{positional: [${posVals}], named: ${namedVals}, positional_types: null, named_types: null}`;
      } else {
        closurePayload = `Structure.pack([${expr.args.map(genArgSS).join(', ')}])`;
      }
      const op = expr.args.length === 0
        ? calleeExpr
        : `[[${expr.args.map(genArgSS).join(', ')}], ${calleeExpr}]`;
      return `(typeof ${calleeExpr} === 'string' ? Structure.pack(await this.#selfSend(${op})) : await (${calleeExpr})(${closurePayload}))`;
    }
    const hasRefArg = expr.args.some(a => a.type === 'RefArg') ||
      expr.args.some(a => a.type === 'NamedArgsBag' && Object.values(a.fields).some(v => v.type === 'RefArg'));
    let payload;
    if (expr.args.length === 0) {
      payload = 'Structure.pack(null)';
    } else if (hasRefArg) {
      // Bypass Structure.pack to prevent ref cell objects from being treated as named args
      const pos = expr.args.filter(a => a.type !== 'NamedArgsBag');
      const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
      const posVals = pos.map(genArg).join(', ');
      const namedVals = namedBag ? genExpr(ctx, namedBag) : '{}';
      payload = `{positional: [${posVals}], named: ${namedVals}, positional_types: null, named_types: null}`;
    } else {
      payload = `Structure.pack([${expr.args.map(genArg).join(', ')}])`;
    }
    return `await (${genExpr(ctx, expr.callee)})(${payload})`;
  }
  if (expr.type === 'NamedArgsBag') {
    const fields = Object.entries(expr.fields)
      .map(([k, v]) => `${JSON.stringify(k)}: ${genExpr(ctx, v)}`).join(', ');
    return `{ ${fields} }`;
  }
  if (expr.type === 'Function') {
    // Lambdas with outer ref sets remain closures
    if (lambdaUsesOuterRefs(ctx, expr)) {
      const destr = genDestructure(ctx, expr.params, '  ');
      if (expr.body) {
        return wrapWithCapture(ctx, ctx.genFunctionBodyCode(ctx, expr.params, expr.body, null, expr.returnType), expr);
      }
      if (expr.returnType === '.') {
        return wrapWithCapture(ctx, `async (_s) => {${destr}\n  ${genExpr(ctx, expr.expr)};\n}`, expr);
      }
      return wrapWithCapture(ctx, `async (_s) => {${destr}\n  return Structure.pack([${genExpr(ctx, expr.expr)}]);\n}`, expr);
    }
    return genLambdaArgLabel(ctx, expr);
  }
  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemote = dotObjName && ctx.remoteInstanceVars.has(dotObjName);
    const isChild = !isRemote && (expr.object.type === 'RefRead' ||
      (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && ctx.actorNames.has(expr.object.callee.name)) ||
      (expr.object.type === 'Identifier' && (ctx.childActorVars.has(expr.object.name) || ctx.wrappedChildParams.has(expr.object.name) || ctx.constructsProxyVars.has(expr.object.name))));
    if (isChild) {
      const target = expr.object.type === 'RefRead'
        ? (ctx.stateVarNames.has(expr.object.name) ? `this.#${expr.object.name}` : `${expr.object.name}.value`)
        : genExpr(ctx, expr.object);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let op;
      const wireMethod = '@' + expr.method;
      if (positional.length === 0 && named.length === 0) {
        op = JSON.stringify(wireMethod);
      } else if (positional.length > 0) {
        const vals = positional.map(a => genExpr(ctx, a.expr)).join(', ');
        op = `[[${vals}], ${JSON.stringify(wireMethod)}]`;
      } else {
        const fields = named.map(a => {
          const val = a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
          return `${a.name}: ${val}`;
        }).join(', ');
        op = `[{${fields}}, ${JSON.stringify(wireMethod)}]`;
      }
      return `this.#childSend(${target}, ${op})`;
    }
    const objName = expr.object.type === 'Identifier' ? expr.object.name : (expr.object.type === 'RefRead' ? expr.object.name : null);
    const isRemoteInstance = objName && ctx.remoteInstanceVars.has(objName);
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    if (isRemoteInstance) {
      const to = `this.#${objName}`;
      let op;
      if (positional.length === 0 && named.length === 0) {
        op = JSON.stringify(expr.method);
      } else {
        const genArgVal = a => a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
        const posVals = positional.map(genArgVal).join(', ');
        const namedFields = named.map(a => `${a.name}: ${genArgVal(a)}`).join(', ');
        if (positional.length > 0 && named.length > 0) {
          op = `[${posVals}, {${namedFields}}, ${JSON.stringify(expr.method)}]`;
        } else if (named.length > 0) {
          op = `[{${namedFields}}, ${JSON.stringify(expr.method)}]`;
        } else {
          op = `[[${posVals}], ${JSON.stringify(expr.method)}]`;
        }
      }
      return `this.#send(${op}, ${to})`;
    }
    const to = JSON.stringify(expr.object.name);
    const method = JSON.stringify('@' + expr.method);
    if (positional.length === 0 && named.length === 0) {
      return `this.#send(${method}, ${to})`;
    }
    const genArgVal = a => a.expr ? genExpr(ctx, a.expr) : (ctx.stateVarNames.has(a.name) ? `this.#${a.name}` : a.name);
    const posVals = positional.map(genArgVal).join(', ');
    const namedFields = named.map(a => `${a.name}: ${genArgVal(a)}`).join(', ');
    const posBva = positional.map(a => JSON.stringify(a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null)).join(', ');
    const namedBva = named.map(a => `${a.name}: ${JSON.stringify(a.typeName || (a.expr ? inferLiteralType(a.expr) : null) || null)}`).join(', ');
    if (positional.length > 0 && named.length > 0) {
      return `this.#send([${posVals}, {${namedFields}}, ${method}], ${to}, [${posBva}, {${namedBva}}])`;
    } else if (named.length > 0) {
      return `this.#send([{${namedFields}}, ${method}], ${to}, [{${namedBva}}])`;
    } else {
      return `this.#send([[${posVals}], ${method}], ${to}, [[${posBva}]])`;
    }
  }
  throw new Error(`Unknown expression type: ${expr.type}`);
}

export function genDestructureAssign(ctx, { pattern, source }, overrideSrc, indent = '        ') {
  const src = overrideSrc !== undefined ? overrideSrc : genExpr(ctx, source);
  return pattern.map(item => {
    if (item.discard) return '';
    if (item.named)
      return `\n${indent}const ${item.name} = ${src}.named[${JSON.stringify(item.name)}];`;
    if (item.key !== undefined)
      return `\n${indent}const ${item.name} = ${src}.named[${JSON.stringify(item.key)}];`;
    if (item.positional)
      return `\n${indent}const ${item.name} = ${src}.positional[${item.idx}];`;
    return '';
  }).join('');
}

export function genListDestructureAssign(ctx, { pattern, source }, ldIdx = 0, indent = '        ') {
  const srcCode = genExpr(ctx, source);
  const lines = [];
  let cur = srcCode;
  let hasRest = false;
  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      hasRest = true;
      if (!item.discard && item.name)
        lines.push(`\n${indent}const ${item.name} = ${cur};`);
      break;
    }
    if (!item.discard && item.name)
      lines.push(`\n${indent}const ${item.name} = (${cur}).head;`);
    if (i < pattern.length - 1) {
      const tmp = `_ld${ldIdx}_${i}`;
      lines.push(`\n${indent}const ${tmp} = (${cur}).tail;`);
      cur = tmp;
    }
  }
  if (!hasRest && pattern.length > 0) {
    lines.push(`\n${indent}if ((${cur}).tail !== null) throw new Error('List destructure arity mismatch');`);
  }
  return lines.join('');
}

export function genReplyField(ctx, field, typeEnv) {
  const isList = t => typeof t === 'string' && t.startsWith('List');
  if ('sigil' in field) {
    const name = field.sigil;
    const t = field.type || typeEnv?.get(name);
    let val = ctx.stateVarNames.has(name) ? `this.#${name}` : (field.ref ? `${name}.value` : name);
    if (isList(t)) val = `_List.toArray(${val})`;
    return `${name}: ${val}`;
  }
  const valueCode = genExpr(ctx, field.value);
  const t = field.type || (typeEnv && field.value?.type === 'Identifier' ? typeEnv.get(field.value.name) : null);
  const finalCode = isList(t) ? `_List.toArray(${valueCode})` : valueCode;
  return `${field.key}: ${finalCode}`;
}

export function genDestructure(ctx, params, indent = '        ') {
  if (params.length === 0) return '';
  const rest = params.find(p => p.rest);
  if (rest) return `\n${indent}const ${rest.name} = _s;`;
  const pos = params.filter(p => p.positional);
  const named = params.filter(p => !p.positional);
  const namedPart = p => p.key ? `${p.key}: ${p.name}` : p.name;
  const isListType = t => typeof t === 'string' && t.startsWith('List');

  let code = '';
  if (pos.length > 0) {
    code += `\n${indent}const [${pos.map(p => p.name).join(', ')}] = _s.positional;`;
  }
  const listNamed = named.filter(p => isListType(p.type));
  const plainNamed = named.filter(p => !isListType(p.type));
  if (plainNamed.length > 0) {
    code += `\n${indent}const { ${plainNamed.map(namedPart).join(', ')} } = _s.named;`;
  }
  for (const p of listNamed) {
    const key = p.key || p.name;
    code += `\n${indent}const ${p.name} = _List.from(_s.named[${JSON.stringify(key)}]);`;
  }
  return code;
}

export function genBvaBody(ctx, fields, typeEnv) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : undefined) || inferLiteralType(f.expr);
    if (!t) return null;
    if (isFunctionType(t)) return null;
    if (isListOfAny(t)) {
      const varName = f.name ||
        (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      const resolvedVar = ctx.stateVarNames.has(varName) ? `this.#${varName}` : varName;
      posTypes.push(`_List.typesOf(${resolvedVar})`);
    } else {
      posTypes.push(JSON.stringify(t));
    }
  }
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil; t = f.type || typeEnv.get(f.sigil); varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || ((f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? typeEnv.get(f.value.name) : undefined) || inferLiteralType(f.value);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!t) return null;
    if (isFunctionType(t)) return null;
    if (isListOfAny(t)) {
      if (!varName) return null;
      namedTypes.push(`${JSON.stringify(key)}: _List.typesOf(${varName})`);
    } else {
      namedTypes.push(`${JSON.stringify(key)}: ${JSON.stringify(t)}`);
    }
  }
  if (pos.length > 0 && named.length > 0) {
    return `[${posTypes.join(', ')}, { ${namedTypes.join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${posTypes.join(', ')}]`;
  } else {
    return `{ ${namedTypes.join(', ')} }`;
  }
}

export function genReBody(ctx, fields, typeEnv, declaredReturnType = null, { skipTypeCheck = false } = {}) {
  if (!skipTypeCheck) checkReplyFieldTypes(ctx, fields, declaredReturnType);
  const spread = fields.find(f => f.spread);
  if (spread) return `Structure.splat(${spread.name})`;
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional);
  const isList = t => typeof t === 'string' && t.startsWith('List');
  const posVal = f => {
    const raw = f.expr ? genExpr(ctx, f.expr) : (ctx.stateVarNames.has(f.name) ? `this.#${f.name}` : f.name);
    const name = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
    const t = f.type || (typeEnv && name ? typeEnv.get(name) : null);
    if (isList(t)) return `_List.toArray(${raw})`;
    if (t === 'Structure') return `Structure.splat(${raw})`;
    if (f.expr && CALL_LIKE.has(f.expr.type)) return `Structure.one(${raw}, ${JSON.stringify(name ?? 'value')})`;
    return raw;
  };
  if (pos.length > 0 && named.length > 0) {
    return `[${pos.map(posVal).join(', ')}, { ${named.map(f => genReplyField(ctx, f, typeEnv)).join(', ')} }]`;
  } else if (pos.length > 0) {
    return `[${pos.map(posVal).join(', ')}]`;
  } else {
    return `{ ${named.map(f => genReplyField(ctx, f, typeEnv)).join(', ')} }`;
  }
}

export function genTypeCondition(ctx, params) {
  if (params.length === 0) return null;
  if (params.find(p => p.rest)) return null; // rest is the universal matcher
  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const named = params.filter(p => !p.positional && !isListOfAny(p.type))
    .map(p => `[${JSON.stringify(p.key || p.name)},${JSON.stringify(p.type)}]`);
  const pos = params.filter(p => p.positional && !isListOfAny(p.type))
    .map(p => JSON.stringify(p.type));
  if (named.length === 0 && pos.length === 0) return null;
  return `_matchTypes(_types, [${named.join(',')}], [${pos.join(',')}])`;
}
