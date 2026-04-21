export { codegenErlang } from './program.js';
import { codegenErlang } from './program.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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
  const order = (fileActor?.initParams || []).map(p => p.name);
  return order.map(n => constructorArgs[n]);
}

export default {
  name: 'erlang',
  codegen: codegenErlang,
  runner: {
    async setup({ workerId, baseDir, extract, compile }) {
      const erlDir = join(baseDir, 'erlang', `w${workerId}`);
      mkdirSync(erlDir, { recursive: true });

      // Compile the router if not already compiled
      const routerBeam = join(erlDir, 'brevity_router.beam');
      if (!existsSync(routerBeam)) {
        execSync(`erlc -o ${erlDir} ${ROUTER_ERL}`, { stdio: 'pipe' });
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

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let ev;
        try { ev = bigintJsonParse(line); } catch { return; }
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
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `comp${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${compileDir} ${erlFile}`, { stdio: 'pipe' });

      // Load module into VM
      ctx.send({ cmd: 'load', mod: moduleName, dir: compileDir });
      await ctx.waitFor(ev => ev.ev === 'loaded' && ev.mod === moduleName);

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
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `inst${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${compileDir} ${erlFile}`, { stdio: 'pipe' });

      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const id = `i${seq}`;
      const posts = [];

      // Load and spawn, collecting init-time emissions
      ctx.send({ cmd: 'load', mod: moduleName, dir: compileDir });
      await ctx.waitFor(ev => ev.ev === 'loaded' && ev.mod === moduleName);

      ctx.send({ cmd: 'spawn', id, mod: moduleName, args });
      await ctx.waitFor(ev => ev.ev === 'spawned' && ev.id === id);

      // Collect any init-time emissions until first ready
      const initOutputs = await ctx.collectUntil(
        ev => ev.ev === 'out' && ev.id === id,
        ev => ev.ev === 'ready' && ev.id === id,
      );
      if (initOutputs.length > 0) {
        posts.push(...initOutputs.map(o => normalizeBigInts(o.data)));
      }

      return {
        send(_msg) { /* no-op: persistent VM handles state */ },
        async sendAsync(msg) {
          const line = bigintJsonStringify(msg);
          ctx.send({ cmd: 'msg', id, line });
          const outputs = await ctx.collectUntil(
            ev => ev.ev === 'out' && ev.id === id,
            ev => ev.ev === 'ready' && ev.id === id,
          );
          const allOutputs = outputs.map(o => normalizeBigInts(o.data));
          posts.push(...allOutputs);
        },
        posts,
      };
    },

    compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const seq = ctx.compileSeq;
      const moduleName = `brevity_actor_${seq}`;
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang', moduleName });
      const compileDir = join(ctx.erlDir, `comp${seq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, `${moduleName}.erl`);
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${compileDir} ${erlFile}`, { stdio: 'pipe' });

      // Load module into VM once
      const loadPromise = (async () => {
        ctx.send({ cmd: 'load', mod: moduleName, dir: compileDir });
        await ctx.waitFor(ev => ev.ev === 'loaded' && ev.mod === moduleName);
      })();

      const args = resolveConstructorArgs(ctx, source, constructorArgs);

      return {
        async spawn() {
          await loadPromise;
          const instanceId = `s${seq}_${ctx.instanceSeq}`;
          const posts = [];

          ctx.send({ cmd: 'spawn', id: instanceId, mod: moduleName, args });
          await ctx.waitFor(ev => ev.ev === 'spawned' && ev.id === instanceId);

          // Collect any init-time emissions until first ready
          const initOutputs = await ctx.collectUntil(
            ev => ev.ev === 'out' && ev.id === instanceId,
            ev => ev.ev === 'ready' && ev.id === instanceId,
          );
          if (initOutputs.length > 0) {
            posts.push(...initOutputs.map(o => normalizeBigInts(o.data)));
          }

          return {
            send(_msg) { /* no-op: persistent VM handles state */ },
            async sendAsync(msg) {
              const line = bigintJsonStringify(msg);
              ctx.send({ cmd: 'msg', id: instanceId, line });
              const outputs = await ctx.collectUntil(
                ev => ev.ev === 'out' && ev.id === instanceId,
                ev => ev.ev === 'ready' && ev.id === instanceId,
              );
              const allOutputs = outputs.map(o => normalizeBigInts(o.data));
              posts.push(...allOutputs);
            },
            posts,
          };
        },
      };
    },
  },
};
