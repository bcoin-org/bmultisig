/*!
 * client.js - Client for Multisig plugin
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const EventEmitter = require('events');
const {WalletClient} = require('bclient');

/**
 * Multisig wallet client
 * @extends {bcoin#WalletClient}
 */
class MultisigClient extends WalletClient {
  constructor(options) {
    super(options);

    this.path = '/multisig';
  }

  /**
   * Start listening to multisig wallet events
   * @private
   */

  init() {
  }

  /**
   * Open the client.
   * @returns {Promise}
   */

  async open() {
    await super.open();
    this.init();
  }

  /**
   * Create a multisig wallet object
   * @param {String} id
   * @param {String|Buffer} token
   * @returns {MultisigWallet}
   */

  wallet(id, token) {
    return new MultisigWallet(this, id, token);
  }

  /**
   * Rescan the chain (Admin only).
   * @param {Number} height
   * @returns {Promise}
   */

  rescan(height) {
    return this.post('/../rescan', { height });
  }

  /**
   * Resend pending transactions (Admin only).
   * @returns {Promise}
   */

  resend() {
    return this.post('/../resend');
  }

  /**
   * Backup the walletdb (Admin only).
   * @param {String} path
   * @returns {Promise}
   */

  backup(path) {
    return this.post('/../backup', { path });
  }

  /**
   * Get wallets (Admin only).
   * @returns {Promise<String[]>} list of wallets
   */

  async getWallets() {
    const wallets = await this.get('/');

    return wallets.wallets;
  }

  /**
   * Create multisig wallet
   * @param {String} id
   * @param {Object} options
   * @returns {Promise<MultisigWallet>} walletInfo
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

    if (!removed)
      return false;

    return removed.success;
  }

  /**
   * Join wallet
   * @param {String} id
   * @param {Object} cosignerOptions
   * @returns {Promise<MultisigWallet>}
   */

  join(id, cosignerOptions) {
    return this.post(`/${id}/join`, cosignerOptions);
  }

  /**
   * Get wallet transaction history.
   * @param {String} id
   * @returns {Promise}
   */

  getHistory(id) {
    return this.get(`/${id}/tx/history`);
  }

  /**
   * Get wallet coins
   * @param {String} id
   * @returns {Promise<Coin[]>}
   */

  getCoins(id) {
    return this.get(`/${id}/coin`);
  }

  /**
   * Get all unconfirmed transactions.
   * @param {String} id
   * @returns {Promise}
   */

  getPending(id) {
    return this.get(`${id}/tx/unconfirmed`);
  }

  /**
   * Get wallet balance
   * @param {String} id
   * @returns {Promise<bcoin#Balance>}
   */

  getBalance(id) {
    return this.get(`/${id}/balance`);
  }

  /**
   * Get last N wallet transactions.
   * @param {String} id
   * @param {Number} limit - Max number of transactions.
   * @returns {Promise}
   */

  getLast(id, limit) {
    return this.get(`/${id}/tx/last`, { limit });
  }

  /**
   * Get wallet transactions by timestamp range.
   * @param {String} id
   * @param {Object} options
   * @param {Number} options.start - Start time.
   * @param {Number} options.end - End time.
   * @param {Number?} options.limit - Max number of records.
   * @param {Boolean?} options.reverse - Reverse order.
   * @returns {Promise}
   */

  getRange(id, options) {
    return this.get(`/${id}/tx/range`, {
      start: options.start,
      end: options.end,
      limit: options.limit,
      reverse: options.reverse
    });
  }

  /**
   * Get transaction (only possible if the transaction
   * is available in the wallet history).
   * @param {String} id
   * @param {Hash} hash
   * @returns {Promise}
   */

  getTX(id, hash) {
    return this.get(`/${id}/tx/${hash}`);
  }

  /**
   * Get wallet blocks.
   * @param {String} id
   * @param {Number} height
   * @returns {Promise}
   */

  getBlocks(id) {
    return this.get(`/${id}/block`);
  }

  /**
   * Get wallet block.
   * @param {String} id
   * @param {Number} height
   * @returns {Promise}
   */

  getBlock(id, height) {
    return this.get(`/${id}/block/${height}`);
  }

  /**
   * Get unspent coin (only possible if the transaction
   * is available in the wallet history).
   * @param {String} id
   * @param {Hash} hash
   * @param {Number} index
   * @returns {Promise}
   */

  getCoin(id, hash, index) {
    return this.get(`/${id}/coin/${hash}/${index}`);
  }

  /**
   * @param {String} id
   * @param {Number} age - Age delta.
   * @returns {Promise}
   */

  zap(id, age) {
    return this.post(`/${id}/zap`, { age });
  }

  /**
   * Get the raw wallet JSON.
   * @param {String} id
   * @param {Boolean} details
   * @returns {Promise<MultisigWallet|null>}
   */

  getInfo(id, details) {
    return this.get(`/${id}`, { details });
  }

  /**
   * Create address.
   * @param {String} id
   * @returns {Promise}
   */

  createAddress(id) {
    return this.post(`/${id}/address`);
  }

  /**
   * Create change address.
   * @param {String} id
   * @returns {Promise}
   */

  createChange(id) {
    return this.post(`/${id}/change`);
  }

  /**
   * Create nested address.
   * @param {String} id
   * @returns {Promise}
   */

  createNested(id) {
    return this.post(`/${id}/nested`);
  }

  /**
   * Generate a new token.
   * @param {String} id
   * @returns {Promise}
   */

  retoken(id) {
    return this.post(`/${id}/retoken`);
  }

  /**
   * Resend wallet transactions.
   * @param {String} id
   * @returns {Promise}
   */

  resendWallet(id) {
    return this.post(`/${id}/resend`);
  }
}

/**
 * Multisig wallet instance
 * @extends {EventEmitter}
 */

class MultisigWallet extends EventEmitter {
  /**
   * Create a multisig wallet client.
   * @param {MultisigClient} parent
   * @param {String} id
   * @param {String} token
   */

  constructor(parent, id, token) {
    super();
    this.parent = parent;
    this.client = parent.clone();
    this.client.token = token;
    this.id = id;
    this.token = token;
  }

  /**
   * Open wallet.
   * @returns {Promise}
   */

  async open() {
  }

  /**
   * Remove multisig wallet (Admin only)
   * @returns {Promise<Boolean>}
   */

  removeWallet() {
    return this.client.removeWallet(this.id);
  }

  /**
   * Join wallet
   * @param {Object} cosignerOptions
   * @returns {Promise<MultisigWallet|null>}
   */

  join(cosignerOptions) {
    return this.client.join(this.id, cosignerOptions);
  }

  /**
   * Get wallet transaction history.
   * @returns {Promise}
   */

  getHistory() {
    return this.client.getHistory(this.id);
  }

  /**
   * Get wallet coins
   * @returns {Promise<Coin[]>}
   */

  getCoins() {
    return this.client.getCoins(this.id);
  }

  /**
   * Get all unconfirmed transactions.
   * @returns {Promise}
   */

  getPending() {
    return this.client.getPending(this.id);
  }

  /**
   * Get wallet balance
   * @returns {Promise<bcoin#Balance>}
   */

  getBalance() {
    return this.client.getBalance(this.id);
  }

  /**
   * Get last N wallet transactions.
   * @param {Number} limit - Max number of transactions.
   * @returns {Promise}
   */

  getLast(limit) {
    return this.client.getLast(this.id, limit);
  }

  /**
   * Get wallet transactions by timestamp range.
   * @param {Object} options
   * @param {Number} options.start - Start time.
   * @param {Number} options.end - End time.
   * @param {Number?} options.limit - Max number of records.
   * @param {Boolean?} options.reverse - Reverse order.
   * @returns {Promise}
   */

  getRange(options) {
    return this.client.getRange(this.id, options);
  }

  /**
   * Get transaction (only possible if the transaction
   * is available in the wallet history).
   * @param {Hash} hash
   * @returns {Promise}
   */

  getTX(hash) {
    return this.client.getTX(this.id, hash);
  }

  /**
   * Get wallet blocks.
   * @param {Number} height
   * @returns {Promise}
   */

  getBlocks() {
    return this.client.getBlocks(this.id);
  }

  /**
   * Get wallet block.
   * @param {Number} height
   * @returns {Promise}
   */

  getBlock(height) {
    return this.client.getBlock(this.id, height);
  }

  /**
   * Get unspent coin (only possible if the transaction
   * is available in the wallet history).
   * @param {Hash} hash
   * @param {Number} index
   * @returns {Promise}
   */

  getCoin(hash, index) {
    return this.client.getCoin(this.id, hash, index);
  }

  /**
   * @param {Number} now - Current time.
   * @param {Number} age - Age delta.
   * @returns {Promise}
   */

  zap(age) {
    return this.client.zap(this.id, age);
  }

  /**
   * Get the raw wallet JSON.
   * @param {Boolean} details
   * @returns {Promise}
   */

  getInfo(details) {
    return this.client.getInfo(this.id, details);
  }

  /**
   * Create address.
   * @returns {Promise}
   */

  createAddress() {
    return this.client.createAddress(this.id);
  }

  /**
   * Create change address.
   * @returns {Promise}
   */

  createChange() {
    return this.client.createChange(this.id);
  }

  /**
   * Create nested address.
   * @returns {Promise}
   */

  createNested() {
    return this.client.createNested(this.id);
  }

  /**
   * Generate a new token.
   * @returns {Promise}
   */

  retoken() {
    return this.client.retoken(this.id);
  }

  /**
   * Resend wallet transactions.
   * @returns {Promise}
   */

  resendWallet() {
    return this.client.resendWallet(this.id);
  }
}

module.exports = MultisigClient;
