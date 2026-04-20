// Shared type inference for reply/return expressions.
// Used by all codegen backends + extract service.

import { TEXT_METHODS, BLOB_METHODS, GRAPHEME_TEXT_METHODS } from './text_methods.js';

const NUMERIC_TYPES = new Set(['Integer', 'Float', 'Decimal']);

// Numeric promotion: Integer + Float → Float, Integer + Decimal → Decimal, etc.
function promoteNumeric(a, b) {
  if (a === b) return a;
  if (a === 'Float' || b === 'Float') return 'Float';
  if (a === 'Decimal' || b === 'Decimal') return 'Decimal';
  return null;
}

// Map AST method-expr node types to their method registries.
const METHOD_REGISTRY = {
  TextMethodExpr:        TEXT_METHODS,
  BlobMethodExpr:        BLOB_METHODS,
  GraphemeTextMethodExpr: GRAPHEME_TEXT_METHODS,
};

/**
 * Infer the Brevity type of an expression from its AST node and a type
 * environment (Map<name, typeName>).  Returns the type string or null.
 */
export function inferExprType(expr, typeEnv) {
  if (!expr) return null;

  // ── Literals ──────────────────────────────────────────────────────────
  switch (expr.type) {
    case 'IntLiteral':     return 'Integer';
    case 'StringLiteral':  return 'Text';
    case 'DecimalLiteral': return 'Decimal';
    case 'FloatLiteral':   return 'Float';
    case 'BoolLiteral':    return 'Boolean';
    case 'NullLiteral':    return 'null';
  }

  // ── Identifier lookup ─────────────────────────────────────────────────
  if (expr.type === 'Identifier' && typeEnv?.has(expr.name)) {
    return typeEnv.get(expr.name);
  }

  // ── Binary expressions ────────────────────────────────────────────────
  if (expr.type === 'BinaryExpr') {
    const lt = inferExprType(expr.left, typeEnv);
    const rt = inferExprType(expr.right, typeEnv);
    if (!lt || !rt) return null;

    // Comparison operators always produce Boolean
    if (['==', '!=', '<', '>', '<=', '>='].includes(expr.op)) return 'Boolean';

    // Numeric arithmetic
    if (NUMERIC_TYPES.has(lt) && NUMERIC_TYPES.has(rt)) return promoteNumeric(lt, rt);

    // String concatenation
    if (lt === 'Text' && rt === 'Text') return 'Text';

    return null;
  }

  // ── Built-in type methods ─────────────────────────────────────────────
  const registry = METHOD_REGISTRY[expr.type];
  if (registry) {
    const meta = registry.get(expr.method);
    if (meta) return meta.returns;
  }

  // ── SizeExpr → always Integer ─────────────────────────────────────────
  if (expr.type === 'SizeExpr') return 'Integer';

  // ── Parenthesized / grouped expression ────────────────────────────────
  if (expr.type === 'ParenExpr' && expr.expr) return inferExprType(expr.expr, typeEnv);

  // ── Negation ──────────────────────────────────────────────────────────
  if (expr.type === 'UnaryExpr') {
    if (expr.op === '!' || expr.op === 'not') return 'Boolean';
    if (expr.op === '-') return inferExprType(expr.operand ?? expr.arg, typeEnv);
  }

  return null;
}
