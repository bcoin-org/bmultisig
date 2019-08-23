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
const Cosigner = require('./primitives/cosigner');
const {MapLock, Lock} = require('bmutex');
const layout = require('./layout').proposaldb;

/**
 * Proposal DB
 * @alias module:multisig.ProposalDB
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
   * @param {Number} [wid=0]
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
      this.wallet.lockCoinTXDB(outpoint);
  }

  /**
   * Emit proposal event.
   * @param {String} event
   * @param {Object} data
   * @param {Object} details
   */

  emit(event, ...args) {
    this.msdb.emit(event, this.wallet, ...args);
    this.wallet.emit(event, ...args);
  }

  /**
   * Lock the coin in db and in txdb
   * @async
   * @param {bdb#Batch} b
   * @param {Proposal} proposal
   * @param {bcoin#Coin} coin
   */

  lockCoin(b, proposal, coin) {
    this.wallet.lockCoinTXDB(coin);

    Proposal.lockCoin(b, proposal, coin);
    Proposal.savePIDByCoin(b, coin, proposal.id);
  }

  /**
   * Unlock the coin in db and in txdb
   * @param {bdb#Batch} b
   * @param {Proposal} proposal
   * @param {bcoin#Coin} coin
   */

  unlockCoin(b, proposal, coin) {
    this.wallet.unlockCoinTXDB(coin);

    Proposal.unlockCoin(b, proposal, coin);
    Proposal.removePIDByCoin(b, coin);
    this.emit('unlocked coin', proposal, coin);
  }

  /**
   * Test if coin is locked.
   * @param {Outpoint} outpoint
   * @returns {Boolean}
   */

  async isLocked(outpoint) {
    return Proposal.hasOutpoint(this.bucket, outpoint);
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
   * @returns {Promise<Number>}
   */

  async getDepth() {
    const raw = await this.bucket.get(layout.D.encode());

    if (!raw)
      return 0;

    assert(raw.length === 4);

    return raw.readUInt32BE(0);
  }

  /**
   * Increment depth
   * @async
   */

  async increment(b) {
    ProposalDB.increment(b, this.depth);
    this.depth += 1;
  }

  /**
   * Resolve id
   * TODO: Clean up, now we use only pid,
   * so extra check is no longer necessary.
   * @param {Number} id
   * @returns {Promise<Number>}
   */

  async ensurePID(id) {
    assert(typeof id === 'number');

    if (await Proposal.has(this.bucket, id))
      return id;

    return -1;
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
    const pending = await Proposal.getPendingProposalIDs(this.bucket);
    const proposals = [];

    for (const pid of pending)
      proposals.push(await this._getProposal(pid));

    return proposals;
  }

  /**
   * Get proposal with lock
   * @param {Number} id
   * @returns {Promise<Proposal>}
   */

  async getProposal(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return await this._getProposal(pid);
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
   * @param {Number} id
   * @returns {Promise<TX?>}
   */

  async getTX(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return await this._getTX(pid);
    } finally {
      unlock();
    }
  }

  /**
   * Get proposal transaction without lock.
   * @param {Number} pid
   * @returns {Promise<TX?>}
   */

  _getTX(pid) {
    return Proposal.getTX(this.bucket, pid);
  }

  /**
   * Get proposal transaction with coinview
   * with lock.
   * @param {Number} id
   * @returns {Promise<MTX?>}
   */

  async getMTX(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    const unlock = await this.readLock.lock(pid);

    try {
      return await this._getMTX(id);
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
   * Get proposal IDs by tx inputs. (no locks)
   * @param {TX} tx
   * @returns {Promise<Number[]>}
   */

  async getPIDsByTX(tx) {
    if (tx.isCoinbase())
      return [];

    const pids = new Set();

    for (const {prevout} of tx.inputs) {
      const pid = await this.getPIDByOutpoint(prevout);

      if (pid !== -1)
        pids.add(pid);
    }

    return Array.from(pids);
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
   * @param {Number} id
   * @throws {Error}
   */

  async getProposalCoins(id) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      return null;

    return Proposal.getProposalOutpoints(this.bucket, pid);
  }

  /**
   * Create proposal
   * @param {Object} options
   * @param {String} options.memo
   * @param {Number} options.timestamp
   * @param {Cosigner} cosigner
   * @param {MTX} mtx
   * @param {Signature} signature
   * @returns {Promise<Proposal>}
   */

  async createProposal(options, cosigner, mtx, signature) {
    const unlock = await this.writeLock.lock();

    try {
      return await this._createProposal(options, cosigner, mtx, signature);
    } finally {
      unlock();
    }
  }

  /**
   * Create proposal without lock
   * @param {Object} options - original options.
   * @param {String} options.memo
   * @param {Number} options.timestamp
   * @param {Cosigner} cosigner
   * @param {MTX} mtx
   * @param {Buffer} signature
   * @returns {Promise<Proposal>}
   */

  async _createProposal(options, cosigner, mtx, signature) {
    enforce(options && typeof options === 'object', 'options', 'object');
    enforce(cosigner instanceof Cosigner, 'cosigner', 'Cosigner');
    enforce(Buffer.isBuffer(signature), 'signature', 'buffer');
    assert(signature.length === 65, 'signature must be 65 bytes.');
    enforce(MTX.isMTX(mtx), 'mtx', 'MTX');

    const b = this.bucket.batch();
    const id = this.depth;

    const [tx, view] = mtx.commit();

    // Should we store empty MTX,
    // we will need to clean up inputs
    // Should we cache relevant information?
    //  Rings, Paths ? (We are storing coins for reorgs).
    const proposal = Proposal.fromOptions({
      id: id,
      memo: options.memo,
      timestamp: options.timestamp,
      signature: signature,
      author: cosigner.id,
      m: this.wallet.m,
      n: this.wallet.n,
      options: options
    });

    const walletName = this.wallet.id;

    if (!proposal.verifyCreateSignature(walletName, cosigner.authPubKey))
      throw new Error('proposal signature is not valid.');

    this.increment(b);

    for (const input of tx.inputs) {
      const coin = view.getCoinFor(input);

      if (!coin)
        continue;

      this.lockCoin(b, proposal, coin);
    }

    Proposal.saveProposal(b, proposal);
    Proposal.saveTX(b, proposal.id, tx);

    await b.write();

    this.emit('proposal created', proposal, tx);

    return proposal;
  }

  /**
   * Reject proposal
   * @param {Number} id
   * @param {Cosigner} cosigner
   * @param {Signature} signature
   * @returns {Promise<Proposal>}
   * @throws {Error}
   */

  async rejectProposal(id, cosigner, signature) {
    const pid = await this.ensurePID(id);

    if (pid === -1)
      throw new Error('Proposal not found.');

    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      return await this._rejectProposal(pid, cosigner, signature);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Reject proposal without locks
   * @param {Number} pid
   * @param {Cosigner} cosigner
   * @param {Signature} signature
   * @returns {Promise<Proposal>}
   */

  async _rejectProposal(pid, cosigner, signature) {
    enforce(cosigner instanceof Cosigner, 'cosigner', 'Cosigner');
    enforce(Buffer.isBuffer(signature), 'signature', 'buffer');
    assert(signature.length === 65, 'signature must be 65 bytes.');

    const proposal = await this._getProposal(pid);

    const validSignature = proposal.verifyRejectSignature(
      this.wallet.id,
      signature,
      cosigner.authPubKey
    );

    if (!validSignature)
      throw new Error('rejection signature is not valid.');

    proposal.reject(cosigner, signature);

    if (!proposal.isRejected()) {
      const b = this.bucket.batch();

      Proposal.saveProposal(b, proposal);
      await b.write();

      this.emit('proposal rejected', proposal, cosigner);
      return proposal;
    }

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const b = this.bucket.batch();

    for (const outpoint of outpoints)
      this.unlockCoin(b, proposal, outpoint);

    Proposal.saveProposal(b, proposal);

    this.emit('proposal rejected', proposal, cosigner);

    await b.write();

    return proposal;
  }

  /**
   * Approve proposal
   * @param {Number} id
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
      return await this._approveProposal(pid, cosigner, signatures);
    } finally {
      unlock2();
      unlock1();
    }
  }

  async _approveProposal(pid, cosigner, signatures) {
    enforce(Cosigner.isCosigner(cosigner), 'cosigner', 'Cosigner');
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

      this.emit('proposal approved', proposal, cosigner);

      return proposal;
    }

    for (const id of proposal.approvals.keys()) {
      const cosigner = this.wallet.cosigners[id];

      this.deriveRings(cosigner, rings);
      const applied = proposal.applySignatures(id, msMTX, rings);

      if (!applied)
        throw new Error('Could not apply.');
    }

    const verify = msMTX.verify();

    if (verify) {
      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      Proposal.saveTX(b, proposal.id, msMTX);
      await b.write();

      this.emit('proposal approved', proposal, cosigner, msMTX);

      return proposal;
    }

    // should not happen
    const b = this.bucket.batch();

    // TODO: reuse coins from MTX
    const coins = await this.getProposalCoins(pid);

    for (const coin of coins)
      this.unlockCoin(b, proposal, coin);

    proposal.status = Proposal.status.VERIFY;
    Proposal.saveProposal(b, proposal);

    await b.write();

    this.emit('proposal rejected', proposal);

    return proposal;
  }

  /**
   * Derive rings for cosigner
   * @param {Cosigner} cosigner
   * @param {bcoin.KeyRing[]} rings
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
   * @returns {Boolean}
   */

  async _unlockProposalCoins(pid) {
    const proposal = await this._getProposal(pid);

    if (!proposal || proposal.isRejected())
      return false;

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);

    if (proposal.isApproved()) {
      const b = this.bucket.batch();

      for (const outpoint of outpoints)
        this.unlockCoin(b, proposal, outpoint);

      await b.write();

      return true;
    }

    assert(proposal.isPending());

    proposal.forceReject(Proposal.status.DBLSPEND);

    const b = this.bucket.batch();

    for (const outpoint of outpoints)
      this.unlockCoin(b, proposal, outpoint);

    Proposal.saveProposal(b, proposal);

    this.emit('proposal rejected', proposal);

    await b.write();

    return true;
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
      return await this._sendProposal(pid);
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
   * Reject proposals if transaction
   * contains same coins and proposal
   * is pending. Unlock coins if the proposal
   * has been approved.
   * @private
   * @param {TX} tx
   * @param {Details} details
   */

  async _addTX(tx, details) {
    if (tx.isCoinbase())
      return;

    const pids = await this.getPIDsByTX(tx);

    for (const pid of pids)
      await this._unlockProposalCoins(pid);
  }

  /**
   * Transaction was added in mempool.
   * @private
   * @param {bcoin#TX} tx
   * @param {bcoin#TXDB#Details} details
   */

  async addTX(tx, details) {
    const pids = await this.getPIDsByTX(tx);

    const readUnlocks = [];
    const writeUnlock = await this.writeLock.lock();

    for (const pid of pids)
      readUnlocks.push(await this.readLock.lock(pid));

    try {
      return await this._addTX(tx, details);
    } finally {
      for (const unlock of readUnlocks)
        unlock();

      writeUnlock();
    }
  }

  /**
   * Transaction was confirmed.
   * @private
   * @param {bcoin#TX} tx
   * @param {bcoin#TXDB#Details} details
   */

  async confirmedTX(tx, details) {
    const pids = await this.getPIDsByTX(tx);

    const readUnlocks = [];
    const writeUnlock = await this.writeLock.lock();

    for (const pid of pids)
      readUnlocks.push(await this.readLock.lock(pid));

    try {
      return await this._addTX(tx, details);
    } finally {
      for (const unlock of readUnlocks)
        unlock();

      writeUnlock();
    }
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
        await this._unlockProposalCoins(pid);
      }
    } finally {
      for (const unlock of readUnlocks)
        unlock();

      writeUnlock();
    }
  }

  /**
   * Force reject proposal with locks.
   * @param {Number} id
   * @param {status} [status = status.FORCE]
   * @returns {Promise<Proposal>}
   */

  async forceRejectProposal(id, status = Proposal.status.FORCE) {
    const pid = await this.ensurePID(id);

    const unlock1 = await this.readLock.lock(pid);
    const unlock2 = await this.writeLock.lock();

    try {
      return await this._forceRejectProposal(pid, status);
    } finally {
      unlock2();
      unlock1();
    }
  }

  /**
   * Force reject proposal.
   * @param {Number} pid
   * @returns {Promise<Proposal>}
   */

  async _forceRejectProposal(pid, status) {
    const proposal = await this._getProposal(pid);

    assert(proposal, 'Proposal not found.');
    assert(proposal.isPending(), 'Proposal is not pending.');

    const coins = await this.getProposalCoins(pid);

    const b = this.bucket.batch();

    proposal.forceReject(status);

    for (const coin of coins)
      this.unlockCoin(b, proposal, coin);

    Proposal.saveProposal(b, proposal);
    await b.write();

    this.emit('proposal rejected', proposal);

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
    b.put(layout.D.encode(), fromU32BE(depth + 1));
  }
}

/*
 * Helpers
 */

function fromU32BE(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32BE(num, 0);
  return data;
}

module.exports = ProposalDB;
