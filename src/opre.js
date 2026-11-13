// Remote calls, lowered to Opre messages before any target sees them.
//
// A call on another actor is a message: an address, an op, and args. This pass
// works the address out once, for every target, and leaves it on the call as
// `call.opre`:
//
//   address  { kind: 'static', wire: 'Svc s inner', tokens: [...], dep: 'Svc' }
//              the whole address is known here: a dependency, a member path
//              through it, or a local bound once to one of those
//            { kind: 'value', name?, path }
//              the receiver is a value the target evaluates (a cell, a local,
//              a param, an own singleton); its runtime value is the address,
//              and `path` the member tokens under it, for an actor of a
//              dependency's class (`b.tally.get()` for a `b = Svc.Box(1)`)
//   op       the wire op: the member called, bare (`@get` is `get`)
//   args     the call's own `args`: the target builds its slots and their `ty`
//            from them, as before (the message holds no AST nodes, so walkers
//            don't meet an arg twice)
//   doc      the service document the call resolves against, when there is one
//   label    how the receiver reads in source, for messages ('Svc.s')
//
// A member path is space-delimited tokens (src/codegen/opre_tokens.js):
// `Svc.s.inner.ping()` is `ping` to `Svc s inner`, a public member `.x`
// travelling bare. See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
//
// A sub-service read in value position (`x = Svc.s`) is that address, too, when
// the document says `s` is one: `expr.opreAddress`. A local bound once to an
// address like that stands for it, so `x.get()` is `get` to `Svc s`.
//
// How a message is delivered (in process or on the wire, a call or a send) is
// still each target's choice. Where it goes comes from here.

// A document hangs off the message without being part of the tree: AST walkers
// (`Object.values`) mustn't wander into it.
import { _opre_join as joinAddress } from './codegen/opre_tokens.js';

const withDoc = (obj, doc) => Object.defineProperty(obj, 'doc', { value: doc, enumerable: false });

const isBinding = (n) => (n?.type === 'Assign' || n?.type === 'TypedAssign') && typeof n.name === 'string';

// Every name a function binds anywhere in its body, with how many times.
function bindingCounts(fn) {
  const counts = new Map();
  const bump = (name) => counts.set(name, (counts.get(name) || 0) + 1);
  const walk = (node, top) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, top)); return; }
    if (!top && (node.type === 'FunctionDecl' || node.type === 'Function')) {
      // A nested function's params shadow; its own binds are its own, but they
      // still make a name unsafe to fold across the whole body.
      for (const p of node.params || []) if (p?.name) bump(p.name);
    }
    if (isBinding(node) || node.type === 'RefDecl' || node.type === 'SetStatement' || node.type === 'ForStatement') {
      if (typeof node.name === 'string') bump(node.name);
    }
    for (const item of Array.isArray(node.pattern) ? node.pattern : []) if (item?.name) bump(item.name);
    if (typeof node.catchName === 'string') bump(node.catchName);
    for (const [k, v] of Object.entries(node)) if (k !== 'opre' && v && typeof v === 'object') walk(v, false);
  };
  walk(fn.body, true);
  for (const p of fn.params || []) if (p?.name) bump(p.name);
  return counts;
}

// The member path under a receiver, outermost first: `Svc.s.inner` is
// { root: Identifier Svc, members: ['s', 'inner'] }.
function memberPath(expr) {
  const members = [];
  let node = expr;
  while (node?.type === 'DotAccessExpr') { members.unshift(node.property); node = node.object; }
  return { root: node, members };
}

// The sub-document a member path leads to, or where it falls off.
export function walkServices(doc, members) {
  let at = doc;
  for (let i = 0; i < members.length; i++) {
    const next = at?.__services?.[members[i]];
    if (!next) return { doc: null, failedAt: i };
    at = next;
  }
  return { doc: at, failedAt: -1 };
}

export function lowerRemoteCalls(ast, remotesParsed = {}) {
  const dependencies = new Set((ast.dependencies || []).map(d => d.name));
  // Names a header destructure binds (`(:Counter)`) aren't the alias.
  for (const d of ast.dependencies || []) for (const e of d.destructures || []) dependencies.delete(e.local);

  // An actor of a dependency's class: its document, for a path through it.
  const constructed = (value) => (value?.type === 'FunctionCallExpr' && value.callee?.type === 'Identifier'
    && dependencies.has(value.callee.name) && remotesParsed[value.callee.name]) || null;

  for (const actor of ast.actors || []) {
    const cells = new Set((actor.stateVarDecls || []).map(v => v.name));
    const params = new Set((actor.initParams || []).map(p => p.name));
    // Cells holding one: `box = Svc.Box(1)`.
    const cellInstances = new Map();
    for (const st of actor.initBody || []) {
      const doc = st?.type === 'StateAssign' && constructed(st.value);
      if (doc) cellInstances.set(st.name, doc);
    }
    const scopes = [...(actor.functions || []), { body: actor.initBody || [], params: [] }, { body: actor.constructorBody || [], params: [] }];
    for (const fn of scopes) {
      if (!fn || !Array.isArray(fn.body)) continue;
      const counts = bindingCounts(fn);
      lowerScope(fn.body, {
        remotesParsed,
        isDep: (name) => dependencies.has(name) && !counts.has(name) && !cells.has(name) && !params.has(name),
        foldable: (name) => counts.get(name) === 1,
        constructed,
        cellInstance: (name) => (counts.has(name) ? null : cellInstances.get(name) || null),
      });
    }
  }
  // Whatever no function scope reached: no locals to fold there.
  lowerScope(ast, { remotesParsed, isDep: (name) => dependencies.has(name), foldable: () => false, onlyNew: true });
}

function lowerScope(body, { remotesParsed, isDep, foldable, constructed = () => null, cellInstance = () => null, onlyNew = false }) {
  // Locals bound once to a static address: name → { tokens, doc, label, dep }.
  const statics = new Map();
  // Locals bound once to an actor of a dependency's class: name → its document.
  const instances = new Map();
  const instanceDoc = (root) => ((root?.type === 'Identifier' || root?.type === 'RefRead')
    ? instances.get(root.name) || cellInstance(root.name) : null);

  // A receiver chain whose root is known here: a dependency or a static local.
  const staticRoot = (root) => {
    if (root?.type !== 'Identifier') return null;
    if (isDep(root.name)) {
      const doc = remotesParsed[root.name] || null;
      return { tokens: [root.name], doc, label: root.name, dep: root.name };
    }
    return statics.get(root.name) || null;
  };

  // `Svc.s` (value position): an address only when the document says each
  // member is a sub-service.
  const addressValue = (expr) => {
    const { root, members } = memberPath(expr);
    const base = staticRoot(root);
    if (!base?.doc) return null;
    const { doc, failedAt } = walkServices(base.doc, members);
    if (failedAt >= 0) return null;
    return {
      tokens: [...base.tokens, ...members],
      doc,
      label: [base.label, ...members].join('.'),
      dep: base.dep,
    };
  };

  const lowerCall = (call) => {
    const { root, members } = memberPath(call.object);
    const base = staticRoot(root);
    const op = call.method;
    if (base) {
      const tokens = [...base.tokens, ...members];
      let doc = null;
      let missing = null;
      if (base.doc) {
        const walked = walkServices(base.doc, members);
        if (walked.failedAt >= 0) missing = { label: [base.label, ...members.slice(0, walked.failedAt)].join('.'), member: members[walked.failedAt] };
        doc = walked.doc;
      }
      // A read of a cell is `$get` to the cell: its name is the last token. A
      // prop stays an op (`{op: 'count'}`); see cellRead.
      const read = cellRead(doc, op, call);
      if (read) tokens.push(op);
      call.opre = withDoc({
        address: { kind: 'static', wire: joinAddress(tokens), tokens, dep: base.dep },
        op: read ? '$get' : op,
        label: [base.label, ...members].join('.'),
        ...(missing ? { missing } : {}),
      }, doc);
      return;
    }
    // A path through an actor of a dependency's class: its runtime address, then
    // the member tokens (`b.tally.get()` is `@get` to `<b> tally`).
    const inst = members.length ? instanceDoc(root) : null;
    if (inst) {
      const walked = walkServices(inst, members);
      call.opre = withDoc({
        address: { kind: 'value', name: root.name, path: members },
        op,
        label: [root.name, ...members].join('.'),
        ...(walked.failedAt >= 0 ? { missing: { label: [root.name, ...members.slice(0, walked.failedAt)].join('.'), member: members[walked.failedAt] } } : {}),
      }, walked.doc);
      return;
    }
    // Anything else is a value the target evaluates.
    const name = (call.object?.type === 'Identifier' || call.object?.type === 'RefRead') ? call.object.name : null;
    call.opre = withDoc({ address: { kind: 'value', ...(name ? { name } : {}), path: [] }, op, label: name }, null);
  };

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    // Children first, so a bind sees its value lowered. A nested function reads
    // what we bound once, so it folds there too.
    for (const [k, v] of Object.entries(node)) if (k !== 'opre' && k !== 'opreAddress' && v && typeof v === 'object') visit(v);
    if (node.type === 'DotCallExpr' && !(onlyNew && node.opre)) lowerCall(node);
    if (node.type === 'DotAccessExpr' && !node.opreAddress) {
      const addr = addressValue(node);
      if (addr) node.opreAddress = withDoc({ wire: joinAddress(addr.tokens), tokens: addr.tokens, label: addr.label, dep: addr.dep }, addr.doc);
    }
    if (isBinding(node) && foldable(node.name)) {
      const addr = node.value?.opreAddress ?? (node.value?.type === 'Identifier' ? statics.get(node.value.name) : null);
      if (addr) statics.set(node.name, addr);
      const doc = constructed(node.value);
      if (doc) instances.set(node.name, doc);
    }
  };
  visit(body);
}

// A member of a service document that is a cell (`val &Integer`, `val *Integer`),
// not a prop (`val Integer`) or a function. Its read is `$get` sent to it.
export function fieldOf(doc, name) {
  return doc?.__fields?.[name] ?? null;
}

// `Svc.s.val` when `Svc` is a dependency: the member's label, name and the
// document it's declared in, with its field record if it is one.
export function remoteMember(expr, remotesParsed = {}) {
  if (expr?.type !== 'DotAccessExpr') return null;
  const { root, members } = memberPath(expr.object);
  if (root?.type !== 'Identifier' || !remotesParsed[root.name]) return null;
  const { doc } = walkServices(remotesParsed[root.name], members);
  if (!doc) return null;
  return { root: root.name, label: [root.name, ...members, expr.property].join('.'), name: expr.property, doc, field: fieldOf(doc, expr.property) };
}

const cellRead = (doc, op, call) => !call.args?.length && fieldOf(doc, op)?.cell === true && !fieldOf(doc, op).writeOnly;

// What the document says a lowered call resolves to: its signatures, or why it
// has none. `null` when there's nothing to check it against.
export function resolveLoweredCall(call) {
  const o = call?.opre;
  if (!o || (o.address.kind !== 'static' && !o.address.path?.length)) return null;
  if (o.missing) return { error: `'${o.missing.label}' has no sub-service '${o.missing.member}'` };
  if (!o.doc) return null;
  return { doc: o.doc, label: o.label, sigs: Array.isArray(o.doc[call.method]) ? o.doc[call.method] : null };
}

// The document a call's receiver names, before or after lowering: a dependency's,
// or a sub-service's under it (`Svc.s`). For checks that look a member up.
export function receiverDoc(call, remotesParsed = {}) {
  if (call?.opre) return call.opre.doc ?? null;
  const { root, members } = memberPath(call?.object);
  if (root?.type !== 'Identifier' || !remotesParsed[root.name]) return null;
  return walkServices(remotesParsed[root.name], members).doc;
}

// How a call's receiver reads in source: `Svc.s` for `Svc.s.get()`.
export function receiverLabel(call) {
  if (call?.opre?.label) return call.opre.label;
  const { root, members } = memberPath(call?.object);
  return root?.name ? [root.name, ...members].join('.') : null;
}
