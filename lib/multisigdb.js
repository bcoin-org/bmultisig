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
const {Lock, MapLock} = require('bmutex');
const bcoin = require('bcoin');
const {wallet, Network} = bcoin;
const {Account} = wallet;

const MultisigWallet = require('./wallet');
const Cosigner = require('./cosigner');
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

    // wallet specific lock
    this.readLock = new MapLock();

    // write lock
    this.writeLock = new Lock();
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

  /**
   * Dump db (debug)
   */

  dump() {
    return this.db.dump();
  }

  /**
   * Create multisig wallet
   * @async
   * @param {Object} options
   * @param {Number} options.n
   * @param {Number} options.m
   * @param {Boolean} options.witness
   * @param {String} options.id
   * @param {String} options.xpub
   * @returns {Promise<MultisigWallet>} multisig wallet info
   */

  async create(options) {
    const unlock = await this.writeLock.lock();

    try {
      return await this._create(options);
    } finally {
      unlock();
    }
  }

  /**
   * Create multisig wallet (without lock)
   * @async
   * @param {Object} options {@link MultisigDB#create}
   * @returns {Promise<MultisigWallet>}
   */

  async _create(options) {
    const walletOptions = {
      m: options.m,
      n: options.n,
      witness: options.witness,
      id: options.id,
      accountKey: options.xpub,

      name: 'multisig',
      watchOnly: true,
      type: Account.types.MULTISIG
    };

    const cosignerOptions = {
      name: options.cosignerName,
      path: options.cosignerPath,
      id: 0
    };

    // validate
    const mWallet = MultisigWallet.fromOptions(this, options);
    const cosigner = Cosigner.fromOptions(this, cosignerOptions);

    const wallet = await this.client.create(walletOptions);

    mWallet.fromWalletOptions(wallet);

    const batch = this.db.batch();

    await mWallet.init(batch, cosigner);
    await batch.write();

    return mWallet;
  }

  /**
   * Get available multisig wallets
   * @async
   * @returns {Promise<String[]>}
   */

  async getWallets() {
    return this.db.values({
      gte: layout.W.min(),
      lte: layout.W.max(),
      parse: toString
    });
  }

  /**
   * @async
   * @param {Number|String} id
   * @returns {Promise<MultisigWallet>}
   */

  async get(id) {
    const wid = await this.ensureWID(id);

    if (wid === -1)
      return null;

    const unlock = await this.readLock.lock(wid);

    try {
      return this._get(id);
    } finally {
      unlock();
    }
  }

  async _get(wid) {
    const wallet = await this.client.get(wid);

    const data = await this.db.get(layout.w.build(wallet.wid));
    assert(data);

    const mWallet = MultisigWallet.fromRaw(this, data);
    mWallet.fromWalletOptions(wallet);

    return mWallet;
  }

  /**
   * Map wallet id to wid.
   * @param {String|Number} id
   * @returns {Promise} - Returns {Number}.
   */

  async ensureWID(id) {
    if (typeof id === 'number') {
      if (!await this.db.has(layout.W.build(id)))
        return -1;
      return id;
    }

    return this.getWID(id);
  }

  /**
   * Map wallet id to wid.
   * @param {String} id
   * @returns {Promise} - Returns {Number}.
   */

  async getWID(id) {
    const data = await this.db.get(layout.l.build(id));

    if (!data)
      return -1;

    assert(data.length === 4);

    return data.readUInt32LE(0, true);
  }

  /**
   * Map wallet wid to id.
   * @param {Number} wid
   * @returns {Promise} - Returns {String}.
   */

  async getID(wid) {
    const data = await this.db.get(layout.W.build(wid));

    if (!data)
      return null;

    return toString(data);
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

function toString(buf) {
  assert(buf.length > 0);
  assert(buf[0] === buf.length - 1);
  return buf.toString('ascii', 1, buf.length);
}

/*
 * Expose
 */
module.exports = MultisigDB;
