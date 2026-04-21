// Shared Decimal utilities for all codegen targets.
// Parses decimal literals at codegen time and checks division termination.

/**
 * Parse a decimal literal value into coefficient and scale.
 * Coefficient is returned with leading zeros stripped so it is a valid
 * BigInt / integer literal in every target.
 * parseDecimalLiteral(3.14) → { coeff: '314', scale: 2 }
 * parseDecimalLiteral(-0.1) → { coeff: '-1', scale: 1 }
 * parseDecimalLiteral(5.0) → { coeff: '5', scale: 0 }
 * parseDecimalLiteral(0.0) → { coeff: '0', scale: 0 }
 */
export function parseDecimalLiteral(value) {
  const s = String(value);
  const dot = s.indexOf('.');
  if (dot === -1) return { coeff: stripLeadingZeros(s), scale: 0 };
  const intPart = s.slice(0, dot);
  let fracPart = s.slice(dot + 1);
  // Trailing zeros on the fractional part don't change value; drop them
  // so the coefficient matches the minimal scale.
  while (fracPart.length > 0 && fracPart[fracPart.length - 1] === '0') {
    fracPart = fracPart.slice(0, -1);
  }
  const coeff = stripLeadingZeros(intPart + fracPart);
  return { coeff, scale: fracPart.length };
}

function stripLeadingZeros(s) {
  const neg = s.startsWith('-');
  let digits = neg ? s.slice(1) : s;
  while (digits.length > 1 && digits[0] === '0') digits = digits.slice(1);
  return neg ? '-' + digits : digits;
}

/**
 * Check if decimal division a/b terminates (i.e., produces a finite decimal).
 * coeffA/coeffB are bigint-like strings; scaleA/scaleB are integers.
 * Returns true if the division terminates.
 */
export function isTerminatingDivision(coeffA, scaleA, coeffB, _scaleB) {
  let num = BigInt(coeffA);
  let den = BigInt(coeffB);
  if (den === 0n) return false; // division by zero
  if (num === 0n) return true;
  num = num < 0n ? -num : num;
  den = den < 0n ? -den : den;
  // GCD to reduce
  let a = num, b = den;
  while (b > 0n) { [a, b] = [b, a % b]; }
  den = den / a;
  // Check denominator has only factors 2 and 5
  while (den % 2n === 0n) den /= 2n;
  while (den % 5n === 0n) den /= 5n;
  return den === 1n;
}

/**
 * Check if 1/base terminates (for negative exponent check).
 * base is { coeff, scale }.
 */
export function isTerminatingReciprocal(coeff, scale) {
  return isTerminatingDivision('1', 0, coeff, scale);
}
