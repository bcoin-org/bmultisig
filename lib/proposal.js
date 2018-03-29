/*!
 * proposal.js - proposal object
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */
'use strict';

const assert = require('assert');
const bcoin = require('bcoin');
const {Struct} = require('bufio');
const {common} = bcoin.wallet;
const {TX} = bcoin;

/**
 * Payment proposal
 */

class Proposal extends Struct {
  /**
   * Create proposal
   * @param {String} options
   * @param {String} options.name
   * @param {String} [options.description='']
   * @param {TX} options.tx
   */

  constructor (options) {
    super();

    this.name = '';
    this.tx = null;

    this.approvals = [];
    this.rejections = [];

    this.fromOptions(options);
  }

  /**
   * validate options
   * @param {Object} options
   */

  fromOptions(options) {
    assert(options, 'Options are required.');
    assert(options.name, 'Name is required.');
    assert(common.isName(options.name), 'Bad proposal name.');
    assert(options.tx, 'TX is required.');
    assert(options.tx instanceof TX, 'tx must be instance of TX.');
  }

  /**
   * Get JSON
   * @returns {Object}
   */

  getJSON() {
    return {
      name: this.name,
      tx: this.tx.toRaw().toString('hex'),
      approvals: this.approvals.map(a => a.toJSON()),
      rejections: this.rejections.map(r => r.toJSON())
    };
  }

  /**
   * inspect
   * @returns {Object}
   */

  inspect() {
    return this;
  }

  /**
   * Get size
   * @returns {Number}
   */

  getSize() {
    return 0;
  }

  /**
   * Write raw representation to buffer writer.
   * @param {BufferWriter}  bw
   * @returns {Buffer}
   */

  write(bw) {
    return bw;
  }

  /**
   * Read raw proposal data
   * @param {BufferReader} br
   * @returns {Proposal}
   */

  read(br) {
    return this;
  }
}

module.exports = Proposal;
