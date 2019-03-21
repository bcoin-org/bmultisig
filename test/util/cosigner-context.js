'use strict';

const util = require('util');
const assert = require('bsert');
const custom = require('../../lib/utils/inspect');
const hd = require('bcoin/lib/hd');
const Network = require('bcoin/lib/protocol/network');
const hash160 = require('bcrypto/lib/hash160');
const secp256k1 = require('bcrypto/lib/secp256k1');

const Cosigner = require('../../lib/primitives/cosigner');

const EMPTY_SIG = Buffer.alloc(65, 0x00);
const NULL_TOKEN = Buffer.alloc(32, 0x00);

class CosignerContext {
  constructor(options) {
    this.network = Network.main;
    this.master = null;
    this.accountKey = null;
    this.purpose = 0;
    this.fingerPrint = 0;
    this.name = 'cosigner';
    this.walletName = '';

    this.token = NULL_TOKEN;

    this.authPrivKey = null;
    this.authPubKey = null;

    this.joinPrivKey = null;
    this.joinPubKey = null;

    this.fromOptions(options);
  }

  fromOptions(options) {
    if (options.name != null) {
      assert(typeof options.name === 'string');
      this.name = options.name;
    }

    if (options.walletName != null) {
      assert(typeof options.walletName === 'string');
      this.walletName = options.walletName;
    }

    if (options.token != null) {
      assert(Buffer.isBuffer(options.token));
      this.token = options.token;
    }

    let master;
    if (options.master != null) {
      assert(hd.PrivateKey.isHDPrivateKey(options.master),
        'Bad master key.');
      master = options.master;
    } else {
      master = hd.generate();
    }

    let joinPrivKey;
    if (options.joinPrivKey != null) {
      assert(Buffer.isBuffer(options.joinPrivKey),
        'joinPrivKey must be a buffer.');
      assert(secp256k1.privateKeyVerify(options.joinPrivKey),
        'joinPrivKey is not a private key.');
      joinPrivKey = options.joinPrivKey;
    } else {
      joinPrivKey = secp256k1.privateKeyGenerate();
    }

    let authPrivKey;
    if (options.authPrivKey != null) {
      assert(Buffer.isBuffer(options.authPrivKey),
        'authPrivKey must be a buffer.');
      assert(secp256k1.privateKeyVerify(options.authPrivKey),
        'authPrivKey is not a private key.');

      authPrivKey = options.authPrivKey;
    } else {
      authPrivKey = secp256k1.privateKeyGenerate();
    }

    this.joinPrivKey = joinPrivKey;
    this.joinPubKey = secp256k1.publicKeyCreate(this.joinPrivKey, true);

    this.authPrivKey = authPrivKey;
    this.authPubKey = secp256k1.publicKeyCreate(this.authPrivKey, true);

    this.master = master;
    this.fingerPrint = getFingerprint(master);
    this.accountPrivKey = this.master.deriveAccount(44, this.purpose, 0);
    this.accountKey = this.accountPrivKey.toPublic();
  }

  static fromOptions(options) {
    return new this(options);
  }

  /**
   * @returns {Cosigner}
   */

  toCosigner() {
    return Cosigner.fromOptions({
      name: this.name,
      key: this.accountKey,
      authPubKey: this.authPubKey,
      joinSignature: EMPTY_SIG,
      fingerPrint: this.fingerPrint,
      token: this.token,
      purpose: this.purpose
    });
  }

  get xpub() {
    return this.accountKey.xpubkey(this.network);
  }

  [custom]() {
    return '<CosignerContext\n'
      + `  name=${this.name}\n`
      + `  network=${this.network.type}\n`
      + `  master=${this.master.xprivkey(this.network)} \n`
      + `  fingerPrint=${this.fingerPrint}\n`
      + `  purpose=${this.purpose}\n`
      + `  xpub=${this.xpub}\n`
      + `  authPubKey=${this.authPubKey.toString('hex')}\n`
      + `  joinPubKey=${this.joinPubKey.toString('hex')}\n`
      + `  cosigner=${util.inspect(this.cosigner)}`
      + '/>';
  }
}

function getFingerprint(master) {
  const fp = hash160.digest(master.publicKey);
  return fp.readUInt32BE(0, true);
}

module.exports = CosignerContext;
