/*!
 * client.js - Client for Multisig plugin
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const {WalletClient} = require('bclient');

class MultisigClient extends WalletClient {
  constructor(options) {
    super(options);

    this.path = '/multisig';
  }

  /**
   * Create multisig wallet
   * @param {String} id
   * @param {Object} options
   * @returns {Promise<Object>} walletInfo
   */

  createWallet(id, options) {
    return this.put(`/${id}`, options);
  }

  /**
   * Remove multisig wallet (Admin only)
   * @param {Number|String} id
   * @returns {Promise<Boolean>}
   */

  async removeWallet(id) {
    const removed = await this.del(`/${id}`);

    return removed.success;
  }

  /**
   * Get wallets
   * @returns {Promise<Object[]>} list of wallets
   */
  async getWallets() {
    const wallets = await this.get('/');

    return wallets.wallets;
  }

  /**
   * Get wallet
   * @param {String} id
   * @returns {Promise<MultisigWallet>}
   */

  getInfo(id) {
    return this.get(`/${id}`);
  }
}

module.exports = MultisigClient;
