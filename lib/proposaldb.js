/*!
 * proposaldb.js - proposal database
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const {enforce} = assert;
const {Outpoint, MTX} = require('bcoin');
const MultisigMTX = require('./primitives/mtx');
const Proposal = require('./primitives/proposal');
const {MapLock, Lock} = require('bmutex');
const layout = require('./layout').proposaldb;

/**
 * Proposal DB
 * @property {MultisigDB} msdb
 * @property {BDB} db
 * @property {Number} wid
 * @property {Bucket} bucket
 * @property {MultisigWallet} wallet
 * @property {Number} depth
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
    const prefix = layout.prefix.encode(wallet.wid);

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
    const raw = await this.bucket.get(layout.D.encode());

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
   * List all proposals
   * @returns {Promise<Proposal[]>}
   */

  getProposals() {
    return Proposal.getProposals(this.bucket);
  }

  /**
   * List all pending proposals
   * @returns {Promise<Proposal[]>}
   */

  async getPendingProposals() {
    const pending = await Proposal.getPendingProposals(this.bucket);
    const proposals = [];

    for (const pid of pending.map(toU32BE))
      proposals.push(await this._getProposal(pid));

    return proposals;
  }

  /**
   * Get proposal with lock
   * @param {Number|String} id
   * @returns {Promise<Proposal>}
   */

  async getProposal(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return this._getProposal(pid);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal without lock
   * @param {Number} pid
   * @returns {Promise<Proposal>}
   */

  async _getProposal(pid) {
    const proposal = await Proposal.getProposal(this.bucket, pid);
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
      return this._getTX(pid);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal transaction without lock.
   * @param {Number} id
   * @returns {Promise<TX?>}
   */

  _getTX(pid) {
    return Proposal.getTX(this.bucket, pid);
  }

  /**
   * Get proposal transaction with coinview
   * with lock.
   * @param {Number|String} id
   * @returns {Promise<MTX?>}
   */

  async getMTX(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return this._getMTX(id);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal transaction with coinview
   * without lock.
   * @param {Number} id
   * @returns {Promise<MTX?>}
   */

  async _getMTX(id) {
    const tx = await this._getTX(id);
    const view = await this.wallet.getCoinView(tx);
    const mtx = MTX.fromTX(tx);
    mtx.view = view;

    return mtx;
  }

  /**
   * Get proposal by coin/outpoint
   * @async
   * @param {Outpoint} outpoint
   * @returns {Promise<Proposal?>}
   */

  async getProposalByOutpoint(outpoint) {
    const pid = await this.getPIDByOutpoint(outpoint);

    if (pid === -1)
      return null;

    return this.getProposal(pid);
  }

  /**
   * Get proposal ID by coin, outpoint
   * @async
   * @param {Outpoint} outpoint
   * @returns {Promise<Number>} Proposal ID
   */

  getPIDByOutpoint(outpoint) {
    return Proposal.getPIDByOutpoint(this.bucket, outpoint);
  }

  /**
   * Get proposal coins (use only on pending proposals)
   * @param {Number|String} id
   * @throws {Error}
   */

  async getProposalCoins(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

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

    const [tx, view] = mtx.commit();

    // Should we store empty MTX,
    // we will need to clean up inputs
    // Should we cache relevant information?
    //  Rings, Paths ? (We are storing coins for reorgs).
    const proposal = Proposal.fromOptions({
      id: id,
      name: name,
      author: cosigner.id,
      m: this.wallet.m,
      n: this.wallet.n
    });

    this.increment(b);

    for (const input of tx.inputs) {
      const coin = view.getCoinFor(input);

      if (!coin)
        continue;

      this.lockCoin(b, proposal, coin);
      Proposal.savePIDByCoin(b, coin, proposal.id);
    }

    Proposal.saveProposal(b, proposal);
    Proposal.saveTX(b, proposal.id, tx);

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
    const proposal = await this._getProposal(pid);

    proposal.reject(cosigner);

    if (!proposal.isRejected()) {
      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      await b.write();
      return proposal;
    }

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const b = this.bucket.batch();

    for (const outpoint of outpoints) {
      this.unlockCoin(b, proposal, outpoint);
      Proposal.removePIDByCoin(b, outpoint);
    }

    Proposal.saveProposal(b, proposal);

    await b.write();

    return proposal;
  }

  /**
   * Approve proposal
   * NAIVE
   * @param {Number|String} id
   * @param {Cosigner} cosigner
   * @param {Buffer[]} signatures
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  async approveProposal(id, cosigner, signatures) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      throw new Error('Proposal not found.');

    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      return this._approveProposal(pid, cosigner, signatures);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Approve proposal without lock.
   * @param {Number} pid
   * @param {Cosigner} cosigner
   * @param {Buffer[]} signatures
   * @throws {Error}
   */

  async _approveProposal(pid, cosigner, signatures) {
    enforce(Array.isArray(signatures), 'signatures', 'Array');

    const proposal = await this._getProposal(pid);

    // fail early.
    assert(proposal.isPending(), 'Proposal is not pending.');

    const mtx = await this._getMTX(pid);
    const msMTX = MultisigMTX.fromMTX(mtx);
    msMTX.view = mtx.view;

    const rings = await this.wallet.deriveInputs(mtx);
    const check = this.deriveRings(cosigner, rings);
    const valid = msMTX.checkSignatures(rings, signatures);

    if (valid !== check)
      throw new Error('Signature(s) incorrect.');

    proposal.approve(cosigner, signatures);

    if (proposal.isPending()) {
      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      await b.write();
      return proposal;
    }

    // save signed proposal.
    for (const cosigner of this.wallet.cosigners) {
      this.deriveRings(cosigner, rings);

      const applied = proposal.applySignatures(cosigner.id, msMTX, rings);

      if (!applied)
        throw new Error('Could not apply.');
    }

    const verify = msMTX.verify();

    if (verify) {
      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      Proposal.saveTX(b, proposal.id, msMTX);
      await b.write();

      return proposal;
    }

    // should not happen
    const b = this.bucket.batch();

    // TODO: reuse coins from MTX
    const coins = await this.getProposalByOutpoint(pid);

    for (const coin of coins)
      this.unlockCoin(b, proposal, coin);

    proposal.status = Proposal.status.VERIFY;
    Proposal.saveProposal(b, proposal);

    await b.write();

    return proposal;
  }

  /**
   * Derive rings for cosigner
   * @param {Cosigner} cosigner
   * @param {KeyRing[]} rings
   * @returns {Number} - number of rings
   */

  deriveRings(cosigner, rings) {
    let check = 0;

    for (const ring of rings) {
      if (!ring)
        continue;

      const pubkey = cosigner.deriveKey(ring.branch, ring.index).publicKey;
      ring.publicKey = pubkey;
      ring.witness = this.wallet.witness;
      ring.nested = ring.branch === 2;
      check++;
    }

    return check;
  }

  /**
   * Reject proposal if it is pending
   * rejects double spent proposals
   * @private
   * @param {Number} pid
   */

  async rejectPending(pid) {
    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      await this._rejectPending(pid);
    } finally {
      unlock1();
      unlock2();
    }
  }

  async _rejectPending(pid) {
    const proposal = await this._getProposal(pid);

    if (!proposal || !proposal.isPending())
      return;

    proposal.forceReject(Proposal.status.DBLSPEND);

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const b = this.bucket.batch();

    for (const outpoint of outpoints) {
      this.unlockCoin(b, proposal, outpoint);
      Proposal.removePIDByCoin(b, outpoint);
    }

    Proposal.saveProposal(b, proposal);

    await b.write();

    return;
  }

  /**
   * Reject proposals if transaction
   * contains same coins and proposal
   * is pending
   * @private
   * @param {TX} tx
   */

  async rejectProposalByTX(tx) {
    if (tx.isCoinbase())
      return;

    const pids = new Set();

    for (const {prevout} of tx.inputs) {
      const pid = await this.getPIDByOutpoint(prevout);

      if (pid !== -1)
        pids.add(pid);
    }

    const readUnlocks = [];
    const writeUnlock = await this.writeLock.lock();

    for (const pid of pids)
      readUnlocks.push(await this.readLock.lock(pid));

    try {
      for (const pid of pids) {
        await this._rejectPending(pid);
      }
    } finally {
      for (const readUnlock of readUnlocks)
        readUnlock();

      writeUnlock();
    }
  }

  /**
   * Send approved proposal.
   * @param {Number|String} id
   * @returns {Promise<TX>}
   * @throws {Error}
   */

  async sendProposal(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      throw new Error('Proposal not found.');

    const unlock = await this.readLock.lock(pid);

    try {
      return this._sendProposal(pid);
    } finally {
      unlock();
    }
  }

  async _sendProposal(pid) {
    const proposal = await this._getProposal(pid);

    assert(proposal.isApproved(), 'Can only send approved proposal tx.');

    const tx = await this._getTX(pid);
    await this.wallet.send(tx);

    return tx;
  }

  /**
   * Transaction was added in mempool or chain.
   * Check if we have proposal using same Coins.
   * reject if necessary.
   * @private
   * @param {bcoin#TX} tx
   * @param {bcoin#TXDB#Details} details
   */

  addTX(tx, details) {
    return this.rejectProposalByTX(tx);
  }

  /**
   * Transaction was confirmed.
   * Check if we have proposal using same Coins.
   * reject if necessary.
   * @private
   * @param {bcoin#TX} tx
   * @param {bcoin#TXDB#Details} details
   */

  confirmedTX(tx, details) {
    return this.rejectProposalByTX(tx);
  }

  /**
   * Transaction was removed.
   * Check if we have coins in removed transaction.
   * Reject proposal if necessary.
   * @private
   * @param {bcoin#TX} tx
   * @param {bcoin#TXDB#Details} details
   */

  async removeTX(tx, details) {
    const pids = new Set();

    for (let i = 0; i < tx.outputs.length; i++) {
      const outpoint = Outpoint.fromTX(tx, i);
      const pid = await this.getPIDByOutpoint(outpoint);

      if (pid !== -1)
        pids.add(pid);
    }

    const readUnlocks = [];
    const writeUnlock = await this.writeLock.lock();

    for (const pid of pids)
      readUnlocks.push(await this.readLock.lock(pid));

    try {
      for (const pid of pids) {
        await this._rejectPending(pid);
      }
    } finally {
      for (const unlock of readUnlocks)
        unlock();

      writeUnlock();
    }
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
    b.put(layout.D.encode(), fromU32BE(depth + 1));
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
