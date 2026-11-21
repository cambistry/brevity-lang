import { returnShapes } from './return_shapes.js';

// The type of a call to a function of this actor, or of one enclosing it
// (src/outer_reads.js marks those `outerFnCall`), when that function has one
// return of one value with a known type: `f()` of `f = -> 16` is an Integer.
// Kept on a call that is an operand (`resultType`) for inference
// (src/inference.js), so `x Integer = f() + #f()` is Integer arithmetic on every
// target.

export function markCallResultTypes(ast) {
  const byName = new Map(ast.actors.map(a => [a.name ?? null, a]));
  const resultOf = new Map();
  const typeOf = (actor, name) => {
    const key = `${actor.name ?? ''}\u0000${name}`;
    if (resultOf.has(key)) return resultOf.get(key);
    resultOf.set(key, null); // a recursive call doesn't type itself
    const fns = (actor.functions || []).filter(f => f.name === name);
    let type = null;
    if (fns.length === 1 && !fns[0].params?.some(p => p.rest)) {
      const { alternatives, orSelf, opaque } = returnShapes(fns[0]);
      const [only] = alternatives;
      if (!orSelf && !opaque && alternatives.length === 1 && only.length === 1 && !only[0].name
        && only[0].type && only[0].type !== 'Anything' && !only[0].type.includes('|')) type = only[0].type;
    }
    resultOf.set(key, type);
    return type;
  };
  for (const actor of ast.actors) {
    // Only an operand needs it: elsewhere a call's reply already says its type.
    const visit = (node, operand = false) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n)); return; }
      const arith = node.type === 'BinaryExpr' || node.type === 'UnaryExpr';
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, arith);
      if (!operand || node.type !== 'FunctionCallExpr' || node.callee?.type !== 'Identifier' || node.resultType) return;
      const owner = node.inheritedFrom ? byName.get(node.inheritedFrom) : node.outerFnCall ? byName.get(node.outerClass ?? null) : actor;
      if (!owner) return;
      const t = typeOf(owner, node.callee.name);
      if (t) node.resultType = t;
    };
    for (const fn of actor.functions || []) visit(fn.body);
    visit(actor.initBody);
    visit(actor.constructorBody);
    visit(actor.initParams);
  }
}
