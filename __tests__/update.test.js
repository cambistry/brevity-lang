import { compileActor, expectActorReply } from './helpers.js';

describe('update operator (<|)', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      Person
        =
        ref name : Text = "anonymous"

        update = |name: n : Text| name <- n .

        @get
          =
          -> name: name : Text

        -> self
      end#Person

      Store
        =
        ref p : Integer = 0
        ref label : Text = ""

        update
          =
          val : Integer
          label: l : Text
          =
          p <- val
          label <- l
          .

        @pos
          =
          -> value: p : Integer

        @named
          =
          -> value: label : Text

        -> self
      end#Store

      @singleNamed
        =
        ref a = Person()
        a <| name: "Somebody"
        :name = a.get()
        -> :name : Text

      @multiArg
        =
        ref s = Store()
        s <| 42, label: "forty-two"
        :value = s.pos()
        -> :value : Integer
    `);
  });

  it('update with named param — actor receives via update handler', async () => {
    await expectActorReply({
      compiled, receive: { id: '1', op: '@singleNamed', from: 'c' },
      reply: { id: '1', 'bv-a': { name: 'Text' }, re: { name: 'Somebody' }, to: 'c' },
    });
  });

  it('update with positional + named — multi-arg dispatch', async () => {
    await expectActorReply({
      compiled, receive: { id: '2', op: '@multiArg', from: 'c' },
      reply: { id: '2', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' },
    });
  });
});
