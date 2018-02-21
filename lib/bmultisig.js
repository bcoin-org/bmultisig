/*!
 * bmultisig.js - Multsig plugin for bwallet
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const MultisigDB = require('./multisigdb');
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

    const node = options.node;

    this.config = node.config.filter('multisig');

    this.options = options;
    this.node = node;
    this.logger = node.logger.context('multisig');

    this.msdb = new MultisigDB({
      network: node.network,
      logger: this.logger,

      prefix: this.config.prefix,
      memory: this.config.bool('memory', node.memory)
    });

    const httpOptions = node.http.options;

    this.http = new HTTP({
      node: node,
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
      this.http.attach('/multisig', this.node.http);

    await this.msdb.open();
  }

  async close() {
    await this.msdb.close();
  }
}

Plugin.id = 'multisig';

/*
 * Expose
 */
module.exports = Plugin;
