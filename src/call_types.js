import { returnShapes } from './return_shapes.js';
import { isUnion, isInstance, ownNames } from './type_enc.js';
import { markSendOperands, isSendOperand } from './codegen/send_operands.js';

// The type of a call to a function of this actor, or of one enclosing it
// (src/outer_reads.js marks those `outerFnCall`), when that function has one
// return of one value with a known type: `f()` of `f = () -> 16` is an Integer.
// Kept on a call that is an operand (`resultTypeEnc`, encoded) for inference
// (src/type_infer.js), so `x Integer = f() + #f()`
// is Integer arithmetic on every target.

export function markCallResultTypes(ast) {
  const byName = new Map(ast.actors.map(a => [a.name ?? null, a]));
  const resultOf = new Map();
  const typeOf = (actor, name) => {
    const key = `${actor.name ?? ''}\u0000${name}`;
    if (resultOf.has(key)) return resultOf.get(key);
    resultOf.set(key, undefined); // a recursive call doesn't type itself
    const fns = (actor.functions || []).filter(f => f.name === name);
    let type;
    if (fns.length === 1 && !fns[0].params?.some(p => p.rest)) {
      const { alternatives, orSelf, opaque } = returnShapes(fns[0]);
      const [only] = alternatives;
      if (!orSelf && !opaque && alternatives.length === 1 && only.length === 1 && !only[0].name
        && only[0].typeEnc !== undefined && only[0].typeEnc !== 'Anything' && !isUnion(only[0].typeEnc)) type = only[0].typeEnc;
    }
    resultOf.set(key, type);
    return type;
  };
  // A call on an actor of one of the file's classes (`k.n()`, `k` bound by `k = K()`,
  // typed with the class, or a cell of it), as an operand, types as that class's
  // function does. Elsewhere its reply claims no type: an unannotated bind of it
  // takes none.
  const classOfType = (t) => {
    if (!isInstance(t)) return null;
    const names = ownNames(t);
    return names?.length === 1 ? byName.get(names[0]) ?? null : null;
  };
  const classOfValue = (v) => (v?.type === 'FunctionCallExpr' && v.callee?.type === 'Identifier' && byName.get(v.callee.name)?.name ? byName.get(v.callee.name) : null);
  const actorsBound = (actor, fn) => {
    const env = new Map();
    for (const c of actor.stateVarDecls || []) { const k = classOfType(c.typeNameEnc); if (k) env.set(c.name, k); }
    for (const p of fn?.params || []) { const k = classOfType(p.typeEnc); if (k) env.set(p.name, k); }
    const scan = (n) => {
      if (!n || typeof n !== 'object' || n.type === 'Function') return;
      if (Array.isArray(n)) { n.forEach(scan); return; }
      if ((n.type === 'Assign' || n.type === 'TypedAssign') && n.name) {
        const k = classOfType(n.typeNameEnc) ?? classOfValue(n.value);
        if (k) env.set(n.name, k);
      }
      for (const v of Object.values(n)) if (v && typeof v === 'object') scan(v);
    };
    scan(fn?.body ?? actor.constructorBody);
    return env;
  };
  const markSends = (actor, fn) => {
    const env = actorsBound(actor, fn);
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
      if (n.type !== 'DotCallExpr' || n.resultTypeEnc !== undefined || !isSendOperand(n)) return;
      const o = n.object;
      // An outer name (`class`, a cell of an enclosing actor) carries the actor it names.
      const cls = (o?.type === 'Identifier' || o?.type === 'RefRead') ? env.get(o.name) ?? (o.outerTypeEnc ? byName.get(o.outerTypeEnc) : null) : null;
      if (!cls) return;
      const t = typeOf(cls, '@' + n.method) ?? typeOf(cls, n.method);
      if (t !== undefined) n.resultTypeEnc = t;
    };
    visit(fn?.body ?? actor.constructorBody);
  };
  markSendOperands(ast);
  for (const actor of ast.actors) {
    for (const fn of actor.functions || []) markSends(actor, fn);
    markSends(actor, null);
  }
  for (const actor of ast.actors) {
    // Only an operand needs it: elsewhere a call's reply already says its type.
    const visit = (node, operand = false) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(n => visit(n)); return; }
      const arith = node.type === 'BinaryExpr' || node.type === 'UnaryExpr';
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, arith);
      if (!operand || node.type !== 'FunctionCallExpr' || node.callee?.type !== 'Identifier' || node.resultTypeEnc !== undefined) return;
      const owner = node.inheritedFrom ? byName.get(node.inheritedFrom) : node.outerFnCall ? byName.get(node.outerClass ?? null) : actor;
      if (!owner) return;
      const t = typeOf(owner, node.callee.name);
      if (t === undefined) return;
      node.resultTypeEnc = t;
    };
    for (const fn of actor.functions || []) visit(fn.body);
    visit(actor.initBody);
    visit(actor.constructorBody);
    visit(actor.initParams);
  }
}
