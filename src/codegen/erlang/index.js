export { codegenErlang } from './program.js';
import { codegenErlang } from './program.js';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { bigintJsonStringify, bigintJsonParse } from '../bigint_json.js';

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

function envWithArgs(args) {
  return args.length > 0 ? { ...process.env, BREVITY_ARGS: JSON.stringify(args) } : process.env;
}

export default {
  name: 'erlang',
  codegen: codegenErlang,
  runner: {
    setup({ workerId, baseDir, extract, compile }) {
      const erlDir = join(baseDir, 'erlang', `w${workerId}`);
      mkdirSync(erlDir, { recursive: true });
      return { extract, compile, erlDir };
    },

    async runActor(ctx, { source, compileOptions = {}, receive }) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang' });
      const erlFile = join(ctx.erlDir, 'brevity_actor.erl');
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${ctx.erlDir} ${erlFile}`, { stdio: 'pipe' });
      const stdinData = receive.map(m => bigintJsonStringify(m)).join('\n') + '\n';
      const result = spawnSync('erl', ['-noshell', '-pa', ctx.erlDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
        input: stdinData, encoding: 'utf-8', timeout: 15000,
      });
      if (result.status !== 0) throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
      return result.stdout.trim().split('\n').filter(Boolean).map(bigintJsonParse).map(normalizeBigInts);
    },

    createActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang' });
      // Per-instance subdir so multiple actors in one test don't clobber
      // each other's compiled artifacts. (Each test may createActor twice
      // to set up two parties for interop; the shared erlDir would otherwise
      // get overwritten on the second compile.)
      ctx._instanceSeq = (ctx._instanceSeq || 0) + 1;
      const instanceDir = join(ctx.erlDir, `inst${ctx._instanceSeq}`);
      mkdirSync(instanceDir, { recursive: true });
      const erlFile = join(instanceDir, 'brevity_actor.erl');
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${instanceDir} ${erlFile}`, { stdio: 'pipe' });
      const env = envWithArgs(resolveConstructorArgs(ctx, source, constructorArgs));
      const allMessages = [];
      const posts = [];
      // Initial run to capture startup messages (e.g., `new` for constructors)
      const initResult = spawnSync('erl', ['-noshell', '-pa', instanceDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
        input: '\n', encoding: 'utf-8', timeout: 15000, env,
      });
      if (initResult.status === 0 && initResult.stdout.trim()) {
        posts.push(...initResult.stdout.trim().split('\n').filter(Boolean).map(bigintJsonParse).map(normalizeBigInts));
      }
      return {
        send(msg) { allMessages.push(msg); },
        async sendAsync(msg) {
          allMessages.push(msg);
          const stdinData = allMessages.map(m => bigintJsonStringify(m)).join('\n') + '\n';
          const result = spawnSync('erl', ['-noshell', '-pa', instanceDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
            input: stdinData, encoding: 'utf-8', timeout: 15000, env,
          });
          if (result.status !== 0) throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
          const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(bigintJsonParse).map(normalizeBigInts);
          posts.length = 0;
          posts.push(...allOutputs);
        },
        posts,
      };
    },

    compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang' });
      ctx._compileSeq = (ctx._compileSeq || 0) + 1;
      const compileDir = join(ctx.erlDir, `comp${ctx._compileSeq}`);
      mkdirSync(compileDir, { recursive: true });
      const erlFile = join(compileDir, 'brevity_actor.erl');
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${compileDir} ${erlFile}`, { stdio: 'pipe' });
      const env = envWithArgs(resolveConstructorArgs(ctx, source, constructorArgs));
      return {
        spawn() {
          const allMessages = [];
          const posts = [];
          return {
            send(msg) { allMessages.push(msg); },
            async sendAsync(msg) {
              allMessages.push(msg);
              const stdinData = allMessages.map(m => bigintJsonStringify(m)).join('\n') + '\n';
              const result = spawnSync('erl', ['-noshell', '-pa', compileDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
                input: stdinData, encoding: 'utf-8', timeout: 15000, env,
              });
              if (result.status !== 0) throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
              const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(bigintJsonParse).map(normalizeBigInts);
              posts.length = 0;
              posts.push(...allOutputs);
            },
            posts,
          };
        },
      };
    },
  },
};
