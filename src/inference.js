// Shared type inference for reply/return expressions.
// Used by all codegen backends + extract service.

import { TEXT_METHODS, BLOB_METHODS, GRAPHEME_TEXT_METHODS } from './text_methods.js';
import { LIST_METHODS } from './list_methods.js';
import { MATH_METHODS } from './math_methods.js';

const NUMERIC_TYPES = new Set(['Integer', 'Float', 'Decimal']);

// Plural→singular for List element extraction. Mirrors src/parser.js
// BUILT_IN_SINGULAR; duplicated here to avoid a circular import with parser.
const PLURAL_TO_SINGULAR = new Map([
  ['Integers', 'Integer'], ['Texts', 'Text'], ['Floats', 'Float'],
  ['Booleans', 'Boolean'], ['Lists', 'List'], ['Blobs', 'Blob'],
  ['Decimals', 'Decimal'],
]);
const SINGULAR_TO_PLURAL = new Map([...PLURAL_TO_SINGULAR.entries()].map(([p, s]) => [s, p]));

// "List of Integers" → "Integer". Returns 'Anything' when type is unknown
// or non-builtin (singular form is preserved for user types).
// Also unwraps nested lists: "List of Lists of Integers" → "List of Integers".
function listElementType(listType) {
  if (typeof listType !== 'string') return 'Anything';
  if (!listType.startsWith('List of ')) return 'Anything';
  const plural = listType.slice('List of '.length).trim();
  if (plural === 'Lists') return 'List of Anything';
  if (plural.startsWith('Lists of ')) return 'List' + plural.slice('Lists'.length);
  return PLURAL_TO_SINGULAR.get(plural) || plural;
}

// Pluralise a singular element type. "Integer" → "Integers".
// "List of Integers" → "Lists of Integers" (nested lists pluralise the head).
// Falls back to `name + 's'` for user types not in the built-in map.
function pluraliseElement(name) {
  if (typeof name !== 'string') return 'Anythings';
  if (name === 'List of Anything') return 'Lists';
  if (name.startsWith('List of ')) return 'Lists' + name.slice('List'.length);
  return SINGULAR_TO_PLURAL.get(name) || (name + 's');
}

// Public re-exports for validate.js — same inflection logic, no duplication.
export { listElementType, pluraliseElement };

// Type compatibility for List method arg checks. Two types are compatible when
// they're equal, or either is 'Anything' / 'List of Anything' (wildcard).
// Used by validate.js to reject `List.contains([1,2], "x")` etc.
export function typesCompatible(a, b) {
  if (!a || !b) return true; // can't check what we can't infer
  if (a === b) return true;
  if (a === 'Anything' || b === 'Anything') return true;
  if (a === 'List of Anything' || b === 'List of Anything') {
    return typeof a === 'string' && a.startsWith('List') && typeof b === 'string' && b.startsWith('List');
  }
  return false;
}

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
  ListMethodExpr:        LIST_METHODS,
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
    case 'InterpolatedString': return 'Text';
    case 'DecimalLiteral': return 'Decimal';
    case 'FloatLiteral':   return 'Float';
    case 'BoolLiteral':    return 'Boolean';
    case 'NullLiteral':    return 'null';
  }

  // ── ListLiteral — infer "List of <plural>" from first-element type ─────
  // Mixed-type literals fall back to "List of Anything".
  if (expr.type === 'ListLiteral') {
    if (!expr.elements || expr.elements.length === 0) return 'List of Anything';
    const firstType = inferExprType(expr.elements[0], typeEnv);
    if (!firstType) return 'List of Anything';
    return 'List of ' + pluraliseElement(firstType);
  }

  // ── Identifier / RefRead lookup ────────────────────────────────────────
  if (expr.type === 'Identifier' && typeEnv?.has(expr.name)) {
    return typeEnv.get(expr.name);
  }
  if (expr.type === 'RefRead' && typeEnv?.has(expr.name)) {
    return typeEnv.get(expr.name);
  }

  // ── Binary expressions ────────────────────────────────────────────────
  if (expr.type === 'BinaryExpr') {
    const lt = inferExprType(expr.left, typeEnv);
    const rt = inferExprType(expr.right, typeEnv);
    if (!lt || !rt) return null;

    // Comparison operators always produce Boolean
    if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(expr.op)) return 'Boolean';

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
    if (meta) {
      // ListMethodExpr: 'Element' → element type of the receiver list.
      // 'List' → preserve the receiver's parameterised list type, except for
      // `flatten` which unwraps one level (List of Lists of T → List of T).
      if (expr.type === 'ListMethodExpr') {
        if (meta.returns === 'Element') return listElementType(inferExprType(expr.args[0], typeEnv));
        if (meta.returns === 'List') {
          const recv = inferExprType(expr.args[0], typeEnv);
          if (expr.method === 'flatten') {
            // receiver: "List of Lists of T" — element type is "List of T",
            // result element type is element-of-element ("T"), result is "List of Ts".
            const inner = listElementType(recv);
            if (typeof inner !== 'string' || !inner.startsWith('List')) return 'List of Anything';
            const innermost = listElementType(inner);
            return innermost === 'Anything' ? 'List of Anything' : 'List of ' + pluraliseElement(innermost);
          }
          return typeof recv === 'string' && recv.startsWith('List') ? recv : 'List of Anything';
        }
      }
      return meta.returns;
    }
  }

  // ── Math methods ──────────────────────────────────────────────────────
  if (expr.type === 'MathMethodExpr') {
    const meta = MATH_METHODS.get(expr.method);
    if (meta) {
      if (meta.returns === 'pow') {
        // Integer^Integer → Integer, Decimal^Integer → Decimal, else Float
        const base = inferExprType(expr.args[0], typeEnv);
        const exp = inferExprType(expr.args[1], typeEnv);
        if (exp === 'Integer' && (base === 'Integer' || base === 'Decimal')) return base;
        return 'Float';
      }
      if (meta.returns !== 'numeric') return meta.returns;
      // 'numeric': abs returns same type as input, min/max return promoted type
      if (expr.args.length === 1) return inferExprType(expr.args[0], typeEnv);
      if (expr.args.length >= 2) {
        let result = inferExprType(expr.args[0], typeEnv);
        for (let i = 1; i < expr.args.length; i++) {
          const t = inferExprType(expr.args[i], typeEnv);
          if (result && t) result = promoteNumeric(result, t);
          else result = result || t;
        }
        return result;
      }
    }
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
