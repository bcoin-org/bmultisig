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
const layout = require('../layout').proposaldb;

/**
 * Signature or null
 * @typedef {Buffer?} SignatureOption
 */

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
  return s === status.REORG
    || s === status.REJECTED
    || s === status.VERIFY
    || s === status.DBLSPEND;
};

const statusIsApproved = (s) => {
  return s === status.APPROVED;
};

/**
 * Payment proposal
 * @extends {bufio#Struct}
 * @property {Number} id
 * @property {String} memo
 * @property {Number} author
 * @property {TX?} tx
 * @property {status} status
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
   * @param {String} options
   * @param {String} options.memo
   * @param {Cosigner} options.author
   * @param {TX} options.tx
   */

  constructor(options) {
    super();

    this.id = 0;
    this.memo = '';
    this.author = 0;
    this.createdAt = util.now();
    this.closedAt = 0;

    this.status = status.PROGRESS;

    this.m = 1;
    this.n = 2;

    this.approvals = new ApprovalsMapRecord();
    this.rejections = new RejectionsSetRecord();

    if (options)
      this.fromOptions(options);
  }

  /**
   * validate options
   * @param {Object} options
   */

  fromOptions(options) {
    assert(options, 'Options are required.');
    assert(isU32(options.id), 'ID must be u32');
    assert(typeof options.memo === 'string', 'Bad proposal memo.');
    assert(options.memo.length > 1 && options.memo.length < 160,
      'Bad memo length.');
    assert(isU8(options.author), 'Author must be u8.');
    assert(isU8(options.n), 'n must be u8.');
    assert(isU8(options.m), 'm must be u8.');
    assert(options.n > 1, 'n must be more than 1.');
    assert(options.m >= 1 && options.m <= options.n,
      'm must be between 1 and n.');

    if (options.status != null) {
      assert(status[options.status], 'Incorrect status code.');
      this.status = options.status;
    }

    if (options.createdAt != null) {
      assert(isU32(options.createdAt), 'createdAt must be u32.');
      this.createdAt = options.createdAt;
    }

    if (options.closedAt != null) {
      assert(!statusIsPending(options.status),
        'Proposal is still pending.'
      );

      assert(isU32(options.closedAt), 'closedAt must be u32.');
      this.closedAt = options.closedAt;
    }

    this.id = options.id;
    this.memo = options.memo;
    this.author = options.author;

    this.m = options.m;
    this.n = options.n;

    return this;
  }

  /*
   * Struct methods
   */

  /**
   * Get JSON
   * @param {TX} tx
   * @returns {Object}
   */

  getJSON(tx) {
    let txhex = null;

    if (tx)
      txhex = tx.toRaw().toString('hex');

    return {
      id: this.id,
      memo: this.memo,
      tx: txhex,
      author: this.author,
      approvals: this.approvals.toJSON(),
      rejections: this.rejections.toJSON(),
      createdAt: this.createdAt,
      rejectedAt: this.isRejected() ? this.closedAt : null,
      approvedAt: this.isApproved() ? this.closedAt : null,
      m: this.m,
      n: this.n,
      statusCode: this.status,
      statusMessage: statusMessages[this.status]
    };
  }

  /**
   * Get JSON
   * @param {TX} tx
   * @returns {Object}
   */

  toJSON(tx) {
    return this.getJSON(tx);
  }

  /**
   * Recover proposal from object
   * @param {Object} json
   * @returns {Proposal}
   */

  fromJSON(json) {
    assert(json, 'Options are required.');
    assert(isU32(json.id), 'ID must be u32.');
    assert(isU8(json.author), 'Author must be u8.');
    assert(typeof json.memo === 'string', 'Bad proposal memo.');
    assert(json.memo.length > 1 && json.memo.length < 160,
      'Bad memo length.');
    assert(isU8(json.n), 'n must be u8.');
    assert(isU8(json.m), 'm must be u8.');
    assert(json.n > 1, 'n must be more than 1.');
    assert(json.m >= 1 && json.m <= json.n,
      'm must be between 1 and n.');
    assert(isU32(json.createdAt), 'createdAt must be u32.');
    assert(statusByVal[json.statusCode], 'Incorrect status code.');
    assert(!json.rejectedAt || !this.approvedAt,
      'Incorrect rejectedAt or approvedAt'
    );

    if (json.rejectedAt != null) {
      assert(isU32(json.rejectedAt), 'rejectedAt must be u32.');
      this.closedAt = this.rejectedAt;
    }

    if (json.approvedAt != null) {
      assert(isU32(json.approvedAt), 'approvedAt must be u32.');
      this.closedAt = this.approvedAt;
    }

    this.id = json.id;
    this.memo = json.memo;
    this.n = json.n;
    this.m = json.m;
    this.status = json.statusCode;

    this.author = json.author;
    this.createdAt = json.createdAt;

    // NOTE: Approvals won't store signatures into JSON
    this.approvals = ApprovalsMapRecord.fromJSON(json.approvals);
    this.rejections = RejectionsSetRecord.fromJSON(json.rejections);

    return this;
  }

  /**
   * inspect
   * @returns {Object}
   */

  inspect() {
    return this.getJSON();
  }

  /**
   * Get size
   * @returns {Number}
   */

  getSize() {
    let size = 4; // id
    size += 1; // memo size (1 byte < 255)
    size += this.memo.length;
    size += 1; // status
    size += 1; // author
    size += 4; // createdAt
    size += 4; // closedAt

    size += this.approvals.getSize();
    size += this.rejections.getSize();

    return size;
  }

  /**
   * Write raw representation to buffer writer.
   * @param {BufferWriter} bw
   * @returns {Buffer}
   */

  write(bw) {
    bw.writeU32(this.id);
    bw.writeU8(this.memo.length);
    bw.writeBytes(Buffer.from(this.memo, 'utf8'));
    bw.writeU8(this.status);
    bw.writeU8(this.author);
    bw.writeU32(this.createdAt);
    bw.writeU32(this.closedAt);

    this.approvals.toWriter(bw);
    this.rejections.toWriter(bw);

    return bw;
  }

  /**
   * Read raw proposal data
   * @param {BufferReader} br
   * @returns {Proposal}
   */

  read(br) {
    this.id = br.readU32();

    const length = br.readU8();
    this.memo = br.readBytes(length).toString('utf8');
    this.status = br.readU8();
    this.author = br.readU8();
    this.createdAt = br.readU32();
    this.closedAt = br.readU32();

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
      && this.createdAt === proposal.createdAt
      && this.closedAt === proposal.closedAt
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
   * @throws {Error}
   */

  reject(cosigner) {
    assert(cosigner instanceof Cosigner, 'cosigner is not correct.');
    assert(this.isPending(), 'Can not reject non pending proposal.');

    if (this.approvals.has(cosigner.id))
      throw new Error('Cosigner already approved.');

    if (this.rejections.has(cosigner.id))
      throw new Error('Cosigner already rejected.');

    this.rejections.add(cosigner.id);
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
   * @param {Ring} ring
   */

  applySignatures(id, mtx, rings) {
    const signatures = this.approvals.get(id);

    return mtx.applySignatures(rings, signatures.toSignatures());
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
   * @param {Number} pid
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
   * @param {bdb#Bucket} db
   * @param {Number} pid
   */

  static async getTX(db, pid) {
    const txdata = await db.get(layout.t.encode(pid));
    assert(txdata);

    return TX.fromRaw(txdata);
  }

  /**
   * Get proposal id by coin
   * @param {Outpoint} outpoint
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
   * @param {Coin} coin
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
 * Store set of rejections
 * @property {Set} rejections
 */

class RejectionsSetRecord extends Struct {
  /**
   * Initiate rejection set from set
   */

  constructor() {
    super();

    this.rejections = new Set();
  }

  fromSet(cosigners) {
    enforce(cosigners instanceof Set, 'cosigners', 'Set');

    for (const id of cosigners.values())
      this.add(id);

    return this;
  }

  /**
   * Initialize from set of rejections
   * @param {Set} cosigners
   * @return {RejectionsSetRecord}
   */

  static fromSet(cosigners) {
    return new this().fromSet(cosigners);
  }

  /*
   * Set Methods
   */

  get size() {
    return this.rejections.size;
  }

  add(id) {
    enforce(isU8(id), 'id', 'u8');
    this.rejections.add(id);
    return this;
  }

  has(id) {
    enforce(isU8(id), 'id', 'u8');
    return this.rejections.has(id);
  }

  delete(id) {
    enforce(isU8(id), 'id', 'u8');
    return this.rejections.delete(id);
  }

  clear() {
    this.rejections.clear();
  }

  values() {
    return this.rejections.values();
  }

  entries() {
    return this.rejections.entries();
  }

  [Symbol.iterator]() {
    return this.rejections.entries();
  }

  /*
   * Struct methods
   */

  getJSON() {
    return this.toArray();
  }

  fromJSON(json) {
    enforce(Array.isArray(json), 'json', 'Array');
    return this.fromArray(json);
  }

  fromArray(cosigners) {
    enforce(Array.isArray(cosigners), 'cosigners', 'Array');

    for (const id of cosigners)
      this.add(id);

    return this;
  }

  static fromArray(cosigners) {
    return new this().fromArray(cosigners);
  }

  toArray() {
    const cosigners = [];

    for (const id of this.values())
      cosigners.push(id);

    return cosigners;
  }

  /**
   * Get raw serialization size.
   * This is set of U8s.
   * @returns {Number}
   */

  getSize() {
    return this.size + 1;
  }

  /**
   * Serialize
   * @param {BufferWriter} bw
   * @returns {BufferWriter}
   */

  write(bw) {
    bw.writeU8(this.size);
    for (const value of this.values())
      bw.writeU8(value);

    return bw;
  }

  /**
   * Deserialize
   * @param {BufferReader} br
   * @returns {RejectionsSetRecord}
   */

  read(br) {
    const size = br.readU8();

    for (let i = 0; i < size; i++) {
      const key = br.readU8();

      this.add(key);
    }

    assert(this.size === size, 'Incorrect number of elements.');
  }

  /**
   * Check equality to other rejection set record.
   * @param {RejectionsSetRecord} rejectionsRecord
   * @returns {Boolean}
   */

  equals(rejectionsRecord) {
    enforce(
      RejectionsSetRecord.isRejectionsSetRecord(rejectionsRecord),
      'obj',
      'RejectionsSetRecord'
    );

    if (rejectionsRecord.size !== this.size)
      return false;

    for (const value of this.values()) {
      if (!rejectionsRecord.has(value))
        return false;
    }

    return true;
  }

  /**
   * Is object RejectionsSetRecord?
   * @param {Object} obj
   * @returns {Boolean}
   */

  static isRejectionsSetRecord(obj) {
    return obj instanceof RejectionsSetRecord;
  }
}

/**
 * Store map of signatures by cosigner id
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
    enforce(isU8(id), 'id', 'u8');
    return this.approvals.get(id);
  }

  set(id, signatures) {
    enforce(isU8(id), 'id', 'u8');
    enforce(
      SignaturesRecord.isSignatureRecord(signatures),
      'signatures',
      'SignaturesRecord'
    );

    this.approvals.set(id, signatures);
    return this;
  }

  has(id) {
    enforce(isU8(id), 'id', 'u8');
    return this.approvals.has(id);
  }

  delete(id) {
    enforce(isU8(id), 'id', 'u8');
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
    const cosigners = [];

    for (const key of this.keys())
      cosigners.push(key);

    return cosigners;
  }

  fromJSON(json) {
    assert(Array.isArray(json), 'json', 'array');

    for (const key of json)
      this.set(key, new SignaturesRecord());

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

    return this;
  }

  equals(approvedRecord) {
    assert(ApprovalsMapRecord.isApprovalsMapRecord(approvedRecord));

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

  static isApprovalsMapRecord(obj) {
    return obj instanceof this;
  }
}

/**
 * Array of signatures
 * @property {SignatureOption[]} signatures
 */

class SignaturesRecord extends Struct {
  /**
   * Create Signatures Record
   * @param {(SignatureOption[])?} signatures
   */

  constructor(signatures) {
    super();

    this.size = 0;
    this.signatures = new Map();

    if (signatures)
      this.fromSignatures(signatures);
  }

  getJSON() {
    return this.toSignatures();
  }

  fromJSON(json) {
    this.fromSignatures(json);

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
  data.writeUInt32LE(num, 0, true);
  return data;
}

function isU32(number) {
  return (number >>> 0) === number;
}

function isU8(number) {
  return (number & 0xff) === number;
}

/*
 * Expose
 */

Proposal.statusMessages = statusMessages;
Proposal.statussByVal = statusByVal;
Proposal.status = status;
Proposal.RejectionsSetRecord = RejectionsSetRecord;
Proposal.ApprovalsMapRecord = ApprovalsMapRecord;
Proposal.SignaturesRecord = SignaturesRecord;

module.exports = Proposal;
