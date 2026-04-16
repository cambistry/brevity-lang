export { codegenRust } from './program.js';
import { codegenRust } from './program.js';
import { mkdirSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

export default {
  name: 'rust',
  codegen: codegenRust,
  runner: {
    async setup({ workerId, baseDir, extract, compile }) {
      const cacheModule = await import(new URL('../../../__tests__/rust-cache.js', import.meta.url));
      const rustBase = join(baseDir, 'rust');
      const rustDir = join(rustBase, `w${workerId}`);
      const rustSrc = join(rustDir, 'src');
      mkdirSync(rustSrc, { recursive: true });
      copyFileSync(join(rustBase, 'Cargo.toml'), join(rustDir, 'Cargo.toml'));
      const binaryPath = join(rustDir, 'target', 'debug', 'brevity-actor');
      cacheModule.sweepRustCache();
      return { extract, compile, rustDir, rustSrc, binaryPath, buildOrCached: cacheModule.buildOrCached };
    },

    async runActor(ctx, { source, compileOptions = {}, receive }) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
      });
      const stdinData = receive.map(m => JSON.stringify(m)).join('\n') + '\n';
      const result = spawnSync(bin, [], { input: stdinData, encoding: 'utf-8', timeout: 10000 });
      if (result.status !== 0) throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
      return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
    },

    createActor(ctx, source, { compileOptions = {} } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
      });
      const allMessages = [];
      const posts = [];
      // Initial run to capture startup messages (e.g., `new` for constructors)
      const initResult = spawnSync(bin, [], { input: '\n', encoding: 'utf-8', timeout: 10000 });
      if (initResult.status === 0 && initResult.stdout.trim()) {
        posts.push(...initResult.stdout.trim().split('\n').filter(Boolean).map(JSON.parse));
      }
      return {
        send(msg) { allMessages.push(msg); },
        async sendAsync(msg) {
          allMessages.push(msg);
          const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
          const result = spawnSync(bin, [], { input: stdinData, encoding: 'utf-8', timeout: 10000 });
          if (result.status !== 0) throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
          const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
          posts.length = 0;
          posts.push(...allOutputs);
        },
        posts,
      };
    },

    compileActor(ctx, source, { compileOptions = {} } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'rust' });
      const bin = ctx.buildOrCached({
        rustCode: output, rustDir: ctx.rustDir, rustSrc: ctx.rustSrc, buildBinaryPath: ctx.binaryPath,
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
              const result = spawnSync(bin, [], { input: stdinData, encoding: 'utf-8', timeout: 10000 });
              if (result.status !== 0) throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
              const allOutputs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
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
