// types.js — Pure helpers and type utilities for Rust codegen
import { INT_TYPE, intFromValue, intToValue, isIntValue } from './int_repr.js';
import { DEC_TYPE, decFromValue, decToValue, isDecValue } from './dec_repr.js';
import { inferExprType } from '../../inference.js';
import { isDynamicTy, tyMembers, wireTypes } from '../ty_tags.js';
const TYPE_MEMBER_OF_FN = `fn type_member_of(actual: &str, expected: &str) -> bool {
    if actual == expected { return true; }
    // A type value's wire tag is its authority address carrying ::Name; the
    // parameter spells the type by name (possibly Alias::Name). Match on the
    // bare type name (authority is identity that travels, not a v1 match key).
    let an = bv_type_name(actual);
    let en = expected.rsplit("::").next().unwrap_or(expected);
    if let Some(a) = an {
        if a == en { return true; }
    }
    if expected.contains('|') {
        return expected.split('|').any(|m| {
            let m = m.trim();
            m == actual || an.map(|a| a == m.rsplit("::").next().unwrap_or(m)).unwrap_or(false)
        });
    }
    false
}`;

// A tag against a param's type. Anything takes any tag, including a List's.
const TAG_MATCHES_FN = `fn tag_matches(tag: &Value, expected: &str) -> bool {
    expected == "Anything" || tag.as_str().map(|a| type_member_of(a, expected)).unwrap_or(false)
}`;

const MATCH_TYPES_FN = `fn match_types(message: &Value, pairs: &[(&str, &str)]) -> bool {
    let ty = match message.get("ty") {
        Some(v) => v,
        None => return pairs.is_empty(),
    };
    let arr = match ty.as_array() {
        Some(a) => a,
        None => return pairs.is_empty(),
    };
    if arr.is_empty() {
        return pairs.is_empty();
    }
    let types_obj = &arr[0];
    for &(name, type_name) in pairs {
        match types_obj.get(name) {
            Some(v) if tag_matches(v, type_name) => {}
            _ => return false,
        }
    }
    true
}`;

const MATCH_TYPES_POSITIONAL_FN = `fn match_types_positional(message: &Value, pos_types: &[&str], named_types: &[(&str, &str)]) -> bool {
    match_types_positional_min(message, pos_types, named_types, pos_types.len())
}

fn match_types_positional_min(message: &Value, pos_types: &[&str], named_types: &[(&str, &str)], min_pos: usize) -> bool {
    let ty = match message.get("ty") {
        Some(v) => v,
        None => return pos_types.is_empty() && named_types.is_empty(),
    };
    let arr = match ty.as_array() {
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
    let has_named_map = !named_types.is_empty() && types_arr.last().map(|v| v.is_object()).unwrap_or(false);
    let named_offset = if has_named_map { 1 } else { 0 };
    let actual_pos_count = types_arr.len().saturating_sub(named_offset);
    if actual_pos_count < min_pos || actual_pos_count > pos_types.len() {
        return false;
    }
    for (i, &t) in pos_types.iter().take(actual_pos_count).enumerate() {
        match types_arr.get(i) {
            Some(v) if tag_matches(v, t) => {}
            _ => return false,
        }
    }
    if has_named_map {
        if let Some(obj) = types_arr.last().unwrap().as_object() {
            for &(name, type_name) in named_types {
                match obj.get(name) {
                    Some(v) if tag_matches(v, type_name) => {}
                    None => {}
                    _ => return false,
                }
            }
        }
    }
    true
}`;

const RUST_OBJECT_PREAMBLE = `#[allow(dead_code)]
#[derive(Clone)]
struct BvObject {
    positional: Vec<Value>,
    named: Map<String, Value>,
}

#[allow(dead_code)]
impl BvObject {
    fn empty() -> Self {
        BvObject { positional: vec![], named: Map::new() }
    }
    fn pack(payload: &Value) -> Self {
        if payload.is_null() {
            return BvObject::empty();
        }
        if let Some(arr) = payload.as_array() {
            if arr.is_empty() {
                return BvObject::empty();
            }
            let last = &arr[arr.len() - 1];
            if let Some(obj) = last.as_object() {
                // A tagged type value (carries __type) is a positional value,
                // not a named-args container — mirrors the JS/erlang packers.
                // A trailing \`{}\` is an empty named slot: \`[{}]\` reads as \`[]\`.
                if !obj.contains_key("__type") {
                    let positional = arr[..arr.len() - 1].to_vec();
                    let named = obj.clone();
                    return BvObject { positional, named };
                }
            }
            return BvObject { positional: arr.clone(), named: Map::new() };
        }
        if let Some(obj) = payload.as_object() {
            return BvObject { positional: vec![], named: obj.clone() };
        }
        BvObject::empty()
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
        } else if has_named {
            Value::Object(self.named.clone())
        } else {
            // An empty Object's wire form is \`[]\`; \`{}\` and \`[{}]\` are read as the same.
            Value::Array(vec![])
        }
    }
    // A function value may be a writer that returned self, which has no value.
    fn one_or_null(&self) -> Value {
        if self.positional.is_empty() && self.named.is_empty() { Value::Null } else { self.one() }
    }
    fn one(&self) -> Value {
        if self.positional.len() != 1 {
            panic!("requires exactly 1 positional return value, got {}", self.positional.len());
        }
        self.positional[0].clone()
    }
    fn splat_ty(ty_first: &Value) -> Value {
        if let Some(arr) = ty_first.as_array() {
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
        if let Some(_obj) = ty_first.as_object() {
            return ty_first.clone();
        }
        Value::Null
    }
}

// An Object passed as an argument or nested in a reply travels in its wire form.
impl IntoValue for BvObject {
    fn into_value(self) -> Value { self.splat() }
}
impl IntoValue for &BvObject {
    fn into_value(self) -> Value { self.splat() }
}`;

// Wire-format helper: extract the trailing @name/#name selector from a
// to-field string. Handles both bare selectors ("@name") and the
// hash-angle delimited alias+selector form ("#<alias selector>").
// Returns the selector with its leading sigil, or None.
const RUST_WIRE_HELPERS = `fn extract_to_selector(to: &str) -> Option<String> {
    let inner = if to.starts_with("#<") && to.ends_with('>') {
        &to[2..to.len() - 1]
    } else {
        to
    };
    let last = inner.rsplit(' ').next().unwrap_or("");
    if last.starts_with('@') || last.starts_with('#') {
        Some(last.to_string())
    } else {
        None
    }
}`;

// The tag for a value whose slot is declared as a union or `Anything`: the member
// the value is, else the value's own kind (a list: each element's). `m` is
// (kind, tag) pairs; "*" is a member taken when no other matches.
const BV_TY_OF_FN = `#[allow(dead_code)]
fn bv_ty_of(v: &Value, m: &[(&str, &str)]) -> Value {
    let k = bv_as_kind(v);
    let pick = |kind: &str| m.iter().find(|e| e.0 == kind);
    let hit = pick(k.as_str())
        .or_else(|| if k == "Integer" { pick("Float").or_else(|| pick("Decimal")) } else { None })
        .or_else(|| if k == "null" { pick("List") } else { None })
        .or_else(|| pick("*"));
    if let Some(e) = hit { return json!(e.1); }
    match v {
        Value::Array(a) => {
            let el: Vec<(&str, &str)> = m.iter().filter(|e| e.0 != "List").cloned().collect();
            Value::Array(a.iter().map(|x| bv_ty_of(x, &el)).collect())
        }
        Value::Object(o) if o.contains_key("__type") => json!(format!("::{}", k.rsplit("::").next().unwrap_or(k.as_str()))),
        _ => json!(k),
    }
}`;

const RUST_KEYWORDS = new Set(['fn', 'let', 'mut', 'ref', 'type', 'use', 'mod', 'pub', 'self', 'super', 'crate', 'as', 'break', 'const', 'continue', 'else', 'enum', 'extern', 'false', 'for', 'if', 'impl', 'in', 'loop', 'match', 'move', 'return', 'static', 'struct', 'trait', 'true', 'unsafe', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try']);

// Shared mutable state container
export const G = { ctx: null };
export function setCtx(newCtx) { G.ctx = newCtx; }

// Wire tag for a type-valued slot: `path ::Name` for an imported/cross-module
// type, `::Name` for a local one. `ty` is translated, so it needs no `#<…>`. Non-type tags
// (primitives, null) pass through. Shared by reply, param, and argument slots.
// See notes/type-authority-address-tags-2026-10-26.
export function rustTypeTag(t) {
  if (typeof t !== 'string' || !G.ctx.typeDecls?.has(t)) return t;
  const name = G.ctx.typeDecls.get(t).name || t;
  const authority = G.ctx.typeAuthority?.get(t) || '';
  return authority ? `${authority} ::${name}` : `::${name}`;
}

// The runtime tag of `valueExpr` (a Value), whose declared type `t` is a union or
// `Anything`. Parenthesized so it sits in a `json!` as one expression.
export function rustTyOf(t, valueExpr) {
  const members = tyMembers(t, rustTypeTag, G.ctx.typeDecls)
    .map(([k, tag]) => `(${JSON.stringify(k)}, ${JSON.stringify(tag)})`).join(', ');
  return `(bv_ty_of(&${valueExpr}, &[${members}]))`;
}

// A slot's tag for a `json!`: the declared type's when it is one, else the value's
// at runtime (`valueExpr`, or no tag when there is nothing safe to read).
export function rustSlotTag(t, valueExpr) {
  if (!isDynamicTy(t)) { const tag = rustTypeTag(t ?? null); return tag ? JSON.stringify(tag) : 'null'; }
  return valueExpr ? rustTyOf(t, valueExpr) : 'null';
}

// Wrap a Value expression with `bv_to_wire` when its type is a type decl
// (positional list when all-required, named map when any optional); null
// otherwise so the caller keeps the plain value.
export function rustTypeWireWrap(valueExpr, t) {
  const types = wireTypes(t, G.ctx.typeDecls);
  if (types.length === 0) return null;
  const wire = (v, name) => {
    const decl = G.ctx.typeDecls.get(name);
    const fieldList = (decl.fields || []).map(f => `"${f.name}"`).join(', ');
    const allRequired = (decl.fields || []).every(f => !f.optional);
    return `bv_to_wire(&${v}, &[${fieldList}], ${allRequired})`;
  };
  if (G.ctx.typeDecls.has(t)) return wire(valueExpr, t);
  // A union: the value's own `__type` says which type's fields to send.
  const arms = types.map(n => `Some(${JSON.stringify(n)}) => ${wire('_w', n)},`).join(' ');
  return `{ let _w: Value = ${valueExpr}; match _w.get("__type").and_then(|t| t.as_str()) { ${arms} _ => _w.clone() } }`;
}

function buildTypeEnv(params, body) {
  const env = new Map();
  for (const p of params) {
    if (p.name && !p.rest) env.set(p.name, p.type || null);
  }
  for (const s of body) {
    if (s.type === 'TypedAssign') env.set(s.name, s.typeName);
    if (s.type === 'DestructureAssign') {
      // Typed-value source: propagate each field's declared type from the
      // type registry to the destructured local.
      const src = s.source;
      let srcTypeName = null;
      if (src?.type === 'TypeConstruction') srcTypeName = src.typeName;
      else if (src?.type === 'Identifier' && env.has(src.name)) srcTypeName = env.get(src.name);
      const srcDecl = (G.ctx?.typeDecls && srcTypeName && G.ctx.typeDecls.has(srcTypeName))
        ? G.ctx.typeDecls.get(srcTypeName) : null;
      for (const item of s.pattern) {
        if (item.discard) continue;
        let t = item.type || null;
        if (!t && srcDecl) {
          const fields = srcDecl.fields || [];
          let field;
          if (item.named) field = fields.find(f => f.name === item.name);
          else if (item.key !== undefined) field = fields.find(f => f.name === item.key);
          else if (item.positional) field = fields[item.idx];
          // Skip propagation for optional fields — keep the local as
           // Value so `??` / `(expr)?` see absence.
          if (field?.paramType && !field.optional) t = field.paramType;
        }
        // Infer type from ObjectConstructor source if pattern lacks type
        if (!t && s.source.type === 'ObjectConstructor') {
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
      if (s.value?.type === 'Function') {
        env.set(s.name, 'Function');
      } else {
        const inferred = inferLiteralType(s.value) || inferExprType(s.value, env);
        if (inferred) env.set(s.name, inferred);
      }
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
  if (expr.type === 'TypeConstruction') return expr.typeName;
  if (expr.type === 'PresenceCheck') return 'Boolean';
  return null;
}

function rustIdent(name) {
  // A silent name's trailing `.` (`fire.`) → `__s`, keeping `fire` and `fire.`
  // distinct (`.` is not valid in Rust identifiers).
  if (name.endsWith('.')) name = `${name.slice(0, -1)}__s`;
  // A writing name's trailing `!` → `__w`, likewise.
  if (name.endsWith('!')) name = `${name.slice(0, -1)}__w`;
  // Private function names (#name) → pv_name (# is not valid in Rust identifiers)
  if (name.startsWith('#')) return `pv_${name.slice(1)}`;
  if (RUST_KEYWORDS.has(name)) return `r#${name}`;
  return name;
}

// SSA helpers — uniform 1-indexed `${name}__${n}` emission, mirroring the JS
// and Erlang backends. G.ctx.ssaScope is a Map<sourceName, currentSsaName>;
// G.ctx.ssaCounts is a Map<sourceName, count>. Both are populated during a
// body walk and reset by the caller.
function mintRustSsa(name) {
  if (!G.ctx.ssaScope) G.ctx.ssaScope = new Map();
  if (!G.ctx.ssaCounts) G.ctx.ssaCounts = new Map();
  const n = (G.ctx.ssaCounts.get(name) || 0) + 1;
  G.ctx.ssaCounts.set(name, n);
  const ssaName = `${rustIdent(name)}__${n}`;
  G.ctx.ssaScope.set(name, ssaName);
  return ssaName;
}

// Resolve a source-level identifier to its current SSA-suffixed name.
// Falls back to plain rustIdent when the name is not in scope (function
// parameters, captured free vars).
function rustSsaResolve(name) {
  if (G.ctx.ssaScope?.has(name)) return G.ctx.ssaScope.get(name);
  return rustIdent(name);
}

// Match an intLiteral() output and return the raw digit string, or null.
// intLiteral renders as: BigInt::from_str("N").unwrap()
function matchIntLiteral(expr) {
  const m = expr.match(/^BigInt::from_str\("(-?\d+)"\)\.unwrap\(\)$/);
  return m ? m[1] : null;
}

function rustType(brevityType) {
  if (brevityType === 'Integer') return INT_TYPE;
  if (brevityType === 'Text') return 'String';
  if (brevityType === 'Blob') return 'String';
  if (brevityType === 'Decimal') return DEC_TYPE;
  if (brevityType === 'Float') return 'f64';
  if (brevityType === 'Boolean') return 'bool';
  if (typeof brevityType === 'string' && brevityType.includes('|')) return 'Value';
  return 'Value';
}

function convertFromValue(expr, brevityType) {
  // A typed bind fails on a wrong value rather than taking the type's default.
  if (G.strictConvert && ['Integer', 'Text', 'Blob', 'Decimal', 'Float', 'Boolean'].includes(brevityType)) {
    const checked = `bv_as(&${expr}, &json!("${brevityType}"), "${brevityType}")`;
    G.strictConvert = false;
    const out = convertFromValue(checked, brevityType);
    G.strictConvert = true;
    return out;
  }
  if (brevityType === 'Integer') return intFromValue(expr);
  if (brevityType === 'Text') return `${expr}.as_str().unwrap_or("").to_string()`;
  if (brevityType === 'Blob') return `${expr}.as_str().unwrap_or("").to_string()`;
  if (brevityType === 'Decimal') return decFromValue(expr);
  if (brevityType === 'Float') return `${expr}.as_f64().unwrap_or(0.0)`;
  if (brevityType === 'Boolean') return `${expr}.as_bool().unwrap_or(false)`;
  return expr;
}

function toJsonValue(expr, brevityType) {
  // Element-returning list helpers always produce a Value (Value::Null on
  // out-of-range, Value::* otherwise). Inference reports the element's type
  // (Integer/Decimal/Text/...), but the runtime call already yields Value —
  // pass through without further wrapping for any primitive type branch.
  if (expr.startsWith('bv_list_first(') || expr.startsWith('bv_list_last(') || expr.startsWith('bv_list_at(')) {
    return expr;
  }
  if (brevityType === 'Integer') {
    // If expression is already a Value (state read, ref read, fn call result), don't wrap
    if (expr === 'Value::Null' || expr.startsWith('self.state.get(') || expr.startsWith('self.refs.get(') || expr.startsWith('self.outer_read(')
        || expr.startsWith('bv_val(') || expr.startsWith('json!(') || expr.startsWith('Value::')
        || expr.startsWith('bv_bigint_to_value(')
        // SSA-resolved state/ref reads: e.g. _s.positional.get(...).cloned()...
        || (expr.startsWith('_') && expr.includes('.cloned().unwrap_or('))
        // call_fn results
        || expr.includes('.one()')) return expr;
    return intToValue(expr);
  }
  if (brevityType === 'Decimal') {
    if (expr === 'Value::Null' || expr.startsWith('self.state.get(') || expr.startsWith('self.refs.get(') || expr.startsWith('self.outer_read(')
        || expr.startsWith('bv_val(') || expr.startsWith('json!(') || expr.startsWith('Value::')
        || expr.startsWith('bv_decimal_to_value(')
        || (expr.startsWith('_') && expr.includes('.cloned().unwrap_or('))
        || expr.includes('.one()')) return expr;
    const numMatch = matchIntLiteral(expr);
    if (numMatch) return `json!(${numMatch}.0)`;
    return decToValue(expr);
  }
  if (brevityType === 'Float' || brevityType === 'Boolean') {
    // Handle integer literal used as Float/Boolean default (e.g., price *Float = 0)
    const numMatch = matchIntLiteral(expr);
    if (numMatch) return `json!(${numMatch}${brevityType !== 'Boolean' ? '.0' : ''})`;
    // Handle BvDecimal literal used as Float (e.g., ratio *Float = 3.14)
    if (brevityType === 'Float' && (expr.startsWith('BvDecimal::new(') || expr.startsWith('bv_dec_op(') || expr.startsWith('bv_to_decimal('))) {
      return decToValue(expr);
    }
    return `json!(${expr})`;
  }
  if (brevityType === 'Text' || brevityType === 'Blob') {
    return `json!(${expr})`;
  }
  if (brevityType === 'Anything' || !brevityType) {
    return `bv_val(${expr})`;
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
  return arg.type === 'Function' || arg.expr?.type === 'Function' || (typeof arg.type === 'string' && /[-=~]>/.test(arg.type));
}

function isFunctionOnlyConstructor(node) {
  return node.type === 'ObjectConstructor' && node.args.length > 0 && node.args.every(isFunctionArg);
}

function createRustContext() {
  return {
    actorInfo: new Map(),
    actorFnNames: new Set(),
    publicFnNames: new Set(),
    constructorOverloads: new Map(),
    stateVarNames: new Set(),
    stateVarDecls: [],
    dependencyNames: new Set(),
    remoteInstanceVars: new Set(),
    // Per-handler-body locals bound to dep constructor calls (set inside
    // genRustLocals; reset on each handler body so it doesn't leak).
    localInstanceVars: new Set(),
    // Set when at least one handler emits a function-body dep construction;
    // controls whether await_new_response is emitted in the actor impl.
    needsAwaitNew: false,
    childCounter: 0,
    lambdaCounter: 0,
    lambdaHandlers: [],
    lambdaVarNames: new Set(),
    emitNames: new Map(),
    fnTempCounter: 0,
    childStatePrefix: '',
    // Active catch labels — outermost first. Each entry:
    //   { brevityName: '#label', rsLabel: 'lbl_label_<n>' }
    // LabelInvoke codegen emits `break '<rsLabel>;` for the matching entry.
    catchLabelStack: [],
    catchLabelCounter: 0,
  };
}

// A read of a cell of an actor a class is declared in (src/outer_reads.js), as a typed
// value (a ref read stays a Value). The key is the owner's: a file's or a class
// param's has no class prefix, and a class's cell has its class's.
function outerRead(expr) {
  const bare = expr.name.replace(/^[@#]/, '');
  const prefix = expr.name.startsWith('@') ? 'a_' : expr.name.startsWith('#') ? 'h_' : 'b_';
  const owner = expr.outerClass && !expr.outerParam ? `${expr.outerClass.toLowerCase()}_` : '';
  const read = `self.outer_read(${expr.outerLevel ?? 1}, "${owner}${prefix}${bare}")`;
  // A ref read is a Value here, as a class's own cell is.
  if (expr.type === 'RefRead') return read;
  return `(${convertFromValue(read, expr.outerType ?? G.ctx.outerTypes?.get(expr.name))})`;
}

function stateKey(name) {
  // Three disjoint user namespaces: bare → b_, @ → a_, # → h_.
  // Codegen-internal names use the __ prefix and bypass this function.
  let prefix, bare;
  if (typeof name === 'string' && name.startsWith('@')) {
    prefix = 'a_'; bare = name.slice(1);
  } else if (typeof name === 'string' && name.startsWith('#')) {
    prefix = 'h_'; bare = name.slice(1);
  } else {
    prefix = 'b_'; bare = name;
  }
  if (!G.ctx.childStatePrefix) return `${prefix}${bare}`;
  // Constructor params are shared with parent — don't apply child prefix
  if (G.ctx.childConstructorParams && G.ctx.childConstructorParams.has(name)) return `${prefix}${bare}`;
  return `${G.ctx.childStatePrefix}_${prefix}${bare}`;
}

// Helper: resolve storage target for set/insert — state vars use self.state, local refs use self.refs

function rsStore(name) {
  return G.ctx.stateVarNames.has(name) ? 'self.state' : 'self.refs';
}

function findRsAsClauseMatch(targetType, actorName) {
  if (!G.ctx.actorInfo.has(actorName)) return null;
  const info = G.ctx.actorInfo.get(actorName);
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
  const objectFunctions = new Map();

  for (let i = 0; i < body.length; i++) {
    const s = body[i];

    // f = () { x }  OR  f : Function = |x| { ... }
    // Skip overload <</Function() — they don't create new function definitions
    if ((s.type === 'Assign' && s.value.type === 'Function') ||
        (s.type === 'TypedAssign' && s.value.type === 'Function')) {
      if (s.value.overloadMode === 'append' || s.value.emptyOverload) continue;
      // Skip if this function name has subsequent overload operators (<<) in the body
      const hasOverload = body.slice(i + 1).some(ss =>
        (ss.type === 'Assign' || ss.type === 'TypedAssign') &&
        ss.name === s.name &&
        ss.value?.type === 'Function' &&
        ss.value.overloadMode === 'append',
      );
      if (hasOverload) continue;
      fnDefs.set(s.name, { node: s.value, defIdx: i });
      skipSet.add(i);
    }

    // s : Object = Object(fn: f : Function) — all-function constructor
    if (s.type === 'TypedAssign' && s.typeName === 'Object' && s.value.type === 'ObjectConstructor') {
      if (isFunctionOnlyConstructor(s.value)) {
        skipSet.add(i);
        const sc = new Map();
        for (const arg of s.value.args) {
          if (arg.type === 'Function' && arg.expr?.type === 'Identifier' && fnDefs.has(arg.expr.name)) {
            sc.set(arg.key, arg.expr.name);
          } else if (arg.expr?.type === 'Function') {
            // Inline Function in object — register directly
            const inlineName = `_sc_${s.name}_${arg.key}`;
            fnDefs.set(inlineName, { node: arg.expr, defIdx: i });
            sc.set(arg.key, inlineName);
          }
        }
        objectFunctions.set(s.name, sc);
      }
    }

    // DestructureAssign
    if (s.type === 'DestructureAssign') {
      // :fn = s (s is function-only Object)
      if (s.source.type === 'Identifier' && objectFunctions.has(s.source.name)) {
        skipSet.add(i);
        const sc = objectFunctions.get(s.source.name);
        for (const item of s.pattern) {
          if (item.named && item.name && sc.has(item.name)) {
            fnDefs.set(item.name, fnDefs.get(sc.get(item.name)));
          }
        }
      }
      // :fn = Object(fn: () { x } : Function) — inline function constructor
      if (s.source.type === 'ObjectConstructor' && isFunctionOnlyConstructor(s.source)) {
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

function needsJsonWrap(expr) {
  return expr.type === 'FloatLiteral' || expr.type === 'DecimalLiteral' ||
         expr.type === 'StringLiteral' || expr.type === 'BoolLiteral' ||
         expr.type === 'BinaryExpr' || expr.type === 'Identifier';
}

function convertBranchExpr(raw, expr, targetType) {
  if (targetType === 'Value' && expr.type === 'IntLiteral') return intToValue(raw);
  if (targetType === 'Value' && needsJsonWrap(expr)) return `json!(${raw})`;
  if (targetType === 'String' && expr.type === 'StringLiteral') return `${raw}.to_string()`;
  // StateVar/RefRead return Value — convert to target type
  if ((expr.type === 'StateVar' || expr.type === 'RefRead' || (expr.type === 'FunctionCallExpr' && expr.callee?.type === 'Identifier' && G.ctx.actorFnNames.has(expr.callee.name))) && targetType && targetType !== 'Value') {
    const brevityType = (targetType === 'i64' || targetType === INT_TYPE) ? 'Integer' : targetType === 'f64' ? 'Float' : targetType === 'String' ? 'Text' : targetType === 'bool' ? 'Boolean' : null;
    if (brevityType) return convertFromValue(raw, brevityType);
  }
  return raw;
}

function isBoolExpr(expr) {
  if (expr.type === 'BoolLiteral') return true;
  if (expr.type === 'BinaryExpr') {
    const cmpOps = ['===', '!==', '==', '!=', '>', '<', '>=', '<='];
    return cmpOps.includes(expr.op);
  }
  return false;
}

function forceJsonWrap(expr, brevityType) {
  // Always wrap native Rust values into serde_json::Value for Object fields
  if (expr === 'Value::Null' || expr.startsWith('json!(') || isIntValue(expr) || isDecValue(expr) || expr.startsWith('Value::') || expr.startsWith('bv_val(')) return expr;
  if (brevityType === 'Integer') return intToValue(expr);
  if (brevityType === 'Decimal') return decToValue(expr);
  // Detect BigInt expressions by their shape
  if (expr.startsWith('BigInt::from(') || expr.startsWith('(&') || expr.startsWith('bv_pow(') || expr.startsWith('bv_to_bigint(')) return intToValue(expr);
  // Detect BvDecimal expressions
  if (expr.startsWith('BvDecimal::') || expr.startsWith('bv_dec_op(') || expr.startsWith('bv_dec_pow(') || expr.startsWith('bv_to_decimal(')) return decToValue(expr);
  // Use bv_val() for any expression that might be BigInt at runtime
  return `bv_val(${expr})`;
}

function needsObject(actor) {
  const _isPublic = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('subscribe@') || f.name.startsWith('new@'));
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
      if (s.type === 'TypedAssign' && s.typeName === 'Object') return true;
      if (s.type === 'TypedAssign' && (s.value.type === 'ObjectConstructor' || s.value.type === 'ObjectLiteral')) return true;
      if (s.type === 'Assign' && (s.value.type === 'ObjectConstructor' || s.value.type === 'ObjectLiteral')) return true;
      if (s.type === 'TypedAssign' && s.value.type === 'FunctionCallExpr') return true;
    }
  }
  return false;
}

function fnReturnsFunction(fn) {
  const reply = fn.body.find(s => s.type === 'Reply');
  if (!reply) return false;
  return reply.fields.some(f => f.type === 'Function' || (typeof f.type === 'string' && /[-=~]>/.test(f.type)));
}

function needsDotCallAwait(actor) {
  // Only need stdin-based await for non-child DotCallExpr
  return actor.functions.filter(f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update')).some(h => h.body.some(s => {
    if (s.type !== 'DestructureAssign' || s.source.type !== 'DotCallExpr') return false;
    const obj = s.source.object;
    if (obj.type === 'FunctionCallExpr' && obj.callee?.type === 'Identifier' && G.ctx.actorInfo.has(obj.callee.name)) return false;
    return true;
  }));
}

// Every class construction is its own actor with its own state: a class
// gets a per-instance state pool (HashMaps keyed by an instance id). The file
// actor is never constructed by a parent; it needs a self-pool only when it
// refers to Self (classRefersToSelf).
function classNeedsSpawnedInstances(actor) {
  return !!actor;
}

// A class refers to Self when an @-cell or param is typed with `Self` or it
// makes a recursive Self() call.
function classRefersToSelf(actor) {
  if (!actor) return false;
  for (const p of (actor.initParams || [])) {
    if (typeof p.type !== 'string') continue;
    if (p.type === 'Self') return true;
    if (p.type.split('|').some(m => m.trim() === 'Self')) return true;
    if (/\bSelf\b/.test(p.type)) return true;
  }
  const decls = [
    ...(actor.constructorBody || []),
    ...(actor.stateVarDecls || []),
    ...(actor.initBody || []),
  ];
  for (const d of decls) {
    if ((d.type === 'RefDecl' || d.type === 'TypedAssign') && typeof d.typeName === 'string') {
      if (d.typeName === 'Self') return true;
      if (d.typeName.split('|').some(m => m.trim() === 'Self')) return true;
    }
  }
  function bodyHasSelfCall(body) {
    if (!Array.isArray(body)) return false;
    for (const node of body) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'FunctionCallExpr' && node.callee?.type === 'Identifier' && node.callee.name === 'Self') return true;
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (Array.isArray(v) && bodyHasSelfCall(v)) return true;
        if (v && typeof v === 'object' && !Array.isArray(v) && bodyHasSelfCall([v])) return true;
      }
    }
    return false;
  }
  for (const fn of actor.functions || []) {
    if (bodyHasSelfCall(fn.body)) return true;
  }
  return false;
}

export {
  TYPE_MEMBER_OF_FN, TAG_MATCHES_FN, MATCH_TYPES_FN, MATCH_TYPES_POSITIONAL_FN, RUST_OBJECT_PREAMBLE, RUST_WIRE_HELPERS, BV_TY_OF_FN,
  RUST_KEYWORDS, outerRead, buildTypeEnv, inferLiteralType, rustIdent, mintRustSsa, rustSsaResolve, rustType, convertFromValue, toJsonValue, resolveVarExpr, isFunctionArg, isFunctionOnlyConstructor, createRustContext, rsStore, stateKey, findRsAsClauseMatch, findFreeVarsSimple, substituteCaptures, analyzeFunctions, findMutableVars, needsJsonWrap, convertBranchExpr, isBoolExpr, forceJsonWrap, needsObject, fnReturnsFunction, needsDotCallAwait, classNeedsSpawnedInstances, classRefersToSelf,
};
