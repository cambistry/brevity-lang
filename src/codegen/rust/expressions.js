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
import { RUST_BLOB_METHODS, RUST_TEXT_METHODS, RUST_GRAPHEME_METHODS, RUST_LIST_METHODS, dispatchMethod } from './method_tables.js';

// Classify the source numeric type of an operand for coercion
function operandSrcType(node, inferredType) {
  if (inferredType === 'Integer' || node.type === 'IntLiteral') return 'Integer';
  if (inferredType === 'Decimal' || node.type === 'DecimalLiteral') return 'Decimal';
  if (inferredType === 'Float' || node.type === 'FloatLiteral') return 'Float';
  return null;
}

// Coerce a Rust operand expression to a target numeric type
function coerceOperand(code, isValue, srcType, target) {
  switch (target) {
    case 'f64':
      if (isValue) return `${code}.as_f64().unwrap_or(0.0)`;
      if (srcType === 'Integer') return `(${code}.to_f64().unwrap_or(0.0))`;
      if (srcType === 'Decimal') return `${code}.to_f64()`;
      return code;
    case 'BvDecimal':
      if (isValue) return decFromValue(code);
      if (srcType === 'Integer') return `BvDecimal::from_int(&${code})`;
      return code;
    case 'BigInt':
      if (isValue) return intFromValue(code);
      return code;
    case 'i64':
      if (isValue) return `${code}.as_i64().unwrap_or(0)`;
      return code;
    default:
      return code;
  }
}

function genRustExpr(expr, typeEnv, eCtx) {
  if (expr._precomputed) return expr._precomputed;
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'InterpolatedString') {
    // Emit a single format! call. Literal text parts go into the format
    // string (with { and } escaped as {{ and }}); expression parts are
    // stringified via the BvStr trait (runtime dispatches per value type).
    const fmtChunks = [];
    const args = [];
    for (const p of expr.parts) {
      if (p.kind === 'text') {
        fmtChunks.push(p.value.replace(/\{/g, '{{').replace(/\}/g, '}}'));
      } else {
        fmtChunks.push('{}');
        const code = genRustExpr(p.expr, typeEnv, eCtx);
        args.push(`(&(${code})).bv_str()`);
      }
    }
    if (args.length === 0) return JSON.stringify(fmtChunks.join(''));
    return `format!(${JSON.stringify(fmtChunks.join(''))}, ${args.join(', ')})`;
  }
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
    // Slice 11: `??` falls back from null to the right-hand side. Values
    // are serde_json::Value; check for Value::Null before unwrapping.
    if (expr.op === '??') {
      const lc = genRustExpr(expr.left, typeEnv, eCtx);
      const rc = genRustExpr(expr.right, typeEnv, eCtx);
      const lt = inferExprType(expr.left, typeEnv) || inferLiteralType(expr.left);
      const rt = inferExprType(expr.right, typeEnv) || inferLiteralType(expr.right);
      const lv = toJsonValue(lc, lt || 'Anything');
      const rv = toJsonValue(rc, rt || 'Anything');
      return `({ let _l = ${lv}; if matches!(&_l, Value::Null) { ${rv} } else { _l } })`;
    }
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
        if (lt === 'Blob' || rt === 'Blob') return 'Blob';
        if (lt === 'GraphemeText' || rt === 'GraphemeText') return 'GraphemeText';
      }
      return null;
    };
    if (expr.op === '+') {
      const lType = exprTypeOf(expr.left);
      const rType = exprTypeOf(expr.right);
      if (lType === 'Text' || rType === 'Text' || lType === 'Blob' || rType === 'Blob' || lType === 'GraphemeText' || rType === 'GraphemeText') {
        // Ensure Value operands (state reads) are extracted as strings, not formatted with quotes
        const isValueExpr = (e) => (e.type === 'Identifier' && G.ctx.stateVarNames.has(e.name))
          || e.type === 'StateVar' || e.type === 'RefRead';
        const l = isValueExpr(expr.left) ? `${left}.as_str().unwrap_or("")` : left;
        const r = isValueExpr(expr.right) ? `${right}.as_str().unwrap_or("")` : right;
        return `format!("{}{}", ${l}, ${r})`;
      }
      // List + List → concat (synonym of List.concat). Both operands are Value::Array.
      const lInf = inferExprType(expr.left, typeEnv);
      const rInf = inferExprType(expr.right, typeEnv);
      if (typeof lInf === 'string' && typeof rInf === 'string'
          && lInf.startsWith('List') && rInf.startsWith('List')) {
        return `bv_list_concat(&${left}, &${right})`;
      }
    }
    // Detect operands that return Value and need extraction for arithmetic/comparison
    const numOps = ['+', '-', '*', '/', '%', '>', '<', '>=', '<=', '==', '!='];
    const lIsValue = expr.left.type === 'StateVar' || expr.left.type === 'RefRead'
      || (expr.left.type === 'Identifier' && G.ctx.stateVarNames.has(expr.left.name))
      || (expr.left.type === 'Identifier' && typeEnv && typeEnv.has(expr.left.name) && !typeEnv.get(expr.left.name))
      || expr.left.type === 'DotAccessExpr';
    const rIsValue = expr.right.type === 'StateVar' || expr.right.type === 'RefRead'
      || (expr.right.type === 'Identifier' && G.ctx.stateVarNames.has(expr.right.name))
      || (expr.right.type === 'Identifier' && typeEnv && typeEnv.has(expr.right.name) && !typeEnv.get(expr.right.name))
      || expr.right.type === 'DotAccessExpr';
    // Slice 10: shape field access (`coords.x` where `coords` is a Point!
    // state cell or a typed local) infers the field's declared type so
    // BinaryExpr can pick the right numeric coercion path.
    const inferShapeFieldType = (e) => {
      if (e?.type !== 'DotAccessExpr') return null;
      let objType = null;
      if (e.object?.type === 'TypeConstruction') objType = e.object.typeName;
      else if (e.object?.type === 'Identifier' && typeEnv?.has(e.object.name)) objType = typeEnv.get(e.object.name);
      else if (e.object?.type === 'RefRead') {
        const decl = G.ctx.stateVarDecls?.find(d => d.name === e.object.name);
        if (decl?.typeName) objType = decl.typeName;
        else if (typeEnv?.has(e.object.name)) objType = typeEnv.get(e.object.name);
      }
      if (!objType || !G.ctx.typeDecls?.has(objType)) return null;
      const decl = G.ctx.typeDecls.get(objType);
      const field = (decl.fields || []).find(f => f.name === e.property);
      return field?.paramType || null;
    };
    // Detect if this is integer or decimal arithmetic
    const lType = inferShapeFieldType(expr.left) || inferExprType(expr.left, typeEnv);
    const rType = inferShapeFieldType(expr.right) || inferExprType(expr.right, typeEnv);
    // Float detection — must come before Decimal/Integer detection
    const lIsFloat = lType === 'Float' || expr.left.type === 'FloatLiteral';
    const rIsFloat = rType === 'Float' || expr.right.type === 'FloatLiteral';
    if (lIsFloat || rIsFloat) {
      const lf = coerceOperand(left, lIsValue, operandSrcType(expr.left, lType), 'f64');
      const rf = coerceOperand(right, rIsValue, operandSrcType(expr.right, rType), 'f64');
      if (expr.op === '**') return `(${lf} as f64).powf(${rf} as f64)`;
      return `(${lf} ${rustOp} ${rf})`;
    }
    // Decimal detection — must come before integer detection
    const lIsDec = lType === 'Decimal' || expr.left.type === 'DecimalLiteral';
    const rIsDec = rType === 'Decimal' || expr.right.type === 'DecimalLiteral';
    const isDecArith = lIsDec || rIsDec;
    if (isDecArith) {
      const lSrc = operandSrcType(expr.left, lType);
      const rSrc = operandSrcType(expr.right, rType);
      if (expr.op === '**') {
        const l = coerceOperand(left, lIsValue, lSrc, 'BvDecimal');
        const r = coerceOperand(right, rIsValue, rSrc, 'BigInt');
        return decPow(l, r);
      }
      const l = coerceOperand(left, lIsValue, lSrc, 'BvDecimal');
      const r = coerceOperand(right, rIsValue, rSrc, 'BvDecimal');
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
      const l = coerceOperand(left, lIsValue, null, 'BigInt');
      const r = coerceOperand(right, rIsValue, null, 'BigInt');
      return intPow(l, r);
    }
    if (isIntArith) {
      const arithOps = ['+', '-', '*', '/', '%'];
      const l = coerceOperand(left, lIsValue, null, 'BigInt');
      const r = coerceOperand(right, rIsValue, null, 'BigInt');
      if (arithOps.includes(rustOp)) return intArithOp(l, rustOp, r);
      return `(&${l} ${rustOp} &${r})`;
    }
    if (expr.op === '**') {
      const l = coerceOperand(left, lIsValue, null, 'BigInt');
      const r = coerceOperand(right, rIsValue, null, 'BigInt');
      return intPow(l, r);
    }
    if (numOps.includes(rustOp) && (lIsValue || rIsValue)) {
      const l = coerceOperand(left, lIsValue, null, 'i64');
      const r = coerceOperand(right, rIsValue, null, 'i64');
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
  if (expr.type === 'TypeConstruction') {
    // Slice 3 of types-implementation-plan-2026-04-27 (Rust target):
    // emit a JSON object carrying the type tag and per-field values keyed
    // by the type's declared field names. Args follow FunctionCallExpr's
    // calling convention: bare expressions for positional plus an optional
    // trailing `NamedArgsBag` for `name: expr`. Slice 11: omit fields whose
    // value was not provided so absent optionals read as null.
    const decl = G.ctx.typeDecls?.get(expr.typeName);
    const fields = decl?.fields ?? [];
    const positional = expr.args.filter(a => a?.type !== 'NamedArgsBag');
    const namedBag = expr.args.find(a => a?.type === 'NamedArgsBag');
    const named = namedBag?.fields || {};
    const seen = new Set();
    const inserts = [];
    inserts.push(`m.insert("__type".to_string(), Value::String(${JSON.stringify(expr.typeName)}.to_string()));`);
    fields.slice(0, positional.length).forEach((f, i) => {
      seen.add(f.name);
      const raw = genRustExpr(positional[i], typeEnv, eCtx);
      const t = inferLiteralType(positional[i]) || inferExprType(positional[i], typeEnv);
      inserts.push(`m.insert(${JSON.stringify(f.name)}.to_string(), ${toJsonValue(raw, t || 'Anything')});`);
    });
    for (const f of fields) {
      if (seen.has(f.name)) continue;
      if (Object.prototype.hasOwnProperty.call(named, f.name)) {
        const argExpr = named[f.name];
        const raw = genRustExpr(argExpr, typeEnv, eCtx);
        const t = inferLiteralType(argExpr) || inferExprType(argExpr, typeEnv);
        inserts.push(`m.insert(${JSON.stringify(f.name)}.to_string(), ${toJsonValue(raw, t || 'Anything')});`);
      }
    }
    return `{ let mut m = Map::new(); ${inserts.join(' ')} Value::Object(m) }`;
  }
  if (expr.type === 'PresenceCheck') {
    // Slice 11: `(expr)?` returns Boolean. `Value::Null` means absent;
    // a JSON `null` field also means absent. Both map to false.
    const inner = genRustExpr(expr.expr, typeEnv, eCtx);
    return `(!matches!(&${inner}, Value::Null))`;
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
        ? `self.state.get("${stateKey(calleeName)}").cloned().unwrap_or(Value::Null)`
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
        : `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
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
    // Wrapped child param: dispatch through child_dispatch
    const isWrappedChild = dotObjName && G.ctx.stateVarNames.has(dotObjName) && (G.ctx.stateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !G.ctx.actorInfo.has(dotObjName) && !G.ctx.remoteInstanceVars.has(dotObjName)));
    if (isWrappedChild) {
      const childRef = `self.state.get("${stateKey(dotObjName)}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
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
  if (expr.type === 'MathMethodExpr') {
    const args = expr.args.map(a => genRustExpr(a, typeEnv, eCtx));
    const argTypes = expr.args.map(a => inferExprType(a, typeEnv));
    const isValueExpr = (a) => a.type === 'RefRead' || a.type === 'StateVar';
    const toF64 = (code, type, argIdx) => {
      if (type === 'Integer') return `(${code}).to_f64().unwrap_or(0.0)`;
      if (type === 'Decimal') return `(${code}).to_f64()`;
      // RefRead / StateVar resolve to Value — extract f64
      if (isValueExpr(expr.args[argIdx || 0])) return `(${code}).as_f64().unwrap_or(0.0)`;
      return code;
    };
    const m = expr.method;
    // 0-arity constants — return early before arg access
    if (m === 'pi') return `std::f64::consts::PI`;
    if (m === 'e') return `std::f64::consts::E`;
    const a0 = args[0], a1 = args[1], a2 = args[2];
    const t0 = argTypes[0], t1 = argTypes[1];
    const f0 = toF64(a0, t0, 0), f1 = a1 ? toF64(a1, t1, 1) : undefined;
    switch (m) {
      case 'ceil':  return `BigInt::from((${f0}).ceil() as i64)`;
      case 'floor': return `BigInt::from((${f0}).floor() as i64)`;
      case 'trunc': return `BigInt::from((${f0}).trunc() as i64)`;
      case 'round': return `BigInt::from((${f0} as f64).round() as i64)`;
      case 'abs':
        if (t0 === 'Integer') return `(${a0}).abs()`;
        if (t0 === 'Decimal') return `BvDecimal::new((${a0}).c.abs(), (${a0}).s)`;
        return `(${a0} as f64).abs()`;
      case 'sign':
        if (t0 === 'Integer') return `BigInt::from(match (${a0}).sign() { num_bigint::Sign::Plus => 1i64, num_bigint::Sign::Minus => -1i64, num_bigint::Sign::NoSign => 0i64 })`;
        if (t0 === 'Decimal') return `BigInt::from(if (${a0}).c > BigInt::from(0) { 1i64 } else if (${a0}).c < BigInt::from(0) { -1i64 } else { 0i64 })`;
        return `BigInt::from(if ${f0} > 0.0 { 1i64 } else if ${f0} < 0.0 { -1i64 } else { 0i64 })`;
      case 'min': {
        if (args.length === 1) return a0;
        const allInt = argTypes.every(t => t === 'Integer');
        const allDec = argTypes.every(t => t === 'Decimal');
        if (allInt) return args.reduce((acc, v) => `std::cmp::min(${acc}.clone(), ${v}.clone())`);
        if (allDec) return args.reduce((acc, v) => `if bv_dec_cmp_op(&${acc}, "<", &${v}) { ${acc}.clone() } else { ${v}.clone() }`);
        const fs = args.map((a, i) => toF64(a, argTypes[i], i));
        return fs.reduce((acc, v) => `(${acc} as f64).min(${v} as f64)`);
      }
      case 'max': {
        if (args.length === 1) return a0;
        const allInt = argTypes.every(t => t === 'Integer');
        const allDec = argTypes.every(t => t === 'Decimal');
        if (allInt) return args.reduce((acc, v) => `std::cmp::max(${acc}.clone(), ${v}.clone())`);
        if (allDec) return args.reduce((acc, v) => `if bv_dec_cmp_op(&${acc}, ">", &${v}) { ${acc}.clone() } else { ${v}.clone() }`);
        const fs = args.map((a, i) => toF64(a, argTypes[i], i));
        return fs.reduce((acc, v) => `(${acc} as f64).max(${v} as f64)`);
      }
      case 'pow':
        if (t0 === 'Integer' && t1 === 'Integer') return intPow(a0, a1);
        if (t0 === 'Decimal' && t1 === 'Integer') return decPow(a0, a1);
        return `(${f0} as f64).powf(${f1} as f64)`;
      case 'pi': return `std::f64::consts::PI`;
      case 'e':  return `std::f64::consts::E`;
      case 'sqrt':  return `(${f0} as f64).sqrt()`;
      case 'exp':   return `(${f0} as f64).exp()`;
      case 'log':
        if (f1) return `(${f0} as f64).log(${f1} as f64)`;
        return `(${f0} as f64).ln()`;
      case 'sin':   return `(${f0} as f64).sin()`;
      case 'cos':   return `(${f0} as f64).cos()`;
      case 'tan':   return `(${f0} as f64).tan()`;
      case 'asin':  return `(${f0} as f64).asin()`;
      case 'acos':  return `(${f0} as f64).acos()`;
      case 'atan':  return `(${f0} as f64).atan()`;
      case 'atan2': return `(${f0} as f64).atan2(${f1} as f64)`;
      case 'sinh':  return `(${f0} as f64).sinh()`;
      case 'cosh':  return `(${f0} as f64).cosh()`;
      case 'tanh':  return `(${f0} as f64).tanh()`;
      case 'asinh': return `(${f0} as f64).asinh()`;
      case 'acosh': return `(${f0} as f64).acosh()`;
      case 'atanh': return `(${f0} as f64).atanh()`;
      case 'divide': return `bv_dec_divide(&${a0}, &${a1}, &${a2})`;

      // Type conversions
      case 'to_integer': {
        const isVal = isValueExpr(expr.args[0]);
        if (t0 === 'Integer' && !isVal) return a0;
        if (t0 === 'Integer' && isVal) return `bv_to_bigint(&${a0})`;
        if (t0 === 'Decimal') {
          const d = isVal ? `bv_to_decimal(&${a0})` : a0;
          return `(&(${d}).c / num_traits::pow(BigInt::from(10), (${d}).s as usize))`;
        }
        if (isVal) return `BigInt::from((${a0}).as_f64().unwrap_or(0.0).trunc() as i64)`;
        return `BigInt::from((${a0}).trunc() as i64)`;
      }
      case 'to_float': {
        const isVal = isValueExpr(expr.args[0]);
        if (t0 === 'Float' && !isVal) return a0;
        if (t0 === 'Float' && isVal) return `(${a0}).as_f64().unwrap_or(0.0)`;
        if (t0 === 'Decimal') {
          const d = isVal ? `bv_to_decimal(&${a0})` : a0;
          return `(${d}).to_f64()`;
        }
        if (t0 === 'Integer' && isVal) return `bv_to_bigint(&${a0}).to_f64().unwrap_or(0.0)`;
        if (t0 === 'Integer') return `(${a0}).to_f64().unwrap_or(0.0)`;
        if (isVal) return `(${a0}).as_f64().unwrap_or(0.0)`;
        return `(${a0}).to_f64().unwrap_or(0.0)`;
      }
      case 'to_decimal': {
        const isVal = isValueExpr(expr.args[0]);
        if (t0 === 'Decimal' && !isVal) return a0;
        if (t0 === 'Decimal' && isVal) return `bv_to_decimal(&${a0})`;
        if (t0 === 'Integer') {
          const i = isVal ? `bv_to_bigint(&${a0})` : `${a0}.clone()`;
          return `BvDecimal::from_int(&${i})`;
        }
        const f = isVal ? `(${a0}).as_f64().unwrap_or(0.0)` : a0;
        return `BvDecimal::from_f64(${f})`;
      }

      default: throw new Error(`Unknown Math method: ${m}`);
    }
  }
  if (expr.type === 'BlobMethodExpr') {
    const a0 = expr.args[0];
    const raw = genRustExpr(a0, typeEnv, eCtx);
    const isVal = a0.type === 'RefRead' || a0.type === 'StateVar';
    const s = isVal ? `${raw}.as_str().unwrap_or("")` : raw;
    return dispatchMethod(RUST_BLOB_METHODS, 'Blob', expr, s, (i) => genRustExpr(expr.args[i], typeEnv, eCtx), intFromI64, intToUsize);
  }
  if (expr.type === 'TextMethodExpr') {
    const a0 = expr.args[0];
    const raw = genRustExpr(a0, typeEnv, eCtx);
    const isVal = a0.type === 'RefRead' || a0.type === 'StateVar';
    const s = isVal ? `${raw}.as_str().unwrap_or("")` : raw;
    return dispatchMethod(RUST_TEXT_METHODS, 'Text', expr, s, (i) => genRustExpr(expr.args[i], typeEnv, eCtx), intFromI64, intToUsize);
  }
  if (expr.type === 'GraphemeTextMethodExpr') {
    const a0 = expr.args[0];
    const raw = genRustExpr(a0, typeEnv, eCtx);
    const isVal = a0.type === 'RefRead' || a0.type === 'StateVar';
    const s = isVal ? `${raw}.as_str().unwrap_or("")` : raw;
    return dispatchMethod(RUST_GRAPHEME_METHODS, 'GraphemeText', expr, s, (i) => genRustExpr(expr.args[i], typeEnv, eCtx), intFromI64, intToUsize);
  }
  if (expr.type === 'ListMethodExpr') {
    // Receiver is a Value (list literal → Value::Array; ref/state → Value).
    // bv_list_* helpers and bv_eq handle the Value-shape uniformly.
    const s = genRustExpr(expr.args[0], typeEnv, eCtx);
    return dispatchMethod(RUST_LIST_METHODS, 'List', expr, s, (i) => genRustExpr(expr.args[i], typeEnv, eCtx), intFromI64, intToUsize);
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
    // Slice 5 (Rust target): field access on a typed structure. The object
    // is a TypeConstruction directly or a typed local whose runtime value
    // is a Value::Object carrying the field map. `.get(...)` returns
    // `Option<&Value>`; clone to a `Value`, defaulting to `Value::Null`
    // when the field is absent (matches JS's `undefined` semantics).
    const objStaticType = (() => {
      if (expr.object?.type === 'TypeConstruction') return expr.object.typeName;
      if (expr.object?.type === 'Identifier' && typeEnv?.has(expr.object.name)) {
        return typeEnv.get(expr.object.name);
      }
      // Slice 10: shape-typed state-var read (`coords.x` where `coords` is
      // declared as a `Point!` cell).
      if (expr.object?.type === 'RefRead') {
        const decl = G.ctx.stateVarDecls?.find(d => d.name === expr.object.name);
        if (decl?.typeName) return decl.typeName;
        if (typeEnv?.has(expr.object.name)) return typeEnv.get(expr.object.name);
      }
      return null;
    })();
    if (objStaticType && G.ctx.typeDecls?.has(objStaticType)) {
      const inner = genRustExpr(expr.object, typeEnv, eCtx);
      return `(${inner}).get(${JSON.stringify(expr.property)}).cloned().unwrap_or(Value::Null)`;
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
        const k = G.ctx.stateVarNames.has(s.name) ? stateKey(s.name) : s.name;
        lines.push(`${indent}${rsStore(s.name)}.insert("${k}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
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

function isRustGuardIf(ifExpr) {
  if (!ifExpr) return false;
  const t = ifExpr.then?.body;
  if (t) {
    if (t.some(s => s.type === 'Return')) return true;
    if (t.some(s => s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr))) return true;
  }
  const e = ifExpr.else;
  if (!e) return false;
  if (e.type === 'IfExpr') return isRustGuardIf(e);
  if (e.body) {
    return e.body.some(s => s.type === 'Return')
      || e.body.some(s => s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr));
  }
  return false;
}

// Build a Rust `if/else` *expression* that evaluates to a value of the kind
// produced by `makeValExpr(fields, typeEnv)`. Used for inlined call sites
// where `return` is unavailable. `guards` are ImplicitReturn(IfExpr) nodes
// (block-body guards), `terminal` is the fallthrough Return node (or null).
function buildRustGuardChainExpr(guards, terminal, typeEnv, indent, makeValExpr) {
  if (guards.length === 0) {
    if (terminal) return makeValExpr(terminal.fields, typeEnv);
    return 'Structure::empty()';
  }
  const I = indent;
  const II = I + '    ';
  const guard = guards[0];
  const rest = guards.slice(1);
  const ifExpr = guard.expr;
  const cond = genRustCondition(ifExpr.cond, typeEnv, {});

  function branchExpr(branchBody, branchIndent) {
    const branchGuards = (branchBody || []).filter(s =>
      s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr),
    );
    const branchTerm = (branchBody || []).find(s => s.type === 'Return') || null;
    return buildRustGuardChainExpr(branchGuards, branchTerm, typeEnv, branchIndent, makeValExpr);
  }

  const thenExpr = branchExpr(ifExpr.then?.body || [], II);
  let elseExpr;
  if (ifExpr.else) {
    if (ifExpr.else.body) {
      elseExpr = branchExpr(ifExpr.else.body, II);
    } else if (ifExpr.else.type === 'IfExpr') {
      elseExpr = buildRustGuardChainExpr([{ expr: ifExpr.else }], terminal, typeEnv, II, makeValExpr);
    } else {
      elseExpr = buildRustGuardChainExpr(rest, terminal, typeEnv, II, makeValExpr);
    }
  } else {
    elseExpr = buildRustGuardChainExpr(rest, terminal, typeEnv, II, makeValExpr);
  }
  return `if ${cond} {\n${II}${thenExpr}\n${I}} else {\n${II}${elseExpr}\n${I}}`;
}

// Build an `if cond { ...early returns... }` block (with optional else) for use
// inside a Rust function whose return type matches `makeRetExpr`'s output.
// `makeRetExpr(fields, typeEnv)` produces the value expression for `return`.
function buildRustGuardBlock(ifExpr, typeEnv, indent, makeRetExpr) {
  const I = indent;
  const II = I + '    ';
  const cond = genRustCondition(ifExpr.cond, typeEnv, {});

  function genBranchLines(branchBody, branchIndent) {
    const lines = [];
    for (const s of branchBody) {
      if (s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr)) {
        lines.push(buildRustGuardBlock(s.expr, typeEnv, branchIndent, makeRetExpr));
      } else if (s.type === 'Return') {
        lines.push(`${branchIndent}return ${makeRetExpr(s.fields, typeEnv)};`);
      } else if (s.type === 'TypedAssign') {
        const val = genRustExpr(s.value, typeEnv);
        lines.push(`${branchIndent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
      } else if (s.type === 'Assign') {
        const val = genRustExpr(s.value, typeEnv);
        lines.push(`${branchIndent}let ${rustIdent(s.name)} = ${val};`);
      }
    }
    return lines.join('\n');
  }

  const thenLines = genBranchLines(ifExpr.then?.body || [], II);
  let elseSection = '';
  if (ifExpr.else) {
    if (ifExpr.else.type === 'IfExpr') {
      elseSection = ` else {\n${buildRustGuardBlock(ifExpr.else, typeEnv, II, makeRetExpr)}\n${I}}`;
    } else if (ifExpr.else.body) {
      const elseLines = genBranchLines(ifExpr.else.body, II);
      elseSection = ` else {\n${elseLines}\n${I}}`;
    }
  }
  return `${I}if ${cond} {\n${thenLines}\n${I}}${elseSection}`;
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

  // Conditional-return guards: ImplicitReturn(IfExpr) with block bodies containing Return nodes.
  const guards = body.filter(s =>
    s.type === 'ImplicitReturn' && s.expr?.type === 'IfExpr' && isRustGuardIf(s.expr),
  );

  const savedSsaScope = G.ctx.ssaScope;
  const savedSsaCounts = G.ctx.ssaCounts;
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, I);
  const guardLines = guards.length > 0
    ? guards.map(g => buildRustGuardBlock(g.expr, typeEnv, I, (fields, te) => genRustFnReturn(fields, te))).join('\n')
    : '';
  const retExpr = reply ? genRustFnReturn(reply.fields, typeEnv) : 'Structure::empty()';
  G.ctx.ssaScope = savedSsaScope;
  G.ctx.ssaCounts = savedSsaCounts;

  const bodyLines = [];
  if (paramLines.length > 0) bodyLines.push(paramLines.join('\n'));
  if (locals) bodyLines.push(locals);
  if (guardLines) bodyLines.push(guardLines);
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

export { genRustExpr, genRustIfBranch, genRustIfExpr, genRustFnMethod, genRustFnReturn, genRustFnCallExpr, genRustDestructure, genRecursiveFnDef, genRustCondition, genRustDefaultValue, isRustGuardIf, buildRustGuardBlock, buildRustGuardChainExpr };
