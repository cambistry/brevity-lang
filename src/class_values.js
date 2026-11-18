import { selfAddress } from './codegen/wire_labels.js';

// A class as a value: `k = C`, `k = @C`, `k = class` (src/singleton_classes.js
// resolves `class` to the class's name first).
//
// The value is the class's address, tagged `Class` on the wire. A class declared
// in the file actor is at `:C` under it, so code in the file actor writes it
// `#<:C>`. Code anywhere else (an instance of a class, a class block) can't say
// where the file actor is relative to itself, so it writes the class's absolute
// address, `#<c.bv:C>`, which needs the file's name, as `Self` as a value does.
//
// A name bound to a class (`k = C`) stands for that class wherever it is built
// or reached: `k(args)` is `C(args)`, `k.x` is `C.x`. A class value arriving from
// elsewhere (a `Class` param) can only be passed on and returned for now.
// See notes/class-scope-and-inheritance-2026-11-16.md.

const statementLists = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (node.some(s => s && typeof s === 'object' && typeof s.type === 'string')) visit(node);
    node.forEach(n => statementLists(n, visit));
    return;
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') statementLists(v, visit);
};

const BINDS = new Set(['Assign', 'TypedAssign', 'StateAssign']);
// Where a value is written: a binding's value, a reply's field, a call's arg.
const VALUE_SLOTS = {
  Assign: ['value'], TypedAssign: ['value'], StateAssign: ['value'],
  ImplicitReturn: ['expr'], ExprStatement: [],
};

export function lowerClassValues(actors, byName) {
  const isClass = (a) => a && a.name && !a.singletonOf && !a.membersOf && !/^new__/.test(a.name);
  const classNamed = (name) => (typeof name === 'string' ? (isClass(byName.get(name)) ? byName.get(name) : null) : null);
  // Declared in the file actor (or in a class block that is), so `:C` under it.
  const atFileLevel = (cls) => {
    let at = 'home' in cls ? cls.home : cls.enclosing;
    while (at) {
      const a = byName.get(at);
      if (!a?.membersOf) return false;
      at = a.enclosing ?? null;
    }
    return true;
  };
  const valueOf = (cls, inFileActor) => {
    if (!atFileLevel(cls)) throw new Error(`'${shown(cls)}' as a value: a class declared inside another class isn't supported yet`);
    return { type: 'ClassValue', className: cls.name, label: selfAddress(cls.name), relative: inFileActor };
  };

  for (const actor of actors) {
    const inFileActor = !actor.name;
    const asValue = (expr) => {
      const cls = expr?.type === 'Identifier' || expr?.type === 'RefRead' ? classNamed(expr.name) : null;
      return cls ? valueOf(cls, inFileActor) : null;
    };
    // A class named where a value goes.
    const lowerValues = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(lowerValues); return; }
      if ((node.type === 'RefDecl' || node.type === 'StateVarDecl') && asValue(node.value)) {
        throw new Error(`'${node.name}': a class is bound, not held in a cell — write '${node.name} = ${shownName(node.value.name)}'`);
      }
      for (const key of VALUE_SLOTS[node.type] || []) {
        const v = asValue(node[key]);
        if (v) node[key] = v;
      }
      if (node.type === 'Reply' || node.type === 'Return') {
        for (const f of node.fields || []) {
          for (const key of ['expr', 'value']) {
            const v = asValue(f[key]);
            if (v) f[key] = v;
          }
          if (!f.expr && !f.value && f.name && classNamed(f.name)) { f.expr = valueOf(classNamed(f.name), inFileActor); delete f.name; }
        }
      }
      if ((node.type === 'FunctionCallExpr' || node.type === 'DotCallExpr') && Array.isArray(node.args)) {
        node.args = node.args.map(a => asValue(a) ?? a);
      }
      for (const [k, v] of Object.entries(node)) if (k !== 'loc' && v && typeof v === 'object') lowerValues(v);
    };
    const roots = [actor.functions, actor.initBody, actor.constructorBody, actor.declarationReturn];
    roots.forEach(lowerValues);

    // A name bound to a class stands for it where it's built or reached.
    for (const root of roots) statementLists(root, (list) => {
      for (const s of list) {
        if (!BINDS.has(s?.type) || s.value?.type !== 'ClassValue') continue;
        if (s.type === 'StateAssign' || s.isRef || s.typeName?.startsWith?.('*')) {
          throw new Error(`'${s.name}': a class is bound, not held in a cell — write '${s.name} = ${shownName(s.value.className)}'`);
        }
        if (s.type === 'TypedAssign' && s.typeName !== 'Class') {
          throw new Error(`'${s.name} ${s.typeName} = ${shownName(s.value.className)}': a class's type is 'Class' ('${s.name} ${s.typeName}' is an actor of '${s.typeName}')`);
        }
        Object.assign(s, { type: 'TypedAssign', typeName: 'Class' });
        rename(list, s.name, s.value.className);
      }
    });
  }
}

// `k(…)`, `k.x`, `k.x <- …` and `k::x` with `k` bound to class `to`.
function rename(list, from, to) {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    // A nested binding of the same name ends the alias there.
    if (n.type === 'Function' && (n.params || []).some(p => p.name === from)) return;
    if (n.type === 'FunctionCallExpr' && n.callee?.type === 'Identifier' && n.callee.name === from) n.callee = { ...n.callee, name: to };
    if ((n.type === 'DotCallExpr' || n.type === 'DotAccessExpr') && n.object?.type === 'Identifier' && n.object.name === from) n.object = { ...n.object, name: to };
    if (n.type === 'RefRead' && n.name === from) throw new Error(`'${from}' is a class, bound — it isn't read as a cell`);
    if (n.type === 'ActorFieldSet' && n.objectName === from) n.objectName = to;
    if (n.type === 'QualifiedMember' && (n.receiver === from || n.object?.name === from)) {
      throw new Error(`'${from}::${n.name ?? n.member}' — '::' names a member of the class written there, so it isn't reached through a value: write '${shownName(to)}::${n.name ?? n.member}'`);
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v && typeof v === 'object') visit(v);
  };
  for (const s of list) {
    if (BINDS.has(s?.type) && s.name === from && s.value?.type !== 'ClassValue') break;
    visit(s);
  }
}

const shownName = (name) => String(name).replace(/__pub$/, '').replace(/[!.]$/, '');
const shown = (cls) => shownName(cls.sourceName ?? cls.name).replace(/^@/, '');
