/*!
 * http.js - http server for bmultisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');

const bcoin = require('bcoin');
const {Network} = bcoin;
const Validator = require('bval');
const Logger = require('blgr');
const {base58} = require('bstring');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const ccmp = require('bcrypto/lib/ccmp');
const {Server} = require('bweb');

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

    this.msdb = this.options.msdb;
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
      this.logger.debug('Request for method=%s path=/multisig%s (%s).',
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
    if (!this.options.noAuth) {
      this.use(this.cors());

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

    /*
     * GET /multisig
     * List wallets
     */
    this.get('/', async (req, res) => {
      if (!req.admin) {
        res.json(403);
        return;
      }

      const wallets = await this.msdb.getWallets();

      res.json(200, { wallets });
    });

    this.get('/:id', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const id = valid.str('id');

      if (!id) {
        res.json(400);
        return;
      }

      const mWallet = await this.msdb.get(id);
      const balance = await mWallet.wallet.getBalance();

      res.json(200, mWallet.toJSON(false, balance));
    });

    /*
     * PUT /multisig/:id
     */
    this.put('/:id', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const walletOptions = {
        m: valid.u32('m'),
        n: valid.u32('n'),
        xpub: valid.str('xpub'),
        id: valid.str('id'),
        witness: valid.bool('witness', true),

        cosignerName: valid.str('cosignerName'),
        cosignerPath: valid.str('cosignerPath')
      };

      const wallet = await this.msdb.create(walletOptions);
      const balance = await wallet.wallet.getBalance();

      res.json(200, wallet.toJSON(false, balance));
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
    this.msdb = null;
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
    assert(typeof options.msdb === 'object',
      'MultiHTTP Server requires MultisigDB');

    this.msdb = options.msdb;
    this.logger = options.msdb.logger;
    this.network = options.msdb.network;

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
