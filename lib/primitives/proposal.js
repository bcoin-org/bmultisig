/*!
 * proposal.js - proposal object
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */
'use strict';

const assert = require('bsert');
const {enforce} = assert;
const bcoin = require('bcoin');
const {encoding, Struct} = require('bufio');
const {Outpoint, TX} = bcoin;
const Cosigner = require('./cosigner');
const util = require('../utils/common');
const custom = require('../utils/inspect');
const sigUtils = require('../utils/sig');
const layout = require('../layout').proposaldb;
const common = require('../common');
const {CREATE, REJECT} = common.payloadType;

const ZERO_SIG = Buffer.alloc(65, 0);

/**
 * Proposal status
 * @readonly
 * @enum {Number}
 */

const status = {
  PROGRESS: 0,

  // approved
  APPROVED: 1,  // transaction was approved (broadcast)

  // rejection reasons
  REJECTED: 2,  // user rejected
  DBLSPEND: 3,  // double spend
  VERIFY: 4     // transaction verification failure
};

const statusByVal = [
  'PROGRESS',
  'APPROVED',

  'REJECTED',
  'DBLSPEND',
  'VERIFY'
];

const statusMessages = [
  'Proposal is in progress.',

  'Proposal has been approved.',

  'Cosigners rejected the proposal.',
  'Coins used in the proposal were double spent',
  'Rejected due to non-signed transaction.'
];

const statusIsPending = (s) => {
  return s === status.PROGRESS;
};

const statusIsRejected = (s) => {
  return s === status.REJECTED
    || s === status.VERIFY
    || s === status.DBLSPEND;
};

const statusIsApproved = (s) => {
  return s === status.APPROVED;
};

/**
 * Payment proposal
 * @alias module:primitives.Proposal
 * @extends {Struct}
 * @property {Number} id
 * @property {String} memo
 * @property {Number} author
 * @property {TX?} tx
 * @property {status} status
 * @property {String} options
 * @property {Number} timestamp - user assigned timestamp.
 * @property {Number} createdAt - timestamp (seconds)
 * @property {Number} closedAt - timestamp (seconds) / rejected or approved.
 * @property {Number} m
 * @property {Number} n
 * @property {Number[]} approvals
 * @property {Number[]} rejections
 */

class Proposal extends Struct {
  /**
   * Create proposal
   * @param {Object} options
   * @param {String} options.memo
   * @param {Cosigner} options.author
   * @param {TX} options.tx
   */

  constructor(options) {
    super();

    this.id = 0;
    this.memo = '';
    this.author = 0;

    // authors signature
    this.signature = ZERO_SIG;

    // authors timestamp.
    this.timestamp = util.now();

    // json stringified object of options.
    // TODO?: Create struct for raw serialization
    this.options = '';

    this.createdAt = util.now();
    this.closedAt = 0;

    this.status = status.PROGRESS;

    this.m = 1;
    this.n = 2;

    this.approvals = new ApprovalsMapRecord();
    this.rejections = new RejectionsMapRecord();

    if (options)
      this.fromOptions(options);
  }

  /**
   * validate options
   * @param {Object} options
   */

  fromOptions(options) {
    assert(options && typeof options === 'object', 'Options are required.');
    assert((options.id >>> 0) === options.id, 'ID must be an u32.');
    assert(typeof options.memo === 'string', 'Bad proposal memo.');
    assert(options.memo.length > 1 && options.memo.length < 100,
      'memo must be under 100 bytes');
    assert((options.author & 0xff) === options.author, 'Author must be an u8.');

    assert((options.n & 0xff) === options.n, 'n must be an u8.');
    assert((options.m & 0xff) === options.m, 'm must be an u8.');
    assert(options.n > 1, 'n must be more than 1.');
    assert(options.m >= 1 && options.m <= options.n,
      'm must be between 1 and n.');

    assert(Number.isSafeInteger(options.timestamp) && options.timestamp >= 0,
      'timestamp must be an uint64.');

    assert(Buffer.isBuffer(options.signature), 'Signature must be a buffer.');
    assert(options.signature.length === 65, 'Signature must be 65 bytes.');

    assert(options.options && typeof options.options === 'object',
      'proposal options must be an object.');

    if (options.status != null) {
      assert(status[options.status], 'Incorrect status code.');
      this.status = options.status;
    }

    if (options.createdAt != null) {
      assert(Number.isSafeInteger(options.createdAt) && options.createdAt >= 0,
        'createdAt must be uint64.');
      this.createdAt = options.createdAt;
    }

    if (options.closedAt != null) {
      assert(!statusIsPending(options.status),
        'Proposal is still pending.'
      );

      assert(Number.isSafeInteger(options.closedAt) && options.closedAt >= 0,
        'closedAt must be uint64.');
      this.closedAt = options.closedAt;
    }

    this.id = options.id;
    this.memo = options.memo;
    this.author = options.author;
    this.timestamp = options.timestamp;
    this.signature = options.signature;
    this.options = JSON.stringify(options.options);

    this.m = options.m;
    this.n = options.n;

    return this;
  }

  /*
   * Struct methods
   */

  /**
   * Get JSON
   * @param {TX?} tx
   * @param {Cosigner[]?} cosigners
   * @param {Network} network
   * @returns {Object}
   */

  getJSON(tx, cosigners, network) {
    let txhex = null;

    if (tx)
      txhex = tx.toRaw().toString('hex');

    const cosignerDetails = {};
    const cosignerApprovals = this.approvals.getJSON();
    const cosignerRejections = this.rejections.getJSON();

    if (cosigners) {
      for (const [i, cosigner] of cosigners.entries())
        cosignerDetails[i] = cosigner.getJSON(false, network);
    }

    return {
      id: this.id,
      memo: this.memo,
      tx: txhex,
      author: this.author,
      approvals: cosignerApprovals,
      rejections: cosignerRejections,
      signature: this.signature.toString('hex'),
      options: JSON.parse(this.options),
      timestamp: this.timestamp,
      createdAt: this.createdAt,
      rejectedAt: this.isRejected() ? this.closedAt : null,
      approvedAt: this.isApproved() ? this.closedAt : null,
      m: this.m,
      n: this.n,
      statusCode: this.status,
      statusMessage: statusMessages[this.status],
      cosignerDetails: cosignerDetails
    };
  }

  /**
   * Recover proposal from object
   * @param {Object} json
   * @returns {Proposal}
   */

  fromJSON(json) {
    assert(json, 'Options are required.');

    assert((json.id >>> 0) === json.id, 'ID must be u32.');
    assert((json.author & 0xff) === json.author, 'Author must be u8.');

    assert(typeof json.memo === 'string', 'Bad proposal memo.');
    assert(json.memo.length > 1 && json.memo.length < 100,
      'Bad memo length.');

    assert((json.n & 0xff) === json.n, 'n must be u8.');
    assert((json.m & 0xff) === json.m, 'm must be u8.');
    assert(json.n > 1, 'n must be more than 1.');
    assert(json.m >= 1 && json.m <= json.n,
      'm must be between 1 and n.');

    assert(typeof json.signature === 'string',
      'signature must be a hex string.');
    assert(json.signature.length === 130, 'signature must be 65 bytes.');

    assert(Number.isSafeInteger(json.timestamp) && json.timestamp >= 0,
      'timestamp must be uint64');

    assert(Number.isSafeInteger(json.createdAt) && json.createdAt >= 0,
      'createdAt must be uint64.');
    assert(statusByVal[json.statusCode], 'Incorrect status code.');

    assert(!json.rejectedAt || !json.approvedAt,
      'Incorrect rejectedAt or approvedAt'
    );

    if (json.rejectedAt != null) {
      assert(Number.isSafeInteger(json.rejectedAt) && json.rejectedAt >= 0,
        'rejectedAt must be uint64.');

      this.closedAt = json.rejectedAt;
    }

    if (json.approvedAt != null) {
      assert(Number.isSafeInteger(json.approvedAt) && json.approvedAt >= 0,
        'approvedAt must be int64.');
      this.closedAt = json.approvedAt;
    }

    this.id = json.id;
    this.memo = json.memo;
    this.n = json.n;
    this.m = json.m;
    this.status = json.statusCode;
    this.author = json.author;
    this.signature = Buffer.from(json.signature, 'hex');
    this.timestamp = json.timestamp;
    this.options = JSON.stringify(json.options);

    this.createdAt = json.createdAt;

    this.approvals = ApprovalsMapRecord.fromJSON(json.approvals);
    this.rejections = RejectionsMapRecord.fromJSON(json.rejections);

    return this;
  }

  /**
   * inspect
   * @returns {Object}
   */

  [custom]() {
    return this.getJSON();
  }

  /**
   * Get size
   * @returns {Number}
   */

  getSize() {
    let size = 4; // id
    size += encoding.sizeVarString(this.memo, 'utf8');
    size += 1; // status
    size += 1; // author
    size += 65; // signature
    size += encoding.sizeVarString(this.options, 'utf8');
    size += 8; // timestamp
    size += 8; // createdAt
    size += 8; // closedAt

    size += this.approvals.getSize();
    size += this.rejections.getSize();

    return size;
  }

  /**
   * Write raw representation to buffer writer.
   * @override
   * @param {bufio.BufferWriter} bw
   * @returns {Buffer}
   */

  write(bw) {
    bw.writeU32(this.id);
    bw.writeVarString(this.memo, 'utf8');
    bw.writeU8(this.status);
    bw.writeU8(this.author);
    bw.writeBytes(this.signature);
    bw.writeVarString(this.options, 'utf8');
    bw.writeU64(this.timestamp);
    bw.writeU64(this.createdAt);
    bw.writeU64(this.closedAt);

    this.approvals.toWriter(bw);
    this.rejections.toWriter(bw);

    return bw;
  }

  /**
   * Read raw proposal data
   * @override
   * @param {BufferReader} br
   * @returns {Proposal}
   */

  read(br) {
    this.id = br.readU32();
    this.memo = br.readVarString('utf8');
    this.status = br.readU8();
    this.author = br.readU8();
    this.signature = br.readBytes(65);
    this.options = br.readVarString('utf8');
    this.timestamp  = br.readU64();
    this.createdAt = br.readU64();
    this.closedAt = br.readU64();

    this.approvals.fromReader(br);
    this.rejections.fromReader(br);

    return this;
  }

  /*
   * Proposal methods
   */

  /**
   * Check proposal equality
   * @param {Proposal} proposal
   * @returns {Boolean}
   */

  equals(proposal) {
    return this.id === proposal.id
      && this.memo === proposal.memo
      && this.m === proposal.m
      && this.n === proposal.n
      && this.author === proposal.author
      && this.status === proposal.status
      && this.options === proposal.options
      && this.timestamp === proposal.timestamp
      && this.createdAt === proposal.createdAt
      && this.closedAt === proposal.closedAt
      && this.signature.equals(proposal.signature)
      && this.approvals.equals(proposal.approvals)
      && this.rejections.equals(proposal.rejections);
  }

  /**
   * Check if status is pending
   * @returns {Boolean}
   */

  isPending() {
    return statusIsPending(this.status);
  }

  /**
   * Check if proposal is rejected
   * @returns {Boolean}
   */

  isRejected() {
    return statusIsRejected(this.status);
  }

  /**
   * Check if proposal is approved
   * @returns {Boolean}
   */

  isApproved() {
    return statusIsApproved(this.status);
  }

  /**
   * Update status of the proposal
   * @throws {Error}
   */

  updateStatus() {
    assert(this.isPending(), 'Can not update non pending proposal.');

    const rejections = this.rejections.size;
    const critical = this.n - this.m + 1;

    if (rejections >= critical) {
      this.status = status.REJECTED;
      this.closedAt = util.now();
      return;
    }

    if (this.approvals.size === this.m) {
      this.status = status.APPROVED;
      this.closedAt = util.now();
      return;
    }
  }

  /**
   * Reject proposal
   * @param {Cosigner} cosigner
   * @param {Buffer} signature
   * @throws {Error}
   */

  reject(cosigner, signature) {
    assert(cosigner instanceof Cosigner, 'cosigner is not correct.');
    assert(this.isPending(), 'Can not reject non pending proposal.');
    assert(Buffer.isBuffer(signature), 'Signature must be a buffer.');
    assert(signature.length === 65, 'Signature must be 65 bytes.');

    if (this.approvals.has(cosigner.id))
      throw new Error('Cosigner already approved.');

    if (this.rejections.has(cosigner.id))
      throw new Error('Cosigner already rejected.');

    this.rejections.set(cosigner.id, signature);
    this.updateStatus();
  }

  /**
   * Reject proposal with status
   * @param {status} status
   * @throws {Error}
   */

  forceReject(status) {
    assert(this.isPending(), 'Can not reject non pending proposal.');

    if (!statusIsRejected(status))
      throw new Error('status needs to be a rejection.');

    this.status = status;
  }

  /**
   * Approve proposal
   * @param {Cosigner} cosigner
   * @param {SignatureOption[]} signatures
   * @throws {Error}
   */

  approve(cosigner, signatures) {
    enforce(cosigner instanceof Cosigner, 'cosigner', 'Cosigner');
    enforce(Array.isArray(signatures), 'signatures', 'SignatureOption');
    assert(this.isPending(), 'Can not approve non pending proposal.');

    if (this.rejections.has(cosigner.id))
      throw new Error('Cosigner already rejected.');

    if (this.approvals.has(cosigner.id))
      throw new Error('Cosigner already approved.');

    const signaturesRecord = SignaturesRecord.fromSignatures(signatures);
    this.approvals.set(cosigner.id, signaturesRecord);
    this.updateStatus();
  }

  /**
   * Apply all signatures to MTX
   * @param {Number} id
   * @param {MultisigMTX} mtx
   * @param {bcoin.Ring[]} rings
   */

  applySignatures(id, mtx, rings) {
    const signatures = this.approvals.get(id);

    return mtx.applySignatures(rings, signatures.toSignatures());
  }

  /*
   * Signature utils.
   */

  /**
   * Get proposal hash for signing.
   * @param {String} walletName
   * @param {ProposalPayloadType} type
   * @returns {Buffer}
   */

  getProposalHash(walletName, type) {
    return sigUtils.getProposalHash(walletName, type, this.options);
  }

  /**
   * Verify proposal hash.
   * @param {String} walletName
   * @param {ProposalPayloadType} type
   * @param {Signature} signature
   * @param {CompressedPublicKey} authPubKey
   * @returns {Boolean}
   */

  verifySignature(walletName, type, signature, authPubKey) {
    const hash = this.getProposalHash(walletName, type);

    return sigUtils.verifyHash(hash, signature, authPubKey);
  }

  /**
   * Verify rejection signature.
   * @param {String} walletName
   * @param {Signature} signature
   * @param {CompressedPublicKey} authPubKey
   */

  verifyRejectSignature(walletName, signature, authPubKey) {
    return this.verifySignature(walletName, REJECT, signature, authPubKey);
  }

  /**
   * Verify author proposal signature
   * @param {CompressedPublicKey} authPubKey
   * @returns {Boolean}
   */

  verifyCreateSignature(walletName, authPubKey) {
    return this.verifySignature(walletName, CREATE, this.signature, authPubKey);
  }

  /*
   * Proposal layout
   * @param {bdb#Bucket} - for getting from db
   * @param {bdb#Batch} - for writing to db
   */

  /*
   * Get
   * @param {bdb#Bucket} db
   */

  /**
   * Get all locked Outpoints for coin
   * @returns {Promise<Outpoint[]>}
   */

  static getOutpoints(db) {
    return db.range({
      gte: layout.c.min(),
      lte: layout.c.max(),
      parse: (key) => {
        const [hash, index] = layout.c.decode(key);
        const outpoint = new Outpoint();
        outpoint.hash = hash;
        outpoint.index = index;

        return outpoint;
      }
    });
  }

  /**
   * Get locked coins by proposal
   * @param {Number} pid
   */

  static getProposalOutpoints(db, pid) {
    return db.range({
      gte: layout.C.min(pid),
      lte: layout.C.max(pid),
      parse: (key) => {
        const [,hash, index] = layout.C.decode(key);
        const outpoint = new Outpoint();
        outpoint.hash = hash;
        outpoint.index = index;

        return outpoint;
      }
    });
  }

  /**
   * Get pending proposals
   * @returns {Promise<Proposal[]>}
   */

  static getPendingProposals(db) {
    return db.range({
      gte: layout.e.min(),
      lte: layout.e.max(),
      parse: key => key.slice(1)
    });
  }

  /**
   * Get proposals
   * @returns {Promise<Proposal[]>}
   */

  static getProposals(db) {
    return db.range({
      gte: layout.p.min(),
      lte: layout.p.max(),
      parse: (key, value) => {
        return Proposal.fromRaw(value);
      }
    });
  }

  /**
   * Has pid
   * @async
   * @param {Number} pid
   * @returns {Promise<Boolean>}
   */

  static has(db, pid) {
    return db.has(layout.p.encode(pid));
  }

  /**
   * Get proposal
   * @async
   * @param {bdb.Bucket} db
   * @param {Number} id
   * @returns {Promise<Proposal>}
   */

  static async getProposal(db, id) {
    const proposalData = await db.get(layout.p.encode(id));
    assert(proposalData);

    return Proposal.fromRaw(proposalData);
  }

  /**
   * Get transaction
   * @async
   * @param {bdb.Bucket} db
   * @param {Number} pid
   */

  static async getTX(db, pid) {
    const txdata = await db.get(layout.t.encode(pid));
    assert(txdata);

    return TX.fromRaw(txdata);
  }

  /**
   * Get proposal id by coin
   * @param {bcoin.Outpoint} outpoint
   * @returns {Promise<Number>}
   */

  static async getPIDByOutpoint(db, outpoint) {
    const pid = await db.get(layout.P.encode(outpoint.hash, outpoint.index));

    if (!pid)
      return -1;

    assert(pid.length === 4);
    return pid.readUInt32LE(0, true);
  }

  /*
   * put/del
   * @param {bdb#Batch} b
   */

  /**
   * Lock the proposal coins
   * @param {Proposal} proposal
   * @param {bcoin.Coin} coin
   */

  static lockCoin(b, proposal, coin) {
    b.put(layout.c.encode(coin.hash, coin.index));
    b.put(layout.C.encode(proposal.id, coin.hash, coin.index));
  }

  /**
   * Unlock the proposal coins
   * @param {Proposal} proposal
   * @param {Coin} coin
   */

  static unlockCoin(b, proposal, coin) {
    b.del(layout.c.encode(coin.hash, coin.index));
    b.del(layout.C.encode(proposal.id, coin.hash, coin.index));
  }

  /**
   * Save transaction
   * @param {Number} pid
   * @param {TX} tx
   */

  static saveTX(b, pid, tx) {
    b.put(layout.t.encode(pid), tx.toRaw());
  }

  /**
   * Save proposal and update Pending statuses
   * @param {Proposal} proposal
   */

  static saveProposal(b, proposal) {
    const pid = proposal.id;

    b.put(layout.p.encode(pid), proposal.toRaw());

    if (proposal.isPending()) {
      b.put(layout.e.encode(pid));
    } else {
      b.del(layout.e.encode(pid));
      b.put(layout.f.encode(pid));
    }
  }

  /**
   * Save proposal id by coin
   * @param {Coin} coin
   * @param {Number} pid
   */

  static savePIDByCoin(b, coin, pid) {
    b.put(layout.P.encode(coin.hash, coin.index), fromU32(pid));
  }

  /**
   * Remove proposal id by coin mapping
   * @param {Coin|Outpoint} coin
   */

  static removePIDByCoin(b, coin) {
    b.del(layout.P.encode(coin.hash, coin.index));
  }
}

/**
 * Store map of rejection signture
 * @ignore
 * @property {Map} rejections - cosigner id -> Signature
 */

class RejectionsMapRecord extends Struct {
  constructor() {
    super();

    this.rejections = new Map();
  }

  /**
   * Get map size.
   * @returns {Number}
   */

  get size() {
    return this.rejections.size;
  }

  /**
   * Get signature
   * @param {Number} id
   * @returns {Signature}
   */

  get(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.rejections.get(id);
  }

  /**
   * @param {Number} id
   * @param {Signature} signature
   * @returns {MapRecord}
   */

  set(id, signature) {
    enforce((id & 0xff) === id, 'id', 'u8');
    assert(Buffer.isBuffer(signature), 'Signature must be a buffer.');
    assert(signature.length === 65, 'Signature must be 65 bytes.');

    this.rejections.set(id, signature);

    return this;
  }

  /**
   * @param {Number} id
   * @returns {Boolean}
   */

  has(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.rejections.has(id);
  }

  /**
   * Delete entry
   * @param {Number} id
   * @returns {Boolean}
   */

  delete(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.rejections.delete(id);
  }

  /**
   * Clear entries
   * @returns {MapRecord}
   */

  clear() {
    this.rejections.clear();
    return this;
  }

  /**
   * Get cosigner ids.
   * @returns {IterableIterator<Number>}
   */

  keys() {
    return this.rejections.keys();
  }

  /**
   * Get signatures
   * @returns {IterableIterator<Signature>}
   */

  values() {
    return this.rejections.values();
  }

  /**
   * Get entries
   * @returns {IterableIterator<[Number, Signature]>}
   */

  entries() {
    return this.rejections.entries();
  }

  /**
   * Get entries
   * @returns {IterableIterator<[Number, Signature]>}
   */

  [Symbol.iterator]() {
    return this.entries();
  }

  /*
   * Struct methods.
   */

  /**
   * Serialize object to json.
   * @return {Object}
   */

  getJSON() {
    const json = {};

    for (const [id, signature] of this.entries())
      json[id] = signature.toString('hex');

    return json;
  }

  /**
   * Create RejectionsMapRecord from JSON.
   * @param {Object} json - id => signature
   * @returns {RejectionsMapRecord}
   */

  fromJSON(json) {
    for (const [id, signature] of Object.entries(json))
      this.set(Number(id), Buffer.from(signature, 'hex'));

    return this;
  }

  /**
   * Get raw serialization size.
   * @returns {Number}
   */

  getSize() {
    // each element takes: 1(cosigner id) + 65 (Signature)
    return (this.size * 66) + 1;
  }

  /**
   * Serialize to buffer writer.
   * @param {BufferWriter} bw
   * @returns {BufferWriter}
   */

  write(bw) {
    bw.writeU8(this.size);

    for (const [id, signture] of this.rejections.entries()) {
      bw.writeU8(id);
      bw.writeBytes(signture);
    }

    return bw;
  }

  /**
   * Deserialize from buffer reader.
   * @param {BufferReader} br
   * @returns {RejectionsMapRecord}
   */

  read(br) {
    const mapSize = br.readU8();

    for (let i = 0; i < mapSize; i++) {
      const id = br.readU8();
      const signature = br.readBytes(65);

      this.set(id, signature);
    }

    assert(this.size === mapSize);

    return this;
  }

  /**
   * Check equality
   * @param {RejectionsMapRecord} record
   * @returns {Boolean}
   */

  equals(record) {
    enforce(RejectionsMapRecord.isRejectionsMapRecord(record),
      'record', 'RejectionsMapRecord');

    if (this.size !== record.size)
      return false;

    for (const [id, signature] of this.entries()) {
      const signature2 = record.get(id);

      if (!signature2)
        return false;

      if (!signature.equals(signature2))
        return false;
    }

    return true;
  }

  [custom]() {
    return this.getJSON();
  }

  /**
   * Check if the object is RejectionsMapRecord.
   * @param {Object} obj
   * @returns {Boolean}
   */

  static isRejectionsMapRecord(obj) {
    return obj instanceof this;
  }
}

/**
 * Store map of signatures by cosigner id
 * @ignore
 * @property {Map} approvals
 * @property {Number} inputs - number of inputs in transaction
 */

class ApprovalsMapRecord extends Struct {
  constructor() {
    super();

    this.approvals = new Map();
  }

  /*
   * Map methods
   */

  get size() {
    return this.approvals.size;
  }

  get(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.approvals.get(id);
  }

  set(id, signatures) {
    enforce((id & 0xff) === id, 'id', 'u8');
    enforce(
      SignaturesRecord.isSignatureRecord(signatures),
      'signatures',
      'SignaturesRecord'
    );

    this.approvals.set(id, signatures);
    return this;
  }

  has(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.approvals.has(id);
  }

  delete(id) {
    enforce((id & 0xff) === id, 'id', 'u8');
    return this.approvals.delete(id);
  }

  clear() {
    this.approvals.clear();
  }

  keys() {
    return this.approvals.keys();
  }

  values() {
    return this.approvals.values();
  }

  entries() {
    return this.approvals.entries();
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  /*
   * Struct methods.
   */

  getJSON() {
    const json = {};

    for (const [key, signatures] of this.entries())
      json[key] = signatures.getJSON();

    return json;
  }

  fromJSON(json) {
    enforce(json && typeof json === 'object', 'json', 'object');

    for (const [id, signatures] of Object.entries(json))
      this.set(Number(id), SignaturesRecord.fromJSON(signatures));

    return this;
  }

  getSize() {
    let size = 1;

    for (const signatures of this.approvals.values()) {
      size += 1; // number of signatures.
      size += signatures.getSize();
    }

    return size;
  }

  write(bw) {
    bw.writeU8(this.approvals.size);
    for (const [key, signatures] of this.approvals.entries()) {
      bw.writeU8(key);
      signatures.write(bw);
    }

    return bw;
  }

  read(br) {
    const mapSize = br.readU8();

    for (let i = 0; i < mapSize; i++) {
      const key = br.readU8();
      const value = SignaturesRecord.fromReader(br);

      this.set(key, value);
    }

    assert(this.size === mapSize);

    return this;
  }

  equals(approvedRecord) {
    enforce(ApprovalsMapRecord.isApprovalsMapRecord(approvedRecord),
      'approvedRecord', 'ApprovalsMapRecord');

    if (approvedRecord.size !== this.size)
      return false;

    for (const [i, sigRecord] of this.entries()) {
      const sigRecord2 = approvedRecord.get(i);

      if (!sigRecord2)
        return false;

      if (!sigRecord.equals(sigRecord2))
        return false;
    }

    return true;
  }

  [custom]() {
    return this.getJSON();
  }

  static isApprovalsMapRecord(obj) {
    return obj instanceof this;
  }
}

/**
 * Array of signatures
 * @ignore
 * @property {SignatureOption[]} signatures
 */

class SignaturesRecord extends Struct {
  /**
   * Create Signatures Record
   * @param {SignatureOption[]} [signatures]
   */

  constructor(signatures) {
    super();

    this.size = 0;
    this.signatures = new Map();

    if (signatures)
      this.fromSignatures(signatures);
  }

  getJSON() {
    const signatures = new Array(this.size);

    for (const [i, signature] of this.signatures.entries())
      signatures[i] = signature.toString('hex');

    return signatures;
  }

  fromJSON(json) {
    enforce(Array.isArray(json), 'json', 'array');

    this.size = json.length;

    for (const [i, signature] of json.entries()) {
      if (!signature)
        continue;

      this.signatures.set(i, Buffer.from(signature, 'hex'));
    }

    return this;
  }

  /**
   * Get size for raw serialization.
   * @returns {Number}
   */

  getSize() {
    let size = 2; // size and map size

    for (const signature of this.signatures.values())
      size += 1 + encoding.sizeVarBytes(signature);

    return size;
  }

  /**
   * Serialize to raw encoding.
   * @param {BufferWriter} bw
   * @returns {BufferWriter}
   */

  write(bw) {
    bw.writeU8(this.size);
    bw.writeU8(this.signatures.size);

    for (const [i, signature] of this.signatures.entries()) {
      bw.writeU8(i);
      bw.writeVarBytes(signature);
    }

    return bw;
  }

  /**
   * Deserialize from raw encoding.
   * @param {BufferReader} br
   * @returns {SignaturesRecord}
   */

  read(br) {
    const size = br.readU8();
    const mapSize = br.readU8();

    this.size = size;

    for (let i = 0; i < mapSize; i++) {
      const key = br.readU8();
      const value = br.readVarBytes();

      this.signatures.set(key, value);
    }

    return this;
  }

  /**
   * Checks SignaturesRecord equality
   * @param {SignaturesRecord} sigrecord
   * @returns {Boolean}
   */

  equals(sigrecord) {
    assert(SignaturesRecord.isSignatureRecord(sigrecord));

    if (this.signatures.size !== sigrecord.signatures.size)
      return false;

    for (const [i, signature] of this.signatures.entries()) {
      const signature2 = sigrecord.signatures.get(i);

      if (!signature2)
        return false;

      if (!signature.equals(signature2))
        return false;
    }

    return true;
  }

  toSignatures() {
    const signatures = new Array(this.size);

    for (const [i, signature] of this.signatures.entries())
      signatures[i] = signature;

    return signatures;
  }

  /**
   * create signature record from signatures array
   * @param {SignatureOption[]} signatures
   * @returns {SignaturesRecord}
   */

  fromSignatures(signatures) {
    assert(Array.isArray(signatures));

    this.size = signatures.length;

    for (const [i, signature] of signatures.entries()) {
      if (!signature)
        continue;

      this.signatures.set(i, signature);
    }

    return this;
  }

  [custom]() {
    return this.getJSON();
  }

  /**
   * Checks if obj is SignaturesRecord
   * @param {Object} obj
   * @returns {Boolean}
   */

  static isSignatureRecord(obj) {
    return obj instanceof this;
  }

  /**
   * Create SignaturesRecord from signatures
   * @param {SignatureOption[]} signatures
   * @returns {SignaturesRecord}
   */

  static fromSignatures(signatures) {
    return new this(signatures);
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

/*
 * Expose
 */

Proposal.statusMessages = statusMessages;
Proposal.statussByVal = statusByVal;
Proposal.status = status;
Proposal.payloadType = common.payloadType;
Proposal.payloadTypeByVal = common.payloadTypeByVal;
Proposal.ApprovalsMapRecord = ApprovalsMapRecord;
Proposal.SignaturesRecord = SignaturesRecord;
Proposal.RejectionsMapRecord = RejectionsMapRecord;

module.exports = Proposal;
