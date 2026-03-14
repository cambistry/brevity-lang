import vm from 'vm';
import { jest } from '@jest/globals';
import { writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import compile from '../index.js';

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

export function run(code) {
  vm.runInNewContext(code);
}

const tick = () => new Promise(r => setTimeout(r, 0));

// ── runActor: core primitive ────────────────────────────────────────────────
//
// Compile an actor, send messages, return all output messages.
// The actor is a black box — messages in, messages out.

async function runActorJs({ source, exportName = 'default', receive }) {
  const { output } = compile(source);
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
  const mod = await import(dataUrl);
  const Actor = mod[exportName];
  const posts = [];
  const binding = { post: msg => posts.push(msg) };
  const actor = new Actor(binding);
  for (const msg of receive) {
    actor.receive(msg);
    await tick();
  }
  return posts;
}

async function runActorErlang({ source, receive }) {
  const { output } = compile(source);
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

async function runActorRust({ source, receive }) {
  const { output } = compile(source);
  writeFileSync(join(RUST_SRC, 'main.rs'), output);
  execSync('cargo build --quiet', { cwd: RUST_DIR, stdio: 'pipe' });

  const stdinData = receive.map(m => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync(BINARY_PATH, [], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
  }

  return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
}

export async function runActor(args) {
  const receive = Array.isArray(args.receive) ? args.receive : [args.receive];
  const normalized = { ...args, receive };
  if (process.env.BREVITY_TARGET === 'erlang') return runActorErlang(normalized);
  if (process.env.BREVITY_TARGET === 'rust') return runActorRust(normalized);
  return runActorJs(normalized);
}

// ── evaluate: JS-only, for multi-actor tests that need class instantiation ──
// TODO: replace with target-aware multi-actor harness

export async function evaluate(compiled, exportName = 'default') {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
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
