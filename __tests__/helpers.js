import vm from 'vm';
import { jest } from '@jest/globals';
import compile from '../index.js';

export function run(code) {
  vm.runInNewContext(code);
}

export async function evaluate(compiled, exportName = 'default') {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
}

export async function expectReply({ source, exportName = 'default', receive, reply = [] }) {
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
