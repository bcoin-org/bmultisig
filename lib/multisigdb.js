/*!
 * multisigdb.js - Storage for multisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const path = require('path');
const EventEmitter = require('events');
const Logger = require('blgr');
const bdb = require('bdb');
const {Lock, MapLock} = require('bmutex');
const bcoin = require('bcoin');
const {wallet, Network} = bcoin;
const {Account} = wallet;

const MultisigWallet = require('./wallet');
const layout = require('./layout').msdb;

/**
 * MultisigDB
 * @alias module:multisig.MultisigDB
 * @extends EventEmitter
 * @property {MultisigDBOptions} options
 * @property {bcoin.Network} network
 * @property {blgr.Logger} logger
 * @property {NodeClient} client
 * @property {bdb.DB} db
 * @property {Map<string, MultisigWallet>} Map - map of loaded wallets.
 * @property {bmutex.MapLock} readLock - wallet specific lock.
 * @property {bmutex.Lock} writeLock - lock for atomic writes.
 */

class MultisigDB extends EventEmitter {
  constructor(options) {
    super();

    this.options = new MultisigDBOptions(options);

    this.client = this.options.client;
    this.logger = this.options.logger.context('multisig-db');
    this.network  = this.options.network;
    this.db = bdb.create(this.options);

    this.wallets = new Map();

    // wallet specific lock
    this.readLock = new MapLock();

    // write lock
    this.writeLock = new Lock();
  }

  /**
   * Listen for necessary events
   * @private
   */

  init() {
    this.client.on('error', (error) => {
      this.emit('error', error);
    });

    this.client.on('tx', async (wallet, tx, details) => {
      const wid = wallet.wid;
      const mswallet = await this.getWallet(wid);

      if (!mswallet)
        return;

      await mswallet.addTX(tx, details);
    });

    this.client.on('confirmed', async (wallet, tx, details) => {
      const wid = wallet.wid;
      const mswallet = await this.getWallet(wid);

      if (!mswallet)
        return;

      await mswallet.confirmedTX(tx, details);
    });

    this.client.on('remove tx', async (wallet, tx, details) => {
      const wid = wallet.wid;
      const mswallet = await this.getWallet(wid);

      if (!mswallet)
        return;

      await mswallet.removeTX(tx, details);
    });
  }

  /**
   * Open MultisigDB
   * @returns {Promise}
   */

  async open() {
    await this.db.open();

    await this.db.verify(layout.V.encode(), 'multisig', 0);
    await this.verifyNetwork();

    await this.client.open();

    this.logger.info('MultisigDB loaded.');
  }

  /**
   * Close MultisigDB
   * @returns {Promise}
   */

  async close() {
    for (const wallet of this.wallets.values()) {
      await wallet.destroy();
      this.unregister(wallet);
    }

    await this.db.close();
    await this.client.close();
  }

  /**
   * Verify network.
   * @returns {Promise}
   */

  async verifyNetwork() {
    const raw = await this.db.get(layout.O.encode());

    if (!raw) {
      this.logger.debug('Creating MultisigDB.');

      const b = this.db.batch();
      b.put(layout.O.encode(), fromU32(this.network.magic));
      return b.write();
    }

    const magic = raw.readUInt32LE(0, true);

    if (magic !== this.network.magic)
      throw new Error('Network mismatch for MultisigDB.');

    return undefined;
  }

  /**
   * Register an object with the multisigdb.
   * @param {Object} object
   */

  register(wallet) {
    assert(!this.wallets.has(wallet.wid),
      'wallet is already registered.'
    );
    this.wallets.set(wallet.wid, wallet);
  }

  /**
   * Unregister a object with the multisigdb.
   * @param {Object} object
   * @returns {Boolean}
   */

  unregister(wallet) {
    assert(this.wallets.has(wallet.wid),
      'wallet is not registered.'
    );
    this.wallets.delete(wallet.wid);
  }

  /**
   * Create multisig wallet
   * @async
   * @param {Object} options
   * @param {Number} options.n
   * @param {Number} options.m
   * @param {Boolean} options.witness
   * @param {String} options.id
   * @param {Cosigner} cosigner
   * @returns {Promise<MultisigWallet>} multisig wallet info
   */

  async create(options, cosigner) {
    const unlock = await this.writeLock.lock();

    try {
      return await this._create(options, cosigner);
    } finally {
      unlock();
    }
  }

  /**
   * Create multisig wallet (without lock)
   * @async
   * @param {Object} options {@link MultisigDB#create}
   * @param {Cosigner} cosigner
   * @returns {Promise<MultisigWallet>}
   */

  async _create(options, cosigner) {
    assert(options.id, 'walletName must be a string.');

    const walletOptions = {
      m: options.m,
      n: options.n,
      witness: options.witness,
      id: options.id,
      accountKey: cosigner.key,
      watchOnly: true,
      type: Account.types.MULTISIG
    };

    // validate
    const mswallet = MultisigWallet.fromOptions(this, options);
    mswallet.addCosigner(cosigner);

    const wallet = await this.client.create(walletOptions);
    mswallet.fromWalletOptions(wallet);

    const b = this.db.batch();
    MultisigWallet.save(b, mswallet);
    await b.write();

    this.logger.info('Created wallet %s/%d, cosigner: %s',
      mswallet.id,
      mswallet.wid,
      mswallet.cosigners[0].name
    );

    await mswallet.open();
    this.register(mswallet);

    return mswallet;
  }

  /**
   * Remove multisig wallet
   * @async
   * @param {Number|String} id
   * @returns {Promise<Boolean>}
   */

  async remove(id) {
    const wid = await this.ensureWID(id);

    if (wid === -1)
      return false;

    const unlock1 = await this.readLock.lock(wid);
    const unlock2 = await this.writeLock.lock();

    try {
      return await this._remove(wid);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Remove multisig wallet (without lock)
   * @param {Number} wid
   * @returns {Promise<Boolean>}
   */

  async _remove(wid) {
    const id = await this.getID(wid);

    if (!id)
      return false;

    const removed = await this.client.remove(wid);
    assert(removed, 'Could not remove wallet from WDB');

    const b = this.db.batch();
    MultisigWallet.remove(b, wid, id);
    await b.write();

    const wallet = this.wallets.get(wid);

    if (wallet) {
      await wallet.destroy();
      this.unregister(wallet);
    }

    return true;
  }

  /**
   * Cosigner joins wallet
   * @param {Number|String} id
   * @param {Cosigner} cosigner {@link Cosigner#constructor}
   * @returns {Promise<MultisigWallet>}
   */

  async join(id, cosigner) {
    const wid = await this.ensureWID(id);

    if (wid === -1)
      return null;

    const unlock1 = await this.readLock.lock(wid);
    const unlock2 = await this.writeLock.lock();

    try {
      return await this._join(wid, cosigner);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Join cosigner to wallet
   * @param {Number} wid
   * @param {Cosigner} cosigner
   * @returns {Promise<MultisigWallet>}
   */

  async _join(wid, cosigner) {
    const mswallet = await this._getWallet(wid);

    if (!mswallet)
      throw new Error('Multisig Wallet not found.');

    mswallet.addCosigner(cosigner);

    const wallet = mswallet.wallet;

    try {
      const res = await wallet.addSharedKey(0, cosigner.key);
      if (!res) {
        throw new Error('Can not add duplicate keys.');
      }
    } catch (e) {
      mswallet.popCosigner();
      throw e;
    }

    const b = this.db.batch();
    MultisigWallet.save(b, mswallet);
    await b.write();

    mswallet.emit('join', cosigner);
    this.emit('join', mswallet, cosigner);

    return mswallet;
  }

  /**
   * Save multisig wallet
   * @param {MultisigWallet} mswallet
   * @returns {Promise<MultisigWallet>}
   */

  async save(mswallet) {
    const unlock1 = await this.readLock.lock(mswallet.wid);
    const unlock2 = await this.writeLock.lock();

    try {
      return await this._save(mswallet);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Save multisig wallet without lock
   * @param {MultisigWallet} mswallet
   * @returns {Promise<MultisigWallet>}
   */

  async _save(mswallet) {
    const b = this.db.batch();
    MultisigWallet.save(b, mswallet);
    await b.write();

    return mswallet;
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
   * Get wallet (with lock)
   * First retrieve wallet from WDB then look up
   * in local db with returned WID.
   * @async
   * @param {Number|String} id
   * @returns {Promise<MultisigWallet>}
   */

  async getWallet(id) {
    const wid = await this.ensureWID(id);

    if (wid === -1)
      return null;

    const unlock = await this.readLock.lock(wid);

    try {
      return await this._getWallet(wid);
    } finally {
      unlock();
    }
  }

  /**
   * Get wallet (without lock)
   * @async
   * @private
   * @param {Number} wid
   */

  async _getWallet(wid) {
    const cache = this.wallets.get(wid);

    if (cache)
      return cache;

    const wallet = await this.client.getWallet(wid);

    assert(wallet, 'Wallet mismatch, WDB wallet not found');

    const data = await this.db.get(layout.w.encode(wallet.wid));
    assert(data, 'Multisig wallet not found');

    const mswallet = MultisigWallet.fromRaw(this, data);
    mswallet.fromWalletOptions(wallet);

    await mswallet.open();

    this.register(mswallet);

    return mswallet;
  }

  /**
   * Map wallet id to wid.
   * @param {String|Number} id
   * @returns {Promise} - Returns {Number}.
   */

  async ensureWID(id) {
    if (typeof id === 'number') {
      if (!await this.db.has(layout.W.encode(id)))
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
    const data = await this.db.get(layout.l.encode(id));

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
    const data = await this.db.get(layout.W.encode(wid));

    if (!data)
      return null;

    return toString(data);
  }

  /**
   * Send transaction
   * @async
   * @param {MTX} mtx
   * @returns {Promise}
   */

  send(mtx) {
    return this.client.send(mtx);
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
  data.writeUInt32LE(num, 0);
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
