/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Cosigner = require('../lib/primitives/cosigner');
const {hd} = require('bcoin');
const {HDPublicKey} = hd;

// This path does not do much.
const TEST_PATH = 'm/44\'/0\'/0\'/0/0';
const TEST_TOKEN = Buffer.alloc(32);
const TEST_KEY = hd.generate().toPublic();
const NETWORK = 'main';

// commonly used test case
const TEST_OPTIONS = {
  id: 5,
  tokenDepth: 0,
  token: TEST_TOKEN,
  name: 'test1',
  path: TEST_PATH,
  key: TEST_KEY
};

// its serialization
const TEST_RAW = Buffer.from(
  '05' // id
  + '00000000' // tokenDepth
  + TEST_TOKEN.toString('hex') // token
  + '05' + '7465737431' // name
  + '0f' + '6d2f3434272f30272f30272f302f30' // path
  + TEST_KEY.toRaw(NETWORK).toString('hex')
, 'hex');

describe('Cosigner', function () {
  it('should create cosigner from options', () => {
    const options = TEST_OPTIONS;

    const cosigner1 = new Cosigner(options);
    const cosigner2 = Cosigner.fromOptions(options);

    for (const cosigner of [cosigner1, cosigner2]) {
      assert.strictEqual(cosigner.name, options.name,
        'name was not set correctly.'
      );

      assert.strictEqual(cosigner.id, options.id,
        'id was not set correctly.'
      );

      assert.strictEqual(cosigner.path, options.path,
        'path was not set correctly.'
      );

      assert.strictEqual(cosigner.key.equals(TEST_OPTIONS.key), true,
        'Public key was not set correctly.'
      );
    }
  });

  it('should reserialize correctly', () => {
    const options = TEST_OPTIONS;
    const cosigner1 = new Cosigner(options);
    const data = cosigner1.toRaw(NETWORK);
    const cosigner2 = Cosigner.fromRaw(data, NETWORK);

    assert.deepStrictEqual(cosigner1, cosigner2);
  });

  it('should serialize correctly', () => {
    const options = TEST_OPTIONS;
    const expected = TEST_RAW;

    const cosigner = new Cosigner(options);
    const serialized = cosigner.toRaw(NETWORK);

    assert.bufferEqual(serialized, expected,
      'Cosigner was not serialized correctly'
    );
  });

  it('should deserialize correctly', () => {
    const data = TEST_RAW;
    const expected = TEST_OPTIONS;

    const cosigner1 = new Cosigner().fromRaw(data);
    const cosigner2 = Cosigner.fromRaw(data);

    for (const cosigner of [cosigner1, cosigner2]) {
      assert.strictEqual(cosigner.name, expected.name,
        'name was not set correctly.'
      );

      assert.strictEqual(cosigner.id, expected.id,
        'id was not set correctly.'
      );

      assert.strictEqual(cosigner.path, expected.path,
        'path was not set correctly.'
      );
    }
  });

  it('should serialize json', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);

    // no details
    const json1 = cosigner.toJSON();
    const cosigner1 = Cosigner.fromJSON(json1, false);

    assert.strictEqual(cosigner.equals(cosigner1, false), true);

    // with details
    const json2 = cosigner.toJSON(true);
    const cosigner2 = Cosigner.fromJSON(json2, true);

    assert.strictEqual(cosigner.equals(cosigner2, true), true);
  });
});
