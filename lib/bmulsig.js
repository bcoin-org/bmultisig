/*!
 * bmulsig.js - Multsig plugin for bwallet
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const HTTP = require('./http');
const pkg = require('../package.json');

/**
 * Plugin
 * @extends EventEmitter
 */
class Plugin extends EventEmitter {
  constructor(options) {
    super();

    assert(options, 'MultisigWallet requires options');
    assert(options.node, 'MultisigWallet requires node');

    this.options = options;
    this.node = options.node;
    this.logger = options.node.logger.context('mulsig');

    const httpOptions = this.node.http.options;
    this.http = new HTTP({
      node: options.node,
      logger: this.logger,
      version: pkg.version,

      // from Wallet.http
      apiKey: httpOptions.apiKey,
      walletAuth: httpOptions.walletAuth,
      noAuth: httpOptions.noAuth,
      adminToken: httpOptions.adminToken
    });

    this.init();
  }

  static init(node) {
    return new this({ node });
  }

  init() {
  }

  async open() {
    if (this.node.http)
      this.http.attach('/mulsig', this.node.http);
  }

  async close() {
  }
}

Plugin.id = 'mulsig';

/*
 * Expose
 */
module.exports = Plugin;
