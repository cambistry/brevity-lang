const MATCH_TYPES_FN = `fn match_types(message: &Value, pairs: &[(&str, &str)]) -> bool {
    let bva = match message.get("bv-a") {
        Some(v) => v,
        None => return pairs.is_empty(),
    };
    let arr = match bva.as_array() {
        Some(a) => a,
        None => return pairs.is_empty(),
    };
    if arr.is_empty() {
        return pairs.is_empty();
    }
    let types_obj = &arr[0];
    for &(name, type_name) in pairs {
        match types_obj.get(name) {
            Some(v) if v.as_str() == Some(type_name) => {}
            _ => return false,
        }
    }
    true
}`;

const MATCH_TYPES_POSITIONAL_FN = `fn match_types_positional(message: &Value, pos_types: &[&str], named_types: &[(&str, &str)]) -> bool {
    let bva = match message.get("bv-a") {
        Some(v) => v,
        None => return pos_types.is_empty() && named_types.is_empty(),
    };
    let arr = match bva.as_array() {
        Some(a) => a,
        None => return pos_types.is_empty() && named_types.is_empty(),
    };
    if arr.is_empty() {
        return pos_types.is_empty() && named_types.is_empty();
    }
    let types_arr = match arr[0].as_array() {
        Some(a) => a,
        None => return false,
    };
    let expected_pos_count = pos_types.len() + if named_types.is_empty() { 0 } else { 1 };
    if types_arr.len() != expected_pos_count {
        return false;
    }
    for (i, &t) in pos_types.iter().enumerate() {
        match types_arr.get(i) {
            Some(v) if v.as_str() == Some(t) => {}
            _ => return false,
        }
    }
    if !named_types.is_empty() {
        if let Some(last) = types_arr.last() {
            if let Some(obj) = last.as_object() {
                for &(name, type_name) in named_types {
                    match obj.get(name) {
                        Some(v) if v.as_str() == Some(type_name) => {}
                        _ => return false,
                    }
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}`;

const RUST_STRUCTURE_PREAMBLE = `#[allow(dead_code)]
#[derive(Clone)]
struct Structure {
    positional: Vec<Value>,
    named: Map<String, Value>,
}

#[allow(dead_code)]
impl Structure {
    fn empty() -> Self {
        Structure { positional: vec![], named: Map::new() }
    }
    fn pack(payload: &Value) -> Self {
        if payload.is_null() {
            return Structure::empty();
        }
        if let Some(arr) = payload.as_array() {
            if arr.is_empty() {
                return Structure::empty();
            }
            let last = &arr[arr.len() - 1];
            if let Some(obj) = last.as_object() {
                if !obj.is_empty() {
                    let positional = arr[..arr.len() - 1].to_vec();
                    let named = obj.clone();
                    return Structure { positional, named };
                }
            }
            return Structure { positional: arr.clone(), named: Map::new() };
        }
        if let Some(obj) = payload.as_object() {
            return Structure { positional: vec![], named: obj.clone() };
        }
        Structure::empty()
    }
    fn splat(&self) -> Value {
        let has_pos = !self.positional.is_empty();
        let has_named = !self.named.is_empty();
        if has_pos && has_named {
            let mut arr = self.positional.clone();
            arr.push(Value::Object(self.named.clone()));
            Value::Array(arr)
        } else if has_pos {
            Value::Array(self.positional.clone())
        } else {
            Value::Object(self.named.clone())
        }
    }
    fn one(&self) -> Value {
        if self.positional.len() != 1 {
            panic!("requires exactly 1 positional return value, got {}", self.positional.len());
        }
        self.positional[0].clone()
    }
    fn splat_bva(bva_first: &Value) -> Value {
        if let Some(arr) = bva_first.as_array() {
            if arr.is_empty() {
                return Value::Array(vec![]);
            }
            let last = &arr[arr.len() - 1];
            if last.is_object() {
                if arr.len() == 1 {
                    return last.clone();
                }
            }
            return Value::Array(arr.clone());
        }
        if let Some(_obj) = bva_first.as_object() {
            return bva_first.clone();
        }
        Value::Null
    }
}`;

const LIST_TYPES_OF_FN = `fn list_types_of(v: &Value) -> Value {
    match v.as_array() {
        Some(arr) => {
            let types: Vec<Value> = arr.iter().map(|el| {
                if el.is_i64() || el.is_u64() { json!("Integer") }
                else if el.is_f64() { json!("Float") }
                else if el.is_string() { json!("Text") }
                else if el.is_boolean() { json!("Boolean") }
                else { json!("Anything") }
            }).collect();
            Value::Array(types)
        }
        None => json!([]),
    }
}`;

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.name && p.type && !p.rest) env.set(p.name, p.type);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeName);
    if (s.type === 'DestructureAssign') {
      for (const item of s.pattern) {
        if (item.discard) continue;
        let t = item.type || null;
        // Infer type from StructureConstructor source if pattern lacks type
        if (!t && s.source.type === 'StructureConstructor') {
          if (item.positional) {
            const srcArg = s.source.args.filter(a => a.positional)[item.idx];
            if (srcArg) t = srcArg.type || null;
          } else if (item.named) {
            const srcArg = s.source.args.find(a => a.key === item.name);
            if (srcArg) t = srcArg.type || null;
          }
        }
        if (item.name) env.set(item.name, t);
      }
    }
    if (s.type === 'Assign') {
      const inferred = inferLiteralType(s.value);
      if (inferred) env.set(s.name, inferred);
    }
    if (s.type === 'RefDecl' && s.name) {
      const rt = s.typeName || inferLiteralType(s.value);
      if (rt) env.set(s.name, rt);
    }
    if (s.type === 'BareTypeDecl' && s.name && s.typeName) env.set(s.name, s.typeName);
    if (s.type === 'ListDestructure') {
      for (const item of s.pattern) {
        if (item.discard || !item.name) continue;
        if (item.type) env.set(item.name, item.type);
      }
    }
  }
  return env;
}

function inferLiteralType(expr) {
  if (!expr) return null;
  if (expr.type === 'IntLiteral') return 'Integer';
  if (expr.type === 'StringLiteral') return 'Text';
  if (expr.type === 'DecimalLiteral') return 'Decimal';
  if (expr.type === 'FloatLiteral') return 'Float';
  if (expr.type === 'BoolLiteral') return 'Boolean';
  if (expr.type === 'NullLiteral') return 'null';
  return null;
}

const RUST_KEYWORDS = new Set(['fn', 'let', 'mut', 'ref', 'type', 'use', 'mod', 'pub', 'self', 'super', 'crate', 'as', 'break', 'const', 'continue', 'else', 'enum', 'extern', 'false', 'for', 'if', 'impl', 'in', 'loop', 'match', 'move', 'return', 'static', 'struct', 'trait', 'true', 'unsafe', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try']);

function rustIdent(name) {
  if (RUST_KEYWORDS.has(name)) return `r#${name}`;
  return name;
}

function rustType(brevityType) {
  if (brevityType === 'Integer') return 'i64';
  if (brevityType === 'Text') return 'String';
  if (brevityType === 'Float' || brevityType === 'Decimal') return 'f64';
  if (brevityType === 'Boolean') return 'bool';
  if (typeof brevityType === 'string' && brevityType.includes('|')) return 'Value';
  return 'Value';
}

function convertFromValue(expr, brevityType) {
  if (brevityType === 'Integer') return `${expr}.as_i64().unwrap_or(0)`;
  if (brevityType === 'Text') return `${expr}.as_str().unwrap_or("").to_string()`;
  if (brevityType === 'Float' || brevityType === 'Decimal') return `${expr}.as_f64().unwrap_or(0.0)`;
  if (brevityType === 'Boolean') return `${expr}.as_bool().unwrap_or(false)`;
  return expr;
}

function toJsonValue(expr, brevityType) {
  if (brevityType === 'Integer' || brevityType === 'Float' || brevityType === 'Decimal' || brevityType === 'Boolean') {
    return `json!(${expr})`;
  }
  if (brevityType === 'Text') {
    return `json!(${expr})`;
  }
  return expr;
}

function resolveVarExpr(name) {
  if (name.startsWith('$')) {
    return `self.state.get("${name.slice(1)}").cloned().unwrap_or(Value::Null)`;
  }
  return name;
}

function isCallableArg(arg) {
  return arg.type === 'Callable' || arg.expr?.type === 'Function' || (typeof arg.type === 'string' && arg.type.includes('->'));
}

function isCallableOnlyConstructor(node) {
  return node.type === 'StructureConstructor' && node.args.length > 0 && node.args.every(isCallableArg);
}

function findFreeVarsSimple(funcNode) {
  const vars = new Set();
  function walk(expr) {
    if (!expr) return;
    if (expr.type === 'Identifier') { vars.add(expr.name); return; }
    if (expr.type === 'BinaryExpr') { walk(expr.left); walk(expr.right); }
  }
  if (funcNode.expr) walk(funcNode.expr);
  if (funcNode.body) {
    for (const s of funcNode.body) {
      if (s.type === 'ImplicitReturn' && s.expr) walk(s.expr);
    }
  }
  return [...vars];
}

function substituteCaptures(expr, captures) {
  if (!captures || captures.size === 0) return expr;
  if (expr.type === 'Identifier' && captures.has(expr.name)) {
    return { ...expr, name: captures.get(expr.name) };
  }
  if (expr.type === 'BinaryExpr') {
    return { ...expr, left: substituteCaptures(expr.left, captures), right: substituteCaptures(expr.right, captures) };
  }
  return expr;
}

function analyzeCallables(body, mutableVars, typeEnv) {
  const callables = new Map();
  const skipSet = new Set();
  const capturePoints = new Map();
  const structureCallables = new Map();

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // f = () { x }  OR  f : Callable = |x| { ... }
    if ((s.type === 'Assign' && s.value.type === 'Function') ||
        (s.type === 'TypedAssign' && s.value.type === 'Function')) {
      callables.set(s.name, { node: s.value, defIdx: i });
      skipSet.add(i);
    }

    // s : Structure = Structure(fn: f : Callable) — all-callable constructor
    if (s.type === 'TypedAssign' && s.typeName === 'Structure' && s.value.type === 'StructureConstructor') {
      if (isCallableOnlyConstructor(s.value)) {
        skipSet.add(i);
        const sc = new Map();
        for (const arg of s.value.args) {
          if (arg.type === 'Callable' && arg.expr?.type === 'Identifier' && callables.has(arg.expr.name)) {
            sc.set(arg.key, arg.expr.name);
          } else if (arg.expr?.type === 'Function') {
            // Inline Function in structure — register directly
            const inlineName = `_sc_${s.name}_${arg.key}`;
            callables.set(inlineName, { node: arg.expr, defIdx: i });
            sc.set(arg.key, inlineName);
          }
        }
        structureCallables.set(s.name, sc);
      }
    }

    // DestructureAssign
    if (s.type === 'DestructureAssign') {
      // :fn = s (s is callable-only Structure)
      if (s.source.type === 'Identifier' && structureCallables.has(s.source.name)) {
        skipSet.add(i);
        const sc = structureCallables.get(s.source.name);
        for (const item of s.pattern) {
          if (item.named && item.name && sc.has(item.name)) {
            callables.set(item.name, callables.get(sc.get(item.name)));
          }
        }
      }
      // :fn = Structure(fn: () { x } : Callable) — inline callable constructor
      if (s.source.type === 'StructureConstructor' && isCallableOnlyConstructor(s.source)) {
        skipSet.add(i);
        for (const arg of s.source.args) {
          if (arg.expr?.type === 'Function') {
            for (const item of s.pattern) {
              const itemKey = item.named ? item.name : item.key;
              if (itemKey === arg.key) {
                callables.set(item.name, { node: arg.expr, defIdx: i });
              }
            }
          }
        }
      }
    }
  }

  // Detect recursive callables (body contains a call to itself)
  function containsSelfCall(node, fnName) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'FunctionCallExpr' && node.callee?.name === fnName) return true;
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      if (containsSelfCall(node[key], fnName)) return true;
    }
    return false;
  }
  for (const [name, info] of callables) {
    info.recursive = containsSelfCall(info.node.body, name);
  }

  // Compute capture points for mutable free variables
  for (const [name, info] of callables) {
    const freeVars = findFreeVarsSimple(info.node);
    const captures = new Map();
    for (const v of freeVars) {
      if (mutableVars.has(v)) {
        const capName = `_cap_${name}_${v}`;
        captures.set(v, capName);
        if (!capturePoints.has(info.defIdx)) capturePoints.set(info.defIdx, []);
        const t = typeEnv.get(v);
        capturePoints.get(info.defIdx).push({ varName: v, capName, rustType: rustType(t) });
      }
    }
    info.captures = captures;
  }

  return { callables, skipSet, capturePoints };
}

function findMutableVars(body) {
  const assigned = new Map();
  for (const s of body) {
    if (s.type === 'TypedAssign' || s.type === 'Assign') {
      assigned.set(s.name, (assigned.get(s.name) || 0) + 1);
    }
  }
  const mutable = new Set();
  for (const [name, count] of assigned) {
    if (count > 1) mutable.add(name);
  }
  return mutable;
}

function genRustExpr(expr, typeEnv, ctx) {
  if (expr.type === 'StringLiteral') return JSON.stringify(expr.value);
  if (expr.type === 'IntLiteral') return String(expr.value);
  if (expr.type === 'FloatLiteral' || expr.type === 'DecimalLiteral') {
    const s = String(expr.value);
    // Ensure Rust sees this as a float literal (must contain '.' or 'e')
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) return s + '.0';
    return s;
  }
  if (expr.type === 'BoolLiteral') return expr.value ? 'true' : 'false';
  if (expr.type === 'NullLiteral') return 'Value::Null';
  if (expr.type === 'Identifier') return rustIdent(expr.name);
  if (expr.type === 'BinaryExpr') {
    const rustOp = expr.op === '===' ? '==' : expr.op === '!==' ? '!=' : expr.op;
    const left = genRustExpr(expr.left, typeEnv, ctx);
    const right = genRustExpr(expr.right, typeEnv, ctx);
    // Detect operands that return Value and need extraction for arithmetic/comparison
    const numOps = ['+', '-', '*', '/', '>', '<', '>=', '<=', '==', '!='];
    const lIsValue = expr.left.type === 'StateVar' || expr.left.type === 'RefRead'
      || (expr.left.type === 'Identifier' && typeEnv && typeEnv.has(expr.left.name) && !typeEnv.get(expr.left.name));
    const rIsValue = expr.right.type === 'StateVar' || expr.right.type === 'RefRead'
      || (expr.right.type === 'Identifier' && typeEnv && typeEnv.has(expr.right.name) && !typeEnv.get(expr.right.name));
    if (numOps.includes(rustOp) && (lIsValue || rIsValue)) {
      const l = lIsValue ? `${left}.as_i64().unwrap_or(0)` : left;
      const r = rIsValue ? `${right}.as_i64().unwrap_or(0)` : right;
      return `${l} ${rustOp} ${r}`;
    }
    return `${left} ${rustOp} ${right}`;
  }
  if (expr.type === 'IndexExpr') {
    const obj = genRustExpr(expr.object, typeEnv, ctx);
    if (expr.key !== null) {
      return `${obj}.named.get(${JSON.stringify(expr.key)}).cloned().unwrap_or(Value::Null)`;
    }
    return `${obj}.positional.get(${expr.index}).cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'StructureConstructor' || expr.type === 'StructureLiteral') {
    const positional = expr.args.filter(a => a.positional);
    const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Callable');
    const posVals = positional.map(a => {
      const raw = genRustExpr(a.expr, typeEnv, ctx);
      const t = a.type || (a.expr?.type === 'Identifier' && typeEnv ? typeEnv.get(a.expr.name) : null) || inferLiteralType(a.expr);
      return toJsonValue(raw, t);
    }).join(', ');
    let namedBlock;
    if (named.length > 0) {
      const inserts = named.map(a => {
        const raw = genRustExpr(a.expr, typeEnv, ctx);
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
        const inner = genRustExpr(implRet.expr, typeEnv, ctx);
        return `json!(${inner})`;
      }
    }
    if (expr.expr) {
      const inner = genRustExpr(expr.expr, typeEnv, ctx);
      return `json!(${inner})`;
    }
    return 'Value::Null';
  }
  if (expr.type === 'ProcCallExpr') {
    return `${genRustProcCallExpr(expr, typeEnv)}.one()`;
  }
  if (expr.type === 'FunctionCallExpr') {
    const callee = genRustExpr(expr.callee, typeEnv, ctx);
    const callArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag');
    const argExprs = callArgs.map(a => genRustExpr(a, typeEnv, ctx)).join(', ');
    return `${callee}(${argExprs})`;
  }
  if (expr.type === 'IfExpr') {
    return genRustIfExpr(expr, typeEnv, ctx);
  }
  if (expr.type === 'StateVar') {
    return `self.state.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'RefRead') {
    return `self.refs.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'RefArg') {
    return `"ref_${expr.name}".to_string()`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return 'Value::Null';
    const elems = expr.elements.map(e => {
      const raw = genRustExpr(e.expr || e, typeEnv, ctx);
      const t = e.type || inferLiteralType(e.expr || e);
      return toJsonValue(raw, t);
    });
    return `json!([${elems.join(', ')}])`;
  }
  if (expr.type === 'DotCallExpr') {
    // Fire-and-forget send
    const named = expr.args.filter(a => !a.positional);
    const opEntries = named.map(a => `"${a.name}": ${genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, ctx)}`).join(', ');
    const bvaEntries = named.map(a => `"${a.name}": "${a.typeName}"`).join(', ');
    const to = JSON.stringify(expr.object.name);
    const method = JSON.stringify(expr.method);
    return `{
        let seq = self.send_seq.get();
        self.send_seq.set(seq + 1);
        let send_id = seq.to_string();
        let mut send_msg = Map::new();
        send_msg.insert("id".to_string(), json!(send_id));
        send_msg.insert("op".to_string(), json!([{${opEntries}}, ${method}]));
        send_msg.insert("to".to_string(), json!(${to}));
        send_msg.insert("bv-a".to_string(), json!([{${bvaEntries}}]));
        let _ = self.binding.send(Value::Object(send_msg));
        Value::Null
    }`;
  }
  if (expr.type === 'ProcRef') {
    return `"__procref_${expr.name}"`;
  }
  if (expr.type === 'FnRef') {
    return rustIdent(expr.name);
  }
  if (expr.type === 'OverExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, ctx);
    let fn = expr.fn;
    // Handle ProcRef — call the proc method for each element
    if (fn.type === 'ProcRef') {
      const procName = fn.name;
      return `{ let mut _result = Vec::new(); if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_el.clone()], named: Map::new() }; _result.push(self.${procName}_proc(&_s).one()); } } Value::Array(_result) }`;
    }
    // Resolve FnRef to actual function node via ctx.callables
    if (fn.type === 'FnRef' && ctx?.callables) {
      const tracked = ctx.callables.get(fn.name);
      if (tracked) fn = tracked.node;
    }
    const params = fn.params || [];
    const param = params[0];
    const paramName = param ? param.name : '_item';
    const paramType = param?.type;
    const implRet = fn.body ? fn.body.find(s => s.type === 'ImplicitReturn') : null;
    const bodyExpr = implRet ? implRet.expr : fn.expr;
    if (bodyExpr) {
      const innerExpr = genRustExpr(bodyExpr, typeEnv, ctx);
      const retType = fn.returnType;
      const wrapped = toJsonValue(innerExpr, retType);
      if (paramType) {
        const access = convertFromValue(`_el.clone()`, paramType);
        return `${coll}.as_array().map(|_arr| Value::Array(_arr.iter().map(|_el| { let ${paramName}: ${rustType(paramType)} = ${access}; ${wrapped} }).collect())).unwrap_or(Value::Null)`;
      } else {
        return `${coll}.as_array().map(|_arr| Value::Array(_arr.iter().map(|_el| { let ${paramName} = _el.clone(); ${wrapped} }).collect())).unwrap_or(Value::Null)`;
      }
    }
    return 'Value::Null';
  }
  if (expr.type === 'ReduceExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, ctx);
    const init = expr.initial ? genRustExpr(expr.initial, typeEnv, ctx) : 'Value::Null';
    let fn = expr.fn;
    // Handle ProcRef — call the proc method with (acc, item) for each element
    if (fn.type === 'ProcRef') {
      const procName = fn.name;
      if (expr.initial) {
        const initVal = forceJsonWrap(init);
        return `{ let mut _acc: Value = ${initVal}; if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${procName}_proc(&_s).one(); } } _acc }`;
      } else {
        return `{ let _cv = ${coll}; if let Some(_arr) = _cv.as_array() { if _arr.is_empty() { Value::Null } else { let mut _acc = _arr[0].clone(); for _el in &_arr[1..] { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${procName}_proc(&_s).one(); } _acc } } else { Value::Null } }`;
      }
    }
    // Resolve FnRef to actual function node via ctx.callables
    if (fn.type === 'FnRef' && ctx?.callables) {
      const tracked = ctx.callables.get(fn.name);
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
      const innerExpr = genRustExpr(bodyExpr, typeEnv, ctx);
      const retType = fn.returnType;
      const wrapped = toJsonValue(innerExpr, retType);
      const accAccess = accType ? convertFromValue('_a.clone()', accType) : '_a.clone()';
      const itemAccess = itemType ? convertFromValue('_el.clone()', itemType) : '_el.clone()';
      const accRustType = accType ? rustType(accType) : 'Value';
      const itemRustType = itemType ? rustType(itemType) : 'Value';
      if (expr.initial) {
        const initVal = toJsonValue(init, accType);
        return `${coll}.as_array().map(|_arr| _arr.iter().fold(${initVal}, |_a: Value, _el| { let ${accName}: ${accRustType} = ${accAccess}; let ${itemName}: ${itemRustType} = ${itemAccess}; ${wrapped} })).unwrap_or(Value::Null)`;
      } else {
        return `{ let _cv = ${coll}; if let Some(_arr) = _cv.as_array() { if _arr.is_empty() { Value::Null } else { _arr[1..].iter().fold(_arr[0].clone(), |_a: Value, _el| { let ${accName}: ${accRustType} = ${accAccess}; let ${itemName}: ${itemRustType} = ${itemAccess}; ${wrapped} }) } } else { Value::Null } }`;
      }
    }
    return 'Value::Null';
  }
  throw new Error(`Unsupported Rust expression: ${expr.type}`);
}

function needsJsonWrap(expr) {
  return expr.type === 'IntLiteral' || expr.type === 'FloatLiteral' || expr.type === 'DecimalLiteral' ||
         expr.type === 'StringLiteral' || expr.type === 'BoolLiteral' ||
         expr.type === 'BinaryExpr' || expr.type === 'Identifier';
}

function convertBranchExpr(raw, expr, targetType) {
  if (targetType === 'Value' && needsJsonWrap(expr)) return `json!(${raw})`;
  if (targetType === 'String' && expr.type === 'StringLiteral') return `${raw}.to_string()`;
  // StateVar/RefRead return Value — convert to target type
  if ((expr.type === 'StateVar' || expr.type === 'RefRead' || expr.type === 'ProcCallExpr') && targetType && targetType !== 'Value') {
    const brevityType = targetType === 'i64' ? 'Integer' : targetType === 'f64' ? 'Float' : targetType === 'String' ? 'Text' : targetType === 'bool' ? 'Boolean' : null;
    if (brevityType) return convertFromValue(raw, brevityType);
  }
  return raw;
}

function genRustIfBranch(branch, typeEnv, ctx, indent, targetType) {
  if (!branch) return `${indent}Value::Null`;
  // Simple expression form
  if (branch.expr) {
    const raw = genRustExpr(branch.expr, typeEnv, ctx);
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
          lines.push(`${indent}let ${s.name}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, ctx, indent, rustType(s.typeName))};`);
        } else if (s.value.type === 'ProcCallExpr') {
          const callExpr = genRustProcCallExpr(s.value, typeEnv);
          const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
          lines.push(`${indent}let ${s.name}: ${rustType(s.typeName)} = ${converted};`);
        } else {
          let val = genRustExpr(s.value, typeEnv, ctx);
          if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          lines.push(`${indent}let ${s.name}: ${rustType(s.typeName)} = ${val};`);
        }
      } else if (s.type === 'DestructureAssign') {
        if (s.source.type === 'ProcCallExpr') {
          const callExpr = genRustProcCallExpr(s.source, typeEnv);
          const tempName = `_r${_procTempCounter++}`;
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
          lines.push(`${indent}let ${s.name}: ${rustType(knownType)} = ${genRustExpr(s.value, typeEnv, ctx)};`);
        } else {
          lines.push(`${indent}let ${s.name}: Value = ${genRustExpr(s.value, typeEnv, ctx)};`);
        }
      } else if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, typeEnv, ctx);
        const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
        lines.push(`${indent}self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      } else if (s.type === 'PutStatement') {
        const val = genRustExpr(s.value, typeEnv, ctx);
        const t = typeEnv.get(s.name) || inferLiteralType(s.value);
        lines.push(`${indent}self.refs.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      } else if (s.type === 'ImplicitReturn') {
        lastTypedName = null;
        const raw = genRustExpr(s.expr, typeEnv, ctx);
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

function isBoolExpr(expr) {
  if (expr.type === 'BoolLiteral') return true;
  if (expr.type === 'BinaryExpr') {
    const cmpOps = ['===', '!==', '==', '!=', '>', '<', '>=', '<='];
    return cmpOps.includes(expr.op);
  }
  return false;
}

function genRustCondition(expr, typeEnv, ctx) {
  const raw = genRustExpr(expr, typeEnv, ctx);
  if (isBoolExpr(expr)) return raw;
  // StateVar/RefRead — Value type, check truthiness
  if (expr.type === 'StateVar' || expr.type === 'RefRead') {
    return `${raw} != Value::Null && ${raw} != json!(false)`;
  }
  // Identifier with known type
  if (expr.type === 'Identifier' && typeEnv) {
    const t = typeEnv.get(expr.name);
    if (t === 'Boolean') return raw;
    if (t === 'Integer' || t === 'Float' || t === 'Text') return 'true'; // non-null, non-false → truthy
    // Value type or union: only false and null are falsy
    return `${raw} != Value::Null && ${raw} != json!(false)`;
  }
  // Typed literal (IntLiteral etc.) — always truthy
  if (expr.type === 'IntLiteral' || expr.type === 'FloatLiteral' || expr.type === 'StringLiteral') return 'true';
  if (expr.type === 'NullLiteral') return 'false';
  return raw;
}

function genRustIfExpr(expr, typeEnv, ctx, indent, targetType) {
  const I = indent || '    ';
  const cond = genRustCondition(expr.cond, typeEnv, ctx);
  const thenCode = genRustIfBranch(expr.then, typeEnv, ctx, I + '    ', targetType);
  let elseCode;
  if (!expr.else) {
    elseCode = `${I}    Value::Null`;
  } else if (expr.else.type === 'IfExpr') {
    elseCode = `${I}    ` + genRustIfExpr(expr.else, typeEnv, ctx, I + '    ', targetType);
  } else {
    elseCode = genRustIfBranch(expr.else, typeEnv, ctx, I + '    ', targetType);
  }
  return `if ${cond} {\n${thenCode}\n${I}} else {\n${elseCode}\n${I}}`;
}

function genRustProcMethod({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const callableAnalysis = analyzeCallables(body, mutableVars, typeEnv);
  const I = '        ';

  // Destructure params from _s
  const paramLines = [];
  let posIdx = 0;
  for (const p of params) {
    if (p.positional) {
      const accessor = `_s.positional.get(${posIdx}).cloned().unwrap_or(Value::Null)`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      posIdx++;
    } else {
      const key = p.key || p.name;
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(Value::Null)`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
    }
  }

  const locals = genRustLocals(body, typeEnv, callableAnalysis, mutableVars, I);
  const retExpr = reply ? genRustProcReturn(reply.fields, typeEnv) : 'Structure::empty()';

  const bodyLines = [];
  if (paramLines.length > 0) bodyLines.push(paramLines.join('\n'));
  if (locals) bodyLines.push(locals);
  bodyLines.push(`${I}${retExpr}`);

  return `    fn ${op}_proc(&self, _s: &Structure) -> Structure {\n${bodyLines.join('\n')}\n    }`;
}

function forceJsonWrap(expr) {
  // Always wrap native Rust values into serde_json::Value for Structure fields
  if (expr === 'Value::Null' || expr.startsWith('json!(')) return expr;
  return `json!(${expr})`;
}

function genRustProcReturn(fields, typeEnv) {
  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  const posVals = pos.map(f => {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null);
    if (f.name) {
      if (f.name.startsWith('$')) return resolveVarExpr(f.name);
      return forceJsonWrap(toJsonValue(f.name, t));
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
        val = f.sigil.startsWith('$') ? resolveVarExpr(f.sigil) : forceJsonWrap(toJsonValue(f.sigil, typeEnv.get(f.sigil)));
      } else if (f.key !== undefined) {
        val = forceJsonWrap(toJsonValue(genRustExpr(f.value, typeEnv), f.type));
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

function genRustProcCallExpr(expr, typeEnv) {
  if (expr.args.length === 0) {
    return `self.${expr.name}_proc(&Structure::empty())`;
  }
  const positionalArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  const argVals = positionalArgs.map(a => {
    const raw = genRustExpr(a, typeEnv);
    const t = typeEnv.get(a.name);
    if (t === 'Text') return `json!(${raw}.clone())`;
    return `json!(${raw})`;
  });
  let namedBlock = 'Map::new()';
  if (namedBag) {
    const inserts = Object.entries(namedBag.fields).map(([key, val]) => {
      const raw = genRustExpr(val, typeEnv);
      const t = typeEnv.get(val.name);
      if (t === 'Text') return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}.clone()));`;
      return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}));`;
    }).join(' ');
    namedBlock = `{ let mut m = Map::new(); ${inserts} m }`;
  }
  return `self.${expr.name}_proc(&Structure { positional: vec![${argVals.join(', ')}], named: ${namedBlock} })`;
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
      const accessor = `_s.positional.get(${posIdx}).cloned().unwrap_or(Value::Null)`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
      posIdx++;
    } else if (hasPositional) {
      // Named param in a mixed handler — use _s.named
      const key = p.key || p.name;
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(Value::Null)`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    } else {
      // Pure named handler — use payload directly (existing behavior)
      const key = p.key || p.name;
      const accessor = `payload.get("${key}").cloned().unwrap_or(Value::Null)`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    }
  }
  return lines.join('\n');
}

let _procTempCounter = 0;

function genRecursiveFnDef(name, funcNode, typeEnv) {
  const params = funcNode.params || [];
  const bodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
  const implRet = funcNode.body?.find(st => st.type === 'ImplicitReturn');
  const returnNode = funcNode.body?.find(st => st.type === 'Return');

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

function genRustLocals(body, typeEnv, callableAnalysis, mutableVars, indent) {
  const { callables, skipSet, capturePoints } = callableAnalysis;
  const lines = [];
  const I = indent || '                ';

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // Emit capture points for callables defined at this index
    if (capturePoints.has(i)) {
      for (const cp of capturePoints.get(i)) {
        lines.push(`${I}let ${cp.capName}: ${cp.rustType} = ${cp.varName};`);
      }
    }

    // Skip statements that are part of the callable pipeline
    // But emit recursive callables as actual Rust functions
    if (skipSet.has(i)) {
      if (s.type === 'Assign' || s.type === 'TypedAssign') {
        const tracked = callables.get(s.name);
        if (tracked && tracked.recursive) {
          lines.push(`${I}${genRecursiveFnDef(s.name, tracked.node, typeEnv).split('\n').join('\n' + I)}`);
        }
      }
      continue;
    }

    if (s.type === 'TypedAssign') {
      if (s.value.type === 'IfExpr') {
        lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, null, I, rustType(s.typeName))};`);
      } else if (s.value.type === 'ProcCallExpr') {
        const callExpr = genRustProcCallExpr(s.value, typeEnv);
        if (s.typeName === 'Structure') {
          lines.push(`${I}let ${s.name} = ${callExpr};`);
        } else {
          const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
          lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${converted};`);
        }
      } else if (s.typeName === 'Structure') {
        lines.push(`${I}let ${s.name} = ${genRustExpr(s.value, typeEnv)};`);
      } else if (s.value.type === 'StructureConstructor') {
        const expr = genRustExpr(s.value, typeEnv);
        const converted = convertFromValue(`${expr}.one()`, s.typeName);
        lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${converted};`);
      } else if (s.value.type === 'FunctionCallExpr') {
        const calleeName = s.value.callee?.name;
        const tracked = calleeName ? callables.get(calleeName) : null;
        if (tracked && tracked.recursive) {
          // Call the generated recursive function directly
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const argExprs = callArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${rustIdent(calleeName)}(${argExprs});`);
        } else if (tracked) {
          // Inline the closure body with param bindings in a block expression
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBag = s.value.args.find(a => a.type === 'NamedArgsBag');

          // Separate return expression from body statements
          let innerExpr;
          let returnNode = null;
          let bodyStmts = [];
          if (funcNode.body) {
            bodyStmts = funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return');
            const implRet = funcNode.body.find(st => st.type === 'ImplicitReturn');
            returnNode = funcNode.body.find(st => st.type === 'Return');
            innerExpr = implRet ? implRet.expr : null;
            // If no ImplicitReturn, use last body statement's variable as return
            if (!innerExpr && !returnNode && bodyStmts.length > 0) {
              const lastStmt = bodyStmts[bodyStmts.length - 1];
              if (lastStmt.type === 'PutStatement') {
                // Put returns the new ref value
                innerExpr = { type: 'RefRead', name: lastStmt.name };
              } else if (lastStmt.name) {
                innerExpr = { type: 'Identifier', name: lastStmt.name };
              } else {
                // Body has statements but no named return — evaluate to null
                innerExpr = { type: 'NullLiteral' };
              }
            }
          } else {
            innerExpr = funcNode.expr;
          }

          if (innerExpr || returnNode) {
            const hasBlockContent = funcParams.length > 0 || bodyStmts.length > 0;
            const blockLines = [];

            // Bind function params to call-site arguments
            let posIdx = 0;
            for (let pi = 0; pi < funcParams.length; pi++) {
              const param = funcParams[pi];
              let arg;
              const lookupKey = param.key || param.name;
              if (param.positional) {
                arg = callArgs[posIdx++];
              } else if (namedArgsBag && namedArgsBag.fields && lookupKey in namedArgsBag.fields) {
                arg = namedArgsBag.fields[lookupKey];
              }
              const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
              let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
              if (paramType) {
                if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
                blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
              } else {
                blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
              }
            }

            // Emit body statements (excluding ImplicitReturn/Return)
            for (const bs of bodyStmts) {
              if (bs.type === 'TypedAssign') {
                const bsVal = substituteCaptures(bs.value, tracked.captures);
                blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bsVal, typeEnv)};`);
              } else if (bs.type === 'Assign') {
                const bsVal = substituteCaptures(bs.value, tracked.captures);
                const knownType = inferLiteralType(bs.value);
                if (knownType) {
                  blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bsVal, typeEnv)};`);
                } else {
                  blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bsVal, typeEnv)};`);
                }
              } else if (bs.type === 'WhileStatement') {
                blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
              } else if (bs.type === 'StateAssign') {
                const bsVal = genRustExpr(bs.value, typeEnv);
                const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}    self.state.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              } else if (bs.type === 'PutStatement') {
                const bsVal = genRustExpr(bs.value, typeEnv);
                const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}    self.refs.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              } else if (bs.type === 'ExprStatement') {
                if (bs.expr.type === 'IfExpr') {
                  blockLines.push(genRustIfStatement(bs.expr, typeEnv, `${I}    `));
                } else {
                  blockLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
                }
              }
            }

            if (returnNode) {
              // Return node: build a Structure from fields, then extract as needed
              const retStructExpr = genRustProcReturn(returnNode.fields, typeEnv);
              if (s.typeName === 'Structure') {
                blockLines.push(`${I}    ${retStructExpr}`);
                lines.push(`${I}let ${s.name} = {\n${blockLines.join('\n')}\n${I}};`);
              } else {
                const converted = convertFromValue(`${retStructExpr}.one()`, s.typeName);
                blockLines.push(`${I}    ${converted}`);
                lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
              }
            } else if (hasBlockContent) {
              // Return expression as block value
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              blockLines.push(`${I}    ${converted}`);
              lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
            } else {
              // No params, no body — simple inline
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${converted};`);
            }
          }
        } else {
          const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { callables } : undefined;
          let val = genRustExpr(s.value, typeEnv, exprCtx);
          const isIterExpr = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
          if (isIterExpr && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (!isIterExpr && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${val};`);
        }
      } else {
        const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { callables } : undefined;
        let val = genRustExpr(s.value, typeEnv, exprCtx);
        const isIterExpr2 = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
        if (isIterExpr2 && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
        if (!isIterExpr2 && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
        lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${val};`);
      }
    } else if (s.type === 'DestructureAssign') {
      if (s.source.type === 'FunctionCallExpr') {
        // Inline callable and destructure the result
        const calleeName = s.source.callee?.name;
        const tracked = calleeName ? callables.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagD = s.source.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const fnReturnNode = funcNode.body ? funcNode.body.find(st => st.type === 'Return') : null;
          const fnImplRet = funcNode.body ? funcNode.body.find(st => st.type === 'ImplicitReturn') : null;

          const tempName = `_fr${_procTempCounter++}`;
          const blockLines = [];
          let posIdxD = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxD++];
            } else if (namedArgsBagD && namedArgsBagD.fields && lookupKey in namedArgsBagD.fields) {
              arg = namedArgsBagD.fields[lookupKey];
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}    let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}    let ${param.name} = ${argExpr};`);
            }
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'TypedAssign') {
              blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv)};`);
            } else if (bs.type === 'Assign') {
              const knownType = inferLiteralType(bs.value);
              if (knownType) {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'PutStatement') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    self.refs.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    self.state.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'WhileStatement') {
              blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
            }
          }
          if (fnReturnNode) {
            blockLines.push(`${I}    ${genRustProcReturn(fnReturnNode.fields, typeEnv)}`);
          } else if (fnImplRet) {
            const valExpr = genRustExpr(fnImplRet.expr, typeEnv);
            blockLines.push(`${I}    Structure { positional: vec![json!(${valExpr})], named: Map::new() }`);
          }
          lines.push(`${I}let ${tempName} = {\n${blockLines.join('\n')}\n${I}};`);
          for (const item of s.pattern) {
            if (item.discard) continue;
            if (item.named) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.key !== undefined) {
              const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else if (item.positional) {
              const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            }
          }
        }
      } else if (s.source.type === 'ProcCallExpr') {
        const tempName = `_r${_procTempCounter++}`;
        const callExpr = genRustProcCallExpr(s.source, typeEnv);
        lines.push(`${I}let ${tempName} = ${callExpr};`);
        for (const item of s.pattern) {
          if (item.discard) continue;
          if (item.named) {
            const accessor = `${tempName}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
          } else if (item.key !== undefined) {
            const accessor = `${tempName}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
          } else if (item.positional) {
            const accessor = `${tempName}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
          }
        }
      } else {
        const srcExpr = genRustExpr(s.source, typeEnv);
        for (const item of s.pattern) {
          if (item.discard) continue;
          const itemType = typeEnv.get(item.name) || null;
          const rType = rustType(itemType);
          if (item.named) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.name)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.key !== undefined) {
            const accessor = `${srcExpr}.named.get(${JSON.stringify(item.key)}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          } else if (item.positional) {
            const accessor = `${srcExpr}.positional.get(${item.idx}).cloned().unwrap_or(Value::Null)`;
            lines.push(`${I}let ${item.name}: ${rType} = ${convertFromValue(accessor, itemType)};`);
          }
        }
      }
    } else if (s.type === 'Assign') {
      const isStructLiteral = s.value.type === 'StructureLiteral' || s.value.type === 'StructureConstructor';
      if (isStructLiteral) {
        lines.push(`${I}let ${s.name} = ${genRustExpr(s.value, typeEnv)};`);
      } else {
        // Use known type from typeEnv for proper Rust type
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          let val = genRustExpr(s.value, typeEnv);
          if (knownType === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${s.name}: ${rustType(knownType)} = ${val};`);
        } else {
          lines.push(`${I}let ${s.name}: Value = ${genRustExpr(s.value, typeEnv)};`);
        }
      }
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'WhileStatement') {
      lines.push(genRustWhileStatement(s, typeEnv, I));
    } else if (s.type === 'RefDecl') {
      const val = s.value ? genRustExpr(s.value, typeEnv) : 'Value::Null';
      const t = s.typeName || inferLiteralType(s.value);
      lines.push(`${I}self.refs.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'PutStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.refs.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'ListDestructure') {
      lines.push(genRustListDestructure(s, typeEnv, I));
    } else if (s.type === 'IfStatement') {
      const cond = genRustCondition(s.cond, typeEnv);
      const bodyLines = [];
      for (const bs of s.body) {
        if (bs.type === 'PutStatement') {
          const val = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
          bodyLines.push(`${I}    self.refs.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        } else if (bs.type === 'StateAssign') {
          const val = genRustExpr(bs.value, typeEnv);
          const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
          bodyLines.push(`${I}    self.state.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        } else if (bs.type === 'ExprStatement') {
          bodyLines.push(`${I}    ${genRustExpr(bs.expr, typeEnv)};`);
        }
      }
      lines.push(`${I}if ${cond} {\n${bodyLines.join('\n')}\n${I}}`);
    } else if (s.type === 'SpawnStatement') {
      if (s.call.type === 'ProcCallExpr') {
        const callExpr = genRustProcCallExpr(s.call, typeEnv);
        lines.push(`${I}let _ = ${callExpr};`);
      } else if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genRustExpr(s.call, typeEnv)};`);
      }
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else if (s.expr.type === 'FunctionCallExpr') {
        // Inline callable for side effects
        const calleeName = s.expr.callee?.name;
        const tracked = calleeName ? callables.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.expr.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagE = s.expr.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const blockLines = [];
          // Build ref param mapping: param.name → original ref name
          const refParamMap = new Map();
          let posIdxE = 0;
          for (let pi = 0; pi < funcParams.length; pi++) {
            const param = funcParams[pi];
            let arg;
            const lookupKey = param.key || param.name;
            if (param.positional) {
              arg = callArgs[posIdxE++];
            } else if (namedArgsBagE && namedArgsBagE.fields && lookupKey in namedArgsBagE.fields) {
              arg = namedArgsBagE.fields[lookupKey];
            }
            if (param.ref && arg?.type === 'RefArg') {
              refParamMap.set(param.name, arg.name);
              // Emit a read binding so the param name is available in body expressions
              const refReadExpr = `self.refs.get("${arg.name}").cloned().unwrap_or(Value::Null)`;
              if (param.type) {
                blockLines.push(`${I}let ${rustIdent(param.name)}: ${rustType(param.type)} = ${convertFromValue(refReadExpr, param.type)};`);
              } else {
                blockLines.push(`${I}let ${rustIdent(param.name)} = ${refReadExpr};`);
              }
              continue;
            }
            const paramType = param.type || inferLiteralType(arg) || (arg?.type === 'Identifier' ? typeEnv.get(arg.name) : null);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (paramType) {
              if (paramType === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
              blockLines.push(`${I}let ${param.name}: ${rustType(paramType)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}let ${param.name} = ${argExpr};`);
            }
          }
          // Rewrite RefRead nodes in expressions that refer to ref params → use local let binding
          function rewriteRefReads(node) {
            if (!node || typeof node !== 'object') return node;
            if (node.type === 'RefRead' && refParamMap.has(node.name)) {
              return { type: 'Identifier', name: node.name };
            }
            const copy = Array.isArray(node) ? [...node] : { ...node };
            for (const key of Object.keys(copy)) {
              if (key === 'type') continue;
              copy[key] = rewriteRefReads(copy[key]);
            }
            return copy;
          }
          for (const bs of fnBodyStmts) {
            if (bs.type === 'PutStatement') {
              const refName = refParamMap.get(bs.name) || bs.name;
              const rewritten = rewriteRefReads(bs.value);
              const bsVal = genRustExpr(rewritten, typeEnv);
              const t = typeEnv.get(refName) || typeEnv.get(bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}self.refs.insert("${refName}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}self.state.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'ExprStatement') {
              blockLines.push(`${I}${genRustExpr(bs.expr, typeEnv)};`);
            }
          }
          if (blockLines.length > 0) lines.push(blockLines.join('\n'));
        } else {
          lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
        }
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    }
  }
  return lines.join('\n');
}

function genRustWhileStatement(node, typeEnv, I) {
  const lines = [];
  const cond = genRustCondition(node.cond, typeEnv);
  const whileCond = node.negated ? `!(${cond})` : cond;
  lines.push(`${I}loop {`);
  lines.push(`${I}    if !(${whileCond}) { break; }`);
  for (const s of node.body) {
    if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}    self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'PutStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}    self.refs.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'TypedAssign') {
      let val = genRustExpr(s.value, typeEnv);
      if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}    let ${s.name}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}    let ${s.name} = ${genRustExpr(s.value, typeEnv)};`);
    } else if (s.type === 'ExprStatement') {
      lines.push(`${I}    ${genRustExpr(s.expr, typeEnv)};`);
    }
  }
  lines.push(`${I}}`);
  return lines.join('\n');
}

function genRustListDestructure(node, typeEnv, I) {
  const lines = [];
  const src = genRustExpr(node.source, typeEnv);
  const tempBase = `_ld${_procTempCounter++}`;
  lines.push(`${I}let ${tempBase} = ${src};`);

  const pattern = node.pattern;
  const hasRest = pattern.some(p => p.rest);
  let cur = tempBase;

  for (let i = 0; i < pattern.length; i++) {
    const item = pattern[i];
    if (item.rest) {
      // Rest: take remaining as array (or null if empty)
      if (!item.discard && item.name) {
        const rType = rustType(item.type);
        lines.push(`${I}let ${item.name}: ${rType} = ${cur};`);
      }
      break;
    }
    // Extract head — panic if list is empty
    lines.push(`${I}if ${cur}.as_array().map(|a| a.is_empty()).unwrap_or(true) { panic!("list_destructure_empty"); }`);
    if (!item.discard && item.name) {
      const accessor = `${cur}.as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null)`;
      lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
    }
    // Advance to tail
    if (i < pattern.length - 1) {
      const next = `${tempBase}_${i}`;
      lines.push(`${I}let ${next}: Value = ${cur}.as_array().map(|a| if a.len() > 1 { json!(&a[1..]) } else { Value::Null }).unwrap_or(Value::Null);`);
      cur = next;
    }
  }

  // Arity check: if no rest and more than one element, check tail is empty
  if (!hasRest && pattern.length > 0) {
    lines.push(`${I}if ${cur}.as_array().map(|a| a.len()).unwrap_or(0) > 1 { panic!("list_destructure_arity"); }`);
  }

  return lines.join('\n');
}

function genRustIfStatementBody(branch, typeEnv, I) {
  const lines = [];
  const stmts = branch.body || (branch.expr ? [{ type: 'ExprStatement', expr: branch.expr }] : []);
  for (const s of stmts) {
    if (s.type === 'PutStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.refs.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else {
        lines.push(`${I}${genRustExpr(s.expr, typeEnv)};`);
      }
    } else if (s.type === 'TypedAssign') {
      let val = genRustExpr(s.value, typeEnv);
      if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}let ${s.name}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}let ${s.name} = ${genRustExpr(s.value, typeEnv)};`);
    }
  }
  return lines.join('\n');
}

function genRustIfStatement(expr, typeEnv, I) {
  const cond = genRustCondition(expr.cond, typeEnv);
  const thenBody = genRustIfStatementBody(expr.then, typeEnv, `${I}    `);
  let code = `${I}if ${cond} {\n${thenBody}\n${I}}`;
  if (expr.else) {
    if (expr.else.type === 'IfExpr') {
      code += ` else ` + genRustIfStatement(expr.else, typeEnv, I).trimStart();
    } else {
      const elseBody = genRustIfStatementBody(expr.else, typeEnv, `${I}    `);
      code += ` else {\n${elseBody}\n${I}}`;
    }
  }
  return code;
}

function genRustReBody(fields, typeEnv, refNames) {
  refNames = refNames || new Set();
  const spread = fields.find(f => f.spread);
  if (spread) return `${spread.name}.splat()`;

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  function resolveFieldName(name) {
    if (name.startsWith('$')) return resolveVarExpr(name);
    if (refNames.has(name)) return `self.refs.get("${name}").cloned().unwrap_or(Value::Null)`;
    return null;
  }

  function reFieldVal(f) {
    if (f.name) {
      const resolved = resolveFieldName(f.name);
      if (resolved) return resolved;
      const t = f.type || typeEnv.get(f.name);
      return toJsonValue(f.name, t);
    }
    if (f.expr) return toJsonValue(genRustExpr(f.expr, typeEnv), null);
    return 'Value::Null';
  }

  if (pos.length > 0 && named.length > 0) {
    // Mixed: [pos1, pos2, {key: val}]
    const posVals = pos.map(reFieldVal).join(', ');
    const namedEntries = named.map(f => {
      if ('sigil' in f) return `"${f.sigil}": ${resolveFieldName(f.sigil) || f.sigil}`;
      if (f.key !== undefined) return `"${f.key}": ${genRustExpr(f.value, typeEnv)}`;
      return '';
    }).filter(Boolean).join(', ');
    return `json!([${posVals}, {${namedEntries}}])`;
  } else if (pos.length > 0) {
    // Positional only: [val1, val2]
    const posVals = pos.map(reFieldVal).join(', ');
    return `json!([${posVals}])`;
  } else {
    // Named only: {key: val}
    const entries = [];
    for (const f of named) {
      if ('sigil' in f) {
        entries.push(`"${f.sigil}": ${resolveFieldName(f.sigil) || f.sigil}`);
      } else if (f.key !== undefined) {
        entries.push(`"${f.key}": ${genRustExpr(f.value, typeEnv)}`);
      }
    }
    return `json!({${entries.join(', ')}})`;
  }
}

function genRustBvaBody(fields, typeEnv, refNames) {
  const spread = fields.find(f => f.spread);
  if (spread) return null; // bv-a handled separately for spread

  const isListOfAny = t => t === 'List of Anything' || t === 'List';

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  let hasDynamic = false;

  // Collect types for positional fields
  const posTypes = [];
  for (const f of pos) {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null) || inferLiteralType(f.expr);
    if (!t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      const varName = f.name || (f.expr?.type === 'Identifier' ? f.expr.name : null);
      if (!varName) return null;
      posTypes.push({ dynamic: true, expr: `list_types_of(&${varName})` });
    } else {
      posTypes.push({ dynamic: false, val: JSON.stringify(t) });
    }
  }

  // Collect types for named fields
  const namedTypes = [];
  for (const f of named) {
    let key, t, varName;
    if ('sigil' in f) {
      key = f.sigil;
      t = f.type || typeEnv.get(f.sigil);
      varName = f.sigil;
    } else if (f.key !== undefined) {
      key = f.key;
      t = f.type || (f.value?.type === 'Identifier' || f.value?.type === 'RefRead' ? typeEnv.get(f.value.name) : null) || (f.value?.type === 'StateVar' ? typeEnv.get('$' + f.value.name) : null) || inferLiteralType(f.value);
      varName = (f.value?.type === 'Identifier' || f.value?.type === 'RefRead') ? f.value.name : null;
    }
    if (!key || !t) return null;
    if (isListOfAny(t)) {
      hasDynamic = true;
      if (!varName) return null;
      const resolved = refNames.has(varName) ? `self.refs.get("${varName}").cloned().unwrap_or(Value::Null)` : varName;
      namedTypes.push({ dynamic: true, key, expr: `list_types_of(&${resolved})` });
    } else {
      namedTypes.push({ dynamic: false, key, val: `"${t}"` });
    }
  }

  if (!hasDynamic) {
    // Static bv-a — use json! macro
    if (pos.length > 0 && named.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}, {${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}}])`;
    } else if (pos.length > 0) {
      return `json!([${posTypes.map(p => p.val).join(', ')}])`;
    } else if (named.length > 0) {
      return `json!({${namedTypes.map(n => `"${n.key}": ${n.val}`).join(', ')}})`;
    }
    return null;
  }

  // Dynamic bv-a — build at runtime with Map
  if (named.length > 0 && pos.length === 0) {
    const pairs = namedTypes.map(n => {
      if (n.dynamic) {
        return `bva_map.insert("${n.key}".to_string(), ${n.expr});`;
      } else {
        return `bva_map.insert("${n.key}".to_string(), json!(${n.val}));`;
      }
    });
    return `{ let mut bva_map = Map::new(); ${pairs.join(' ')} Value::Object(bva_map) }`;
  }
  // For now, return null for complex dynamic cases (pos + named with dynamic)
  return null;
}

function genRustHandler({ op, params, body }) {
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const callableAnalysis = analyzeCallables(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const typedParams = params.filter(p => p.type && !p.rest && !isListOfAny(p.type));
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);
  let guard = '';
  if (positionalTyped.length > 0) {
    const posTypes = positionalTyped.map(p => `"${p.type}"`).join(', ');
    const namedTypes = namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ');
    guard = ` if match_types_positional(message, &[${posTypes}], &[${namedTypes}])`;
  } else if (namedTyped.length > 0) {
    guard = ` if match_types(message, &[${namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`;
  }

  const lines = [];

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const locals = genRustLocals(body, typeEnv, callableAnalysis, mutableVars);
  if (locals) lines.push(locals);

  if (reply) {
    const isSpread = reply.fields.some(f => f.spread);
    if (isSpread) {
      const spreadField = reply.fields.find(f => f.spread);
      const spreadName = spreadField.name;
      lines.push(`                re = Some(${spreadName}.splat());`);
      // Passthrough bv-a from incoming message
      lines.push(`                if let Some(bva) = message.get("bv-a") {`);
      lines.push(`                    if let Some(arr) = bva.as_array() {`);
      lines.push(`                        if !arr.is_empty() {`);
      lines.push(`                            bva_re = Some(Structure::splat_bva(&arr[0]));`);
      lines.push(`                        }`);
      lines.push(`                    }`);
      lines.push(`                }`);
    } else {
      lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
      const bva = genRustBvaBody(reply.fields, typeEnv, refNames);
      if (bva) {
        lines.push(`                bva_re = Some(${bva});`);
      }
    }
  }
  lines.push('                handled = true;');

  return `            "${op}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(handlers) {
  const arms = handlers.map(h => genRustHandler(h));
  arms.push('            _ => {}');
  return arms.join('\n');
}

function needsStructure(actor) {
  if (actor.procs && actor.procs.length > 0) return true;
  for (const h of actor.handlers) {
    if (h.params.some(p => p.positional && !p.rest)) return true;
    if (h.params.some(p => p.rest)) return true;
    for (const s of h.body) {
      if (s.type === 'DestructureAssign') return true;
      if (s.type === 'Assign' && s.value.type === 'IndexExpr') return true;
      if (s.type === 'Assign' && s.value.type === 'Function') return true;
      if (s.type === 'TypedAssign' && s.typeName === 'Structure') return true;
      if (s.type === 'TypedAssign' && (s.value.type === 'StructureConstructor' || s.value.type === 'StructureLiteral')) return true;
      if (s.type === 'Assign' && (s.value.type === 'StructureConstructor' || s.value.type === 'StructureLiteral')) return true;
      if (s.type === 'TypedAssign' && s.value.type === 'FunctionCallExpr') return true;
    }
  }
  return false;
}

function genRustProgram(actor) {
  const hasProcs = actor.procs && actor.procs.length > 0;
  const isStateful = actor.stateVarDecls && actor.stateVarDecls.length > 0;
  const needsRefs = actor.handlers.some(h => h.body.some(s => s.type === 'RefDecl' || s.type === 'PutStatement' || s.type === 'RefRead'))
    || actor.handlers.some(h => h.body.some(s => s.type === 'WhileStatement' && s.body.some(ws => ws.type === 'PutStatement')));
  const needsMatchTypes = actor.handlers.some(h => {
    const typed = h.params.filter(p => p.type && !p.rest);
    return typed.length > 0 && !typed.some(p => p.positional);
  });
  const needsMatchTypesPos = actor.handlers.some(h => h.params.some(p => p.type && !p.rest && p.positional));
  const needsListTypesOf = actor.handlers.some(h => {
    const isListOfAny = t => t === 'List of Anything' || t === 'List';
    return h.body.some(s => s.type === 'TypedAssign' && isListOfAny(s.typeName));
  });
  const matchTypesFn = needsMatchTypes ? '\n' + MATCH_TYPES_FN + '\n' : '';
  const matchTypesPosFn = needsMatchTypesPos ? '\n' + MATCH_TYPES_POSITIONAL_FN + '\n' : '';
  const listTypesOfFn = needsListTypesOf ? '\n' + LIST_TYPES_OF_FN + '\n' : '';
  const structurePreamble = needsStructure(actor) ? '\n' + RUST_STRUCTURE_PREAMBLE + '\n' : '';
  const matchArms = genRustDispatch(actor.handlers);
  const procMethods = hasProcs ? '\n' + actor.procs.map(p => genRustProcMethod(p)).join('\n\n') : '';

  // Actor struct fields
  const structFields = ['    binding: mpsc::Sender<Value>'];
  const newFields = ['binding'];
  const newArgs = [];
  if (isStateful) {
    structFields.push('    state: std::collections::HashMap<String, Value>');
    structFields.push('    initialized: bool');
    newArgs.push('state: std::collections::HashMap::new(), initialized: false');
  }
  if (needsRefs || isStateful) {
    // Always include refs if we have state (while loops may use refs)
    structFields.push('    refs: std::collections::HashMap<String, Value>');
    newArgs.push('refs: std::collections::HashMap::new()');
  }
  structFields.push('    send_seq: std::cell::Cell<i64>');
  newArgs.push('send_seq: std::cell::Cell::new(1)');

  // Init handler for stateful actors
  let initMethod = '';
  if (isStateful) {
    const initTypeEnv = new Map();
    for (const d of actor.stateVarDecls) {
      initTypeEnv.set('$' + d.name, d.typeName);
    }
    const initBody = actor.initBody || [];
    const initLocals = [];
    // Handle init params
    if (actor.initParams && actor.initParams.length > 0) {
      initLocals.push('        let cam_val = message.get("cam").cloned().unwrap_or(Value::Null);');
      initLocals.push('        let _init_payload = if let Some(arr) = cam_val.as_array() { if arr.len() > 1 { arr[0].clone() } else { json!({}) } } else { json!({}) };');
      for (let pi = 0; pi < actor.initParams.length; pi++) {
        const p = actor.initParams[pi];
        const accessor = `_init_payload.as_array().and_then(|a| a.get(${pi})).cloned().unwrap_or(Value::Null)`;
        initLocals.push(`        let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      }
    }
    for (const s of initBody) {
      if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, initTypeEnv);
        const t = initTypeEnv.get('$' + s.name);
        initLocals.push(`        self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    }

    initMethod = `
    fn handle_cam_init(&mut self, message: &Value) {
        let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
${initLocals.join('\n')}
        self.initialized = true;
        let mut resp = Map::new();
        resp.insert("id".to_string(), json!(id));
        resp.insert("re".to_string(), json!("init"));
        resp.insert("to".to_string(), json!(from));
        let _ = self.binding.send(Value::Object(resp));
    }
`;
  }

  // Receive method — stateful actors check for cam init and initialized flag
  let receiveBody;
  if (isStateful) {
    receiveBody = `        if message.get("re").is_some() {
            return;
        }
        if message.get("cam").is_some() {
            self.handle_cam_init(message);
            return;
        }
        if !self.initialized {
            let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("ex".to_string(), json!("stateful actor not initialized"));
            resp.insert("to".to_string(), json!(from));
            let _ = self.binding.send(Value::Object(resp));
            return;
        }
        self.dispatch(message);`;
  } else {
    receiveBody = `        if message.get("re").is_some() {
            return;
        }
        self.dispatch(message);`;
  }

  // Dispatch body — always wrapped in catch_unwind for panic → error response
  const dispatchBlock = `        let result = catch_unwind(AssertUnwindSafe(|| {
            let mut re: Option<Value> = None;
            let mut bva_re: Option<Value> = None;
            let mut handled = false;
            match op_name.as_str() {
${matchArms}
            }
            (re, bva_re, handled)
        }));
        match result {
            Ok((re, bva_re, handled)) => {
                if !handled {
                    let mut ex = Map::new();
                    ex.insert(op_name.clone(), json!("unhandled"));
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("ex".to_string(), Value::Object(ex));
                    resp.insert("to".to_string(), json!(from));
                    let _ = self.binding.send(Value::Object(resp));
                } else if let Some(re_val) = re {
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("re".to_string(), re_val);
                    resp.insert("to".to_string(), json!(from));
                    if let Some(bva) = bva_re {
                        resp.insert("bv-a".to_string(), bva);
                    }
                    let _ = self.binding.send(Value::Object(resp));
                }
            }
            Err(_) => {
                let mut ex = Map::new();
                ex.insert(op_name.clone(), json!("error"));
                let mut resp = Map::new();
                resp.insert("id".to_string(), json!(id));
                resp.insert("ex".to_string(), Value::Object(ex));
                resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
            }
        }`;

  return `use serde_json::{json, Value, Map};
use std::io::{self, BufRead, Write};
use std::sync::mpsc;
use std::panic::{catch_unwind, AssertUnwindSafe};
${matchTypesFn}${matchTypesPosFn}${listTypesOfFn}${structurePreamble}
struct Actor {
${structFields.join(',\n')},
}

impl Actor {
    fn new(binding: mpsc::Sender<Value>) -> Self {
        Actor { binding, ${newArgs.join(', ')} }
    }

    fn receive(&mut self, message: &Value) {
${receiveBody}
    }
${initMethod}
    fn dispatch(&mut self, message: &Value) {
        let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
        let op_val = message.get("op").unwrap();
        let (op_name, raw_payload): (String, Option<Value>) = if let Some(s) = op_val.as_str() {
            (s.to_string(), None)
        } else if let Some(arr) = op_val.as_array() {
            let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let payload = if arr.len() > 1 { Some(arr[0].clone()) } else { None };
            (name, payload)
        } else {
            return;
        };
        let has_payload = match &raw_payload {
            Some(Value::Object(m)) => !m.is_empty(),
            Some(Value::Array(a)) => !a.is_empty(),
            _ => false,
        };
        if has_payload && message.get("bv-a").is_none() {
            let mut ex = Map::new();
            ex.insert(op_name.clone(), json!("schema_required"));
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("ex".to_string(), Value::Object(ex));
            resp.insert("to".to_string(), json!(from));
            let _ = self.binding.send(Value::Object(resp));
            return;
        }
        let payload = raw_payload.unwrap_or(json!({}));
${dispatchBlock}
    }
${procMethods}
}

fn main() {
    let (tx, rx) = mpsc::channel::<Value>();
    let handle = std::thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        for msg in rx {
            serde_json::to_writer(&mut out, &msg).unwrap();
            out.write_all(b"\\n").unwrap();
            out.flush().unwrap();
        }
    });
    let mut actor = Actor::new(tx);
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() { continue; }
        let message: Value = serde_json::from_str(&line).unwrap();
        actor.receive(&message);
    }
    drop(actor);
    handle.join().unwrap();
}
`;
}

export function codegenRust(ast) {
  const active = ast.actors.filter(a => a.handlers.length > 0);
  if (active.length === 0) return '';
  return genRustProgram(active[0]);
}
