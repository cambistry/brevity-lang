import vm from 'vm';

export function run(code) {
  vm.runInNewContext(code);
}

export async function evaluate(compiled, exportName = 'default') {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(compiled)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
}
