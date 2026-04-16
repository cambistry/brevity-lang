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

export function extract(source) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  injectFileParamsIntoFileActor(ast);
  return { ast, dependencies: (ast.dependencies || []).filter(d => d.path).map(d => d.path) };
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

const handles = new Map();
const compiled = new Map();
let nextId = 0;

async function runActor({ source, compileOptions = {}, receive = [] }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const posts = [];
  const binding = { post: msg => posts.push(msg) };
  const actor = await ActorClass.create(binding);
  for (const msg of receive) {
    actor.receive(msg);
    await tick();
  }
  return posts;
}

async function createActor({ source, compileOptions = {}, args = [] }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const posts = [];
  const binding = { post: msg => posts.push(msg) };
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
  return fresh;
}

function drainPosts(id) {
  const h = handles.get(id);
  if (!h) throw new Error(`brevity.js: no actor handle ${id}`);
  const fresh = h.posts.slice(h.drained);
  h.drained = h.posts.length;
  return fresh;
}

async function compileActor({ source, compileOptions = {} }) {
  const ActorClass = await compileAndLoad(source, compileOptions);
  const id = String(++nextId);
  compiled.set(id, ActorClass);
  return id;
}

async function spawnCompiled({ compiledId, args = [] }) {
  const ActorClass = compiled.get(compiledId);
  if (!ActorClass) throw new Error(`brevity.js: no compiled actor ${compiledId}`);
  const posts = [];
  const binding = { post: msg => posts.push(msg) };
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
  return external;
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
