// Centralized Integer representation for Rust codegen.
// ─── BigInt (arbitrary precision via num-bigint crate) ────────────────────────

/** Rust type name for Integer */
export const INT_TYPE = 'BigInt';

/** Construct an integer literal */
export function intLiteral(value) {
  return `BigInt::from(${value}i64)`;
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

/** Build a Value::Array expression from a list of expressions that may contain BigInt.
 *  Each element is wrapped via forceJsonWrap-like logic. */
export function valueArray(elemExprs) {
  // If any element looks like a BigInt expression, use Value::Array(vec![...])
  // with each element properly wrapped to Value
  const hasBigInt = elemExprs.some(e =>
    e.startsWith('BigInt::from(') || e.startsWith('(&') || e.startsWith('bv_pow(') || e.startsWith('bv_to_bigint(')
  );
  if (hasBigInt) {
    const wrapped = elemExprs.map(e => {
      if (e.startsWith('BigInt::from(') || e.startsWith('(&') || e.startsWith('bv_pow(') || e.startsWith('bv_to_bigint(')) {
        return intToValue(e);
      }
      if (e.startsWith('json!(') || e.startsWith('bv_bigint_to_value(') || e === 'Value::Null' || e.includes('.cloned()')) return e;
      return `json!(${e})`;
    });
    return `Value::Array(vec![${wrapped.join(', ')}])`;
  }
  return `json!([${elemExprs.join(', ')}])`;
}

/** Wrap an expression that may or may not be Value into a guaranteed Value.
 *  Use this instead of json!() when the expression could be BigInt. */
export function ensureValue(expr, brevityType) {
  if (brevityType === 'Integer') return intToValue(expr);
  if (expr.startsWith('bv_bigint_to_value(') || expr.startsWith('json!(') || expr === 'Value::Null' || expr.includes('.cloned()')) return expr;
  return `json!(${expr})`;
}
