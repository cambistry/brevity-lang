import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codegenDir = join(__dirname, 'src', 'codegen');

const allTests = ['**/__tests__/**/*.test.js'];
const exclude = (names) => names.map(n => `__tests__/${n}.test.js`);

// Discover targets by scanning src/codegen/*/index.js
const projects = [];
for (const entry of readdirSync(codegenDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (!existsSync(join(codegenDir, entry.name, 'index.js'))) continue;

  // Optional jest.json sidecar for target name override and test exclusions
  let targetName = entry.name;
  let excludeTests = [];
  const metaPath = join(codegenDir, entry.name, 'jest.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.targetName) targetName = meta.targetName;
    excludeTests = meta.excludeTests || [];
  }

  projects.push({
    displayName: targetName,
    testEnvironment: 'node',
    transform: {},
    testMatch: allTests,
    testPathIgnorePatterns: ['/node_modules/', ...exclude(excludeTests)],
    globals: { BREVITY_TARGET: targetName },
  });
}

export default { projects };
