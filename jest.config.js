import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const codegenDir = join(__dirname, 'src', 'codegen');

const allTests = ['**/__tests__/**/*.test.js'];
const exclude = (names) => names.map(n => `__tests__/${n}.test.js`);
// Ticket worktrees (`.worktrees/<slug>`) hold their own copy of the suite. Anchored to
// <rootDir> so a run from inside a worktree still finds its own tests.
const WORKTREES = '<rootDir>/.worktrees/';

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

  // `*.dom.test.js` files need a DOM; they run only in the `dom` project
  // below. Every target project (browser included) runs the shared suite.
  const ignorePatterns = ['/node_modules/', WORKTREES, ...exclude(excludeTests), '\\.dom\\.test\\.js$'];

  // Optional per-target setup file (e.g. raise test/hook timeouts).
  const setupPath = join(codegenDir, entry.name, 'jest.setup.js');
  const setupFilesAfterEnv = existsSync(setupPath)
    ? [`<rootDir>/src/codegen/${entry.name}/jest.setup.js`]
    : [];

  // Optional per-target global setup and teardown, run once in the parent process
  // for the whole run (e.g. one shared browser for every worker).
  const globalFiles = {};
  for (const [key, file] of [['globalSetup', 'jest.global_setup.js'], ['globalTeardown', 'jest.global_teardown.js']]) {
    if (existsSync(join(codegenDir, entry.name, file))) globalFiles[key] = `<rootDir>/src/codegen/${entry.name}/${file}`;
  }

  projects.push({
    displayName: targetName,
    testEnvironment: 'node',
    transform: {},
    testMatch: allTests,
    testPathIgnorePatterns: ignorePatterns,
    modulePathIgnorePatterns: [WORKTREES],
    globals: { BREVITY_TARGET: targetName },
    ...(setupFilesAfterEnv.length ? { setupFilesAfterEnv } : {}),
    ...globalFiles,
  });

  // The browser target also gets a `dom` project: only the DOM-specific
  // `*.dom.test.js` files, run against the browser target.
  if (targetName === 'browser') {
    projects.push({
      displayName: 'dom',
      testEnvironment: 'node',
      transform: {},
      testMatch: ['**/__tests__/**/*.dom.test.js'],
      testPathIgnorePatterns: ['/node_modules/', WORKTREES, ...exclude(excludeTests)],
      modulePathIgnorePatterns: [WORKTREES],
      globals: { BREVITY_TARGET: targetName },
      ...(setupFilesAfterEnv.length ? { setupFilesAfterEnv } : {}),
      ...globalFiles,
    });
  }
}

// A worker's heap grows with every test file it runs (module graphs under
// --experimental-vm-modules aren't released), ~40 MB → ~440 MB over 30 files.
// A full run gives each worker ~90 files, which swaps an 8 GB machine. A worker
// over this limit after a file is replaced by a fresh one.
export default { projects, workerIdleMemoryLimit: '512MB' };
