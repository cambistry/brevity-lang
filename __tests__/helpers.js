import vm from 'vm';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function run(code) {
  vm.runInNewContext(code);
}

export async function evaluate(compiled, exportName = 'default') {
  const tmp = join(tmpdir(), `test_${Date.now()}.mjs`);
  await writeFile(tmp, compiled);
  try {
    const mod = await import(tmp);
    return mod[exportName];
  } finally {
    await unlink(tmp);
  }
}
