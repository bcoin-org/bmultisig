/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Cosigner = require('../lib/cosigner');

// This path does not do much.
const TEST_PATH = 'm/44\'/0\'/0\'/0/0';

// at this point we don't use anything from MSDB
const TEST_MSDB = {};

// commonly used test case
const TEST_OPTIONS = {
  id: 5,
  name: 'test1',
  xpubIndex: 2,
  path: TEST_PATH
};

// its serialization
const TEST_RAW = Buffer.from(
  '05000000' // id
  + '02000000' // xpubIndex
  + '05' + '7465737431' // name
  + '0f' + '6d2f3434272f30272f30272f302f30' // path
, 'hex');

describe('Cosigner', function () {
  it('should create cosigner from options', () => {
    const options = TEST_OPTIONS;

    const cosigner1 = new Cosigner(TEST_MSDB, options);
    const cosigner2 = Cosigner.fromOptions(TEST_MSDB, options);

    for (const cosigner of [cosigner1, cosigner2]) {
      assert.strictEqual(cosigner.name, options.name,
        'name was not set correctly.'
      );

      assert.strictEqual(cosigner.id, options.id,
        'id was not set correctly.'
      );

      assert.strictEqual(cosigner.xpubIndex, options.xpubIndex,
        'xpubIndex was not set correctly.'
      );

      assert.strictEqual(cosigner.path, options.path,
        'path was not set correctly.'
      );
    }
  });

  it('should reserialize correctly', () => {
    const options = TEST_OPTIONS;
    const cosigner1 = new Cosigner(TEST_MSDB, options);
    const data = cosigner1.toRaw();
    const cosigner2 = Cosigner.fromRaw(TEST_MSDB, data);

    assert.deepEqual(cosigner1, cosigner2);
  });

  it('should serialize correctly', () => {
    const options = TEST_OPTIONS;
    const expected = TEST_RAW;

    const cosigner = new Cosigner(TEST_MSDB, options);
    const serialized = cosigner.toRaw();

    assert.bufferEqual(serialized, expected,
      'Cosigner was not serialized correctly'
    );
  });

  it('should deserialize correctly', () => {
    const data = TEST_RAW;
    const expected = TEST_OPTIONS;

    const cosigner1 = new Cosigner(TEST_MSDB).fromRaw(data);
    const cosigner2 = Cosigner.fromRaw(TEST_MSDB, data);

    for (const cosigner of [cosigner1, cosigner2]) {
      assert.strictEqual(cosigner.name, expected.name,
        'name was not set correctly.'
      );

      assert.strictEqual(cosigner.id, expected.id,
        'id was not set correctly.'
      );

      assert.strictEqual(cosigner.xpubIndex, expected.xpubIndex,
        'xpubIndex was not set correctly.'
      );

      assert.strictEqual(cosigner.path, expected.path,
        'path was not set correctly.'
      );
    }
  });
});
