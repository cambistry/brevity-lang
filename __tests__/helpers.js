import vm from 'vm';
import { writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extract, compile } from '../index.js';

// Convenience wrapper: extract + compile in one call, returns { output, manifest }
export function compileSource(source, options = {}) {
  const { ast, manifest } = extract(source);
  const output = compile(ast, options);
  return { output, manifest };
}
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
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'js' });
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
  const actor = await Actor.create(binding);
  for (const msg of receive) {
    actor.receive(msg);
    await tick();
  }
  return posts;
}

async function runActorErlang({ source, compileOptions = {}, receive }) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'erlang' });
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
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'rust' });
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
    inst.instance = await inst.Actor.create(inst.binding);
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

// ── createActor: compile once, send many ─────────────────────────────────────
//
// Returns a live actor handle. JS keeps an in-memory instance.
// Erlang/Rust compile once and replay all accumulated messages through a
// subprocess on each sendAsync call.

async function createActorJs(source, { exportName = 'default', compileOptions = {} } = {}) {
  const Actor = await loadModule(source, exportName, compileOptions);
  const posts = [];
  const pending = [];
  const binding = { post: msg => posts.push(msg) };
  const instance = await Actor.create(binding);
  return {
    send(msg) {
      pending.push(msg);
    },
    async sendAsync(msg) {
      pending.push(msg);
      for (const m of pending) {
        instance.receive(m);
        await tick(); await tick();
      }
      pending.length = 0;
    },
    posts,
  };
}

function createActorErlangSync(source, { compileOptions = {} } = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'erlang' });
  const erlFile = join(ERL_DIR, 'brevity_actor.erl');
  writeFileSync(erlFile, output);
  execSync(`erlc -o ${ERL_DIR} ${erlFile}`, { stdio: 'pipe' });

  const allMessages = [];
  const posts = [];

  // Initial run to capture startup messages (e.g., ::new for constructors)
  const initResult = spawnSync('erl', ['-noshell', '-pa', ERL_DIR, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
    input: '\n', encoding: 'utf-8', timeout: 15000,
  });
  if (initResult.status === 0 && initResult.stdout.trim()) {
    posts.push(...initResult.stdout.trim().split('\n').filter(Boolean).map(JSON.parse));
  }

  return {
    send(msg) { allMessages.push(msg); },
    async sendAsync(msg) {
      allMessages.push(msg);
      const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
      const result = spawnSync('erl', ['-noshell', '-pa', ERL_DIR, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
        input: stdinData,
        encoding: 'utf-8',
        timeout: 15000,
      });
      if (result.status !== 0) {
        throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
      }
      const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
      posts.length = 0;
      posts.push(...allOutputs);
    },
    posts,
  };
}

function createActorRustSync(source, { compileOptions = {} } = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'rust' });
  const binaryPath = buildOrCached({
    rustCode: output,
    rustDir: RUST_DIR,
    rustSrc: RUST_SRC,
    buildBinaryPath: BINARY_PATH,
  });

  const allMessages = [];
  const posts = [];

  // Initial run to capture startup messages (e.g., ::new for constructors)
  const initResult = spawnSync(binaryPath, [], {
    input: '\n', encoding: 'utf-8', timeout: 10000,
  });
  if (initResult.status === 0 && initResult.stdout.trim()) {
    posts.push(...initResult.stdout.trim().split('\n').filter(Boolean).map(JSON.parse));
  }

  return {
    send(msg) { allMessages.push(msg); },
    async sendAsync(msg) {
      allMessages.push(msg);
      const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
      const result = spawnSync(binaryPath, [], {
        input: stdinData,
        encoding: 'utf-8',
        timeout: 10000,
      });
      if (result.status !== 0) {
        throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
      }
      const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
      posts.length = 0;
      posts.push(...allOutputs);
    },
    posts,
  };
}

export async function createActor(source, opts = {}) {
  if (_target === 'erlang') return createActorErlangSync(source, opts);
  if (_target === 'rust') return createActorRustSync(source, opts);
  return createActorJs(source, opts);
}

// ── compileActor: compile once, spawn many ───────────────────────────────────
//
// Returns a compiled artifact with a spawn() method.
// Each spawn() creates a fresh actor instance — no shared state.

async function compileActorJs(source, { exportName = 'default', compileOptions = {} } = {}) {
  const Actor = await loadModule(source, exportName, compileOptions);
  return {
    async spawn() {
      const posts = [];
      const pending = [];
      const binding = { post: msg => posts.push(msg) };
      const instance = await Actor.create(binding);
      return {
        send(msg) { pending.push(msg); },
        async sendAsync(msg) {
          pending.push(msg);
          for (const m of pending) {
            instance.receive(m);
            // Two ticks: one for receive's sync work, one for any pending Promise resolution
            await tick(); await tick();
          }
          pending.length = 0;
        },
        posts,
      };
    },
  };
}

function compileActorErlang(source, { compileOptions = {} } = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'erlang' });
  const erlFile = join(ERL_DIR, 'brevity_actor.erl');
  writeFileSync(erlFile, output);
  execSync(`erlc -o ${ERL_DIR} ${erlFile}`, { stdio: 'pipe' });

  return {
    spawn() {
      const allMessages = [];
      const posts = [];
      return {
        send(msg) { allMessages.push(msg); },
        async sendAsync(msg) {
          allMessages.push(msg);
          const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
          const result = spawnSync('erl', ['-noshell', '-pa', ERL_DIR, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
            input: stdinData, encoding: 'utf-8', timeout: 15000,
          });
          if (result.status !== 0) throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
          const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
          posts.length = 0;
          posts.push(...allOutputs);
        },
        posts,
      };
    },
  };
}

function compileActorRust(source, { compileOptions = {} } = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'rust' });
  const binaryPath = buildOrCached({
    rustCode: output, rustDir: RUST_DIR, rustSrc: RUST_SRC, buildBinaryPath: BINARY_PATH,
  });

  return {
    spawn() {
      const allMessages = [];
      const posts = [];
      return {
        send(msg) { allMessages.push(msg); },
        async sendAsync(msg) {
          allMessages.push(msg);
          const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
          const result = spawnSync(binaryPath, [], {
            input: stdinData, encoding: 'utf-8', timeout: 10000,
          });
          if (result.status !== 0) throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
          const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
          posts.length = 0;
          posts.push(...allOutputs);
        },
        posts,
      };
    },
  };
}

const _compiledCache = new Map();

export async function compileActor(source, opts = {}) {
  const key = source.trim();
  if (Object.keys(opts).length === 0 && _compiledCache.has(key)) return _compiledCache.get(key);
  let result;
  if (_target === 'erlang') result = compileActorErlang(source, opts);
  else if (_target === 'rust') result = compileActorRust(source, opts);
  else result = await compileActorJs(source, opts);
  if (Object.keys(opts).length === 0) _compiledCache.set(key, result);
  return result;
}

// ── expectBehavior: compile to live actor, assert reply ───────────────────────

export async function expectBehavior({ script, receive, reply }) {
  const actor = await (await compileActor(script)).spawn();
  await expectActorReply({ actor, input: receive, output: reply });
}

// ── expectActorReply: send to live actor, assert reply ───────────────────────

export async function expectActorReply({ actor, input, output }) {
  const inputs = (Array.isArray(input) ? input : [input]).map(msg => ({input: msg}));
  const outputs = (Array.isArray(output) ? output : [output]).map(msg => ({output: msg}));
  await expectActorBehavior(actor, ...inputs, ...outputs)
}

// ── expectActorBehavior: send to live actor, assert reply ───────────────────────

export async function expectActorBehavior(actor, ...steps) {
  let postIndex = actor.posts.length;

  for (const step of steps) {
    if (step.input) {
      await actor.sendAsync(step.input);
    } else {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}
