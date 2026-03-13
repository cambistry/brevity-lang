import vm from 'vm';
import { jest } from '@jest/globals';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import compile from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUST_DIR = join(__dirname, '..', 'rust');
const BINARY_PATH = join(RUST_DIR, 'target', 'debug', 'brevity-actor');
const ERL_BASE = join(__dirname, '..', 'erlang');
const WORKER_ID = process.env.JEST_WORKER_ID || '1';
const ERL_DIR = join(ERL_BASE, `w${WORKER_ID}`);
mkdirSync(ERL_DIR, { recursive: true });

export function run(code) {
  vm.runInNewContext(code);
}

export async function evaluate(compiled, exportName = 'default') {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
}

async function expectReplyJs({ source, exportName = 'default', receive, reply = [] }) {
  const { output } = compile(source);
  const Actor = await evaluate(output, exportName);
  const binding = { post: jest.fn() };
  const actor = new Actor(binding);

  const receives = Array.isArray(receive) ? receive : [receive];
  for (const msg of receives) {
    actor.receive(msg);
  }
  await new Promise(resolve => setTimeout(resolve, 0));

  const replies = Array.isArray(reply) ? reply : [reply];
  expect(binding.post).toHaveBeenCalledTimes(replies.length);
  for (let i = 0; i < replies.length; i++) {
    expect(binding.post).toHaveBeenNthCalledWith(i + 1, replies[i]);
  }
}

async function expectReplyRust({ source, receive, reply = [] }) {
  const { output } = compile(source, { target: 'rust' });
  writeFileSync(join(RUST_DIR, 'src', 'main.rs'), output);
  execSync('cargo build --quiet', { cwd: RUST_DIR, stdio: 'pipe' });

  const receives = Array.isArray(receive) ? receive : [receive];
  const stdinData = receives.map(m => JSON.stringify(m)).join('\n') + '\n';

  const result = spawnSync(BINARY_PATH, [], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    throw new Error(`Rust binary failed (exit ${result.status}): ${result.stderr}`);
  }

  const outputMsgs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  const replies = Array.isArray(reply) ? reply : [reply];
  expect(outputMsgs.length).toBe(replies.length);
  for (let i = 0; i < replies.length; i++) {
    expect(outputMsgs[i]).toEqual(replies[i]);
  }
}

async function expectReplyErlang({ source, receive, reply = [] }) {
  const { output } = compile(source, { target: 'erlang' });
  const erlFile = join(ERL_DIR, 'brevity_actor.erl');
  writeFileSync(erlFile, output);
  execSync(`erlc -o ${ERL_DIR} ${erlFile}`, { stdio: 'pipe' });

  const receives = Array.isArray(receive) ? receive : [receive];
  const stdinData = receives.map(m => JSON.stringify(m)).join('\n') + '\n';

  const result = spawnSync('erl', ['-noshell', '-pa', ERL_DIR, '-eval', 'brevity_actor:main()', '-s', 'init', 'stop'], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 15000,
  });

  if (result.status !== 0) {
    throw new Error(`Erlang failed (exit ${result.status}): ${result.stderr}\n${result.stdout}`);
  }

  const outputMsgs = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  const replies = Array.isArray(reply) ? reply : [reply];
  expect(outputMsgs.length).toBe(replies.length);
  for (let i = 0; i < replies.length; i++) {
    expect(outputMsgs[i]).toEqual(replies[i]);
  }
}

export async function expectReply(args) {
  if (process.env.BREVITY_TARGET === 'erlang') {
    return expectReplyErlang(args);
  }
  if (process.env.BREVITY_TARGET === 'rust') {
    return expectReplyRust(args);
  }
  return expectReplyJs(args);
}
