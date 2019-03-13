/*!
 * walletclient.js - Wallet Node Client
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const AsyncEmitter = require('bevent');

/**
 * Wallet node client
 * @alias module:multisig/plugin.WalletNodeClient
 * @property {bcoin.WalletNode} node
 * @property {bcoin.wallet.WalletDB} wdb
 * @property {Boolean} opened
 */

class WalletNodeClient extends AsyncEmitter {
  /**
   * Create wallet node client
   * @constructor
   * @param {bcoin.WalletNode} node
   */

  constructor(node) {
    super();

    this.node = node;
    this.wdb = node.wdb;

    this.opened = false;

    this.init();
  }

  /**
   * Setup event listeners
   * @private
   */

  init() {
    this.wdb.on('tx', (wallet, tx, details) => {
      if (!this.opened)
        return;

      this.emitAsync('tx', wallet, tx, details);
    });

    this.wdb.on('confirmed', (wallet, tx, details) => {
      if (!this.opened)
        return;

      this.emitAsync('confirmed', wallet, tx, details);
    });

    this.wdb.on('remove tx', (wallet, tx, details) => {
      if (!this.opened)
        return;

      this.emitAsync('remove tx', wallet, tx, details);
    });

    this.wdb.on('unconfirmed', (wallet, tx, details) => {
      if (!this.opened)
        return;

      this.emitAsync('unconfirmed', wallet, tx, details);
    });
  }

  /**
   * Open connection to wallet node
   * @returns {Promise}
   */

  async open() {
    assert(!this.opened, 'WalletNodeClient is already open.');
    this.opened = true;
    this.emit('connect');
  }

  /**
   * Close connection to wallet node
   * @returns {Promise}
   */

  async close() {
    assert(this.opened, 'WalletNodeClient is not open.');
    this.opened = false;
    this.emit('disconnect');
  }

  /**
   * Create wallet
   * @param {Object} options
   * @returns {Promise<bcoin.Wallet>}
   * @throws {Error}
   */

  create(options) {
    return this.wdb.create(options);
  }

  /**
   * Delete wallet
   * @param {Number|String} id
   * @returns {Promise<Boolean>}
   * @throws {Error}
   */

  remove(id) {
    return this.wdb.remove(id);
  }

  /**
   * Get Wallet
   * @param {Number|String} id
   * @returns {Promise<Wallet>}
   * @throws {Error}
   */

  getWallet(id) {
    return this.wdb.get(id);
  }

  /**
   * Get list of wallets
   * @returns {Promise<String[]>}
   */

  async getWallets() {
    return this.wdb.getWallets();
  }

  /**
   * @async
   * @param {MTX} mtx
   * @returns {Promise}
   */

  async send(mtx) {
    return this.wdb.send(mtx);
  }
}

/*
 * Expose
 */

module.exports = WalletNodeClient;
