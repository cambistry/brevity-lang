import vm from 'vm';
import { writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import compile from '../index.js';
import { sweepRustCache, buildOrCached } from './rust-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_ID = process.env.JEST_WORKER_ID || '1';
const RUST_BASE = join(__dirname, '..', 'rust');
const RUST_DIR = join(RUST_BASE, `w${WORKER_ID}`);
const RUST_SRC = join(RUST_DIR, 'src');
mkdirSync(RUST_SRC, { recursive: true });
copyFileSync(join(RUST_BASE, 'Cargo.toml'), join(RUST_DIR, 'Cargo.toml'));
const BINARY_PATH = join(RUST_DIR, 'target', 'debug', 'brevity-actor');
const ERL_BASE = join(__dirname, '..', 'erlang');
const ERL_DIR = join(ERL_BASE, `w${WORKER_ID}`);
mkdirSync(ERL_DIR, { recursive: true });

sweepRustCache();

export function run(code) {
  vm.runInNewContext(code);
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function loadModule(source, exportName = 'default', compileOptions = {}) {
  const { output } = compile(source, { ...compileOptions, target: 'js' });
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
}

// ── runActor: single-actor primitive ────────────────────────────────────────
//
// Compile an actor, send messages, return all output messages.
// The actor is a black box — messages in, messages out.

async function runActorJs({ source, exportName = 'default', compileOptions = {}, receive }) {
  const Actor = await loadModule(source, exportName, compileOptions);
  const posts = [];
  const binding = { post: msg => posts.push(msg) };
  const actor = new Actor(binding);
  for (const msg of receive) {
    actor.receive(msg);
    await tick();
  }
  return posts;
}

async function runActorErlang({ source, compileOptions = {}, receive }) {
  const { output } = compile(source, { ...compileOptions, target: 'erlang' });
  const erlFile = join(ERL_DIR, 'brevity_actor.erl');
  writeFileSync(erlFile, output);
  execSync(`erlc -o ${ERL_DIR} ${erlFile}`, { stdio: 'pipe' });

  const stdinData = receive.map(m => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync('erl', ['-noshell', '-pa', ERL_DIR, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 15000,
  });

  if (result.status !== 0) {
    throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
  }

  return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
}

async function runActorRust({ source, compileOptions = {}, receive }) {
  const { output } = compile(source, { ...compileOptions, target: 'rust' });
  const binaryPath = buildOrCached({
    rustCode: output,
    rustDir: RUST_DIR,
    rustSrc: RUST_SRC,
    buildBinaryPath: BINARY_PATH,
  });

  const stdinData = receive.map(m => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync(binaryPath, [], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
  }

  return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
}

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';

export async function runActor(args) {
  const receive = Array.isArray(args.receive) ? args.receive : [args.receive];
  const normalized = { ...args, receive };
  if (_target === 'erlang') return runActorErlang(normalized);
  if (_target === 'rust') return runActorRust(normalized);
  return runActorJs(normalized);
}

// ── runActors: multi-actor primitive ────────────────────────────────────────
//
// Compile multiple actors, wire them together with message routing.
// Messages between known actors are routed internally.
// Messages to unknown destinations are collected as external output.
//
//   actors:   { Name: { source, exportName?, compileOptions? }, ... }
//   messages: [[targetName, msg], ...]
//   returns:  array of all messages sent to destinations outside the actor set

async function runActorsJs({ actors, messages }) {
  const external = [];
  const instances = {};

  for (const [name, { source, exportName, compileOptions }] of Object.entries(actors)) {
    instances[name] = { Actor: await loadModule(source, exportName, compileOptions) };
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
    inst.instance = new inst.Actor(inst.binding);
  }

  for (const [target, msg] of messages) {
    instances[target].instance.receive(msg);
    await tick();
  }

  return external;
}

export async function runActors(args) {
  // TODO: erlang/rust multi-actor harness
  return runActorsJs(args);
}

// ── expectReply: assertion wrapper around runActor ──────────────────────────

export async function expectReply({ source, exportName, receive, reply = [] }) {
  const outputs = await runActor({ source, exportName, receive });
  const replies = Array.isArray(reply) ? reply : [reply];
  expect(outputs.length).toBe(replies.length);
  for (let i = 0; i < replies.length; i++) {
    expect(outputs[i]).toEqual(replies[i]);
  }
}
