/*!
 * cosigner.js - Cosigner
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

'use strict';

const assert = require('bsert');
const bufio = require('bufio');
const {Struct} = bufio;
const common = require('bcoin/lib/wallet/common');
const HDPublicKey = require('bcoin/lib/hd/public');
const secp256k1 = require('bcrypto/lib/secp256k1');
const custom = require('../utils/inspect');
const sigUtils = require('../utils/sig');

const ZERO_SIG = Buffer.alloc(65);
const ZERO_KEY = Buffer.alloc(33);
const NULL_TOKEN = Buffer.alloc(32);
const EMPTY = Buffer.alloc(0);

/**
 * Cosigner for proposal
 * @alias module:primitives.Cosigner
 * @extends {bufio.Struct}
 * @property {Number} id
 * @property {String} name
 * @property {String} path
 * @property {Number} tokenDepth
 * @property {Buffer} token
 * @property {Number} purpose
 * @property {Number} fingerPrint - uint32be
 * @property {Buffer} data - data up to 100 bytes
 * @property {Buffer} authPubKey - compressed public key
 * @property {Buffer} joinSignature
 * @property {bcoin.HDPublicKey?} key
 */
class Cosigner extends Struct {
  /**
   * Create Cosigner object
   * @constructor
   * @param {Object} [options] - Options
   * @param {Number} options.id - index of the cosigner
   * @param {String} options.name - name of cosigner
   * @param {Buffer} options.authPubKey - compressed public key
   * @param {Buffer} options.joinSignature
   * @param {String?} options.path - bip32 path if user wants to store
   * @param {Buffer?} options.data - data up to 100 bytes.
   * @param {Number} [options.tokenDepth = 0] - token change counter
   * @param {Number} [options.purpose=0]
   */

  constructor(options) {
    super();

    this.id = 0;
    this.name = '';
    this.purpose = 0;
    this.fingerPrint = 0;
    this.data = EMPTY;

    this.tokenDepth = 0;
    this.token = NULL_TOKEN;
    this.key = new HDPublicKey();
    this.authPubKey = ZERO_KEY;
    this.joinSignature = ZERO_SIG;

    if (options)
      this.fromOptions(options);
  }

  /**
   * Inject options to Cosigner
   * @override
   * @param {Object} options
   * @returns {Cosigner}
   */

  fromOptions(options) {
    if (!options)
      return this;

    assert(common.isName(options.name), 'Bad cosigner name.');
    assert(HDPublicKey.isHDPublicKey(options.key), 'Account key is required.');

    assert(Buffer.isBuffer(options.authPubKey), 'authPubKey must be a buffer.');
    assert(options.authPubKey.length === 33, 'Bad authPubKey length.');
    assert(secp256k1.publicKeyVerify(options.authPubKey), 'Bad authPubKey.');

    assert(Buffer.isBuffer(options.joinSignature),
      'joinSignature must be a buffer.');
    assert(options.joinSignature.length === 65, 'Bad joinSignature length.');

    this.name = options.name;
    this.key = options.key;
    this.authPubKey = options.authPubKey;
    this.joinSignature = options.joinSignature;

    if (options.id != null) {
      assert((options.id & 0xff) === options.id, 'ID must be uint8.');
      this.id = options.id;
    }

    if (options.tokenDepth != null) {
      assert((options.tokenDepth >>> 0) === options.tokenDepth,
        'tokenDepth must be a uint32.');
      this.tokenDepth = options.tokenDepth;
    }

    if (options.token != null) {
      assert(Buffer.isBuffer(options.token), 'token must be a buffer.');
      assert(options.token.length === 32, 'token must be 32 bytes long.');
      this.token = options.token;
    }

    if (options.purpose != null) {
      assert((options.purpose >>> 0) === options.purpose,
        'Purpose must be a uint32.');
      this.purpose = options.purpose;
    }

    if (options.fingerPrint != null) {
      assert((options.fingerPrint >>> 0) === options.fingerPrint,
        'fingerPrint must be a uint32.');
      this.fingerPrint = options.fingerPrint;
    }

    if (options.data != null) {
      assert(Buffer.isBuffer(options.data), 'data must be a buffer.');
      assert(options.data.length <= 100, 'data must be less than 100 bytes.');
      this.data = options.data;
    }

    return this;
  }

  /**
   * Get http options from cosigner.
   * NOTE: This will return token.
   * @param {Network} network
   * @returns {Object}
   */

  toHTTPOptions(network) {
    return {
      cosignerName: this.name,
      cosignerPurpose: this.purpose,
      cosignerFingerPrint: this.fingerPrint,
      cosignerData: this.data.toString('hex'),
      accountKey: this.key.xpubkey(network),
      token: this.token.toString('hex'),
      authPubKey: this.authPubKey.toString('hex'),
      joinSignature: this.joinSignature.toString('hex')
    };
  }

  [custom]() {
    return this.toJSON(true);
  }

  /**
   * Make serializable object from cosigner
   * @param {Boolean} showDetails
   * @param {Network} network
   * @returns {Object}
   */

  toJSON(showDetails, network) {
    return this.getJSON(showDetails, network);
  }

  /**
   * Make serializable object from cosigner
   * @override
   * @param {Boolean} showDetails
   * @param {Network} network
   * @returns {Object}
   */

  getJSON(showDetails, network) {
    if (!showDetails) {
      return {
        id: this.id,
        name: this.name,
        authPubKey: this.authPubKey.toString('hex'),
        joinSignature: this.joinSignature.toString('hex'),
        key: this.key.toJSON(network)
      };
    }

    return {
      id: this.id,
      name: this.name,
      authPubKey: this.authPubKey.toString('hex'),
      joinSignature: this.joinSignature.toString('hex'),
      key: this.key.toJSON(network),
      purpose: this.purpose,
      fingerPrint: this.fingerPrint,
      data: this.data.toString('hex'),
      tokenDepth: this.tokenDepth,
      token: this.token.toString('hex')
    };
  }

  /**
   * Inject properties from JSON object
   * @param {Object} json
   * @param {Boolean} details
   * @param {Network} network
   */

  fromJSON(json, details, network) {
    assert((json.id & 0xff) === json.id, 'id must be an u8.');
    assert(common.isName(json.name), 'Bad cosigner name.');
    assert(typeof json.authPubKey === 'string', 'Bad authPubKey.');
    assert(typeof json.joinSignature === 'string', 'Bad joinSignature.');
    assert(json.key && typeof json.key === 'object', 'Bad key.');
    assert(typeof json.key.xpubkey === 'string', 'Bad key xpub.');

    const authPubKey = Buffer.from(json.authPubKey, 'hex');
    const joinSignature = Buffer.from(json.joinSignature, 'hex');
    const key = HDPublicKey.fromJSON(json.key, network);

    assert(authPubKey.length === 33, 'Bad authPubKey length.');
    assert(secp256k1.publicKeyVerify(authPubKey), 'Bad authPubKey.');
    assert(joinSignature.length === 65, 'Bad joinSignature length.');

    this.id = json.id;
    this.name = json.name;
    this.authPubKey = authPubKey;
    this.joinSignature = joinSignature;
    this.key = key;

    if (!details)
      return this;

    assert((json.tokenDepth >>> 0) === json.tokenDepth,
      'tokenDepth must be an u32.');
    this.tokenDepth = json.tokenDepth;

    assert(typeof json.data === 'string', 'data must be a hex string.');

    const data = Buffer.from(json.data, 'hex');

    assert(data.length <= 100, 'Bad data length.');
    this.data = data;

    const token = Buffer.from(json.token, 'hex');

    assert(token.length === 32, 'token must be 32 bytes long.');
    this.token = token;

    return this;
  }

  /**
   * Calculate serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 0;
    size += 1;  // id
    size += 4;  // tokenDepth
    size += 32; // token
    size += 1;  // name length
    size += this.name.length; // name
    size += 4;  // purpose
    size += 4;  // fingerPrint
    size += 1;  // data length
    size += this.data.length; // data
    size += 82; // key size
    size += 33; // authPubKey
    size += 65; // joinSignature

    return size;
  }

  /**
   * Serialize to reader
   * @override
   * @param {bufio.BufferWriter} bw
   * @param {bcoin.Network} network
   * @returns {bufio.BufferWriter}
   */

  write(bw, network) {
    bw.writeU8(this.id);
    bw.writeU32(this.tokenDepth);
    bw.writeBytes(this.token);
    bw.writeU8(this.name.length);
    bw.writeString(this.name, 'latin1');
    bw.writeU32BE(this.purpose);
    bw.writeU32BE(this.fingerPrint);
    bw.writeU8(this.data.length);
    bw.writeBytes(this.data);

    // this.key.toWriter(bw, network) -- will cause hash256 digest
    // to be calculated for whole cosigner buffer.
    bw.writeBytes(this.key.toRaw(network));
    bw.writeBytes(this.authPubKey);
    bw.writeBytes(this.joinSignature);

    return bw;
  }

  /**
   * Deserialize from reader
   * @override
   * @param {bufio.BufferReader} br
   * @param {bcoin.Network} network
   * @returns {Cosigner}
   */

  read(br, network) {
    this.id = br.readU8();
    this.tokenDepth = br.readU32();
    this.token = br.readBytes(32);

    const nameSize = br.readU8();
    this.name = br.readBytes(nameSize).toString('utf8');

    this.purpose = br.readU32BE();
    this.fingerPrint = br.readU32BE();

    const dataLength = br.readU8();
    this.data = br.readBytes(dataLength);

    const key = br.readBytes(this.key.getSize());
    this.key = HDPublicKey.fromRaw(key, network);

    this.authPubKey = br.readBytes(33);
    this.joinSignature = br.readBytes(65);

    return this;
  }

  /**
   * Check cosigner equality
   * @param {Cosigner} cosigner
   * @param {Boolean} details
   * @returns {Boolean}
   */

  equals(cosigner, details = false) {
    if (!details)
      return this.id === cosigner.id
        && this.name === cosigner.name
        && this.authPubKey.equals(cosigner.authPubKey)
        && this.joinSignature.equals(cosigner.joinSignature)
        && this.key.equals(cosigner.key);

    return this.id === cosigner.id
      && this.name === cosigner.name
      && this.purpose === cosigner.purpose
      && this.fingerPrint === cosigner.fingerPrint
      && this.data.equals(cosigner.data)
      && this.tokenDepth === cosigner.tokenDepth
      && this.token.equals(cosigner.token)
      && this.authPubKey.equals(cosigner.authPubKey)
      && this.joinSignature.equals(cosigner.joinSignature)
      && this.key.equals(cosigner.key);
  }

  /**
   * Inject properties from cosigner
   * @param {Cosigner} cosigner
   * @returns {Cosigner}
   */

  inject(cosigner) {
    this.id = cosigner.id;
    this.name = cosigner.name;
    this.purpose = cosigner.purpose;
    this.fingerPrint = cosigner.fingerPrint;
    this.tokenDepth = cosigner.tokenDepth;

    this.token = cosigner.token.slice();
    this.data = cosigner.data.slice();
    this.authPubKey = cosigner.authPubKey.slice();
    this.joinSignature = cosigner.joinSignature.slice();

    this.key = cloneHDPublicKey(cosigner.key);

    return this;
  }

  /**
   * Verify account key proof
   * @param {Buffer} signature
   * @param {String} id - walletName
   * @param {Network} [network=main]
   * @returns {Boolean}
   */

  verifyProof(signature, id, network) {
    assert(Buffer.isBuffer(signature), 'Signature must be a buffer.');
    assert(signature.length === 65, 'Signature must be 65 bytes long.');

    const proofKey = this.key.derive(sigUtils.PROOF_INDEX).derive(0);
    const hash = this.getJoinHash(id, network);

    return sigUtils.verifyHash(hash, signature, proofKey.publicKey);
  }

  /**
   * Verify join signature
   * @param {Buffer} joinPubKey
   * @param {String} id - wallet id
   * @returns {Boolean}
   */

  verifyJoinSignature(joinPubKey, id, network) {
    assert(Buffer.isBuffer(joinPubKey), 'joinPubKey must be a buffer.');
    assert(joinPubKey.length === 33, 'joinPubKey must be 33 bytes long.');

    const hash = this.getJoinHash(id, network);

    return sigUtils.verifyHash(hash, this.joinSignature, joinPubKey);
  }

  /**
   * Get join message hash
   * @param {String} id - wallet id
   * @returns {Buffer}
   */

  getJoinHash(id, network) {
    assert(typeof id === 'string', 'walletName must be a string.');

    return sigUtils.getJoinHash(id, this, network);
  }

  /**
   * Derive pubkey for cosigner
   * @param {Number} branch
   * @param {Number} index
   * @returns {Buffer} - Public key
   */

  deriveKey(branch, index) {
    assert(this.key);

    return this.key.derive(branch).derive(index);
  }

  /**
   * Test whether an object is a Cosigner.
   * @param {Object} obj
   * @returns {Boolean}
   */

  static isCosigner(obj) {
    return obj instanceof Cosigner;
  }
}

/**
 * @ignore
 * @param {HDPublicKey} key
 * @returns {HDPublicKey}
 */

function cloneHDPublicKey(key) {
  assert(HDPublicKey.isHDPublicKey(key));

  const ckey = new HDPublicKey();

  ckey.depth = key.depth;
  ckey.parentFingerPrint = key.parentFingerPrint;
  ckey.childIndex = key.childIndex;
  ckey.fingerPrint = key.fingerPrint;

  // clone buffers
  ckey.chainCode = key.chainCode.slice();
  ckey.publicKey = key.publicKey.slice();

  return ckey;
}

module.exports = Cosigner;
