/*!
 * account.js - Multisig wallets' account
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const {Account} = require('bcoin').wallet;
const custom = require('./utils/inspect');

/**
 * Account object for multisig
 * for formatting.
 * @alias module:multisig.Account
 */

class MultisigAccount {
  constructor(account) {
    this.account = null;

    this.fromAccount(account);
  }

  fromAccount(account) {
    assert(account, 'MultisigAccount needs account.');
    assert(account.type === Account.types.MULTISIG,
      'Account needs to be multisig');
    assert(account.watchOnly === true, 'Account needs to be watchOnly');

    this.account = account;
  }

  /**
   * Get public keys.
   * @returns {bcoin#HDPublicKey[]}
   */

  getPublicKeys() {
    const keys = [this.account.accountKey];

    return keys.concat(this.account.keys);
  }

  /**
   * Get current receive address.
   * @returns {Address}
   */

  receiveAddress() {
    const key = this.account.receiveKey();

    if (!key)
      return null;

    return key.getAddress();
  }

  /**
   * Get current change address.
   * @returns {Address}
   */

  changeAddress() {
    const key = this.account.changeKey();

    if (!key)
      return null;

    return key.getAddress();
  }

  /**
   * Get current nested address.
   * @returns {Address}
   */

  nestedAddress() {
    const key = this.account.nestedKey();

    if (!key)
      return null;

    return key.getAddress();
  }

  createReceive(b) {
    return this.account.createReceive(b);
  }

  createChange(b) {
    return this.account.createChange(b);
  }

  createNested(b) {
    return this.account.createNested(b);
  }

  /**
   * Derive path
   * @param {Path} path
   */

  derivePath(path) {
    return this.account.deriveKey(path.branch, path.index);
  }

  /**
   * Create MultisigAccount from bcoin Account.
   * @param {bcoin#Account}
   * @returns {MultisigAccount}
   */

  static fromAccount(account) {
    return new MultisigAccount(account);
  }

  [custom]() {
    return this.toJSON();
  }

  /**
   * Convert the account to an object suitable for
   * serialization.
   * @param {Balance} [balance]
   * @returns {Object}
   */

  toJSON(balance) {
    const network = this.account.network;
    const keys = this.account.keys;
    const receive = this.receiveAddress();
    const change = this.changeAddress();
    const nested = this.nestedAddress();

    return {
      name: this.account.name,
      initialized: this.account.initialized,
      witness: this.account.witness,
      watchOnly: true,
      type: 'multisig',
      m: this.account.m,
      n: this.account.n,
      accountIndex: this.account.accountIndex,
      accountPath: null,
      receiveDepth: this.account.receiveDepth,
      changeDepth: this.account.changeDepth,
      nestedDepth: this.account.nestedDepth,
      lookahead: this.account.lookahead,
      receiveAddress: receive ? receive.toString(network) : null,
      changeAddress: change ? change.toString(network) : null,
      nestedAddress: nested ? nested.toString(network) : null,
      accountKey: this.account.accountKey.toBase58(network),
      keys: keys.map(key => key.toBase58(network)),
      balance: balance ? balance.toJSON(true) : null
    };
  }
}

module.exports = MultisigAccount;
