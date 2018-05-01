/*!
 * walletnullclient.js - Wallet Node Client
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
   */

  constructor() {
    super();

    this.opened = false;
    this.init();
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

  async create(options) {
    ;
  }

  /**
   * Delete wallet
   * @param {Number|String} id
   * @returns {Promise<Boolean>}
   * @throws {Error}
   */

  async remove(id) {
    return false;
  }

  /**
   * Get Wallet
   * @param {Number|String} id
   * @returns {Promise<Wallet>}
   * @throws {Error}
   */

  async getWallet(id) {
    ;
  }

  /**
   * Get list of wallets
   * @returns {Promise<String[]>}
   */

  async getWallets() {
    return [];
  }

  /**
   * @async
   * @param {MTX} mtx
   * @returns {Promise}
   */

  async send(mtx) {
    ;
  }
}

/*
 * Expose
 */

module.exports = WalletNodeClient;
