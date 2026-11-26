import { dependencyAddressing } from '../dep_address.js';
import { buildTypeTable, registryEntries } from '../type_table.js';
import * as AST from '../../ast.js';
import { resolveSuperclassChain, withInheritedState } from '../../subclass.js';
import { members as unionMembers } from '../../type_enc.js';
import { isDynamicTy } from '../ty_tags.js';
import { typeText, dependencyAliases, leadsWithList, envTypeOf, orAny } from '../enc_names.js';
import { wireLabel, addressToken, selfAddress, intrinsicArm } from '../wire_labels.js';
import { _opre_quote as quoteToken } from '../opre_tokens.js';
import { fileOuterNames, hasOuterReads, outerNamesFor } from '../../outer_reads.js';
import { publicLabel } from '../../singleton_classes.js';
import { LIST_PREAMBLE, OBJECT_PREAMBLE, AS_PREAMBLE, TEXT_PREAMBLE, MATH_PREAMBLE, DECIMAL_PREAMBLE, STRING_PREAMBLE, EQUALITY_PREAMBLE, WIRE_PREAMBLE } from './preambles.js';
import { buildTypeEnv } from './types.js';
import { readRemote } from '../../validate.js';
export { parseInterface } from '../../parser_interface.js';
import {
  CALL_LIKE, genExpr, genTailValue, genDestructure, genReBody, genTyBody,
  genTypeCondition, genValueCondition, genDefaultValue, stateKey,
  genPackedReturn, genCellNotify, jsSlotTag, jsTyOf,
  genSendNew, jsIdent,
} from './expressions.js';
import {
  genFunctionBodyCode, genLocals, hasBlockBodies, bodyHasEarlyReturn, genSubscribeCall, genIfChain,
} from './statements.js';
import { isLiteralDefault, orderParamsForDefaults } from '../../param_defaults.js';
import { subscribedParams } from '../../call_args.js';
import { capturedRefs } from '../ref_captures.js';

// A silent name's trailing `.` (`log.`, `@go.`) becomes `$` and a writing name's
// trailing `!` becomes `$w` — `$` is a JS identifier character no Brevity name
// uses, so `log`, `log.` and `log!` stay distinct.
function methodNameFor(name) {
  const n = name.replace(/\.$/, '$').replace(/!$/, '$w');
  if (n.startsWith('#')) return `priv_${n.slice(1)}`;
  if (n.startsWith('set@')) return `setAt_${n.slice(4)}`;
  if (n.startsWith('@')) return `op_${n.slice(1)}`;
  return n.replace(/[^a-zA-Z0-9_$]/g, '_');
}

// The dispatch test for a handler: its wire op, and for a cell or class arm
// (`set@val`, `new@Box`) the token of `to` it answers for. The whole-actor
// `set` and `update` answer only a message with no target.
function opMatch(name) {
  const arm = intrinsicArm(name);
  if (arm) return `opName === ${JSON.stringify(arm.op)} && _target === ${JSON.stringify(arm.target)}`;
  // `new` is the file's own: `$new` to the file itself (a file that declares `new`).
  if (name === 'set' || name === 'update' || name === 'new') return `opName === ${JSON.stringify(wireLabel(name))} && _target === null`;
  return `opName === ${JSON.stringify(wireLabel(name))}`;
}

function createContext() {
  return {
    actorNames: new Set(),
    actorFnNames: new Set(),
    stateVarNames: new Set(),
    dependencyNames: new Set(),
    remoteInstanceVars: new Set(),
    // Type declarations indexed by name — used by genExpr's TypeConstruction
    // case to resolve field names for the emitted tagged object.
    typeDecls: new Map(),
    // Per-handler-body locals bound to dep constructor calls:
    //   @go = { t = Thing(args); ... t.method() ... }
    // The dep call inside a handler emits `new` and binds the result address
    // to a function-local var; subsequent t.method() calls route to that
    // address via `this.#send(op, t)` (no `this.#` prefix since it's local).
    localInstanceVars: new Set(),
    childActorVars: new Map(),
    wrappedChildParams: new Set(),
    lambdaCounter: 0,
    lambdaHandlers: [],
    lambdaVarNames: new Set(),
    lambdaCaptureFields: [],
    currentTypeEnv: null,
    // Active catch labels — outermost first. Each entry:
    //   { brevityName: '#label', jsName: '_lbl_label_<n>' }
    // LabelInvoke codegen looks up by brevityName to find its target jsName.
    catchLabelStack: [],
    catchLabelCounter: 0,
    // Late-bound: wired below in codegen()
    genFunctionBodyCode: null,
    genIfChain: null,
    tailIfVar: null,
  };
}

function genPublicFn(ctx, { name, params, body: rawBody, actorDef }, stateVarEnv = null, remotes = null) {
  // Skip actorDef constructor clauses — dispatched via actor construction, not message dispatch
  if (actorDef) return null;
  // Skip empty Function() initializers — they produce no dispatch arm
  if (arguments[1].emptyOverload) return null;
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  // Trailing ExprStatement in braced body acts as implicit return (unless explicitly silent with .)
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    const lastExpr = rawBody[rawBody.length - 1].expr;
    if (lastExpr.type !== 'CellNotify') {
      implicitReturn = { type: 'ImplicitReturn', expr: lastExpr, typeName: null };
      body = rawBody.slice(0, -1);
    }
  }
  const destructure = genDestructure(ctx, params);
  const { env: typeEnv, remoteInferred } = buildTypeEnv(params, body, stateVarEnv, remotes, ctx.typeDecls);
  // Reply grounding check: reject reply fields whose type depends on remote inference
  if (reply && remoteInferred.size > 0) {
    for (const field of reply.fields) {
      if ('sigil' in field && field.typeEnc === undefined && remoteInferred.has(field.sigil)) {
        throw new Error(`Reply type for ':${field.sigil}' cannot be inferred from local declarations — annotate explicitly`);
      }
      if (field.key !== undefined && field.typeEnc === undefined) {
        const expr = field.value;
        if (expr?.type === 'Identifier' && remoteInferred.has(expr.name)) {
          throw new Error(`Reply type for ':${expr.name}' cannot be inferred from local declarations — annotate explicitly`);
        }
      }
    }
  }
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;
  // Save SSA scope: genLocals sets ctx.ssaScope/ssaCounts and leaves them
  // set so the reply/return emission below sees the right SSA names. Restore
  // at end.
  const savedSsaScope = ctx.ssaScope;
  const savedSsaCounts = ctx.ssaCounts;
  ctx.tailIfVar = null;
  const locals = genLocals(ctx, body, typeEnv);
  const tailIf = ctx.tailIfVar;
  const isPrivate = !name.startsWith('@') && name !== 'set' && name !== 'update' && name !== 'new' && !name.startsWith('set@') && !name.startsWith('new@');
  let reLine;
  if (name.startsWith('new@') || name === 'new') {
    // The class answers, relative to itself; a class of ours is passed on under its label.
    const cls = name === 'new' ? 'null' : JSON.stringify(name.slice('new@'.length));
    reLine = `\n        ({ re, ty: _ty_re } = this.#_newReply(${cls}, ${genExpr(ctx, AST.identifier('_inst'))}));`;
  } else if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: isPrivate })};`;
  } else if (implicitReturn) {
    if (implicitReturn.expr?.type === 'IfExpr' && hasBlockBodies(implicitReturn.expr)) {
      // genLocals ran the branches into a local; a branch that returns has replied.
      reLine = tailIf ? `\n        re = [${tailIf}];` : '';
    } else if (implicitReturn.expr?.type === 'CatchExpr') {
      // Value-carrying catch as the handler tail — locals already emitted the
      // labeled block + result temp; consume it here. Void catch produces no
      // value; assign `re = []` so the handler still posts a reply.
      reLine = '';
    } else {
      reLine = `\n        re = [${genTailValue(ctx, implicitReturn.expr)}];`;
    }
  } else if (hasSilent) {
    reLine = '';
  } else {
    reLine = '\n        re = [];';
  }
  // `set`/`update` are fire-and-forget — no reply, no ack
  let tyLine = '';
  if (reply) {
    if (reply.fields.some(f => f.spread)) {
      // The args' ty, reshaped as BvObject.splat reshapes the args: a named-only
      // arg list \`[{k: t}]\` replies as \`{k: t}\`.
      if (!reply.fields.some(f => f.localObject)) tyLine = `\n        _ty_re = _ty != null ? ((t) => (Array.isArray(t) && t.length === 1 && t[0] !== null && typeof t[0] === 'object' && !Array.isArray(t[0]) ? t[0] : t))(_ty[0]) : undefined;`;
    } else {
      const tyBody = genTyBody(ctx, reply.fields, typeEnv);
      if (tyBody !== null) {
        tyLine = `\n        _ty_re = ${tyBody};`;
      }
    }
  }
  ctx.ssaScope = savedSsaScope;
  ctx.ssaCounts = savedSsaCounts;
  ctx.currentTypeEnv = savedTypeEnv;
  const typeCondition = genTypeCondition(ctx, params);
  // For overloaded functions (multiple clauses with same name), add arity check
  const hasOverloads = ctx._allDispatchFns && ctx._allDispatchFns.filter(f => f.name === name).length > 1;
  let condition;
  if (hasOverloads && params.length > 0) {
    // Overloaded: arity check applies to ALL callers (including self-sends)
    const allPos = params.filter(p => p.positional);
    const posCount = allPos.length;
    const requiredPosCount = allPos.filter(p => !p.defaultValue).length;
    const allNamed = params.filter(p => !p.positional);
    const requiredNamedKeys = allNamed.filter(p => !p.defaultValue).map(p => p.key || p.name);
    const allNamedKeys = allNamed.map(p => p.key || p.name);
    const checks = [];
    if (posCount > 0) {
      if (requiredPosCount < posCount) {
        checks.push(`_s.positional.length >= ${requiredPosCount} && _s.positional.length <= ${posCount}`);
      } else {
        checks.push(`_s.positional.length === ${posCount}`);
      }
    }
    for (const k of requiredNamedKeys) checks.push(`${JSON.stringify(k)} in _s.named`);
    // Ensure caller doesn't provide named keys this clause doesn't accept
    if (allNamedKeys.length > 0) {
      checks.push(`Object.keys(_s.named).every(k => [${allNamedKeys.map(k => JSON.stringify(k)).join(',')}].includes(k))`);
    }
    if (typeCondition) {
      // External callers are matched by their tags. An in-process call carries
      // values but no tags, so its values pick the clause.
      const valueCondition = genValueCondition(ctx, params) ?? 'true';
      condition = `${opMatch(name)} && (${checks.join(' && ')}) && ((from === '__parent' || from === '__inner' || from === '__self' || from === '__test') ? ${valueCondition} : ${typeCondition})`;
    } else {
      condition = `${opMatch(name)} && (${checks.join(' && ')})`;
    }
  } else if (typeCondition) {
    condition = `${opMatch(name)} && (from === '__parent' || from === '__inner' || from === '__self' || from === '__test' || ${typeCondition})`;
  } else {
    condition = `${opMatch(name)}`;
  }
  // Outside, only `@name` is exposed.
  if (isPrivate) condition += ` && (from === '__parent' || from === '__inner' || from === '__self' || from === '__test')`;
  // set@<cell>: after mutation, replay the new value to each registered
  // subscriber using the stored id. Notification shape matches the getter
  // (positional `re` plus `ty` type tag). Additionally, for every public
  // fn whose body captures this cell, re-dispatch `@<fn>` per subscriber so
  // derived computations get re-evaluated and replayed.
  let notifyBlock = '';
  if (name.startsWith('set@')) {
    const cellName = name.slice('set@'.length);
    const cellType = params[0]?.typeEnc;
    notifyBlock = `
        ${genCellNotify(ctx, cellName, cellType)}`;
    // Derived fn replay for this cell is emitted by the underlying
    // SetStatement codegen (set@<cell>'s body is `<cell> <- _v`), so no
    // additional replay block here.
  }
  // Functions whose body emits an early `return BvObject.pack(...)` (top-level
  // conditional return, or a Return inside a repeat-while) cannot be inlined
  // into #dispatch — that `return` would exit the dispatch entirely. Delegate
  // to the generated #${name}Fn method instead. Pass `BvObject.pack(payload)`
  // directly because `_s` may not be in scope (only set when the actor has any
  // parameterized function).
  if (bodyHasEarlyReturn(body)) {
    const jsName = methodNameFor(name);
    const arg = params.length > 0 ? '_s' : 'BvObject.pack(payload)';
    // A silent function sends no reply, early exit or not.
    if (rawBody.some(s => s.type === 'SilentTerminator')) {
      return { condition, block: `${destructure}\n        await this.#${jsName}Fn(${arg}${ctx.inBlock ? ', _ctx' : ''});\n        _handled = true;` };
    }
    return { condition, block: `${destructure}\n        const _fnResult = await this.#${jsName}Fn(${arg}${ctx.inBlock ? ', _ctx' : ''});\n        re = BvObject.splat(_fnResult);${delegatedTyLine(ctx, rawBody, tyLine, typeEnv)}\n        _handled = true;` };
  }
  return { condition, block: `${destructure}${locals}${reLine}${tyLine}${notifyBlock}\n        _handled = true;` };
}

// A delegated body can return from several paths, and only one tag is computed
// up front. When any path returns self or forwards a reply, which carries no tag,
// the reply's tag is decided per path.
function delegatedTyLine(ctx, rawBody, tyLine, typeEnv) {
  const returns = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object' || n.type === 'Function') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'Reply' || n.type === 'Return') { returns.push(n); return; }
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(rawBody);
  const forwards = (r) => r.fields?.some(f => f.localObject);
  if (!returns.some(r => r.fields?.[0]?.selfReturn || forwards(r))) return `${tyLine}\n        if (_fnResult.pathTag !== undefined) _ty_re = _fnResult.pathTag ?? undefined;`;
  const valued = returns.find(r => r.fields?.length && !r.fields[0].selfReturn && !forwards(r));
  const other = valued ? genTyBody(ctx, valued.fields, typeEnv) : null;
  return `\n        _ty_re = _fnResult.selfReturn ? undefined : _fnResult.forwarded ? undefined : _fnResult.pathTag !== undefined ? _fnResult.pathTag ?? undefined : ${other ?? 'undefined'};`;
}

function genFnMethod(ctx, { name, params, body: rawBody }, stateVarEnv = null) {
  const reply = rawBody.find(s => s.type === 'Reply');
  let implicitReturn = !reply ? rawBody.filter(s => s.type === 'ImplicitReturn').pop() : null;
  let body = rawBody;
  const hasSilent = rawBody.some(s => s.type === 'SilentTerminator');
  if (!reply && !implicitReturn && !hasSilent && rawBody.length > 0 && rawBody[rawBody.length - 1].type === 'ExprStatement') {
    implicitReturn = { type: 'ImplicitReturn', expr: rawBody[rawBody.length - 1].expr, typeName: null };
    body = rawBody.slice(0, -1);
  }
  const destructure = genDestructure(ctx, params);
  const { env: typeEnv } = buildTypeEnv(params, body, stateVarEnv, null, ctx.typeDecls);
  const savedSsaScope = ctx.ssaScope;
  const savedSsaCounts = ctx.ssaCounts;
  const savedTypeEnv = ctx.currentTypeEnv;
  ctx.currentTypeEnv = typeEnv;
  ctx.tailIfVar = null;
  const locals = genLocals(ctx, body, typeEnv);
  const tailIf = ctx.tailIfVar;
  let reLine;
  if (reply) {
    reLine = `\n        re = ${genReBody(ctx, reply.fields, typeEnv, null, { skipTypeCheck: true })};`;
  } else if (implicitReturn) {
    if (implicitReturn.expr?.type === 'IfExpr' && hasBlockBodies(implicitReturn.expr)) {
      // genLocals ran the branches into a local; a branch that returns has replied.
      reLine = tailIf ? `\n        re = [${tailIf}];` : '';
    } else {
      reLine = `\n        re = [${genTailValue(ctx, implicitReturn.expr)}];`;
    }
  } else {
    reLine = '\n        re = [];';
  }
  ctx.ssaScope = savedSsaScope;
  ctx.ssaCounts = savedSsaCounts;
  ctx.currentTypeEnv = savedTypeEnv;
  const jsName = methodNameFor(name);
  // In an actor that runs in a context, the call's goes along (blockExtension).
  return `  async #${jsName}Fn(_s${ctx.inBlock ? ', _ctx = null' : ''}) {${destructure}${locals}
    let re;${reLine}
    return ${reply?.fields?.[0]?.selfReturn ? genPackedReturn(ctx, reply.fields, typeEnv) : reply?.fields?.some(f => f.localObject) ? 'Object.assign(BvObject.pack(re), { forwarded: true })' : 'BvObject.pack(re)'};
  }`;
}

// genInitMethod removed — init/$var syntax deprecated

// An actor no `new` builds: the file, or a singleton (a class block's included).
const declaredActor = (actor) => !actor.name || !!actor.singletonOf;

// A class block, as an actor others extend and that may extend another
// (notes/opre-extend-and-as-2026-11-20.md):
//
// - `$extend` from an extender: its override table, checked against what the block
//   declares (an `ex` if it names anything else), recorded by `(from, as)`. A block
//   with a base registers the extender with it too, `as` the extender, with the names
//   either of them overrides in the base's terms.
// - A recorded extender, or anything under its address, may `$get` / `$set` the block's
//   protected cells: it is admitted as from inside. No one else is.
// - A block with a base holds it (`binding.base`), sends it `$extend` before its own
//   block runs, and reads and writes the cells it inherits there, as `from` its own
//   address. It answers those cells for its family and its extenders by forwarding
//   them to its base.
function blockExtension(ctx, actor) {
  const node = (ctx.program?.actors || []).find(a => a.name === actor.name);
  // A class block; a published class, whose instances may be built as a layer for a
  // class in another file; a class whose parent is in another file, which builds a
  // layer there and delegates to it (notes/opre-extend-and-as-2026-11-20.md).
  const isBlock = !!node?.membersOf;
  const layers = node && !isBlock ? (node.remoteLayers || []) : [];
  const layerable = !!node && !isBlock && !!node.isPublic;
  if (!isBlock && !layers.length && !layerable) return null;
  const byName = new Map(ctx.program.actors.filter(a => a.name).map(a => [a.name, a]));
  // A parent block in another file is a remote actor, known by its doc.
  const remote = node.remoteBase ?? null;
  const base = node.blockParent ? (byName.get(node.blockParent) ?? (remote && { remote })) : null;
  const label = (b) => selfAddress(publicLabel(b) ?? b.singletonOf);
  const self = isBlock ? label(node) : null;
  // Our address as code: a block's is known; an instance's, as it's published.
  const SELF = isBlock ? JSON.stringify(self) : 'this.#_selfAt';
  const baseSelf = remote ? remote.address : base ? label(base) : null;
  const names = node.extensionNames || [];
  const remoteNames = (d) => [...Object.keys(d).filter(k => !k.startsWith('__')), ...Object.keys(d.__protected || {}).filter(k => !k.startsWith('__'))];
  const baseNames = remote ? remoteNames(remote.doc) : base?.extensionNames || [];
  const table = node.overrideTable?.block || [];
  // The \`instance\` section the class's \`$extend\` carries, and what our class's
  // instances declare, which an extender's may name.
  const instanceTable = node.overrideTable?.instance || [];
  const instanceNames = isBlock ? byName.get(node.membersOf)?.instanceNames || [] : [];
  const forwards = (node.forwardCells || []).map(c => wireLabel(c.name));
  // What it inherits (a call for one goes to its base), and what it defines.
  const inheritedFns = (node.forwardFns || []).map(wireLabel);
  const ownFns = [...new Set((node.functions || []).map(f => f.name).filter(n => typeof n === 'string').map(wireLabel))];
  const J = JSON.stringify;
  const owners = node.inheritedOwners || {};
  const fields = `\n  #_extenders = new Map()\n  #_relays = new Map()${base ? (remote ? `\n  #base = { receive: (m) => this.#_wireSend({ ...m, to: ${J(remote.address)} + (m.to ?? '') }) }` : '\n  #base = null') : ''}${!isBlock ? `\n  #_selfAt = null\n  #_layerCtx = null${layers.length ? '\n  #_layers = {}' : ''}` : ''}`;
  // The base a name goes to: a block's one; an instance's layer for the parent it's from.
  const baseFor = isBlock ? () => 'this.#base' : (owner) => `this.#_layerBase(${owner})`;
  const hasBase = !!base || layers.length > 0;
  // Whether a message's \`from\` is our base: a callback from it.
  const fromBase = (f) => isBlock ? `(${J(baseSelf)} !== null && ${f} === ${J(baseSelf)})` : layers.length ? `Object.values(this.#_layers).includes(${f})` : 'false';
  const methods = `  // What extends us, for our class's \`$new\` of a layer.
  _extenderRecords() { return [...this.#_extenders.values()]; }

  // Whether \`from\` is a recorded extender, or an actor under one.
  #_isExtender(from) {
    if (typeof from !== 'string') return false;
    for (const { from: k } of this.#_extenders.values()) if (from === k || from.startsWith(k + ':')) return true;
    return false;
  }

  // A message on to another actor, its reply relayed back as it comes.
  #_relay(message, send, fields, route, replyTo) {
    const id = String(++this.#nextId);
    // The reply is ours to send: its \`from\` is the actor we passed it to.
    this.#_relays.set(id, (reply) => { const { _route, _replyTo, from: _from, ...r } = reply; route({ ...r, id: message.id, to: replyTo }); });
    const { _route, _replyTo, _ctx, ...rest } = message;
    queueMicrotask(() => send({ ...rest, ...fields, id, _route: (m) => this.receive(m) }));
  }

  // Before dispatch: \`$extend\`; a recorded extender's protected cell ops; a cell we
  // inherit, forwarded to our base; a delegated call (\`as\`), or a callback from our
  // base, run in its context or passed on; a call for a name we inherit, delegated.
  #_admit(message) {
    const opName = typeof message.op === 'string' ? message.op : Array.isArray(message.op) ? message.op[message.op.length - 1] : null;
    if (opName === null) return message;
    const target = _bv_local_tokens(message.to).pop() ?? null;
    const route = message._route || ((m) => this.#binding.post(m));
    const replyTo = message._replyTo || message.from;
    const fail = (why) => { route({ id: message.id, ex: { [opName]: why }, to: replyTo }); return null; };
    if (opName === '$extend' && target === null) {
      this.#_onExtend(message, route, replyTo);
      return null;
    }
    // What the message names: a cell's for a cell op, else its op.
    const name = (opName === '$get' || opName === '$set') ? target : opName;
    const isCall = !opName.startsWith('$');
    if (message.as !== undefined) {
      const as = message.as;
      // A callback from our base, for us or an extender of ours.
      if (${fromBase('message.from')}) {
        if (as === ${SELF}) return { ...message, from: '__inner', _replyTo: replyTo, as: undefined, _ctx: null };
        const rec = [...this.#_extenders.values()].find(r => r.as === as);
        if (!rec) return fail('unknown_context');
        if (rec.table.includes(name)) { this.#_relay(message, rec.send, { from: ${SELF}, as }, route, replyTo); return null; }
        return { ...message, from: '__inner', _replyTo: replyTo, as: undefined, _ctx: rec };
      }
      ${!isBlock ? `// From the instance that built us as its layer: run in its context, always.
      if (this.#_layerCtx && message.from === this.#_layerCtx.from && as === this.#_layerCtx.as) return { ...message, from: '__inner', _replyTo: replyTo, as: undefined, _ctx: this.#_layerCtx };` : ''}
      // A delegated call from an extender: run as its delegate, for the context it names.
      const rec = this.#_extenders.get(JSON.stringify([message.from, as]));
      if (!rec) return fail('unknown_context');
      ${hasBase ? `if (isCall && !${J(ownFns)}.includes(name)) { this.#_relay(message, (m) => ${baseFor(`${J(owners)}[name]`)}.receive(m), { to: undefined, from: ${SELF}, as }, route, replyTo); return null; }` : ''}
      return { ...message, from: '__inner', _replyTo: replyTo, as: undefined, _ctx: rec };
    }
    if ((opName === '$get' || opName === '$set') && typeof target === 'string') {
      const inside = ['__self', '__test', '__parent', '__child', '__inner'].includes(message.from);
      // A recorded extender, or the instance that built us as its layer.
      const extender = !inside && (this.#_isExtender(message.from)${!isBlock ? ' || (this.#_layerCtx !== null && message.from === this.#_layerCtx.from)' : ''});
      if (${J(forwards)}.includes(target) && (inside || extender)) {
        ${hasBase ? `this.#_relay(message, (m) => ${baseFor('null')}.receive(m), { to: ':' + target, from: ${SELF} }, route, replyTo);
        return null;` : 'return message;'}
      }
      if (extender && target.startsWith('~')) return { ...message, from: '__inner', _replyTo: replyTo };
    }
    ${hasBase ? `// A name we don't define but inherit: our base runs it, for us.
    if (isCall && !${J(ownFns)}.includes(name) && ${J(inheritedFns)}.includes(name)) {
      this.#_relay(message, (m) => ${baseFor(`${J(owners)}[name]`)}.receive(m), { to: undefined, from: ${SELF}, as: ${SELF} }, route, replyTo);
      return null;
    }` : ''}
    return message;
  }

  // An extender's override table: recorded if every name in it is one of ours.
  async #_onExtend(message, route, replyTo) {
    const arg = Array.isArray(message.op) && Array.isArray(message.op[0]) ? message.op[0][0] : null;
    const table = arg && Array.isArray(arg.block) ? arg.block : null;
    const instance = arg && arg.instance !== undefined ? arg.instance : [];
    const names = ${J(names)};
    const instanceNames = ${J(instanceNames)};
    if (!table || !table.every(n => names.includes(n)) || !Array.isArray(instance) || !instance.every(n => instanceNames.includes(n))) {
      route({ id: message.id, ex: { $extend: 'unknown_name' }, to: replyTo });
      return;
    }
    const as = message.as ?? message.from;
    // Callbacks for this context go to the extender, as replies to it do: across the
    // wire, as from us, for one in another actor.
    const send = message._route ? (m) => message._route(m) : (m) => this.#_wireSend({ ...m, to: message.from + (m.to ?? '') });
    this.#_extenders.set(JSON.stringify([message.from, as]), { from: message.from, as, table, instance, send });${base ? `
    try { await this.#_extend(as, [...new Set([...${J(table)}, ...table.filter(n => ${J(baseNames)}.includes(n))])]); }
    catch (ex) { route({ id: message.id, ex: { $extend: ex?.$extend ?? 'error' }, to: replyTo }); return; }` : ''}
    route({ id: message.id, re: [], to: replyTo });
  }

  // A call of one of our functions, in a context: at the extender that overrides it,
  // here (in the same context), or at our base, for one we inherit or \`super\`.
  async #_ctxSend(ctx, op, direct = false, owner = null) {
    const name = Array.isArray(op) ? op[op.length - 1] : op;
    if (!direct && ctx && ctx.table.includes(name)) return this.#_await((m) => ctx.send(m), { op, from: ${SELF}, as: ctx.as });
    if (!direct && !${J(inheritedFns)}.includes(name)) {
      const id = String(++this.#nextId);
      const p = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
      await this.#dispatch({ id, op, from: '__self', _ctx: ctx });
      return p;
    }
    ${hasBase ? `return this.#_await((m) => ${baseFor(`(owner ?? ${J(owners)}[name])`)}.receive(m), { op, from: ${SELF}, as: ctx ? ctx.as : ${SELF} });` : `throw new Error('no base to run ' + name);`}
  }

  // A message to another actor, across the wire, as from us.
  #_wireSend(m) {
    const { _route, ...msg } = m;
    if (this.#outer) { this.#outer.receive({ ...msg, from: '__child', _asFrom: ${SELF}, _route: _route || (() => {}) }); return; }
    this.#binding.post({ ...msg, from: ${SELF} });
  }

  // A message sent for its reply.
  #_await(send, msg) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      queueMicrotask(() => send({ ...msg, id, _route: (m) => this.receive(m) }));
    });
  }

  // A cell an extender may redeclare: read there when the context says so.
  async #_ctxGet(ctx, name, own) {
    if (ctx && ctx.table.includes(name)) {
      const v = await this.#_await((m) => ctx.send(m), { op: '$get', to: ':' + name, from: ${SELF}, as: ctx.as });
      return Array.isArray(v) ? v[0] : v;
    }
    return own();
  }

  // And written there; otherwise ours (through its own \`$set\`), or our base's.
  async #_ctxSet(ctx, name, value, inherited = false, owner = null) {
    if (ctx && ctx.table.includes(name)) {
      const msg = { id: String(++this.#nextId), op: [[value], '$set'], to: ':' + name, from: ${SELF}, as: ctx.as, _route: () => {} };
      queueMicrotask(() => ctx.send(msg));
      return;
    }
    ${hasBase ? `if (inherited) { this.#_baseSet(name, value, owner); return; }` : ''}
    await this.#dispatch({ id: '.' + (++this.#localId), op: [[value], '$set'], to: ':' + name, from: '__self', _route: () => {} });
  }
${!isBlock && layers.length ? `
  // The layer we built for a parent in another file, as a base.
  #_layerBase(owner) {
    const at = this.#_layers[owner ?? Object.keys(this.#_layers)[0]];
    return { receive: (m) => this.#_wireSend({ ...m, to: at + (m.to ?? '') }) };
  }

  // \`super(args)\` for a parent in another file: \`$new\` there, \`as\` us, makes our layer
  // and runs its constructor; its reply is the layer's address.
  async #_newLayer(address, op, ty) {
    const re = await this.#_await((m) => this.#_wireSend(m), { op, ty, to: address, from: ${SELF}, as: ${SELF} });
    const v = Array.isArray(re) ? re[0] : re;
    return typeof v === 'string' ? _opre_unbracket(v) : v;
  }
` : ''}${hasBase ? `
  // A cell we inherit, read at our base.
  async #_baseRead(name, owner = null) {
    const v = await this.#_await((m) => ${baseFor('owner')}.receive(m), { op: '$get', to: ':' + name, from: ${SELF} });
    return Array.isArray(v) ? v[0] : v;
  }

  // A write to a cell we inherit, sent to our base.
  #_baseSet(name, value, owner = null) {
    queueMicrotask(() => ${baseFor('owner')}.receive({ id: String(++this.#nextId), op: [[value], '$set'], to: ':' + name, from: ${SELF}, ty: [['Anything']], _route: () => {} }));
  }
` : ''}${base ? `
  // Register with our base: for ourselves, or (\`as\`) an extender of ours.
  #_extend(as = null, table = ${J(table)}) {
    const arg = { block: table, ...(as === null && ${J(instanceTable)}.length && { instance: ${J(instanceTable)} }) };
    return this.#_await((m) => this.#base.receive(m), { op: [[arg], '$extend'], from: ${SELF}, ...(as !== null && { as }) });
  }
` : ''}
`;
  return { fields, methods, base: !!base, remote: !!remote, isBlock, layerable, layers };
}

// The file actor's side of instance layers (notes/opre-extend-and-as-2026-11-20.md,
// "Instance layers"):
// - a class of ours whose parent is in another file: the class's \`$extend\` there, as
//   the file starts (its \`instance\` section); its actors are published as they're
//   made, so their layer's callbacks reach them while they're built;
// - a published class of ours: a \`$extend\` to it from another file is recorded (a
//   class with a block records it there), and \`$new\` with \`as\` from an actor under a
//   recorded extender builds a layer, in that actor's context.
function homeExtension(ctx) {
  const actors = ctx.program?.actors || [];
  const children = actors.filter(a => a.remoteLayers?.length && !a.membersOf);
  const published = actors.filter(a => a.isPublic && !a.membersOf && !a.singletonOf);
  if (!children.length && !published.length) return null;
  const J = JSON.stringify;
  const selectorOf = (a) => a.selector ?? (a.sourceName ?? a.name).replace(/^@/, '');
  const birth = Object.fromEntries([...children, ...published].map(a => [a.name, { selector: selectorOf(a), early: !!a.remoteLayers?.length }]));
  const classes = Object.fromEntries(published.map(a => [selectorOf(a), { instanceNames: a.instanceNames || [], block: !!a.membersClass }]));
  const initLines = children.flatMap(a => a.remoteLayers.filter(L => !L.viaBlock).map(L =>
    `    await this.#_classExtend(${J(selectorOf(a))}, ${J(L.address)}, ${J(a.instanceTables?.[L.name] || [])});`));
  const fields = '\n  #_classExt = new Map()\n  #_pendingLayer = null';
  const methods = `  // What a class of ours being built gets: published as it's made, for one that
  // builds a layer; for a layer, the context it runs in.
  #_birth(cls) {
    const layer = this.#_pendingLayer;
    this.#_pendingLayer = null;
    const b = ${J(birth)}[cls];
    if (!b || (!layer && !b.early)) return {};
    // A layer is its builder's alone: no one else reaches it.
    return { created: (i) => { const at = this.#_publishInstance(b.selector, i); if (layer) this.#_layerOwner.set(at, layer.from); return at; }, ...(layer && { layerCtx: layer }) };
  }

  // A class of ours extends one in another file: its \`$extend\` there, waited for.
  #_classExtend(selector, address, instance) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#binding.post({ id, op: [[{ block: [], instance }], '$extend'], to: address, from: ':' + _opre_quote(selector) });
    });
  }

  // \`$extend\` to a class of ours (one with no block; a block records its own), and
  // \`$new\` with \`as\`. Anything else goes on to dispatch.
  #_classHandshake(message, opName, target, from, replyTo) {
    const classes = ${J(classes)};
    if (target === null || !Object.hasOwn(classes, target)) return false;
    const route = message._route || ((m) => this.#binding.post(m));
    if (opName === '$extend' && !classes[target].block) {
      const arg = Array.isArray(message.op) && Array.isArray(message.op[0]) ? message.op[0][0] : null;
      const instance = arg && arg.instance !== undefined ? arg.instance : [];
      if (!Array.isArray(instance) || !instance.every(n => classes[target].instanceNames.includes(n))) {
        route({ id: message.id, ex: { $extend: 'unknown_name' }, to: replyTo });
        return true;
      }
      const recs = this.#_classExt.get(target) ?? [];
      recs.push({ from, as: message.as ?? from, instance });
      this.#_classExt.set(target, recs);
      route({ id: message.id, re: [], to: replyTo });
      return true;
    }
    if (opName === '$new' && message.as !== undefined) {
      const under = (k) => typeof from === 'string' && (from === k || from.startsWith(k + ':'));
      const recs = classes[target].block ? (this.#_instances.get(target)?._extenderRecords?.() ?? []) : (this.#_classExt.get(target) ?? []);
      const rec = recs.find(r => under(r.from));
      if (!rec) { route({ id: message.id, ex: { $new: 'unknown_context' }, to: replyTo }); return true; }
      // Its callbacks go to the actor that built it, across the wire.
      const owner = from;
      this.#_pendingLayer = { from: owner, as: message.as, table: rec.instance || [], send: (m) => { const { _route, ...w } = m; this.#binding.post({ ...w, to: owner + (m.to ?? '') }); } };
    }
    return false;
  }

`;
  return { fields, methods, initLines };
}

function genClass(ctx, actor, exportKw, remotes = null) {
  // A class block's functions run in the context of a delegated call, and so do a
  // published class's, built as a layer, and a class's whose parent is in another
  // file (blockExtension).
  {
    const node = (ctx.program?.actors || []).find(a => a.name === actor.name);
    ctx.inBlock = !!node && (!!node.membersOf || !!node.isPublic || !!node.remoteLayers?.length);
    // The file builds its classes with what homeExtension gives them.
    ctx.canBirth = !actor.name && (ctx.program?.actors || []).some(a => (a.isPublic && !a.membersOf && !a.singletonOf) || a.remoteLayers?.length);
  }
  // Reset lambda state for this class
  ctx.inClass = !!actor.name;
  ctx.currentActor = actor;
  ctx.lambdaCounter = 0;
  ctx.lambdaHandlers = [];
  ctx.lambdaVarNames = new Set();
  ctx.lambdaCaptureFields = [];

  const hasReturnAs = actor.declarationReturn?.typeNameEnc !== undefined;

  // ── Resolve superclass inheritance ──────────────────────────────────────
  const { inheritedParams, inheritedFunctions, inheritedIngests, inheritedState, inheritedInit } = resolveSuperclassChain(ctx.actorNodes, actor);

  // Merge inherited params (prepend) — skip any that the subclass redefines
  const ownParamNames = new Set((actor.initParams || []).map(p => p.name));
  const mergedParams = [
    ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
    ...(actor.initParams || []),
  ];

  // Merge inherited functions — subclass's own functions take precedence
  const ownFnNames = new Set(actor.functions.map(f => f.name));
  const mergedFunctions = [
    ...actor.functions,
    ...inheritedFunctions.filter(f => !ownFnNames.has(f.name) && !f.name?.startsWith('#')),
  ];

  // Build a modified actor with merged members
  const mergedActor = {
    ...actor,
    initParams: mergedParams,
    functions: mergedFunctions,
  };

  Object.assign(mergedActor, withInheritedState(mergedActor, { inheritedState, inheritedInit }, ctx.actorNodes));

  // Merge inherited ingest state var decls into the subclass
  if (inheritedIngests.length > 0) {
    const ownStateNames = new Set((mergedActor.stateVarDecls || []).map(v => v.name));
    for (const ingest of inheritedIngests) {
      if (!ownStateNames.has(ingest.name)) {
        mergedActor.stateVarDecls = [
          ...(mergedActor.stateVarDecls || []),
          { name: ingest.name, typeNameEnc: ingest.typeNameEnc, ingest: true, ingestDefault: ingest.defaultValue },
        ];
      }
    }
  }

  const name = mergedActor.name ? ` ${mergedActor.name}` : '';

  const isFnDecl = f => f.type === 'FunctionDecl';
  const isPublicOrBuiltin = f => f.name && (f.name.startsWith('@') || f.name === 'set' || f.name === 'update' || f.name.startsWith('set@') || f.name.startsWith('new@') || f.name === 'new');
  const publicFns = mergedActor.functions.filter(f => isFnDecl(f) && isPublicOrBuiltin(f));
  const privateFns = mergedActor.functions.filter(f => isFnDecl(f) && !isPublicOrBuiltin(f));

  // `@x(…)` names the function itself, so it routes as a private function does.
  ctx.actorFnNames = new Set([...privateFns, ...publicFns.filter(f => f.name.startsWith('@'))].map(f => f.name));
  // Identify silent functions (no reply, no implicit return, has SilentTerminator)
  const silentFnNames = new Set();
  for (const fn of [...publicFns, ...privateFns]) {
    const hasReply = fn.body.some(s => s.type === 'Reply');
    const hasImplicit = fn.body.some(s => s.type === 'ImplicitReturn');
    const hasSilent = fn.body.some(s => s.type === 'SilentTerminator');
    if (fn.name.endsWith('.') || (hasSilent && !hasReply && !hasImplicit)) silentFnNames.add(fn.name);
  }
  const allFns = [...publicFns, ...privateFns];
  const usesObject = allFns.some(h => h.params.length > 0);
  const usesTypeMatching = allFns.some(h => h.params.some(p => !p.rest));

  const stateVarDecls = mergedActor.stateVarDecls || [];
  const initBody = mergedActor.initBody || [];
  const constructorParams = mergedActor.initParams || [];
  // Collect service coercion aliases from the constructor block. Class-style
  // coercions (those carrying constructorParams) are not runtime state —
  // they only exist as compile-time aliases for an underlying dep — so
  // they're partitioned out and tracked separately.
  const allCoercions = (mergedActor.constructorBody || []).filter(s => s.type === 'ServiceCoercion');
  const serviceCoercions = allCoercions.filter(s => !s.constructorParams);
  const constructorCoercions = allCoercions.filter(s => s.constructorParams);
  // Constructor params are also state — accessible from handlers
  const allStateNames = [
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
  ];
  ctx.stateVarNames = new Set(allStateNames);
  ctx.remoteInstanceVars = new Set();
  // Constructor coercions: alias name → the underlying dep's wire address. The alias is
  // treated as a dep at codegen time so `t = Coerced(args)` enters the same
  // construction path as `t = Thing(args)`, but `new` is addressed to the
  // underlying dep.
  ctx.constructorCoercions = new Map(ctx.depWireTargets || []);
  for (const c of constructorCoercions) {
    const underlying = c.ref?.name || c.ref;
    ctx.constructorCoercions.set(c.name, ctx.depAddress(underlying));
    ctx.dependencyNames.add(c.name);
  }
  const VALUE_TYPES = new Set(['Text', 'Integer', 'Decimal', 'Float', 'Boolean', 'Anything']);
  for (const s of initBody) {
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name)) {
      ctx.remoteInstanceVars.add(s.name);
    }
    if (s.value?.type === 'DotCallExpr') {
      if (s.isRef) {
        ctx.remoteInstanceVars.add(s.name);
      } else if (remotes) {
        const objName = s.value.object?.name;
        const method = s.value.method;
        const iface = remotes[objName];
        if (iface) {
          // Op-form: iface[method][0].returns. Type-form: methods live
          // inside iface.__types[objName].functions.
          const retSig = iface?.[method]?.[0] || iface?.__types?.[objName]?.functions?.find(f => f.name === method);
          const retType = retSig?.returnAlternatives ? undefined : retSig?.returns?.[0]?.typeEnc;
          if (retType !== undefined && !unionMembers(retType).some(t => VALUE_TYPES.has(t))) {
            ctx.remoteInstanceVars.add(s.name);
          }
        }
      }
    }
  }
  // Constructor params marked with ref: true (the * syntax) are wrapped child actor references
  ctx.wrappedChildParams = new Set();
  for (const p of constructorParams) {
    if (p.ref) {
      ctx.wrappedChildParams.add(p.name);
    } else if (p.typeEnc === 'Anything') {
      ctx.wrappedChildParams.add(p.name);
    }
  }
  // Service coercion aliases are also wrapped child params
  for (const s of serviceCoercions) {
    ctx.wrappedChildParams.add(s.name);
  }
  const stateVarEnv = new Map([
    // The file's names a class reads (src/outer_reads.js); its own come after, and win.
    ...(actor.name && ctx.readsOuter ? [...outerNamesFor(ctx.program, actor)].filter(([, t]) => t !== undefined) : []),
    ...stateVarDecls.map(v => [v.name, v.typeNameEnc]),
    ...constructorParams.map(p => [p.name, orAny(envTypeOf(p))]),
  ]);

  // Ref-captured-by map: which non-silent public fns reference each ref in
  // their body. Set@<cell>'s notifyBlock uses this to fire re-evaluation
  // dispatches for subscribers of any fn that derives from the cell being set.
  const refCapturedBy = new Map();
  for (const fn of [...publicFns, ...privateFns]) {
    if (!fn.name) continue;
    const isPublic = fn.name.startsWith('@') && !fn.name.startsWith('@@') && !fn.name.startsWith('set@');
    const isPrivate = fn.name.startsWith('#');
    if (!isPublic && !isPrivate) continue;
    if (silentFnNames.has(fn.name)) continue;
    for (const refName of capturedRefs(fn)) {
      if (!refCapturedBy.has(refName)) refCapturedBy.set(refName, new Set());
      // Store the full name (with @ or # sigil) so replay emits the right
      // dispatch op and storage key can be derived as name.slice(1).
      refCapturedBy.get(refName).add(fn.name);
    }
  }
  ctx._refCapturedBy = refCapturedBy;
  // All functions (public + private) go through dispatch as self-send targets
  const allDispatchFns = [...publicFns, ...privateFns];
  ctx._allDispatchFns = allDispatchFns;
  const publicFnParts = allDispatchFns.map(h => genPublicFn(ctx, h, stateVarEnv, remotes)).filter(Boolean);

  // Init-body codegen runs BEFORE the lambda-arm loop so any `over(...)` (or
  // other lambda-emitting forms) inside subscribe handlers / construction-time
  // statements registers with ctx.lambdaHandlers in time for arm emission.
  // Without this, init-body lambdas have a `selfSend("_lambda_N", …)` call
  // site but no matching dispatch arm — replies surface as `unhandled`.
  const ctorParamNames = constructorParams.map(p => p.name);
  const ctorParamExprs = constructorParams.map(p => {
    if (p.defaultValue && isLiteralDefault(p.defaultValue)) return `${p.name} = ${genDefaultValue(p.defaultValue)}`;
    return p.name;
  });
  const paramInitLines = ctorParamNames.map(n => `    this.#${stateKey(n)} = ${n};`);
  // An expression default runs once every param is bound, in the order its
  // names need (notes/param-default-expressions-2026-11-10.md).
  for (const p of orderParamsForDefaults(constructorParams)) {
    if (!p.defaultValue || isLiteralDefault(p.defaultValue)) continue;
    const field = `this.#${stateKey(p.name)}`;
    paramInitLines.push(`    if (${field} === undefined) ${field} = ${genTailValue(ctx, p.defaultValue)};`);
  }
  // Cells a class constructed here waits on (src/init_order.js): its reads of them
  // are held until their lines run.
  const pendingCells = actor.pendingCells || mergedActor.pendingCells || [];
  const hasDeferred = pendingCells.length > 0;
  // A construction we don't wait for: spawn it, and join it at the end of the block.
  const spawned = (code) => {
    const m = /^await ([A-Za-z_$][\w$]*)\.create\(/.exec(code);
    if (!m) throw new Error(`internal: deferred construction didn't compile to a create call: ${code}`);
    return `this.#_join(${m[1]}.spawn(${code.slice(m[0].length)})`;
  };
  function genOneInitLine(s) {
    const line = genOneInitLineCore(s);
    const names = s.type === 'ExprStatement' ? [] : [s.name].filter(Boolean);
    const ready = names.filter(n => pendingCells.includes(n)).map(n => `\n    this.#_cellReady(${JSON.stringify(wireLabel(n))});`).join('');
    return line + ready;
  }
  function genOneInitLineCore(s) {
    if (s.value?.deferredConstruct) return `    this.#${stateKey(s.name)} = ${spawned(genExpr(ctx, s.value))};`;
    if (s.value?.type === 'FunctionCallExpr' && s.value.callee?.type === 'Identifier' && ctx.dependencyNames.has(s.value.callee.name)) {
      const calleeName = s.value.callee.name;
      const targetName = ctx.constructorCoercions.get(calleeName) || ctx.depAddress(calleeName);
      ctx.remoteInstanceVars.add(s.name);
      return `    ${genSendNew(ctx, s.value.args, JSON.stringify(targetName))}.then(addr => { this.#${stateKey(s.name)} = addr; });`;
    }
    if (s.type === 'ExprStatement') {
      if (s.expr?.type === 'SubscribeCall') {
        return genSubscribeCall(ctx, s.expr);
      }
      let expr = genExpr(ctx, s.expr);
      const isAsyncSend = s.expr.type === 'DotCallExpr' && expr.includes('this.#send(');
      return `    ${isAsyncSend ? 'await ' : ''}${expr};`;
    }
    if (s.type === 'ServiceCoercion') {
      if (s.constructorParams) return '';
      const refName = s.ref?.name || s.ref;
      return `    this.#${stateKey(s.name)} = ${ctx.wrappedChildParams.has(refName) || ctx.stateVarNames.has(refName) ? `this.#${stateKey(refName)}` : genExpr(ctx, s.ref)};`;
    }
    if (s.value === null) return `    this.#${stateKey(s.name)} = undefined;`;
    let expr = genExpr(ctx, s.value);
    const isAsyncSend = s.value.type === 'DotCallExpr' && expr.includes('this.#send(');
    if ((s.isRef || ctx.remoteInstanceVars.has(s.name)) && isAsyncSend) {
      expr = expr.replace('this.#send(', 'this.#sendRef(');
    }
    if (s.soleValue && s.value.type !== 'AsExpr') expr = `BvObject.one(${expr}, ${JSON.stringify(s.name)})`;
    // A call on another actor (a child, one held in an enclosing actor's cell, or
    // a remote) waits for its reply, and the cell holds its one value.
    if (s.value.type === 'DotCallExpr' && (expr.startsWith('this.#childSend(') || expr.startsWith('this.#send('))) {
      const decl = (mergedActor.stateVarDecls || []).find(d => d.name === s.name);
      const reply = `BvObject.pack(await ${expr})`;
      return `    this.#${stateKey(s.name)} = ${decl?.typeNameEnc === 'Object' ? reply : `BvObject.one(${reply}, ${JSON.stringify(s.name)})`};`;
    }
    return `    this.#${stateKey(s.name)} = ${isAsyncSend ? 'await ' : ''}${expr};`;
  }
  let ownIngestInfo = null;
  const preIngestBodyLines = [];
  const postIngestBodyLines = [];
  {
    let pastIngest = false;
    for (const s of initBody) {
      if (s.value?.type === 'IngestExpr') {
        ownIngestInfo = { name: s.name, defaultValue: s.value.defaultValue };
        pastIngest = true;
        continue;
      }
      (pastIngest ? postIngestBodyLines : preIngestBodyLines).push(genOneInitLine(s));
    }
  }
  const coercionInitLines = serviceCoercions.map(s => {
    const refName = s.ref?.name || s.ref;
    return `    this.#${stateKey(s.name)} = ${ctx.stateVarNames.has(refName) ? `this.#${stateKey(refName)}` : genExpr(ctx, s.ref)};`;
  });

  // Generate lambda handler arms (registered during public-fn AND init-body
  // codegen above). Use index loop since nested lambdas may add new handlers
  // during iteration.
  const lambdaParts = [];
  for (let li = 0; li < ctx.lambdaHandlers.length; li++) {
    const lh = ctx.lambdaHandlers[li];
    const { name: lName, varName: lVarName, fn: fnNode, captures } = lh;
    const params = fnNode.params || [];
    // Skip empty Function() initializer — no dispatch arm needed
    if (fnNode.emptyOverload) continue;
    const destr = genDestructure(ctx, params);
    let block = destr;
    // Declare self-reference so recursive lambdas can call themselves
    if (lVarName) {
      const jsVarName = jsIdent(lVarName);
      block += `\n        const ${jsVarName} = "${wireLabel(lName)}";`;
    }
    // Load captures from private fields
    if (captures && captures.length > 0) {
      for (const cap of captures) {
        block += `\n        const ${jsIdent(cap.name)} = this.#_cap_${cap.lambdaName}_${jsIdent(cap.name)};`;
      }
    }
    // Generate body using genFunctionBodyCode-style to support all assignment forms
    // A silent local function (`h. = () { … }`) gives no reply, as `-> .` doesn't.
    const silentLambda = fnNode.returnType === '.' || !!lVarName?.endsWith('.');
    if (fnNode.body) {
      const fnCode = genFunctionBodyCode(ctx, params, fnNode.body, null, fnNode.returnType, fnNode.returnTypeEnc);
      if (silentLambda) {
        // Silent lambda — no reply
        block += `\n        await (${fnCode})(_s);`;
      } else if (fnNode.returnType === '()') {
        // Void lambda — reply with empty `re: []` after running the body
        block += `\n        await (${fnCode})(_s);\n        re = [];`;
      } else {
        // fnCode is `async (_s) => {...}` — we invoke it inline to get the result. A `!`
        // lambda that falls off its end returns self, as a `!` function does.
        block += lVarName?.endsWith('!')
          ? `\n        { const _r = await (${fnCode})(_s); re = _r === undefined ? "#<:>" : BvObject.splat(_r); }`
          : `\n        re = BvObject.splat(await (${fnCode})(_s));`;
      }
    } else if (fnNode.expr) {
      if (silentLambda) {
        block += `\n        ${genExpr(ctx, fnNode.expr)};`;
      } else {
        // A call's result is already a reply (`BvObject.pack(…)`): pass it on, don't
        // wrap it as one value.
        const code = genExpr(ctx, fnNode.expr);
        // A call through a function value (`#g(2)` of a local `#g`) is a reply too.
        const isReply = code.startsWith('BvObject.pack(') || /^\(typeof [\w$]+ === 'string' \? BvObject\.pack\(/.test(code);
        block += isReply
          ? `\n        re = BvObject.splat(${code});`
          : `\n        re = [${code}];`;
      }
    }
    block += '\n        _handled = true;';
    // The opName a dispatched message carries for this lambda: a wire lambda is
    // reached by its `@N` selector (locally via #fire self-dispatch, or on the
    // wire after perspective translation); a local lambda by its bare name.
    const dispatchKey = lh.selector || wireLabel(lName);
    // For overloaded lambdas (multiple handlers with same label), add arity condition
    const hasOverloads = ctx.lambdaHandlers.filter(h => h.name === lName).length > 1;
    let condition;
    if (hasOverloads && params.length > 0) {
      const posCount = params.filter(p => p.positional).length;
      const namedKeys = params.filter(p => !p.positional).map(p => p.key || p.name);
      const checks = [];
      if (posCount > 0) checks.push(`_s.positional.length === ${posCount}`);
      for (const k of namedKeys) checks.push(`${JSON.stringify(k)} in _s.named`);
      condition = `opName === "${dispatchKey}" && ${checks.join(' && ')}`;
    } else {
      condition = `opName === "${dispatchKey}"`;
    }
    lambdaParts.push({ condition, block });
    if (silentLambda) silentFnNames.add(dispatchKey);
  }

  // Auto-generate accessor dispatch arms for constructor params
  const accessorParts = constructorParams
    .map(p => {
      // Only `@`-published params get an accessor.
      if (!p.accessor) return null;
      const accessorName = p.accessor;
      const internalName = p.name;
      return {
        condition: `opName === ${JSON.stringify(wireLabel('@' + accessorName))}`,
        block: `\n        re = [this.#${stateKey(internalName)}];\n        _handled = true;`,
      };
    })
    .filter(Boolean);

  const asClauseParts = (mergedActor.asClauses || []).map(clause => {
    const val = genExpr(ctx, clause.expr);
    const typeCond = clause.negated
      ? `_rawPayload !== ${JSON.stringify(typeText(clause.targetTypeEnc, ctx.depAliases))}`
      : `_rawPayload === ${JSON.stringify(typeText(clause.targetTypeEnc, ctx.depAliases))}`;
    // A union target is tagged from the value; the request names the union.
    const tag = isDynamicTy(clause.targetTypeEnc) && !clause.negated ? jsTyOf(ctx, clause.targetTypeEnc, 're[0]') : '_rawPayload';
    return {
      condition: `opName === "$as" && typeof _rawPayload === "string" && ${typeCond}`,
      block: `\n        re = [${val}];\n        _ty_re = [${tag}];\n        _handled = true;`,
    };
  });
  if (hasReturnAs) {
    const returnAsType = actor.declarationReturn.typeNameEnc;
    asClauseParts.push({
      condition: `opName === "$as" && typeof _rawPayload === "string" && _rawPayload === ${JSON.stringify(typeText(returnAsType, ctx.depAliases))}`,
      block: `\n        re = [this.#${stateKey('__returnAs')}];\n        _ty_re = [${isDynamicTy(returnAsType) ? jsTyOf(ctx, returnAsType, 're[0]') : '_rawPayload'}];\n        _handled = true;`,
    });
  }

  const allParts = [...publicFnParts, ...lambdaParts, ...accessorParts, ...asClauseParts];
  const ifChain = allParts.length > 0
    ? allParts.map(({ condition, block }, i) => {
        const kw = i === 0 ? '    if' : '    } else if';
        return `${kw} (${condition}) {${block}`;
      }).join('\n') + '\n    }'
    : '';

  const hasLambdas = ctx.lambdaHandlers.length > 0;
  const objectLine = (usesObject || hasLambdas)
    ? '\n    const _s = BvObject.pack(payload);'
    : '';
  const tyDecl = "\n    const _ty = message['ty'];";
  // Slice 12 inbound: when the message carries a parallel ty tag set, walk
  // the packed object and reconstruct any type-tagged values
  // before destructure runs. `_bv_unwire_packed` no-ops when types is null
  // and per-slot `_bv_from_wire` no-ops on tags that name no known type.
  const typesLines = usesTypeMatching
    ? `\n    const _types = _ty != null ? BvObject.pack(_ty[0] ?? null) : null;${(usesObject || hasLambdas) ? `\n    if (_types && _s) Object.assign(_s, _bv_unwire_packed(_s, _types));` : ''}`
    : ((usesObject || hasLambdas)
        ? `\n    const _types = _ty != null ? BvObject.pack(_ty[0] ?? null) : null;\n    if (_types && _s) Object.assign(_s, _bv_unwire_packed(_s, _types));`
        : '');

  // Generate remote ref from-check for payload validation bypass
  const remoteRefChecks = [...ctx.remoteInstanceVars].map(n => `from !== this.#${stateKey(n)}`).join(' && ');

  // Deduplicate private functions for method generation — overloaded functions
  // go through dispatch, only the first clause needs a method stub
  const seenPrivateNames = new Set();
  const uniquePrivateFns = privateFns.filter(f => {
    if (seenPrivateNames.has(f.name)) return false;
    seenPrivateNames.add(f.name);
    return true;
  });
  // Public handlers whose body emits early `return BvObject.pack(...)` are
  // dispatched via a generated method (see genPublicFn) — emit the method too.
  const seenPublicMethodNames = new Set();
  const publicFnsNeedingMethod = publicFns.filter(f => {
    if (!bodyHasEarlyReturn(f.body)) return false;
    if (seenPublicMethodNames.has(f.name)) return false;
    seenPublicMethodNames.add(f.name);
    return true;
  });
  const fnMethods = [...uniquePrivateFns, ...publicFnsNeedingMethod]
    .map(f => genFnMethod(ctx, f, stateVarEnv)).join('\n\n');
  const fnSection = fnMethods ? '\n\n' + fnMethods : '';
  // Detect any `this.#childSend(` emission across all generated body code,
  // so the helper is declared even for named classes that don't use Self()
  // but do dispatch to ref-cell-held actor refs (e.g. @peer Self | null).
  const childCall = /#child(Send|Fire)\(/;
  if (allParts.some(p => p.block && childCall.test(p.block)) || childCall.test(fnSection)) {
    ctx.usesChildSend = true;
  }

  // Private field declarations — values set in constructor
  const allFieldNames = new Set([
    ...stateVarDecls.map(v => v.name),
    ...constructorParams.map(p => p.name),
    ...serviceCoercions.map(s => s.name),
  ]);
  if (hasReturnAs) allFieldNames.add('__returnAs');
  const stateFields = [...allFieldNames].map(n => `  #${stateKey(n)}`).join('\n');
  const captureFields = ctx.lambdaCaptureFields.map(n => `  #${n}`).join('\n');
  const fieldSection = [stateFields, captureFields].filter(Boolean).join('\n');

  // Init body codegen + ingest splitting were hoisted earlier so init-body
  // lambdas register before the dispatch-arm loop runs. Re-use the computed
  // ctorParamExprs / preIngestBodyLines / postIngestBodyLines / coercionInitLines
  // here.
  const allInitLines = [
    ...(hasDeferred ? [`    this.#_pendingCells = new Map(${JSON.stringify(pendingCells.map(wireLabel))}.map(n => [n, []]));`] : []),
    ...paramInitLines, ...preIngestBodyLines,
  ];

  // Handle ingest: inject the ingest value between pre and post phases
  if (ownIngestInfo) {
    if (ownIngestInfo.defaultValue) {
      // Default: use _ingest param with default value
      allInitLines.push(`    this.#${stateKey(ownIngestInfo.name)} = _ingest_${ownIngestInfo.name} !== undefined ? _ingest_${ownIngestInfo.name} : ${genExpr(ctx, ownIngestInfo.defaultValue)};`);
    } else {
      allInitLines.push(`    this.#${stateKey(ownIngestInfo.name)} = _ingest_${ownIngestInfo.name};`);
    }
    allInitLines.push(...postIngestBodyLines);
  } else if (inheritedIngests.length > 0 && actor.declarationReturn) {
    // This subclass provides a value for its superclass's ingest
    // Evaluate the declaration return and assign to the inherited ingest var
    const ingest = inheritedIngests[0]; // primary ingest from direct superclass
    allInitLines.push(`    this.#${stateKey(ingest.name)} = ${genExpr(ctx, actor.declarationReturn.expr)};`);
  } else if (inheritedIngests.length > 0) {
    // Subclass doesn't provide a return — use superclass's default if available
    for (const ingest of inheritedIngests) {
      if (ingest.defaultValue) {
        allInitLines.push(`    this.#${stateKey(ingest.name)} = ${genExpr(ctx, ingest.defaultValue)};`);
      }
    }
  }

  if (hasReturnAs) {
    allInitLines.push(`    this.#${stateKey('__returnAs')} = ${genExpr(ctx, actor.declarationReturn.expr)};`);
  }
  // Public `_tail` mirror: surfaces the value-tail projection so the runtime
  // can unwrap a wrapper instance to its inner address (or scalar) at
  // boundaries that consume wire tokens — e.g. `body.append!(peer_button("x"))`.
  // See notes/tail-return-wire-2026-04-15.md, Shape 1.
  if (actor.declarationReturn) {
    if (hasReturnAs) {
      allInitLines.push(`    this._tail = this.#${stateKey('__returnAs')};`);
    } else if (inheritedIngests.length > 0) {
      allInitLines.push(`    this._tail = this.#${stateKey(inheritedIngests[0].name)};`);
    } else {
      allInitLines.push(`    this._tail = ${genExpr(ctx, actor.declarationReturn.expr)};`);
    }
  }
  allInitLines.push(...coercionInitLines);
  const publishesNew = (actor.functions || []).some(f => f.name?.startsWith('new@') || f.name === 'new');
  // Public singletons declared directly in this actor (`@s = actor { … }`). Each is
  // published at `:s`, as an actor made by `#new` is at `:C:N`.
  // A public class's members are published at the class's label (`:C`).
  // A class block that extends its parent's is declared at its home, not in the parent block.
  const declaredHere = (a) => ((a.blockParent ? a.home : a.enclosing) ?? null) === (actor.name ?? null);
  const publicSingletons = (ctx.program?.actors || [])
    .filter(a => publicLabel(a) && declaredHere(a));
  const publishesClasses = publishesNew || publicSingletons.length > 0;
  // Private singletons declared directly in this actor (\`s = actor { … }\`): not
  // published, but this actor's own sends reach them by their address (\`#<:~s>\`).
  const heldSingletons = (ctx.program?.actors || [])
    .filter(a => a.singletonOf && !a.membersOf && !publicLabel(a) && declaredHere(a));
  const heldAtCases = heldSingletons
    .map(sg => `${JSON.stringify(selfAddress(sg.singletonOf))}: () => this.#${stateKey(sg.singletonOf)}`).join(', ');
  for (const sg of publicSingletons) {
    const label = publicLabel(sg);
    allInitLines.push(`    this.#_publishAt(${JSON.stringify(quoteToken(addressToken(label)))}, '*', this.#${stateKey(sg.singletonOf)});`);
  }
  // A constructor block's call on another actor in this process needs the helper too.
  if (allInitLines.some(l => childCall.test(l))) ctx.usesChildSend = true;
  if (hasDeferred) allInitLines.push(`    await Promise.all(this.#_joins);`);
  // A class block that extends another registers with it before its own block runs.
  const ext = blockExtension(ctx, actor);
  // The file's side of instance layers: its classes' handshakes, and its layers.
  const homeExt = !actor.name ? homeExtension(ctx) : null;
  if (homeExt?.initLines.length) allInitLines.unshift(...homeExt.initLines);
  if (ext?.base) allInitLines.unshift('    await this.#_extend();');
  // A layer runs in the context of the instance that built it, its constructor too.
  if (ext) allInitLines.unshift(ext.isBlock ? '    const _ctx = null;' : '    const _ctx = this.#_layerCtx;');
  const finalInitBody = allInitLines.length > 0
    ? `\n${allInitLines.join('\n')}\n  `
    : ' ';

  // A class's construction is a call its caller receives the failure of, so a
  // failed `as` keeps its message only on the handler it happened in.
  const initCall = `await instance.#init(${[...ctorParamNames, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')});`;
  const initCallLine = actor.name
    ? `try { ${initCall} } catch (err) { delete err.bvEx; throw err; }`
    : initCall;


  // A class reads its file actor's cells by asking it (src/outer_reads.js).
  const readsOuter = !!actor.name && ctx.readsOuter;
  // The names this actor answers `$get` for, by wire name. A public cell answers
  // anyone, through its own reader; every other name (a protected or private cell,
  // a constant, a param) answers only from inside, and from a class declared in us
  // reading it (src/outer_reads.js). A prop isn't an address: from outside, `$get`
  // to it is unhandled. See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
  const ownNames = !actor.name ? [...fileOuterNames({ actors: [actor] }).keys()]
    : [...allFieldNames].filter(n => n !== '__returnAs');
  const isPublicCell = (n) => n.startsWith('@') && mergedActor.functions.some(f => f.name === n && f.cellGetter);
  const readable = ownNames.filter(n => typeof n === 'string')
    .map(n => `${JSON.stringify(wireLabel(n))}: { read: () => this.#${stateKey(n)}, open: ${isPublicCell(n)} }`).join(', ');
  // Published params: props, which `$subscribe` doesn't apply to.
  const propNames = [...new Set([...(actor.initParams || []), ...(mergedActor.initParams || [])].filter(p => p.accessor).map(p => p.accessor.replace(/^@/, '')))];

  // #_cellSubs: subscription lists keyed by target label (`@a`), filled by the
  // dispatcher's subscribe prologue and walked by set@X to replay new values.
  return `${exportKw}class${name} {
  #binding
  #pending = new Map()
  #_newPending = new Map()
  #_testFwd = new Map()
  #_cellSubs = new Map()
  #nextId = 0
  // Ids for calls that never leave us (to an actor we hold, to ourselves): apart from
  // the wire's, so the ids we post run 1, 2, 3, … on every target.
  #localId = 0${publishesClasses ? '\n  #_instances = new Map()\n  #_layerOwner = new Map()\n  #_instanceSeq = new Map()\n  #_addrOf = new Map()' : ''}
  #_remoteRoutes = null
  #_lift = null${hasDeferred ? '\n  #_pendingCells = new Map()\n  #_joins = []' : ''}${actor.spawnable ? '\n  #_starting = null' : ''}${actor.name && ctx.readsOuter ? '\n  #outer = null\n  #chain = []' : ''}${!actor.name && ctx.readsOuter ? '\n  #_outerFwd = new Map()\n  #_selfFwd = new Map()' : ''}${homeExt ? homeExt.fields : ''}${ext ? ext.fields : ''}
${fieldSection ? fieldSection + '\n' : ''}
  constructor(binding) { this.#binding = binding;${actor.name && ctx.readsOuter ? ' this.#outer = binding.outer ?? null; this.#chain = binding.chain ?? (binding.outer ? [binding.outer] : []);' : ''}${ext?.base && !ext.remote ? ' this.#base = binding.base ?? null;' : ''}${ext && !ext.isBlock ? ' this.#_layerCtx = binding.layerCtx ?? null;' : ''} }

  _adoptBinding(binding) { const old = this.#binding; this.#binding = binding; this.#_lift = binding.lift ?? null; return old; }

  async #init(${[...ctorParamExprs, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {${finalInitBody}}

  static async create(${['binding', ...ctorParamExprs, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {
    const instance = new this(binding);
    ${ext && !ext.isBlock ? `// Published as it's made, its address its own: a layer's callbacks reach it while
    // it's built.
    const _at = binding.created ? binding.created(instance) : undefined;
    if (typeof _at === 'string') instance.#_selfAt = ':' + _at;` : 'if (binding.created) binding.created(instance);'}
    ${initCallLine}
    return instance;
  }
${actor.spawnable ? `
  // Construction its parent doesn't wait for: its block reads cells of the parent
  // declared below the line that makes it. It has its handle at once; what's sent to
  // it waits until it's constructed, and \`_ready\` settles then.
  static spawn(${['binding', ...ctorParamExprs, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')}) {
    const instance = new this(binding);
    if (binding.created) binding.created(instance);
    const ready = instance.#init(${[...ctorParamNames, ...(ownIngestInfo ? [`_ingest_${ownIngestInfo.name}`] : [])].join(', ')})
      .catch((err) => { delete err.bvEx; throw err; })
      .finally(() => { instance.#_starting = null; });
    ready.catch(() => {});
    instance.#_starting = ready;
    instance._ready = ready;
    return instance;
  }
` : ''}
  // A private singleton of ours, by its address (\`:~s\`), or null.
  #_heldAt(addr) {
    const held = { ${heldAtCases} };
    return Object.hasOwn(held, addr) ? held[addr]() : null;
  }

  async #send(op, to, ty) {
    const id = String(++this.#nextId);
    // A relative address (\`#<:x>\`) is under us: a locally-held lambda, or an
    // actor we hold (one we declare, or built). It's delivered to us, \`to\` and
    // all, as a held child's handle is, and we await the reply rather than
    // posting outward. (See #fire.)
    if (typeof to === 'string' && /^#<:/.test(to)) {
      const p = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
      const held = this.#_heldAt(_opre_unbracket(to));
      const msg = { id, op, from: '__parent', _route: (m) => this.receive(m), ...(ty !== undefined && { ty }) };
      if (held) held.receive(msg); else this.receive({ ...msg, to: _opre_unbracket(to) });
      return p;
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const _msg = { id, op, to };
      if (ty !== undefined) _msg['ty'] = ty;
      this.#out(_msg);
    });
  }

  #fire(op, to, ty) {
    // Fire-and-forget: post with no pending and no reply awaited. Used for
    // silent reference-field invocations (v.endpoint!) -- there is no reply
    // to consume, and unlike #send the caller never suspends on one.
    const id = String(++this.#nextId);
    // A reference field may hold a locally-constructed lambda, encoded as a
    // relative self-address (#<. @N>). Until the carrying value leaves this
    // actor (where perspective translation promotes it to #<selfAddr @N>), it
    // names a handler on us, so invoking it loops back to our own dispatch
    // instead of posting outward to a peer that isn't there.
    if (typeof to === 'string' && /^#<:/.test(to)) {
      this.#dispatch({ id, op, from: '__self' });
      return;
    }
    const _msg = { id, op, to };
    if (ty !== undefined) _msg['ty'] = ty;
    this.#out(_msg, true);
  }

  // What this actor sends to anyone else. A class sends it through its file actor,
  // which makes the call as its own and routes the reply back by id; a file actor
  // posts it itself. A silent message has no reply to route.
  #out(msg, silent = false) {
    // \`to\` is bare: an address value (a reference field, a callback, an instance
    // held in a cell) loses the \`#<…>\` that marks it in a payload.
    if (typeof msg.to === 'string' && msg.to.startsWith('#<') && msg.to.endsWith('>')) msg = { ...msg, to: _opre_unbracket(msg.to) };${readsOuter ? `
    // The file actor sends it as its own, so it gets our addresses translated
    // as our parents would translate them (\`lift\`).
    if (this.#outer) { this.#outer.receive({ ...(this.#_lift ? this.#_lift(msg) : msg), from: '__child', _route: (m) => this.receive(m), _silent: silent }); return; }` : ''}
    this.#binding.post(msg);
  }

  async #sendRef(op, to, ty) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      // A reply whose \`re\` isn't a list is malformed.
      this.#_newPending.set(id, (addr) => addr === undefined ? reject(new Error("a reply's re is a list")) : resolve(addr));
      const _msg = { id, op, to };
      if (ty !== undefined) _msg['ty'] = ty;
      this.#out(_msg);
    });
  }

  async #sendNew(args, to, ty) {
    const id = String(++this.#nextId);
    const op = args === undefined ? '$new' : [args, '$new'];
    // An actor held as a value (\`#<…>\`) answers with one: the address comes back
    // as a value too. One under us (\`#<:C>\`) is delivered to us.
    const held = typeof to === 'string' && to.startsWith('#<');
    return new Promise((resolve, reject) => {
      // A reply to \`$new\` with no address as its one value is malformed.
      const done = (addr) => addr === undefined ? reject(new Error('$new: the reply names no actor (re: ["#<…>"])'))
        : resolve(held && addr !== null ? '#<' + addr + '>' : addr);
      this.#_newPending.set(id, done);
      if (held && /^#<:/.test(to)) { this.receive({ id, op, to: _opre_unbracket(to), from: '__parent', _route: (m) => this.receive(m), ...(ty !== undefined && { ty }) }); return; }
      const _msg = { id, op, to };
      if (ty !== undefined) _msg['ty'] = ty;
      this.#out(_msg);
    });
  }${(!mergedActor.name && ctx.actorNames.size > 0) || ctx.wrappedChildParams.size > 0 || ctx.usesChildSend ? `

  async #childSend(child, op) {
    // A self-return from a remote yields an address, not a handle: \`to\` is
    // the address itself (#out drops the brackets that mark it as a value).
    if (typeof child === 'string') return this.#send(op, child);
    const id = '.' + (++this.#localId);
    return new Promise((resolve, reject) => {
      // A child's self-return arrives untranslated. We're its parent, so the
      // translation is ours: its self address \`#<:>\` means this handle,
      // as the whole value or one slot of several.
      const mine = (v) => {
        if (v === '#<:>') return child;
        if (Array.isArray(v)) return v.map(mine);
        if (v && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mine(x)]));
        return v;
      };
      this.#pending.set(id, { resolve: (v) => resolve(mine(v)), reject });
      child.receive({ id, op, from: '__parent', _route: (msg) => this.receive(msg) });
    });
  }

  // A launched call, or one to a silent function: nothing waits for a reply, so
  // any that comes is dropped.
  #childFire(child, op) {
    if (typeof child === 'string') { this.#fire(op, child.startsWith('#<') && child.endsWith('>') ? child.slice(2, -1) : child); return; }
    child.receive({ id: '.' + (++this.#localId), op, from: '__parent', _route: () => {} });
  }

  // A call on the result of a call. The receiver is whatever the first call
  // yielded: a child handle, or an address from a self-return.
  async #childSendChain(recv, op) {
    const r = BvObject.pack(await recv);
    return this.#childSend(r.selfReturn ? '#<:>' : r.positional[0], op);
  }

  async #childSendRead(recv, prop) {
    const r = BvObject.pack(await recv);
    const v = r.selfReturn ? '#<:>' : r.positional[0];
    if (typeof v === 'string' || typeof v?.receive === 'function') return BvObject.one(BvObject.pack(await this.#childSend(v, prop)), prop);
    throw new Error("'" + prop + "' read on a value in a chain: bind the value first");
  }` : ''}${fnSection}

  #capture() {
    // Each cell by its wire name: ~val, pub.
    return {${[...allFieldNames].map(n => ` ${JSON.stringify(wireLabel(n))}: this.#${stateKey(n)}`).join(',')} };
  }

  #hydrate(state) {
${[...allFieldNames].map(n => `    if (${JSON.stringify(wireLabel(n))} in state) this.#${stateKey(n)} = state[${JSON.stringify(wireLabel(n))}];`).join('\n')}
  }

  async #_test(message) {
    const t = message.test;
    if ('target' in t) {
      // A target is a run of wire names, space-delimited: \`~o ~inner\`
      const parts = t.target.split(' ').filter(Boolean);
      const childName = parts[0];
      const _refs = {${[...allFieldNames].map(n => ` ${JSON.stringify(wireLabel(n))}: this.#${stateKey(n)}`).join(',')} };
      const child = _refs[childName];
      if (!child || typeof child.receive !== 'function') {
        this.#binding.post({ id: message.id, ex: { target: 'not_found' }, to: message.from });
        return;
      }
      const rest = parts.slice(1);
      const fwd = { ...t };
      delete fwd.target;
      if (rest.length > 0) fwd.target = rest.join(' ');
      if ('set' in fwd || 'update' in fwd) {
        child.receive({ test: fwd, from: message.from });
      } else {
        const fwdId = String(++this.#nextId);
        this.#_testFwd.set(fwdId, (reply) => {
          this.#binding.post({ ...reply, id: message.id });
        });
        child.receive({ id: fwdId, test: fwd, from: message.from });
      }
      return;
    }
    if ('get' in t) {
      const _vals = {${[...allFieldNames].map(n => ` ${JSON.stringify(wireLabel(n))}: this.#${stateKey(n)}`).join(',')} };
      const _types = {${[...stateVarDecls.map(v => ` ${JSON.stringify(wireLabel(v.name))}: ${JSON.stringify(v.typeNameEnc === undefined ? undefined : typeText(v.typeNameEnc, ctx.depAliases))}`), ...constructorParams.map(p => ` ${JSON.stringify(wireLabel(p.name))}: ${JSON.stringify(typeText(orAny(envTypeOf(p)), ctx.depAliases))}`)].join(',')} };
      const _tyOf = {${[...stateVarDecls.map(v => [v.name, v.typeNameEnc]), ...constructorParams.map(p => [p.name, orAny(envTypeOf(p))])].map(([n, ty]) => ` ${JSON.stringify(wireLabel(n))}: () => ${jsSlotTag(ctx, ty, `this.#${stateKey(n)}`)}`).join(',')} };
      let _v = t.get in _vals ? _vals[t.get] : null;
      if (_types[t.get] === 'Object' && _v && typeof _v === 'object' && _v.positional) {
        const _hasPos = _v.positional.length > 0;
        const _hasNamed = _v.named && Object.keys(_v.named).length > 0;
        _v = _hasPos && _hasNamed ? [..._v.positional, _v.named] : _hasPos ? _v.positional : _v.named || {};
      }
      const _post = { id: message.id, re: [_v], to: message.from };
      const _tag = _tyOf[t.get]?.();
      if (_tag != null) _post['ty'] = [_tag];
      this.#binding.post(_post);
    } else if ('set' in t) {
      const _sv = t.set;
      const payload = Array.isArray(_sv) ? _sv : [_sv];
      this.#dispatch({ op: [payload, '$set'], from: '__self' });
    } else if ('update' in t) {
      const _uv = t.update;
      const payload = Array.isArray(_uv) ? _uv : [_uv];
      this.#dispatch({ op: [payload, '$update'], from: '__self' });
    } else if ('op' in t) {
      await this.#dispatch({ id: message.id, op: t.op, ...('to' in t ? { to: t.to } : {}), from: '__test', _replyTo: message.from });
    }
  }

${readsOuter ? `  // A read of a cell of an actor this class is declared in, \`level\` actors up the
  // chain. A class is its own actor, so it asks.
  // It's delivered, not run in the sender's turn: the owner answers at its next
  // await, or once the turn it's in ends.
  async #outerRead(name, level) {
    const id = String(++this.#nextId);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: (v) => resolve(Array.isArray(v) ? v[0] : v), reject });
      const owner = this.#chain[level - 1];
      queueMicrotask(() => owner.receive({ id, op: '$get', to: ':' + name, from: '__child', _route: (msg) => this.receive(msg) }));
    });
  }

  // The actor \`level\` up the chain, as a receiver: a write or a call to it is a
  // message from inside it, delivered as a read is.
  #_up(level) {
    const owner = this.#chain[level - 1];
    return { receive: (msg) => queueMicrotask(() => owner.receive({ ...msg, from: '__inner' })) };
  }

` : ''}${!actor.name && ctx.readsOuter ? `  // A class of this file calling one of our dependencies: we make the call as our
  // own, and pass its reply back.
  // A class block speaks for itself across the wire (\`$extend\`, a delegated call, a
  // callback): its address, under ours, is the message's \`from\` (\`_asFrom\`).
  #_outerCall(message) {
    const { _route, _silent, from, _asFrom, id: childId, ...call } = message;
    // Its own id, so the reply, to its address, is routed to it as it is.
    if (_asFrom) {
      // Under an id of ours, as every call a class of ours makes is; its reply, to its
      // address, comes back to it under its own (even before it's published).
      const id = String(++this.#nextId);
      if (!_silent && _route) this.#_selfFwd.set(_asFrom + '|' + id, { route: _route, id: childId });
      this.#binding.post({ ...call, id, from: _asFrom });
      return;
    }
    const id = String(++this.#nextId);
    if (!_silent) this.#_outerFwd.set(id, { route: _route, id: childId });
    this.#binding.post({ ...call, id });
  }

` : ''}${readable ? `  // \`$get\` to one of our names: \`{ read, open }\`, open for a public cell.
  #_readableNames() { return { ${readable} }; }

` : ''}${hasDeferred ? `  // A cell a child's construction waits on has its value: answer the reads held for it.
  #_cellReady(name) {
    const waiting = this.#_pendingCells.get(name) || [];
    this.#_pendingCells.delete(name);
    for (const message of waiting) this.#dispatch(message);
  }

  // A child constructed without waiting; the block's end waits for it.
  #_join(child) {
    this.#_joins.push(child._ready);
    return child;
  }

` : ''}${ext ? ext.methods : ''}  async #selfSend(op) {
    const _opName = Array.isArray(op) ? op[op.length - 1] : op;
    const id = String(++this.#nextId);${[...silentFnNames].some(n => !intrinsicArm(n)) ? `
    if (${JSON.stringify([...silentFnNames].filter(n => !intrinsicArm(n)).map(wireLabel))}.includes(_opName)) {
      this.#dispatch({ id, op, from: '__self' });
      return;
    }` : ''}
    const p = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    await this.#dispatch({ id, op, from: '__self' });
    return p;
  }

${homeExt ? homeExt.methods : ''}${publishesClasses ? `  // An actor made by \`#new\` has its own address, so it's reached through here,
  // and we translate what it sends, as a parent does.
  // \`cls\` null is our own class (a file that declares \`new\`): \`N\`, tagged \`:\`.
  #_publishInstance(cls, inst) {
    // Published once: as it's made (a class that builds a layer), or when \`new\` replies.
    if (this.#_addrOf.has(inst)) return this.#_addrOf.get(inst);
    const n = (this.#_instanceSeq.get(cls) || 0) + 1;
    this.#_instanceSeq.set(cls, n);
    if (cls === null) return this.#_publishAt(String(n), ':', inst);
    return this.#_publishAt(_opre_join([cls, String(n)]), _opre_join([null, cls]), inst);
  }

  // \`$new\` is answered by the class, relative to itself: \`#<:N>\`, tagged \`:\`.
  // Our own class's reply is ours; a class of ours we pass on under its label
  // (\`#<:C:N>\`, \`:C\`), as we translate what an actor of ours sends.
  #_newReply(cls, inst) {
    const at = this.#_publishInstance(cls, inst);
    const reply = { re: '#<:' + _opre_split(at).at(-1) + '>', ty: ':' };
    if (cls === null) return reply;
    const label = _opre_quote(cls);
    return { re: _opre_map_bracketed(reply.re, (a) => _opre_under(a, label)), ty: _opre_under(reply.ty, label) };
  }

  // Publish an actor of ours under the tokens \`addr\`, its class tagged \`tag\`:
  // \`C:N\` / \`:C\` for one made by \`#new\`, \`s\` / \`*\` for a singleton (no \`new\` built it).
  #_publishAt(addr, tag, inst) {
    this.#_instances.set(addr, inst);
    this.#_addrOf.set(inst, addr);
    // What it sends relative to itself, \`:x\`, is \`:addr:x\` to us. Any other
    // address is global and passes through.
    const local = (v) => {
      if (typeof v === 'string') return _opre_map_bracketed(v, (a) => _opre_under(a, addr));
      if (Array.isArray(v)) return v.map(local);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, local(x)]));
      return v;
    };
    // \`ty\` has no brackets. A bare \`:\` is the sender's own class, which we know.
    // A type's tag names its authority from the file actor (\`:Point\`,
    // \`:W:X\`), which is where the instance found it: it stays as it is.
    const localTy = (v) => {
      if (v === ':') return tag;
      if (typeof v === 'string') return _bv_type_name(v) ? v : _opre_under(v, addr);
      if (Array.isArray(v)) return v.map(localTy);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localTy(x)]));
      return v;
    };
    // A self-return says "me" with \`#<:>\`, tagged \`:\`.
    // A call it makes through the file actor (\`lift\`) is translated here and
    // by each parent above us, but its \`from\` is the file actor's.
    inst._adoptBinding({
      post: (msg) => {
        const { ty, ...rest } = msg;
        const out = { ...local(rest), to: msg.to, from: msg.from ? _opre_under(msg.from, addr) : ':' + addr };
        if ('ty' in msg) out['ty'] = localTy(ty);
        this.#binding.post(out);
      },
      lift: (msg) => {
        const { ty, ...rest } = msg;
        const out = { ...local(rest), to: msg.to };
        if ('ty' in msg) out['ty'] = localTy(ty);
        return this.#_lift ? this.#_lift(out) : out;
      },
    });
    return addr;
  }

  // A reply leaving for the wire names an actor we published by its address.
  #_wireOwn(v) {
    const addr = v && typeof v === 'object' ? this.#_addrOf.get(v) : undefined;
    if (addr) return '#<:' + addr + '>';
    if (Array.isArray(v)) return v.map(x => this.#_wireOwn(x));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.#_wireOwn(x)]));
    return v;
  }

` : ''}  receive(message) {
    // A bracketed \`to\`, \`from\` or \`ty\` is malformed: rejected, never routed.
    if (_opre_bad_address(message)) {
      const _op = Array.isArray(message.op) ? message.op[message.op.length - 1] : message.op;
      if (message.id !== undefined && typeof _op === 'string') {
        (message._route || ((msg) => this.#binding.post(msg)))({ id: message.id, ex: { [_op]: 'bad_address' }, to: _opre_unbracket(message.from) });
      }
      return;
    }${!actor.name && ctx.readsOuter ? `
    // A reply to a class of ours that spoke for itself (\`_asFrom\`).
    if (!('op' in message) && typeof message.to === 'string' && this.#_selfFwd.has(message.to + '|' + message.id)) {
      const fwd = this.#_selfFwd.get(message.to + '|' + message.id);
      this.#_selfFwd.delete(message.to + '|' + message.id);
      const { to: _to, ...reply } = message;
      fwd.route({ ...reply, id: fwd.id });
      return;
    }` : ''}${actor.spawnable ? `
    // Still being constructed: a request waits; a reply is what construction waits on.
    if (this.#_starting && ('op' in message || message.test || message.cam)) {
      const later = () => this.receive(message);
      this.#_starting.then(later, later);
      return;
    }` : ''}${publishesClasses ? `
    if (typeof message.to === 'string') {
      // An actor we published: \`Box:1\` (by \`#new\`) or \`s\` (a singleton),
      // then whatever is inside it, which we pass on relative to it.
      const _toks = _bv_local_tokens(message.to);
      // \`$new\` to a class's own label (\`:C\`) builds one here, though its members
      // are published there.
      const _isNew = (Array.isArray(message.op) ? message.op[message.op.length - 1] : message.op) === '$new';
      for (let _n = Math.min(2, _toks.length); _n > 0; _n--) {
        if (_isNew && _n === _toks.length) continue;
        const _at = _opre_join(_toks.slice(0, _n));
        const _inst = this.#_instances.get(_at);
        // A layer, to anyone but the actor that built it, isn't there.
        if (_inst && 'op' in message && this.#_layerOwner.has(_at) && message.from !== this.#_layerOwner.get(_at)) break;
        if (_inst) { _inst.receive({ ...message, to: _toks.length > _n ? _opre_join([null, ..._toks.slice(_n)]) : undefined }); return; }
      }
    }` : ''}
    if (this.#_testFwd.has(message.id)) {
      const cb = this.#_testFwd.get(message.id);
      this.#_testFwd.delete(message.id);
      cb(message);
      return;
    }${!actor.name && ctx.readsOuter ? `
    if (message.from === '__child' && (message.op !== '$get' || message._asFrom) && typeof message.to === 'string' && message._route) { this.#_outerCall(message); return; }
    if (('re' in message || 'ex' in message) && this.#_outerFwd.has(message.id)) {
      const fwd = this.#_outerFwd.get(message.id);
      this.#_outerFwd.delete(message.id);
      fwd.route({ ...message, id: fwd.id });
      return;
    }` : ''}
    if ('re' in message) {
      const newResolve = this.#_newPending.get(message.id);
      if (newResolve) { this.#_newPending.delete(message.id); newResolve(_bv_new_reply_addr(message)); return; }
      const pending = this.#pending.get(message.id);
      // A reply's \`re\` is a list (its return Object); anything else is malformed.
      if (pending && !Array.isArray(message.re)) {
        this.#pending.delete(message.id);
        if (!pending.persistent) pending.reject(new Error("a reply's re is a list"));
        return;
      }
      if (pending) {
        if (pending.persistent) { pending.handler(_bv_unwire_reply(message.re, message['ty'])); return; }
        this.#pending.delete(message.id); pending.resolve(_bv_unwire_reply(message.re, message['ty'])); return;
      }
      // No matching pending — may need to forward to a proxy via remote routes
    }
    if ('ex' in message) {
      const newResolve = this.#_newPending.get(message.id);
      if (newResolve) { this.#_newPending.delete(message.id); newResolve(null); return; }
      const pending = this.#pending.get(message.id);
      if (pending) { this.#pending.delete(message.id); pending.reject(message.ex); return; }
      // No matching pending — may need to forward to a proxy via remote routes
    }
    if (message.cam === 'capture') {
      this.#binding.post({ id: message.id, re: [this.#capture()], to: message.from });
      return;
    }
    if (Array.isArray(message.cam) && message.cam[message.cam.length - 1] === 'hydrate') {
      this.#hydrate(message.cam[0]);
      this.#binding.post({ id: message.id, re: ['hydrate'], to: message.from });
      return;
    }
    if (message.test) {
      this.#_test(message);
      return;
    }
    if (this.#_remoteRoutes && message.from) {
      const proxy = this.#_remoteRoutes.get(message.from);
      if (proxy) { proxy.receive(message); return; }
    }
    // A reply nobody is waiting for, such as one to a silent call, has nothing to run.
    ${ext ? `// A reply to a message we passed on goes back where that one came from.
    if (!('op' in message) && this.#_relays.has(message.id)) { const relay = this.#_relays.get(message.id); this.#_relays.delete(message.id); relay(message); return; }
    ` : ''}if (!('op' in message) && ('re' in message || 'ex' in message)) return;${ext ? `
    message = this.#_admit(message);
    if (!message) return;` : ''}
    this.#dispatch(message);
  }

  async #dispatch(message) {
    const { id } = message;${ext ? `
    // The context a delegated call runs in: an extender's record, or none.
    const _ctx = ${ext.isBlock ? 'message._ctx ?? null' : "'_ctx' in message ? message._ctx : this.#_layerCtx"};` : ''}
    const from = message.from;
    const _replyTo = message._replyTo || from;
    let opName = typeof message.op === 'string' ? message.op : message.op[message.op.length - 1];
    // An intrinsic (\`$set\`, \`$new\`, \`$subscribe\`, …) names its cell, class or
    // function as the last token of \`to\` (\`:val\`, \`:Box\`), relative to us.
    const _target = typeof opName === 'string' && opName.startsWith('$') ? (_bv_local_tokens(message.to).pop() ?? null) : null;${homeExt ? `
    // A class of ours extended from another file, or a layer built for one there.
    if (this.#_classHandshake(message, opName, _target, from, _replyTo)) return;` : ''}
    if (opName === '$subscribe' && _target !== null${propNames.length ? ` && !${JSON.stringify(propNames.map(n => wireLabel("@" + n)))}.includes(_target)` : ''}) {
      // A protected or private name (\`~a\`, \`#a\`) is subscribed to only from inside:
      // from outside it isn't there, and nothing is registered.
      if (/^[~#]/.test(_target) && !(from === '__self' || from === '__test' || from === '__parent' || from === '__child' || from === '__inner')) {
        (message._route || ((msg) => this.#binding.post(msg)))({ id, ex: { $subscribe: 'unhandled' }, to: _replyTo });
        return;
      }
      const _subArgs = Array.isArray(message.op) && message.op.length > 1 ? message.op[0] : null;
      // Keyed by the wire name: \`a\`, \`~a\` and \`#a\` are different cells.
      let _subs = this.#_cellSubs?.get(_target);
      if (!_subs && this.#_cellSubs) { _subs = []; this.#_cellSubs.set(_target, _subs); }
      if (_subs) _subs.push({ id, from: _replyTo, args: _subArgs, route: message._route || null });
      // The first reply is the current value: the target answers its own op.
      opName = _target;${readable ? `
      // A protected or private cell has no op of its own: from inside, its value.
      const _own = this.#_readableNames()[_target];
      if (_own && !_own.open && (from === '__self' || from === '__parent' || from === '__child' || from === '__inner')) {
        (message._route || ((msg) => this.#binding.post({ ...msg, to: _replyTo })))({ id, re: [_own.read()] });
        return;
      }` : ''}
    }${readable ? `
    if (opName === '$get' && _target !== null) {
      const _cell = this.#_readableNames()[_target];
      const _inside = from === '__self' || from === '__test' || from === '__parent' || from === '__child' || from === '__inner';
      if (_cell && (_cell.open || _inside)) {${hasDeferred ? `
        // Not declared yet: answered when its line runs.
        const _waiting = this.#_pendingCells.get(_target);
        if (_waiting) { _waiting.push(message); return; }` : ''}
        // A public cell answers through its own reader, typed; an inside read is
        // a value in this process.
        if (_cell.open) opName = _target;
        else { (message._route || ((msg) => this.#binding.post({ ...msg, to: _replyTo })))({ id, re: [_cell.read()] }); return; }
      }
    }` : ''}
    const _rawPayload = Array.isArray(message.op) && message.op.length > 1 ? message.op[0] : null;
    // An arg list is always a list: an object in \`op\` is not one.
    if (_rawPayload !== null && typeof _rawPayload === 'object' && !Array.isArray(_rawPayload)) {
      (message._route || (from === '__self' ? (msg) => this.receive(msg) : (msg) => this.#binding.post(msg)))({ id, ex: { [opName]: 'bad_op' }, to: _replyTo });
      return;
    }
    const _hasPayload = _rawPayload !== null && _rawPayload !== undefined &&
      (Array.isArray(_rawPayload) ? _rawPayload.length > 0 : Object.keys(_rawPayload).length > 0);
    if (_hasPayload && opName !== '$as' && !('ty' in message) && from !== '__parent' && from !== '__inner' && from !== '__self' && from !== '__test'${remoteRefChecks ? ` && ${remoteRefChecks}` : ''}) {
      this.#binding.post({ id, ex: { [opName]: 'schema_required' }, to: _replyTo });
      return;
    }
    const payload = _rawPayload ?? {};${objectLine}${tyDecl}${typesLines}
    let re;
    let _ty_re;
    let _handled = false;
    try {
${ifChain}
    } catch (err) {
      const _route = message._route || (from === '__self' ? (msg) => this.receive(msg) : (msg) => this.#binding.post(msg));
      _route({ id, ex: { [opName]: err?.bvEx ?? 'error' }, to: _replyTo });
      return;
    }
    const _route = message._route || (from === '__self' ? (msg) => this.receive(msg) : (msg) => this.#binding.post(msg));
    if (!_handled) {
      _route({ id, ex: { [opName]: 'unhandled' }, to: _replyTo });
    } else if (re !== undefined) {
      // A reply is a return Object, and its wire form is a list: an address is
      // its one value (\`re: ['#<…>']\`), named values its last (\`re: [{ … }]\`).
      // A self-return is tagged with our class (\`:\`, which our parent fills
      // in), or \`*\` when no \`new\` built us.
      if (!Array.isArray(re)) {
        if (_ty_re === undefined && re === '#<:>') _ty_re = ${JSON.stringify(declaredActor(actor) ? '*' : ':')};
        re = [re];
        if (_ty_re !== undefined && !Array.isArray(_ty_re)) _ty_re = [_ty_re];
      }
      const _post = { id, re${publishesClasses ? `: (message._route || from === '__self') ? re : this.#_wireOwn(re)` : ''}, to: _replyTo };
      if (_ty_re !== undefined) _post['ty'] = _ty_re;
      _route(_post);
    }
  }
}`;
}

export function codegen(ast, options = {}) {
  const ctx = createContext();
  // Wire late binding for genFunctionBodyCode
  ctx.genFunctionBodyCode = genFunctionBodyCode;
  ctx.genIfChain = genIfChain;
  // Self-as-value provisioning: validate() has already enforced that any AST
  // using Self in value position was compiled with `options.fileName`. Each
  // class that needs it picks up the address from ctx in genClass; classes
  // that never reference Self as a value pay no cost.
  ctx.fileName = options.fileName;
  // Build remotes from inline interfaces and merge with options.remotes
  // (the inline definition wins — see validate)
  const inlineRemotes = {};
  for (const d of (ast.dependencies || [])) {
    if (d.interfaceDoc) inlineRemotes[d.name] = d.interfaceDoc;
  }
  // Resolve path-keyed remotes to alias names
  const resolvedRemotes = {};
  if (options.remotes) {
    if (Array.isArray(options.remotes)) {
      const pathToAlias = new Map();
      for (const d of (ast.dependencies || [])) {
        if (d.path) pathToAlias.set(d.path, d.name);
      }
      for (const { path, service } of options.remotes) {
        const alias = pathToAlias.get(path);
        if (alias) resolvedRemotes[alias] = readRemote(service, { path }).doc;
      }
    } else {
      for (const [name, service] of Object.entries(options.remotes)) resolvedRemotes[name] = readRemote(service, { path: (ast.dependencies || []).find(d => d.name === name)?.path ?? null }).doc;
    }
  }
  const _remotes = Object.keys(inlineRemotes).length > 0 || Object.keys(resolvedRemotes).length > 0
    ? { ...resolvedRemotes, ...inlineRemotes } // an inline definition wins
    : null;
  // A subclass with an empty body (`Box = (Base++) *{}`) is still a class: its
  // surface is all inherited.
  const active = ast.actors.filter(a => a.functions.length > 0 || a.singletonOf || a.asClauses?.length > 0 || (a.constructorBody && a.constructorBody.length > 0) || (a.stateVarDecls && a.stateVarDecls.length > 0) || (a.initParams && a.initParams.length > 0) || (a.supertypes && a.supertypes.length > 0));
  if (active.length === 0) return '';

  function bodyUsesObject(body) {
    return body.some(s =>
      s.type === 'DestructureAssign' ||
      s.type === 'TypedAssign' ||
      (s.type === 'Assign' && (
        s.value.type === 'Function' ||
        s.value.type === 'ObjectLiteral' ||
        s.value.type === 'ObjectConstructor' ||
        CALL_LIKE.has(s.value.type) ||
        s.value.type === 'DotCallExpr'
      )),
    );
  }
  function bodyUsesList(body) {
    const iterExpr = t => t === 'OverExpr' || t === 'ReduceExpr';
    // Deep walk for ListMethodExpr — `List.size(nums)` and `*nums.first` need
    // the preamble even when the surrounding statement is plain Reply or Assign.
    const hasListMethod = (n) => {
      if (!n || typeof n !== 'object') return false;
      if (Array.isArray(n)) return n.some(hasListMethod);
      if (n.type === 'ListMethodExpr' || n.type === 'ListLiteral') return true;
      for (const k of Object.keys(n)) { if (k === 'type') continue; if (hasListMethod(n[k])) return true; }
      return false;
    };
    return body.some(s =>
      s.type === 'ListDestructure' ||
      (s.type === 'Assign' && (s.value?.type === 'ListLiteral' || iterExpr(s.value?.type))) ||
      (s.type === 'TypedAssign' && (
        leadsWithList(s.typeNameEnc) ||
        iterExpr(s.value?.type)
      )) ||
      (s.type === 'BareTypeDecl' && leadsWithList(s.typeNameEnc)) ||
      hasListMethod(s),
    );
  }
  // A lambda anywhere in a handler (as a call arg, type-field value, etc.) is
  // lowered to a synthesized dispatch arm that wraps its result in BvObject, so
  // its presence requires the Object preamble even when the enclosing handler
  // otherwise wouldn't. (ctx.lambdaHandlers isn't populated yet at this point,
  // so detect the Function nodes straight from the AST.)
  const hasNestedFunction = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(hasNestedFunction);
    if (node.type === 'Function') return true;
    for (const k in node) {
      if (k === 'type') continue;
      if (hasNestedFunction(node[k])) return true;
    }
    return false;
  };
  const needsPreamble = (ast.dependencies || []).some(d => d.wireTarget) || active.some(a =>
    a.functions.some(f => f.name && ((f.name.startsWith('@') || f.name === 'set' || f.name === 'update') ? (f.params.length > 0 || bodyUsesObject(f.body) || bodyHasEarlyReturn(f.body)) : true)) ||
    a.functions.some(f => hasNestedFunction(f.body) || hasNestedFunction(f.expr)) ||
    (a.initBody && bodyUsesObject(a.initBody)) ||
    // A cell set from a call holds the reply's one value.
    (a.initBody || []).some(s => s.value?.type === 'DotCallExpr') ||
    (a.initParams && a.initParams.length > 0),
  );
  const needsListPreamble = active.some(a =>
    a.functions.some(f =>
      f.params.some(p => leadsWithList(p.typeEnc)) ||
      bodyUsesList(f.body),
    ) ||
    (a.initBody && bodyUsesList(a.initBody)) ||
    (a.stateVarDecls || []).some(v => leadsWithList(v.typeNameEnc)),
  );
  // ── Constructor overloads: promote actorDef FunctionDecls to synthetic actors ──
  // Collect overload clauses from the anonymous actor's functions
  ctx.constructorOverloads = new Map(); // baseName → [{ mangledName, params }]
  const syntheticActors = [];
  const existingActorNames = new Set(active.filter(a => a.name).map(a => a.name));
  for (const a of active) {
    if (a.name) continue; // only check anonymous actor (file-level)
    // Group actorDef FunctionDecls by name
    const actorDefsByName = new Map();
    for (const fn of a.functions) {
      if (!fn.actorDef) continue;
      if (!actorDefsByName.has(fn.name)) actorDefsByName.set(fn.name, []);
      actorDefsByName.get(fn.name).push(fn);
    }
    for (const [baseName, fns] of actorDefsByName) {
      const hasPrimaryActor = existingActorNames.has(baseName);
      if (!ctx.constructorOverloads.has(baseName)) ctx.constructorOverloads.set(baseName, []);
      const overloads = ctx.constructorOverloads.get(baseName);
      for (let i = 0; i < fns.length; i++) {
        const fn = fns[i];
        if (!hasPrimaryActor && i === 0) {
          // No primary Actor exists (Function() initializer case) — first clause becomes the primary
          const synActor = AST.actor(baseName, { ...fn.actorDef });
          syntheticActors.push(synActor);
        } else {
          const mangledName = `${baseName}_ov${overloads.length}`;
          overloads.push({ mangledName, params: fn.actorDef.params || fn.params || [] });
          const synActor = AST.actor(mangledName, { ...fn.actorDef });
          syntheticActors.push(synActor);
        }
      }
    }
  }
  active.push(...syntheticActors);

  // Every type this program knows, by the name the source uses for it, with
  // the address that identifies it (src/codegen/type_table.js). A service's
  // type is also known by its bare name, for what its document says.
  ctx.typeTable = buildTypeTable(ast);
  for (const info of Object.values(ast.crossModuleTypes || {})) {
    const entry = [...ctx.typeTable.values()].find(e => e.name === info.name && e.authority === (info.path || ''));
    if (entry && !ctx.typeTable.has(info.name)) ctx.typeTable.set(info.name, entry);
  }
  // The generator reads encoded types, so it finds a type by its address.
  ctx.typeDecls = new Map([...ctx.typeTable.values()].map(e => [e.key, e]));
  ctx.depAliases = dependencyAliases(ast);
  ctx.actorNodes = new Map(active.filter(a => a.name).map(a => [a.name, a]));
  // A class reads its file actor's cells through it, and sends everything bound
  // outside itself through it too, so every class gets it.
  ctx.readsOuter = hasOuterReads(ast) || ast.actors.some(a => a.name);
  ctx.outerTypes = fileOuterNames(ast);
  ctx.program = ast;
  // Build actorNames with merged initParams for subclasses (so constructor calls know full param list)
  ctx.actorNames = new Map(active.filter(a => a.name).map(a => {
    const { inheritedParams } = resolveSuperclassChain(ctx.actorNodes, a);
    const ownParamNames = new Set((a.initParams || []).map(p => p.name));
    const mergedParams = [
      ...inheritedParams.filter(p => !ownParamNames.has(p.name)),
      ...(a.initParams || []),
    ];
    // Pure value-tail wrapper: a class whose only contribution is a tail
    // expression (no handlers, no state, no asClauses, no inheritance, no
    // initBody). Calls to such a class are inline-expanded at the call site
    // so the tail evaluates in the caller's binding — necessary because an
    // instance's #init can't post outbound sends (e.g. `<button>…</button>`)
    // through the parent's binding without dedicated routing setup. See
    // notes/tail-return-wire-2026-04-15.md, Shape 1.
    const inlineExpandable = !!(a.declarationReturn
      && a.declarationReturn.typeNameEnc === undefined
      && !(a.functions || []).length
      && !(a.stateVarDecls || []).length
      && !(a.asClauses || []).length
      && !(a.supertypes || []).length
      && !(a.initBody || []).length);
    const asClauses = [...(a.asClauses || [])];
    if (a.declarationReturn && a.declarationReturn.typeNameEnc !== undefined) {
      asClauses.push({ targetTypeEnc: a.declarationReturn.typeNameEnc, negated: false, expr: a.declarationReturn.expr, memoized: true });
    }
    return [a.name, { asClauses, initParams: mergedParams, inlineExpandable, subscribedParams: subscribedParams(a) }];
  }));
  ctx.dependencyNames = new Set((ast.dependencies || []).map(d => d.name));
  ctx.depWireTargets = (ast.dependencies || []).filter(d => d.wireTarget).map(d => [d.name, d.wireTarget]);
  // A dependency's wire address is its source (src/codegen/dep_address.js).
  {
    const addressing = dependencyAddressing(ast);
    ctx.depAddress = addressing.address;
    ctx.depSource = addressing.source;
    ctx.depIsDependency = addressing.isDependency;
  }
  // destructuredMembers: localName → { service: the dependency's wire address, remote: remoteName }
  ctx.destructuredMembers = new Map();
  // A class a destructure binds: its block is at \`service:remote\`.
  ctx.destructuredClasses = new Map();
  // Template element hosts: an XML `<tag>` lowers to `#new` sent to the element-
  // factory address of whichever service the tag was destructured from. Keyed by
  // the REMOTE element name (so an alias like `(div: D)` still renders `<div>`).
  // A whole-namespace spread import `(...)` registers a single spread host that
  // any otherwise-unlisted tag routes to. No service name is privileged here.
  ctx.templateTagHost = new Map();
  ctx.templateSpreadHost = null;
  for (const d of (ast.dependencies || [])) {
    if (d.destructures) {
      for (const entry of d.destructures) {
        if (entry.spread) {
          if (!ctx.templateSpreadHost) ctx.templateSpreadHost = ctx.depSource(d.name);
          continue;
        }
        if (!entry.isClass) ctx.destructuredMembers.set(entry.local, { service: ctx.depAddress(d.name), remote: entry.remote });
        else ctx.destructuredClasses.set(entry.local, { service: ctx.depAddress(d.name), remote: entry.remote });
        ctx.dependencyNames.add(entry.local);
        if (entry.remote && !ctx.templateTagHost.has(entry.remote)) {
          ctx.templateTagHost.set(entry.remote, ctx.depSource(d.name));
        }
      }
    }
  }
  // Parse all remote interfaces for compile-time validation (TODO)
  const classes = active.map(a => genClass(ctx, a, a.name ? '' : 'export default ', _remotes) + '\n').join('\n');

  // The wire registry, by tag: each type's key and field keys in order, the
  // positional ones first (`pos` of them), so wire helpers shape the payload
  // as an Object's without re-inspecting the AST. `_bv_type_keys` maps the source's name for a
  // type to its key, for matching a tag against a param's type.
  const wireRegistryEntries = registryEntries(ast, ctx.typeTable).map(([lookup, key, fields]) => {
    const pos = fields.filter(f => !f.named).length;
    return `${JSON.stringify(lookup)}: { key: ${JSON.stringify(key)}, fields: [${fields.map(f => JSON.stringify(f.name)).join(', ')}], pos: ${pos} }`;
  }).join(', ');
  const typeKeyEntries = [...ctx.typeTable.entries()].map(([name, e]) => `${JSON.stringify(name)}: ${JSON.stringify(e.key)}`).join(', ');
  const wireBlock = `const _bv_types = { ${wireRegistryEntries} };\nconst _bv_type_keys = { ${typeKeyEntries} };\n${WIRE_PREAMBLE}\n\n`;

  return (needsPreamble ? OBJECT_PREAMBLE + '\n\n' : '') +
         DECIMAL_PREAMBLE + '\n\n' +
         AS_PREAMBLE + '\n\n' +
         EQUALITY_PREAMBLE + '\n\n' +
         wireBlock +
         (needsListPreamble ? LIST_PREAMBLE + '\n\n' : '') +
         TEXT_PREAMBLE + '\n\n' +
         MATH_PREAMBLE + '\n\n' +
         STRING_PREAMBLE + '\n\n' +
         classes;
}

export default codegen;
