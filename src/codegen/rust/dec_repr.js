// Centralized Decimal representation for Rust codegen.
// ─── BvDecimal (scaled BigInt, exact arithmetic) ─────────────────────────────

import { parseDecimalLiteral } from '../decimal_utils.js';

/** Rust type name for Decimal */
export const DEC_TYPE = 'BvDecimal';

/** Construct a decimal literal */
export function decLiteral(value) {
  const { coeff, scale } = parseDecimalLiteral(value);
  return `BvDecimal::new(BigInt::from(${coeff}i64), ${scale})`;
}

/** Extract a Decimal from a serde_json::Value */
export function decFromValue(expr) {
  return `bv_to_decimal(&${expr})`;
}

/** Convert a Decimal expression to serde_json::Value */
export function decToValue(expr) {
  return `bv_decimal_to_value(&${expr})`;
}

/** Binary arithmetic via bv_dec_op helper */
export function decArithOp(left, op, right) {
  return `bv_dec_op(&${left}, "${op}", &${right})`;
}

/** Power operation */
export function decPow(base, exp) {
  return `bv_dec_pow(&${base}, &${exp})`;
}

/** Produce the default decimal value (zero) */
export function decZero() {
  return 'BvDecimal::new(BigInt::zero(), 0)';
}

/** Check if a decToValue result is already a Value */
export function isDecValue(expr) {
  return expr.startsWith('bv_decimal_to_value(');
}
