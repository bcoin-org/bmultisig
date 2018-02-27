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

  async getInfo() {
    return await this.get('/info');
  }
}

module.exports = MultisigClient;
