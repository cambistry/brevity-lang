export { codegenErlang } from './program.js';
import { codegenErlang } from './program.js';
import { RUNTIME_MODULE } from './preambles.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'fs';
import { execSync, spawn as spawnChild } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { bigintJsonStringify, bigintJsonParse } from '../bigint_json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER_ERL = join(__dirname, 'brevity_router.erl');

// Normalize BigInt values for test output consistency with JSON-based targets.
// BigInt within safe integer range → Number; large BigInt stays as BigInt.
function normalizeBigInts(val) {
  if (typeof val === 'bigint') {
    if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) return Number(val);
    return val;
  }
  if (Array.isArray(val)) return val.map(normalizeBigInts);
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = normalizeBigInts(v);
    return out;
  }
  return val;
}

function resolveConstructorArgs(ctx, source, constructorArgs) {
  if (constructorArgs == null) return [];
  if (Array.isArray(constructorArgs)) return constructorArgs;
  const { ast } = ctx.extract(source);
  const fileActor = (ast.actors || []).find(a => !a.name);
  const order = (fileActor?.initParams || []).map(p => p.key || p.name);
  return order.map(n => constructorArgs[n]);
}

// Compile a generated module inside the router's VM and load it: no `erlc`
// process per module, and Node isn't blocked while it compiles. A compile error
// is raised with the compiler's messages, as `erlc` printed them.
async function compileInVm(ctx, moduleName, erlFile) {
  ctx.send({ cmd: 'compile', mod: moduleName, file: erlFile });
  const ev = await ctx.waitFor(e => (e.ev === 'loaded' || e.ev === 'compile_error') && e.mod === moduleName);
  if (ev.ev === 'compile_error') throw new Error(`Compile failed: ${erlFile}\n${ev.errors}`);
}

export default {
  name: 'erlang',
  codegen: codegenErlang,
  runner: {
    async setup({ workerId, baseDir, extract, compile }) {
      const erlDir = join(baseDir, 'erlang', `w${workerId}`);
      mkdirSync(erlDir, { recursive: true });

      // Each test file numbers its modules from 1, so a previous file's fixture
      // dirs (`comp<n>`, `inst<n>`) are stale here. The worker owns `w<id>`, and runs
      // its files one at a time, so clearing them is safe. The router and runtime stay compiled.
      for (const entry of readdirSync(erlDir)) {
        if (/^(comp|inst)\d+$/.test(entry)) rmSync(join(erlDir, entry), { recursive: true, force: true });
      }

      // Compile the router if it isn't compiled, or its source has changed since
      const routerBeam = join(erlDir, 'brevity_router.beam');
      if (!existsSync(routerBeam) || statSync(routerBeam).mtimeMs < statSync(ROUTER_ERL).mtimeMs) {
        execSync(`erlc -o ${erlDir} ${ROUTER_ERL}`, { stdio: 'pipe' });
      }

      // The shared runtime every fixture module imports. Its source is written only
      // when it differs, so the .beam is rebuilt only when the runtime changes.
      const runtimeErl = join(erlDir, 'brevity_rt.erl');
      const runtimeBeam = join(erlDir, 'brevity_rt.beam');
      if (!existsSync(runtimeErl) || readFileSync(runtimeErl, 'utf8') !== RUNTIME_MODULE) {
        writeFileSync(runtimeErl, RUNTIME_MODULE);
      }
      if (!existsSync(runtimeBeam) || statSync(runtimeBeam).mtimeMs < statSync(runtimeErl).mtimeMs) {
        execSync(`erlc -o ${erlDir} ${runtimeErl}`, { stdio: 'pipe' });
      }

      // Start persistent Erlang VM with the router
      const vm = spawnChild('erl', ['-noshell', '-pa', erlDir, '-eval', 'brevity_router:main()', '-s', 'init', 'stop'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      // Set up line-by-line stdout reader
      const rl = createInterface({ input: vm.stdout });
      const pendingEvents = [];    // events not yet claimed by a waiter
      const pendingWaiters = [];   // waiters not yet satisfied
      // A live actor's output goes straight to its posts as it arrives, so a post that
      // trails the actor's `ready` (a send made on handling a reply) still lands.
      const outSinks = new Map();  // actor id → fn(data)

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let ev;
        try { ev = bigintJsonParse(line); } catch { return; }
        if (ev.ev === 'out' && outSinks.has(ev.id)) {
          outSinks.get(ev.id)(ev.data);
          return;
        }
        // Try to satisfy a pending waiter
        for (let i = 0; i < pendingWaiters.length; i++) {
          if (pendingWaiters[i].match(ev)) {
            pendingWaiters[i].resolve(ev);
            pendingWaiters.splice(i, 1);
            return;
          }
        }
        pendingEvents.push(ev);
      });

      // Collect stderr for error reporting
      let stderrBuf = '';
      vm.stderr.on('data', (chunk) => { stderrBuf += chunk; });

      // Wait for an event matching a predicate
      function waitFor(matchFn) {
        // Check buffered events first
        for (let i = 0; i < pendingEvents.length; i++) {
          if (matchFn(pendingEvents[i])) {
            const ev = pendingEvents[i];
            pendingEvents.splice(i, 1);
            return Promise.resolve(ev);
          }
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            const idx = pendingWaiters.indexOf(waiter);
            if (idx >= 0) pendingWaiters.splice(idx, 1);
            reject(new Error(`Erlang router timeout waiting for event. stderr: ${stderrBuf}`));
          }, 15000);
          const waiter = {
            match: matchFn,
            resolve: (ev) => { clearTimeout(timer); resolve(ev); },
          };
          pendingWaiters.push(waiter);
        });
      }

      // Collect all events matching predicate until a stop event
      function collectUntil(collectFn, stopFn) {
        return new Promise((resolve, reject) => {
          const collected = [];
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Erlang router timeout collecting events. stderr: ${stderrBuf}`));
          }, 15000);

          function cleanup() {
            clearTimeout(timer);
            // Remove our handler
            const idx = pendingWaiters.indexOf(waiter);
            if (idx >= 0) pendingWaiters.splice(idx, 1);
          }

          // Drain buffered events first
          for (let i = pendingEvents.length - 1; i >= 0; i--) {
            const ev = pendingEvents[i];
            if (stopFn(ev)) {
              // Drain all matching collected events before this stop event
              for (let j = 0; j <= i; j++) {
                if (collectFn(pendingEvents[j])) {
                  collected.push(pendingEvents[j]);
                }
              }
              pendingEvents.splice(0, i + 1);
              clearTimeout(timer);
              resolve(collected);
              return;
            }
          }
          // Drain matching events that arrived before the stop
          for (let i = pendingEvents.length - 1; i >= 0; i--) {
            if (collectFn(pendingEvents[i])) {
              collected.push(pendingEvents.splice(i, 1)[0]);
            }
          }
          // Re-sort collected (we spliced backwards)
          collected.sort(); // insertion order preserved since we pushed in order above

          const waiter = {
            match: (ev) => collectFn(ev) || stopFn(ev),
            resolve: (ev) => {
              if (stopFn(ev)) {
                cleanup();
                resolve(collected);
              } else {
                collected.push(ev);
                // Re-add waiter for more events
                pendingWaiters.push(waiter);
              }
            },
          };
          pendingWaiters.push(waiter);
        });
      }

      function send(cmd) {
        vm.stdin.write(JSON.stringify(cmd) + '\n');
      }

      let instanceSeq = 0;
      let compileSeq = 0;

      return {
        extract, compile, erlDir, vm, send, waitFor, collectUntil,
        onOut(id, fn) { outSinks.set(id, fn); },
        get instanceSeq() { return ++instanceSeq; },
        get compileSeq() { return ++compileSeq; },
        teardown() {
          rl.close();
          try { vm.stdin.end(); } catch { /* already closed */ }
          // Unref all streams so the event loop can exit without waiting
          vm.unref();
          vm.stdout.unref();
          vm.stderr.unref();
          if (vm.stdin.writable) vm.stdin.unref();
          // Kill after a brief grace period for clean shutdown
          setTimeout(() => {
            try { vm.kill('SIGKILL'); } catch { /* already exited */ }
          }, 100).unref();
        },
      };
    },

    async runActor(ctx, { source, compileOptions = {}, receive }) {
      const seq = ctx.compileSeq;
      const moduleName = `brevity_actor_${seq}`;
      const { ast } = ctx.extract(source, { remotes: compileOptions.remotes });
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `comp${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);
      await compileInVm(ctx, moduleName, erlFile);

      // Spawn instance
      const id = `r${seq}`;
      ctx.send({ cmd: 'spawn', id, mod: moduleName, args: [] });
      await ctx.waitFor(ev => ev.ev === 'spawned' && ev.id === id);

      // Wait for initial ready
      await ctx.waitFor(ev => ev.ev === 'ready' && ev.id === id);

      // Send all messages
      for (const msg of receive) {
        const line = bigintJsonStringify(msg);
        ctx.send({ cmd: 'msg', id, line });
      }

      // Collect outputs until ready (one ready per message)
      const allOutputs = [];
      for (let i = 0; i < receive.length; i++) {
        const outputs = await ctx.collectUntil(
          ev => ev.ev === 'out' && ev.id === id,
          ev => ev.ev === 'ready' && ev.id === id,
        );
        allOutputs.push(...outputs.map(o => o.data));
      }

      ctx.send({ cmd: 'stop', id });
      return allOutputs.map(normalizeBigInts);
    },

    async createActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const seq = ctx.compileSeq;
      const moduleName = `brevity_actor_${seq}`;
      const { ast } = ctx.extract(source, { remotes: compileOptions.remotes });
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `inst${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);
      await compileInVm(ctx, moduleName, erlFile);

      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const id = `i${seq}`;
      const posts = [];
      ctx.onOut(id, data => posts.push(normalizeBigInts(data)));

      // Spawn; init-time emissions land in posts before the first ready
      ctx.send({ cmd: 'spawn', id, mod: moduleName, args });
      await ctx.waitFor(ev => ev.ev === 'spawned' && ev.id === id);
      await ctx.waitFor(ev => ev.ev === 'ready' && ev.id === id);

      // An actor that exits is gone: a send to it after that throws, as on every target.
      let exited = false;
      return {
        send(_msg) { /* no-op: persistent VM handles state */ },
        async sendAsync(msg) {
          if (exited) throw new Error(`Erlang actor ${id} has exited`);
          const line = bigintJsonStringify(msg);
          ctx.send({ cmd: 'msg', id, line });
          const ev = await ctx.waitFor(ev => (ev.ev === 'ready' || ev.ev === 'exited') && ev.id === id);
          // The send it exits on resolves; a send after that throws.
          if (ev.ev === 'exited') exited = true;
        },
        posts,
      };
    },

    async compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const seq = ctx.compileSeq;
      const moduleName = `brevity_actor_${seq}`;
      const { ast } = ctx.extract(source, { remotes: compileOptions.remotes });
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `comp${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);

      // Compiled and loaded into the VM once; a compile error is raised here.
      await compileInVm(ctx, moduleName, erlFile);

      const args = resolveConstructorArgs(ctx, source, constructorArgs);

      return {
        async spawn() {
          const instanceId = `s${seq}_${ctx.instanceSeq}`;
          const posts = [];
          ctx.onOut(instanceId, data => posts.push(normalizeBigInts(data)));

          // Spawn; init-time emissions land in posts before the first ready
          ctx.send({ cmd: 'spawn', id: instanceId, mod: moduleName, args });
          await ctx.waitFor(ev => ev.ev === 'spawned' && ev.id === instanceId);
          await ctx.waitFor(ev => ev.ev === 'ready' && ev.id === instanceId);

          return {
            send(_msg) { /* no-op: persistent VM handles state */ },
            async sendAsync(msg) {
              const line = bigintJsonStringify(msg);
              ctx.send({ cmd: 'msg', id: instanceId, line });
              await ctx.waitFor(ev => ev.ev === 'ready' && ev.id === instanceId);
            },
            posts,
          };
        },
      };
    },
  },
};
