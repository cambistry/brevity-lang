// The type of an expression, as an encoded type (src/type_enc.js). An env maps a
// name to its encoded type.
//
// An unknown type is `undefined`. `null` is the type of `null`, as in an encoding.

import { TEXT_METHODS, BLOB_METHODS, GRAPHEME_TEXT_METHODS } from './text_methods.js';
import { LIST_METHODS } from './list_methods.js';
import { MATH_METHODS } from './math_methods.js';
import { listOf, isList, listElement } from './type_enc.js';

const NUMERIC = new Set(['Integer', 'Float', 'Decimal']);
export const ANY_LIST = listOf('Anything');

const METHOD_REGISTRY = {
  TextMethodExpr: TEXT_METHODS,
  BlobMethodExpr: BLOB_METHODS,
  GraphemeTextMethodExpr: GRAPHEME_TEXT_METHODS,
  ListMethodExpr: LIST_METHODS,
};

// A registry names what a method returns: a type, or `List` for a list of anything.
const registryType = (returns) => (returns === 'List' ? ANY_LIST : returns);

const known = (t) => t !== undefined;

// Two types agree for a List method's arg: the same, either one `Anything`, or a
// list of anything beside another list.
export function typesCompatible(a, b) {
  if (!known(a) || !known(b)) return true;
  if (a === b) return true;
  if (a === 'Anything' || b === 'Anything') return true;
  if (a === ANY_LIST || b === ANY_LIST) return isList(a) && isList(b);
  return false;
}

function promoteNumeric(a, b) {
  if (a === b) return a;
  if (a === 'Float' || b === 'Float') return 'Float';
  if (a === 'Decimal' || b === 'Decimal') return 'Decimal';
  return undefined;
}

// What a block-local bind makes its name, in the block's own copy of the env. A value
// that can't be inferred leaves no entry, not the outer name's type.
export function bindLocalType(env, s) {
  const type = s.type === 'TypedAssign' ? s.typeNameEnc : inferType(s.value, env);
  if (known(type)) env.set(s.name, type);
  else env.delete(s.name);
}

// The type of `lt op rt` for any operator but `??`; unknown when either side is, or
// the pair has no rule (`Text + Integer`).
export function binaryResultType(op, lt, rt) {
  if (!known(lt) || !known(rt)) return undefined;
  if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) return 'Boolean';
  if (NUMERIC.has(lt) && NUMERIC.has(rt)) return promoteNumeric(lt, rt);
  if (lt === 'Text' && rt === 'Text') return 'Text';
  // List + List concatenates; the more specific of the two when one holds anything.
  if (op === '+' && isList(lt) && isList(rt)) return lt === ANY_LIST ? rt : lt;
  return undefined;
}

export function inferType(expr, env) {
  if (!expr) return undefined;
  switch (expr.type) {
    case 'IntLiteral': return 'Integer';
    case 'StringLiteral': return 'Text';
    case 'InterpolatedString': return 'Text';
    case 'DecimalLiteral': return 'Decimal';
    case 'FloatLiteral': return 'Float';
    case 'BoolLiteral': return 'Boolean';
    case 'NullLiteral': return null;
    case 'TypeConstruction': return expr.typeNameEnc;
    case 'AsExpr': return expr.typeNameEnc;
    case 'PresenceCheck': return 'Boolean';
    case 'ActorValue': return 'Actor';
    case 'SelfValue': return 'Actor';
    case 'FunctionCallExpr': if (known(expr.resultTypeEnc)) return expr.resultTypeEnc; break;
  }

  // A list literal holds what its first element is; mixed or empty, anything.
  if (expr.type === 'ListLiteral') {
    if (!expr.elements?.length) return ANY_LIST;
    const first = inferType(expr.elements[0], env);
    return known(first) ? listOf(first) : ANY_LIST;
  }

  if ((expr.type === 'Identifier' || expr.type === 'RefRead') && env?.has(expr.name)) return env.get(expr.name);

  if (expr.type === 'BinaryExpr') {
    const lt = inferType(expr.left, env);
    const rt = inferType(expr.right, env);
    // `??` falls back from left to right: the other side when one is `null`.
    if (expr.op === '??') {
      if (lt === null) return rt;
      if (rt === null) return lt;
      return known(lt) ? lt : rt;
    }
    return binaryResultType(expr.op, lt, rt);
  }

  const registry = METHOD_REGISTRY[expr.type];
  const meta = registry?.get(expr.method);
  if (meta) {
    if (expr.type === 'ListMethodExpr') {
      // `Element`: the receiver's element. `List`: the receiver's list, except
      // `flatten`, which unwraps one level.
      if (meta.returns === 'Element') return listElement(inferType(expr.args[0], env));
      if (meta.returns === 'List') {
        const recv = inferType(expr.args[0], env);
        if (expr.method === 'flatten') {
          const inner = listElement(recv);
          if (!isList(inner)) return ANY_LIST;
          const innermost = listElement(inner);
          return innermost === 'Anything' ? ANY_LIST : listOf(innermost);
        }
        return isList(recv) ? recv : ANY_LIST;
      }
    }
    return registryType(meta.returns);
  }

  if (expr.type === 'MathMethodExpr') {
    const math = MATH_METHODS.get(expr.method);
    if (math) {
      if (math.returns === 'pow') {
        // Integer^Integer is an Integer, Decimal^Integer a Decimal; else a Float.
        const base = inferType(expr.args[0], env);
        const exp = inferType(expr.args[1], env);
        if (exp === 'Integer' && (base === 'Integer' || base === 'Decimal')) return base;
        return 'Float';
      }
      if (math.returns !== 'numeric') return math.returns;
      // `abs` is its input's type; `min` and `max` promote.
      if (expr.args.length === 1) return inferType(expr.args[0], env);
      if (expr.args.length >= 2) {
        let result = inferType(expr.args[0], env);
        for (let i = 1; i < expr.args.length; i++) {
          const t = inferType(expr.args[i], env);
          if (known(result) && known(t)) result = promoteNumeric(result, t);
          else result = known(result) ? result : t;
        }
        return result;
      }
    }
  }

  if (expr.type === 'SizeExpr') return 'Integer';
  if (expr.type === 'ParenExpr' && expr.expr) return inferType(expr.expr, env);
  if (expr.type === 'UnaryExpr') {
    if (expr.op === '!' || expr.op === 'not') return 'Boolean';
    if (expr.op === '-') return inferType(expr.operand ?? expr.arg, env);
  }
  return undefined;
}
