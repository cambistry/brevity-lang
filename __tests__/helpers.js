import vm from 'vm';
import { readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { extract, compile } from '../index.js';

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
const _ctx = await _runner.setup({ workerId: WORKER_ID, baseDir: ROOT, extract, compile });

// ── compileSource: extract + compile in one call ────────────────────────────

export function compileSource(source, options = {}) {
  const { ast, interface: iface } = extract(source);
  const output = compile(ast, options);
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

export async function runActors(args) {
  if (_runner.runActors) return _runner.runActors(_ctx, args);
  throw new Error(`Target '${_targetName}' does not support multi-actor tests`);
}

// ── createActor: compile once, send many ────────────────────────────────────

export async function createActor(source, opts = {}) {
  return _runner.createActor(_ctx, source, opts);
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
  let postIndex = actor.posts.length;

  for (const step of steps) {
    const { input, output } = step;
    if (input && output) throw('Cannot include both input and output in the same test step.')
    if (input) {
      await actor.sendAsync(input);
    } else if (output) {
      expect(actor.posts[postIndex]).toEqual(output);
      postIndex++;
    }
  }
}
