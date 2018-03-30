/*!
 * cosigner.js - Cosigner
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const bufio = require('bufio');
const common = require('bcoin').wallet.common;
const {Struct} = bufio;

const NULL_TOKEN = Buffer.alloc(32);

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

  /**
   * Make serializable object from cosigner
   * @param {Boolean} showToken
   * @returns {Object}
   */

  toJSON(showToken) {
    const token = showToken && this.token;

    return {
      name: this.name,
      path: this.path,
      tokenDepth: this.tokenDepth,
      token: token ? token.toString('hex') : null
    };
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

    return size;
  }

  /**
   * Serialize to reader
   * @param {bufio.BufferWriter}
   * @returns {BufferWriter}
   */

  write(bw) {
    bw.writeU8(this.id);
    bw.writeU32(this.tokenDepth);
    bw.writeBytes(this.token);
    bw.writeU8(this.name.length);
    bw.writeBytes(Buffer.from(this.name, 'utf8'));
    bw.writeU8(this.path.length);
    bw.writeBytes(Buffer.from(this.path, 'utf8'));

    return bw;
  }

  /**
   * Deserialize from reader
   * @param {bufio.BufferReader} br
   * @returns {Cosigner}
   */

  read(br) {
    this.id = br.readU8();
    this.tokenDepth = br.readU32();
    this.token = br.readBytes(32);

    const nameSize = br.readU8();
    this.name = br.readBytes(nameSize).toString('utf8');
    const pathSize = br.readU8();
    this.path = br.readBytes(pathSize).toString('utf8');

    return this;
  }
}

function isU32(value) {
  return (value >>> 0) === value;
}

function isU8(value) {
  return (value & 0xff) === value;
}

module.exports = Cosigner;
