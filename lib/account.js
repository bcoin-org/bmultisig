/*!
 * account.js - Multisig wallets' account
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const {Account} = require('bcoin').wallet;

/**
 * Account object for multisig
 * for formatting.
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
   * @param {bcoin#Account}
   * @returns {MultisigAccount}
   */

  static fromAccount(account) {
    return new MultisigAccount(account);
  }

  inspect() {
    return {};
  }

  toJSON(balance) {
    const network = this.account.network;
    const keys = this.getPublicKeys();
    const receiveAddress = this.account.receiveAddress();
    const changeAddress = this.account.changeAddress();
    const nestedAddress = this.account.nestedAddress();

    const {
      initialized,
      watchOnly,
      witness,
      receiveDepth,
      changeDepth,
      nestedDepth,
      lookahead
    } = this.account;

    return {
      initialized,
      watchOnly,
      witness,
      receiveDepth,
      changeDepth,
      nestedDepth,
      lookahead,
      receiveAddress: receiveAddress ? receiveAddress.toString(network) : null,
      changeAddress: changeAddress ? changeAddress.toString(network) : null,
      nestedAddress: nestedAddress ? nestedAddress.toString(network) : null,
      keys: keys.map(key => key.toBase58(network)),
      balance: balance ? balance.toJSON(true) : null
    };
  }
}

module.exports = MultisigAccount;
