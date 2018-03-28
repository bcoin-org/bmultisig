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
