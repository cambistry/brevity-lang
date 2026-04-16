export { codegenErlang } from './program.js';
import { codegenErlang } from './program.js';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';

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
      const stdinData = receive.map(m => JSON.stringify(m)).join('\n') + '\n';
      const result = spawnSync('erl', ['-noshell', '-pa', ctx.erlDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
        input: stdinData, encoding: 'utf-8', timeout: 15000,
      });
      if (result.status !== 0) throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
      return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
    },

    createActor(ctx, source, { compileOptions = {} } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang' });
      const erlFile = join(ctx.erlDir, 'brevity_actor.erl');
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${ctx.erlDir} ${erlFile}`, { stdio: 'pipe' });
      const allMessages = [];
      const posts = [];
      // Initial run to capture startup messages (e.g., `new` for constructors)
      const initResult = spawnSync('erl', ['-noshell', '-pa', ctx.erlDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
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
          const result = spawnSync('erl', ['-noshell', '-pa', ctx.erlDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
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

    compileActor(ctx, source, { compileOptions = {} } = {}) {
      const { ast } = ctx.extract(source);
      const output = ctx.compile(ast, { ...compileOptions, target: 'erlang' });
      const erlFile = join(ctx.erlDir, 'brevity_actor.erl');
      writeFileSync(erlFile, output);
      execSync(`erlc -o ${ctx.erlDir} ${erlFile}`, { stdio: 'pipe' });
      return {
        spawn() {
          const allMessages = [];
          const posts = [];
          return {
            send(msg) { allMessages.push(msg); },
            async sendAsync(msg) {
              allMessages.push(msg);
              const stdinData = allMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
              const result = spawnSync('erl', ['-noshell', '-pa', ctx.erlDir, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
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
    },
  },
};
