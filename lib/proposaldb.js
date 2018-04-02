/*!
 * proposaldb.js - proposal database
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const {CoinView, MTX} = require('bcoin');
const Proposal = require('./proposal');
const {MapLock, Lock} = require('bmutex');
const layout = require('./layout').proposaldb;

/**
 * Proposal DB
 */

class ProposalDB {
  /**
   * Create ProposalsDB
   * @constructor
   * @param {MultisigDB} msdb
   * @param {Number} wid
   */

  constructor(msdb, wid) {
    this.msdb = msdb;
    this.db = msdb.db;
    this.logger = msdb.logger;

    this.wid = wid || 0;
    this.bucket = null;
    this.wallet = null;
    this.depth = 0;

    this.readLock = new MapLock();
    this.writeLock = new Lock();
  }

  /**
   * Open ProposalsDB
   * @async
   * @param {MultisigWallet} wallet
   */

  async open(wallet) {
    const prefix = layout.prefix.build(wallet.wid);

    this.bucket = this.db.bucket(prefix);
    this.wid = wallet.wid;
    this.wallet = wallet;
    this.depth = await this.getDepth();

    // TODO: handle locked coins after reorgs.
    const lockedOutpoints = await this.getLockedOutpoints();

    for (const outpoint of lockedOutpoints)
      this.wallet.lockCoin(outpoint);
  }

  /**
   * Lock the coin in db and in txdb
   * @async
   * @param {bdb#Batch} b
   * @param {Proposal} proposal
   * @param {bcoin#Coin} coin
   */

  lockCoin(b, proposal, coin) {
    this.wallet.lockCoin(coin);

    Proposal.lockCoin(b, proposal, coin);
  }

  /**
   * Unlock the coin in db and in txdb
   * @param {bdb#Batch} b
   * @param {Proposal} proposal
   * @param {bcoin#Coin} coin
   */

  unlockCoin(b, proposal, coin) {
    this.wallet.unlockCoin(coin);

    Proposal.unlockCoin(b, proposal, coin);
  }

  /**
   * Get locked coins
   * @async
   * @returns {Promise<Outpoint[]>}
   */

  getLockedOutpoints() {
    return Proposal.getOutpoints(this.bucket);
  }

  /**
   * Get proposal depth
   * @returns {Number}
   */

  async getDepth() {
    const raw = await this.bucket.get(layout.D.build());

    if (!raw)
      return 0;

    assert(raw.length === 4);

    return raw.readUInt32BE(0, true);
  }

  /**
   * Increment depth
   * @async
   */

  async increment(b) {
    ProposalDB.increment(b);
    this.depth += 1;
  }

  /**
   * Resolve id or name
   * @param {String|Number} id
   * @returns {Promise<Number>}
   */

  async ensurePID(id) {
    if (typeof id === 'number') {
      if (await Proposal.has(this.bucket, id))
        return id;

      return -1;
    }

    return Proposal.getPID(this.bucket, id);
  }

  /**
   * List all pending proposals
   * @returns {Promise<String[]>}
   */

  async getPendingProposals() {
    const pending = await Proposal.getPendingProposals(this.bucket);
    const proposals = [];

    for (const pid of pending.map(toU32BE))
      proposals.push(await this._get(pid));

    return proposals;
  }

  /**
   * Get proposal with lock
   * @param {Number|String} id
   * @returns {Promise<Proposal>}
   */

  async get(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return this._get(pid);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal without lock
   * @param {Number} pid
   * @returns {Promise<Proposal>}
   */

  async _get(pid) {
    const proposal = await Proposal.getProposal(this.bucket, pid);
    proposal.m = this.wallet.m;
    proposal.n = this.wallet.n;
    return proposal;
  }

  /**
   * Get proposal with TX
   * @param {Number|String} id
   * @returns {Promise<Proposal>}
   */

  async getWithTX(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return this._getWithTX(pid);
    } finally {
      unlock();
    }
  }

  async _getWithTX(pid) {
    const proposal = await Proposal.getProposalWithTX(this.bucket, pid);
    proposal.m = this.wallet.m;
    proposal.n = this.wallet.n;
    return proposal;
  }

  /**
   * Get proposal transaction with readLock
   * @param {Number|String} id
   * @returns {Promise<TX?>}
   */

  async getTX(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return Proposal.getTX(this.bucket, pid);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal by coin
   * @async
   * @param {Outpoint} outpoint
   * @returns {Promise<Proposal?>}
   */

  async getProposalByOutpoint(outpoint) {
    const pid = await Proposal.getPIDByOutpoint(this.bucket, outpoint);

    if (pid === -1)
      return null;

    const proposal = await Proposal.getProposal(this.bucket, pid);
    proposal.m = this.wallet.m;
    proposal.n = this.wallet.n;
    return proposal;
  }

  /**
   * Get proposal coins (use only on pending proposals)
   * @param {pid} pid
   * @throws {Error}
   */

  async getProposalCoins(pid) {
    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const coins = [];

    for (const outpoint of outpoints) {
      const coin = await this.wallet.getCoin(outpoint.hash, outpoint.index);

      if (!coin)
        throw new Error('Could not find coin');

      coins.push(coin);
    }

    return coins;
  }

  /**
   * Create proposal
   * @param {String} name
   * @param {Cosigner} cosigner
   * @param {MTX} mtx
   * @returns {Promise<Proposal>}
   */

  async createProposal(name, cosigner, mtx) {
    const unlock = await this.writeLock.lock();

    try {
      return this._createProposal(name, cosigner, mtx);
    } finally {
      unlock();
    }
  }

  /**
   * Create proposal without lock
   * @param {String} name
   * @param {Cosigner} cosigner
   * @param {MTX} mtx
   * @returns {Promise<Proposal>}
   */

  async _createProposal(name, cosigner, mtx) {
    assert(mtx instanceof MTX);

    if (await Proposal.hasName(this.bucket, name))
      throw new Error('Proposal with that name already exists.');

    const b = this.bucket.batch();
    const id = this.depth;

    const proposal = Proposal.fromOptions({
      id: id,
      name: name,
      author: cosigner,
      tx: mtx.toTX(),
      m: this.wallet.m,
      n: this.wallet.n
    });

    this.increment(b);

    for (const input of mtx.inputs) {
      const coin = mtx.view.getCoinFor(input);
      this.lockCoin(b, proposal, coin);
    }

    Proposal.saveProposalWithTX(b, proposal);

    await b.write();

    return proposal;
  }

  /**
   * Reject proposal
   * @param {Number|String} id
   * @param {Cosigner} cosigner
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  async rejectProposal(id, cosigner) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      throw new Error('Proposal not found.');

    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      return this._rejectProposal(pid, cosigner);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Reject proposal without locks
   * @param {Number} pid
   * @param {Cosigner} cosigner
   * @returns {Promise<Proposal>}
   */

  async _rejectProposal(pid, cosigner) {
    const proposal = await this._get(pid);

    proposal.reject(cosigner);

    if (!proposal.isRejected()) {
      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      await b.write();
      return proposal;
    }

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const b = this.bucket.batch();

    for (const outpoint of outpoints)
      this.unlockCoin(b, proposal, outpoint);

    Proposal.saveProposal(b, proposal);

    await b.write();

    return proposal;
  }

  /**
   * Approve proposal
   * NAIVE
   * @param {Number|String} id
   * @param {Cosigner} cosigner
   * @param {TX} tx
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  async approveProposal(id, cosigner, tx) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      throw new Error('Proposal not found.');

    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      return this._approveProposal(pid, cosigner, tx);
    } finally {
      unlock2();
      unlock1();
    }
  }

  async _approveProposal(pid, cosigner, tx) {
    const proposal = await this._getWithTX(pid);

    proposal.approve(cosigner);

    // TODO: accept only signatures for inputs
    // Or extract them from submitted tranasction
    // HACK: save signed transaction for now
    // with no validation....
    proposal.tx = tx;

    if (proposal.isPending()) {
      const b = this.bucket.batch();
      Proposal.saveProposalWithTX(b, proposal);
      await b.write();
      return proposal;
    }

    // tx is approved
    const coins = await this.getProposalCoins(pid);
    const view = new CoinView();
    const mtx = MTX.fromTX(proposal.tx);

    for (const coin of coins) {
      view.addCoin(coin);
    }

    mtx.view = view;

    const verify = mtx.verify();

    if (verify) {
      const b = this.bucket.batch();
      Proposal.saveProposalWithTX(b, proposal);
      await b.write();

      // send the transaction
      await this.wallet.send(mtx);

      return proposal;
    }

    // incorrect tx / reject tx.
    const b = this.bucket.batch();

    for (const coin of coins)
      this.unlockCoin(b, proposal, coin);

    proposal.status = Proposal.status.VERIFY;
    Proposal.saveProposal(b, proposal);

    await b.write();

    return proposal;
  }

  /*
   * layout
   */

  /**
   * Increment proposal depth
   * @param {bdb#Batch} b
   * @param {Number} depth
   */

  static increment(b, depth) {
    b.put(layout.D.build(), fromU32BE(depth + 1));
  }
}

/*
 * Helpers
 */

function fromU32BE(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32BE(num, 0, true);
  return data;
}

function toU32BE(buf) {
  return buf.readUInt32BE(0, true);
}

module.exports = ProposalDB;
