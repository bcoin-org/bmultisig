/*!
 * cosigner.js - Cosigner
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const bufio = require('bufio');
const common = require('bcoin').wallet.common;
const {encoding} = bufio;

class Cosigner {
  /**
   * Create Cosigner object
   * @constructor
   * @param {MultisigDB} msdb - open database connection
   * @param {Object} options - Options
   * @param {Number} options.id - index of the cosigner
   * @param {String} options.name - name of cosigner
   * @param {String?} options.path - bip32 path if user wants to store
   * @param {Number?} options.tokenDepth - depth of generated token (retoken)
   */

  constructor(msdb, options) {
    assert(msdb);

    this.msdb = msdb;
    this.network = this.msdb.network;

    this.id = 0;
    this.name = '';
    this.path = '';
    this.tokenDepth = 0;

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
    this.name = options.name;

    if (options.id != null) {
      assert(isU32(options.id), 'ID must be uint32.');
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

    return this;
  }

  /**
   * Create cosigner from options
   * @param {MultisigDB} msdb
   * @param {Options} options
   */

  static fromOptions(msdb, options) {
    return new this(msdb, options);
  }

  /**
   * Make serializable object from cosigner
   * @returns {Object}
   */

  toJSON() {
    return {
      name: this.name,
      path: this.path,
      tokenDepth: this.tokenDepth
    };
  }

  /**
   * Calculate serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 8; // id + tokenDepth
    size += encoding.sizeVarint(this.name.length);
    size += this.name.length;
    size += encoding.sizeVarint(this.path.length);
    size += this.path.length;

    return size;
  }

  /**
   * Serialize cosigner
   * @returns {Buffer}
   */

  toRaw() {
    const size = this.getSize();
    const sw = bufio.write(size);

    return this.toWriter(sw).render();
  }

  /**
   * Serialize to reader
   * @param {bufio.BufferWriter}
   * @returns {BufferWriter}
   */

  toWriter(bw) {
    bw.writeU32(this.id);
    bw.writeU32(this.tokenDepth);
    bw.writeVarBytes(Buffer.from(this.name, 'utf8'));
    bw.writeVarBytes(Buffer.from(this.path, 'utf8'));

    return bw;
  }

  /**
   * Deserialize and inject data into cosigner
   * @param {Buffer} data
   * @returns {Cosigner}
   */

  fromRaw(data) {
    const br = bufio.read(data);

    return this.fromReader(br);
  }

  /**
   * Deserialize from reader
   * @param {bufio.BufferReader} br
   * @returns {Cosigner}
   */

  fromReader(br) {
    this.id = br.readU32();
    this.tokenDepth = br.readU32();
    this.name = br.readVarBytes().toString('utf8');
    this.path = br.readVarBytes().toString('utf8');

    return this;
  }

  /**
   * Deserialize cosigner
   * @param {MultisigDB} msdb
   * @param {Buffer} data
   */

  static fromRaw(msdb, data) {
    return new this(msdb).fromRaw(data);
  }

  /**
   * Deserialize cosigner from reader
   * @param {MultisigDB} msdb
   * @param {BufferReader} br
   * @returns {Cosigner}
   */

  static fromReader(msdb, br) {
    return new this(msdb).fromReader(br);
  }
}

function isU32(value) {
  return (value >>> 0) === value;
}

module.exports = Cosigner;
