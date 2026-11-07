export { codegenRust } from './program.js';
import { codegenRust } from './program.js';
import { mkdirSync, copyFileSync } from 'fs';
import { spawnSync, spawn as spawnChild } from 'child_process';
import { createInterface } from 'readline';
import { join } from 'path';
import { bigintJsonStringify, bigintJsonParse } from '../bigint_json.js';

function resolveConstructorArgs(ctx, source, constructorArgs) {
  if (constructorArgs == null) return [];
  if (Array.isArray(constructorArgs)) return constructorArgs;
  const { ast } = ctx.extract(source);
  const fileActor = (ast.actors || []).find(a => !a.name);
  const order = (fileActor?.initParams || []).map(p => p.key || p.name);
  return order.map(n => constructorArgs[n]);
}

function argsForSpawn(args) {
  return args.length > 0 ? [JSON.stringify(args)] : [];
}

// One process per actor, kept alive as the Erlang harness keeps its VM. With
// BREVITY_READY set, the binary posts {"ev":"ready"} each time it goes back to
// reading input: when it's done with a message, or waiting on a reply. So a call
// waiting on a reply the test hasn't sent yet stays waiting, and its own reply
// can't come out until the test sends that one.
async function startLive(ctx, bin, args) {
  const child = spawnChild(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BREVITY_READY: '1' } });
  ctx.children.add(child);
  const posts = [];
  let stderr = '';
  let exit = null;
  // Every line the binary reads follows one ready, so once there have been as many
  // readies as lines written, plus the one before the first, it's idle.
  let written = 0;
  let readies = 0;
  let waiter = null;
  const settle = (err) => {
    if (!waiter || (!err && readies <= written)) return;
    const w = waiter;
    waiter = null;
    clearTimeout(w.timer);
    if (err) w.reject(err); else w.resolve();
  };
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.on('error', () => { /* the close handler reports it */ });
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    const msg = bigintJsonParse(line);
    if (msg && msg.ev === 'ready' && Object.keys(msg).length === 1) { readies++; settle(); }
    else posts.push(msg);
  });
  child.on('close', (code, signal) => {
    ctx.children.delete(child);
    exit = `Rust binary failed (exit ${code ?? signal}): ${stderr}`;
    settle(new Error(exit));
  });
  const idle = () => new Promise((resolve, reject) => {
    if (exit) { reject(new Error(exit)); return; }
    if (readies > written) { resolve(); return; }
    const timer = setTimeout(() => {
      waiter = null;
      reject(new Error(`Rust binary timed out waiting to read input. stderr: ${stderr}`));
    }, ctx.idleTimeoutMs);
    waiter = { resolve, reject, timer };
  });
  const write = (msg) => {
    written++;
    child.stdin.write(bigintJsonStringify(msg) + '\n');
  };
  await idle();
  return {
    send(msg) { write(msg); },
    async sendAsync(msg) {
      write(msg);
      await idle();
    },
    posts,
  };
}

export default {
  name: 'rust',
  codegen: codegenRust,
  runner: {
    async setup({ workerId, baseDir, extract, compile, spawnTimeoutMs }) {
      const cacheModule = await import(new URL('../../../__tests__/rust-cache.js', import.meta.url));
      const rustBase = join(baseDir, 'rust');
      const rustDir = join(rustBase, `w${workerId}`);
      const rustSrc = join(rustDir, 'src');
      mkdirSync(rustSrc, { recursive: true });
      copyFileSync(join(rustBase, 'Cargo.toml'), join(rustDir, 'Cargo.toml'));
      const binaryPath = join(rustDir, 'target', 'debug', 'brevity-actor');
      cacheModule.sweepRustCache();
      const children = new Set();
      // A live actor has no startup to pay for, so its wait for each message is
      // short. It starts at the write, so a cargo build never counts against it.
      // BREVITY_SPAWN_TIMEOUT_MS, set for a slow box, lengthens this one too.
      const idleTimeoutMs = process.env.BREVITY_SPAWN_TIMEOUT_MS ? spawnTimeoutMs : 5000;
      return {
        extract, compile, rustDir, rustSrc, binaryPath, spawnTimeoutMs, idleTimeoutMs, buildOrCached: cacheModule.buildOrCached, children,
        teardown() { for (const child of children) child.kill('SIGKILL'); },
      };
    },

    async runActor(ctx, { source, compileOptions = {}, receive }) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
      });
      const stdinData = receive.map(m => bigintJsonStringify(m)).join('\n') + '\n';
      const result = spawnSync(bin, [], { input: stdinData, encoding: 'utf-8', timeout: ctx.spawnTimeoutMs });
      if (result.status !== 0) throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
      return result.stdout.trim().split('\n').filter(Boolean).map(bigintJsonParse);
    },

    async createActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
      });
      const args = argsForSpawn(resolveConstructorArgs(ctx, source, constructorArgs));
      return startLive(ctx, bin, args);
    },

    compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
      });
      const args = argsForSpawn(resolveConstructorArgs(ctx, source, constructorArgs));
      return {
        spawn() { return startLive(ctx, bin, args); },
      };
    },
  },
};
