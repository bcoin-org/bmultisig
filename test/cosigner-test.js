/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Cosigner = require('../lib/primitives/cosigner');
const {hd} = require('bcoin');
const secp256k1 = require('bcrypto/lib/secp256k1');

const privKey = secp256k1.generatePrivateKey();

// commonly used test case
const NETWORK = 'main';

const TEST_OPTIONS = {
  id: 5,
  tokenDepth: 0,
  token: Buffer.alloc(32),
  name: 'test1',
  purpose: 0,
  fingerPrint: 0,
  key: hd.generate().toPublic(),
  authPubKey: secp256k1.publicKeyCreate(privKey, true),
  joinSignature: Buffer.alloc(65, 1),
  data: Buffer.from('m/44\'/0\'/0\'/0/0', 'utf8')
};

// its serialization
const TEST_RAW = Buffer.from(
  '05' // id
  + '00000000' // tokenDepth
  + TEST_OPTIONS.token.toString('hex') // token
  + '05' + '7465737431' // name
  + '00000000' // purpose
  + '00000000' // fingerPrint
  + '0f' + '6d2f3434272f30272f30272f302f30' // data
  + TEST_OPTIONS.key.toRaw(NETWORK).toString('hex')
  + TEST_OPTIONS.authPubKey.toString('hex')
  + TEST_OPTIONS.joinSignature.toString('hex')
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

  it('should clone cosigner', () => {
    const options = TEST_OPTIONS;
    const cosigner1 = new Cosigner(options);
    const cosigner2 = cosigner1.clone();

    assert.ok(cosigner1.equals(cosigner2, true));
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

  it('should serialize json (no details)', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);

    // no details
    const json = cosigner.toJSON();
    const cosigner1 = Cosigner.fromJSON(json, false);

    assert.ok(cosigner.equals(cosigner1, false));
  });

  it('should serialize json (details)', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);

    const json = cosigner.toJSON(true);
    const cosigner1 = Cosigner.fromJSON(json, true);

    assert.ok(cosigner.equals(cosigner1, true));
  });
});
