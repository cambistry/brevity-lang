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
  if (brevityType === 'Anything') {
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

function isFunctionArg(arg) {
  return arg.type === 'Function' || arg.expr?.type === 'Function' || (typeof arg.type === 'string' && arg.type.includes('->'));
}

function isFunctionOnlyConstructor(node) {
  return node.type === 'StructureConstructor' && node.args.length > 0 && node.args.every(isFunctionArg);
}

let _rsActorInfo = new Map(); // name -> { actor, asClauses }
let _rsActorFnNames = new Set(); // names of actor-level functions
let _rsStateVarNames = new Set(); // state variable names for current actor
let _rsStateVarDecls = []; // state var declarations with types
let _rsUsesNames = new Set(); // names declared with `uses`
let _rsRemoteInstanceVars = new Set(); // state vars holding remote actor refs
let _rsChildCounter = 0;
let _rsLambdaCounter = 0;
let _rsLambdaHandlers = []; // { name, params, body, returnType } — lambda handlers for dispatch
let _rsLambdaVarNames = new Set(); // local variable names that hold lambda handler names (Value::String)
let _rsEmitNames = new Map(); // emit declarations: name → EmitDecl

// Helper: resolve storage target for set/insert — state vars use self.state, local refs use self.refs
function rsStore(name) {
  return _rsStateVarNames.has(name) ? 'self.state' : 'self.refs';
}

function findRsAsClauseMatch(targetType, actorName) {
  if (!_rsActorInfo.has(actorName)) return null;
  const info = _rsActorInfo.get(actorName);
  if (!info.asClauses || info.asClauses.length === 0) return null;
  if (targetType === actorName) return null;
  for (const clause of info.asClauses) {
    if (!clause.negated && clause.targetType === targetType) return clause;
    if (clause.negated && clause.targetType !== targetType) return clause;
  }
  return null;
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

function analyzeFunctions(body, mutableVars, typeEnv) {
  const fnDefs = new Map();
  const skipSet = new Set();
  const capturePoints = new Map();
  const structureFunctions = new Map();

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // f = () { x }  OR  f : Function = |x| { ... }
    if ((s.type === 'Assign' && s.value.type === 'Function') ||
        (s.type === 'TypedAssign' && s.value.type === 'Function')) {
      fnDefs.set(s.name, { node: s.value, defIdx: i });
      skipSet.add(i);
    }

    // s : Structure = Structure(fn: f : Function) — all-function constructor
    if (s.type === 'TypedAssign' && s.typeName === 'Structure' && s.value.type === 'StructureConstructor') {
      if (isFunctionOnlyConstructor(s.value)) {
        skipSet.add(i);
        const sc = new Map();
        for (const arg of s.value.args) {
          if (arg.type === 'Function' && arg.expr?.type === 'Identifier' && fnDefs.has(arg.expr.name)) {
            sc.set(arg.key, arg.expr.name);
          } else if (arg.expr?.type === 'Function') {
            // Inline Function in structure — register directly
            const inlineName = `_sc_${s.name}_${arg.key}`;
            fnDefs.set(inlineName, { node: arg.expr, defIdx: i });
            sc.set(arg.key, inlineName);
          }
        }
        structureFunctions.set(s.name, sc);
      }
    }

    // DestructureAssign
    if (s.type === 'DestructureAssign') {
      // :fn = s (s is function-only Structure)
      if (s.source.type === 'Identifier' && structureFunctions.has(s.source.name)) {
        skipSet.add(i);
        const sc = structureFunctions.get(s.source.name);
        for (const item of s.pattern) {
          if (item.named && item.name && sc.has(item.name)) {
            fnDefs.set(item.name, fnDefs.get(sc.get(item.name)));
          }
        }
      }
      // :fn = Structure(fn: () { x } : Function) — inline function constructor
      if (s.source.type === 'StructureConstructor' && isFunctionOnlyConstructor(s.source)) {
        skipSet.add(i);
        for (const arg of s.source.args) {
          if (arg.expr?.type === 'Function') {
            for (const item of s.pattern) {
              const itemKey = item.named ? item.name : item.key;
              if (itemKey === arg.key) {
                fnDefs.set(item.name, { node: arg.expr, defIdx: i });
              }
            }
          }
        }
      }
    }
  }

  // Detect recursive fnDefs (body contains a call to itself)
  function containsSelfCall(node, fnName) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'FunctionCallExpr' && node.callee?.name === fnName) return true;
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      if (containsSelfCall(node[key], fnName)) return true;
    }
    return false;
  }
  for (const [name, info] of fnDefs) {
    info.recursive = containsSelfCall(info.node.body, name);
  }

  // Compute capture points for mutable free variables
  for (const [name, info] of fnDefs) {
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

  return { fnDefs, skipSet, capturePoints };
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
  if (expr.type === 'Identifier') {
    if (_rsStateVarNames.has(expr.name)) return `self.state.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
    return rustIdent(expr.name);
  }
  if (expr.type === 'BinaryExpr') {
    const rustOp = expr.op === '===' ? '==' : expr.op === '!==' ? '!=' : expr.op;
    const left = genRustExpr(expr.left, typeEnv, ctx);
    const right = genRustExpr(expr.right, typeEnv, ctx);
    // Detect operands that return Value and need extraction for arithmetic/comparison
    const numOps = ['+', '-', '*', '/', '>', '<', '>=', '<=', '==', '!='];
    const lIsValue = expr.left.type === 'StateVar' || expr.left.type === 'RefRead'
      || (expr.left.type === 'Identifier' && _rsStateVarNames.has(expr.left.name))
      || (expr.left.type === 'Identifier' && typeEnv && typeEnv.has(expr.left.name) && !typeEnv.get(expr.left.name));
    const rIsValue = expr.right.type === 'StateVar' || expr.right.type === 'RefRead'
      || (expr.right.type === 'Identifier' && _rsStateVarNames.has(expr.right.name))
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
    const named = expr.args.filter(a => a.key !== undefined && a.type !== 'Function');
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
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && expr.callee.name === '__tick__') {
    return 'std::thread::yield_now()';
  }
  // Emit invocation
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && _rsEmitNames.has(expr.callee.name)) {
    const emitDecl = _rsEmitNames.get(expr.callee.name);
    // In Rust, emit is a no-op for now (subscribers not implemented)
    // Silent emit returns Value::Null
    return 'Value::Null';
  }
  if (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && _rsActorFnNames.has(expr.callee.name)) {
    return `${genRustFnCallExpr(expr, typeEnv)}.one()`;
  }
  if (expr.type === 'FunctionCallExpr') {
    const calleeName = expr.callee?.name;
    const calleeType = calleeName && typeEnv ? typeEnv.get(calleeName) : null;
    // Check if callee is a local lambda var (now a handler name in a Value::String)
    const isLocalLambda = calleeName && _rsLambdaVarNames.has(calleeName);
    const isFnTyped = isLocalLambda || (calleeType && (calleeType === 'Function' || (typeof calleeType === 'string' && calleeType.includes('->'))));
    if (isFnTyped && calleeName) {
      // Function-typed param/var: call_fn dispatches to the handler name stored in the value
      // Returns a scalar Value (unwrapped from wire format via Structure::pack().one())
      const calleeRef = _rsStateVarNames.has(calleeName)
        ? `self.state.get("${calleeName}").cloned().unwrap_or(Value::Null)`
        : calleeName;
      const callArgs = (expr.args || []).filter(a => a.type !== 'NamedArgsBag');
      if (callArgs.length === 0) {
        return `{ let _cfr = self.call_fn(&${calleeRef}, &Value::Object(Map::new())); Structure::pack(&_cfr).one() }`;
      }
      // Pre-compute nested call_fn/self_send args to avoid double &mut self borrow
      const precomputes = [];
      // Pre-compute state var access to avoid borrow conflict
      if (_rsStateVarNames.has(calleeName)) {
        precomputes.push(`let _fn_ref = ${calleeRef};`);
      }
      const fnRef = _rsStateVarNames.has(calleeName) ? '_fn_ref' : calleeName;
      const argExprs = callArgs.map((a, i) => {
        const raw = genRustExpr(a, typeEnv, ctx);
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
    if (_rsStateVarNames.has(expr.name)) return `self.state.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
    return `self.refs.get("${expr.name}").cloned().unwrap_or(Value::Null)`;
  }
  if (expr.type === 'RefArg') {
    return `"ref_${expr.name}".to_string()`;
  }
  if (expr.type === 'ListLiteral') {
    if (expr.elements.length === 0) return 'json!([])';
    const elems = expr.elements.map(e => {
      const raw = genRustExpr(e.expr || e, typeEnv, ctx);
      const t = e.type || inferLiteralType(e.expr || e);
      return toJsonValue(raw, t);
    });
    return `json!([${elems.join(', ')}])`;
  }
  if (expr.type === 'DotCallExpr') {
    const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
    const isRemoteInst = dotObjName && _rsRemoteInstanceVars.has(dotObjName);
    // Fire-and-forget send
    const named = expr.args.filter(a => !a.positional);
    const positional = expr.args.filter(a => a.positional);
    if (isRemoteInst) {
      const to = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
      const method = JSON.stringify(expr.method);
      let opExpr;
      if (positional.length === 0 && named.length === 0) {
        opExpr = `json!(${method})`;
      } else if (named.length > 0) {
        const fields = named.map(a => `"${a.name}": ${genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, ctx)}`).join(', ');
        opExpr = `json!([{${fields}}, ${method}])`;
      } else {
        const vals = positional.map(a => genRustExpr(a.expr || a, typeEnv, ctx)).join(', ');
        opExpr = `json!([[${vals}], ${method}])`;
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
    const isWrappedChild = dotObjName && _rsStateVarNames.has(dotObjName) && (_rsStateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !_rsActorInfo.has(dotObjName) && !_rsRemoteInstanceVars.has(dotObjName)));
    if (isWrappedChild) {
      const childRef = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
      const method = JSON.stringify('@' + expr.method);
      let payload;
      if (positional.length === 0 && named.length === 0) {
        payload = 'json!({})';
      } else if (named.length > 0) {
        const fields = named.map(a => {
          const val = a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
          return `"${a.name}": ${val}`;
        }).join(', ');
        payload = `json!({${fields}})`;
      } else {
        const vals = positional.map(a => a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name)).join(', ');
        payload = `json!([${vals}])`;
      }
      return `{ let _cn = ${childRef}; self.child_dispatch(&_cn, ${method}, &${payload}) }`;
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
    const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv, ctx) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv, ctx);
    let opExpr, bvaExpr;
    if (positional.length > 0 && named.length > 0) {
      const posVals = positional.map(genArgVal).join(', ');
      const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
      opExpr = `json!([${posVals}, {${namedFields}}, ${method}])`;
      const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
      const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
      bvaExpr = `json!([${posBva}, {${namedBva}}])`;
    } else if (named.length > 0) {
      const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
      opExpr = `json!([{${namedFields}}, ${method}])`;
      const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
      bvaExpr = `json!([{${namedBva}}])`;
    } else {
      const posVals = positional.map(genArgVal).join(', ');
      opExpr = `json!([[${posVals}], ${method}])`;
      const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
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
  if (expr.type === 'FnRef' && _rsActorFnNames.has(expr.name)) {
    return `Value::String("${expr.name}".to_string())`;
  }
  if (expr.type === 'FnRef') {
    return rustIdent(expr.name);
  }
  if (expr.type === 'OverExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, ctx);
    let fn = expr.fn;
    // Handle FnRef (actor function) — call the fn method for each element
    if (fn.type === 'FnRef' && _rsActorFnNames.has(fn.name)) {
      const fnName = fn.name;
      return `{ let mut _result = Vec::new(); if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_el.clone()], named: Map::new() }; _result.push(self.${fnName}_fn(&_s).one()); } } Value::Array(_result) }`;
    }
    // Resolve FnRef to actual function node via ctx.fnDefs
    if (fn.type === 'FnRef' && ctx?.fnDefs) {
      const tracked = ctx.fnDefs.get(fn.name);
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
      } else {
        stmtLines.push(`let ${paramName} = _el.clone();`);
      }
      for (const bs of bodyStmts) {
        if (bs.type === 'TypedAssign' && bs.value.type === 'FunctionCallExpr' && bs.value.callee?.type === 'Identifier' && _rsActorFnNames.has(bs.value.callee.name)) {
          const pcExpr = genRustFnCallExpr(bs.value, typeEnv);
          stmtLines.push(`let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${convertFromValue(`${pcExpr}.one()`, bs.typeName)};`);
        } else if (bs.type === 'DestructureAssign' && bs.source.type === 'FunctionCallExpr' && bs.source.callee?.type === 'Identifier' && _rsActorFnNames.has(bs.source.callee.name)) {
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
          stmtLines.push(`let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv, ctx)};`);
        } else if (bs.type === 'Assign') {
          stmtLines.push(`let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv, ctx)};`);
        }
      }
      const innerExpr = genRustExpr(bodyExpr, typeEnv, ctx);
      const wrapped = toJsonValue(innerExpr, retType);
      stmtLines.push(wrapped);
      return `${coll}.as_array().map(|_arr| Value::Array(_arr.iter().map(|_el| { ${stmtLines.join(' ')} }).collect())).unwrap_or(Value::Null)`;
    }
    return 'Value::Null';
  }
  if (expr.type === 'ReduceExpr') {
    const coll = genRustExpr(expr.collection, typeEnv, ctx);
    const init = expr.initial ? genRustExpr(expr.initial, typeEnv, ctx) : 'Value::Null';
    let fn = expr.fn;
    // Handle FnRef (actor function) — call the fn method with (acc, item) for each element
    if (fn.type === 'FnRef' && _rsActorFnNames.has(fn.name)) {
      const fnName = fn.name;
      if (expr.initial) {
        const initVal = forceJsonWrap(init);
        return `{ let mut _acc: Value = ${initVal}; if let Some(_arr) = ${coll}.as_array() { for _el in _arr { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${fnName}_fn(&_s).one(); } } _acc }`;
      } else {
        return `{ let _cv = ${coll}; if let Some(_arr) = _cv.as_array() { if _arr.is_empty() { Value::Null } else { let mut _acc = _arr[0].clone(); for _el in &_arr[1..] { let _s = Structure { positional: vec![_acc.clone(), _el.clone()], named: Map::new() }; _acc = self.${fnName}_fn(&_s).one(); } _acc } } else { Value::Null } }`;
      }
    }
    // Resolve FnRef to actual function node via ctx.fnDefs
    if (fn.type === 'FnRef' && ctx?.fnDefs) {
      const tracked = ctx.fnDefs.get(fn.name);
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
  if ((expr.type === 'StateVar' || expr.type === 'RefRead' || (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && _rsActorFnNames.has(expr.callee.name))) && targetType && targetType !== 'Value') {
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
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, ctx, indent, rustType(s.typeName))};`);
        } else if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorFnNames.has(s.value.callee.name)) {
          const callExpr = genRustFnCallExpr(s.value, typeEnv);
          const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
        } else {
          let val = genRustExpr(s.value, typeEnv, ctx);
          if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
        }
      } else if (s.type === 'DestructureAssign') {
        if (s.source.type === 'FunctionCallExpr' && s.source.callee?.type === 'Identifier' && _rsActorFnNames.has(s.source.callee.name)) {
          const callExpr = genRustFnCallExpr(s.source, typeEnv);
          const tempName = `_r${_fnTempCounter++}`;
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
          lines.push(`${indent}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${genRustExpr(s.value, typeEnv, ctx)};`);
        } else {
          lines.push(`${indent}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv, ctx)};`);
        }
      } else if (s.type === 'StateAssign') {
        const val = genRustExpr(s.value, typeEnv, ctx);
        const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
        lines.push(`${indent}self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      } else if (s.type === 'SetStatement') {
        const val = genRustExpr(s.value, typeEnv, ctx);
        const t = typeEnv.get(s.name) || inferLiteralType(s.value);
        lines.push(`${indent}${rsStore(s.name)}.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
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
      const accessor = `_s.positional.get(${posIdx}).cloned().unwrap_or(Value::Null)`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      posIdx++;
    } else {
      const key = p.key || p.name;
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(Value::Null)`;
      paramLines.push(`${I}let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
    }
  }

  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, I);
  const retExpr = reply ? genRustFnReturn(reply.fields, typeEnv) : 'Structure::empty()';

  const bodyLines = [];
  if (paramLines.length > 0) bodyLines.push(paramLines.join('\n'));
  if (locals) bodyLines.push(locals);
  bodyLines.push(`${I}${retExpr}`);

  return `    fn ${op}_fn(&mut self, _s: &Structure) -> Structure {\n${bodyLines.join('\n')}\n    }`;
}

function forceJsonWrap(expr) {
  // Always wrap native Rust values into serde_json::Value for Structure fields
  if (expr === 'Value::Null' || expr.startsWith('json!(')) return expr;
  return `json!(${expr})`;
}

function genRustFnReturn(fields, typeEnv) {
  const spread = fields.find(f => f.spread);
  if (spread) return spread.name;

  const pos = fields.filter(f => f.positional);
  const named = fields.filter(f => !f.positional && !f.spread);

  const posVals = pos.map(f => {
    const t = f.type || (f.name ? typeEnv.get(f.name) : null);
    if (f.name) {
      if (f.name && f.name.startsWith('$')) return resolveVarExpr(f.name);
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

function genRustFnCallExpr(expr, typeEnv) {
  const calleeName = expr.callee.name;
  // Self-send: call through handle_op dispatch, return re value
  if (expr.args.length === 0) {
    return `{ let _re = self.self_send("${calleeName}", &Value::Object(Map::new())); Structure::pack(&_re) }`;
  }
  const positionalArgs = expr.args.filter(a => a.type !== 'NamedArgsBag');
  const namedBag = expr.args.find(a => a.type === 'NamedArgsBag');
  // Register lambda args as temporary dispatch handlers
  const argVals = positionalArgs.map(a => {
    if (a.type === 'Function') {
      const lambdaName = `_lambda_${_rsLambdaCounter++}`;
      _rsLambdaHandlers.push({ name: lambdaName, fn: a });
      return `Value::String("${lambdaName}".to_string())`;
    }
    const raw = genRustExpr(a, typeEnv);
    const t = typeEnv.get(a.name);
    if (t === 'Text') return `json!(${raw}.clone())`;
    return `json!(${raw})`;
  });
  if (namedBag && positionalArgs.length === 0) {
    // Named-only args
    const inserts = Object.entries(namedBag.fields).map(([key, val]) => {
      const raw = genRustExpr(val, typeEnv);
      const t = typeEnv.get(val.name);
      if (t === 'Text') return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}.clone()));`;
      return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}));`;
    }).join(' ');
    return `{ let _payload = { let mut m = Map::new(); ${inserts} Value::Object(m) }; let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
  }
  if (namedBag) {
    const inserts = Object.entries(namedBag.fields).map(([key, val]) => {
      const raw = genRustExpr(val, typeEnv);
      const t = typeEnv.get(val.name);
      if (t === 'Text') return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}.clone()));`;
      return `m.insert(${JSON.stringify(key)}.to_string(), json!(${raw}));`;
    }).join(' ');
    return `{ let mut _arr: Vec<Value> = vec![${argVals.join(', ')}]; { let mut m = Map::new(); ${inserts} _arr.push(Value::Object(m)); } let _payload = Value::Array(_arr); let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
  }
  return `{ let _payload = Value::Array(vec![${argVals.join(', ')}]); let _re = self.self_send("${calleeName}", &_payload); Structure::pack(&_re) }`;
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
      // Named param in a mixed public function — use _s.named
      const key = p.key || p.name;
      const accessor = `_s.named.get("${key}").cloned().unwrap_or(Value::Null)`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    } else {
      // Pure named public function — use payload directly (existing behavior)
      const key = p.key || p.name;
      const accessor = `payload.get("${key}").cloned().unwrap_or(Value::Null)`;
      lines.push(`                let ${p.name} = ${convertFromValue(accessor, p.type)};`);
    }
  }
  return lines.join('\n');
}

let _fnTempCounter = 0;

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

function genRustLocals(body, typeEnv, functionAnalysis, mutableVars, indent, fns) {
  const { fnDefs, skipSet, capturePoints } = functionAnalysis;
  const ctx = { childActorRefs: new Map() };
  const lines = [];
  const I = indent || '                ';

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // Emit capture points for fnDefs defined at this index
    if (capturePoints.has(i)) {
      for (const cp of capturePoints.get(i)) {
        lines.push(`${I}let ${cp.capName}: ${cp.rustType} = ${cp.varName};`);
      }
    }

    // Skip statements that are part of the function pipeline
    // But emit recursive fnDefs as actual Rust functions
    if (skipSet.has(i)) {
      if (s.type === 'Assign' || s.type === 'TypedAssign') {
        const tracked = fnDefs.get(s.name);
        if (tracked && tracked.recursive) {
          lines.push(`${I}${genRecursiveFnDef(s.name, tracked.node, typeEnv).split('\n').join('\n' + I)}`);
        } else if (tracked && s.value.type === 'Function') {
          // Only convert to handler if the lambda escapes its scope (returned as a value)
          // Otherwise it will be inlined at call sites by the function pipeline
          const isReturned = body.some(bs => bs.type === 'Reply' && bs.fields.some(f =>
            (f.name === s.name) || (f.expr?.type === 'Identifier' && f.expr.name === s.name)
          ));
          if (isReturned) {
            // Register lambda as a dispatch handler with captured variables
            const lambdaName = `_lambda_${_rsLambdaCounter++}`;
            const fnNode = tracked.node;
            // Find free variables (identifiers used but not defined as params or locals)
            const freeVars = [];
            const paramNames = new Set((fnNode.params || []).map(p => p.name));
            // Collect variables assigned inside the lambda body — these are locals, not captures
            const bodyLocals = new Set();
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') bodyLocals.add(bs.name);
            }
            const localScope = new Set([...paramNames, ...bodyLocals]);
            function walkForIdents(expr) {
              if (!expr) return;
              if (expr.type === 'Identifier' && !localScope.has(expr.name)) freeVars.push(expr.name);
              if (expr.type === 'BinaryExpr') { walkForIdents(expr.left); walkForIdents(expr.right); }
              if (expr.type === 'FunctionCallExpr') {
                if (expr.callee) walkForIdents(expr.callee);
                for (const a of (expr.args || [])) walkForIdents(a);
              }
            }
            if (fnNode.body) for (const bs of fnNode.body) {
              if (bs.type === 'ImplicitReturn') walkForIdents(bs.expr);
              if (bs.type === 'TypedAssign' || bs.type === 'Assign') walkForIdents(bs.value);
              if (bs.expr) walkForIdents(bs.expr);
            }
            if (fnNode.expr) walkForIdents(fnNode.expr);
            // Deduplicate and filter out actor function names (those are self-sends, not captures)
            const uniqueFreeVars = [...new Set(freeVars)].filter(v => !_rsActorFnNames.has(v));
            // Store captures in actor state
            for (const v of uniqueFreeVars) {
              lines.push(`${I}self.state.insert("_cap_${lambdaName}_${v}".to_string(), json!(${rustIdent(v)}));`);
            }
            _rsLambdaHandlers.push({ name: lambdaName, fn: fnNode, captures: uniqueFreeVars.map(v => ({ name: v, lambdaName })) });
            _rsLambdaVarNames.add(s.name);
            lines.push(`${I}let ${rustIdent(s.name)} = Value::String("${lambdaName}".to_string());`);
          }
        }
      }
      continue;
    }

    if (s.type === 'TypedAssign') {
      // as-clause interception
      if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorInfo.has(s.value.callee.name)) {
        const asClause = findRsAsClauseMatch(s.typeName, s.value.callee.name);
        if (asClause) {
          let val = genRustExpr(asClause.expr, typeEnv);
          if (s.typeName === 'Text' && asClause.expr.type === 'StringLiteral') val += '.to_string()';
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
          continue;
        }
        // Non-ref actor instantiation via TypedAssign
        const actorName = s.value.callee.name;
        ctx.childActorRefs.set(s.name, actorName);
        const info = _rsActorInfo.get(actorName);
        if (s.value.args.length > 0) {
          const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
        }
        continue;
      }
      if (s.value.type === 'IfExpr') {
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${genRustIfExpr(s.value, typeEnv, null, I, rustType(s.typeName))};`);
      } else if (s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorFnNames.has(s.value.callee.name)) {
        // Check if any args are function-typed (Function, FnRef) — need fn inlining
        const hasFunctionArgs = s.value.args.some(a =>
          a.type === 'Function' || a.type === 'FnRef');
        const fnDef = hasFunctionArgs && fns ? fns.find(f => f.name === s.value.callee.name) : null;
        if (fnDef && hasFunctionArgs) {
          // Inline the fn body, resolving function params
          const fnParams = fnDef.params || [];
          const fnBody = fnDef.body || [];
          const fnReply = fnBody.find(bs => bs.type === 'Reply');
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const namedBagP = s.value.args.find(a => a.type === 'NamedArgsBag');
          const blockLines = [];
          const fnFunctionParams = new Map();
          let pPosIdx = 0;
          for (const pp of fnParams) {
            let arg;
            if (pp.positional) {
              arg = callArgs[pPosIdx++];
            } else if (namedBagP && namedBagP.fields && (pp.key || pp.name) in namedBagP.fields) {
              arg = namedBagP.fields[pp.key || pp.name];
            }
            if (arg?.type === 'Function') {
              fnFunctionParams.set(pp.name, { kind: 'inline', node: arg });
              continue;
            }
            if (arg?.type === 'FnRef') {
              const resolved = fnDefs.get(arg.name);
              if (resolved) {
                fnFunctionParams.set(pp.name, { kind: 'inline', node: resolved.node });
              } else {
                fnFunctionParams.set(pp.name, { kind: 'method', name: arg.name });
              }
              continue;
            }
            const pt = pp.type || inferLiteralType(arg);
            let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
            if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
            if (pt) {
              blockLines.push(`${I}    let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
            } else {
              blockLines.push(`${I}    let ${rustIdent(pp.name)} = ${argExpr};`);
            }
          }
          // Process fn body statements
          const fnTypeEnv = buildTypeEnv(fnParams, fnBody);
          // Helper to resolve function params in nested expressions
          function genExprResolvingFunctions(expr) {
            if (expr.type === 'FunctionCallExpr') {
              const callee = expr.callee?.name;
              const cp = callee ? fnFunctionParams.get(callee) : null;
              if (cp && cp.kind === 'inline') {
                const func = cp.node;
                const fparams = func.params || [];
                const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
                const bindings = [];
                let fIdx = 0;
                for (const fp of fparams) {
                  const farg = fargs[fIdx++];
                  const fargExpr = farg ? genExprResolvingFunctions(farg) : 'Value::Null';
                  const fpt = fp.type || inferLiteralType(farg);
                  if (fpt) bindings.push(`let ${rustIdent(fp.name)}: ${rustType(fpt)} = ${fargExpr};`);
                  else bindings.push(`let ${rustIdent(fp.name)} = ${fargExpr};`);
                }
                let fret = func.expr;
                if (!fret && func.body) {
                  const ir = func.body.find(st => st.type === 'ImplicitReturn');
                  if (ir) fret = ir.expr;
                }
                const retCode = fret ? genExprResolvingFunctions(fret) : 'Value::Null';
                if (bindings.length > 0) return `{ ${bindings.join(' ')} ${retCode} }`;
                return retCode;
              }
              if (cp && cp.kind === 'method') {
                const fargs = expr.args.filter(a => a.type !== 'NamedArgsBag');
                const argVals = fargs.map(a => forceJsonWrap(genExprResolvingFunctions(a)));
                return `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
              }
            }
            return genRustExpr(expr, fnTypeEnv);
          }
          for (const bs of fnBody) {
            if (bs.type === 'Reply') continue;
            if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
              const innerCallee = bs.value.callee?.name;
              const cp = innerCallee ? fnFunctionParams.get(innerCallee) : null;
              if (cp) {
                if (cp.kind === 'inline') {
                  const innerFunc = cp.node;
                  const innerParams = innerFunc.params || [];
                  const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const innerLines = [];
                  let iiIdx = 0;
                  for (const ip of innerParams) {
                    const iarg = innerArgs[iiIdx++];
                    const itype = ip.type || inferLiteralType(iarg);
                    const iexpr = iarg ? genRustExpr(iarg, fnTypeEnv) : 'Value::Null';
                    if (itype) {
                      innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
                    } else {
                      innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
                    }
                  }
                  let innerRetExprB = innerFunc.expr;
                  if (!innerRetExprB && innerFunc.body) {
                    const implRetB = innerFunc.body.find(st => st.type === 'ImplicitReturn');
                    if (implRetB) innerRetExprB = implRetB.expr;
                  }
                  const innerExpr = innerRetExprB ? genRustExpr(innerRetExprB, fnTypeEnv) : 'Value::Null';
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                  if (innerLines.length > 0) {
                    const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
                    blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerBlock};`);
                  } else {
                    blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${innerExpr};`);
                  }
                } else if (cp.kind === 'method') {
                  const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const argVals = innerArgs.map(a => forceJsonWrap(genRustExpr(a, fnTypeEnv)));
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
                  const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
                  blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rtype ? rustType(rtype) : 'Value'} = ${rtype ? convertFromValue(fnCall, rtype) : fnCall};`);
                }
                continue;
              }
            }
            if (bs.type === 'TypedAssign') {
              blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
            } else if (bs.type === 'Assign') {
              blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, fnTypeEnv)};`);
            }
          }
          // Extract return value from fn reply, using function-aware resolver
          if (fnReply) {
            const retFields = fnReply.fields.filter(f => f.positional);
            if (retFields.length === 1) {
              const rf = retFields[0];
              const rfExpr = rf.expr || (rf.name ? { type: 'Identifier', name: rf.name } : null);
              if (rfExpr) {
                blockLines.push(`${I}    ${genExprResolvingFunctions(rfExpr)}`);
              }
            }
          }
          const block = `{\n${blockLines.join('\n')}\n${I}}`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${block};`);
        } else {
          const callExpr = genRustFnCallExpr(s.value, typeEnv);
          if (s.typeName === 'Structure') {
            lines.push(`${I}let ${rustIdent(s.name)} = ${callExpr};`);
          } else {
            const converted = convertFromValue(`${callExpr}.one()`, s.typeName);
            lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
          }
        }
      } else if (s.typeName === 'Structure') {
        lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
      } else if (s.value.type === 'StructureConstructor') {
        const expr = genRustExpr(s.value, typeEnv);
        const converted = convertFromValue(`${expr}.one()`, s.typeName);
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
      } else if (s.value.type === 'FunctionCallExpr') {
        const calleeName = s.value.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked && tracked.recursive) {
          // Call the generated recursive function directly
          const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
          const argExprs = callArgs.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${rustIdent(calleeName)}(${argExprs});`);
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
              if (lastStmt.type === 'SetStatement') {
                // Set returns the new ref value
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
            const fnParams = new Map();
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
              // Track function args (Function literal, FnRef)
              if (arg?.type === 'Function') {
                fnParams.set(param.name, { kind: 'inline', node: arg });
                continue;
              }
              if (arg?.type === 'FnRef') {
                if (_rsActorFnNames.has(arg.name)) {
                  fnParams.set(param.name, { kind: 'method', name: arg.name });
                } else {
                  const resolved = fnDefs.get(arg.name);
                  if (resolved) {
                    fnParams.set(param.name, { kind: 'inline', node: resolved.node });
                  } else {
                    fnParams.set(param.name, { kind: 'method', name: arg.name });
                  }
                }
                continue;
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

            // Track nested function definitions within inlined body
            const innerFnDefs = new Map();
            for (const bs of bodyStmts) {
              if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
                innerFnDefs.set(bs.name, bs.value);
              }
            }

            // Emit body statements (excluding ImplicitReturn/Return)
            for (const bs of bodyStmts) {
              // Skip nested function definitions — they'll be inlined at call sites
              if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function' && innerFnDefs.has(bs.name)) {
                continue;
              }
              // Handle calls to nested function definitions
              if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
                const innerCallee = bs.value.callee?.name;
                const innerFn = innerCallee ? innerFnDefs.get(innerCallee) : null;
                if (innerFn) {
                  // Inline the nested function
                  const nfParams = innerFn.params || [];
                  const nfArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                  const nfLines = [];
                  let nfPosIdx = 0;
                  for (const np of nfParams) {
                    const narg = nfArgs[nfPosIdx++];
                    const ntype = np.type || inferLiteralType(narg) || (narg?.type === 'Identifier' ? typeEnv.get(narg.name) : null);
                    const nexpr = narg ? genRustExpr(narg, typeEnv) : 'Value::Null';
                    if (ntype) {
                      nfLines.push(`${I}        let ${rustIdent(np.name)}: ${rustType(ntype)} = ${nexpr};`);
                    } else {
                      nfLines.push(`${I}        let ${rustIdent(np.name)} = ${nexpr};`);
                    }
                  }
                  let nfRetExpr = innerFn.expr;
                  if (!nfRetExpr && innerFn.body) {
                    const implRetN = innerFn.body.find(st => st.type === 'ImplicitReturn');
                    if (implRetN) nfRetExpr = implRetN.expr;
                  }
                  const nfExpr = nfRetExpr ? genRustExpr(nfRetExpr, typeEnv) : 'Value::Null';
                  const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                  if (nfLines.length > 0) {
                    const nfBlock = `{\n${nfLines.join('\n')}\n${I}        ${nfExpr}\n${I}    }`;
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfBlock};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfBlock};`);
                    }
                  } else {
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${nfExpr};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${nfExpr};`);
                    }
                  }
                  continue;
                }
              }
              // Handle function param calls: f(n) where f is a function arg
              if ((bs.type === 'TypedAssign' || bs.type === 'Assign') && bs.value.type === 'FunctionCallExpr') {
                const innerCallee = bs.value.callee?.name;
                const cp = innerCallee ? fnParams.get(innerCallee) : null;
                if (cp) {
                  if (cp.kind === 'inline') {
                    // Inline the function
                    const innerFunc = cp.node;
                    const innerParams = innerFunc.params || [];
                    const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                    const innerLines = [];
                    let iposIdx = 0;
                    for (const ip of innerParams) {
                      const iarg = innerArgs[iposIdx++];
                      const itype = ip.type || inferLiteralType(iarg) || (iarg?.type === 'Identifier' ? typeEnv.get(iarg.name) : null);
                      const iexpr = iarg ? genRustExpr(iarg, typeEnv) : 'Value::Null';
                      if (itype) {
                        innerLines.push(`${I}        let ${rustIdent(ip.name)}: ${rustType(itype)} = ${iexpr};`);
                      } else {
                        innerLines.push(`${I}        let ${rustIdent(ip.name)} = ${iexpr};`);
                      }
                    }
                    let innerRetExprH = innerFunc.expr;
                    if (!innerRetExprH && innerFunc.body) {
                      const implRetH = innerFunc.body.find(st => st.type === 'ImplicitReturn');
                      if (implRetH) innerRetExprH = implRetH.expr;
                    }
                    const innerExpr = innerRetExprH ? genRustExpr(innerRetExprH, typeEnv) : 'Value::Null';
                    const rtype = bs.type === 'TypedAssign' ? bs.typeName : inferLiteralType(bs.value);
                    if (innerLines.length > 0) {
                      const innerBlock = `{\n${innerLines.join('\n')}\n${I}        ${innerExpr}\n${I}    }`;
                      if (rtype) {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerBlock};`);
                      } else {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerBlock};`);
                      }
                    } else {
                      if (rtype) {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${innerExpr};`);
                      } else {
                        blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${innerExpr};`);
                      }
                    }
                  } else if (cp.kind === 'method') {
                    // Call the actor fn
                    const innerArgs = bs.value.args.filter(a => a.type !== 'NamedArgsBag');
                    const argVals = innerArgs.map(a => {
                      const raw = genRustExpr(a, typeEnv);
                      const t = a.type === 'Identifier' ? typeEnv.get(a.name) : inferLiteralType(a);
                      return forceJsonWrap(toJsonValue(raw, t));
                    });
                    const rtype = bs.type === 'TypedAssign' ? bs.typeName : null;
                    const fnCall = `self.${cp.name}_fn(&Structure { positional: vec![${argVals.join(', ')}], named: Map::new() }).one()`;
                    if (rtype) {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)}: ${rustType(rtype)} = ${convertFromValue(fnCall, rtype)};`);
                    } else {
                      blockLines.push(`${I}    let ${rustIdent(bs.name)} = ${fnCall};`);
                    }
                  }
                  continue;
                }
              }
              if (bs.type === 'TypedAssign') {
                const bsVal = substituteCaptures(bs.value, tracked.captures);
                if (bs.typeName === 'Structure' && bsVal.type === 'FunctionCallExpr') {
                  blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bsVal, typeEnv)};`);
                } else {
                  blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bsVal, typeEnv)};`);
                }
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
              } else if (bs.type === 'SetStatement') {
                const bsVal = genRustExpr(bs.value, typeEnv);
                const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
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
              const retStructExpr = genRustFnReturn(returnNode.fields, typeEnv);
              if (s.typeName === 'Structure') {
                blockLines.push(`${I}    ${retStructExpr}`);
                lines.push(`${I}let ${rustIdent(s.name)} = {\n${blockLines.join('\n')}\n${I}};`);
              } else {
                const converted = convertFromValue(`${retStructExpr}.one()`, s.typeName);
                blockLines.push(`${I}    ${converted}`);
                lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
              }
            } else if (hasBlockContent) {
              // Return expression as block value
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              blockLines.push(`${I}    ${converted}`);
              lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = {\n${blockLines.join('\n')}\n${I}};`);
            } else {
              // No params, no body — simple inline
              const substituted = substituteCaptures(innerExpr, tracked.captures);
              const valExpr = genRustExpr(substituted, typeEnv);
              const converted = convertFromValue(`json!(${valExpr})`, s.typeName);
              lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${converted};`);
            }
          }
        } else {
          const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
          let val = genRustExpr(s.value, typeEnv, exprCtx);
          const isIterExpr = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
          const isFnCall = s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier';
          const calleeFnTyped = isFnCall && (() => {
            const ct = typeEnv.get(s.value.callee.name);
            return ct && (ct === 'Function' || (typeof ct === 'string' && ct.includes('->')));
          })();
          if (isIterExpr && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if (calleeFnTyped && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
            val = convertFromValue(val, s.typeName);
          } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (!isIterExpr && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
        }
      } else {
        const exprCtx = (s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr') ? { fnDefs } : undefined;
        let val = genRustExpr(s.value, typeEnv, exprCtx);
        const isIterExpr2 = s.value.type === 'OverExpr' || s.value.type === 'ReduceExpr';
        if (isIterExpr2 && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if ((s.value.type === 'StateVar' || s.value.type === 'RefRead') && s.typeName && rustType(s.typeName) !== 'Value') {
          val = convertFromValue(val, s.typeName);
        } else if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
        if (!isIterExpr2 && s.typeName && s.typeName.includes('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
      }
    } else if (s.type === 'DestructureAssign') {
      if (s.source.type === 'FunctionCallExpr') {
        // Inline function and destructure the result
        const calleeName = s.source.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
        if (tracked) {
          const funcNode = tracked.node;
          const funcParams = funcNode.params || [];
          const callArgs = s.source.args.filter(a => a.type !== 'NamedArgsBag');
          const namedArgsBagD = s.source.args.find(a => a.type === 'NamedArgsBag');
          const fnBodyStmts = funcNode.body ? funcNode.body.filter(st => st.type !== 'ImplicitReturn' && st.type !== 'Return') : [];
          const fnReturnNode = funcNode.body ? funcNode.body.find(st => st.type === 'Return') : null;
          const fnImplRet = funcNode.body ? funcNode.body.find(st => st.type === 'ImplicitReturn') : null;

          const tempName = `_fr${_fnTempCounter++}`;
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
              if (bs.typeName === 'Structure' && bs.value.type === 'FunctionCallExpr') {
                blockLines.push(`${I}    let ${bs.name} = ${genRustFnCallExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(bs.typeName)} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'Assign') {
              const knownType = inferLiteralType(bs.value);
              if (knownType) {
                blockLines.push(`${I}    let ${bs.name}: ${rustType(knownType)} = ${genRustExpr(bs.value, typeEnv)};`);
              } else {
                blockLines.push(`${I}    let ${bs.name} = ${genRustExpr(bs.value, typeEnv)};`);
              }
            } else if (bs.type === 'SetStatement') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    ${rsStore(bs.name)}.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'StateAssign') {
              const bsVal = genRustExpr(bs.value, typeEnv);
              const t = typeEnv.get('$' + bs.name) || inferLiteralType(bs.value);
              blockLines.push(`${I}    self.state.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
            } else if (bs.type === 'WhileStatement') {
              blockLines.push(genRustWhileStatement(bs, typeEnv, `${I}    `));
            }
          }
          if (fnReturnNode) {
            blockLines.push(`${I}    ${genRustFnReturn(fnReturnNode.fields, typeEnv)}`);
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
        } else if (calleeName && _rsActorFnNames.has(calleeName)) {
          const tempName = `_r${_fnTempCounter++}`;
          const callExpr = genRustFnCallExpr(s.source, typeEnv);
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
        }
      } else if (s.source.type === 'DotCallExpr') {
        const expr = s.source;
        const isChild = (expr.object.type === 'FunctionCallExpr' && expr.object.callee?.type === 'Identifier' && _rsActorInfo.has(expr.object.callee.name)) ||
                        (expr.object.type === 'RefRead' && ctx?.childActorRefs?.has(expr.object.name)) ||
                        (expr.object.type === 'Identifier' && ctx?.childActorRefs?.has(expr.object.name));
        if (isChild) {
          // Child actor dispatch — call local method directly
          let actorName;
          if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
            actorName = ctx.childActorRefs.get(expr.object.name);
          } else {
            actorName = expr.object.callee.name;
          }
          const info = _rsActorInfo.get(actorName);
          if (expr.object.type === 'FunctionCallExpr' && expr.object.args.length > 0) {
            const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
            lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
          }
          const method = JSON.stringify('@' + expr.method);
          // Build payload from method args
          const positional = expr.args.filter(a => a.positional);
          const named = expr.args.filter(a => !a.positional);
          let payload;
          if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
            const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
            payload = `json!([${posVals}, {${namedEntries}}])`;
          } else if (positional.length > 0) {
            const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
            payload = `json!([${posVals}])`;
          } else if (named.length > 0) {
            const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
            payload = `json!({${namedEntries}})`;
          } else {
            payload = 'json!({})';
          }
          const tempName = `_dc${_fnTempCounter++}`;
          lines.push(`${I}let ${tempName} = self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload});`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${item.name} = ${accessor};`);
            }
          }
        } else {
          // External DotCallExpr await: send outgoing message, then await response on stdin
          const dotObjName = expr.object.type === 'RefRead' ? expr.object.name : (expr.object.type === 'Identifier' ? expr.object.name : null);
          // Check for wrapped child dispatch
          const isWrappedChildD = dotObjName && _rsStateVarNames.has(dotObjName) && (_rsStateVarDecls?.find(d => d.name === dotObjName)?.typeName === 'Anything' || (expr.object.type === 'Identifier' && !_rsActorInfo.has(dotObjName) && !_rsRemoteInstanceVars.has(dotObjName)));
          if (isWrappedChildD) {
            const childRef = `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string()`;
            const method = JSON.stringify('@' + expr.method);
            const named = expr.args.filter(a => !a.positional);
            const positional = expr.args.filter(a => a.positional);
            const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv) : rustIdent(a.name);
            let payload;
            if (positional.length === 0 && named.length === 0) {
              payload = 'json!({})';
            } else if (named.length > 0) {
              const fields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
              payload = `json!({${fields}})`;
            } else {
              const vals = positional.map(genArgVal).join(', ');
              payload = `json!([${vals}])`;
            }
            const tempName = `_dc${_fnTempCounter++}`;
            lines.push(`${I}let _cn = ${childRef};`);
            lines.push(`${I}let ${tempName} = self.child_dispatch(&_cn, ${method}, &${payload});`);
            for (const item of s.pattern) {
              if (item.discard) continue;
              const key = item.key || item.name;
              const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
              if (item.type) {
                lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
              } else {
                lines.push(`${I}let ${item.name} = ${accessor};`);
              }
            }
          } else {
          const isRemoteInst = dotObjName && _rsRemoteInstanceVars.has(dotObjName);
          const named = expr.args.filter(a => !a.positional);
          const to = isRemoteInst
            ? `self.state.get("${dotObjName}").and_then(|v| v.as_str()).unwrap_or("").to_string().to_string()`
            : `${JSON.stringify(expr.object.name)}.to_string()`;
          const method = isRemoteInst ? JSON.stringify(expr.method) : JSON.stringify('@' + expr.method);
          const positional = expr.args.filter(a => a.positional);
          const genArgVal = a => a.expr ? genRustExpr(a.expr, typeEnv) : genRustExpr({ type: 'Identifier', name: a.name }, typeEnv);
          let opJson;
          if (positional.length === 0 && named.length === 0) {
            opJson = `json!(${method})`;
          } else if (positional.length > 0 && named.length > 0) {
            const posVals = positional.map(genArgVal).join(', ');
            const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
            opJson = `json!([${posVals}, {${namedFields}}, ${method}])`;
          } else if (named.length > 0) {
            const namedFields = named.map(a => `"${a.name}": ${genArgVal(a)}`).join(', ');
            opJson = `json!([{${namedFields}}, ${method}])`;
          } else {
            const posVals = positional.map(genArgVal).join(', ');
            opJson = `json!([[${posVals}], ${method}])`;
          }
          const tempName = `_dc${_fnTempCounter++}`;
          lines.push(`${I}let ${tempName}_id = {`);
          lines.push(`${I}    let seq = self.send_seq.get();`);
          lines.push(`${I}    self.send_seq.set(seq + 1);`);
          lines.push(`${I}    let send_id = seq.to_string();`);
          lines.push(`${I}    let mut send_msg = Map::new();`);
          lines.push(`${I}    send_msg.insert("id".to_string(), json!(send_id.clone()));`);
          lines.push(`${I}    send_msg.insert("op".to_string(), ${opJson});`);
          lines.push(`${I}    send_msg.insert("to".to_string(), json!(${to}));`);
          if (!isRemoteInst && (positional.length > 0 || named.length > 0)) {
            let bvaJson;
            if (positional.length > 0 && named.length > 0) {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([${posBva}, {${namedBva}}])`;
            } else if (named.length > 0) {
              const namedBva = named.map(a => `"${a.name}": ${a.typeName ? `"${a.typeName}"` : 'null'}`).join(', ');
              bvaJson = `json!([{${namedBva}}])`;
            } else {
              const posBva = positional.map(a => a.typeName ? `"${a.typeName}"` : 'null').join(', ');
              bvaJson = `json!([[${posBva}]])`;
            }
            lines.push(`${I}    send_msg.insert("bv-a".to_string(), ${bvaJson});`);
          }
          lines.push(`${I}    let _ = self.binding.send(Value::Object(send_msg));`);
          lines.push(`${I}    send_id`);
          lines.push(`${I}};`);
          lines.push(`${I}let ${tempName} = self.await_response(&${tempName}_id);`);
          // Destructure the response
          for (const item of s.pattern) {
            if (item.discard) continue;
            const key = item.key || item.name;
            const accessor = `${tempName}.get("${key}").cloned().unwrap_or(Value::Null)`;
            if (item.type) {
              lines.push(`${I}let ${item.name}: ${rustType(item.type)} = ${convertFromValue(accessor, item.type)};`);
            } else {
              lines.push(`${I}let ${item.name} = ${accessor};`);
            }
          }
          } // close isWrappedChildD else
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
    } else if (s.type === 'Assign' && s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorInfo.has(s.value.callee.name)) {
      // Non-ref actor instantiation — assign actor name string
      const actorName = s.value.callee.name;
      ctx.childActorRefs.set(s.name, actorName);
      const childActor = _rsActorInfo.get(actorName)?.actor;
      const hasInit = (childActor?.initParams?.length > 0) || (childActor?.initBody?.length > 0) || s.value.args.length > 0;
      if (hasInit) {
        const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
        lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
      }
      lines.push(`${I}let ${rustIdent(s.name)} = Value::String("${actorName.toLowerCase()}".to_string());`);
    } else if (s.type === 'Assign' && s.value.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorFnNames.has(s.value.callee.name)) {
      const fnDef = fns ? fns.find(f => f.name === s.value.callee.name) : null;
      if (fnDef && fnReturnsFunction(fnDef)) {
        // Inline fn body at call site, tracking returned function
        const fnParams = fnDef.params || [];
        const fnBody = fnDef.body || [];
        const fnReply = fnBody.find(bs => bs.type === 'Reply');
        const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');

        // Bind fn params at current scope
        let pPosIdx = 0;
        for (const pp of fnParams) {
          const arg = pp.positional ? callArgs[pPosIdx++] : null;
          const pt = pp.type || inferLiteralType(arg);
          let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
          if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
          lines.push(`${I}let ${rustIdent(pp.name)}: ${rustType(pt)} = ${argExpr};`);
        }

        // Process fn body: emit non-function statements, track function literals
        const fnLocalFunctions = new Map();
        for (const bs of fnBody) {
          if (bs.type === 'Reply') continue;
          if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
            fnLocalFunctions.set(bs.name, { node: bs.value, defIdx: i });
          } else if (bs.type === 'TypedAssign') {
            let val = genRustExpr(bs.value, typeEnv);
            if (bs.typeName === 'Text' && bs.value.type === 'StringLiteral') val += '.to_string()';
            lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
          } else if (bs.type === 'Assign') {
            lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
          }
        }

        // Find the returned function from Reply and register it under the call-site name
        if (fnReply) {
          const retField = fnReply.fields.find(f =>
            f.type === 'Function' || (typeof f.type === 'string' && f.type?.includes('->')));
          if (retField) {
            const retFunction = fnLocalFunctions.get(retField.name);
            if (retFunction) {
              fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
            }
          }
        }
      } else {
        // Normal function call through Structure
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          const callExpr = genRustFnCallExpr(s.value, typeEnv);
          const converted = convertFromValue(`${callExpr}.one()`, knownType);
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${converted};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)} = ${genRustFnCallExpr(s.value, typeEnv)};`);
        }
      }
    } else if (s.type === 'Assign' && s.value.type === 'FunctionCallExpr') {
      const calleeName = s.value.callee?.name;
      const tracked = calleeName ? fnDefs.get(calleeName) : null;
      if (tracked && (tracked.node.returnType === 'Function' || (typeof tracked.node.returnType === 'string' && tracked.node.returnType?.includes('->')))) {
        // Function-returning function: inline body at outer scope, track returned function
        const funcNode = tracked.node;
        const funcParams = funcNode.params || [];
        const callArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
        const funcBody = funcNode.body || [];

        // Bind function params at current scope
        let posIdx = 0;
        for (const param of funcParams) {
          const arg = param.positional ? callArgs[posIdx++] : null;
          const pt = param.type || inferLiteralType(arg);
          let argExpr = arg ? genRustExpr(arg, typeEnv) : 'Value::Null';
          if (pt === 'Text' && arg?.type === 'StringLiteral') argExpr += '.to_string()';
          lines.push(`${I}let ${rustIdent(param.name)}: ${rustType(pt)} = ${argExpr};`);
        }

        // Process body: emit non-function statements, track function literals
        const localFnDefs = new Map();
        for (const bs of funcBody) {
          if (bs.type === 'ImplicitReturn') continue;
          if ((bs.type === 'Assign' || bs.type === 'TypedAssign') && bs.value.type === 'Function') {
            localFnDefs.set(bs.name, { node: bs.value, defIdx: i });
          } else if (bs.type === 'TypedAssign') {
            let val = genRustExpr(bs.value, typeEnv);
            if (bs.typeName === 'Text' && bs.value.type === 'StringLiteral') val += '.to_string()';
            lines.push(`${I}let ${rustIdent(bs.name)}: ${rustType(bs.typeName)} = ${val};`);
          } else if (bs.type === 'Assign') {
            lines.push(`${I}let ${rustIdent(bs.name)} = ${genRustExpr(bs.value, typeEnv)};`);
          }
        }

        // Find returned function from ImplicitReturn
        const implRet = funcBody.find(bs => bs.type === 'ImplicitReturn');
        if (implRet && implRet.expr?.type === 'Identifier') {
          const retFunction = localFnDefs.get(implRet.expr.name);
          if (retFunction) {
            fnDefs.set(s.name, { node: retFunction.node, defIdx: i });
          }
        }
      } else {
        // Normal function call in Assign
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          let val = genRustExpr(s.value, typeEnv);
          if (knownType === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${val};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv)};`);
        }
      }
    } else if ((s.type === 'Assign' || s.type === 'TypedAssign') && s.value?.type === 'DotCallExpr' && (
      (s.value.object.type === 'FunctionCallExpr' && s.value.object.callee?.type === 'Identifier' && _rsActorInfo.has(s.value.object.callee.name)) ||
      (s.value.object.type === 'RefRead' && ctx.childActorRefs.has(s.value.object.name)) ||
      (s.value.object.type === 'Identifier' && ctx.childActorRefs.has(s.value.object.name))
    )) {
      // Assign from child actor DotCallExpr — call child dispatch, extract single value
      const expr = s.value;
      let actorName;
      if (expr.object.type === 'RefRead' || expr.object.type === 'Identifier') {
        actorName = ctx.childActorRefs.get(expr.object.name);
      } else {
        actorName = expr.object.callee.name;
        const info = _rsActorInfo.get(actorName);
        if (expr.object.args.length > 0) {
          const initArgs = expr.object.args.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
        }
      }
      const method = JSON.stringify('@' + expr.method);
      const positional = expr.args.filter(a => a.positional);
      const named = expr.args.filter(a => !a.positional);
      let payload;
      if (positional.length > 0 && named.length > 0) {
        const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
        const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
        payload = `json!([${posVals}, {${namedEntries}}])`;
      } else if (positional.length > 0) {
        const posVals = positional.map(a => genRustExpr(a.expr, typeEnv)).join(', ');
        payload = `json!([${posVals}])`;
      } else if (named.length > 0) {
        const namedEntries = named.map(a => `"${a.name}": ${genRustExpr(a.expr || { type: 'Identifier', name: a.name }, typeEnv)}`).join(', ');
        payload = `json!({${namedEntries}})`;
      } else {
        payload = 'json!({})';
      }
      const childCall = `self.child_${actorName.toLowerCase()}_dispatch(${method}, &${payload})`;
      const knownType = typeEnv.get(s.name);
      if (knownType) {
        // Extract single value: child dispatch returns a json object, use Structure to extract the one value
        const accessor = `{ let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() }`;
        lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${convertFromValue(accessor, knownType)};`);
      } else {
        // Untyped: extract single positional value
        lines.push(`${I}let ${rustIdent(s.name)} = { let _cr = ${childCall}; let _cs = Structure::pack(&_cr); _cs.one() };`);
      }
    } else if (s.type === 'Assign') {
      const isStructLiteral = s.value.type === 'StructureLiteral' || s.value.type === 'StructureConstructor';
      if (isStructLiteral) {
        lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
      } else {
        // Use known type from typeEnv for proper Rust type
        const knownType = typeEnv.get(s.name);
        if (knownType) {
          let val = genRustExpr(s.value, typeEnv);
          if (knownType === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
          if (knownType && knownType.includes?.('|') && s.value.type !== 'NullLiteral' && s.value.type !== 'IfExpr') val = `json!(${val})`;
          lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(knownType)} = ${val};`);
        } else {
          lines.push(`${I}let ${rustIdent(s.name)}: Value = ${genRustExpr(s.value, typeEnv)};`);
        }
      }
    } else if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get('$' + s.name) || inferLiteralType(s.value);
      lines.push(`${I}self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'WhileStatement') {
      lines.push(genRustWhileStatement(s, typeEnv, I));
    } else if (s.type === 'RefDecl') {
      if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsActorInfo.has(s.value.callee.name)) {
        // Child actor ref — track mapping, call init if needed
        ctx.childActorRefs.set(s.name, s.value.callee.name);
        const actorName = s.value.callee.name;
        const info = _rsActorInfo.get(actorName);
        if (s.value.args.length > 0) {
          const initArgs = s.value.args.map(a => genRustExpr(a, typeEnv)).join(', ');
          lines.push(`${I}self.child_${actorName.toLowerCase()}_init(&json!([${initArgs}]));`);
        }
      } else {
        const val = s.value ? genRustExpr(s.value, typeEnv) : 'Value::Null';
        const t = s.typeName || inferLiteralType(s.value);
        lines.push(`${I}${rsStore(s.name)}.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    } else if (s.type === 'SetStatement') {
      if (ctx.childActorRefs && ctx.childActorRefs.has(s.name)) {
        const actorName = ctx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const val = genRustExpr(s.value, typeEnv);
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${val}]));`);
      } else if (s.value?.type === 'Function') {
        // Lambda assignment to state/ref var — register handler, store label
        const lambdaName = `_lambda_${_rsLambdaCounter++}`;
        _rsLambdaHandlers.push({ name: lambdaName, fn: s.value });
        lines.push(`${I}${rsStore(s.name)}.insert("${s.name}".to_string(), json!("${lambdaName}"));`);
      } else {
        const val = genRustExpr(s.value, typeEnv);
        const t = typeEnv.get(s.name) || inferLiteralType(s.value);
        lines.push(`${I}${rsStore(s.name)}.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
      }
    } else if (s.type === 'ActorSetStatement') {
      if (ctx.childActorRefs && ctx.childActorRefs.has(s.name)) {
        const actorName = ctx.childActorRefs.get(s.name);
        const wireOp = s.updateOp === '<|' ? '::update' : '::set';
        const posArgs = s.args.filter(a => a.positional).map(a => genRustExpr(a.expr, typeEnv));
        const namedArgs = s.args.filter(a => !a.positional);
        let payload;
        if (namedArgs.length > 0) {
          const namedObj = namedArgs.map(a => `"${a.name}": ${genRustExpr(a.expr, typeEnv)}`).join(', ');
          if (posArgs.length > 0) {
            payload = `[${posArgs.join(', ')}, {${namedObj}}]`;
          } else {
            payload = `{${namedObj}}`;
          }
        } else {
          payload = `[${posArgs.join(', ')}]`;
        }
        lines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!(${payload}));`);
      }
    } else if (s.type === 'ListDestructure') {
      lines.push(genRustListDestructure(s, typeEnv, I));
    } else if (s.type === 'IfStatement') {
      const cond = genRustCondition(s.cond, typeEnv);
      const bodyLines = [];
      for (const bs of s.body) {
        if (bs.type === 'SetStatement') {
          if (ctx.childActorRefs && ctx.childActorRefs.has(bs.name)) {
            const actorName = ctx.childActorRefs.get(bs.name);
            const wireOp = bs.updateOp === '<|' ? '::update' : '::set';
            const val = genRustExpr(bs.value, typeEnv);
            bodyLines.push(`${I}    self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${val}]));`);
          } else {
            const val = genRustExpr(bs.value, typeEnv);
            const t = typeEnv.get(bs.name) || inferLiteralType(bs.value);
            bodyLines.push(`${I}    ${rsStore(bs.name)}.insert("${bs.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
          }
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
      if (s.call.type === 'FunctionCallExpr' && s.call.callee?.type === 'Identifier' && _rsActorFnNames.has(s.call.callee.name)) {
        const callExpr = genRustFnCallExpr(s.call, typeEnv);
        lines.push(`${I}let _ = ${callExpr};`);
      } else if (s.call.type === 'DotCallExpr') {
        lines.push(`${I}${genRustExpr(s.call, typeEnv)};`);
      }
    } else if (s.type === 'ExprStatement') {
      if (s.expr.type === 'IfExpr') {
        lines.push(genRustIfStatement(s.expr, typeEnv, I));
      } else if (s.expr.type === 'FunctionCallExpr') {
        // Inline function for side effects
        const calleeName = s.expr.callee?.name;
        const tracked = calleeName ? fnDefs.get(calleeName) : null;
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
              const refReadExpr = `${rsStore(arg.name)}.get("${arg.name}").cloned().unwrap_or(Value::Null)`;
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
            if (bs.type === 'SetStatement') {
              if (ctx.childActorRefs && ctx.childActorRefs.has(bs.name)) {
                const actorName = ctx.childActorRefs.get(bs.name);
                const wireOp = bs.updateOp === '<|' ? '::update' : '::set';
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                blockLines.push(`${I}self.child_${actorName.toLowerCase()}_dispatch("${wireOp}", &json!([${bsVal}]));`);
              } else {
                const refName = refParamMap.get(bs.name) || bs.name;
                const rewritten = rewriteRefReads(bs.value);
                const bsVal = genRustExpr(rewritten, typeEnv);
                const t = typeEnv.get(refName) || typeEnv.get(bs.name) || inferLiteralType(bs.value);
                blockLines.push(`${I}${rsStore(refName)}.insert("${refName}".to_string(), ${forceJsonWrap(toJsonValue(bsVal, t))});`);
              }
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
    } else if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}    ${rsStore(s.name)}.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    } else if (s.type === 'TypedAssign') {
      let val = genRustExpr(s.value, typeEnv);
      if (s.typeName === 'Text' && s.value.type === 'StringLiteral') val += '.to_string()';
      lines.push(`${I}    let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}    let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
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
  const tempBase = `_ld${_fnTempCounter++}`;
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
    if (s.type === 'SetStatement') {
      const val = genRustExpr(s.value, typeEnv);
      const t = typeEnv.get(s.name) || inferLiteralType(s.value);
      lines.push(`${I}${rsStore(s.name)}.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
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
      lines.push(`${I}let ${rustIdent(s.name)}: ${rustType(s.typeName)} = ${val};`);
    } else if (s.type === 'Assign') {
      lines.push(`${I}let ${rustIdent(s.name)} = ${genRustExpr(s.value, typeEnv)};`);
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
    if (_rsStateVarNames.has(name)) return `self.state.get("${name}").cloned().unwrap_or(Value::Null)`;
    if (refNames.has(name)) return `self.refs.get("${name}").cloned().unwrap_or(Value::Null)`;
    return null;
  }

  function reFieldVal(f) {
    if (f.name) {
      const resolved = resolveFieldName(f.name);
      if (resolved) return resolved;
      const t = f.type || typeEnv.get(f.name);
      return toJsonValue(rustIdent(f.name), t);
    }
    if (f._precomputed) return f._precomputed;
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
      const resolved = _rsStateVarNames.has(varName) ? `self.state.get("${varName}").cloned().unwrap_or(Value::Null)` : (refNames.has(varName) ? `self.refs.get("${varName}").cloned().unwrap_or(Value::Null)` : varName);
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

function genRustPublicFn({ name, params, body: rawBody }, fns) {
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement promotion
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    const isSilentEmit = lastExpr.type === 'FunctionCallExpr' && lastExpr.callee?.type === 'Identifier' && _rsEmitNames.has(lastExpr.callee.name) && _rsEmitNames.get(lastExpr.callee.name).silent;
    if (!isSilentEmit) {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }
  const typeEnv = buildTypeEnv(params, body);
  // Merge state var types for function-typed state var detection
  for (const n of _rsStateVarNames) {
    const decl = _rsStateVarDecls?.find(d => d.name === n);
    if (decl?.typeName) typeEnv.set(n, decl.typeName);
  }
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const isListOfAny = t => t === 'List of Anything' || t === 'List';
  const typedParams = params.filter(p => p.type && !p.rest && !isListOfAny(p.type));
  const positionalTyped = typedParams.filter(p => p.positional);
  const namedTyped = typedParams.filter(p => !p.positional);
  let guard = '';
  if (positionalTyped.length > 0) {
    const posTypes = positionalTyped.map(p => `"${p.type}"`).join(', ');
    const namedTypes = namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ');
    guard = ` if from == "__self" || from == "__test" || match_types_positional(message, &[${posTypes}], &[${namedTypes}])`;
  } else if (namedTyped.length > 0) {
    guard = ` if from == "__self" || from == "__test" || match_types(message, &[${namedTyped.map(p => `("${p.key || p.name}", "${p.type}")`).join(', ')}])`;
  }

  const lines = [];

  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);

  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars, undefined, fns);
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
      // Pre-compute function-typed param calls to avoid block expressions inside json!
      const isFnType = t => t && (t === 'Function' || (typeof t === 'string' && t.includes('->')));
      let precomputeIdx = 0;
      for (const f of reply.fields) {
        if (f.expr?.type === 'FunctionCallExpr' && f.expr.callee?.type === 'Identifier') {
          const calleeTy = typeEnv.get(f.expr.callee.name);
          if (isFnType(calleeTy)) {
            const tmpVar = `_fncall_${precomputeIdx++}`;
            const callExpr = genRustExpr(f.expr, typeEnv);
            lines.push(`                let ${tmpVar} = ${callExpr};`);
            f._precomputed = tmpVar;
          }
        }
      }
      lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
      const bva = genRustBvaBody(reply.fields, typeEnv, refNames);
      if (bva) {
        lines.push(`                bva_re = Some(${bva});`);
      }
    }
  } else if (implicitReturn) {
    const raw = genRustExpr(implicitReturn.expr, typeEnv);
    const needsTmp = implicitReturn.expr.type === 'FunctionCallExpr' || implicitReturn.expr.type === 'DotCallExpr';
    if (needsTmp) {
      lines.push(`                let _impl_ret = ${raw};`);
      lines.push(`                re = Some(json!([_impl_ret]));`);
    } else {
      lines.push(`                re = Some(json!([${forceJsonWrap(raw)}]));`);
    }
  }
  lines.push('                handled = true;');

  return `            "${name}"${guard} => {\n${lines.join('\n')}\n            }`;
}

function genRustDispatch(publicFns, privateFns, preInitLambdas = []) {
  // Reset lambda state for this dispatch
  _rsLambdaCounter = 0;
  _rsLambdaHandlers = [];
  _rsLambdaVarNames = new Set();

  // Pre-register init body lambdas so they get handler arms
  for (const pil of preInitLambdas) {
    _rsLambdaHandlers.push({ name: pil.lambdaName, fn: pil.fn });
  }

  const allFns = [...publicFns, ...privateFns];
  const arms = allFns.map(h => genRustPublicFn(h, privateFns));

  // Add lambda handler arms (registered during call site codegen + pre-init)
  for (const lh of _rsLambdaHandlers) {
    const { name, fn: fnNode, captures } = lh;
    const params = fnNode.params || [];
    const lambdaLines = [];

    // Load captured variables from actor state
    if (captures && captures.length > 0) {
      for (const cap of captures) {
        const capKey = `_cap_${cap.lambdaName}_${cap.name}`;
        lambdaLines.push(`                let ${rustIdent(cap.name)} = self.state.get("${capKey}").cloned().unwrap_or(Value::Null).as_i64().unwrap_or(0);`);
      }
    }

    // Destructure params from _s
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      const accessor = `_s.positional.get(${i}).cloned().unwrap_or(Value::Null)`;
      if (p.type) {
        lambdaLines.push(`                let ${rustIdent(p.name)}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
      } else {
        lambdaLines.push(`                let ${rustIdent(p.name)} = ${accessor};`);
      }
    }

    // Generate body — use full body codegen for multi-statement lambdas
    const capTypeEnv = new Map([
      ...params.map(p => [p.name, p.type]),
      ...(captures || []).map(c => [c.name, 'Integer']),
    ]);
    if (fnNode.body && fnNode.body.length > 0) {
      const reply = fnNode.body.find(s => s.type === 'Reply');
      const mutableVars = findMutableVars(fnNode.body);
      const functionAnalysis = analyzeFunctions(fnNode.body, mutableVars, capTypeEnv);
      const locals = genRustLocals(fnNode.body, capTypeEnv, functionAnalysis, mutableVars, '                ', privateFns);
      if (locals) lambdaLines.push(locals);
      if (reply) {
        const refNames = new Set();
        lambdaLines.push(`                re = Some(${genRustReBody(reply.fields, capTypeEnv, refNames)});`);
        const bva = genRustBvaBody(reply.fields, capTypeEnv, refNames);
        if (bva) lambdaLines.push(`                bva_re = Some(${bva});`);
      } else {
        // Implicit return — last expression in body
        const implRet = fnNode.body.find(s => s.type === 'ImplicitReturn');
        if (implRet) {
          const retType = fnNode.returnType;
          const raw = genRustExpr(implRet.expr, capTypeEnv);
          const val = retType ? toJsonValue(raw, retType) : `json!(${raw})`;
          lambdaLines.push(`                re = Some(json!([${forceJsonWrap(val)}]));`);
        }
      }
    } else if (fnNode.expr) {
      const retType = fnNode.returnType;
      const raw = genRustExpr(fnNode.expr, capTypeEnv);
      const val = retType ? toJsonValue(raw, retType) : `json!(${raw})`;
      lambdaLines.push(`                re = Some(json!([${forceJsonWrap(val)}]));`);
    }
    lambdaLines.push('                handled = true;');

    arms.push(`            "${name}" => {\n${lambdaLines.join('\n')}\n            }`);
  }

  arms.push('            _ => {}');
  return arms.join('\n');
}

function needsStructure(actor) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const privateFns = actor.functions.filter(f => !_isPublic(f));
  const publicFns = actor.functions.filter(_isPublic);
  if (privateFns.length > 0) return true;
  for (const h of publicFns) {
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

function fnReturnsFunction(fn) {
  const reply = fn.body.find(s => s.type === 'Reply');
  if (!reply) return false;
  return reply.fields.some(f => f.type === 'Function' || (typeof f.type === 'string' && f.type?.includes('->')));
}

function needsDotCallAwait(actor) {
  // Only need stdin-based await for non-child DotCallExpr
  return actor.functions.filter(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'))).some(h => h.body.some(s => {
    if (s.type !== 'DestructureAssign' || s.source.type !== 'DotCallExpr') return false;
    const obj = s.source.object;
    if (obj.type === 'FunctionCallExpr' && obj.callee?.type === 'Identifier' && _rsActorInfo.has(obj.callee.name)) return false;
    return true;
  }));
}

function genRustChildPublicFn(fn) {
  const { name, params, body } = fn;
  const reply = body.find(s => s.type === 'Reply');
  const typeEnv = buildTypeEnv(params, body);
  const mutableVars = findMutableVars(body);
  const functionAnalysis = analyzeFunctions(body, mutableVars, typeEnv);
  const refNames = new Set(body.filter(s => s.type === 'RefDecl').map(s => s.name));

  const lines = [];
  const destructure = genRustDestructure(params);
  if (destructure) lines.push(destructure);
  const locals = genRustLocals(body, typeEnv, functionAnalysis, mutableVars);
  if (locals) lines.push(locals);

  if (reply) {
    lines.push(`                re = Some(${genRustReBody(reply.fields, typeEnv, refNames)});`);
  }

  return `            "${name}" => {\n${lines.join('\n')}\n            }`;
}

function genRustChildDispatch(actor) {
  const publicFns = actor.functions.filter(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::')));
  const name = actor.name.toLowerCase();
  const arms = publicFns.map(h => genRustChildPublicFn(h));
  arms.push('            _ => {}');
  const hasParams = publicFns.some(h => h.params.length > 0);

  return `
    fn child_${name}_dispatch(&mut self, op: &str, ${hasParams ? 'payload' : '_payload'}: &Value) -> Value {
        let mut re: Option<Value> = None;
        match op {
${arms.join('\n')}
        }
        re.unwrap_or(Value::Null)
    }`;
}

function genRustChildInit(actor) {
  const constructorParams = actor.initParams || [];
  const initBody = actor.initBody || [];
  if (constructorParams.length === 0 && initBody.length === 0) return '';

  const name = actor.name.toLowerCase();
  const lines = [];

  // Destructure constructor params from args
  for (let i = 0; i < constructorParams.length; i++) {
    const p = constructorParams[i];
    const accessor = `args.as_array().and_then(|a| a.get(${i})).cloned().unwrap_or(Value::Null)`;
    lines.push(`        let ${p.name}: ${rustType(p.type)} = ${convertFromValue(accessor, p.type)};`);
  }

  // Store constructor params as state
  for (const p of constructorParams) {
    lines.push(`        self.state.insert("${p.name}".to_string(), json!(${p.name}));`);
  }

  // Constructor body statements
  const initTypeEnv = new Map();
  for (const d of actor.stateVarDecls || []) {
    initTypeEnv.set(d.name, d.typeName);
  }
  for (const p of constructorParams) {
    initTypeEnv.set(p.name, p.type);
  }
  for (const s of initBody) {
    if (s.type === 'StateAssign') {
      const val = genRustExpr(s.value, initTypeEnv);
      const t = initTypeEnv.get(s.name);
      lines.push(`        self.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
    }
  }

  return `
    fn child_${name}_init(&mut self, args: &Value) {
${lines.join('\n')}
    }`;
}

function genRustChildMethods(allActors) {
  const childActors = allActors.filter(a => a.name && _rsActorInfo.has(a.name));
  if (childActors.length === 0) return '';
  const savedStateVarNames = _rsStateVarNames;
  let savedDecls = _rsStateVarDecls;
  const parts = [];
  for (const actor of childActors) {
    // Set state var names for this child actor
    const childStateDecls = actor.stateVarDecls || [];
    const childParams = actor.initParams || [];
    _rsStateVarNames = new Set([
      ...childStateDecls.map(v => v.name),
      ...childParams.map(p => p.name),
    ]);
    savedDecls = _rsStateVarDecls;
    _rsStateVarDecls = [...childStateDecls, ...childParams.map(p => ({ name: p.name, typeName: p.type || 'Anything' }))];
    const init = genRustChildInit(actor);
    if (init) parts.push(init);
    parts.push(genRustChildDispatch(actor));
  }
  _rsStateVarNames = savedStateVarNames;
  _rsStateVarDecls = savedDecls;

  // Generate child_dispatch routing method
  if (childActors.length > 0) {
    const arms = childActors.map(a => {
      const name = a.name.toLowerCase();
      return `            "${name}" => self.child_${name}_dispatch(op_name, payload),`;
    }).join('\n');
    parts.push(`
    fn child_dispatch(&mut self, child_name: &str, op_name: &str, payload: &Value) -> Value {
        match child_name {
${arms}
            _ => Value::Null,
        }
    }`);
  }

  return parts.join('\n');
}

function genRustProgram(actor, allActors) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const publicFns = actor.functions.filter(_isPublic);
  const privateFns = actor.functions.filter(f => !_isPublic(f));
  const hasFns = privateFns.length > 0;
  const childActors = (allActors || []).filter(a => a.name && _rsActorInfo.has(a.name));
  const anyChildStateful = childActors.some(a => (a.stateVarDecls || []).length > 0);
  const isStateful = (actor.stateVarDecls && actor.stateVarDecls.length > 0) || anyChildStateful;
  const needsRefs = publicFns.some(h => h.body.some(s => s.type === 'RefDecl' || s.type === 'SetStatement' || s.type === 'RefRead'))
    || publicFns.some(h => h.body.some(s => s.type === 'WhileStatement' && s.body.some(ws => ws.type === 'SetStatement')));
  const allDispatchFns = [...publicFns, ...privateFns];
  const needsMatchTypes = allDispatchFns.some(h => {
    const typed = h.params.filter(p => p.type && !p.rest);
    return typed.length > 0 && !typed.some(p => p.positional);
  });
  const needsMatchTypesPos = allDispatchFns.some(h => h.params.some(p => p.type && !p.rest && p.positional));
  const needsListTypesOf = publicFns.some(h => {
    const isListOfAny = t => t === 'List of Anything' || t === 'List';
    return h.body.some(s => s.type === 'TypedAssign' && isListOfAny(s.typeName));
  });
  const matchTypesFn = needsMatchTypes ? '\n' + MATCH_TYPES_FN + '\n' : '';
  const matchTypesPosFn = needsMatchTypesPos ? '\n' + MATCH_TYPES_POSITIONAL_FN + '\n' : '';
  const listTypesOfFn = needsListTypesOf ? '\n' + LIST_TYPES_OF_FN + '\n' : '';
  const needsStructureForChildren = childActors.some(a => a.functions.filter(f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'))).some(h => h.params.some(p => p.positional && !p.rest)));
  // Always include Structure — handle_op uses Structure::pack
  const structurePreamble = '\n' + RUST_STRUCTURE_PREAMBLE + '\n';
  const mainActorStateful = actor.stateVarDecls && actor.stateVarDecls.length > 0;
  const constructorParams = actor.initParams || [];
  _rsStateVarNames = new Set([
    ...(actor.stateVarDecls || []).map(v => v.name),
    ...constructorParams.map(p => p.name),
  ]);
  _rsStateVarDecls = [
    ...(actor.stateVarDecls || []),
    ...constructorParams.map(p => ({ name: p.name, typeName: p.type || 'Anything' })),
  ];
  _rsRemoteInstanceVars = new Set();
  for (const s of (actor.initBody || [])) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && _rsUsesNames.has(s.value.callee.name)) {
      _rsRemoteInstanceVars.add(s.name);
    }
  }

  // Pre-register lambdas from state init body (before dispatch, so handlers are included)
  const _preInitLambdas = [];
  for (const s of (actor.initBody || [])) {
    if (s.type === 'StateAssign' && s.value?.type === 'Function') {
      const lambdaName = `_lambda_pre_init_${s.name}`;
      _preInitLambdas.push({ stateVar: s.name, lambdaName, fn: s.value });
    }
  }

  const matchArms = genRustDispatch(publicFns, privateFns, _preInitLambdas);
  // Skip fn method generation for fns with function-type params or function returns (inlined at call sites)
  const isFunctionType = t => t === 'Function' || (typeof t === 'string' && t.includes('->'));
  const compilableFns = hasFns ? privateFns.filter(f =>
    !f.params.some(fp => isFunctionType(fp.type)) && !fnReturnsFunction(f)) : [];
  const fnMethods = compilableFns.length > 0 ? '\n' + compilableFns.map(f => genRustFnMethod(f)).join('\n\n') : '';
  const childMethodsCode = genRustChildMethods(allActors || []);
  const hasDotCallAwait = needsDotCallAwait(actor);

  // Actor struct fields
  const structFields = ['    binding: mpsc::Sender<Value>'];
  const newFields = ['binding'];
  const newArgs = [];
  // Always include state — lambda captures may use it at runtime
  structFields.push('    state: std::collections::HashMap<String, Value>');
  newArgs.push('state: std::collections::HashMap::new()');
  if (needsRefs || isStateful) {
    structFields.push('    refs: std::collections::HashMap<String, Value>');
    newArgs.push('refs: std::collections::HashMap::new()');
  }
  structFields.push('    send_seq: std::cell::Cell<i64>');
  newArgs.push('send_seq: std::cell::Cell::new(1)');
  if (hasDotCallAwait) {
    structFields.push('    reader: io::BufReader<io::Stdin>');
    newArgs.push('reader: io::BufReader::new(io::stdin())');
  }

  // State initialization lines (run in main before message loop)
  const stateInitLines = [];
  if (mainActorStateful) {
    const initTypeEnv = new Map();
    for (const d of (actor.stateVarDecls || [])) {
      initTypeEnv.set(d.name, d.typeName);
    }
    const initBody = actor.initBody || [];
    for (const s of initBody) {
      if (s.type === 'StateAssign' && _rsRemoteInstanceVars.has(s.name)) {
        // Remote construction: send ::new, await reply, extract from
        const callee = s.value.callee.name;
        const positionalArgs = s.value.args.filter(a => a.type !== 'NamedArgsBag');
        const namedBag = s.value.args.find(a => a.type === 'NamedArgsBag');
        let argsJson;
        if (positionalArgs.length === 0 && !namedBag) {
          argsJson = 'json!({})';
        } else if (namedBag) {
          const fields = Object.entries(namedBag.fields).map(([k, v]) => `"${k}": ${forceJsonWrap(toJsonValue(genRustExpr(v, initTypeEnv), inferLiteralType(v)))}`).join(', ');
          argsJson = `json!({${fields}})`;
        } else {
          const vals = positionalArgs.map(a => forceJsonWrap(toJsonValue(genRustExpr(a, initTypeEnv), inferLiteralType(a)))).join(', ');
          argsJson = `json!([${vals}])`;
        }
        stateInitLines.push(`    {`);
        stateInitLines.push(`        let seq = actor.send_seq.get();`);
        stateInitLines.push(`        actor.send_seq.set(seq + 1);`);
        stateInitLines.push(`        let new_id = seq.to_string();`);
        stateInitLines.push(`        actor.state.insert("_pending_new_${s.name}".to_string(), json!(new_id.clone()));`);
        stateInitLines.push(`        let new_op = json!([${argsJson}, "::new"]);`);
        stateInitLines.push(`        let new_msg = json!({"id": new_id, "op": new_op, "to": "${callee}"});`);
        stateInitLines.push(`        let _ = actor.binding.send(new_msg);`);
        stateInitLines.push(`    }`);
        continue;
      }
      if (s.type === 'StateAssign') {
        // Check if this was pre-registered as a lambda
        const preInit = _preInitLambdas.find(p => p.stateVar === s.name);
        if (preInit) {
          stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), json!("${preInit.lambdaName}"));`);
        } else if (s.value?.type === 'StructureConstructor' || s.value?.type === 'StructureLiteral') {
          // Store Structure as wire-format JSON (Structure type is not serializable)
          const positional = s.value.args.filter(a => a.positional);
          const named = s.value.args.filter(a => a.key !== undefined);
          if (positional.length === 1 && named.length === 0) {
            const val = genRustExpr(positional[0].expr, initTypeEnv);
            const pt = positional[0].type || inferLiteralType(positional[0].expr);
            stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), json!([${toJsonValue(val, pt)}]));`);
          } else {
            const val = genRustExpr(s.value, initTypeEnv);
            stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), { let _s = ${val}; _s.to_json() });`);
          }
        } else {
          const val = genRustExpr(s.value, initTypeEnv);
          const t = initTypeEnv.get(s.name);
          stateInitLines.push(`    actor.state.insert("${s.name}".to_string(), ${forceJsonWrap(toJsonValue(val, t))});`);
        }
      }
    }
  }
  const initMethod = '';

  // Capture — serialize actor state
  const captureFields = [..._rsStateVarNames].map(n =>
    `m.insert("${n}".to_string(), self.state.get("${n}").cloned().unwrap_or(Value::Null));`
  ).join(' ');
  const captureMethod = `    fn capture(&self) -> Value {
        let mut m = Map::new();
        ${captureFields}
        Value::Object(m)
    }

    fn hydrate(&mut self, state: &Value) {
${[..._rsStateVarNames].map(n =>
  `        if let Some(v) = state.get("${n}") { self.state.insert("${n}".to_string(), v.clone()); }`
).join('\n')}
    }

    fn handle_test(&mut self, test: &Value, id: &str, from: &str) {
        if let Some(name) = test.get("get").and_then(|v| v.as_str()) {
            let val = self.state.get(name).cloned().unwrap_or(Value::Null);
            let bv_type: Option<&str> = match name {
${[..._rsStateVarNames].map(n => {
  const decl = _rsStateVarDecls.find(d => d.name === n);
  const t = decl?.typeName || 'Anything';
  return `                "${n}" => Some("${t}"),`;
}).join('\n')}
                _ => None,
            };
            let mut resp = Map::new();
            resp.insert("id".to_string(), json!(id));
            resp.insert("re".to_string(), val);
            resp.insert("to".to_string(), json!(from));
            if let Some(t) = bv_type { resp.insert("bv-a".to_string(), json!(t)); }
            let _ = self.binding.send(Value::Object(resp));
        } else if let Some(set_val) = test.get("set") {
            let payload = if set_val.is_array() { set_val.clone() } else if set_val.is_object() { set_val.clone() } else { json!([set_val]) };
            self.handle_op("::set", &json!({}), &payload, "__test");
        } else if let Some(upd_val) = test.get("update") {
            let payload = if upd_val.is_array() { upd_val.clone() } else if upd_val.is_object() { upd_val.clone() } else { json!([upd_val]) };
            self.handle_op("::update", &json!({}), &payload, "__test");
        } else if let Some(op) = test.get("op") {
            let (op_name, payload): (String, Value) = if let Some(s) = op.as_str() {
                (s.to_string(), json!({}))
            } else if let Some(arr) = op.as_array() {
                let name = arr.last().and_then(|v| v.as_str()).unwrap_or("").to_string();
                let p = if arr.len() > 1 { arr[0].clone() } else { json!({}) };
                (name, p)
            } else { return; };
            let (re, bva_re, handled) = self.handle_op(&op_name, &json!({}), &payload, "__test");
            if !handled {
                let mut ex = Map::new(); ex.insert(op_name, json!("unhandled"));
                let mut resp = Map::new(); resp.insert("id".to_string(), json!(id)); resp.insert("ex".to_string(), Value::Object(ex)); resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
            } else if let Some(re_val) = re {
                let mut resp = Map::new(); resp.insert("id".to_string(), json!(id)); resp.insert("re".to_string(), re_val); resp.insert("to".to_string(), json!(from));
                if let Some(b) = bva_re { resp.insert("bv-a".to_string(), b); }
                let _ = self.binding.send(Value::Object(resp));
            }
        }
    }`;

  // Receive method — handle cam messages before dispatch
  const remoteNewChecks = [..._rsRemoteInstanceVars].map(name =>
    `if let Some(pending_id) = self.state.get("_pending_new_${name}") {
                if message.get("id") == Some(pending_id) {
                    self.state.insert("${name}".to_string(), message.get("from").cloned().unwrap_or(Value::Null));
                    self.state.remove("_pending_new_${name}");
                    return;
                }
            }`
  ).join('\n            ');
  const receiveBody = `        if message.get("re").is_some() {
            ${remoteNewChecks ? remoteNewChecks + '\n            ' : ''}return;
        }
        if let Some(cam) = message.get("cam") {
            let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
            if cam.as_str() == Some("capture") {
                let mut resp = Map::new();
                resp.insert("id".to_string(), json!(id));
                resp.insert("re".to_string(), self.capture());
                resp.insert("to".to_string(), json!(from));
                let _ = self.binding.send(Value::Object(resp));
                return;
            }
            if let Some(arr) = cam.as_array() {
                if arr.last().and_then(|v| v.as_str()) == Some("hydrate") {
                    if let Some(state) = arr.first() {
                        self.hydrate(state);
                    }
                    let mut resp = Map::new();
                    resp.insert("id".to_string(), json!(id));
                    resp.insert("re".to_string(), json!("hydrate"));
                    resp.insert("to".to_string(), json!(from));
                    let _ = self.binding.send(Value::Object(resp));
                    return;
                }
            }
        }
        if let Some(test) = message.get("test") {
            let id = message.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("");
            self.handle_test(test, id, from);
            return;
        }
        self.dispatch(message);`;

  // Handle op — shared match logic for dispatch and self_send
  const handleOpMethod = `    fn handle_op(&mut self, op_name: &str, message: &Value, payload: &Value, from: &str) -> (Option<Value>, Option<Value>, bool) {
        let _s = Structure::pack(payload);
        let _bva_msg = message.get("bv-a");
        let mut re: Option<Value> = None;
        let mut bva_re: Option<Value> = None;
        let mut handled = false;
        match op_name {
${matchArms}
        }
        (re, bva_re, handled)
    }

    fn call_fn(&mut self, fn_val: &Value, payload: &Value) -> Value {
        let fn_name = fn_val.as_str().unwrap_or("");
        self.self_send(fn_name, payload)
    }

    fn self_send(&mut self, op_name: &str, payload: &Value) -> Value {
        let empty_msg = json!({});
        let (re, _bva, _handled) = self.handle_op(op_name, &empty_msg, payload, "__self");
        re.unwrap_or(Value::Null)
    }`;

  // Dispatch body — calls handle_op, routes results
  const dispatchBlock = `        let result = catch_unwind(AssertUnwindSafe(|| {
            self.handle_op(op_name.as_str(), message, &payload, from)
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

${captureMethod}

    fn receive(&mut self, message: &Value) {
${receiveBody}
    }
${initMethod}
${handleOpMethod}

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
${fnMethods}${childMethodsCode}${hasDotCallAwait ? `
    fn await_response(&mut self, target_id: &str) -> Value {
        loop {
            let mut buf = String::new();
            match self.reader.read_line(&mut buf) {
                Ok(0) => return Value::Null,
                Ok(_) => {
                    let line = buf.trim();
                    if line.is_empty() { continue; }
                    if let Ok(msg) = serde_json::from_str::<Value>(line) {
                        if let Some(re) = msg.get("re") {
                            if msg.get("id").and_then(|v| v.as_str()) == Some(target_id) {
                                return re.clone();
                            }
                        }
                        self.receive(&msg);
                    }
                }
                Err(_) => return Value::Null,
            }
        }
    }` : ''}
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
${stateInitLines.length > 0 ? stateInitLines.join('\n') + '\n' : ''}${hasDotCallAwait ? `    let mut buf = String::new();
    loop {
        buf.clear();
        match actor.reader.read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let line = buf.trim();
                if line.is_empty() { continue; }
                let message: Value = serde_json::from_str(line).unwrap();
                actor.receive(&message);
            }
            Err(_) => break,
        }
    }` : `    let stdin = io::stdin();
    let mut buf = String::new();
    loop {
        buf.clear();
        match stdin.lock().read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let line = buf.trim();
                if line.is_empty() { continue; }
                let message: Value = serde_json::from_str(line).unwrap();
                actor.receive(&message);
            }
            Err(_) => break,
        }
    }`}
    drop(actor);
    handle.join().unwrap();
}
`;
}

export function codegenRust(ast) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name.startsWith('::'));
  const active = ast.actors.filter(a => a.functions.some(_isPublic));
  if (active.length === 0) return '';
  _rsActorInfo = new Map();
  _rsActorFnNames = new Set();
  _rsUsesNames = new Set((ast.useDecls || []).map(u => u.name));
  _rsChildCounter = 0;
  for (const a of active) {
    if (a.name) {
      _rsActorInfo.set(a.name, { actor: a, asClauses: a.asClauses || [] });
    }
    a.functions.filter(f => f.name && !_isPublic(f)).forEach(f => _rsActorFnNames.add(f.name));
  }
  // Collect emit declarations from all actors
  _rsEmitNames = new Map();
  for (const a of active) {
    for (const s of (a.constructorBody || [])) {
      if (s.type === 'EmitDecl') _rsEmitNames.set(s.name, s);
    }
  }
  const mainActor = active.find(a => !a.name) || active[0];
  return genRustProgram(mainActor, active);
}
