import compile from '../index.js';

// ── Single handler — varied input signatures ──────────────────────────────────

describe('service manifest — input signatures', () => {
  it('no args', () => {
    const { manifest } = compile(`
      @ping
        =
        -> 1 : Integer
    `);
    expect(manifest.service).toBe('{\n  ping: () -> (Integer)\n}');
  });

  it('single named arg', () => {
    const { manifest } = compile(`
      @greet
        =
        :name : Text
        =
        -> greeting: "hi" : Text
    `);
    expect(manifest.service).toBe('{\n  greet: (name: Text) -> (greeting: Text)\n}');
  });

  it('single positional arg', () => {
    const { manifest } = compile(`
      @double
        =
        n : Integer
        =
        -> n + n : Integer
    `);
    expect(manifest.service).toBe('{\n  double: (Integer) -> (Integer)\n}');
  });

  it('mixed positional and named args', () => {
    const { manifest } = compile(`
      @compute
        =
        a : Integer
        :label : Text
        =
        -> 0 : Integer, result: "ok" : Text
    `);
    expect(manifest.service).toBe('{\n  compute: (Integer, label: Text) -> (Integer, result: Text)\n}');
  });
});

// ── Single handler — varied -> signatures ──────────────────────────────────

describe('service manifest — -> signatures', () => {
  it('positional reply', () => {
    const { manifest } = compile(`
      @square
        =
        n : Integer
        =
        -> n * n : Integer
    `);
    expect(manifest.service).toBe('{\n  square: (Integer) -> (Integer)\n}');
  });

  it('named reply', () => {
    const { manifest } = compile(`
      @lookup
        =
        :key : Text
        =
        -> value: "found" : Text
    `);
    expect(manifest.service).toBe('{\n  lookup: (key: Text) -> (value: Text)\n}');
  });

  it('sigil reply', () => {
    const { manifest } = compile(`
      @echo
        =
        :msg : Text
        =
        -> :msg : Text
    `);
    expect(manifest.service).toBe('{\n  echo: (msg: Text) -> (msg: Text)\n}');
  });

  it('mixed positional and named reply', () => {
    const { manifest } = compile(`
      @divide
        =
        a : Integer
        b : Integer
        =
        -> a / b : Integer, remainder: 0 : Integer
    `);
    expect(manifest.service).toBe('{\n  divide: (Integer, Integer) -> (Integer, remainder: Integer)\n}');
  });
});

// ── Silent handlers ───────────────────────────────────────────────────────────

describe('service manifest — silent handlers', () => {
  it('silent handler with named arg shows -> .', () => {
    const { manifest } = compile('@notify = |:msg : Text| .\n');
    expect(manifest.service).toBe('{\n  notify: (msg: Text) -> .\n}');
  });

  it('silent handler with no args shows -> .', () => {
    const { manifest } = compile('@sync = .\n');
    expect(manifest.service).toBe('{\n  sync: () -> .\n}');
  });

  it('silent handler with positional arg shows -> .', () => {
    const { manifest } = compile('@fire = |n : Integer| .\n');
    expect(manifest.service).toBe('{\n  fire: (Integer) -> .\n}');
  });
});

// ── Multiple handlers ─────────────────────────────────────────────────────────

describe('service manifest — multiple handlers', () => {
  it('replying and silent handler appear in order', () => {
    const source = `
      @ping
        =
        -> 1 : Integer
      @log = |:msg : Text| .
    `;
    expect(compile(source).manifest.service).toBe(
      '{\n  ping: () -> (Integer)\n  log: (msg: Text) -> .\n}'
    );
  });

  it('three handlers with distinct signatures', () => {
    const source = `
      @get
        =
        :key : Text
        =
        -> value: "v" : Text
      @set = |:key : Text, :value : Text| .
      @count
        =
        -> 0 : Integer
    `;
    expect(compile(source).manifest.service).toBe(
      '{\n  get: (key: Text) -> (value: Text)\n  set: (key: Text, value: Text) -> .\n  count: () -> (Integer)\n}'
    );
  });

  it('overloaded handler — both variants listed', () => {
    const source = `
      @notify = |:msg : Integer| .
      @notify = |:msg : Text| -> ack: "noted" : Text
    `;
    expect(compile(source).manifest.service).toBe(
      '{\n  notify: (msg: Integer) -> . | (msg: Text) -> (ack: Text)\n}'
    );
  });
});

// ── Procs excluded ────────────────────────────────────────────────────────────

describe('service manifest — procs excluded', () => {
  it('proc does not appear in manifest', () => {
    const source = `
      @echo
        =
        :msg : Text
        =
        -> :msg : Text
      helper
        =
        n : Integer
        =
        ->(result: n : Integer)
    `;
    expect(compile(source).manifest.service).toBe('{\n  echo: (msg: Text) -> (msg: Text)\n}');
  });

  it('proc-only file produces empty service block', () => {
    const source = `
      helper
        =
        n : Integer
        =
        ->(result: n : Integer)
    `;
    expect(compile(source).manifest.service).toBe('{\n}');
  });
});
