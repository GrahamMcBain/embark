import assert from 'assert';
import sinon from 'sinon';
import { fakeEmbark } from 'embark-testing';
import CodeRunner from '../src/';

// Due to our `DAPP_PATH` dependency in `embark-utils` `dappPath()`, we need to
// ensure that this environment variable is defined.
process.env.DAPP_PATH = 'something';

describe('core/code-runner', () => {

  const { embark, plugins } = fakeEmbark();

  let codeRunner, doneCb;

  beforeEach(() => {
    codeRunner = new CodeRunner(embark);
    doneCb = sinon.fake();
  });

  afterEach(() => {
    embark.teardown();
    sinon.restore();
  });

  test('it should register variables and eval code in the VM', done => {
    const testVar = {
      foo: 'bar'
    };
    embark.events.request('runcode:register', 'testVar', testVar, () => {

      embark.events.request('runcode:getContext', context => {
        assert.equal(context['testVar'], testVar);
        done();
      });
    });
  });

  test('it should run code in the VM', done => {
    const testVar = {
      foo: 'bar'
    };
    embark.events.request('runcode:register', 'testVar', testVar, () => {
      embark.events.request('runcode:eval', `testVar.foo = 'bar';`, (err) => {
        // `runcode:eval` throw a `ReferenceError` if `testVar` wasn't registered
        // in the VM
        assert.equal(err, null);
        done();
      });
    });
  });
});

