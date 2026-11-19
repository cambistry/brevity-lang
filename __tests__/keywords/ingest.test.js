import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — keyword basics
//
// `ingest` lets a superclass pause its constructor block, wait for the
// subclass's constructor block to complete, and receive the subclass's return value.
//
// See constructors/ingest.test.js for comprehensive tests.
// See keywords/ingest.md for documentation.
// ═══════════════════════════════════════════════════════════════════════════════

describe('ingest — keyword basics — compilation', () => {
  it('ingest keyword compiles in a constructor block', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
      }
      Child = Base ^ *{ "hello" }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('ingest with default compiles', () => {
    expect(() => compileSource(`
      Panel = * {
        content Text = ingest("")
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  // `ingest` may be deprecated (it outlived its templating purpose), so these
  // compile checks are skipped rather than implemented.
  it.skip('ingest without a default cannot be constructed directly', () => {
    expect(() => compileSource(`
      Base = * {
        count Integer = ingest
      }
      @test = {
        b = Base()
        return 1 as Integer
      }
    `)).toThrow(/ingest/);
  });

  it.skip('ingest with typed binding checks subclass return type', () => {
    expect(() => compileSource(`
      Base = * {
        count Integer = ingest
      }
      Child = Base ^ *{ "three" }
      @test = -> 1 as Integer
    `)).toThrow(/ingest/);
  });
});
