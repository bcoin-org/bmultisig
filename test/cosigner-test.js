/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const Cosigner = require('../lib/primitives/cosigner');
const bufio = require('bufio');
const {hd} = require('bcoin');
const secp256k1 = require('bcrypto/lib/secp256k1');
const sigUtils = require('../lib/utils/sig');

const privKey = secp256k1.privateKeyGenerate();

// commonly used test case
const NETWORK = 'main';

const accountPrivateKey = hd.generate();
const accountPublicKey = accountPrivateKey.toPublic();

const TEST_OPTIONS = {
  id: 5,
  tokenDepth: 1,
  token: Buffer.alloc(32),
  name: 'test1',
  purpose: 44,
  fingerPrint: 100,
  key: accountPublicKey,
  authPubKey: secp256k1.publicKeyCreate(privKey, true),
  joinSignature: Buffer.alloc(65, 1),
  data: Buffer.from('m/44\'/0\'/0\'/0/0', 'utf8')
};

// its serialization
const TEST_RAW = Buffer.from(
  '05' // id
  + '01000000' // tokenDepth
  + TEST_OPTIONS.token.toString('hex') // token
  + '05' + '7465737431' // name
  + '0000002c' // purpose
  + '00000064' // fingerPrint
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
    const data = cosigner1.encode(NETWORK);
    const cosigner2 = Cosigner.decode(data, NETWORK);

    assert.deepStrictEqual(cosigner1, cosigner2);
  });

  it('should serialize correctly', () => {
    const options = TEST_OPTIONS;
    const expected = TEST_RAW;

    const cosigner = new Cosigner(options);
    const serialized = cosigner.encode(NETWORK);

    assert.bufferEqual(serialized, expected,
      'Cosigner was not serialized correctly'
    );
  });

  it('should deserialize correctly', () => {
    const data = TEST_RAW;
    const expected = TEST_OPTIONS;

    const cosigner1 = new Cosigner().decode(data);
    const cosigner2 = Cosigner.decode(data);

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

    const json = cosigner.getJSON(true);
    const cosigner1 = Cosigner.fromJSON(json, true);

    assert.ok(cosigner.equals(cosigner1, true));
  });

  it('should return HTTP options', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);
    const options = cosigner.toHTTPOptions();

    const joinSignature = cosigner.joinSignature.toString('hex');

    assert.strictEqual(options.cosigner.name, cosigner.name);
    assert.strictEqual(options.cosigner.purpose, cosigner.purpose);
    assert.strictEqual(options.cosigner.fingerPrint, cosigner.fingerPrint);
    assert.strictEqual(options.cosigner.data, cosigner.data.toString('hex'));
    assert.strictEqual(options.cosigner.accountKey, cosigner.key.xpubkey());
    assert.strictEqual(options.cosigner.token, cosigner.token.toString('hex'));
    assert.strictEqual(options.joinSignature, joinSignature);
    assert.strictEqual(options.cosigner.authPubKey,
      cosigner.authPubKey.toString('hex'));
  });

  it('should verify proof signature', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);
    const proofKey = accountPrivateKey.derive(sigUtils.PROOF_INDEX).derive(0);
    const walletName = 'test';
    const data = bufio.write();

    data.writeString(walletName, 'utf8');
    data.writeString(TEST_OPTIONS.name, 'utf8');
    data.writeBytes(TEST_OPTIONS.authPubKey);
    data.writeBytes(TEST_OPTIONS.key.toRaw());

    const raw = data.render();

    const signature = sigUtils.signMessage(raw, proofKey.privateKey);

    assert.ok(!cosigner.verifyProof(Buffer.allocUnsafe(65), walletName));
    assert.ok(cosigner.verifyProof(signature, walletName));
  });

  it('should verify proof signature (client)', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);
    const walletName = 'test';
    const proofKey = accountPrivateKey.derive(sigUtils.PROOF_INDEX).derive(0);
    const hash = cosigner.getJoinHash(walletName, NETWORK);
    const signature = sigUtils.signHash(hash, proofKey.privateKey);

    const clientCosigner = Cosigner.fromJSON(cosigner.toJSON());

    assert.ok(!clientCosigner.verifyProof(Buffer.allocUnsafe(65), walletName));
    assert.ok(clientCosigner.verifyProof(signature, walletName));
  });

  it('should verify join signature', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);
    const joinPrivKey = secp256k1.privateKeyGenerate();
    const joinPubKey = secp256k1.publicKeyCreate(joinPrivKey, true);
    const walletName = 'test';

    const data = bufio.write();

    data.writeString(walletName);
    data.writeString(TEST_OPTIONS.name);
    data.writeBytes(TEST_OPTIONS.authPubKey);
    data.writeBytes(TEST_OPTIONS.key.toRaw());

    const raw = data.render();
    const signature = sigUtils.signMessage(raw, joinPrivKey);
    cosigner.joinSignature = signature;

    const badPubKey = Buffer.allocUnsafe(33);
    assert.ok(cosigner.verifyJoinSignature(joinPubKey, walletName));
    assert.ok(!cosigner.verifyJoinSignature(joinPubKey, ''));
    assert.ok(!cosigner.verifyJoinSignature(badPubKey, walletName));

    cosigner.joinSignature = Buffer.allocUnsafe(65);
    assert.ok(!cosigner.verifyJoinSignature(joinPubKey, walletName));
    assert.ok(!cosigner.verifyJoinSignature(joinPubKey, ''));
    assert.ok(!cosigner.verifyJoinSignature(badPubKey, walletName));
  });

  it('should verify join signature (client)', () => {
    const cosigner = new Cosigner(TEST_OPTIONS);
    const joinPrivKey = secp256k1.privateKeyGenerate();
    const joinPubKey = secp256k1.publicKeyCreate(joinPrivKey, true);
    const walletName = 'test';

    const hash = cosigner.getJoinHash(walletName);
    const signature = sigUtils.signHash(hash, joinPrivKey);
    cosigner.joinSignature = signature;

    const clientCosigner = Cosigner.fromJSON(cosigner.toJSON());

    assert.ok(clientCosigner.verifyJoinSignature(joinPubKey, walletName));
  });
});
