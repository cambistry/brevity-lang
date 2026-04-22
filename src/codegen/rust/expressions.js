// expressions.js — Expression generation for Rust codegen
import { inferExprType } from '../../inference.js';
import {
  G, inferLiteralType, rustIdent, rustSsaResolve, rustType, convertFromValue, toJsonValue,
  resolveVarExpr, forceJsonWrap, convertBranchExpr, isBoolExpr,
  buildTypeEnv, findMutableVars, analyzeFunctions, rsStore, stateKey,
} from './types.js';
import { intLiteral, intFromValue, intToValue, intFromI64, intArithOp, intPow, intToUsize, valueArray } from './int_repr.js';
import { decLiteral, decFromValue, decArithOp, decPow } from './dec_repr.js';
import { genRustLocals } from './statements.js';

function genRustExpr(expr, typeEnv, eCtx) {
  if (expr._precomputed) return expr._precomputed;
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'IntLiteral') return intLiteral(expr.value);
  if (expr.type === 'DecimalLiteral') return decLiteral(expr.value);
  if (expr.type === 'FloatLiteral') {
    const s = String(expr.value);
    // Ensure Rust sees this as a float literal (must contain '.' or 'e')
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) return s + '.0';
    return s;
  }
  if (expr.type === 'BoolLiteral') return expr.value ? 'true' : 'false';
  if (expr.type === 'NullLiteral') return 'Value::Null';
  if (expr.type === 'Identifier') {
    if (G.ctx.stateVarNames.has(expr.name)) return `self.state.get("${stateKey(expr.name)}").cloned().unwrap_or(Value::Null)`;
    return rustSsaResolve(expr.name);
  }
  if (expr.type === 'BinaryExpr') {
    const rustOp = expr.op === '===' ? '==' : expr.op === '!==' ? '!=' : expr.op;
    const left = genRustExpr(expr.left, typeEnv, eCtx);
    const right = genRustExpr(expr.right, typeEnv, eCtx);
    // Detect string concatenation: + with Text operands
    const exprTypeOf = (e) => {
      if (e.type === 'StringLiteral') return 'Text';
      if (e.type === 'Identifier' && typeEnv) return typeEnv.get(e.name);
      if (e.type === 'RefRead' && typeEnv) return typeEnv.get(e.name);
      if (e.type === 'BinaryExpr' && e.op === '+') {
        const lt = exprTypeOf(e.left);
        const rt = exprTypeOf(e.right);
        if (lt === 'Text' || rt === 'Text') return 'Text';
      }
      return null;
    };
    if (expr.op === '+') {
      const lType = exprTypeOf(expr.left);
      const rType = exprTypeOf(expr.right);
      if (lType === 'Text' || rType === 'Text') {
        // Ensure Value operands (state reads) are extracted as strings, not formatted with quotes
        const isValueExpr = (e) => (e.type === 'Identifier' && G.ctx.stateVarNames.has(e.name))
          || e.type === 'StateVar' || e.type === 'RefRead';
        const l = isValueExpr(expr.left) ? `${left}.as_str().unwrap_or("")` : left;
        const r = isValueExpr(expr.right) ? `${right}.as_str().unwrap_or("")` : right;
        return `format!("{}{}", ${l}, ${r})`;
      }
    }
    // Detect operands that return Value and need extraction for arithmetic/comparison
    const numOps = ['+', '-', '*', '/', '%', '>', '<', '>=', '<=', '==', '!='];
    const lIsValue = expr.left.type === 'StateVar' || expr.left.type === 'RefRead'
      || (expr.left.type === 'Identifier' && G.ctx.stateVarNames.has(expr.left.name))
      || (expr.left.type === 'Identifier' && typeEnv && typeEnv.has(expr.left.name) && !typeEnv.get(expr.left.name));
    const rIsValue = expr.right.type === 'StateVar' || expr.right.type === 'RefRead'
      || (expr.right.type === 'Identifier' && G.ctx.stateVarNames.has(expr.right.name))
      || (expr.right.type === 'Identifier' && typeEnv && typeEnv.has(expr.right.name) && !typeEnv.get(expr.right.name));
    // Detect if this is integer or decimal arithmetic
    const lType = inferExprType(expr.left, typeEnv);
    const rType = inferExprType(expr.right, typeEnv);
    // Float detection — must come before Decimal/Integer detection
    const lIsFloat = lType === 'Float' || expr.left.type === 'FloatLiteral';
    const rIsFloat = rType === 'Float' || expr.right.type === 'FloatLiteral';
    if (lIsFloat || rIsFloat) {
      const lIsInt2 = lType === 'Integer' || expr.left.type === 'IntLiteral';
      const rIsInt2 = rType === 'Integer' || expr.right.type === 'IntLiteral';
      const lIsDec2 = lType === 'Decimal' || expr.left.type === 'DecimalLiteral';
      const rIsDec2 = rType === 'Decimal' || expr.right.type === 'DecimalLiteral';
      // Coerce non-float operands to f64
      const lf = lIsValue ? `${left}.as_f64().unwrap_or(0.0)`
        : lIsInt2 ? `(${left}.to_f64().unwrap_or(0.0))`
        : lIsDec2 ? `${left}.to_f64()` : left;
      const rf = rIsValue ? `${right}.as_f64().unwrap_or(0.0)`
        : rIsInt2 ? `(${right}.to_f64().unwrap_or(0.0))`
        : rIsDec2 ? `${right}.to_f64()` : right;
      if (expr.op === '**') return `(${lf} as f64).powf(${rf} as f64)`;
      return `(${lf} ${rustOp} ${rf})`;
    }
    // Decimal detection — must come before integer detection
    const lIsDec = lType === 'Decimal' || expr.left.type === 'DecimalLiteral';
    const rIsDec = rType === 'Decimal' || expr.right.type === 'DecimalLiteral';
    const isDecArith = lIsDec || rIsDec;
    if (isDecArith) {
      const lIsInt2 = lType === 'Integer' || expr.left.type === 'IntLiteral';
      const rIsInt2 = rType === 'Integer' || expr.right.type === 'IntLiteral';
      // For **, exponent stays as BigInt (not promoted to BvDecimal)
      if (expr.op === '**') {
        const l = lIsValue ? decFromValue(left) : lIsInt2 ? `BvDecimal::from_int(&${left})` : left;
        const r = rIsValue ? intFromValue(right) : right;
        return decPow(l, r);
      }
      // Promote Integer operands to BvDecimal for other ops
      const l = lIsValue ? decFromValue(left) : lIsInt2 ? `BvDecimal::from_int(&${left})` : left;
      const r = rIsValue ? decFromValue(right) : rIsInt2 ? `BvDecimal::from_int(&${right})` : right;
      const arithOps = ['+', '-', '*', '/', '%'];
      const cmpOps = ['==', '!=', '>', '<', '>=', '<='];
      if (arithOps.includes(rustOp)) return decArithOp(l, rustOp, r);
      if (cmpOps.includes(rustOp)) return `bv_dec_cmp_op(&${l}, "${rustOp}", &${r})`;
      return decArithOp(l, rustOp, r);
    }
    const lIsInt = lType === 'Integer' || expr.left.type === 'IntLiteral'
      || (expr.left.type === 'Identifier' && typeEnv && typeEnv.get(expr.left.name) === 'Integer');
    const rIsInt = rType === 'Integer' || expr.right.type === 'IntLiteral'
      || (expr.right.type === 'Identifier' && typeEnv && typeEnv.get(expr.right.name) === 'Integer');
    const isIntArith = lIsInt || rIsInt;
    if (expr.op === '**' && isIntArith) {
      const l = lIsValue ? intFromValue(left) : left;
      const r = rIsValue ? intFromValue(right) : right;
      return intPow(l, r);
    }
    if (isIntArith) {
      const arithOps = ['+', '-', '*', '/', '%'];
      const l = lIsValue ? intFromValue(left) : left;
      const r = rIsValue ? intFromValue(right) : right;
      if (arithOps.includes(rustOp)) return intArithOp(l, rustOp, r);
      // Comparison ops on BigInt: use references but return bool
      return `(&${l} ${rustOp} &${r})`;
    }
    if (expr.op === '**') {
      const l = lIsValue ? intFromValue(left) : left;
      const r = rIsValue ? intFromValue(right) : right;
      return intPow(l, r);
    }
    if (numOps.includes(rustOp) && (lIsValue || rIsValue)) {
      const l = lIsValue ? `${left}.as_i64().unwrap_or(0)` : left;
      const r = rIsValue ? `${right}.as_i64().unwrap_or(0)` : right;
      return `(${l} ${rustOp} ${r})`;
    }
    return `(${left} ${rustOp} ${right})`;
  }
  if (expr.type === 'IndexExpr') {
    const obj = genRustExpr(expr.object, typeEnv, eCtx);
    if (expr.key !== null) {
      return `${obj}.named.get(${JSON.stringify(expr.key)}).cloned().unwrap_or(Value::Null)`;
    }
    return `${obj}.positional.get(${expr.index}).cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
    const positional = expr.args.filter(a => a.positional);
    const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Function');
    const posVals = positional.map(a => {
      const raw = genRustExpr(a.expr, typeEnv, eCtx);
      const t = a.type || (a.expr?.type === 'Identifier' && typeEnv ? typeEnv.get(a.expr.name) : null) || inferLiteralType(a.expr);
      return toJsonValue(raw, t);
    }).join(', ');
    let namedBlock;
    if (named.length > 0) {
      const inserts = named.map(a => {
        const raw = genRustExpr(a.expr, typeEnv, eCtx);
        const t = a.type || (a.expr?.type === 'Identifier' && typeEnv ? typeEnv.get(a.expr.name) : null) || inferLiteralType(a.expr);
        const val = toJsonValue(raw, t);
        return `m.insert(${JSON.stringify(a.key)}.to_string(), ${val});`;
      }).join(' ');
      namedBlock = `{ let mut m = Map::new(); ${inserts} m }`;
    } else {
      namedBlock = 'Map::new()';
    }
    return `Structure { positional: vec![${posVals}], named: ${namedBlock} }`;
  }
  if (expr.type === 'Function') {
    // Closure expression — generate a Rust closure that returns Value
    if (expr.body && expr.body.length > 0) {
      const implRet = expr.body.find(s => s.type === 'ImplicitReturn');
      if (implRet) {
        const inner = genRustExpr(implRet.expr, typeEnv, eCtx);
        return `bv_val(${inner})`;
      }
    }
    if (expr.expr) {
      const inner = genRustExpr(expr.expr, typeEnv, eCtx);
      return `bv_val(${inner})`;
    }
    return 'Value::Null';
  }
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && expr.callee.name === '__tick__') {
    return 'std::thread::yield_now()';
  }
  // Primitive type constructors — unwrap to the inner value (mirrors js/erlang codegen)
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier') {
    const _primitiveTypes = new Set(['Integer', 'Float', 'Text', 'Boolean', 'Decimal']);
    if (_primitiveTypes.has(expr.callee.name) && (expr.args || []).length === 1) {
      return genRustExpr(expr.args[0], typeEnv, eCtx);
    }
  }
  // Emit invocation
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && G.ctx.emitNames.has(expr.callee.name)) {
    const emitDecl = G.ctx.emitNames.get(expr.callee.name);
    const eventName = expr.callee.name;
    let payload;
    if (expr.args.length > 0) {
      const inserts = emitDecl.params.map((p, i) => {
        const val = i < expr.args.length ? genRustExpr(expr.args[i], typeEnv) : 'Value::Null';
        const t = p.type || (i < expr.args.length ? inferLiteralType(expr.args[i]) || inferExprType(expr.args[i], typeEnv) : null);
        return `_em.insert("${p.name}".to_string(), ${toJsonValue(val, t || 'Anything')});`;
      }).join(' ');
      payload = `{ let mut _em = Map::new(); ${inserts} Value::Object(_em) }`;
    } else {
      payload = 'json!({})';
    }
    return `self.emit_${eventName}(&${payload})`;
  }
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(expr.callee.name)) {
    return `${genRustFnCallExpr(expr, typeEnv)}.one()`;
  }
  // Public function call without @ prefix — route through self_send to @name
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && G.ctx.publicFnNames?.has('@' + expr.callee.name)) {
    const rewritten = { ...expr, callee: { ...expr.callee, name: '@' + expr.callee.name } };
    return `${genRustFnCallExpr(rewritten, typeEnv)}.one()`;
  }
  // Destructured member call → route to source service
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && G.ctx.destructuredMembers?.has(expr.callee.name)) {
    const { service, remote } = G.ctx.destructuredMembers.get(expr.callee.name);
    const to = JSON.stringify(service);
    const method = JSON.stringify('@' + remote);
    const callArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
    const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
    let opExpr;
    if (callArgs.length === 0 && !namedBag) {
      opExpr = `json!(${method})`;
    } else if (namedBag) {
      const namedInserts = Object.entries(namedBag.fields).map(([k, v]) => {
        const raw = genRustExpr(v, typeEnv, eCtx);
        const t = inferLiteralType(v) || inferExprType(v, typeEnv);
        return `_nm.insert("${k}".to_string(), ${toJsonValue(raw, t || 'Anything')});`;
      }).join(' ');
      opExpr = `{ let mut _nm = Map::new(); ${namedInserts} Value::Array(vec![Value::Object(_nm), json!(${method})]) }`;
    } else {
      const vals = callArgs.map(a => { const v = genRustExpr(a, typeEnv, eCtx); const t = inferLiteralType(a) || inferExprType(a, typeEnv); return toJsonValue(v, t || 'Anything'); });
      opExpr = `Value::Array(vec![Value::Array(vec![${vals.join(', ')}]), json!(${method})])`;
    }
    return `{
        let seq = self.send_seq.get();
        self.send_seq.set(seq + 1);
        let mut send_msg = Map::new();
        send_msg.insert("id".to_string(), json!(seq.to_string()));
        send_msg.insert("op".to_string(), ${opExpr});
        send_msg.insert("to".to_string(), json!(${to}));
        let _ = self.binding.send(Value::Object(send_msg));
        Value::Null
    }`;
  }
  if (expr.type === 'FunctionCallExpr') {
    const calleeName = expr.callee?.name;
    const calleeType = calleeName && typeEnv ? typeEnv.get(calleeName) : null;
    // Check if callee is a local lambda var (now a handler name in a Value::String)
    const isLocalLambda = calleeName && G.ctx.lambdaVarNames.has(calleeName);
    const isFnTyped = isLocalLambda || (calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->'))));
    if (isFnTyped && calleeName) {
      // Function-typed param/var: call_fn dispatches to the handler name stored in the value
      // Returns a scalar Value (unwrapped from wire format via Structure::pack().one())
      const calleeRef = G.ctx.stateVarNames.has(calleeName)
        ? `self.state.get("${calleeName}").cloned().unwrap_or(Value::Null)`
        : rustSsaResolve(calleeName);
      const callArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag');
      if (callArgs.length === 0) {
        return `{ let _cfr = self.call_fn(&${calleeRef}, &Value::Object(Map::new())); Structure::pack(&_cfr).one() }`;
      }
      // Pre-compute nested call_fn/self_send args to avoid double &mut self borrow
      const precomputes = [];
      // Pre-compute state var access to avoid borrow conflict
      if (G.ctx.stateVarNames.has(calleeName)) {
        precomputes.push(`let _fn_ref = ${calleeRef};`);
      }
      const fnRef = G.ctx.stateVarNames.has(calleeName) ? '_fn_ref' : rustSsaResolve(calleeName);
      const argExprs = callArgs.map((a, i) => {
        const raw = genRustExpr(a, typeEnv, eCtx);
        if (raw.includes('self.call_fn') || raw.includes('self.self_send')) {
          const tmp = `_fnarg_${i}`;
          precomputes.push(`let ${tmp} = ${raw};`);
          return tmp;
        }
        const t = typeEnv.get(a.name) || inferLiteralType(a);
        return toJsonValue(raw, t || 'Anything');
      }).join(', ');
      const preStr = precomputes.length > 0 ? precomputes.join(' ') + ' ' : '';
      return `{ ${preStr}let _cfr = self.call_fn(&${fnRef}, &Value::Array(vec![${argExprs}])); Structure::pack(&_cfr).one() }`;
    }
    const callee = genRustExpr(expr.callee, typeEnv, eCtx);
    const callArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag');
    const argExprs = callArgs.map(a => genRustExpr(a, typeEnv, eCtx)).join(', ');
    return `${callee}(${argExprs})`;
  }
  if (expr.type === 'IfExpr') {
    return genRustIfExpr(expr, typeEnv, eCtx);
  }
  if (expr.type === 'StateVar') {
    return `self.state.get("${stateKey(expr.name)}").cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'RefRead') {
    if (G.ctx.stateVarNames.has(expr.name)) return `self.state.get("${stateKey(expr.name)}").cloned().unwrap_or(Value::Null)`;
    return `self.refs.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'RefArg') {
    return `"ref_${expr.name}".to_string()`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return 'json!([])';
    const hasInt = expr.elements.some(e => {
      const t = inferLiteralType(e.expr || e) || (e.expr ? inferLiteralType(e.expr) : null);
      return t === 'Integer';
    });
    const elems = expr.elements.map(e => {
      const raw = genRustExpr(e.expr || e, typeEnv, eCtx);
      const t = inferLiteralType(e.expr || e) || inferExprType(e.expr || e, typeEnv);
      return toJsonValue(raw, t);
    });
    if (hasInt) return `Value::Array(vec![${elems.join(', ')}])`;
    return `json!([${elems.join(', ')}])`;
  }
  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemoteInst = dotObjName && G.ctx.remoteInstanceVars.has(dotObjName);
    // Local instance vars are bound by `t = Thing(args)` inside a handler
    // body — they hold the instance address as a Value::String directly,
    // not via state.
    const isLocalInst = dotObjName && G.ctx.localInstanceVars?.has(dotObjName);
    // Fire-and-forget send
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    if (isRemoteInst || isLocalInst) {
      const to = isLocalInst
        ? `${rustSsaResolve(dotObjName)}.as_str().unwrap_or("").to_string()`
        : `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
      const method = JSON.stringify('@' + expr.method);
      let opExpr;
      if (positional.length === 0 && named.length === 0) {
        opExpr = `json!(${method})`;
      } else if (named.length > 0) {
        const namedInserts = named.map(a => {
          const val = genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, eCtx);
          const t = typeEnv.get(a.name) || inferLiteralType(a.expr);
          return `_nm.insert("${a.name}".to_string(), ${toJsonValue(val, t || 'Anything')});`;
        }).join(' ');
        opExpr = `{ let mut _nm = Map::new(); ${namedInserts} let mut _arr = vec![Value::Object(_nm), json!(${method})]; Value::Array(_arr) }`;
      } else {
        const genArgVal = a => { const v = a.expr ? genRustExpr(a.expr, typeEnv, eCtx) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, eCtx); const t = a.type || (a.expr ? inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) : typeEnv.get(a.name)); return toJsonValue(v, t || 'Anything'); };
        const posVals = positional.map(genArgVal);
        opExpr = `json!([[${posVals.join(', ')}], ${method}])`;
      }
      return `{
        let seq = self.send_seq.get();
        self.send_seq.set(seq + 1);
        let mut send_msg = Map::new();
        send_msg.insert("id".to_string(), json!(seq.to_string()));
        send_msg.insert("op".to_string(), ${opExpr});
        send_msg.insert("to".to_string(), json!(${to}));
        let _ = self.binding.send(Value::Object(send_msg));
        Value::Null
    }`;
    }
    // Constructs proxy var: dispatch through child_dispatch (fire-and-forget)
    const isConstructsProxy = dotObjName && G.ctx.constructsProxyVars.has(dotObjName);
    if (isConstructsProxy) {
      const childRef = JSON.stringify(G.ctx.constructsVarToProxy.get(dotObjName));
      const method = JSON.stringify('@' + expr.method);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = 'json!({})';
      } else if (named.length > 0) {
        const namedInserts = named.map(a => {
          const val = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
          const t = a.type || (a.expr ? inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) : null);
          return `_nm.insert("${a.name}".to_string(), ${toJsonValue(val, t || 'Anything')});`;
        }).join(' ');
        if (positional.length > 0) {
          const posVals = positional.map(a => { const v = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name); const t = a.type || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv); return toJsonValue(v, t || 'Anything'); });
          payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
        } else {
          payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
        }
      } else {
        const posVals = positional.map(a => { const v = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name); const t = a.type || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv); return toJsonValue(v, t || 'Anything'); });
        payload = valueArray(posVals);
      }
      return `{ self.child_dispatch(${childRef}, ${method}, &${payload}, "", "__parent") }`;
    }
    // Wrapped child param: dispatch through child_dispatch
    const isWrappedChild = dotObjName && G.ctx.stateVarNames.has(dotObjName) && !G.ctx.constructsProxyVars.has(dotObjName) && (G.ctx.stateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !G.ctx.actorInfo.has(dotObjName) && !G.ctx.remoteInstanceVars.has(dotObjName)));
    if (isWrappedChild) {
      const childRef = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
      const method = JSON.stringify('@' + expr.method);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = 'json!({})';
      } else if (named.length > 0) {
        const namedInserts = named.map(a => {
          const val = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
          const t = a.type || (a.expr ? inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) : null);
          return `_nm.insert("${a.name}".to_string(), ${toJsonValue(val, t || 'Anything')});`;
        }).join(' ');
        if (positional.length > 0) {
          const posVals = positional.map(a => { const v = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name); const t = a.type || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv); return toJsonValue(v, t || 'Anything'); });
          payload = `{ let mut _arr: Vec<Value> = vec![${posVals.join(', ')}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); Value::Array(_arr) }`;
        } else {
          payload = `{ let mut _nm = Map::new(); ${namedInserts} Value::Object(_nm) }`;
        }
      } else {
        const posVals = positional.map(a => { const v = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name); const t = a.type || inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv); return toJsonValue(v, t || 'Anything'); });
        payload = valueArray(posVals);
      }
      return `{ let _cn = ${childRef}; self.child_dispatch(&_cn, ${method}, &${payload}, "", "__parent") }`;
    }
    const to = JSON.stringify(expr.object.name);
    const method = JSON.stringify('@' + expr.method);
    if (positional.length === 0 && named.length === 0) {
      return `{
        let seq = self.send_seq.get();
        self.send_seq.set(seq + 1);
        let mut send_msg = Map::new();
        send_msg.insert("id".to_string(), json!(seq.to_string()));
        send_msg.insert("op".to_string(), json!(${method}));
        send_msg.insert("to".to_string(), json!(${to}));
        let _ = self.binding.send(Value::Object(send_msg));
        Value::Null
    }`;
    }
    const genArgValRaw = a => a.expr ? genRustExpr(a.expr, typeEnv, eCtx) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, eCtx);
    const genArgValWrapped = a => { const v = genArgValRaw(a); const t = a.type || a.typeName || (a.expr ? inferLiteralType(a.expr) || inferExprType(a.expr, typeEnv) : typeEnv.get(a.name)); return toJsonValue(v, t || 'Anything'); };
    let opExpr, bvaExpr;
    if (positional.length > 0 && named.length > 0) {
      const posVals = positional.map(genArgValWrapped).join(', ');
      const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${genArgValWrapped(a)});`).join(' ');
      opExpr = `{ let mut _arr: Vec<Value> = vec![${posVals}]; let mut _nm = Map::new(); ${namedInserts} _arr.push(Value::Object(_nm)); _arr.push(json!(${method})); Value::Array(_arr) }`;
      const posBva = positional.map(a => (a.typeName || (a.expr ? inferLiteralType(a.expr) : null)) ? `"${a.typeName || inferLiteralType(a.expr)}"` : 'null').join(', ');
      const namedBva = named.map(a => `"${a.name}": ${(a.typeName || (a.expr ? inferLiteralType(a.expr) : null)) ? `"${a.typeName || inferLiteralType(a.expr)}"` : 'null'}`).join(', ');
      bvaExpr = `json!([${posBva}, {${namedBva}}])`;
    } else if (named.length > 0) {
      const namedInserts = named.map(a => `_nm.insert("${a.name}".to_string(), ${genArgValWrapped(a)});`).join(' ');
      opExpr = `{ let mut _nm = Map::new(); ${namedInserts} Value::Array(vec![Value::Object(_nm), json!(${method})]) }`;
      const namedBva = named.map(a => `"${a.name}": ${(a.typeName || (a.expr ? inferLiteralType(a.expr) : null)) ? `"${a.typeName || inferLiteralType(a.expr)}"` : 'null'}`).join(', ');
      bvaExpr = `json!([{${namedBva}}])`;
    } else {
      const posVals = positional.map(genArgValWrapped);
      opExpr = `Value::Array(vec![Value::Array(vec![${posVals.join(', ')}]), json!(${method})])`;
      const posBva = positional.map(a => (a.typeName || (a.expr ? inferLiteralType(a.expr) : null)) ? `"${a.typeName || inferLiteralType(a.expr)}"` : 'null').join(', ');
      bvaExpr = `json!([[${posBva}]])`;
    }
    return `{
        let seq = self.send_seq.get();
        self.send_seq.set(seq + 1);
        let send_id = seq.to_string();
        let mut send_msg = Map::new();
        send_msg.insert("id".to_string(), json!(send_id));
        send_msg.insert("op".to_string(), ${opExpr});
        send_msg.insert("to".to_string(), json!(${to}));
        send_msg.insert("bv-a".to_string(), ${bvaExpr});
        let _ = self.binding.send(Value::Object(send_msg));
        Value::Null
    }`;
  }
  if (expr.type === 'FnRef' && G.ctx.actorFnNames.has(expr.name)) {
    return `Value::String("${expr.name}".to_string())`;
  }
  if (expr.type === 'FnRef') {
    return rustSsaResolve(expr.name);
  }
  if (expr.type === 'SizeExpr') {
    const arg = genRustExpr(expr.arg, typeEnv, eCtx);
    // RefRead and state vars resolve to Value — extract &str first
    if (expr.arg.type === 'RefRead' || expr.arg.type === 'StateVar') {
      return intFromI64(`(${arg}.as_str().map_or(0, |s| s.chars().count()) as i64)`);
    }
    return intFromI64(`(${arg}.chars().count() as i64)`);
  }
  if (expr.type === 'RegexLiteral') {
    const flags = expr.flags || '';
    const prefix = flags ? `(?${flags})` : '';
    return `Regex::new(${JSON.stringify(prefix + expr.pattern)}).unwrap()`;
  }
  if (expr.type === 'BlobMethodExpr') {
    const a0 = expr.args[0];
    const raw = genRustExpr(a0, typeEnv, eCtx);
    const isVal = a0.type === 'RefRead' || a0.type === 'StateVar';
    const s = isVal ? `${raw}.as_str().unwrap_or("")` : raw;
    const m = expr.method;
    if (m === 'size') return intFromI64(`(${s}.len() as i64)`);
    if (m === 'empty?') return `${s}.is_empty()`;
    if (m === 'repeat') return `${s}.repeat(${intToUsize(genRustExpr(expr.args[1], typeEnv, eCtx))})`;
    if (m === 'reverse') return `String::from_utf8_lossy(&${s}.as_bytes().iter().rev().copied().collect::<Vec<u8>>()).to_string()`;
    if (m === 'first') return `if ${s}.is_empty() { String::new() } else { String::from(${s}.as_bytes()[0] as char) }`;
    if (m === 'last') return `if ${s}.is_empty() { String::new() } else { String::from(*${s}.as_bytes().last().unwrap() as char) }`;
    if (m === 'slice') {
      const start = genRustExpr(expr.args[1], typeEnv, eCtx);
      if (expr.args[2]) {
        const end = genRustExpr(expr.args[2], typeEnv, eCtx);
        return `${s}[${intToUsize(start)}..${intToUsize(end)}].to_string()`;
      }
      return `${s}[${intToUsize(start)}..].to_string()`;
    }
    if (m === 'contains') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `${genRustExpr(needle, typeEnv, eCtx)}.is_match(${s})`;
      return `${s}.contains(&*${genRustExpr(needle, typeEnv, eCtx)})`;
    }
    if (m === 'starts_with') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `Regex::new(&format!("^(?:{})", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
      return `${s}.starts_with(&*${genRustExpr(needle, typeEnv, eCtx)})`;
    }
    if (m === 'ends_with') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `Regex::new(&format!("(?:{})$", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
      return `${s}.ends_with(&*${genRustExpr(needle, typeEnv, eCtx)})`;
    }
    if (m === 'index_of') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return intFromI64(`${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(-1i64, |m| m.start() as i64)`);
      const nv = genRustExpr(needle, typeEnv, eCtx);
      return intFromI64(`${s}.find(&*${nv}).map_or(-1i64, |i| i as i64)`);
    }
    if (m === 'before') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(${s}.to_string(), |m| ${s}[..m.start()].to_string())`;
      const nv = genRustExpr(needle, typeEnv, eCtx);
      return `(|_s: &str, _n: &str| _s.find(_n).map_or(_s.to_string(), |i| _s[..i].to_string()))(${s}, &*${nv})`;
    }
    if (m === 'after') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(String::new(), |m| ${s}[m.end()..].to_string())`;
      const nv = genRustExpr(needle, typeEnv, eCtx);
      return `(|_s: &str, _n: &str| _s.find(_n).map_or(String::new(), |i| _s[i + _n.len()..].to_string()))(${s}, &*${nv})`;
    }
    if (m === 'trim') return `${s}.trim().to_string()`;
    if (m === 'trim_start') return `${s}.trim_start().to_string()`;
    if (m === 'trim_end') return `${s}.trim_end().to_string()`;
    if (m === 'replace') {
      const old = expr.args[1];
      const rep = genRustExpr(expr.args[2], typeEnv, eCtx);
      if (old.type === 'RegexLiteral') return `${genRustExpr(old, typeEnv, eCtx)}.replace_all(${s}, &*${rep}).to_string()`;
      return `${s}.replace(&*${genRustExpr(old, typeEnv, eCtx)}, &*${rep})`;
    }
    if (m === 'replace_first') {
      const old = expr.args[1];
      const rep = genRustExpr(expr.args[2], typeEnv, eCtx);
      if (old.type === 'RegexLiteral') return `${genRustExpr(old, typeEnv, eCtx)}.replacen(${s}, 1, &*${rep}).to_string()`;
      return `${s}.replacen(&*${genRustExpr(old, typeEnv, eCtx)}, &*${rep}, 1)`;
    }
    if (m === 'split') {
      const sep = expr.args[1];
      if (sep.type === 'RegexLiteral') return `${genRustExpr(sep, typeEnv, eCtx)}.split(${s}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
      return `${s}.split(&*${genRustExpr(sep, typeEnv, eCtx)}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
    }
    if (m === 'lines') return `${s}.lines().map(|l| Value::String(l.to_string())).collect::<Vec<_>>()`;
    throw new Error(`Unknown Blob method: ${m}`);
  }
  if (expr.type === 'TextMethodExpr') {
    const a0 = expr.args[0];
    const raw = genRustExpr(a0, typeEnv, eCtx);
    const isVal = a0.type === 'RefRead' || a0.type === 'StateVar';
    const s = isVal ? `${raw}.as_str().unwrap_or("")` : raw;
    const m = expr.method;
    // Unicode-specific (no Blob equivalent)
    if (m === 'upper') return `${s}.to_uppercase()`;
    if (m === 'lower') return `${s}.to_lowercase()`;
    // Content operations shared with Blob
    if (m === 'trim') return `${s}.trim().to_string()`;
    if (m === 'trim_start') return `${s}.trim_start().to_string()`;
    if (m === 'trim_end') return `${s}.trim_end().to_string()`;
    if (m === 'empty?') return `${s}.is_empty()`;
    if (m === 'repeat') return `${s}.repeat(${intToUsize(genRustExpr(expr.args[1], typeEnv, eCtx))})`;
    // Scalar-indexed (differ from Blob byte-level)
    if (m === 'reverse') return `${s}.chars().rev().collect::<String>()`;
    if (m === 'first') return `${s}.chars().next().map_or(String::new(), |c| c.to_string())`;
    if (m === 'last') return `${s}.chars().last().map_or(String::new(), |c| c.to_string())`;
    if (m === 'slice') {
      const start = genRustExpr(expr.args[1], typeEnv, eCtx);
      if (expr.args[2]) {
        const end = genRustExpr(expr.args[2], typeEnv, eCtx);
        return `${s}.chars().skip(${intToUsize(start)}).take(${intToUsize(`(&${end} - &${start})`)}).collect::<String>()`;
      }
      return `${s}.chars().skip(${intToUsize(start)}).collect::<String>()`;
    }
    if (m === 'contains') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `${genRustExpr(needle, typeEnv, eCtx)}.is_match(${s})`;
      const nv = genRustExpr(needle, typeEnv, eCtx);
      const isNeedleVal = needle.type === 'RefRead' || needle.type === 'StateVar';
      const ns = isNeedleVal ? `${nv}.as_str().unwrap_or("")` : nv;
      return `${s}.contains(&*${ns})`;
    }
    if (m === 'starts_with') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `Regex::new(&format!("^(?:{})", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
      const nv = genRustExpr(needle, typeEnv, eCtx);
      const isNeedleVal = needle.type === 'RefRead' || needle.type === 'StateVar';
      const ns = isNeedleVal ? `${nv}.as_str().unwrap_or("")` : nv;
      return `${s}.starts_with(&*${ns})`;
    }
    if (m === 'ends_with') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') return `Regex::new(&format!("(?:{})$", ${JSON.stringify(needle.pattern)})).unwrap().is_match(${s})`;
      const nv = genRustExpr(needle, typeEnv, eCtx);
      const isNeedleVal = needle.type === 'RefRead' || needle.type === 'StateVar';
      const ns = isNeedleVal ? `${nv}.as_str().unwrap_or("")` : nv;
      return `${s}.ends_with(&*${ns})`;
    }
    if (m === 'index_of') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') {
        return intFromI64(`${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(-1i64, |m| ${s}[..m.start()].chars().count() as i64)`);
      }
      const nv = genRustExpr(needle, typeEnv, eCtx);
      const isNeedleVal = needle.type === 'RefRead' || needle.type === 'StateVar';
      const ns = isNeedleVal ? `${nv}.as_str().unwrap_or("")` : nv;
      return intFromI64(`${s}.find(&*${ns}).map_or(-1i64, |i| ${s}[..i].chars().count() as i64)`);
    }
    if (m === 'before') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') {
        return `${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(${s}.to_string(), |m| ${s}[..m.start()].to_string())`;
      }
      const nv = genRustExpr(needle, typeEnv, eCtx);
      return `(|_s: &str, _n: &str| _s.find(_n).map_or(_s.to_string(), |i| _s[..i].to_string()))(${s}, &*${nv})`;
    }
    if (m === 'after') {
      const needle = expr.args[1];
      if (needle.type === 'RegexLiteral') {
        return `${genRustExpr(needle, typeEnv, eCtx)}.find(${s}).map_or(String::new(), |m| ${s}[m.end()..].to_string())`;
      }
      const nv = genRustExpr(needle, typeEnv, eCtx);
      return `(|_s: &str, _n: &str| _s.find(_n).map_or(String::new(), |i| _s[i + _n.len()..].to_string()))(${s}, &*${nv})`;
    }
    if (m === 'replace') {
      const old = expr.args[1];
      const rep = genRustExpr(expr.args[2], typeEnv, eCtx);
      if (old.type === 'RegexLiteral') return `${genRustExpr(old, typeEnv, eCtx)}.replace_all(${s}, &*${rep}).to_string()`;
      return `${s}.replace(&*${genRustExpr(old, typeEnv, eCtx)}, &*${rep})`;
    }
    if (m === 'replace_first') {
      const old = expr.args[1];
      const rep = genRustExpr(expr.args[2], typeEnv, eCtx);
      if (old.type === 'RegexLiteral') return `${genRustExpr(old, typeEnv, eCtx)}.replacen(${s}, 1, &*${rep}).to_string()`;
      return `${s}.replacen(&*${genRustExpr(old, typeEnv, eCtx)}, &*${rep}, 1)`;
    }
    if (m === 'split') {
      const sep = expr.args[1];
      if (sep.type === 'RegexLiteral') return `${genRustExpr(sep, typeEnv, eCtx)}.split(${s}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
      return `${s}.split(&*${genRustExpr(sep, typeEnv, eCtx)}).map(|p| Value::String(p.to_string())).collect::<Vec<_>>()`;
    }
    if (m === 'lines') return `${s}.lines().map(|l| Value::String(l.to_string())).collect::<Vec<_>>()`;
    throw new Error(`Unknown Text method: ${m}`);
  }
  if (expr.type === 'OverExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, eCtx);
    let fn = expr.fn;
    // Handle FnRef (actor function) — call the fn method for each element
    if (fn.type === 'FnRef' && G.ctx.actorFnNames.has(fn.name)) {
      const fnName = fn.name.startsWith('#') ? `pv_${fn.name.slice(1)}` : fn.name;
      return `{ let mut _result = Vec::new(); if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_el.clone()], named: Map::new() }; _result.push(self.${fnName}_fn(&_s).one()); } } Value::Array(_result) }`;
    }
    // Resolve FnRef to actual function node via eCtx.fnDefs
    if (fn.type === 'FnRef' && eCtx?.fnDefs) {
      const tracked = eCtx.fnDefs.get(fn.name);
      if (tracked) fn = tracked.node;
    }
    const params = fn.params || [];
    const param = params[0];
    const paramName = param ? param.name : '_item';
    const paramType = param?.type;
    const implRet = fn.body ? fn.body.find(s => s.type === 'ImplicitReturn') : null;
    const bodyStmts = fn.body ? fn.body.filter(s => s.type !== 'ImplicitReturn' && s.type !== 'Return') : [];
    const bodyExpr = implRet ? implRet.expr : fn.expr;
    if (bodyExpr) {
      const retType = fn.returnType;
      // Build body statements for multi-statement fn bodies
      const stmtLines = [];
      if (paramType) {
        const access = convertFromValue(`_el.clone()`, paramType);
        stmtLines.push(`let ${paramName}: ${rustType(paramType)} = ${access};`);
        typeEnv.set(paramName, paramType);
      } else {
        stmtLines.push(`let ${paramName} = _el.clone();`);
      }
      for (const bs of bodyStmts) {
        if (bs.type === 'TypedAssign' && bs.value.type === 'FunctionCallExpr' && bs.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(bs.value.callee.name)) {
          const pcExpr = genRustFnCallExpr(bs.value, typeEnv);
          stmtLines.push(`let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${convertFromValue(`${pcExpr}.one()`, bs.typeName)};`);
        } else if (bs.type === 'DestructureAssign' && bs.source.type === 'FunctionCallExpr' && bs.source.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(bs.source.callee.name)) {
          // Destructure from function call: result: sq : Integer = square(item)
          const pcExpr = genRustFnCallExpr(bs.source, typeEnv);
          const tmpVar = `_ds_${bs.pattern[0]?.name || 'tmp'}`;
          stmtLines.push(`let ${tmpVar} = ${pcExpr};`);
          for (const item of bs.pattern) {
            if (!item.name) continue;
            const key = item.key || item.name;
            const accessor = `${tmpVar}.named.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              stmtLines.push(`let ${rustIdent(item.name)}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              stmtLines.push(`let ${rustIdent(item.name)} = ${accessor};`);
            }
          }
        } else if (bs.type === 'TypedAssign') {
          stmtLines.push(`let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv, eCtx)};`);
        } else if (bs.type === 'Assign') {
          stmtLines.push(`let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv, eCtx)};`);
        }
      }
      const innerExpr = genRustExpr(bodyExpr, typeEnv, eCtx);
      const wrapped = toJsonValue(innerExpr, retType);
      stmtLines.push(wrapped);
      return `${coll}.as_array().map(|_arr| Value::Array(_arr.iter().map(|_el| { ${stmtLines.join(' ')} }).collect())).unwrap_or(Value::Null)`;
    }
    return 'Value::Null';
  }
  if (expr.type === 'ReduceExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, eCtx);
    const init = expr.initial ? genRustExpr(expr.initial, typeEnv, eCtx) : 'Value::Null';
    let fn = expr.fn;
    // Handle FnRef (actor function) — call the fn method with (acc, item) for each element
    if (fn.type === 'FnRef' && G.ctx.actorFnNames.has(fn.name)) {
      const fnName = fn.name.startsWith('#') ? `pv_${fn.name.slice(1)}` : fn.name;
      if (expr.initial) {
        const initVal = forceJsonWrap(init);
        return `{ let mut _acc: Value = ${initVal}; if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${fnName}_fn(&_s).one(); } } _acc }`;
      } else {
        return `{ let _cv = ${coll}; if let Some(_arr) = _cv.as_array() { if _arr.is_empty() { Value::Null } else { let mut _acc = _arr[0].clone(); for _el in &_arr[1..] { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${fnName}_fn(&_s).one(); } _acc } } else { Value::Null } }`;
      }
    }
    // Resolve FnRef to actual function node via eCtx.fnDefs
    if (fn.type === 'FnRef' && eCtx?.fnDefs) {
      const tracked = eCtx.fnDefs.get(fn.name);
      if (tracked) fn = tracked.node;
    }
    const params = fn.params || [];
    const accParam = params[0];
    const itemParam = params[1];
    const accName = accParam ? accParam.name : '_acc';
    const itemName = itemParam ? itemParam.name : '_item';
    const accType = accParam?.type;
    const itemType = itemParam?.type;
    const implRet = fn.body ? fn.body.find(s => s.type === 'ImplicitReturn') : null;
    const bodyExpr = implRet ? implRet.expr : fn.expr;
    if (bodyExpr) {
      const innerExpr = genRustExpr(bodyExpr, typeEnv, eCtx);
      const retType = fn.returnType;
      const wrapped = toJsonValue(innerExpr, retType);
      const accAccess = accType ? convertFromValue('_a.clone()', accType) : '_a.clone()';
      const itemAccess = itemType ? convertFromValue('_el.clone()', itemType) : '_el.clone()';
      const accRustType = accType ? rustType(accType) : 'Value';
      const itemRustType = itemType ? rustType(itemType) : 'Value';
      if (accType) typeEnv.set(accName, accType);
      if (itemType) typeEnv.set(itemName, itemType);
      if (expr.initial) {
        const initVal = toJsonValue(init, accType);
        return `${coll}.as_array().map(|_arr| _arr.iter().fold(${initVal}, |_a: Value, _el| { let ${accName}: ${accRustType} = ${accAccess}; let ${itemName}: ${itemRustType} = ${itemAccess}; ${wrapped} })).unwrap_or(Value::Null)`;
      } else {
        return `{ let _cv = ${coll}; if let Some(_arr) = _cv.as_array() { if _arr.is_empty() { Value::Null } else { _arr[1..].iter().fold(_arr[0].clone(), |_a: Value, _el| { let ${accName}: ${accRustType} = ${accAccess}; let ${itemName}: ${itemRustType} = ${itemAccess}; ${wrapped} }) } } else { Value::Null } }`;
      }
    }
    return 'Value::Null';
  }
  if (expr.type === 'DotAccessExpr') {
    // Bare field read on a child actor: c.val → synchronous child_<actor>_dispatch call
    // with op "@field" and empty payload. Returned wire Value is packed into a Structure
    // by the caller so a single positional can be extracted.
    if (expr.object?.type === 'Identifier' && eCtx?.childActorRefs?.has(expr.object.name)) {
      const actorName = eCtx.childActorRefs.get(expr.object.name);
      const method = JSON.stringify('@' + expr.property);
      return `self.child_${actorName.toLowerCase()}_dispatch(${method}, &json!({}), "", "__parent")`;
    }
    throw new Error(`Unsupported Rust DotAccessExpr on ${expr.object?.type}`);
  }
  throw new Error(`Unsupported Rust expression: ${expr.type}`);
}

function genRustIfBranch(branch, typeEnv, eCtx, indent, targetType) {
  if (!branch) return `${indent}Value::Null`;
  // Simple expression form
  if (branch.expr) {
    const raw = genRustExpr(branch.expr, typeEnv, eCtx);
    return `${indent}${convertBranchExpr(raw, branch.expr, targetType)}`;
  }
  // Block form with body
  if (branch.body) {
    const lines = [];
    let lastTypedName = null;
    for (const s of branch.body) {
      if (s.type === 'BareTypeDecl') continue;
      if (s.type === 'TypedAssign') {
        lastTypedName = s.name;
        if (s.value.type === 'IfExpr') {
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, eCtx, indent, rustType(s.typeName))};`);
        } else if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.value.callee.name)) {
          const callExpr = genRustFnCallExpr(s.value, typeEnv);
          const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
        } else {
          let val = genRustExpr(s.value, typeEnv, eCtx);
          if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
        }
      } else if (s.type === 'DestructureAssign') {
        if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(s.source.callee.name)) {
          const callExpr = genRustFnCallExpr(s.source, typeEnv);
          const tempName = `_r${G.ctx.fnTempCounter++}`;
          lines.push(`${indent}let ${tempName} = ${callExpr};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            lastTypedName = item.name;
            if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${indent}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${indent}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        }
      } else if (s.type === 'Assign') {
        lastTypedName = s.name;
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${genRustExpr(s.value, typeEnv, eCtx)};`);
        } else {
          lines.push(`${indent}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv, eCtx)};`);
        }
      } else if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, typeEnv, eCtx);
        const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
        lines.push(`${indent}self.state.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      } else if (s.type === 'SetStatement') {
        const val = genRustExpr(s.value, typeEnv, eCtx);
        const t = typeEnv.get(s.name) || inferLiteralType(s.value);
        lines.push(`${indent}${rsStore(s.name)}.insert("${stateKey(s.name)}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      } else if (s.type === 'ImplicitReturn') {
        lastTypedName = null;
        const raw = genRustExpr(s.expr, typeEnv, eCtx);
        lines.push(`${indent}${convertBranchExpr(raw, s.expr, targetType)}`);
      }
    }
    if (lastTypedName !== null) {
      lines.push(`${indent}${lastTypedName}`);
    }
    return lines.join('\n');
  }
  return `${indent}Value::Null`;
}

function genRustCondition(expr, typeEnv, eCtx) {
  const raw = genRustExpr(expr, typeEnv, eCtx);
  if (isBoolExpr(expr)) return raw;
  // StateVar/RefRead — Value type, check truthiness
  if (expr.type === 'StateVar' || expr.type === 'RefRead') {
    return `${raw} != Value::Null && ${raw} != json!(false)`;
  }
  // Identifier with known type
  if (expr.type === 'Identifier' && typeEnv) {
    const t = typeEnv.get(expr.name);
    if (t === 'Boolean') return raw;
    if (t === 'Integer' || t === 'Float' || t === 'Text') return 'true';
    return `${raw} != Value::Null && ${raw} != json!(false)`;
  }
  if (expr.type === 'IntLiteral' || expr.type === 'FloatLiteral' || expr.type === 'StringLiteral') return 'true';
  if (expr.type === 'NullLiteral') return 'false';
  return raw;
}

function genRustIfExpr(expr, typeEnv, eCtx, indent, targetType) {
  const I = indent || '    ';
  const cond = genRustCondition(expr.cond, typeEnv, eCtx);
  const thenCode = genRustIfBranch(expr.then, typeEnv, eCtx, I + '    ', targetType);
  let elseCode;
  if (!expr.else) {
    elseCode = `${I}    Value::Null`;
  } else if (expr.else.type === 'IfExpr') {
    elseCode = `${I}    ` + genRustIfExpr(expr.else, typeEnv, eCtx, I + '    ', targetType);
  } else {
    elseCode = genRustIfBranch(expr.else, typeEnv, eCtx, I + '    ', targetType);
  }
  return `if ${cond} {\n${thenCode}\n${I}} else {\n${elseCode}\n${I}}`;
}

function genRustFnMethod({ name: op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const I = '        ';

  // Destructure params from _s
  const paramLines = [];
  let posIdx = 0;
  for (const p of params) {
    if (p.positional) {
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `_s.positional.get(${posIdx}).cloned().unwrap_or(${dv})`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      posIdx++;
    } else {
      const key = p.key || p.name;
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(${dv})`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
    }
  }

  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, I);
  const retExpr = reply ? genRustFnReturn(reply.fields, typeEnv) : 'Structure::empty()';
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  const bodyLines = [];
  if (paramLines.length > 0) bodyLines.push(paramLines.join('\n'));
  if (locals) bodyLines.push(locals);
  bodyLines.push(`${I}${retExpr}`);

  const fnBaseName = op.startsWith('#') ? `pv_${op.slice(1)}` : op;
  return `    fn ${fnBaseName}_fn(&mut self, _s: &Structure) -> Structure {\n${bodyLines.join('\n')}\n    }`;
}

function genRustFnReturn(fields, typeEnv) {
  const spread = fields.find(f => f.spread);
  if (spread) return rustSsaResolve(spread.name);

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  const posVals = pos.map(f => {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferExprType(f.expr, typeEnv);
    if (f.name) {
      if (f.name && f.name.startsWith('$')) return resolveVarExpr(f.name);
      return forceJsonWrap(toJsonValue(rustSsaResolve(f.name), t));
    }
    if (f.expr) return forceJsonWrap(toJsonValue(genRustExpr(f.expr, typeEnv), t));
    return 'Value::Null';
  }).join(', ');

  let namedBlock;
  if (named.length > 0) {
    const inserts = named.map(f => {
      let key, val;
      if ('sigil' in f) {
        key = f.sigil;
        const sigilType = typeEnv.get(f.sigil) || f.type;
        val = f.sigil.startsWith('$') ? resolveVarExpr(f.sigil) : (sigilType ? forceJsonWrap(toJsonValue(rustSsaResolve(f.sigil), sigilType)) : `bv_val(${rustSsaResolve(f.sigil)})`);
      } else if (f.key !== undefined) {
        val = forceJsonWrap(toJsonValue(genRustExpr(f.value, typeEnv), f.type || inferExprType(f.value, typeEnv)));
        key = f.key;
      }
      return `m.insert(${JSON.stringify(key)}.to_string(), ${val});`;
    }).join(' ');
    namedBlock = `{ let mut m = Map::new(); ${inserts} m }`;
  } else {
    namedBlock = 'Map::new()';
  }
  return `Structure { positional: vec![${posVals}], named: ${namedBlock} }`;
}

function genRustFnCallExpr(expr, typeEnv) {
  const calleeName = expr.callee.name;
  // Self-send: call through handle_op dispatch, return re value
  // Use child dispatch when inside child actor context
  const selfSendCall = G.ctx.childSelfSendPrefix
    ? `self.child_${G.ctx.childSelfSendPrefix}_dispatch("${calleeName}", &Value::Object(Map::new()), "", "__parent")`
    : `self.self_send("${calleeName}", &Value::Object(Map::new()))`;
  if (expr.args.length === 0) {
    return `{ let _re = ${selfSendCall}; Structure::pack(&_re) }`;
  }
  const positionalArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  // Register lambda args as temporary dispatch handlers
  const argVals = positionalArgs.map(a => {
    if (a.type === 'Function') {
      const lambdaName = `_lambda_${G.ctx.lambdaCounter++}`;
      G.ctx.lambdaHandlers.push({ name: lambdaName, fn: a });
      return `Value::String("${lambdaName}".to_string())`;
    }
    const raw = genRustExpr(a, typeEnv);
    const t = typeEnv.get(a.name) || inferLiteralType(a);
    return toJsonValue(raw, t || 'Anything');
  });
  if (namedBag && positionalArgs.length === 0) {
    // Named-only args
    const inserts = Object.entries(namedBag.fields).map(([key, val]) => {
      const raw = genRustExpr(val, typeEnv);
      const t = typeEnv.get(val.name) || inferLiteralType(val);
      return `m.insert(${JSON.stringify(key)}.to_string(), ${toJsonValue(raw, t || 'Anything')});`;
    }).join(' ');
    return `{ let _payload = { let mut m = Map::new(); ${inserts} Value::Object(m) }; let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
  }
  if (namedBag) {
    const inserts = Object.entries(namedBag.fields).map(([key, val]) => {
      const raw = genRustExpr(val, typeEnv);
      const t = typeEnv.get(val.name) || inferLiteralType(val);
      return `m.insert(${JSON.stringify(key)}.to_string(), ${toJsonValue(raw, t || 'Anything')});`;
    }).join(' ');
    return `{ let mut _arr: Vec<Value> = vec![${argVals.join(', ')}]; { let mut m = Map::new(); ${inserts} _arr.push(Value::Object(m)); } let _payload = Value::Array(_arr); let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
  }
  return `{ let _payload = Value::Array(vec![${argVals.join(', ')}]); let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
}

function genRustDefaultValue(node, _brevityType) {
  if (node.type === 'IntLiteral') return intToValue(intLiteral(node.value));
  if (node.type === 'DecimalLiteral') return `json!(${node.value})`;
  if (node.type === 'FloatLiteral') return `json!(${node.value})`;
  if (node.type === 'StringLiteral') return `json!(${JSON.stringify(node.value)})`;
  if (node.type === 'BoolLiteral') return `json!(${node.value})`;
  if (node.type === 'NullLiteral') return 'Value::Null';
  if (node.type === 'StructureLiteral') return 'json!({})';
  return 'Value::Null';
}

function genRustDestructure(params) {
  const lines = [];
  const hasPositional = params.some(p => p.positional && !p.rest);

  if (hasPositional) {
    lines.push(`                let _s = Structure::pack(&payload);`);
  }

  let posIdx = 0;
  for (const p of params) {
    if (p.rest) {
      lines.push(`                let args = Structure::pack(&payload);`);
      continue;
    }
    if (p.positional) {
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `_s.positional.get(${posIdx}).cloned().unwrap_or(${dv})`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
      posIdx++;
    } else if (hasPositional) {
      // Named param in a mixed public function — use _s.named
      const key = p.key || p.name;
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(${dv})`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    } else {
      // Pure named public function — use payload directly (existing behavior)
      const key = p.key || p.name;
      const dv = p.defaultValue ? genRustDefaultValue(p.defaultValue, p.type) : 'Value::Null';
      const accessor = `payload.get("${key}").cloned().unwrap_or(${dv})`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    }
  }
  return lines.join('\n');
}

function genRecursiveFnDef(name, funcNode, typeEnv) {
  const params = funcNode.params || [];
  const bodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
  const implRet = funcNode.body?.find(st => st.type === 'ImplicitReturn');

  // Determine return type from last body statement or ImplicitReturn
  let returnType = null;
  if (bodyStmts.length > 0) {
    const lastStmt = bodyStmts[bodyStmts.length - 1];
    if (lastStmt.type === 'TypedAssign') returnType = lastStmt.typeName;
  }
  if (!returnType) returnType = 'Value';

  // Build param list
  const paramList = params.map(p => {
    const pt = p.type || returnType; // fallback: same type as return
    return `${rustIdent(p.name)}: ${rustType(pt)}`;
  }).join(', ');
  const rt = rustType(returnType);

  // Build local typeEnv for the function
  const fnTypeEnv = new Map(typeEnv);
  for (const p of params) {
    fnTypeEnv.set(p.name, p.type || returnType);
  }

  const lines = [];
  lines.push(`fn ${rustIdent(name)}(${paramList}) -> ${rt} {`);
  for (const bs of bodyStmts) {
    if (bs.type === 'TypedAssign') {
      lines.push(`    let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
    } else if (bs.type === 'Assign') {
      const knownType = inferLiteralType(bs.value);
      if (knownType) {
        lines.push(`    let ${rustIdent(bs.name)}: ${rustType(knownType)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
      } else {
        lines.push(`    let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
      }
    }
  }

  // Return expression
  let retExpr;
  if (implRet) {
    retExpr = genRustExpr(implRet.expr, fnTypeEnv);
  } else if (bodyStmts.length > 0) {
    const lastStmt = bodyStmts[bodyStmts.length - 1];
    if (lastStmt.name) retExpr = rustIdent(lastStmt.name);
  }
  if (retExpr) lines.push(`    ${retExpr}`);
  lines.push('}');
  return lines.join('\n');
}

// --- Helper functions extracted from genRustLocals ---

// Handles TypedAssign statements. Returns true if the caller should `continue` (skip to next iteration).

export { genRustExpr, genRustIfBranch, genRustIfExpr, genRustFnMethod, genRustFnReturn, genRustFnCallExpr, genRustDestructure, genRecursiveFnDef, genRustCondition, genRustDefaultValue };
