import { extract } from '../../index.js';

// The Opre service document a file publishes: notes/opre-type-encoding-2026-11-21.md
// ("The document"). A tree of addresses; each node has its `public` and `protected`
// ops and its `types`, nested addresses under colon-prefixed keys. Every op's value
// is a list of signatures.

describe('the service document', () => {
  it('lists every op at every address', () => {
    const { interface: iface } = extract(`
      use Widget = "widget.bv" as { total () ~> (Integer) }
      type Point(Integer, y: Integer)
      @val = 100
      @origin = Point(0, y: 0)
      @cell *Text = "hi"
      untracked @log *Text = ""
      count *Integer = 0
      @bump! = { count <- count + 1; return count }
      @fetch = { n Integer = Widget.total(); return n }
      untracked @note. = (m Text) { @log <- @log + m }
      @size = (t Text) -> 1
      @size = (n Integer) -> 2
      @G = () *{
        step = -> 1
      }
      @T = @G ^ (name Text) *{
        @get = -> step()
      } ^ {
        @made = -> 1
      }
    `);
    expect(iface.service).toEqual({
      public: {
        val: [{ re: ['Integer'], writes: false }],
        origin: [{ re: [':Point'], writes: false }],
        cell: [{ re: ['Text'], writes: false }],
        log: [{ re: ['Text'], writes: false }],
        'bump!': [{ re: ['Anything'], writes: true }],
        fetch: [{ re: ['Integer'] }],
        'note.': [{ args: ['Text'], writes: 'untracked' }],
        size: [
          { args: ['Text'], re: ['Integer'], writes: false },
          { args: ['Integer'], re: ['Integer'], writes: false },
        ],
      },
      types: {
        ':Point': ['Integer', { y: 'Integer' }],
      },
      ':cell': {
        public: {
          $get: [{ re: ['Text'], writes: false }],
          $set: [{ args: ['Text'], writes: true }],
        },
      },
      ':log': {
        public: {
          $get: [{ re: ['Text'], writes: false }],
          $set: [{ args: ['Text'], writes: 'untracked' }],
        },
      },
      ':G': {
        public: {
          $new: [{ re: [':G'], writes: false }],
        },
        instance: {
          protected: {
            '~step': [{ re: ['Integer'], writes: false }],
          },
        },
      },
      ':T': {
        extends: [':G'],
        public: {
          $new: [{ args: ['Text'], re: [':T'], writes: false }],
          made: [{ re: ['Integer'], writes: false }],
        },
        instance: {
          public: {
            get: [{ re: ['Anything'], writes: false }],
          },
          protected: {
            '~step': [{ re: ['Integer'], writes: false }],
          },
        },
      },
    });
  });

  it('a subclass with no constructor of its own takes its parent\'s params', () => {
    const { interface: iface } = extract(`
      @G = (n Integer) *{
      }
      @U = @G ^ *{
        @more = -> 2
      }
    `);
    expect(iface.service).toEqual({
      ':G': {
        public: {
          $new: [{ args: ['Integer'], re: [':G'], writes: false }],
        },
        instance: {},
      },
      ':U': {
        extends: [':G'],
        public: {
          $new: [{ args: ['Integer'], re: [':U'], writes: false }],
        },
        instance: {
          public: {
            more: [{ re: ['Integer'], writes: false }],
          },
        },
      },
    });
  });

  it('a type declared in a class is the class\'s, named bare inside it', () => {
    const { interface: iface } = extract(`
      @W = () *{
        type X(Integer)
        @x = (p X) -> p
      }
    `);
    expect(iface.service).toEqual({
      ':W': {
        public: {
          $new: [{ re: [':W'], writes: false }],
        },
        types: {
          ':X': ['Integer'],
        },
        instance: {
          public: {
            x: [{ args: [':W:X'], re: [':W:X'], writes: false }],
          },
        },
      },
    });
  });

  it('a type reached through another service is its address there', () => {
    const { interface: iface } = extract(`
      use Geo = "geo.bv"
      @p = (q Geo::Point) -> q
    `);
    expect(iface.service).toEqual({
      public: {
        p: [{ args: ['geo.bv:Point'], re: ['geo.bv:Point'], writes: false }],
      },
    });
  });

  it('a public singleton is a node of its own', () => {
    const { interface: iface } = extract(`
      @s = actor {
        @k = -> 1
      }
    `);
    expect(iface.service).toEqual({
      ':s': {
        public: {
          k: [{ re: ['Integer'], writes: false }],
        },
      },
    });
  });

  it('a constructor profile in a published signature is a compile error', () => {
    expect(() => extract('@build = (make: (start: Integer) -> *{ get () -> (Integer) }) -> 1\n'))
      .toThrow("A constructor profile can't be a type here: '(start: Integer) -> *{ get () -> (Integer) }'");
  });
});
