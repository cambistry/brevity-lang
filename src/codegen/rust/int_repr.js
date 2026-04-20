// Centralized Integer representation for Rust codegen.
// Change these functions to switch between i64 and BigInt.

// ─── Current: i64 ────────────────────────────────────────────────────────────

/** Rust type name for Integer */
export const INT_TYPE = 'i64';

/** Construct an integer literal */
export function intLiteral(value) {
  return String(value);
}

/** Extract an Integer from a serde_json::Value */
export function intFromValue(expr) {
  return `${expr}.as_i64().unwrap_or(0)`;
}

/** Convert an Integer expression to serde_json::Value */
export function intToValue(expr) {
  return `json!(${expr})`;
}

/** Convert an Integer expression to usize (for indexing) */
export function intToUsize(expr) {
  return `(${expr}) as usize`;
}

/** Binary arithmetic: wrap operands with references if needed (no-op for i64) */
export function intArithOp(left, op, right) {
  return `(${left} ${op} ${right})`;
}

/** Power operation */
export function intPow(base, exp) {
  return `(${base}).pow((${exp}) as u32)`;
}

/** Wrap a raw i64 Rust expression into our Integer type */
export function intFromI64(expr) {
  return expr;
}

/** Produce the default integer value (zero) */
export function intZero() {
  return '0';
}

/** Check if an intToValue result is already a Value (for forceJsonWrap) */
export function isIntValue(expr) {
  return expr.startsWith('json!(');
}
