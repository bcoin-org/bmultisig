/*!
 * wallet.js - Multisig wallet
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const bio = require('bufio');
const EventEmitter = require('events');
const {safeEqual} = require('bcrypto/lib/safe');
const {Lock} = require('bmutex');
const bcoin = require('bcoin');
const Wallet = bcoin.wallet.Wallet;
const {common, MasterKey} = bcoin.wallet;
const {encoding} = bio;
const {MTX} = bcoin;
const custom = require('./utils/inspect');

const ProposalDB = require('./proposaldb');
const MultisigAccount = require('./account');
const Cosigner = require('./primitives/cosigner');
const layout = require('./layout').msdb;

const NULL_KEY = Buffer.alloc(33, 0x00);

/**
 *  Currently Multisig Wallet extends functionality
 *  of Wallet/Account in the bwallet and adds
 *  additional functionality.
 *  Multisig wallet uses bwallet entries in the backend.
 *
 *  Note: Multisig wallet creates 1 wallet and 1 account
 *  in bwallet and manages 1 account. This can be
 *  improved in the future.
 *  e.g. join multiple multisig wallets (that in bwallet case
 *  represents accounts) under same bwallet#Wallet as accounts
 *  instead of using 1 wallet/1 account.
 *  Or directly extend bwallet#Wallet/bwallet#Account
 *  @alias module:multisig.Wallet
 *  @property {MultisigDB} msdb
 *  @property {bcoin.Network} network
 *  @property {blgr.Logger} logger
 *  @property {ProposalDB} pdb
 *  @property {Lock} coinLock
 *  @property {Number} wid - wallet id
 *  @property {String} id - wallet name
 *  @property {Number} n
 *  @property {Number} m
 *  @property {Boolean} witness
 *  @property {Cosigner[]} cosigners
 *  @property {Buffer} joinPubKey
 *  @property {MasterKey} master - internal master key
 *  @property {Wallet} wallet - bcoin wallet instance
 */

class MultisigWallet extends EventEmitter {
  /**
   * Create multisig wallet
   * @param {MultisigDB} msdb
   * @param {Object} options
   * @param {Number} options.wid
   * @param {String} options.id
   * @param {Number} options.n
   * @param {Number} options.m
   * @param {String|Buffer} options.xpub - First cosigner xpub
   * @param {String} options.name - First cosigner name
   */

  constructor(msdb, options) {
    super();

    assert(msdb);

    this.msdb = msdb;

    this.network = this.msdb.network;
    this.logger = this.msdb.logger;

    this.wid = 0;
    this.id = null;

    // cache account data
    this.n = 0;
    this.m = 0;
    this.witness = false;
    this.cosigners = [];
    this.master = new MasterKey();
    this.wallet = null;
    this.joinPubKey = NULL_KEY;

    this.pdb = new ProposalDB(msdb);
    this.coinLock = new Lock();

    if (options)
      this.fromOptions(options);
  }

  /**
   * Insert options to wallet
   * @param {Object} options
   * @returns {MultisigWallet}
   */

  fromOptions(options) {
    assert(options, 'MultisigWallet needs options');

    if (options.master) {
      assert(options.master instanceof MasterKey);
      this.master = options.master;
    }

    if (options.wid != null) {
      assert((options.wid >>> 0) === options.wid);
      this.wid = options.wid;
    }

    if (options.id != null) {
      assert(common.isName(options.id), 'Bad wallet ID.');
      this.id = options.id;
    }

    if (options.witness != null) {
      assert(typeof options.witness === 'boolean');
      this.witness = options.witness;
    }

    if (options.m != null) {
      assert((options.m & 0xff) === options.m);
      this.m = options.m;
    }

    if (options.n != null) {
      assert((options.n & 0xff) === options.n);
      this.n = options.n;
    }

    assert(this.n > 1, 'n must be greater than 1');
    assert(this.m >= 1 && this.m <= this.n, 'm ranges between 1 and n.');

    if (options.joinPubKey != null) {
      assert(Buffer.isBuffer(options.joinPubKey), 'Bad joinPubKey.');
      assert(options.joinPubKey.length === 33, 'Bad joinPubKey');

      this.joinPubKey = options.joinPubKey;
    }

    if (options.cosigners != null) {
      assert(this.id, 'Can not initialize cosigners without wallet id.');
      assert(Array.isArray(options.cosigners));

      for (const cosignerOptions of options.cosigners)
        this.addCosigner(Cosigner.fromOptions(cosignerOptions));
    }

    return this;
  }

  /**
   * Create multisig wallet from options
   * @static
   * @returns {MultisigWallet}
   */

  static fromOptions(msdb, options) {
    return new this(msdb, options);
  }

  /**
   * Create multisig wallet from bcoin.Wallet and options
   * @param {bcoin.Wallet} wallet
   * @param {Object} options
   * @param {Number} options.n
   * @param {Number} options.m
   */

  fromWalletOptions(wallet, options) {
    assert(wallet instanceof Wallet);

    if (options)
      this.fromOptions(options);

    this.wid = wallet.wid;
    this.id = wallet.id;
    this.master = wallet.master;
    this.wallet = wallet;

    return this;
  }

  /**
   * Create multisig wallet from bcoin.Wallet and options
   * @param {MultisigDB} msdb
   * @param {bcoin.Wallet} wallet
   * @param {Object} options
   * @return {MultisigWallet}
   */

  static fromWalletOptions(msdb, wallet, options) {
    return new this(msdb).fromWalletOptions(wallet, options);
  }

  /**
   * Open the wallet
   * @async
   * @returns {MultisigWallet}
   */

  async open() {
    await this.pdb.open(this);
  }

  /**
   * Inspection friendly object
   * @returns {Object}
   */

  [custom]() {
    return {
      id: this.id,
      wid: this.wid,
      witness: this.witness,
      m: this.m,
      n: this.n,
      initialized: this.isInitialized(),
      network: this.network.type,
      cosigners: this.cosigners
    };
  }

  /**
   * Convert the multisig wallet object
   * to an object suitable for serialization
   * @param {Boolean} unsafe
   * @param {bcoin.TXDB.Balance} balance
   * @param {Number} cosignerIndex
   * @returns {Object}
   */

  getJSON(unsafe, balance, cosignerIndex = -1) {
    const cosigners = [];

    if (cosignerIndex > -1) {
      for (const [index, cosigner] of this.cosigners.entries()) {
        if (index === cosignerIndex) {
          cosigners.push(cosigner.toJSON(true, this.network));
          continue;
        }

        cosigners.push(cosigner.toJSON(false, this.network));
      }
    } else {
      for (const cosigner of this.cosigners)
        cosigners.push(cosigner.toJSON(unsafe, this.network));
    }

    return {
      network: this.network.type,
      wid: this.wid,
      id: this.id,
      watchOnly: true,
      accountDepth: 1,
      token: null,
      tokenDepth: 0,
      master: {
        encrypted: false
      },
      balance: balance ? balance.toJSON(true) : null,
      initialized: this.isInitialized(),
      joinPubKey: this.joinPubKey.toString('hex'),
      cosigners: cosigners
    };
  }

  toJSON(unsafe, balance, cosignerIndex) {
    return this.getJSON(unsafe, balance, cosignerIndex);
  }

  /**
   * Get serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 0;

    // flags + m + n + cosignersLength (4)
    // joinPubKey (33)
    size += 37;
    size += this.master.getSize();

    for (const cosigner of this.cosigners) {
      const cosignerSize = cosigner.getSize();
      size += encoding.sizeVarint(cosignerSize);
      size += cosignerSize;
    }

    return size;
  }

  /**
   * Serialize wallet
   * @returns {Buffer}
   */

  toRaw() {
    const size = this.getSize();
    const bw = bio.write(size);

    let flags = 0;

    if (this.witness)
      flags |= 1;

    bw.writeU8(flags);
    bw.writeU8(this.m);
    bw.writeU8(this.n);
    bw.writeBytes(this.joinPubKey);
    this.master.toWriter(bw);

    bw.writeU8(this.cosigners.length);
    for (const cosigner of this.cosigners)
      bw.writeVarBytes(cosigner.toRaw());

    return bw.render();
  }

  /**
   * Deserialize wallet
   * @param {Buffer} data
   * @returns {MultisigWallet}
   */

  fromRaw(data) {
    assert(Buffer.isBuffer(data));

    const br = bio.read(data);
    const flags = br.readU8();

    this.witness = (flags & 1) === 1;
    this.m = br.readU8();
    this.n = br.readU8();
    this.joinPubKey = br.readBytes(33);
    this.master.fromReader(br);

    const cosigners = br.readU8();

    for (let i = 0; i < cosigners; i++) {
      const cosignerData = br.readVarBytes();
      const cosigner = Cosigner.fromRaw(cosignerData);
      this.cosigners.push(cosigner);
    }

    return this;
  }

  /**
   * Deserialize wallet
   * @param {MultisigDB} msdb
   * @param {Buffer} data
   * @returns {MultisigWallet}
   */

  static fromRaw(msdb, data) {
    return new this(msdb).fromRaw(data);
  }

  /**
   * Destroy wallet
   */

  destroy() {
  }

  /**
   * Save Wallet to DB
   * @param {bdb.Batch} b
   */

  static save(b, wallet) {
    const wid = wallet.wid;
    const id = wallet.id;

    b.put(layout.w.encode(wid), wallet.toRaw());
    b.put(layout.W.encode(wid), fromString(id));
    b.put(layout.l.encode(id), fromU32(wid));
  }

  /**
   * Whether wallet is initialized or not
   * @returns {Boolean}
   */

  isInitialized() {
    return this.n === this.cosigners.length;
  }

  /**
   * Verify cosigner token
   * @private
   * @param {Cosigner} cosigner
   * @param {Buffer} token
   * @returns {Boolean}
   */

  verifyToken(cosigner, token) {
    if (!cosigner.token)
      return false;

    return Boolean(safeEqual(cosigner.token, token));
  }

  /**
   * Remove wallet
   * @returns {Promise<Boolean>}
   */

  remove() {
    return this.msdb.remove(this.wid);
  }

  /**
   * Remove wallet
   * @param {bdb.Batch} b
   * @param {Number} wid
   * @param {String} id
   */

  static remove(b, wid, id) {
    b.del(layout.w.encode(wid));
    b.del(layout.W.encode(wid));
    b.del(layout.l.encode(id));
  }

  /**
   * Add cosigner to array
   * and set cosigner id
   * @param {Cosigner} cosigner
   */

  addCosigner(cosigner) {
    assert(Cosigner.isCosigner(cosigner));

    if (this.cosigners.length === this.n)
      throw new Error('Multisig wallet is full.');

    const id = this.cosigners.length;
    cosigner.id = id;

    // verify join signature
    const validJoinSig = cosigner.verifyJoinSignature(
      this.joinPubKey,
      this.id,
      this.network
    );

    if (!validJoinSig)
      throw new Error('join signature is not valid.');

    this.cosigners.push(cosigner);
  }

  /**
   * Remove cosigner
   * @returns {Cosigner}
   */

  popCosigner() {
    assert(this.cosigners.length > 0, 'No cosigners in the wallet.');
    return this.cosigners.pop();
  }

  /**
   * Cosigner joins the wallet
   * @param {Cosigner} cosigner
   * @returns {Promise<MultisigWallet>}
   */

  join(cosigner) {
    assert(this.cosigners.length < this.n, 'Multisig wallet is full.');
    assert(Cosigner.isCosigner(cosigner), 'Join needs cosigner.');

    return this.msdb.join(this.wid, cosigner);
  }

  /**
   * Authenticate with cosignerToken
   * @param {Buffer} cosignerToken
   * @returns {Cosigner|null}
   */

  auth(cosignerToken) {
    for (const cosigner of this.cosigners) {
      if (this.verifyToken(cosigner, cosignerToken))
        return cosigner;
    }

    throw new Error('Authentication error.');
  }

  /**
   * Set new token for cosigner
   * @param {Cosigner} cosigner
   * @param {Buffer} token
   * @returns {Cosigner}
   */

  async setToken(cosigner, token) {
    assert(Cosigner.isCosigner(cosigner));
    assert(Buffer.isBuffer(token));
    assert(token.length === 32);

    // NOTE: cosigner, wcosigner, and newCosigner will be same.(refs)
    const wcosigner = this.cosigners[cosigner.id];

    // increment
    wcosigner.tokenDepth += 1;
    wcosigner.token = token;

    const mswallet = await this.msdb.save(this);
    const newCosigner = mswallet.cosigners[cosigner.id];

    return newCosigner;
  }

  /**
   * Get account
   * @async
   * @returns {Promise<MultisigAccount>}
   */

  async getAccount() {
    const account = await this.wallet.getAccount(0);

    return MultisigAccount.fromAccount(account);
  }

  /**
   * Lock the coins in txdb
   * @param {Outpoint} outpoint
   */

  lockCoin(outpoint) {
    this.wallet.lockCoin(outpoint);
  }

  /**
   * Unlock transaction in txdb
   * @param {Outpoint} outpoint
   */

  unlockCoin(outpoint) {
    this.wallet.unlockCoin(outpoint);
  }

  /**
   * Create transaction
   * This won't lock the coins
   * NOTE: Transaction will not have
   * input scripts/witness scripted.
   * @async
   * @param {Object} options
   * @param {Number} options.rate - fee calculation rate
   * @param {Number} options.maxFee - maximum allowed fee
   * @param {String} options.selection - Coin selection priority. Can
   * be `age`, `random`, or `all`. (default=age).
   * @param {Boolean} options.free - Do not apply a fee if the
   * transaction priority is high enough to be considered free.
   * @param {Boolean} options.smart - smart coin selection
   * @param {Boolean} options.subtractFee - whether to subtract fee from output
   * @param {Number} options.subtractIndex - output index to subtract
   * @param {Number} options.depth - number of confirmations
   * @param {Amount?} options.hardFee - Use a hard fee rather than
   * calculating one.
   * @param {Output[]} options.outputs - transaction outputs
   * @returns {Promise<bcoin.MTX>}
   */

  async createTX(options) {
    const unlock = await this.coinLock.lock();

    try {
      return await this._createTX(options);
    } finally {
      unlock();
    }
  }

  /**
   * Create transaction lock
   * @param {Object} options {@link {MultisigWallet#createTX}
   * @returns {Promise<bcoin.MTX>}
   */

  _createTX(options) {
    assert(options && typeof options === 'object');
    return this.wallet.createTX(options);
  }

  /**
   * Create proposal
   * @async
   * @param {Object} options - proposal options.
   * @param {Cosigner} cosigner
   * @param {Object} txoptions
   * @param {Buffer} signature
   * @returns {[Proposal, MTX]}
   */

  async createProposal(options, cosigner, txoptions, signature) {
    const unlock = await this.coinLock.lock();

    try {
      return await this._createProposal(
        options,
        cosigner,
        txoptions,
        signature
      );
    } finally {
      unlock();
    }
  }

  /**
   * Create proposal without lock
   * @async
   * @param {Object} options - proposal options.
   * @param {Object} options.txoptions - transaction options.
   * @param {Cosigner} cosigner
   * @param {Object} txoptions
   * @param {Buffer} signature
   * @returns {[Proposal, MTX]}
   */

  async _createProposal(options, cosigner, txoptions, signature) {
    const mtx = await this._createTX(txoptions);
    const proposal = await this.pdb.createProposal(
      options,
      cosigner,
      mtx,
      signature
    );

    return [proposal, mtx];
  }

  /**
   * Get proposal
   * @async
   * @param {Number} id
   * @returns {Promise<Proposal?>}
   */

  getProposal(id) {
    return this.pdb.getProposal(id);
  }

  /**
   * Get proposal with MTX
   * @param {Number} id
   * @returns {Promise<Proposal, bcoin.MTX>}
   */

  async getProposalMTX(id) {
    const tx = await this.getProposalTX(id);

    if (!tx)
      return null;

    const view = await this.wallet.getCoinView(tx);
    const mtx = MTX.fromTX(tx);
    mtx.view = view;

    return mtx;
  }

  /**
   * Get proposal TX
   * @param {Number} id
   * @returns {Promise<TX?>}
   */

  getProposalTX(id) {
    return this.pdb.getTX(id);
  }

  /**
   * Get proposal coins
   * @param {Number} id
   * @returns {Promise<Coin[]?>}
   */

  getProposalCoins(pid) {
    return this.pdb.getProposalCoins(pid);
  }

  /**
   * Get proposal by outpoint/coin
   * @async
   * @param {Outpoint|Coin} outpoint
   * @returns {Promise<Proposal?>}
   */

  getProposalByOutpoint(outpoint) {
    return this.pdb.getProposalByOutpoint(outpoint);
  }

  /**
   * Get proposal id by Outpoint/Coin
   * @async
   * @param {Outpoint|Coin} outpoint
   * @returns {Promise<Number>} - proposal id
   */

  getPIDByOutpoint(outpoint) {
    return this.pdb.getPIDByOutpoint(outpoint);
  }

  /**
   * Get coin by outpoint
   * @param {Hash} hash
   * @param {Number} index
   * @returns {Promise<Coin>}
   */

  getCoin(hash, index) {
    return this.wallet.getCoin(hash, index);
  }

  /**
   * Get transaction input paths
   * @async
   * @param {MTX} mtx
   * @returns {Promise<Path[]>}
   */

  async getInputPaths(mtx) {
    const hashes = mtx.getInputHashes();
    const paths = [];

    for (const hash of hashes) {
      const path = await this.wallet.getPath(hash);

      if (!path)
        paths.push(null);
      else
        paths.push(path);
    }

    return paths;
  }

  /**
   * Get rings
   * @param {MTX} mtx
   * @param {Path[]?} paths
   * @returns {Promise<KeyRing[]>}
   */

  async deriveInputs(mtx, paths) {
    if (!paths)
      paths = await this.getInputPaths(mtx);

    const rings = [];
    const account = await this.getAccount();

    for (const path of paths) {
      const ring = account.derivePath(path);

      if (!ring)
        rings.push(null);
      else
        rings.push(ring);
    }

    return rings;
  }

   /**
   * Get a coin viewpoint.
   * @param {TX} tx
   * @returns {Promise<CoinView>}
   */

  getCoinView(tx) {
    return this.wallet.getCoinView(tx);
  }

  /**
   * Get pending proposals
   * @returns {Promise<Proposal[]>}
   */

  getProposals() {
    return this.pdb.getProposals();
  }

  /**
   * Get pending proposals
   * @returns {Promise<Proposal[]>}
   */

  getPendingProposals() {
    return this.pdb.getPendingProposals();
  }

  /**
   * Reject proposal
   * @param {Number} id
   * @param {Cosigner} cosigner
   * @param {Signature} signature
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  rejectProposal(id, cosigner, signature) {
    return this.pdb.rejectProposal(id, cosigner, signature);
  }

  /**
   * Approve proposal
   * @param {Number} id
   * @param {Cosigner} cosigner
   * @param {Buffer[]} signatures
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  approveProposal(id, cosigner, signatures) {
    return this.pdb.approveProposal(id, cosigner, signatures);
  }

  /**
   * Broadcast proposal mtx.
   * @param {Number} id
   * @returns {Promise<TX>}
   * @throws {Error}
   */

  sendProposal(id) {
    return this.pdb.sendProposal(id);
  }

  /**
   * Broadcast transaction
   * @param {MTX} mtx
   * @returns {Promise}
   */

  send(mtx) {
    return this.msdb.send(mtx);
  }

  /*
   * Next TX related methods
   * Notify ProposalDB on new transactions
   * potentially unlocks some coins
   * and/or rejects proposals
   */

  /**
   * Transaction was added mempool or in chain
   * @param {bcoin.TX} tx
   * @returns {Promise}
   */

  addTX(tx, details) {
    return this.pdb.addTX(tx, details);
  }

  /**
   * Transaction was removed, it
   * was double spent
   * @param {bcoin.TX} tx
   * @param {bcoin.txdb.Details} details
   * @returns {Promise}
   */

  removeTX(tx, details) {
    return this.pdb.removeTX(tx, details);
  }

  /**
   * Transaction was confirmed in the block.
   * @param {bcoin.TX} tx
   * @param {bcoin.TXDB.Details} details
   * @returns {Promise}
   */

  confirmedTX(tx, details) {
    return this.pdb.confirmedTX(tx, details);
  }
}

/*
 * Helpers
 */

function fromU32(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(num, 0);
  return data;
}

function fromString(str) {
  const buf = Buffer.alloc(1 + str.length);
  buf[0] = str.length;
  buf.write(str, 1, str.length, 'ascii');
  return buf;
}

module.exports = MultisigWallet;
