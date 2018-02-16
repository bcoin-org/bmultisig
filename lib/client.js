/*!
 * client.js - Client for Multsig plugin
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const {WalletClient} = require('bclient');

class MulsigClient extends WalletClient {
  constructor(options) {
    super(options);

    this.path = '/mulsig';
  }

  async getInfo() {
    return await this.get('/info');
  }
}

module.exports = MulsigClient;
