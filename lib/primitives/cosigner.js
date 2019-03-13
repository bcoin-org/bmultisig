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

const NULL_TOKEN = Buffer.alloc(32);

/**
 * Cosigner for proposal
 * @alias module:primitives.Proposal
 * @extends {bufio#Struct}
 * @property {Number} id
 * @property {String} name
 * @property {String} path
 * @property {Number} tokenDepth
 * @property {Buffer} token
 */

class Cosigner extends Struct {
  /**
   * Create Cosigner object
   * @constructor
   * @param {Object} options - Options
   * @param {Number} options.id - index of the cosigner
   * @param {String} options.name - name of cosigner
   * @param {String?} options.path - bip32 path if user wants to store
   * @param {Number?} options.tokenDepth - depth of generated token (retoken)
   */

  constructor(options) {
    super();

    this.id = 0;
    this.name = '';
    this.path = '';
    this.tokenDepth = 0;
    this.token = NULL_TOKEN;
    this.key = null;

    if (options)
      this.fromOptions(options);
  }

  /**
   * Inject options to Cosigner
   * @param {Object} options
   * @returns {Cosigner}
   */

  fromOptions(options) {
    if (!options)
      return this;

    assert(common.isName(options.name), 'Bad cosigner name');
    assert(HDPublicKey.isHDPublicKey(options.key),
      'Account key is required.'
    );

    this.name = options.name;
    this.key = options.key;

    if (options.id != null) {
      assert(isU8(options.id), 'ID must be uint8.');
      this.id = options.id;
    }

    if (options.path != null) {
      assert(typeof options.path === 'string', 'Path must be a string');
      this.path = options.path;
    }

    if (options.tokenDepth != null) {
      assert(isU32(options.tokenDepth), 'tokenDepth must be uint32');
      this.tokenDepth = options.tokenDepth;
    }

    if (options.token != null) {
      assert(Buffer.isBuffer(options.token), 'token must be buffer.');
      this.token = options.token;
    }

    return this;
  }

  inspect() {
    return this.toJSON(true);
  }

  toJSON(showDetails) {
    return this.getJSON(showDetails);
  }

  /**
   * Make serializable object from cosigner
   * @param {Boolean} showDetails
   * @returns {Object}
   */

  getJSON(showDetails) {
    if (!showDetails) {
      return {
        id: this.id,
        name: this.name
      };
    }

    return {
      id: this.id,
      name: this.name,
      path: this.path,
      tokenDepth: this.tokenDepth,
      token: this.token.toString('hex')
    };
  }

  /**
   * Inject properties from JSON object
   * @param {Object} json
   * @param {Boolean} details
   */

  fromJSON(json, details) {
    assert(isU8(json.id), 'id must be an u8.');
    assert(common.isName(json.name), 'Bad cosigner name.');

    this.id = json.id;
    this.name = json.name;

    if (!details)
      return this;

    assert(typeof json.path === 'string', 'path must be a string.');
    assert(isU32(json.tokenDepth), 'tokenDepth must be an u32.');

    let token = json.token;

    if (typeof token === 'string')
      token = Buffer.from(token, 'hex');

    assert(token.length === 32, 'token must be 32 bytes long.');

    this.tokenDepth = json.tokenDepth;
    this.token = token;
    this.path = json.path;

    return this;
  }

  /**
   * Calculate serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 1; // id
    size += 4; // tokenDepth
    size += 32; // token
    size += 1;
    size += this.name.length;
    size += 1;
    size += this.path.length;
    size += this.key.getSize();

    return size;
  }

  /**
   * Serialize to reader
   * @param {bufio#BufferWriter} bw
   * @param {Network} network
   * @returns {BufferWriter}
   */

  write(bw, network) {
    bw.writeU8(this.id);
    bw.writeU32(this.tokenDepth);
    bw.writeBytes(this.token);
    bw.writeU8(this.name.length);
    bw.writeBytes(Buffer.from(this.name, 'utf8'));
    bw.writeU8(this.path.length);
    bw.writeBytes(Buffer.from(this.path, 'utf8'));

    // this.key.toWriter(bw, network) -- will cause hash256 digest
    // to be calculated for whole cosigner buffer.
    bw.writeBytes(this.key.toRaw(network));

    return bw;
  }

  /**
   * Deserialize from reader
   * @param {bufio#BufferReader} br
   * @param {Network} network
   * @returns {Cosigner}
   */

  read(br, network) {
    this.id = br.readU8();
    this.tokenDepth = br.readU32();
    this.token = br.readBytes(32);

    const nameSize = br.readU8();
    this.name = br.readBytes(nameSize).toString('utf8');

    const pathSize = br.readU8();
    this.path = br.readBytes(pathSize).toString('utf8');

    // HDPublicKey size is 82.
    const key = br.readBytes(82);
    this.key = HDPublicKey.fromRaw(key, network);

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
      return this.id === cosigner.id && this.name === cosigner.name;

    return this.id === cosigner.id
      && this.name === cosigner.name
      && this.path === cosigner.path
      && this.tokenDepth === cosigner.tokenDepth
      && this.token.equals(cosigner.token);
  }

  /**
   * Derive pubkey for cosigner
   * @param {branch} branch
   * @param {index} index
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

function isU32(value) {
  return (value >>> 0) === value;
}

function isU8(value) {
  return (value & 0xff) === value;
}

module.exports = Cosigner;
