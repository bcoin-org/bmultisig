/*!
 * http.js - http server for bmultisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

'use strict';

const assert = require('bsert');
const bcoin = require('bcoin');
const {Script, Address, Network} = bcoin;
const HDPublicKey = bcoin.hd.HDPublicKey;
const Validator = require('bval');
const Logger = require('blgr');
const {base58} = require('bstring');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const {safeEqual} = require('bcrypto/lib/safe');
const {Server} = require('bweb');
const MultisigDB = require('./multisigdb');
const Cosigner = require('./primitives/cosigner');
const RouteList = require('./utils/routelist');

/**
 * Multisig HTTP server
 * @alias module:multisig.HTTP
 * @extends {Server}
 * @property {MultisigHTTPOptions} options
 * @property {MultisigDB} msdb
 * @property {bcoin.Network} network
 * @property {Logger} logger
 * @property {bcoin.wallet.HTTP} whttp
 * @property {RouteList} notauthRoutes - skip authentication
 * @property {RouteList} proxyRoutes - proxy requests to the bwallet
 */

class MultisigHTTP extends Server {
  /**
   * Create an http server.
   * @constructor
   * @param {MultisigHTTPOptions} options
   * @param {MultisigDB} options.msdb
   * @param {Logger} options.logger
   * @param {bcoin.Network} options.network
   * @param {bcoin.wallet.HTTP} options.whttp
   * @param {String} options.version
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

  /*
   * Initialize http server.
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

    if (token && safeEqual(token, this.options.adminToken)) {
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

    const mswallet = await this.msdb.getWallet(id);

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

  async proxyRequest(req, res) {
    assert(this.whttp, 'Can not proxy without parent wallet http');

    if (!this.proxyRoutes.has(req))
      return;

    // PROXY Routes don't go through normal hooks
    // get wallet
    await this.getWalletHook(req, res);

    if (res.sent)
      return;

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

  /*
   * Initialize routes.
   */
  initRouter() {
    if (this.options.cors)
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
     * List wallets (Admin Only)
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
     * Get wallet information
     */
    this.get('/:id', async (req, res) => {
      const balance = await req.wallet.getBalance();
      res.json(200, req.mswallet.toJSON(false, balance));
    });

    /*
     * Create multisig wallet
     */
    this.put('/:id', async (req, res) => {
      const valid = Validator.fromRequest(req);

      const id = valid.str('id');
      const joinSignature = valid.buf('joinSignature');
      const joinPubKey = valid.buf('joinPubKey');

      // wallet options
      const walletOptions = {
        id: id,
        m: valid.u32('m'),
        n: valid.u32('n'),
        witness: valid.bool('witness', true),
        joinPubKey: joinPubKey
      };

      // multisig options.
      const cosignerName = valid.str('cosignerName');
      const cosignerPurpose = valid.u32('cosignerPurpose');
      const cosignerFingerPrint = valid.u32('cosignerFingerPrint');
      const cosignerData = valid.buf('cosignerData');

      const accountKey = valid.str('accountKey');
      const key = HDPublicKey.fromBase58(accountKey, this.network);

      // multisig auth/validation options
      const token = valid.buf('token');
      const authPubKey = valid.buf('authPubKey');
      const accountKeyProof = valid.buf('accountKeyProof');

      const cosigner = Cosigner.fromOptions({
        name: cosignerName,
        purpose: cosignerPurpose,
        fingerPrint: cosignerFingerPrint,
        data: cosignerData,
        authPubKey: authPubKey,
        joinSignature: joinSignature,
        token: token,
        key: key
      });

      // verify account key proof
      const validKeyProof = cosigner.verifyProof(
        accountKeyProof,
        id,
        this.network
      );

      enforce(validKeyProof, 'accountKeyProof is not valid.');

      const mswallet = await this.msdb.create(walletOptions, cosigner);

      res.json(200, mswallet.toJSON(false, null, 0));
    });

    /*
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
     * Join multisig wallet
     * // PATCH /multisig/:id
     */
    this.post('/:id/join', async (req, res) => {
      const valid = Validator.fromRequest(req);

      const joinSignature = valid.buf('joinSignature');

      const cosignerName = valid.str('cosignerName');
      const cosignerPurpose = valid.u32('cosignerPurpose');
      const cosignerFingerPrint = valid.u32('cosignerFingerPrint');
      const cosignerData = valid.buf('cosignerData');

      const accountKey = valid.str('accountKey');
      const key = HDPublicKey.fromBase58(accountKey, this.network);

      const token = valid.buf('token');
      const authPubKey = valid.buf('authPubKey');
      const accountKeyProof = valid.buf('accountKeyProof');

      const cosigner = Cosigner.fromOptions({
        name: cosignerName,
        purpose: cosignerPurpose,
        fingerPrint: cosignerFingerPrint,
        data: cosignerData,
        authPubKey: authPubKey,
        joinSignature: joinSignature,
        token: token,
        key: key
      });

      const validKeyProof = cosigner.verifyProof(
        accountKeyProof,
        req.mswallet.id,
        this.network
      );

      enforce(validKeyProof, 'accountKeyProof is not valid.');

      const joined = await req.mswallet.join(cosigner, key);
      const cosignerIndex = joined.cosigners.length - 1;

      res.json(200, joined.toJSON(false, null, cosignerIndex));
    });

    /*
     * List accounts (compatibility).
     */
    this.get('/:id/account', (req, res) => {
      res.json(200, ['default']);
    });

    /*
     * Get account (compatibility).
     */
    this.get('/:id/account/:account', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const acct = valid.str('account');

      if (acct !== 'default') {
        res.json(404);
        return;
      }

      const account = await req.mswallet.getAccount();
      const balance = await req.wallet.getBalance();

      res.json(200, account.toJSON(balance));
    });

    /*
     * Set new token for cosigner
     */
    this.put('/:id/token', async (req, res) => {
      enforce(req.cosigner, 'Cosigner not found.');

      const valid = Validator.fromRequest(req);
      const token = valid.buf('newToken');

      enforce(token.length === 32, 'newToken must be 32 bytes.');

      const cosigner = await req.mswallet.setToken(req.cosigner, token);

      res.json(200, cosigner.toJSON(true, this.network));
    });

    /*
     * Create tx
     */
    this.post('/:id/create', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const options = parseTXOptions(valid, this.network);
      const tx = await req.mswallet.createTX(options);

      res.json(200, tx.getJSON(this.network));
    });

    /*
     * Get list of proposals.
     * TODO: Add limits.
     */
    this.get('/:id/proposal', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pending = valid.bool('pending', true);

      let proposals;

      if (pending) {
        proposals = await req.mswallet.getPendingProposals();
      } else {
        proposals = await req.mswallet.getProposals();
      }

      return res.json(200, {
        proposals: proposals.map((p) => {
          return p.getJSON(null, req.mswallet.cosigners, this.network);
        })
      });
    });

    /*
     * Create proposal.
     */
    this.post('/:id/proposal', async (req, res) => {
      enforce(req.cosigner, 'Cosigner not found.');

      const requestValid = Validator.fromRequest(req);

      const signature = requestValid.buf('signature');
      const options = requestValid.obj('proposal');

      const valid = new Validator(options, false);
      const txValid = new Validator(valid.obj('txoptions'), false);
      const txoptions = parseTXOptions(txValid, this.network);

      const memo = valid.str('memo');
      const timestamp = valid.u64('timestamp');

      enforce(memo, 'Memo not found.');
      enforce(timestamp, 'Timestamp not found.');

      const [proposal, tx] = await req.mswallet.createProposal(
        options,
        req.cosigner,
        txoptions,
        signature
      );

      enforce(proposal, 'Could not create proposal.');

      res.json(200, proposal.getJSON(tx, req.mswallet.cosigners, this.network));
    });

    /*
     * Get proposal info
     */
    this.get('/:id/proposal/:pid', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pid = valid.u32('pid');
      const getTX = valid.bool('tx', true);
      const proposal = await req.mswallet.getProposal(pid);

      if (!proposal) {
        res.json(404);
        return;
      }

      let tx = null;

      if (getTX)
        tx = await req.mswallet.getProposalTX(pid);

      const cosigners = req.mswallet.cosigners;

      res.json(200, proposal.getJSON(tx, cosigners, this.network));
    });

    /*
     * Get proposal mtx
     * TODO: Add option for returning previous transactions.
     */
    this.get('/:id/proposal/:pid/tx', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pid = valid.u32('pid');

      const getPaths = valid.bool('paths', false);
      const getScripts = valid.bool('scripts', false);
      const getTXs = valid.bool('txs', false);

      let paths, txs, rings, scripts;

      const mtx = await req.mswallet.getProposalMTX(pid);

      if (!mtx) {
        res.json(404);
        return;
      }

      if (getPaths)
        paths = await req.mswallet.getInputPaths(mtx);

      if (getScripts && rings)
        scripts = rings.map(r => r.script);

      if (getScripts && !rings) {
        const rings = await req.mswallet.deriveInputs(mtx, paths);
        scripts = rings.map(r => r.script);
      }

      if (getTXs) {
        txs = [];
        for (const {prevout} of mtx.inputs) {
          const {hash} = prevout;
          const record = await req.wallet.getTX(hash);
          txs.push(record.tx);
        }
      }

      res.json(200, {
        tx: mtx.getJSON(this.network),
        txs: txs ? txs.map(t => t.toRaw().toString('hex')) : null,

        paths: paths ? paths.map((p) => {
          if (!p)
            return null;

          return {
            branch: p.branch,
            index: p.index,
            receive: p.branch === 0,
            change: p.branch === 1,
            nested: p.branch === 2
          };
        }) : null,

        scripts: scripts ? scripts.map(s => s.toRaw().toString('hex')) : null
      });
    });

    /*
     * Approve proposal
     */
    this.post('/:id/proposal/:pid/approve', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pid = valid.u32('pid');
      const hexSigs = valid.array('signatures', []);
      const broadcast = valid.bool('broadcast', true);

      enforce(req.cosigner, 'Cosigner not found.');
      enforce(hexSigs.length, 'Could not find signatures');

      const sigs = hexSigs.map((sig) => {
        if (!sig)
          return null;

        return Buffer.from(sig, 'hex');
      });

      enforce(sigs && sigs.length > 0, 'Signatures not found.');

      const proposal = await req.mswallet.approveProposal(
        pid,
        req.cosigner,
        sigs
      );

      if (!proposal) {
        res.json(404);
        return;
      }

      let broadcasted = false, tx, err;
      if (proposal.isApproved() && broadcast) {
        try {
          tx = await req.mswallet.sendProposal(pid);
          assert(tx, 'Could not broadcast approved proposal.');
          broadcasted = true;
        } catch (e) {
          err = e;
          this.logger.debug(`Failed to broadcast ${e.message}`);
        }
      }

      res.json(200, {
        broadcasted,
        broadcastError: err ? err.message : null,
        proposal: proposal.getJSON(tx)
      });
    });

    /*
     * Reject proposal
     */
    this.post('/:id/proposal/:pid/reject', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pid = valid.u32('pid');

      const signature = valid.buf('signature');

      enforce(req.cosigner, 'Cosigner not found.');
      const proposal = await req.mswallet.rejectProposal(
        pid,
        req.cosigner,
        signature
      );

      if (!proposal) {
        res.json(404);
        return;
      }

      res.json(200, proposal.toJSON());
    });

    /*
     * Send proposal tx
     */
    this.post('/:id/proposal/:pid/send', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const pid = valid.u32('pid');

      const tx = await req.mswallet.sendProposal(pid);

      if (!tx) {
        res.json(404);
        return;
      }

      res.json(200, tx.toJSON());
    });
  }

  /*
   * Initialize websockets.
   */
  initSockets() {
    const handleEvent = (event, wallet, json) => {
      const name = `w:${wallet.id}`;

      if (!this.channel(name) && !this.channel('w:*'))
        return;

      if (this.channel(name))
        this.to(name, event, wallet.id, json);

      if (this.channel('w:*'))
        this.to('w:*', event, wallet.id, json);
    };

    this.msdb.on('join', (wallet, cosigner) => {
      const json = cosigner.getJSON(false, this.network);

      handleEvent('join', wallet, json);
    });

    this.msdb.on('proposal created', (wallet, proposal, tx) => {
      const json = proposal.getJSON(tx, wallet.cosigners, this.network);

      handleEvent('proposal created', wallet, json);
    });

    this.msdb.on('proposal rejected', (wallet, proposal, cosigner) => {
      const json = {
        proposal: proposal.getJSON(),
        cosigner: cosigner ? cosigner.getJSON(false, this.network) : null
      };

      handleEvent('proposal rejected', wallet, json);
    });

    this.msdb.on('proposal approved', (wallet, proposal, cosigner, tx) => {
      const json = {
        proposal: proposal.getJSON(tx),
        cosigner: cosigner.getJSON(false, this.network)
      };

      handleEvent('proposal approved', wallet, json);
    });
  }

  handleSocket(socket) {
    socket.hook('ms-join', async (...args) => {
      const valid = new Validator(args);
      const id = valid.str(0, '');
      const token = valid.buf(1);

      if (!id)
        throw new Error('Invalid parameter.');

      if (!this.options.walletAuth) {
        socket.join('admin');
      } else if (token) {
        if (safeEqual(token, this.options.adminToken))
          socket.join('admin');
      }

      if (socket.channel('admin') || !this.options.walletAuth) {
        socket.join(`w:${id}`);
        return null;
      }

      if (id === '*')
        throw new Error('Bad token.');

      if (!token)
        throw new Error('Invalid parameter.');

      const mswallet = await this.msdb.getWallet(id);

      if (!mswallet)
        throw new Error('Wallet does not exist.');

      try {
        mswallet.auth(token);
      } catch (e) {
        this.logger.info(`Wallet auth failure for ${id}: ${e.message}`);
        throw new Error('Bad token.');
      }

      this.logger.info(`Successful wallet auth for ${id}.`);

      socket.join(`w:${id}`);

      return null;
    });
  }
}

/**
 * Multisig HTTP Options.
 * @property {MultisigDB} msdb
 * @property {bcoin.Network} network
 * @property {blgr.Logger} logger
 * @property {MultisigDB} msdb
 */

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
    this.cors = false;

    this.fromOptions(options);
  }

  fromOptions(options) {
    assert(options, 'MultisigHTTP Server requires options');
    assert(options.msdb instanceof MultisigDB,
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

    if (options.cors != null) {
      assert(typeof options.cors === 'boolean');
      this.cors = options.cors;
    }
  }
}

/*
 * Helpers
 */

/**
 * Parse transaction options.
 * @ignore
 * @param {Validator} valid
 * @param {Network} network
 * @returns {Object}
 */

function parseTXOptions(valid, network) {
  const outputs = valid.array('outputs', []);

  const options = {
    rate: valid.u64('rate'),
    blocks: valid.u32('blocks'),
    maxFee: valid.u64('maxFee'),
    selection: valid.str('selection'),
    smart: valid.bool('smart'),
    sort: valid.bool('sort'),
    subtractFee: valid.bool('subtractFee'),
    subtractIndex: valid.i32('subtractIndex'),
    depth: valid.u32(['confirmations', 'depth']),
    outputs: []
  };

  for (const output of outputs) {
    const valid = new Validator(output);

    let addr = valid.str('address');
    let script = valid.buf('script');

    if (addr)
      addr = Address.fromString(addr, network);

    if (script)
      script = Script.fromRaw(script);

    options.outputs.push({
      address: addr,
      script: script,
      value: valid.u64('value')
    });
  }

  return options;
}

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
