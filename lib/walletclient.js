/*!
 * walletclient.js - Wallet Node Client
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const EventEmitter = require('events');

/**
 * Wallet node client
 */

class WalletNodeClient extends EventEmitter {
  /**
   * Create wallet node client
   * @constructor
   * @param {bcoin.wallet.WalletNode} node
   */

  constructor(node) {
    super();

    this.node = node;
    this.wdb = node.wdb;

    this.opened = false;
  }

  /**
   * Setup event listeners
   * @private
   */

  init() {}

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

  get(id) {
    return this.wdb.get(id);
  }

  /**
   * Get list of wallets
   * @returns {Promise<String[]>}
   */

  async getWallets() {
    return this.wdb.getWallets();
  }
}

/*
 * Expose
 */

module.exports = WalletNodeClient;
