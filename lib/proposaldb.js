/*!
 * proposaldb.js - proposal database
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const {enforce} = assert;
const {Struct} = require('bufio');
const {Outpoint, MTX} = require('bcoin');
const MultisigMTX = require('./primitives/mtx');
const Proposal = require('./primitives/proposal');
const Cosigner = require('./primitives/cosigner');
const {MapLock, Lock} = require('bmutex');
const {BufferMap} = require('buffer-map');
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
   * @param {bcoin#Outpoint} outpoint
   */

  unlockCoin(b, proposal, outpoint) {
    this.wallet.unlockCoinTXDB(outpoint);

    Proposal.unlockCoin(b, proposal, outpoint);
    Proposal.removePIDByCoin(b, outpoint);
    this.emit('unlocked coin', proposal, outpoint);
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

  async getProposalOutpoints(id) {
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

    const statsDelta = new ProposalStats();

    for (const input of tx.inputs) {
      const coin = view.getCoinFor(input);

      if (!coin)
        continue;

      statsDelta.addOwnLockedCoin(1);
      statsDelta.addOwnLockedBalance(coin.value);

      this.lockCoin(b, proposal, coin);
    }

    statsDelta.addPending(1);
    statsDelta.addProposals(1);

    Proposal.saveProposal(b, proposal);
    Proposal.saveTX(b, proposal.id, tx);

    await this._updateStats(b, statsDelta);
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

    // this will check the status of the proposal.
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
    const statsDelta = new ProposalStats();

    statsDelta.addPending(-1);
    statsDelta.addRejected(1);

    for (const outpoint of outpoints) {
      const coin = await this.wallet.getCoin(outpoint.hash, outpoint.index);
      statsDelta.addOwnLockedCoin(-1);
      statsDelta.addOwnLockedBalance(-coin.value);
      this.unlockCoin(b, proposal, outpoint);
    }

    Proposal.saveProposal(b, proposal);
    await this._updateStats(b, statsDelta);
    await b.write();

    this.emit('proposal rejected', proposal, cosigner);

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

    const statsDelta = new ProposalStats();
    const proposal = await this._getProposal(pid);

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
      statsDelta.addPending(-1);
      statsDelta.addApproved(1);

      const b = this.bucket.batch();
      Proposal.saveProposal(b, proposal);
      Proposal.saveTX(b, proposal.id, msMTX);
      await this._updateStats(b, statsDelta);
      await b.write();

      this.emit('proposal approved', proposal, cosigner, msMTX);

      return proposal;
    }

    // should not happen
    const b = this.bucket.batch();

    // TODO: reuse coins from MTX
    const outpoints = await this.getProposalOutpoints(pid);

    for (const outpoint of outpoints) {
      statsDelta.addOwnLockedCoin(-1);
      statsDelta.addOwnLockedBalance(-outpoint.value);
      this.unlockCoin(b, proposal, outpoint);
    }

    proposal.status = Proposal.status.VERIFY;
    Proposal.saveProposal(b, proposal);
    statsDelta.addApproved(-1);
    statsDelta.addRejected(1);

    await this._updateStats(statsDelta);
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
   * @private
   * @param {Outpoint[]} outpoints
   * @param {TX} tx
   * @param {TXDetails} details
   * @return {Map}
   */

  async getCoinMap(outpoints, tx, details) {
    const coinMap = new BufferMap();

    for (const [i, input] of details.inputs.entries()) {
      if (input.path) {
        const op = tx.inputs[i].prevout;
        coinMap.set(op.toKey(), input.value);
      }
    }

    for (const [i, output] of details.outputs.entries()) {
      if (output.path) {
        const op = Outpoint.fromTX(tx, i);
        coinMap.set(op.toKey(), output.value);
      }
    }

    for (const outpoint of outpoints) {
      const key = outpoint.toKey();
      const value = coinMap.get(key);

      if (value == null) {
        const coin = await this.wallet.getCoin(outpoint.hash, outpoint.index);
        coinMap.set(key, coin.value);
      }
    }

    return coinMap;
  }

  /**
   * Reject proposal if it is pending
   * rejects double spent proposals
   * @private
   * @param {Number} pid
   * @returns {Boolean}
   */

  async _unlockProposalCoins(pid, tx, details) {
    const proposal = await this._getProposal(pid);

    if (!proposal || proposal.isRejected())
      return false;

    const outpoints = await Proposal.getProposalOutpoints(this.bucket, pid);
    const coinMap = await this.getCoinMap(outpoints, tx, details);

    if (proposal.isApproved()) {
      const b = this.bucket.batch();
      const statsDelta = new ProposalStats();

      for (const outpoint of outpoints) {
        const value = coinMap.get(outpoint.toKey());
        assert(value != null);
        statsDelta.addOwnLockedCoin(-1);
        statsDelta.addOwnLockedBalance(-value);
        this.unlockCoin(b, proposal, outpoint);
      }

      await this._updateStats(b, statsDelta);
      await b.write();

      return true;
    }

    assert(proposal.isPending());

    proposal.forceReject(Proposal.status.DBLSPEND);

    const b = this.bucket.batch();
    const statsDelta = new ProposalStats();

    statsDelta.addPending(-1);
    statsDelta.addRejected(1);

    for (const outpoint of outpoints) {
      const value = coinMap.get(outpoint.toKey());
      assert(value != null);
      statsDelta.addOwnLockedCoin(-1);
      statsDelta.addOwnLockedBalance(-value);
      this.unlockCoin(b, proposal, outpoint);
    }

    Proposal.saveProposal(b, proposal);
    await this._updateStats(b, statsDelta);
    await b.write();

    this.emit('proposal rejected', proposal);

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
      await this._unlockProposalCoins(pid, tx, details);
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
        await this._unlockProposalCoins(pid, tx, details);
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

    const outpoints = await this.getProposalOutpoints(pid);
    const statsDelta = new ProposalStats();

    const b = this.bucket.batch();

    proposal.forceReject(status);
    statsDelta.addPending(-1);
    statsDelta.addRejected(1);

    for (const outpoint of outpoints) {
      const coin = await this.wallet.getCoin(outpoint.hash, outpoint.index);
      statsDelta.addOwnLockedCoin(-1);
      statsDelta.addOwnLockedBalance(-coin.value);
      this.unlockCoin(b, proposal, outpoint);
    }

    Proposal.saveProposal(b, proposal);
    await this._updateStats(b, statsDelta);
    await b.write();

    this.emit('proposal rejected', proposal);

    return proposal;
  }

  /**
   * Get proposal db stats
   */

  async getStats() {
    const raw = await this.bucket.get(layout.S.encode());

    if (!raw)
      return new ProposalStats();

    return ProposalStats.fromRaw(raw);
  }

  async updateStats(b, statsDelta) {
    const unlock = this.writeLock.lock();

    try {
      return await this._updateStats(b, statsDelta);
    } finally {
      unlock();
    }
  }

  async _updateStats(b, statsDelta) {
    assert(statsDelta instanceof ProposalStats);
    const currentStats = await this.getStats();
    currentStats.apply(statsDelta);
    ProposalDB.saveStats(b, currentStats);
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

  /**
   * Save stats
   * @param {bdb#Batch} b
   * @param {ProposalStats} stats
   */

  static saveStats(b, stats) {
    b.put(layout.S.encode(), stats.toRaw());
  }
}

/**
 * General information about proposals.
 * Locked coins is number of coins we have locked.
 * Locked balance is sum of all coins.
 * @alias module:multisig.ProposalStats
 * @property {Number} lockedOwnCoins - Locked coins that belong to wallet.
 * @property {Number} lockedOwnBalance - Sum of all lockedOwnCoins.
 * @property {Number} proposals - Number of proposals(should be same as Depth)
 * @property {Number} pending - Number of pending proposals.
 * @property {Number} approved - Number of approved proposals.
 * @property {Number} rejected - NUmber of rejected proposals.
 */
class ProposalStats extends Struct {
  constructor() {
    super();

    this.lockedOwnCoins = 0;
    this.lockedOwnBalance = 0;
    this.proposals = 0;
    this.pending = 0;
    this.approved = 0;
    this.rejected = 0;
  }

  size() {
    return 32;
  }

  write(bw) {
    bw.writeU64(this.lockedOwnCoins);
    bw.writeU64(this.lockedOwnBalance);
    bw.writeU32(this.proposals);
    bw.writeU32(this.pending);
    bw.writeU32(this.approved);
    bw.writeU32(this.rejected);

    return bw;
  }

  read(br) {
    this.lockedOwnCoins = br.readU64();
    this.lockedOwnBalance = br.readU64();
    this.proposals = br.readU32();
    this.pending = br.readU32();
    this.approved = br.readU32();
    this.rejected = br.readU32();

    return this;
  }

  fromJSON(json) {
    enforce(json, 'json', 'object');
    enforce(Number.isSafeInteger(json.lockedOwnCoins),
      'json.lockedOwnCoins', 'u64');
    enforce(Number.isSafeInteger(json.lockedOwnBalance),
      'json.lockedOwnBalance', 'u64');
    enforce((json.proposals >>> 0) === json.proposals,
      'json.proposals', 'u32');
    enforce((json.pending >>> 0) === json.pending,
      'json.pending', 'u32');
    enforce((json.approved >>> 0) === json.approved,
      'json.approved', 'u32');
    enforce((json.rejected >>> 0) === json.rejected,
      'json.rejected', 'u32');

    this.lockedOwnCoins = json.lockedOwnCoins;
    this.lockedOwnBalance = json.lockedOwnBalance;
    this.proposals = json.proposals;
    this.pending = json.pending;
    this.approved = json.approved;
    this.rejected = json.rejected;

    return this;
  }

  getJSON() {
    return {
      lockedOwnCoins: this.lockedOwnCoins,
      lockedOwnBalance: this.lockedOwnBalance,
      proposals: this.proposals,
      pending: this.pending,
      approved: this.approved,
      rejected: this.rejected
    };
  }

  /**
   * Apply another info to the current one.
   * We use proposal info to track existing
   * progress on the fly and apply in the end.
   * @param {ProposalStats} info
   * @returns {ProposalStats}
   */

  apply(info) {
    this.lockedOwnCoins += info.lockedOwnCoins;
    this.lockedOwnBalance += info.lockedOwnBalance;
    this.proposals += info.proposals;
    this.pending += info.pending;
    this.approved += info.approved;
    this.rejected += info.rejected;

    assert(this.lockedOwnCoins >= 0);
    assert(this.lockedOwnBalance >= 0);
    assert(this.proposals >= 0);
    assert(this.pending >= 0);
    assert(this.approved >= 0);
    assert(this.rejected >= 0);

    return this;
  }

  addOwnLockedCoin(value) {
    this.lockedOwnCoins += value;
  }

  addOwnLockedBalance(value) {
    this.lockedOwnBalance += value;
  }

  addProposals(value) {
    this.proposals += value;
  }

  addPending(value) {
    this.pending += value;
  }

  addApproved(value) {
    this.approved += value;
  }

  addRejected(value) {
    this.rejected += value;
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

ProposalDB.ProposalStats = ProposalStats;

module.exports = ProposalDB;
