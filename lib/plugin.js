/*!
 * bmultisig.js - Multsig plugin for bwallet
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const EventEmitter = require('events');
const Network = require('bcoin').Network;
const WalletNodeClient = require('./walletclient');
const MultisigDB = require('./multisigdb');
const HTTP = require('./http');
const pkg = require('./pkg');

/**
 * @exports multisig/plugin
 */

const plugin = exports;

/**
 * Plugin
 * @extends EventEmitter
 * @property {bcfg.Config} config
 * @property {Object} options
 * @property {blgr.Logger} logger
 * @property {WalletNodeClient} client
 * @property {MultisigDB} msdb
 * @property {MultisigHTTP} http
 */
class Plugin extends EventEmitter {
  constructor(options) {
    super();

    assert(options, 'MultisigWallet requires options.');
    assert(options.node, 'MultisigWallet requires node.');

    const node = options.node;
    const network = Network.get(node.network.type);

    this.config = node.config.filter('multisig');

    this.options = options;
    this.node = node;
    this.logger = node.logger.context('multisig');

    this.client = new WalletNodeClient(this.node);

    this.msdb = new MultisigDB({
      network: network,
      logger: this.logger,
      client: this.client,

      prefix: this.config.prefix,
      memory: this.config.bool('memory', node.memory)
    });

    const httpOptions = node.http.options;

    this.http = new HTTP({
      msdb: this.msdb,
      logger: this.logger,
      version: pkg.version,
      whttp: this.node.http,

      // from Wallet.http
      apiKey: httpOptions.apiKey,
      walletAuth: httpOptions.walletAuth,
      noAuth: httpOptions.noAuth,
      adminToken: httpOptions.adminToken
    });

    this.init();
  }

  logError(err) {
    this.logger.debug(err.message);
    this.logger.debug(err.stack);
  }

  init() {
    this.msdb.on('error', (err) => {
      this.logError(err);
      this.emit('error', err);
    });

    this.http.on('error', (err) => {
      this.logError(err);
      this.emit('error', err);
    });

    this.msdb.init();
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

/**
 * Plugin name.
 * @const {String}
 */

plugin.id = 'multisig';

/**
 * Plugin initialization.
 * @param {bcoin.WalletNode}
 * @returns {Plugin}
 */

plugin.init = function init(node) {
  return new Plugin({ node });
};

/*
 * Expose
 */
module.exports = plugin;
