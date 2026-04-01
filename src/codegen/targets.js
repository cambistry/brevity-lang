import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _registry = new Map();

export async function loadTargets() {
  if (_registry.size > 0) return _registry;
  for (const entry of readdirSync(__dirname, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = join(__dirname, entry.name, 'index.js');
    if (!existsSync(indexPath)) continue;
    const mod = await import(indexPath);
    const descriptor = mod.default;
    if (descriptor?.name && descriptor?.codegen) {
      _registry.set(descriptor.name, descriptor);
    }
  }
  return _registry;
}

export function getTarget(name) {
  return _registry.get(name);
}

export function getTargetNames() {
  return [..._registry.keys()];
}
