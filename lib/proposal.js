/*!
 * proposal.js - proposal object
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */
'use strict';

const assert = require('assert');
const bcoin = require('bcoin');
const {Struct} = require('bufio');
const {common} = bcoin.wallet;
const {Coin, TX} = bcoin;
const Cosigner = require('./cosigner');
const layout = require('./layout').proposaldb;

const status = {
  PROGRESS: 0,
  APPROVED: 1,
  COSIGNERS: 2,
  REORG: 3
};

const statusByVal = [
  'PROGRESS',
  'APPROVED',
  'COSIGNERS',
  'REORG'
];

const statusMessages = [
  'Proposal is in progress.',
  'Proposal has been approved.',
  'Cosigners rejected the proposal.',
  'Block reorg invalidated coins.'
];

/**
 * Payment proposal
 */

class Proposal extends Struct {
  /**
   * Create proposal
   * @param {String} options
   * @param {String} options.name
   * @param {String} [options.description='']
   * @param {Cosigner} options.author
   * @param {TX} options.tx
   */

  constructor(options) {
    super();

    this.id = 0;
    this.name = '';
    this.author = 0;
    this.tx = null;

    this.status = status.PROGRESS;

    this.m = 1;
    this.n = 2;

    this.approvals = [];
    this.rejections = [];

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
    assert(options.name, 'Name is required.');
    assert(common.isName(options.name), 'Bad proposal name.');
    assert(options.tx, 'TX is required.');
    assert(options.tx instanceof TX, 'tx must be instance of TX.');
    assert(options.author instanceof Cosigner, 'Cosigner is required.');

    assert(isU8(options.n), 'n must be u8.');
    assert(isU8(options.m), 'm must be u8.');
    assert(options.n > 1, 'n must be more than 1.');
    assert(options.m >= 1 && options.m <= options.n,
      'm must be between 1 and n.');

    if (options.status != null) {
      assert(status[options.status], 'Incorrect status code.');
      this.status = options.status;
    }

    this.id = options.id;
    this.name = options.name;
    this.tx = options.tx;
    this.author = options.author.id;

    this.approvals = [];
    this.rejections = [];

    this.m = options.m;
    this.n = options.n;

    return this;
  }

  isPending() {
    return this.status === status.PROGRESS;
  }

  /**
   * Get JSON
   * @returns {Object}
   */

  getJSON() {
    return {
      name: this.name,
      tx: this.tx.toRaw().toString('hex'),
      author: this.author,
      approvals: this.approvals,
      rejections: this.rejections,
      m: this.m,
      n: this.n,
      statusCode: this.status,
      statusMessage: statusMessages[this.status]
    };
  }

  /**
   * inspect
   * @returns {Object}
   */

  inspect() {
    return this;
  }

  /**
   * Get size
   * @returns {Number}
   */

  getSize() {
    let size = 4; // id
    size += 1; // name size
    size += this.name.length;
    size += 1; // status
    size += 1; // author
    size += 1; // approvals
    size += this.approvals.length;
    size += 1; // rejections
    size += this.rejections.length;

    return size;
  }

  /**
   * Write raw representation to buffer writer.
   * @param {BufferWriter} bw
   * @returns {Buffer}
   */

  write(bw) {
    bw.writeU32(this.id);
    bw.writeU8(this.name.length);
    bw.writeBytes(Buffer.from(this.name, 'utf8'));
    bw.writeU8(this.status);
    bw.writeU8(this.author);

    bw.writeU8(this.approvals.length);
    for (const approval of this.approvals)
      bw.writeU8(approval);

    bw.writeU8(this.rejections.length);
    for (const rejection of this.rejections)
      bw.writeU8(rejection);

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
    this.name = br.readBytes(length).toString('utf8');
    this.status = br.readU8();
    this.author = br.readU8();

    const approvalsSize = br.readU8();
    for (let i = 0; i < approvalsSize; i++)
      this.approvals.push(br.readU8());

    const rejectionsSize = br.readU8();
    for (let i = 0; i < rejectionsSize; i++)
      this.rejections.push(br.readU8());

    return this;
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
   * Get all locked coins
   * @returns {Promise<Coin[]>}
   */

  static getCoins(db) {
    return db.range({
      gte: layout.c.min(),
      lte: layout.c.max(),
      parse: (key, value) => {
        const [hash, index] = layout.c.parse(key);
        const coin = new Coin();
        coin.hash = hash;
        coin.index = index;

        return coin;
      }
    });
  }

  /**
   * @async
   * @param {String} name
   * @returns {Promise<Number>}
   */

  static async getPID(db, name) {
    const pid = await db.get(layout.i.build(name));

    if (!pid)
      return -1;

    assert(pid.length === 4);
    return pid.readUInt32LE(0, true);
  }

  /**
   * Has pid
   * @async
   * @param {Number} pid
   * @returns {Promise<Boolean>}
   */

  static has(db, pid) {
    return db.has(layout.p.build(pid));
  }

  /**
   * Has name
   * @async
   * @param {String} id
   * @returns {Promise<Boolean>}
   */

  static hasName(db, name) {
    return db.has(layout.i.build(name));
  }

  /**
   * Get proposal
   * @async
   * @param {Number} pid
   * @returns {Promise<Proposal>}
   */

  static async getProposal(db, id) {
    const proposalData = await db.get(layout.p.build(id));
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
    const txdata = await db.get(layout.t.build(pid));
    assert(txdata);

    return TX.fromRaw(txdata);
  }

  /**
   * Get proposal with TX
   * @async
   * @param {Number} pid
   * @returns {Promise<Proposal>}
   */

  static async getProposalWithTX(db, pid) {
    const proposal = await this.getProposal(db, pid);
    const tx = await this.getTX(db, pid);

    proposal.tx = tx;

    return proposal;
  }

  /**
   * Get proposal by coin
   * @param {Coin} coin
   * @returns {Promise<Number>}
   */

  static async getPIDByCoin(db, coin) {
    const pid = await this.get(layout.P.build(coin.hash, coin.index));

    if (!pid)
      return -1;

    return pid;
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
    b.put(layout.c.build(coin.hash, coin.index));
    b.put(layout.C.build(proposal.id, coin.hash, coin.index));
  }

  /**
   * Unlock the proposal coins
   * @param {Proposal} proposal
   * @param {Coin} coin
   */

  static unlockCoin(b, proposal, coin) {
    b.del(layout.c.build(coin.hash, coin.index));
    b.del(layout.C.build(proposal.id, coin.hash, coin.index));
  }

  /**
   * Save proposal
   * @param {Proposal} proposal
   */

  static saveProposalWithTX(b, proposal) {
    this.saveProposal(b, proposal);
    this.saveTX(b, proposal.id, proposal.tx);
  }

  /**
   * Save transaction
   * @param {Number} pid
   * @param {TX} tx
   */

  static saveTX(b, pid, tx) {
    b.put(layout.t.build(pid), tx.toRaw());
  }

  /**
   * Save proposal and update Pending statuses
   * @param {Proposal} proposal
   */

  static saveProposal(b, proposal) {
    const pid = proposal.id;
    const name = proposal.name;

    b.put(layout.p.build(pid), proposal.toRaw());
    b.put(layout.i.build(name), fromU32(pid));

    if (proposal.isPending()) {
      b.put(layout.e.build(pid));
    } else {
      b.del(layout.e.build(pid));
      b.put(layout.f.build(pid));
    }
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

module.exports = Proposal;
