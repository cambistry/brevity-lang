// brevity.js — browser entry point.
//
// Two roles:
//
//   1. Live browser: auto-bootstrap on DOMContentLoaded.
//      Finds every <script type="text/brevity">, compiles, runs via start().
//
//   2. Test harness: exposes window.__bv_harness__ so Playwright-driven
//      tests can run actors inside a real Chromium instance. Mirrors the
//      runner surface in src/codegen/browser/index.js one-for-one.
//
// The compiler runs in-page. Source is clean ESM with no Node builtins,
// so the browser fetches it directly via relative imports — no bundler.

import { tokenize } from '../../lexer.js';
import { parse } from '../../parser.js';
import { validate } from '../../validate.js';
import { codegen as jsCodegen } from '../javascript/classes.js';
import { start } from './runtime.js';

const tick = () => new Promise(r => setTimeout(r, 0));

// BigInt can't cross the Playwright CDP boundary; normalize to Number when safe.
function normalizeBigInts(val) {
  if (typeof val === 'bigint') {
    if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) return Number(val);
    return val;
  }
  if (Array.isArray(val)) return val.map(normalizeBigInts);
  if (val !== null && typeof val === 'object') {
    if (typeof val.toNumber === 'function' && 'c' in val && 's' in val) return val.toNumber();
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = normalizeBigInts(v);
    return out;
  }
  return val;
}

function hasRefRead(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasRefRead);
  if (node.type === 'RefRead') return true;
  for (const k of Object.keys(node)) {
    if (k === 'type') continue;
    if (hasRefRead(node[k])) return true;
  }
  return false;
}

function thunkDomBody(fn) {
  if (fn.expr && fn.expr.type === 'DomConstructor') return fn.expr;
  if (!fn.body || fn.body.length !== 1) return null;
  const stmt = fn.body[0];
  if (stmt.type === 'ImplicitReturn' && stmt.expr && stmt.expr.type === 'DomConstructor') return stmt.expr;
  if (stmt.type === 'Reply' && Array.isArray(stmt.fields) && stmt.fields.length === 1) {
    const f = stmt.fields[0];
    if (f.positional && f.expr && f.expr.type === 'DomConstructor') return f.expr;
  }
  return null;
}

function synthesizeTemplateClosures(ast) {
  // Mirror of the same-named pass in root index.js. See that file for the
  // full dispatch logic.
  for (const actor of (ast.actors || [])) {
    const pureThunks = new Map();
    for (const fn of (actor.functions || [])) {
      if (!fn.name || fn.name.startsWith('@') || fn.name.startsWith('#')) continue;
      if (fn.params && fn.params.length > 0) continue;
      if (hasRefRead(fn.body) || hasRefRead(fn.expr)) continue;
      const dom = thunkDomBody(fn);
      if (dom) pureThunks.set(fn.name, dom);
    }

    const textVars = new Set();
    for (const decl of (actor.stateVarDecls || [])) {
      if (!decl.isRef && decl.typeName === 'Text') textVars.add(decl.name);
    }

    const stateVarNames = new Set((actor.stateVarDecls || []).map(v => v.name));
    const pubRefGetters = new Map();
    for (const fn of (actor.functions || [])) {
      if (!fn.name || !fn.name.startsWith('@')) continue;
      if (fn.params && fn.params.length > 0) continue;
      const underlying = fn.name.slice(1);
      if (stateVarNames.has(underlying)) pubRefGetters.set(fn.name, underlying);
    }

    let counter = 0;
    for (const fn of (actor.functions || [])) {
      const m = /^@(\d+)$/.exec(fn.name || '');
      if (m) counter = Math.max(counter, parseInt(m[1], 10) + 1);
    }
    const synthesized = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (node.type === 'DomConstructor' && Array.isArray(node.children)) {
        for (let i = 0; i < node.children.length; i++) {
          const c = node.children[i];
          if (c && c.type === 'interp') {
            if (c.expr.type === 'Identifier' && pubRefGetters.has(c.expr.name)) {
              c.expr = { type: 'RefRead', name: pubRefGetters.get(c.expr.name) };
            }
            if (hasRefRead(c.expr)) {
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: [{ type: 'ImplicitReturn', expr: c.expr, typeName: null }],
              });
              node.children[i] = { type: 'closure_ref', name };
            } else if (c.expr.type === 'Identifier' && pureThunks.has(c.expr.name)) {
              node.children[i] = pureThunks.get(c.expr.name);
            } else if (c.expr.type === 'Identifier' && textVars.has(c.expr.name)) {
              node.children[i] = { type: 'strinterp', expr: c.expr };
            } else {
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: [{ type: 'ImplicitReturn', expr: c.expr, typeName: null }],
              });
              node.children[i] = { type: 'closure_ref', name };
            }
          }
        }
        if (Array.isArray(node.attrs)) {
          for (let i = 0; i < node.attrs.length; i++) {
            const a = node.attrs[i];
            if (a.value && a.value.type === 'handler') {
              // Event handler body (on* attrs): synthesize as a statement-body
              // closure — no implicit return, side effects only.
              const name = '@' + counter++;
              synthesized.push({
                type: 'FunctionDecl',
                name,
                params: [],
                body: a.value.body,
              });
              node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
            } else if (a.value && a.value.type === 'interp') {
              if (hasRefRead(a.value.expr)) {
                const name = '@' + counter++;
                synthesized.push({
                  type: 'FunctionDecl',
                  name,
                  params: [],
                  body: [{ type: 'ImplicitReturn', expr: a.value.expr, typeName: null }],
                });
                node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
              } else if (a.value.expr.type === 'Identifier' && textVars.has(a.value.expr.name)) {
                node.attrs[i] = { name: a.name, value: { type: 'strinterp', expr: a.value.expr } };
              } else {
                const name = '@' + counter++;
                synthesized.push({
                  type: 'FunctionDecl',
                  name,
                  params: [],
                  body: [{ type: 'ImplicitReturn', expr: a.value.expr, typeName: null }],
                });
                node.attrs[i] = { name: a.name, value: { type: 'closure_ref', name } };
              }
            }
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        walk(node[k]);
      }
    };
    for (const fn of (actor.functions || [])) walk(fn);
    for (const stmt of (actor.constructorBody || [])) walk(stmt);
    for (const stmt of (actor.initBody || [])) walk(stmt);
    if (synthesized.length) actor.functions.push(...synthesized);
  }
}

function assignClosureAddresses(ast) {
  // Mirror of the same-named pass in the root index.js. Bare-named fns that
  // look like reactive closures (parameter-less, read at least one captured
  // ref) become addressable as @0, @1, … in source-position order per actor.
  // See root index.js comment for full rationale.
  for (const actor of (ast.actors || [])) {
    let counter = 0;
    for (const fn of (actor.functions || [])) {
      if (!fn.name) continue;
      if (fn.name.startsWith('@') || fn.name.startsWith('#')) continue;
      if (fn.name === 'set' || fn.name === 'update' || fn.name.startsWith('set@')) continue;
      if (fn.params && fn.params.length > 0) continue;
      if (!hasRefRead(fn.body)) continue;
      fn.sourceName = fn.name;
      fn.name = '@' + counter;
      counter++;
    }
  }
}

function injectFileParamsIntoFileActor(ast) {
  const fileParams = (ast.dependencies || [])
    .filter(d => d.type === 'FileParam')
    .map(p => ({
      name: p.name,
      type: p.paramType,
      positional: !!p.positional,
      ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
    }));
  if (fileParams.length === 0) return;
  const fileActor = (ast.actors || []).find(a => !a.name);
  if (!fileActor) return;
  fileActor.initParams = [...fileParams, ...(fileActor.initParams || [])];
  fileActor.params = [...fileParams, ...(fileActor.params || [])];
}

// Mirror of root index.js — rewrites `Point(0, 0)` calls into
// TypeConstruction nodes when `Point` is a declared `::Type`.
// Slice 3 of types-implementation-plan-2026-04-27.
function rewriteTypeConstructions(ast) {
  const typeNames = new Set((ast.types || []).map(t => t.name));
  if (typeNames.size === 0) return;
  const isTypeCall = (n) =>
    n && n.type === 'FunctionCallExpr' &&
    n.callee?.type === 'Identifier' &&
    typeNames.has(n.callee.name);
  const toTypeConstruction = (n) =>
    ({ type: 'TypeConstruction', typeName: n.callee.name, args: n.args });
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i]);
        if (isTypeCall(node[i])) node[i] = toTypeConstruction(node[i]);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      const child = node[k];
      walk(child);
      if (isTypeCall(child)) node[k] = toTypeConstruction(child);
    }
  }
  walk(ast);
}

// Mirror of root index.js — coerces a positional Structure into a
// TypeConstruction at typed assignment sites whose LHS is a declared `::Type`.
// Slice 9 of types-implementation-plan-2026-04-27.
function coerceStructuresToTypes(ast) {
  const typesByName = new Map((ast.types || []).map(t => [t.name, t]));
  if (typesByName.size === 0) return;
  function structureToTypeConstruction(typeName, structureExpr) {
    const decl = typesByName.get(typeName);
    if (!decl) return null;
    const positional = (structureExpr.args || []).filter(a => a.positional);
    return { type: 'TypeConstruction', typeName, args: positional.map(a => a.expr) };
  }
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type === 'TypedAssign' &&
        typesByName.has(node.typeName) &&
        node.value &&
        (node.value.type === 'StructureConstructor' || node.value.type === 'StructureLiteral')) {
      const rewritten = structureToTypeConstruction(node.typeName, node.value);
      if (rewritten) node.value = rewritten;
    }
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      walk(node[k]);
    }
  }
  walk(ast);
}

export function extract(source) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  injectFileParamsIntoFileActor(ast);
  assignClosureAddresses(ast);
  synthesizeTemplateClosures(ast);
  rewriteTypeConstructions(ast);
  coerceStructuresToTypes(ast);
  return { ast };
}

export function compile(ast, options = {}) {
  validate(ast, options);
  return jsCodegen(ast, options);
}

async function compileAndLoad(source, compileOptions = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'browser' });
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
  const mod = await import(/* webpackIgnore: true */ dataUrl);
  return mod.default;
}

// ── In-page test harness ────────────────────────────────────────────────────
//
// Lives on window.__bv_harness__. Each call is one round-trip from Node-side
// Playwright into the page. Handles are id-keyed, stored in `handles`.
//
// The harness acts as the "parent" of each spawned actor in the CAM tree
// sense. Actors emit messages in their own coordinate system; the parent
// translates on the way out (see notes/layer-a-closure-as-child-2026-04-22.md):
//
//   - Payload `#<@N>` / `#<#N>` → `#<selfAddr @N>` (space between alias and selector).
//     Global-form addresses (word-char start inside the angles) are left
//     alone; the discriminator is leading non-word-char = local.
//   - Missing `from` → filled in with selfAddr.
//   - Local-form `from: '@N'` → prepended to `from: 'selfAddr @N'`.
//   - `to` field is untouched; the sender writes it in its own DI frame
//     already (e.g. 'HTML @div'), which is application-absolute for now.
//
// The rewrite runs as a raw-text regex on serialized JSON because `#<` can
// only appear inside JSON string values (never structural) — one-scan pass
// with no object-tree walk.

const handles = new Map();
const compiled = new Map();
let nextId = 0;

function rewriteLocalAddresses(msg, selfAddr) {
  const json = JSON.stringify(msg);
  const rewritten = json.replace(/#<([@#][^>]*)>/g, (_, content) => `#<${selfAddr} ${content}>`);
  const out = JSON.parse(rewritten);
  if (out.from == null || out.from === '') {
    out.from = selfAddr;
  } else if (typeof out.from === 'string' && /^[@#]/.test(out.from)) {
    out.from = selfAddr + ' ' + out.from;
  }
  return out;
}

// Translation is opt-in: passing compileOptions.selfAddr enables parent-
// layer translation (fill from, prepend local from, rewrite payload
// addresses). Without it, posts flow through untouched — existing tests
// that assert exact message shape stay unaffected.
function wrapBindingPost(posts, selfAddr) {
  if (!selfAddr) return { post: msg => posts.push(msg) };
  return {
    post: msg => posts.push(rewriteLocalAddresses(normalizeBigInts(msg), selfAddr)),
  };
}

async function runActor({ source, compileOptions = {}, receive = [] }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const posts = [];
  const binding = wrapBindingPost(posts, compileOptions.selfAddr);
  const actor = await ActorClass.create(binding);
  for (const msg of receive) {
    actor.receive(msg);
    await tick();
  }
  return posts.map(normalizeBigInts);
}

async function createActor({ source, compileOptions = {}, args = [] }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const posts = [];
  const binding = wrapBindingPost(posts, compileOptions.selfAddr);
  const instance = await ActorClass.create(binding, ...args);
  const id = String(++nextId);
  handles.set(id, { instance, posts, drained: 0 });
  return id;
}

async function sendBatchAndDrain({ id, msgs }) {
  const h = handles.get(id);
  if (!h) throw new Error(`brevity.js: no actor handle ${id}`);
  for (const msg of msgs) {
    h.instance.receive(msg);
    await tick(); await tick();
  }
  const fresh = h.posts.slice(h.drained);
  h.drained = h.posts.length;
  return fresh.map(normalizeBigInts);
}

function drainPosts(id) {
  const h = handles.get(id);
  if (!h) throw new Error(`brevity.js: no actor handle ${id}`);
  const fresh = h.posts.slice(h.drained);
  h.drained = h.posts.length;
  return fresh.map(normalizeBigInts);
}

async function compileActor({ source, compileOptions = {} }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const id = String(++nextId);
  compiled.set(id, { ActorClass, selfAddr: compileOptions.selfAddr });
  return id;
}

async function spawnCompiled({ compiledId, args = [] }) {
  const entry = compiled.get(compiledId);
  if (!entry) throw new Error(`brevity.js: no compiled actor ${compiledId}`);
  const { ActorClass, selfAddr } = entry;
  const posts = [];
  const binding = wrapBindingPost(posts, selfAddr);
  const instance = await ActorClass.create(binding, ...args);
  const id = String(++nextId);
  handles.set(id, { instance, posts, drained: 0 });
  return id;
}

async function runActors({ actors, messages }) {
  const external = [];
  const instances = {};
  for (const [name, { source, compileOptions }] of Object.entries(actors)) {
    const ActorClass = await compileAndLoad(source, compileOptions);
    instances[name] = { ActorClass };
  }
  for (const [name, inst] of Object.entries(instances)) {
    inst.binding = {
      post(msg) {
        const to = msg.to;
        if (to && instances[to]) {
          instances[to].instance.receive({ ...msg, from: name });
        } else {
          external.push(msg);
        }
      },
    };
    inst.instance = await inst.ActorClass.create(inst.binding);
  }
  for (const [target, msg] of messages) {
    instances[target].instance.receive(msg);
    await tick();
  }
  return external.map(normalizeBigInts);
}

// Reset state between test invocations that want full isolation. Tests
// generally don't call this; handles just accumulate and are GC'd when the
// page is torn down at worker shutdown.
function reset() {
  handles.clear();
  compiled.clear();
  nextId = 0;
}

globalThis.__bv_harness__ = {
  extract,
  compile,
  runActor,
  createActor,
  sendBatchAndDrain,
  drainPosts,
  compileActor,
  spawnCompiled,
  runActors,
  reset,
};

// ── Live-page bootstrap ─────────────────────────────────────────────────────

async function bootstrap() {
  try {
    const page = await start(document, { extract, compile });
    globalThis.brevity = page;
  } catch (err) {
    console.error('brevity.js bootstrap failed:', err);
    globalThis.__bv_bootstrap_error__ = String(err && err.stack || err);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}
