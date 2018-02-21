/*!
 * http.js - http server for bmultisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');

const Network = require('bcoin/lib/protocol/network');
const Validator = require('bval');
const Logger = require('blgr');
const {base58} = require('bstring');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const ccmp = require('bcrypto/lib/ccmp');
const {Server} = require('bweb');
const WalletNode = require('bcoin').wallet.Node;

/**
 * MultiHTTP server
 */
class MultisigHTTP extends Server {
  /**
   * Create an http server.
   * @constructor
   * @param {Object} options
   */

  constructor(options) {
    super(new MultisigHTTPOptions(options));

    this.network = this.options.network;
    this.logger = this.options.logger.context('multisig-http');

    this.init();
  }

  /**
   * Initialize http server.
   * @private
   */

  init() {
    this.on('request', (req, res) => {
      this.logger.debug('Request for method=%s path=%s (%s).',
        req.method, req.pathname, req.socket.remoteAddress);
    });

    this.initRouter();
    this.initSockets();
  }

  /**
   * Initialize routes.
   * @private
   */

  initRouter() {
    this.use(this.cors());

    if (!this.options.noAuth) {
      this.use(this.basicAuth({
        hash: sha256.digest,
        password: this.options.apiKey,
        realm: 'wallet'
      }));
    }

    this.use(this.bodyParser({
      type: 'json'
    }));

    this.use(async (req, res) => {
      if (!this.options.walletAuth) {
        req.admin = true;
        return;
      }

      const valid = Validator.fromRequest(req);
      const token = valid.buf('token');

      if (token && ccmp(token, this.options.adminToken)) {
        req.admin = true;
        return;
      }
    });

    this.use(this.router());

    this.error((err, req, res) => {
      const code = err.statusCode || 500;
      res.json(code, {
        error: {
          type: err.type,
          code: err.code,
          message: err.message
        }
      });
    });

    this.get('/info', async (req, res) => {
      if (!req.admin) {
        res.json(403);
        return;
      }

      res.json(200, {
        version: this.options.version
      });
    });
  }

  /**
   * Initialize websockets.
   * @private
   */

  initSockets() {
  }
}

class MultisigHTTPOptions {
  constructor (options) {
    this.network = Network.primary;
    this.logger = Logger.global;
    this.node = null;
    this.version = '0.0.0';

    this.apiKey = base58.encode(random.randomBytes(20));
    this.apiHash = sha256.digest(Buffer.from(this.apiKey, 'ascii'));
    this.adminToken = random.randomBytes(32);
    this.serviceHash = this.apiHash;
    this.noAuth = false;
    this.walletAuth = false;

    this.fromOptions(options);
  }

  fromOptions(options) {
    assert(options, 'MultisigHTTP Server requires options');
    assert(options.node && options.node instanceof WalletNode,
      'MultiHTTP Server requires WalletNode');

    this.node = options.node;
    this.logger = options.node.logger;
    this.network = options.node.network;

    if (options.logger != null) {
      assert(typeof options.logger === 'object',
        'MultiHTTP Server requires correct logger'
      );
      this.logger = options.logger;
    }

    if (options.version != null) {
      assert(typeof options.version === 'string');
      this.version = options.version;
    }

    if (options.apiKey != null) {
      assert(typeof options.apiKey === 'string',
        'API key must be a string.');
      assert(options.apiKey.length <= 255,
        'API key must be under 255 bytes.');
      this.apiKey = options.apiKey;
      this.apiHash = sha256.digest(Buffer.from(this.apiKey, 'ascii'));
    }

    if (options.adminToken != null) {
      if (typeof options.adminToken === 'string') {
        assert(options.adminToken.length === 64,
          'Admin token must be a 32 byte hex string.');
        const token = Buffer.from(options.adminToken, 'hex');
        assert(token.length === 32,
          'Admin token must be a 32 byte hex string.');
        this.adminToken = token;
      } else {
        assert(Buffer.isBuffer(options.adminToken),
          'Admin token must be a hex string or buffer.');
        assert(options.adminToken.length === 32,
          'Admin token must be 32 bytes.');
        this.adminToken = options.adminToken;
      }
    }

    if (options.noAuth != null) {
      assert(typeof options.noAuth === 'boolean');
      this.noAuth = options.noAuth;
    }

    if (options.walletAuth != null) {
      assert(typeof options.walletAuth === 'boolean');
      this.walletAuth = options.walletAuth;
    }
  }
}

/*
 * Expose
 */

module.exports = MultisigHTTP;
