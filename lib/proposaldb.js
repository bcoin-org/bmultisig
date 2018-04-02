/*!
 * proposaldb.js - proposal database
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const {MTX} = require('bcoin');
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
    const lockedCoins = await this.getLockedCoins();

    for (const coin of lockedCoins)
      this.wallet.lockCoin(coin);
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
   * @returns {Promise<Coin[]>}
   */

  getLockedCoins() {
    return Proposal.getCoins(this.bucket);
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

    return raw.readUInt32LE(0, true);
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
   * @param {Coin} coin
   * @returns {Promise<Proposal?>}
   */

  async getProposalByCoin(coin) {
    const pid = await Proposal.getPIDByCoin(this.bucket, coin);

    if (pid === -1)
      return null;

    const proposal = await Proposal.getProposal(this.bucket, pid);
    proposal.m = this.wallet.m;
    proposal.n = this.wallet.n;
    return proposal;
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

    if (!proposal.isRejected())
      return proposal;

    const coins = await Proposal.getProposalCoins(this.bucket, pid);
    const b = this.bucket.batch();

    for (const coin of coins)
      this.unlockCoin(b, proposal, coin);

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
    b.put(layout.D.build(), fromU32(depth + 1));
  }
}

/*
 * Helpers
 */

function fromU32(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(num, 0, true);
  return data;
}

module.exports = ProposalDB;
