/*!
 * wallet.js - Multisig wallet
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const bio = require('bufio');
const hash256 = require('bcrypto/lib/hash256');
const bcoin = require('bcoin');
const Wallet = bcoin.wallet.Wallet;
const {common, MasterKey} = bcoin.wallet;
const {encoding} = bio;

const Cosigner = require('./cosigner');
const layout = require('./layout');

/**
 * Multisig Wallet
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
 */
class MultisigWallet {
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
    assert(msdb);

    this.msdb = msdb;
    this.db = this.msdb.db;

    this.network = this.msdb.network;
    this.logger = this.msdb.logger.context('multisig-wallet');

    this.wid = 0;
    this.id = null;
    this.n = 0;
    this.m = 0;
    this.cosigners = [];
    this.joinKey = null;
    this.master = new MasterKey();

    this.wallet = null;

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
      this.joinKey = this.getJoinKey();
    }

    if (options.wid != null) {
      assert((options.wid >>> 0) === options.wid);
      this.wid = options.wid;
    }

    if (options.id != null) {
      assert(common.isName(options.id), 'Bad wallet ID.');
      this.id = options.id;
    }

    if (options.m != null) {
      assert((options.m & 0xff) === options.m);
      this.m = options.m;
    }

    if (options.n != null) {
      assert((options.n & 0xff) === options.n);
      this.n = options.n;
    }

    if (options.cosigners != null) {
      assert(Array.isArray(options.cosigners));
      for (const cosignerOptions of options.cosigners)
        this.cosigners.push(Cosigner.fromOptions(this.msdb, cosignerOptions));
    }

    assert(this.n > 1, 'n is more than 1');
    assert(this.m >= 1 && this.m <= this.n, 'm ranges between 1 and n.');

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
   * @param {bcoin#Wallet} wallet
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

    this.joinKey = this.getJoinKey();

    return this;
  }

  /**
   * Create multisig wallet from bcoin.Wallet and options
   * @param {MultisigDB} msdb
   * @param {bcoin#Wallet} wallet
   * @param {Object} options
   * @return {MultisigWallet}
   */

  static fromWalletOptions(msdb, wallet, options) {
    return new this(msdb).fromWalletOptions(wallet, options);
  }

  /**
   * Inspection friendly object
   * @returns {Object}
   */

  inspect() {
    return {
      id: this.id,
      wid: this.wid,
      m: this.m,
      n: this.n,
      master: this.master,
      network: this.network.type,
      cosigners: this.cosigners
    };
  }

  /**
   * Convert the multisig wallet object
   * to an object suitable for serialization
   * @param {Boolean?} unsafe - Whether to include
   * the master key in the JSON.
   * @param {bcoin#TXDB#Balance} balance
   * @returns {Object}
   */

  toJSON(unsafe, balance) {
    let master = null;
    let w = {};

    if (this.master)
      master = this.master.toJSON(this.network, unsafe);

    if (this.wallet)
      w = this.wallet;

    return {
      network: this.network.type,
      wid: this.wid,
      id: this.id,
      accountDepth: w.accountDepth,
      joinKey: this.joinKey.toString('hex'),
      master: master,
      balance: balance ? balance.toJSON(true) : null,
      cosigners: this.cosigners.map(cosigner => cosigner.toJSON())
    };
  }

  /**
   * Get serialization size
   * @returns {Number}
   */

  getSize() {
    let size = 0;

    size += 35;
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

    bw.writeU8(this.m);
    bw.writeU8(this.n);
    bw.writeBytes(this.joinKey);
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
    const br = bio.read(data);

    this.m = br.readU8();
    this.n = br.readU8();
    this.joinKey = br.readBytes(32);
    this.master.fromReader(br);

    const cosigners = br.readU8();

    for (let i = 0; i < cosigners; i++) {
      const cosignerData = br.readVarBytes();
      const cosigner = Cosigner.fromRaw(this.msdb, cosignerData);
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
   * Init wallet, create first cosigner and save to database
   * @param {bdb#Batch} b
   * @param {Object} options
   * @param {Cosigner} cosigner
   */

  init(b, cosigner) {
    this.cosigners.push(cosigner);
    this.save(b);

    this.logger.info('Created wallet %s/%d, cosigner: %s',
      this.id,
      this.wid,
      this.cosigners[0].name
    );
  }

  /**
   * Save Wallet to DB
   * @async
   * @param {bdb.Batch} b
   */

  save(b) {
    const wid = this.wid;
    const id = this.id;

    b.put(layout.w.build(wid), this.toRaw());
    b.put(layout.W.build(wid), fromString(id));
    b.put(layout.l.build(id), fromU32(wid));
  }

  /**
   * Generate Joinkey
   * @private
   * @returns {Buffer}
   */

  getJoinKey() {
    if (!this.master.key)
      throw new Error('Cannot derive token.');

    const key = this.master.key.derive(44, true);

    const bw = bio.write(32);
    bw.writeBytes(key.privateKey);

    return hash256.digest(bw.render());
  }

  /**
   * Generate cosigner token
   * @private
   * @param {Number} index - Cosigner index
   * @param {Number} nonce
   * @returns {Buffer}
   */

  getToken(index, nonce) {
    if (!this.master.key)
      throw new Error('Cannot derive token');

    const key = this.master.key.derive(44, true);

    const bw = bio.write(40);
    bw.writeBytes(key.privateKey);
    bw.writeU32(index);
    bw.writeU32(nonce);

    return hash256.digest(bw.render());
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

function fromString(str) {
  const buf = Buffer.alloc(1 + str.length);
  buf[0] = str.length;
  buf.write(str, 1, str.length, 'ascii');
  return buf;
}

module.exports = MultisigWallet;
