// Centralized Integer representation for Rust codegen.
// ─── BigInt (arbitrary precision via num-bigint crate) ────────────────────────

/** Rust type name for Integer */
export const INT_TYPE = 'BigInt';

/** Construct an integer literal. Integers are BigInt — no machine-int path. */
export function intLiteral(value) {
  return `BigInt::from_str(${JSON.stringify(String(value))}).unwrap()`;
}

/** Extract an Integer from a serde_json::Value */
export function intFromValue(expr) {
  return `bv_to_bigint(&${expr})`;
}

/** Convert an Integer expression to serde_json::Value */
export function intToValue(expr) {
  return `bv_bigint_to_value(&${expr})`;
}

/** Convert an Integer expression to usize (for indexing) */
export function intToUsize(expr) {
  return `(${expr}).to_usize().unwrap_or(0)`;
}

/** Binary arithmetic: use references to avoid move */
export function intArithOp(left, op, right) {
  return `(&${left} ${op} &${right})`;
}

/** Power operation */
export function intPow(base, exp) {
  return `bv_pow(&${base}, &${exp})`;
}

/** Wrap a raw i64 Rust expression into our Integer type */
export function intFromI64(expr) {
  return `BigInt::from(${expr})`;
}

/** Produce the default integer value (zero) */
export function intZero() {
  return 'BigInt::zero()';
}

/** Check if an intToValue result is already a Value (for forceJsonWrap) */
export function isIntValue(expr) {
  return expr.startsWith('bv_bigint_to_value(');
}

/** Build a Value::Array expression from element expressions.
 *  Each element is wrapped to ensure it's a Value. Uses bv_val() which
 *  handles BigInt, i64, String, bool, and Value transparently. */
export function valueArray(elemExprs) {
  const filtered = elemExprs.filter(e => e !== '');
  if (filtered.length === 0) return 'json!([])';
  const wrapped = filtered.map(e => {
    if (e.startsWith('json!(') || e.startsWith('bv_bigint_to_value(') || e.startsWith('bv_val(') || e === 'Value::Null' || e.startsWith('Value::')) return e;
    if (e.includes('.cloned()') || e.includes('.unwrap_or(')) return e; // already Value
    // Clone simple variables to avoid move issues when used multiple times
    const isSimpleVar = /^[a-z_]\w*$/i.test(e);
    return `bv_val(${isSimpleVar ? `${e}.clone()` : e})`;
  });
  return `Value::Array(vec![${wrapped.join(', ')}])`;
}

/** Wrap an expression that may or may not be Value into a guaranteed Value.
 *  Use this instead of json!() when the expression could be BigInt. */
export function ensureValue(expr, brevityType) {
  if (brevityType === 'Integer') return intToValue(expr);
  if (expr.startsWith('bv_bigint_to_value(') || expr.startsWith('json!(') || expr === 'Value::Null' || expr.includes('.cloned()')) return expr;
  return `json!(${expr})`;
}
