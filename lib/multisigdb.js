/*!
 * multisigdb.js - Storage for multisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const path = require('path');
const EventEmitter = require('events');
const Logger = require('blgr');
const bdb = require('bdb');
const bcoin = require('bcoin');
const {Network} = bcoin;

const layout = require('./layout');

/**
 * MultisigDB
 * @extends EventEmitter
 */
class MultisigDB extends EventEmitter {
  constructor(options) {
    super();

    this.options = new MultisigDBOptions(options);

    this.client = this.options.client;
    this.logger = this.options.logger.context('multisig-db');
    this.network  = this.options.network;
    this.db = bdb.create(this.options);
  }

  async open() {
    await this.db.open();

    await this.db.verify(layout.V.build(), 'multisig', 0);
    await this.verifyNetwork();

    this.logger.info('MultisigDB loaded');
  }

  async close() {
    await this.db.close();
  }

  /**
   * Verify network.
   * @returns {Promise}
   */

  async verifyNetwork() {
    const raw = await this.db.get(layout.O.build());

    if (!raw) {
      const b = this.db.batch();
      b.put(layout.O.build(), fromU32(this.network.magic));
      return b.write();
    }

    const magic = raw.readUInt32LE(0, true);

    if (magic !== this.network.magic)
      throw new Error('Network mismatch for MultisigDB.');

    return undefined;
  }
}

class MultisigDBOptions {
  constructor(options) {
    this.network = Network.primary;
    this.logger = Logger.global;
    this.client = null;

    this.prefix = null;
    this.location = null;
    this.memory = true;
    this.compression = true;
    this.cacheSize = 8 << 20;
    this.maxFiles = 64;

    this.fromOptions(options);
  }

  fromOptions(options) {
    assert(options, 'Options are required.');
    assert(options.client, 'Client is required.');

    this.client = options.client;

    if (options.network != null)
      this.network = Network.get(options.network);

    if (options.logger != null) {
      assert(typeof options.logger === 'object');
      this.logger = options.logger;
    }

    if (options.prefix != null) {
      assert(typeof options.prefix === 'string');
      this.prefix = options.prefix;
      this.location = path.join(this.prefix, 'multisig');
    }

    if (options.location != null) {
      assert(typeof options.location === 'string');
      this.location = options.logger;
    }

    if (options.memory != null) {
      assert(typeof options.memory === 'boolean');
      this.memory = options.memory;
    }

    if (options.cacheSize != null) {
      assert(Number.isSafeInteger(options.cacheSize) && options.cacheSize >= 0);
      this.cacheSize = options.cacheSize;
    }

    if (options.compression != null) {
      assert(typeof options.compression === 'boolean');
      this.compression = options.compression;
    }
  }
}

/*
 * Helpers
 */

function fromU32(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(num, 0, true);
  return data;
}

/*
 * Expose
 */
module.exports = MultisigDB;
