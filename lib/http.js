/*!
 * http.js - http server for bmultisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');

const bcoin = require('bcoin');
const {Network} = bcoin;
const HDPublicKey = bcoin.hd.HDPublicKey;
const Validator = require('bval');
const Logger = require('blgr');
const {base58} = require('bstring');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const ccmp = require('bcrypto/lib/ccmp');
const {Server} = require('bweb');
const Cosigner = require('./cosigner');
const RouteList = require('./routelist');

/**
 * Multisig HTTP server
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
    this.whttp = this.options.whttp;

    this.noauthRoutes = new RouteList();
    this.proxyRoutes = new RouteList();
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

    this.setupNoAuthRoutes();
    this.setupProxyRoutes();

    this.initRouter();
    this.initSockets();
  }

  /*
   * Skip authentication for these routes
   */
  setupNoAuthRoutes() {
    // create wallet
    this.noauthRoutes.put('/:id');

    // join wallet
    this.noauthRoutes.post('/:id/join');

    // admin paths
    this.noauthRoutes.get('/');
    this.noauthRoutes.del('/:id');
  }

  /*
   * Proxy these routes
   */
  setupProxyRoutes() {
    this.proxyRoutes.post('/:id/zap');

    // abandon transactions
    this.proxyRoutes.del('/:id/tx/:hash');

    this.proxyRoutes.get('/:id/block');
    this.proxyRoutes.get('/:id/block/:height');

    this.proxyRoutes.get('/:id/key/:address');
    this.proxyRoutes.post('/:id/address');
    this.proxyRoutes.post('/:id/change');
    this.proxyRoutes.post('/:id/nested');

    this.proxyRoutes.get('/:id/balance');
    this.proxyRoutes.get('/:id/coin');

    this.proxyRoutes.get('/:id/coin/:hash/:index');
    this.proxyRoutes.get('/:id/tx/history');
    this.proxyRoutes.get('/:id/tx/unconfirmed');
    this.proxyRoutes.get('/:id/tx/range');
    this.proxyRoutes.get('/:id/tx/last');
    this.proxyRoutes.get('/:id/tx/:hash');

    this.proxyRoutes.post('/:id/resend');
  }

  /*
   * Admin authentication
   */
  async checkAdminHook(req, res) {
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
  }

  /*
   * grab wallet and attach to request
   */
  async getWalletHook(req, res) {
    // contains - :id
    if (!req.params.id)
      return;

    // ignore - PUT /multisig/:id
    if (req.path.length === 1 && req.method === 'PUT')
      return;

    const id = req.params.id;

    if (!id) {
      res.json(400);
      return;
    }

    const mswallet = await this.msdb.get(id);

    if (!mswallet) {
      res.json(404);
      return;
    }

    req.mswallet = mswallet;
    req.wallet = mswallet.wallet;
  }

  /*
   * Authenticate user with cosignerToken
   */
  async cosignerAuth(req, res) {
    if (req.admin)
      return;

    if (this.noauthRoutes.has(req))
      return;

    const valid = Validator.fromRequest(req);
    const mswallet = req.mswallet;
    const cosignerToken = valid.buf('token');

    if (!cosignerToken || !mswallet)
      error(403, 'Authentication error.');

    const cosigner = mswallet.auth(cosignerToken);

    req.cosigner = cosigner;
  }

  /*
   * Proxying requests
   */
  async proxyRequest(req, res) {
    assert(this.whttp, 'Can not proxy without parent wallet http');

    if (!this.proxyRoutes.has(req))
      return;

    // PROXY Routes don't go through normal hooks
    // get wallet
    await this.getWalletHook(req, res);

    // authenticate..
    await this.cosignerAuth(req, res);

    // We already did authentication with cosignerToken
    // wallet.HTTP does not need to check walletToken
    req.admin = true;

    // replace /multisig with /wallet for
    // wallet.HTTP to handle it.
    const url = '/wallet' + req.url;
    req.navigate(url);

    // because we only use one account
    // all account related stuff can use `default` account
    req.query.account = 'default';

    const route = await this.whttp.routes.handle(req, res);

    if (!route)
      res.json(404);
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

    // check if token is for admin
    this.use(this.checkAdminHook.bind(this));

    // proxy request to wallet
    this.use(this.proxyRequest.bind(this));

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

    // load wallet
    this.hook(this.getWalletHook.bind(this));

    // authenticate cosigner
    this.hook(this.cosignerAuth.bind(this));

    /*
     * GET /multisig (Admin Only)
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

    /*
     * GET /multisig/:id
     * Get wallet information
     */
    this.get('/:id', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const details = valid.bool('details');
      const balance = await req.wallet.getBalance();
      let account;

      if (details)
        account = await req.mswallet.getAccount();

      res.json(200, req.mswallet.toJSON(false, balance, account));
    });

    /*
     * PUT /multisig/:id
     * Create multisig wallet
     */
    this.put('/:id', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const walletOptions = {
        m: valid.u32('m'),
        n: valid.u32('n'),
        id: valid.str('id'),
        witness: valid.bool('witness', true)
      };

      const key = valid.str('xpub');
      const cosigner = Cosigner.fromOptions({
        name: valid.str('cosignerName'),
        path: valid.str('cosignerPath')
      });

      const xpub = HDPublicKey.fromBase58(key, this.network);
      const wallet = await this.msdb.create(walletOptions, cosigner, xpub);

      res.json(200, wallet.toJSON(0));
    });

    /*
     * DELETE /multisig/:id (Admin Only)
     * Removes wallet from WDB and MSDB
     * unindexes all info
     */
    this.del('/:id', async (req, res) => {
      if (!req.admin) {
        res.json(403);
        return;
      }

      const removed = await req.mswallet.remove();

      res.json(200, { success: removed });
    });

    /*
     * // PATCH /multisig/:id
     * POST /multisig/:id/join
     * Join multisig wallet
     */
    this.post('/:id/join', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const joinKey = Buffer.from(valid.str('joinKey'), 'hex');
      const b58 = valid.str('xpub');

      const cosigner = Cosigner.fromOptions({
        name: valid.str('cosignerName'),
        path: valid.str('cosignerPath')
      });

      const validKey = req.mswallet.verifyJoinKey(joinKey);

      if (!validKey)
        error(403, 'Invalid joinKey');

      enforce(b58, 'XPUB is required');

      const xpub = HDPublicKey.fromBase58(b58, this.network);
      const joined = await req.mswallet.join(cosigner, xpub);
      const cosignerIndex = joined.cosigners.length - 1;

      res.json(200, joined.toJSON(cosignerIndex));
    });

    /*
     * POST /multisig/:id/retoken
     * Generate new cosignerToken
     */
    this.post('/:id/retoken', async (req, res) => {
      // TODO: lock/unlock this.master
      if (!req.cosigner || !req.mswallet) {
        res.json(404);
        return;
      }

      const token = await req.wallet.retoken(req.cosigner.id);

      res.json(200, {
        token: token.toString('hex')
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
    this.msdb = null;
    this.whttp = null;
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

    if (options.whttp != null) {
      assert(typeof options.whttp === 'object',
        'Incorrect wallet http'
      );

      this.whttp = options.whttp;
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
 * Helpers
 */
function error(statusCode, msg) {
  const err = new Error(msg);
  err.statusCode = statusCode;

  throw err;
}

function enforce(value, msg) {
  if (!value)
    error(400, msg);
}

/*
 * Expose
 */

module.exports = MultisigHTTP;
