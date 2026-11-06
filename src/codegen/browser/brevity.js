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
import { renamePublicClasses, validateWithSourceNames } from '../../subclass.js';
import { codegen as jsCodegen } from '../javascript/classes.js';
import { start } from './runtime.js';
import { runExtractPasses } from '../../extract_passes.js';

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

export function extract(source) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  runExtractPasses(ast);
  return { ast };
}

export function compile(ast, options = {}) {
  renamePublicClasses(ast);
  validateWithSourceNames(validate, ast, options);
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
//   - Self address `#<>` (local form, no selector) → `#<selfAddr>`.
//     Global-form addresses (word-char start inside the angles) are left
//     alone; the discriminator is leading non-word-char = local.
//   - `ty` has no brackets: a tag that starts with a delimiter (`::Point`,
//     `@Box`, a bare `@`) → `selfAddr ::Point`; a global tag is left alone.
//   - Missing `from` → filled in with selfAddr.
//   - Local-form `from: '@N'` → prepended to `from: 'selfAddr @N'`.
//   - `to` field is untouched; the sender writes it in its own DI frame
//     already (e.g. 'HTML @div'), which is application-absolute for now.
//
// The address rewrite runs as a raw-text regex on serialized JSON because `#<`
// can only appear inside JSON string values (never structural); `ty` is walked.

const handles = new Map();
const compiled = new Map();
let nextId = 0;

function rewriteLocalTags(v, selfAddr) {
  if (typeof v === 'string') return v === '' || /^\w/.test(v) ? v : `${selfAddr} ${v}`;
  if (Array.isArray(v)) return v.map(x => rewriteLocalTags(x, selfAddr));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteLocalTags(x, selfAddr)]));
  return v;
}

function rewriteLocalAddresses(msg, selfAddr) {
  const { ty, ...rest } = msg;
  const json = JSON.stringify(rest);
  const rewritten = json.replace(/#<([^\w>][^>]*)?>/g, (_, content) => (content ? `#<${selfAddr} ${content}>` : `#<${selfAddr}>`));
  const out = JSON.parse(rewritten);
  if ('ty' in msg) out.ty = rewriteLocalTags(ty, selfAddr);
  if (out.from == null || out.from === '') {
    out.from = selfAddr;
  } else if (typeof out.from === 'string' && !/^\w/.test(out.from)) {
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
    // Pages can populate globalThis.__bv_init_options__ before brevity.js
    // loads to inject extra constructor args into every file actor (e.g.
    // a `:Peers` handle from a hosting bridge). Actors that don't declare
    // matching params silently ignore the extras — JS arity is permissive.
    const opts = (typeof globalThis !== 'undefined' && globalThis.__bv_init_options__) || {};
    const fileActorArgs = Array.isArray(opts.fileActorArgs) ? opts.fileActorArgs
      : (opts.peers ? [opts.peers] : []);
    const page = await start(document, { extract, compile, fileActorArgs });
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
