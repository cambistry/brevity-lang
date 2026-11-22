import { compileSource } from '../helpers.js';

// Compiling against another service's JSON document (notes/opre-type-encoding-2026-11-21.md):
// validation and the effects check read it as they read doc text. An op with no `writes`
// claim is a purported read, today's `~>`: a function not named with a bang may call it,
// and then makes no claim itself.

const remotes = [{ path: 'w', service: { public: {
  total: [{ re: ['Integer'] }],
  peek: [{ re: ['Integer'], writes: false }],
  pop: [{ re: ['Integer'], writes: true }],
  note: [{ args: ['Text'], writes: 'untracked' }],
  scale: [{ args: ['Integer', { by: { '%opt': 'Integer' } }], re: [{ n: 'Integer' }], writes: false }],
} } }];

describe('a JSON document in remotes', () => {
  it('an op with no writes claim: callable from a function with no bang, which then claims nothing', () => {
    const { interface: iface } = compileSource('use W = "w"\n@go = { x Integer = W.total(); return x }\n', { remotes });
    expect(iface.service.public).toEqual({ go: [{ re: ['Integer'] }] });
  });

  it('an op that writes nothing', () => {
    const { interface: iface } = compileSource('use W = "w"\n@go = { x Integer = W.peek(); return x }\n', { remotes });
    expect(iface.service.public).toEqual({ go: [{ re: ['Integer'], writes: false }] });
  });

  it('an op that writes: only from a function with a bang', () => {
    expect(() => compileSource('use W = "w"\n@go = { x Integer = W.pop(); return x }\n', { remotes }))
      .toThrow("'@go' writes (W.pop(…)), so it must be named '@go!' or '@go.'");
    const { interface: iface } = compileSource('use W = "w"\n@go! = { x Integer = W.pop(); return x }\n', { remotes });
    expect(iface.service.public).toEqual({ 'go!': [{ re: ['Integer'], writes: true }] });
  });

  it('an untracked write counts as none', () => {
    const { interface: iface } = compileSource('use W = "w"\n@go = { W.note("hi")...; return 1 }\n', { remotes });
    expect(iface.service.public).toEqual({ go: [{ re: ['Integer'], writes: false }] });
  });

  it('an op the document has no entry for', () => {
    expect(() => compileSource('use W = "w"\n@go = { x Integer = W.missing(); return x }\n', { remotes }))
      .toThrow("'W' has no function 'missing'. Available: total, peek, pop, note, scale");
  });

  it('a reply bound as another type', () => {
    expect(() => compileSource('use W = "w"\n@go = { x Text = W.peek(); return x }\n', { remotes }))
      .toThrow("Cannot bind 'x Text' to 'W.peek()' — it can return Integer");
  });

  it('args checked against the signature, an optional named one included', () => {
    expect(() => compileSource('use W = "w"\n@go = { (n: m Integer) = W.scale(2, by: 3); return m }\n', { remotes })).not.toThrow();
    expect(() => compileSource('use W = "w"\n@go = { (n: m Integer) = W.scale(2); return m }\n', { remotes })).not.toThrow();
    expect(() => compileSource('use W = "w"\n@go = { (n: m Integer) = W.scale("a"); return m }\n', { remotes }))
      .toThrow("'W.scale()' arguments don't match any signature: (Integer, by: Integer). positional arg 1: expected Integer, got Text");
  });
});
