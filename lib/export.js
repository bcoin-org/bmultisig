/*!
 * export.js - Export and import serializations for
 * Wallet, Account and Cosigner.
 * Copyright (c) 2019, The Bcoin Developers (MIT License).
 */

'use strict';

const assert = require('bsert');
const Struct = require('bufio/lib/struct');
const wcommon = require('bcoin/lib/wallet/common');
const HDPublicKey = require('bcoin/lib/hd/public');
const Account = require('bcoin/lib/wallet/account');
const MasterKey = require('bcoin/lib/wallet/masterkey');
const Cosigner = require('./primitives/cosigner');
const common = require('./utils/common');

const NULL_TOKEN = Buffer.alloc(32, 0);
const NULL_KEY = Buffer.alloc(33, 0);

/**
 * Cosigner dump object.
 * Wraps Cosigner primitive.
 */

class CosignerDetails extends Struct {
  constructor() {
    super();

    this.cosigner = new Cosigner();
  }

  fromCosigner(cosigner) {
    this.cosigner = cosigner.clone();

    return this;
  }

  getSize() {
    return this.cosigner.getSize();
  }

  write(bw, network) {
    return this.cosigner.write(bw, network);
  }

  read(br, network) {
    this.cosigner.read(br, network);

    return this;
  }

  getJSON(network) {
    return this.cosigner.getJSON(true, network);
  }

  fromJSON(json, network) {
    this.cosigner.fromJSON(json, true, network);

    return this;
  }

  static fromCosigner(cosigner) {
    return new this().fromCosigner(cosigner);
  }
}

class AccountDetails extends Struct {
  constructor() {
    super();

    this.accountIndex = 0;
    this.name = 'default';
    this.witness = false;
    this.lookahead = 10;
    this.type = Account.types.MULTISIG;
    this.initialized = true;

    this.m = 1;
    this.n = 1;

    // These wont be actually restored, as they can be easily
    // restored when rescanning. (will be `lookahead` when importing)
    this.receiveDepth = 0;
    this.changeDepth = 0;
    this.nestedDepth = 0;

    // These will be recovered from cosigners array.
    this.accountKey = null;
    this.keys = [];
  }

  /**
   * @param {Account} account
   * @returns {AccountDetails}
   */

  fromAccount(account) {
    this.accountIndex = account.accountIndex;
    this.name = account.name;
    this.witness = account.witness;
    this.receiveDepth = account.receiveDepth;
    this.changeDepth = account.changeDepth;
    this.nestedDepth = account.nestedDepth;
    this.lookahead = account.lookahead;
    this.type = account.type;

    this.m = account.m;
    this.n = account.n;

    // These are not utilized in bmultisig,
    // it is here, for future compatibility
    // for bcoin export/import formats.
    this.accountKey = common.cloneHDPublicKey(account.accountKey);
    this.keys = [];

    for (const key of account.keys)
      this.keys.push(common.cloneHDPublicKey(key));

    return this;
  }

  getSize() {
    let size = 0;

    // standard account serialization from bcoin
    size += 1; // flags
    size += 1; // type
    size += 2; // m and n
    size += 4; // receiveDepth
    size += 4; // changeDepth
    size += 4; // nestedDepth
    size += 1; // lookahead
    size += 74; // 1 + 4 + 4 + 32 + 33 AccountKey
    size += 1; // keys length
    size += 74 * this.keys.length;

    // export
    size += 4; // accountIndex
    size += 1; // account name length
    size += this.name.length; // we only accept ASCII

    return size;
  }

  write(bw) {
    let flags = 0;

    if (this.initialized)
      flags |= 1;

    if (this.witness)
      flags |= 2;

    bw.writeU8(flags);
    bw.writeU8(this.type);
    bw.writeU8(this.m);
    bw.writeU8(this.n);
    bw.writeU32(this.receiveDepth);
    bw.writeU32(this.changeDepth);
    bw.writeU32(this.nestedDepth);
    bw.writeU8(this.lookahead);
    writeKey(this.accountKey, bw);
    bw.writeU8(this.keys.length);

    for (const key of this.keys)
      writeKey(key, bw);

    bw.writeU32(this.accountIndex);
    bw.writeU8(this.name.length);
    bw.writeString(this.name, 'ascii');

    return bw;
  }

  read(br) {
    const flags = br.readU8();

    this.initialized = (flags & 1) !== 0;
    this.witness = (flags & 2) !== 0;
    // default type.
    this.type = br.readU8();
    this.m = br.readU8();
    this.n = br.readU8();
    this.receiveDepth = br.readU32();
    this.changeDepth = br.readU32();
    this.nestedDepth = br.readU32();
    this.lookahead = br.readU8();
    this.accountKey = readKey(br);

    const keys = br.readU8();
    for (let i = 0; i < keys; i++) {
      const key = readKey(br);
      this.keys.push(key);
    }

    this.accountIndex = br.readU32();
    const nameLength = br.readU8();
    this.name = br.readBytes(nameLength).toString('ascii');

    return this;
  }

  getJSON(network) {
    return {
      name: this.name,
      witness: this.witness,
      initialized: this.initialized,
      watchOnly: true, // not part of the serialization
      type: Account.typesByVal[Account.types.MULTISIG].toLowerCase(),
      m: this.m,
      n: this.n,
      accountIndex: this.accountIndex,
      receiveDepth: this.receiveDepth,
      changeDepth: this.changeDepth,
      nestedDepth: this.nestedDepth,
      lookahead: this.lookahead,
      accountKey: this.accountKey.toBase58(network),
      keys: this.keys.map(key => key.toBase58(network))
    };
  }

  fromJSON(json, network) {
    assert(json);
    assert(typeof json.name === 'string');
    assert(wcommon.isName(json.name));
    assert(typeof json.witness === 'boolean');
    assert(typeof json.initialized === 'boolean');
    assert((json.receiveDepth >>> 0) === json.receiveDepth);
    assert((json.changeDepth >>> 0) === json.changeDepth);
    assert((json.nestedDepth >>> 0) === json.nestedDepth);
    assert((json.lookahead >>> 0) === json.lookahead);
    assert(json.lookahead <= Account.MAX_LOOKAHEAD);
    assert((json.m & 0xff) === json.m);
    assert((json.n & 0xff) === json.n);

    this.name = json.name;
    this.witness = json.witness;
    this.receiveDepth = json.receiveDepth;
    this.changeDepth = json.changeDepth;
    this.nestedDepth = json.nestedDepth;
    this.lookahead = json.lookahead;
    this.initialized = json.initialized;

    this.m = json.m;
    this.n = json.n;

    // we recover accountKey and keys from cosigners..
    this.accountKey = HDPublicKey.fromBase58(json.accountKey, network);
    this.keys = json.keys.map(k => HDPublicKey.fromBase58(k, network));

    return this;
  }

  static fromJSON(json, accountKey, keys) {
    return new this().fromJSON(json, accountKey, keys);
  }

  static fromAccount(account) {
    return new this().fromAccount(account);
  }
}

class WalletDetails extends Struct {
  constructor() {
    super();

    this.watchOnly = true;
    this.tokenDepth = 0;
    this.master = new MasterKey();
    this.token = NULL_TOKEN;
    this.joinPubKey = NULL_KEY;

    // not used, for information.
    this.timestamp = now();

    // This will be recovered based on accounts array
    // and wont actually be initialized.
    // NOTE: in bmultisig this will always be 1.
    this.accountDepth = 1;

    this.accounts = [];
    this.cosigners = [];
  }

  fromWallet(wallet, accounts, cosigners) {
    this.master = cloneMasterKey(wallet.master);
    this.accounts = accounts;
    this.cosigners = cosigners;

    wallet.joinPubKey.copy(this.joinPubKey, 0);

    return this;
  }

  getSize() {
    let size = 0;

    size += 1; // flags
    size += 4; // accountDepth
    size += 32; // token
    size += 4; // token depth
    size += this.master.getSize();

    size += 5; // timestamp
    size += 33; // joinPubKey

    size += 4; // accounts length

    for (const account of this.accounts)
      size += account.getSize();

    size += 1; // cosigners length
    for (const cosigner of this.cosigners)
      size += cosigner.getSize();

    return size;
  }

  write(bw, network) {
    let flags = 0;

    if (this.watchOnly)
      flags |= 1;

    bw.writeU8(flags);
    bw.writeU32(this.accountDepth);
    bw.writeBytes(this.token);
    bw.writeU32(this.tokenDepth);
    this.master.toWriter(bw);

    bw.writeU40(this.timestamp);
    bw.writeBytes(this.joinPubKey);

    bw.writeU32(this.accounts.length);
    for (const account of this.accounts)
      account.toWriter(bw);

    bw.writeU8(this.cosigners.length);
    for (const cosigner of this.cosigners)
      cosigner.toWriter(bw, network);

    return bw;
  }

  read(br, network) {
    const flags = br.readU8();

    this.watchOnly = (flags & 1) !== 0;
    this.accountDepth = br.readU32();
    this.token = br.readBytes(32);
    this.tokenDepth = br.readU32();
    this.master.fromReader(br);

    this.timestamp = br.readU40();
    this.joinPubKey = br.readBytes(33);

    const accounts = br.readU32();

    for (let i = 0; i < accounts; i++) {
      const account = new AccountDetails();

      account.fromReader(br);
      this.accounts.push(account);
    }

    const cosigners = br.readU8();

    for (let i = 0; i < cosigners; i++) {
      const cosigner = new CosignerDetails();

      cosigner.fromReader(br, network);
      this.cosigners.push(cosigner);
    }

    return this;
  }

  getJSON(network) {
    return {
      watchOnly: this.watchOnly,
      accountDepth: this.accountDepth,
      tokenDepth: this.tokenDepth,
      token: this.token.toString('hex'),
      master: this.master.toRaw().toString('hex'),
      joinPubKey: this.joinPubKey.toString('hex'),
      timestamp: this.timestamp,
      accounts: this.accounts.map(a => a.getJSON(network)),
      cosigners: this.cosigners.map(c => c.getJSON(network))
    };
  }

  fromJSON(json, network) {
    assert(json);
    assert((json.tokenDepth >>> 0) === json.tokenDepth);
    assert(typeof json.token === 'string');
    assert(typeof json.joinPubKey === 'string');
    assert(typeof json.timestamp === 'number');
    assert(json.timestamp >= 0);
    assert(Array.isArray(json.accounts));

    const token = Buffer.from(json.token, 'hex');
    const joinPubKey = Buffer.from(json.joinPubKey, 'hex');
    const rawMasterKey = Buffer.from(json.master, 'hex');

    assert(token.length === 32);
    assert(joinPubKey.length === 33);

    this.token = token;
    this.joinPubKey = joinPubKey;
    this.timestamp = json.timestamp;
    this.accountDepth = json.accounts.length;
    this.master = MasterKey.fromRaw(rawMasterKey);

    assert(json.accounts.length === 1);

    for (const cosignerJSON of json.cosigners) {
      const cosignerDetails = CosignerDetails.fromJSON(cosignerJSON, network);
      this.cosigners.push(cosignerDetails);
    }

    const accountDetails = AccountDetails.fromJSON(json.accounts[0], network);
    this.accounts.push(accountDetails);

    return this;
  }

  static fromWallet(wallet, accounts, cosigners) {
    return new this().fromWallet(wallet, accounts, cosigners);
  }
}

/*
 * helpers
 */

function cloneMasterKey(key) {
  return MasterKey.fromRaw(key.toRaw());
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function writeKey(key, bw) {
  bw.writeU8(key.depth);
  bw.writeU32BE(key.parentFingerPrint);
  bw.writeU32BE(key.childIndex);
  bw.writeBytes(key.chainCode);
  bw.writeBytes(key.publicKey);
}

function readKey(br) {
  const key = new HDPublicKey();
  key.depth = br.readU8();
  key.parentFingerPrint = br.readU32BE();
  key.childIndex = br.readU32BE();
  key.chainCode = br.readBytes(32);
  key.publicKey = br.readBytes(33);
  return key;
}

exports.WalletDetails = WalletDetails;
exports.AccountDetails = AccountDetails;
exports.CosignerDetails = CosignerDetails;
