import vm from 'vm';
import { readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extract, compile } from '../index.js';
import { _opre_split as _opreSplit, _opre_join as _opreJoin, _opre_quote as _opreQuote, _opre_resolve as _opreResolve, _opre_map_bracketed as _opreMap } from '../src/codegen/opre_tokens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_ID = process.env.JEST_WORKER_ID || '1';

// ── Target discovery ────────────────────────────────────────────────────────

const _targetName = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';

// Find the codegen directory whose descriptor matches this target name.
// The directory name may differ from the target name (e.g., 'javascript' dir → 'js' target).
const codegenDir = join(ROOT, 'src', 'codegen');
let _descriptor;
for (const entry of readdirSync(codegenDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const indexPath = join(codegenDir, entry.name, 'index.js');
  if (!existsSync(indexPath)) continue;
  const mod = await import(indexPath);
  if (mod.default?.name === _targetName) { _descriptor = mod.default; break; }
}
if (!_descriptor) throw new Error(`No codegen target found for '${_targetName}'`);

const _runner = _descriptor.runner;
// Per-workstation override: `export BREVITY_SPAWN_TIMEOUT_MS=60000` for slow boxes.
const SPAWN_TIMEOUT_MS = Number(process.env.BREVITY_SPAWN_TIMEOUT_MS) || 30000;
const _ctx = await _runner.setup({ workerId: WORKER_ID, baseDir: ROOT, extract, compile, spawnTimeoutMs: SPAWN_TIMEOUT_MS });

// Teardown: kill persistent VMs (e.g. Erlang router) when test file completes
afterAll(() => { if (_ctx.teardown) _ctx.teardown(); });

// ── compileSource: extract + compile in one call ────────────────────────────
//
// `fileName` is folded into compile options so class-as-value codegen sees the
// same surface as a real (filesystem-rooted) compile. Required only when the
// source references class as a bare value.

export function compileSource(source, options = {}) {
  const { fileName, ...rest } = options;
  const compileOptions = fileName === undefined ? rest : { ...rest, fileName };
  const { ast, interface: iface } = extract(source, { remotes: compileOptions.remotes });
  const output = compile(ast, compileOptions);
  return { output, interface: iface };
}

// ── run: execute raw JS code ────────────────────────────────────────────────

export function run(code) {
  vm.runInNewContext(code);
}

// ── runActor: single-actor primitive ────────────────────────────────────────

export async function runActor(args) {
  const receive = Array.isArray(args.receive) ? args.receive : [args.receive];
  return _runner.runActor(_ctx, { ...args, receive });
}

// ── runActors: multi-actor primitive ────────────────────────────────────────
//
// Several actors, each a separately compiled source spawned live (createActor),
// wired to each other by name: what one posts to `name…` is delivered to the actor
// of that name, and anything else is external. Every target runs it the same way.
//
//   const net = await runActors({ svc: { source, compileOptions }, main: { … } });
//   await net.send('main', { id: '1', op: 'go', from: 'c' });
//   net.external   // what was posted to no actor of the network, in order
//
// Each actor sits at the global boundary, as a file actor does: what it sends
// relative to itself (`:x`, in `from`, in a payload's addresses, in `ty`) is
// `name:x` on the way out; the receiver gets `to` relative to itself (`:rest`).
// `messages` ([[name, msg], …]) are sent in order first. A send to an actor whose
// construction failed throws. See
// notes/multi-actor-test-harness-2026-04-20.md.

const _opreInbound = (address, name) => {
  const head = _opreQuote(name);
  if (address === head) return ':';
  return typeof address === 'string' && address.startsWith(head + ':') ? address.slice(head.length) : address;
};

export async function runActors(actors, { messages = [] } = {}) {
  const names = Object.keys(actors);
  const live = {};
  for (const name of names) {
    const { source, compileOptions = {}, fileName } = actors[name];
    live[name] = await createActor(source, { compileOptions, ...(fileName !== undefined && { fileName }) });
  }
  const seen = Object.fromEntries(names.map(n => [n, 0]));
  const failures = {};
  const external = [];
  const globalize = (v, self) => {
    if (typeof v === 'string') return _opreMap(v, (a) => _opreResolve(a, self));
    if (Array.isArray(v)) return v.map(x => globalize(x, self));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, globalize(x, self)]));
    return v;
  };
  const globalizeTy = (v, self) => {
    if (typeof v === 'string') return _opreResolve(v, self);
    if (Array.isArray(v)) return v.map(x => globalizeTy(x, self));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, globalizeTy(x, self)]));
    return v;
  };
  // Route what each actor posted since last time; true if anything moved.
  const pump = async () => {
    let moved = false;
    for (const name of names) {
      const actor = live[name];
      while (seen[name] < actor.posts.length) {
        const msg = actor.posts[seen[name]++];
        moved = true;
        const tokens = typeof msg.to === 'string' && !msg.to.startsWith(':') ? _opreSplit(msg.to) : [];
        const target = tokens.length && Object.hasOwn(live, tokens[0]) ? tokens[0] : null;
        if (!target) { external.push(msg); continue; }
        const self = _opreQuote(name);
        const { from, ty, as } = msg;
        const rest = { ...msg };
        for (const k of ['to', 'from', 'ty', 'as']) delete rest[k];
        const forwarded = {
          ...globalize(rest, self),
          ...(tokens.length > 1 && { to: _opreJoin([null, ...tokens.slice(1)]) }),
          from: from ? _opreResolve(from, self) : self,
          // An address under the receiver comes in relative to it, as it went out.
          ...(as !== undefined && { as: _opreInbound(_opreResolve(as, self), target) }),
          ...(ty !== undefined && { ty: globalizeTy(ty, self) }),
        };
        // A delivery the receiver fails on (it exits): it takes nothing more.
        if (failures[target]) continue;
        try { await live[target].sendAsync(forwarded); } catch (err) { failures[target] = err; }
      }
    }
    return moved;
  };
  // Until nothing moves for a few turns: an in-process target may still be working.
  // An actor still being built (waiting on a reply, a target that says so) isn't idle.
  const building = () => names.some(n => live[n].built === false);
  const settle = async () => {
    for (let idle = 0, turns = 0; idle < 3 && turns < 10000; turns++) {
      if (await pump()) { idle = 0; continue; }
      if (!building()) idle++;
      await new Promise(r => setTimeout(r, 0));
    }
  };
  await settle();
  const net = {
    external,
    actors: live,
    // An actor whose construction failed takes no message: the send throws.
    async send(name, msg) {
      if (!Object.hasOwn(live, name)) throw new Error(`runActors: no actor '${name}'`);
      const failed = failures[name] ?? live[name].failed;
      if (failed) throw new Error(`runActors: '${name}' failed: ${failed?.message ?? failed}`);
      await live[name].sendAsync(msg);
      await settle();
    },
  };
  for (const [name, msg] of messages) await net.send(name, msg);
  return net;
}

// ── expectLocalAndRemote: a parent here, and in another file ────────────────
//
// The same steps against `local`, a file that declares its parents itself, and
// against `child`, whose parents are in `parent`, another file it `use`s at `path`
// (compiled against that file's published doc, the two run with runActors). Each
// input goes to the file; each output is checked against both: what the file posts,
// and what the pair posts to no actor of it. See notes/opre-extend-and-as-2026-11-20.md
// ("The semantics are layers, local parents included").
//
//   await expectLocalAndRemote({ local, parent, child },
//     { input: { id: '1', op: 'go', from: 'c' } },
//     { output: { id: '1', re: [3], ty: ['Integer'], to: 'c' } },
//   );

export async function expectLocalAndRemote({ local, parent, child, path = 'svc' }, ...steps) {
  await expectActorBehavior(await createActor(local), ...steps);
  const net = await runActors({
    [path]: { source: parent },
    main: { source: child, compileOptions: { remotes: [{ path, service: extract(parent).interface.service }] } },
  });
  let seen = 0;
  for (const { input, output } of steps) {
    if (input) await net.send('main', input);
    else expect(net.external[seen++]).toEqual(output);
  }
  expect(net.external.length).toBe(seen);
}

// ── createActor: compile once, send many ────────────────────────────────────
//
// `expects` runs an expectActorBehavior-shaped step list with the cursor
// starting at 0, so construction-time emissions (the `new` the actor emits
// during file-init) are assertable directly. Use the natural ordering:
//   { output: `new` outbound }   — the actor's construction emission
//   { input:  `new` reply }      — the test's response with the instance addr
//
// `fileName` declares the wire path this source pretends to live at
// (e.g. 'c.bv'). The class is provisioned with that address at construction
// so `class` in value position can render it. Required only when class-as-value
// is referenced; absent that, the address is never read.

export async function createActor(source, opts = {}) {
  const { expects, ...rest } = _liftFileName(opts);
  const actor = await _runner.createActor(_ctx, source, rest);
  if (expects) await _expectActorBehaviorFromIndex(actor, 0, ...expects);
  return actor;
}

// `fileName` is the test-ergonomic surface; it folds into compileOptions so
// the codegen sees it the same way a real (filesystem-rooted) compile would.
function _liftFileName(opts) {
  const { fileName, compileOptions, ...rest } = opts;
  if (fileName === undefined) return opts;
  return { ...rest, compileOptions: { ...(compileOptions || {}), fileName } };
}

// ── compileActor: compile once, spawn many ──────────────────────────────────

const _compiledCache = new Map();

export async function compileActor(source, opts = {}) {
  const key = source.trim();
  if (Object.keys(opts).length === 0 && _compiledCache.has(key)) return _compiledCache.get(key);
  const result = await _runner.compileActor(_ctx, source, opts);
  if (Object.keys(opts).length === 0) _compiledCache.set(key, result);
  return result;
}

// ── expectBehavior: compile to live actor, assert reply ─────────────────────

export async function expectBehavior(script, ...steps) {
  const actor = await (await compileActor(script)).spawn();
  await expectActorBehavior(actor, ...steps);
}

// ── expectActorBehavior: send to live actor, assert reply ───────────────────

export async function expectActorBehavior(actor, ...steps) {
  await _expectActorBehaviorFromIndex(actor, actor.posts.length, ...steps);
}

async function _expectActorBehaviorFromIndex(actor, postIndex, ...steps) {
  const outputs = []

  for (const step of steps) {
    const { input, output } = step;
    if (input && output) throw ('Cannot include both input and output in the same test step.')
    if (input) {
      await actor.sendAsync(input);
    } else if (output) {
      const post = actor.posts[postIndex];
      expect(post).toEqual(output);
      outputs.push(post);
      postIndex++;
    }
  }

  return outputs;
}
