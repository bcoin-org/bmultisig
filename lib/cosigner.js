/*!
 * cosigner.js - Cosigner
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const bufio = require('bufio');
const {encoding} = bufio;

class Cosigner {
  /**
   * Create Cosigner object
   * @constructor
   * @param {MultisigDB} msdb - open database connection
   * @param {Object} options - Options
   * @param {Number} options.id - index of the cosigner
   * @param {String} options.name - name of cosigner
   * @param {Number} options.xpubIndex - index of XPUB in wallet
   * @param {String?} options.path - bip32 path if user wants to store
   */

  constructor(msdb, options) {
    assert(msdb);

    this.msdb = msdb;
    this.db = this.msdb.db;
    this.network = this.msdb.network;

    this.id = 0;
    this.name = '';
    this.xpubIndex = 0;
    this.path = '';

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

    if (options.name != null) {
      assert(typeof options.name === 'string', 'Name must be a string.');
      this.name = options.name;
    }

    if (options.id != null) {
      assert(isU32(options.id), 'ID must be uint32.');
      this.id = options.id;
    }

    if (options.xpubIndex != null) {
      assert(isU32(options.xpubIndex, 'xpubIndex must be uint32.'));
      this.xpubIndex = options.xpubIndex;
    }

    if (options.path != null) {
      assert(typeof options.path === 'string', 'Path must be a string');
      this.path = options.path;
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
   * Calculate serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 8; // xpubIndex + id
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

    sw.writeU32(this.id);
    sw.writeU32(this.xpubIndex);
    sw.writeVarBytes(Buffer.from(this.name, 'utf8'));
    sw.writeVarBytes(Buffer.from(this.path, 'utf8'));

    return sw.render();
  }

  /**
   * Deserialize and inject data into cosigner
   * @param {Buffer} data
   * @returns {Cosigner}
   */

  fromRaw(data) {
    const br = bufio.read(data);

    this.id = br.readU32();
    this.xpubIndex = br.readU32();
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
}

function isU32(value) {
  return (value >>> 0) === value;
}

module.exports = Cosigner;
