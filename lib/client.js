/*!
 * client.js - Client for Multisig plugin
 * Copyright (c) 2017-2018, Christopher Jeffrey (MIT License).
 * Copyright (c) 2019, Nodari Chkuaselidze (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

'use strict';

const assert = require('bsert');
const EventEmitter = require('events');
const {WalletClient} = require('bclient');

/**
 * Hex encoded buffer.
 * @typedef {String} HexString
 */

/**
 * Multisig wallet client
 * @extends {bcoin#WalletClient}
 */
class MultisigClient extends WalletClient {
  /**
   * Create multisig client.
   * @param {Object} options - Wallet Client options
   */
  constructor(options) {
    super(options);
  }

  /**
   * Start listening to multisig wallet events
   * @private
   */

  init() {
    this.bind('join', (id, cosigner) => {
      this.dispatch(id, 'join', cosigner);
    });

    this.bind('proposal created', (id, details) => {
      this.dispatch(id, 'proposal created', details);
    });

    this.bind('proposal rejected', (id, details) => {
      this.dispatch(id, 'proposal rejected', details);
    });

    this.bind('proposal approved', (id, details) => {
      this.dispatch(id, 'proposal approved', details);
    });
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
   * Join a wallet.
   * @param {String} id - wallet id
   * @param {Buffer} token - cosigner token
   * @return {Promise}
   */

  join(id, token) {
    return this.call('ms-join', id, token);
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
   * Get wallets (Admin only).
   * @returns {Promise<String[]>} list of wallets
   */

  async getWallets() {
    const wallets = await this.get('/multisig');

    // returns null when not configured properly
    if (!wallets)
      return wallets;

    return wallets.wallets;
  }

  /**
   * Create multisig wallet
   * @param {String} id
   * @param {Object} options
   * @returns {Promise<MultisigWallet>} walletInfo
   */

  createWallet(id, options) {
    return this.put(`/multisig/${id}`, options);
  }

  /**
   * Remove multisig wallet (Admin only)
   * @param {Number|String} id
   * @returns {Promise<Boolean>}
   */

  async removeWallet(id) {
    const removed = await this.del(`/multisig/${id}`);

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

  joinWallet(id, cosignerOptions) {
    return this.post(`/multisig/${id}/join`, cosignerOptions);
  }

  /**
   * Get wallet transaction history.
   * @param {String} id
   * @returns {Promise}
   */

  getHistory(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.get(`/multisig/${id}/tx/history`);
  }

  /**
   * Get wallet coins
   * @param {String} id
   * @returns {Promise<Coin[]>}
   */

  getCoins(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.get(`/multisig/${id}/coin`);
  }

  /**
   * Get all unconfirmed transactions.
   * @param {String} id
   * @returns {Promise}
   */

  getPending(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.get(`/multisig/${id}/tx/unconfirmed`);
  }

  /**
   * Get wallet balance
   * @param {String} id
   * @returns {Promise<bcoin#Balance>}
   */

  getBalance(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.get(`/multisig/${id}/balance`);
  }

  /**
   * Get last N wallet transactions.
   * @param {String} id
   * @param {String} account
   * @param {Number} limit - Max number of transactions.
   * @returns {Promise}
   */

  getLast(id, account = 'default', limit) {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.get(`/multisig/${id}/tx/last`, { limit });
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

  getRange(id, account = 'default', options) {
    assert(account === 'default',
      'Only default account available for multisig wallets.');

    return this.get(`/multisig/${id}/tx/range`, {
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
    return this.get(`/multisig/${id}/tx/${hash}`);
  }

  /**
   * Get wallet blocks.
   * @param {String} id
   * @param {Number} height
   * @returns {Promise}
   */

  getBlocks(id) {
    return this.get(`/multisig/${id}/block`);
  }

  /**
   * Get wallet block.
   * @param {String} id
   * @param {Number} height
   * @returns {Promise}
   */

  getBlock(id, height) {
    return this.get(`/multisig/${id}/block/${height}`);
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
    return this.get(`/multisig/${id}/coin/${hash}/${index}`);
  }

  /**
   * @param {String} id
   * @param {Number} age - Age delta.
   * @returns {Promise}
   */

  zap(id, account = 'default', age) {
    assert(account === 'default',
      'Only default account available for multisig wallets.');

    return this.post(`/multisig/${id}/zap`, { age });
  }

  /**
   * Create wallet transaction
   * @param {String} id
   * @param {Object} options - transaction options
   * @returns {Promise<TX>}
   */

  createTX(id, options) {
    return this.post(`/multisig/${id}/create`, options);
  }

  /**
   * Create a transaction, fill, sign, and broadcast.
   * @param {Object} options
   * @param {String} options.address
   * @param {Amount} options.value
   * @returns {Promise}
   */

  send(id, options) {
    throw new Error('Cant use method "send" on multisig wallet.');
  }

  /**
   * Sign a transaction.
   * @param {Object} options
   * @returns {Promise}
   */

  sign(id, options) {
    throw new Error('Cant use method "sign" on multisig wallet.');
  }

  /**
   * Get the raw wallet JSON.
   * @param {String} id
   * @returns {Promise<MultisigWallet|null>}
   */

  getInfo(id) {
    return this.get(`/multisig/${id}`);
  }

  /**
   * Get wallet accounts.
   * @returns {Promise} - Returns Array.
   */

  async getAccounts(id) {
    return ['default'];
  }

  /**
   * Get wallet master key.
   * @returns {Promise}
   */

  getMaster(id) {
    throw new Error('Cant use method "getMaster" on multisig wallet.');
  }

  /**
   * Get wallet account.
   * @param {String} account
   * @returns {Promise}
   */

  async getAccount(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');

    return this.get(`/multisig/${id}/account/${account}`);
  }

  /**
   * Create account.
   * @param {String} name
   * @param {Object} options
   * @returns {Promise}
   */

  createAccount(id, name, options) {
    throw new Error('Cant use method "createAccount" on multisig wallet.');
  }

  /**
   * Create address.
   * @param {String} id
   * @returns {Promise}
   */

  createAddress(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.post(`/multisig/${id}/address`);
  }

  /**
   * Create change address.
   * @param {String} id
   * @returns {Promise}
   */

  createChange(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.post(`/multisig/${id}/change`);
  }

  /**
   * Create nested address.
   * @param {String} id
   * @returns {Promise}
   */

  createNested(id, account = 'default') {
    assert(account === 'default',
      'Only default account available for multisig wallets.');
    return this.post(`/multisig/${id}/nested`);
  }

  /**
   * Generate a new token.
   * @deprecated
   * @param {String} id
   * @returns {Promise}
   */

  retoken(id) {
    return this.post(`/multisig/${id}/retoken`);
  }

  /**
   * Import private key.
   * @param {Number|String} account
   * @param {String} key
   * @returns {Promise}
   */

  importPrivate(id, account, privateKey, passphrase) {
    throw new Error('Cant use method "importPrivate" on multisig wallet.');
  }

  /**
   * Import public key.
   * @param {Number|String} account
   * @param {String} key
   * @returns {Promise}
   */

  importPublic(id, account, publicKey) {
    throw new Error('Cant use method "importPublic" on multisig wallet.');
  }

  /**
   * Import address.
   * @param {Number|String} account
   * @param {String} address
   * @returns {Promise}
   */

  importAddress(id, account, address) {
    throw new Error('Cant use method "importAddress" on multisig wallet.');
  }

  /**
   * Lock a coin.
   * @param {String} hash
   * @param {Number} index
   * @returns {Promise}
   */

  lockCoin(id, hash, index) {
    throw new Error('Cant use method "lockCoin" on multisig wallet.');
  }

  /**
   * Unlock a coin.
   * @param {String} hash
   * @param {Number} index
   * @returns {Promise}
   */

  unlockCoin(id, hash, index) {
    throw new Error('Cant use method "unlockCoin" on multisig wallet.');
  }

  /**
   * Get locked coins.
   * @returns {Promise}
   */

  getLocked(id) {
    throw new Error('Cant use method "getLocked" on multisig wallet.');
  }

  /**
   * Lock wallet.
   * @returns {Promise}
   */

  lock(id) {
    throw new Error('Cant use method "lock" on multisig wallet.');
  }

  /**
   * Unlock wallet.
   * @param {String} passphrase
   * @param {Number} timeout
   * @returns {Promise}
   */

  unlock(id, passphrase, timeout) {
    throw new Error('Cant use method "unlock" on multisig wallet.');
  }

  /**
   * Get wallet key.
   * @param {String} id
   * @param {String} address
   * @returns {Promise}
   */

  getKey(id, address) {
    return this.get(`/multisig/${id}/key/${address}`);
  }

  /**
   * Get wallet key WIF dump.
   * @param {String} address
   * @param {String?} passphrase
   * @returns {Promise}
   */

  getWIF(id, address, passphrase) {
    throw new Error('Cant use method "getWIF" on multisig wallet.');
  }

  /**
   * Add a public account key to the wallet for multisig.
   * @param {String} account
   * @param {String} key - Account (bip44) key (base58).
   * @returns {Promise}
   */

  addSharedKey(id, account, accountKey) {
    const text = 'Cant use method "addSharedKey" on multisig wallet. '
      + 'Check "join" method instead.';
    throw new Error(text);
  }

  /**
   * Remove a public account key to the wallet for multisig.
   * @param {String} account
   * @param {String} key - Account (bip44) key (base58).
   * @returns {Promise}
   */

  removeSharedKey(id, account, accountKey) {
    const text = 'Cant use method "removeSharedKey" on multisig wallet. '
      + 'Removing cosigner from multisig wallet is not allowed.';
    throw new Error(text);
  }

  /**
   * Resend wallet transactions.
   * @param {String} id
   * @returns {Promise}
   */

  resendWallet(id) {
    return this.post(`/multisig/${id}/resend`);
  }

  /*
   * Proposals
   */

  /**
   * Get proposals
   * @param {String} id
   * @param {Boolean} [pending=true]
   * @returns {Promise<Proposal[]>}
   */

  async getProposals(id, pending = true) {
    const proposalsObject = await this.get(`/multisig/${id}/proposal`, {
      pending
    });

    if (!proposalsObject)
      return proposalsObject;

    return proposalsObject.proposals;
  }

  /**
   * Create proposal
   * @param {String} id
   * @param {Object} options - transaction options
   * @returns {Promise<Proposal>}
   */

  createProposal(id, options) {
    return this.post(`/multisig/${id}/proposal`, options);
  }

  /**
   * Get proposal info
   * @param {String} id
   * @param {String} pid - proposal id
   * @param {Boolean} tx - get transaction
   * @returns {Promise<Proposal>}
   */

  getProposalInfo(id, pid, tx) {
    return this.get(`/multisig/${id}/proposal/${pid}`, {
      tx
    });
  }

  /**
   * Get proposal transaction
   * @param {String} id
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {Boolean} options.path - include input paths
   * @param {Boolean} options.tx - include input transactions
   * @param {Boolean} options.coin - include input coins
   * @returns {Promise<MTX>}
   */

  getProposalMTX(id, pid, options) {
    return this.get(`/multisig/${id}/proposal/${pid}/tx`, options);
  }

  /**
   * Approve proposal
   * @param {String} id
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {HexString[]} options.signatures
   * @param {Boolean} options.broadcast
   * @returns {Promise<Proposal>}
   */

  approveProposal(id, pid, options) {
    return this.post(`/multisig/${id}/proposal/${pid}/approve`, options);
  }

  /**
   * Reject proposal
   * @param {String} id
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {HexString} options.signature
   * @returns {Promise<Proposal>}
   */

  rejectProposal(id, pid, options) {
    return this.post(`/multisig/${id}/proposal/${pid}/reject`, options);
  }

  /**
   * Send proposal tx
   * @param {String} id
   * @param {String} pid - proposal id
   * @returns {Promise<TX>}
   */

  sendProposal(id, pid) {
    return this.post(`/multisig/${id}/proposal/${pid}/send`);
  }

  /**
   * Set a new token.
   * @param {String} id
   * @param {Object} options
   * @param {String} options.cosignerToken - hex string
   * @returns {Promise}
   */

  setToken(id, options) {
    return this.put(`/multisig/${id}/token`, options);
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
    await this.parent.join(this.id, this.token);
    this.parent.wallets.set(this.id, this);
  }

  /**
   * Close wallet.
   * @returns {Promise}
   */

  async close() {
    await this.parent.leave(this.id);
    this.parent.wallets.delete(this.id);
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

  joinWallet(cosignerOptions) {
    return this.client.joinWallet(this.id, cosignerOptions);
  }

  /**
   * Get wallet transaction history.
   * @returns {Promise}
   */

  getHistory(account) {
    return this.client.getHistory(this.id, account);
  }

  /**
   * Get wallet coins
   * @returns {Promise<Coin[]>}
   */

  getCoins(account) {
    return this.client.getCoins(this.id, account);
  }

  /**
   * Get all unconfirmed transactions.
   * @returns {Promise}
   */

  getPending(account) {
    return this.client.getPending(this.id, account);
  }

  /**
   * Get wallet balance
   * @returns {Promise<bcoin#Balance>}
   */

  getBalance(account) {
    return this.client.getBalance(this.id, account);
  }

  /**
   * Get last N wallet transactions.
   * @param {Number} limit - Max number of transactions.
   * @returns {Promise}
   */

  getLast(account, limit) {
    return this.client.getLast(this.id, account, limit);
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

  getRange(account, options) {
    return this.client.getRange(this.id, account, options);
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

  zap(account, age) {
    return this.client.zap(this.id, account, age);
  }

  /**
   * Create wallet transaction
   * @param {Object} options - transaction options
   * @returns {Promise<TX>}
   */

  createTX(options) {
    return this.client.createTX(this.id, options);
  }

  /**
   * Create a transaction, fill, sign, and broadcast.
   * @param {Object} options
   * @param {String} options.address
   * @param {Amount} options.value
   * @returns {Promise}
   */

  send(options) {
    return this.client.send(this.id, options);
  }

  /**
   * Sign a transaction.
   * @param {Object} options
   * @returns {Promise}
   */

  sign(options) {
    return this.client.sign(this.id, options);
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
   * Get wallet accounts.
   * @returns {Promise} - Returns Array.
   */

  getAccounts() {
    return this.client.getAccounts(this.id);
  }

  /**
   * Get wallet master key.
   * @returns {Promise}
   */

  getMaster() {
    return this.client.getMaster(this.id);
  }

  /**
   * Get wallet account.
   * @param {String} account
   * @returns {Promise}
   */

  getAccount(account) {
    return this.client.getAccount(this.id, account);
  }

  /**
   * Create account.
   * @param {String} name
   * @param {Object} options
   * @returns {Promise}
   */

  createAccount(name, options) {
    return this.client.createAccount(this.id, name, options);
  }

  /**
   * Create address.
   * @returns {Promise}
   */

  createAddress(account) {
    return this.client.createAddress(this.id, account);
  }

  /**
   * Create change address.
   * @returns {Promise}
   */

  createChange(account) {
    return this.client.createChange(this.id, account);
  }

  /**
   * Create nested address.
   * @returns {Promise}
   */

  createNested(account) {
    return this.client.createNested(this.id, account);
  }

  /**
   * Change or set master key`s passphrase.
   * @param {String|Buffer} passphrase
   * @param {(String|Buffer)?} old
   * @returns {Promise}
   */

  setPassphrase(passphrase, old) {
    return this.client.setPassphrase(this.id, passphrase, old);
  }

  /**
   * Generate a new token.
   * @deprecated
   * @returns {Promise}
   */

  retoken() {
    return this.client.retoken(this.id);
  }

  /**
   * Import private key.
   * @param {Number|String} account
   * @param {String} key
   * @returns {Promise}
   */

  importPrivate(account, privateKey, passphrase) {
    return this.client.importPrivate(this.id, account, privateKey, passphrase);
  }

  /**
   * Import public key.
   * @param {Number|String} account
   * @param {String} key
   * @returns {Promise}
   */

  importPublic(account, publicKey) {
    return this.client.importPublic(this.id, account, publicKey);
  }

  /**
   * Import address.
   * @param {Number|String} account
   * @param {String} address
   * @returns {Promise}
   */

  importAddress(account, address) {
    return this.client.importAddress(this.id, account, address);
  }

  /**
   * Lock a coin.
   * @param {String} hash
   * @param {Number} index
   * @returns {Promise}
   */

  lockCoin(hash, index) {
    return this.client.lockCoin(this.id, hash, index);
  }

  /**
   * Unlock a coin.
   * @param {String} hash
   * @param {Number} index
   * @returns {Promise}
   */

  unlockCoin(hash, index) {
    return this.client.unlockCoin(this.id, hash, index);
  }

  /**
   * Get locked coins.
   * @returns {Promise}
   */

  getLocked() {
    return this.client.getLocked(this.id);
  }

  /**
   * Lock wallet.
   * @returns {Promise}
   */

  lock() {
    return this.client.lock(this.id);
  }

  /**
   * Unlock wallet.
   * @param {String} passphrase
   * @param {Number} timeout
   * @returns {Promise}
   */

  unlock(passphrase, timeout) {
    return this.client.unlock(this.id, passphrase, timeout);
  }

  /**
   * Get wallet key.
   * @param {String} address
   * @returns {Promise}
   */

  getKey(address) {
    return this.client.getKey(this.id, address);
  }

  /**
   * Get wallet key WIF dump.
   * @param {String} address
   * @param {String?} passphrase
   * @returns {Promise}
   */

  getWIF(address, passphrase) {
    return this.client.getWIF(this.id, address, passphrase);
  }

  /**
   * Add a public account key to the wallet for multisig.
   * @param {String} account
   * @param {String} key - Account (bip44) key (base58).
   * @returns {Promise}
   */

  addSharedKey(account, accountKey) {
    return this.client.addSharedKey(this.id, account, accountKey);
  }

  /**
   * Remove a public account key to the wallet for multisig.
   * @param {String} account
   * @param {String} key - Account (bip44) key (base58).
   * @returns {Promise}
   */

  removeSharedKey(account, accountKey) {
    return this.client.removeSharedKey(this.id, account, accountKey);
  }

  /**
   * Resend wallet transactions.
   * @returns {Promise}
   */

  resend() {
    return this.client.resendWallet(this.id);
  }

  /*
   * Proposals
   */

  /**
   * Get proposals
   * @param {String} id
   * @param {Boolean} [pending=true]
   * @returns {Promise<Proposal[]>}
   */

  getProposals(pending = true) {
    return this.client.getProposals(this.id, pending);
  }

  /**
   * Create proposal
   * @param {Object} options - transaction options
   * @returns {Promise<Proposal>}
   */

  createProposal(options) {
    return this.client.createProposal(this.id, options);
  }

  /**
   * Get proposal info
   * @param {String} pid - proposal id
   * @param {Boolean} tx - get transaction
   * @returns {Promise<Proposal>}
   */

  getProposalInfo(pid, tx) {
    return this.client.getProposalInfo(this.id, pid, tx);
  }

  /**
   * Get proposal transaction
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {Boolean} options.path - include input paths
   * @param {Boolean} options.scripts - include multisig scripts
   * @returns {Promise<MTX>}
   */

  getProposalMTX(pid, options) {
    return this.client.getProposalMTX(this.id, pid, options);
  }

  /**
   * Approve proposal
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {HexString[]} options.signatures
   * @param {Boolean} options.broadcast
   * @returns {Promise<Proposal>}
   */

  approveProposal(pid, options) {
    return this.client.approveProposal(this.id, pid, options);
  }

  /**
   * Reject proposal
   * @param {String} pid - proposal id
   * @param {Object} options
   * @param {HexString} options.signature
   * @returns {Promise<Proposal>}
   */

  rejectProposal(pid, options) {
    return this.client.rejectProposal(this.id, pid, options);
  }

  /**
   * Send proposal tx
   * @param {String} pid - proposal id
   * @returns {Promise<TX>}
   */

  sendProposal(pid) {
    return this.client.sendProposal(this.id, pid);
  }

  /**
   * Set a new token.
   * @param {Object} options
   * @returns {Promise<Cosigner>}
   */

  setToken(options) {
    return this.client.setToken(this.id, options);
  }
}

/*
 * Expose
 */

module.exports = MultisigClient;
