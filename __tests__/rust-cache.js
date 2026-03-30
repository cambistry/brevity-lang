// ── Rust Build Cache ────────────────────────────────────────────────────────
//
// Caches compiled Rust binaries to avoid redundant `cargo build` invocations.
//
// PROBLEM
// -------
// Each Rust test compiles Brevity source → Rust code → `cargo build` → binary.
// `cargo build` dominates runtime: ~5-30s per invocation, even incrementally.
// A full test suite with 50+ fixtures can take 20+ minutes on cold builds.
//
// SOLUTION
// --------
// Cache the compiled binary keyed by a SHA-256 digest of the generated Rust
// source code. On cache hit, skip `cargo build` entirely and run the cached
// binary directly. Warm runs drop from minutes to sub-second.
//
// CACHE LAYOUT
// ------------
//   rust/cache/<hash>       — compiled binary (statically linked, runs from anywhere)
//   rust/cache/<hash>.meta  — JSON provenance: { testFile, createdAt }
//
// The hash is the first 16 hex chars of SHA-256(generated_rust_code). This
// means any change to the Brevity source, parser, or codegen that alters the
// generated Rust output automatically invalidates the cache — no manual
// version tracking needed.
//
// PROVENANCE & INVALIDATION
// -------------------------
// Each cache entry records which test file produced it (via `testFile`) and
// when it was created (via `createdAt` as epoch ms).
//
// On module load, `sweepRustCache()` iterates all .meta files and deletes
// entries that are stale:
//
//   1. Test file deleted → cache entry is orphaned → delete
//   2. Test file modified after cache creation → test may have changed
//      its source strings → old binary is suspect → delete
//   3. Corrupt or unreadable .meta → delete
//   4. No testFile recorded (null) → no provenance to check → keep
//
// This prevents unbounded storage growth from renamed/deleted tests or
// changed source strings that produce different hashes (orphaning the old
// entry).
//
// Note: changes to the compiler itself (src/codegen-rs.js etc.) don't need
// special handling — they change the generated Rust code, which changes the
// hash, which means the old cache entry simply won't match. It will be
// cleaned up the next time the test file is touched or the entry ages out.
//
// CONCURRENCY
// -----------
// Jest runs test files in parallel across workers. Each worker has its own
// `cargo build` workspace (rust/w1/, rust/w2/, ...) but shares the cache
// directory. This is safe because:
//
//   - Different test sources produce different hashes → no write contention
//   - Same hash from two workers is idempotent → both produce the same binary
//   - The sweep runs at module load time in each worker, but is idempotent
//   - Worst case on a race: a cache miss that triggers one extra cargo build
//
// The cached binaries are statically linked Rust executables. They don't
// depend on the worker directory — they read stdin, write stdout. No need
// to copy them into worker folders.
//
// USAGE
// -----
//   import { buildOrCached, sweepRustCache } from './rust-cache.js';
//
//   // At module load time (once per worker):
//   sweepRustCache();
//
//   // Per test invocation:
//   const binaryPath = buildOrCached({ rustCode, rustDir, binaryPath });
//   // → returns path to a ready-to-run binary (cached or freshly built)

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, existsSync, statSync, chmodSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUST_BASE = join(__dirname, '..', 'rust');

/** Directory where cached binaries and their .meta files live. */
export const RUST_CACHE = join(RUST_BASE, 'cache');
mkdirSync(RUST_CACHE, { recursive: true });

// ── Sweep ───────────────────────────────────────────────────────────────────

/**
 * Delete stale cache entries on startup.
 *
 * "Stale" means:
 *   - The originating test file no longer exists (orphaned entry)
 *   - The originating test file was modified after the cache was created
 *     (test source may have changed → binary is suspect)
 *   - The .meta file is corrupt or unreadable
 *
 * Entries with testFile: null are kept — they have no provenance to check.
 * This is a conservative default; if provenance detection fails, the entry
 * persists until manually cleared.
 */
export function sweepRustCache() {
  let files;
  try { files = readdirSync(RUST_CACHE); } catch { return; }

  for (const file of files) {
    if (!file.endsWith('.meta')) continue;

    const metaPath = join(RUST_CACHE, file);
    const binaryPath = join(RUST_CACHE, file.slice(0, -5)); // strip ".meta"

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

      // No provenance recorded — can't determine staleness, keep it
      if (!meta.testFile) continue;

      const gone = !existsSync(meta.testFile);
      const newer = !gone && statSync(meta.testFile).mtimeMs > meta.createdAt;

      if (gone || newer) {
        unlinkSync(metaPath);
        if (existsSync(binaryPath)) unlinkSync(binaryPath);
      }
    } catch {
      // Corrupt meta — clean up both files
      try { unlinkSync(metaPath); } catch { /* ignore */ }
      try { if (existsSync(binaryPath)) unlinkSync(binaryPath); } catch { /* ignore */ }
    }
  }
}

// ── Provenance detection ────────────────────────────────────────────────────

/**
 * Walk the call stack to find the .test.js file that triggered this build.
 *
 * Tries two strategies:
 *   1. Parse the Error stack trace for file:// URLs (ESM) or paren-wrapped
 *      paths (CJS) ending in .test.js
 *   2. Fall back to Jest's expect.getState().testPath global
 *
 * Returns an absolute path, or null if detection fails.
 */
function getCallerTestFile() {
  const stack = new Error().stack;
  for (const line of stack.split('\n')) {
    const m = line.match(/file:\/\/(\/[^\s:)]+\.test\.js)/)
           || line.match(/\((\/[^\s:)]+\.test\.js)/);
    if (m) return m[1];
  }
  try { return expect.getState().testPath; } catch { /* ignore */ }
  return null;
}

// ── Build or retrieve from cache ────────────────────────────────────────────

/**
 * Return a path to a compiled Rust binary for the given generated code.
 *
 * On cache miss:
 *   1. Write rustCode to <rustDir>/src/main.rs
 *   2. Run `cargo build --quiet` in rustDir
 *   3. Copy the compiled binary from buildBinaryPath to rust/cache/<hash>
 *   4. Write a .meta file recording provenance
 *
 * On cache hit:
 *   Skip all of the above; return the cached binary path directly.
 *
 * @param {string} rustCode     — generated Rust source (main.rs content)
 * @param {string} rustDir      — worker-specific cargo workspace (rust/w1/)
 * @param {string} rustSrc      — source dir within workspace (rust/w1/src/)
 * @param {string} buildBinaryPath — where cargo puts the binary (rust/w1/target/debug/brevity-actor)
 * @returns {string} — absolute path to a ready-to-run binary
 */
export function buildOrCached({ rustCode, rustDir, rustSrc, buildBinaryPath }) {
  const hash = createHash('sha256').update(rustCode).digest('hex').slice(0, 16);
  const cachedBinary = join(RUST_CACHE, hash);
  const cachedMeta = join(RUST_CACHE, `${hash}.meta`);

  if (!existsSync(cachedBinary)) {
    // Cache miss — full cargo build
    writeFileSync(join(rustSrc, 'main.rs'), rustCode);
    execSync('cargo build --quiet', { cwd: rustDir, stdio: 'pipe' });
    copyFileSync(buildBinaryPath, cachedBinary);
    chmodSync(cachedBinary, 0o755);

    const testFile = getCallerTestFile();
    writeFileSync(cachedMeta, JSON.stringify({ testFile, createdAt: Date.now() }));
  }

  return cachedBinary;
}
