// Canonical structural equality used by List.contains, .index_of, .replace,
// .replace_first, .before, .after, .starts_with, .ends_with — and by any
// future feature that needs Brevity-level equality.
//
// SEMANTICS (cross-target contract; this file is the JS reference impl):
//   • Integer  — structural by value. BigInt and integral Number compare equal
//                when they represent the same integer.
//   • Text     — structural (===).
//   • Boolean  — structural (===).
//   • null     — equals only null.
//   • Decimal  — value-equal via cmp(). 1 == 1.0 == 1.00 even though the
//                underlying { c, s } pairs differ.
//   • List     — recursive structural over cons cells { head, tail }.
//   • Actor refs / unknown objects — identity (===) only. Two distinct actor
//                refs that "happen to look alike" are NOT equal.
//
// Receiver-type validation in src/validate.js prevents cross-type comparisons
// from reaching this helper in user-visible code paths (e.g. List.contains
// rejects an arg whose type isn't compatible with the list's element type).
//
// The function is exported as a JS module (for direct unit testing) and also
// stringified into the JS-target preamble. Keep the body free of references
// to module-scope identifiers other than `_bv_eq` itself.
export function _bv_eq(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;

  // Decimal: duck-typed as { c: BigInt, s: Number, cmp }. The runtime class
  // BvDecimal matches; nothing user-defined in Brevity has this exact shape.
  const aDec = typeof a === 'object' && typeof a.c === 'bigint' && typeof a.s === 'number' && typeof a.cmp === 'function';
  const bDec = typeof b === 'object' && typeof b.c === 'bigint' && typeof b.s === 'number' && typeof b.cmp === 'function';
  if (aDec && bDec) return a.cmp(b) === 0;
  if (aDec || bDec) return false;

  // Integer cross-type: BigInt vs whole Number compare by BigInt value.
  const aInt = typeof a === 'bigint' || (typeof a === 'number' && Number.isInteger(a));
  const bInt = typeof b === 'bigint' || (typeof b === 'number' && Number.isInteger(b));
  if (aInt && bInt) return BigInt(a) === BigInt(b);

  // List cons cells: walk in lockstep, recurse on heads.
  const aList = typeof a === 'object' && 'head' in a && 'tail' in a;
  const bList = typeof b === 'object' && 'head' in b && 'tail' in b;
  if (aList && bList) {
    let la = a, lb = b;
    while (la !== null && lb !== null) {
      if (!_bv_eq(la.head, lb.head)) return false;
      la = la.tail; lb = lb.tail;
    }
    return la === null && lb === null;
  }

  // Strings, Booleans, plain objects, actor refs: identity already covered by
  // the leading `===`. Reaching here means not equal.
  return false;
}
