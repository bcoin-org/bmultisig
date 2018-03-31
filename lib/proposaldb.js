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
   * Get locked coins
   * @async
   * @returns {Promise<Coin[]>}
   */

  getLockedCoins() {
    return Proposal.getCoins(this.bucket);
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

    return await Proposal.getProposal(this.bucket, pid);
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
      const proposal = await Proposal.getProposal(this.bucket, pid);
      proposal.m = this.wallet.m;
      proposal.n = this.wallet.n;
      return proposal;
    } finally {
      unlock();
    }
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
   * Increment proposal depth
   * @param {bdb#Batch} b
   * @param {Number} depth
   */

  static increment(b, depth) {
    b.put(layout.D.build(), fromU32(depth + 1));
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
   * Create proposal
   * @param {String} name
   * @param {Cosigner} cosigner
   * @param {MTX} tx
   * @returns {Proposal}
   */

  async createProposal(name, cosigner, tx) {
    assert(tx instanceof MTX);

    if (await Proposal.hasName(this.bucket, name))
      throw new Error('Proposal with that name already exists.');

    const b = this.bucket.batch();
    const id = this.depth;

    const proposal = Proposal.fromOptions({
      id: id,
      name: name,
      author: cosigner,
      tx: tx.toTX(),
      m: this.wallet.m,
      n: this.wallet.n
    });

    this.increment(b);

    for (const input of tx.inputs) {
      const coin = tx.view.getCoinFor(input);
      this.lockCoin(b, proposal, coin);
    }

    Proposal.saveProposalWithTX(b, proposal);

    await b.write();

    return proposal;
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
