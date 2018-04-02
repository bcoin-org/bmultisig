'use strict';

const bcoin = require('bcoin');
const hash256 = require('bcrypto/lib/hash256');
const random = require('bcrypto/lib/random');
const {Amount, MTX, Input, Outpoint} = bcoin;

exports.curBlock = (wdb) => {
  return exports.fakeBlock(wdb.state.height);
};

exports.nextBlock = (wdb) => {
  return exports.fakeBlock(wdb.state.height + 1);
};

exports.fakeBlock = (height) => {
  const prev = hash256.digest(fromU32LE((height - 1) >>> 0));
  const hash = hash256.digest(fromU32LE(height >>> 0));
  const root = hash256.digest(fromU32LE((height | 0x80000000) >>> 0));

  return {
    hash: hash.toString('hex'),
    prevBlock: prev.toString('hex'),
    merkleRoot: root.toString('hex'),
    time: 500000000 + (height * (10 * 60)),
    bits: 0,
    nonce: 0,
    height: height
  };
};

/**
 * @returns {Input}
 */

exports.dummyInput = () => {
  const hash = random.randomBytes(32).toString('hex');
  return Input.fromOutpoint(new Outpoint(hash, 0));
};

/**
 * @param {bcoin#Address} address
 * @param {Number} value
 * @returns {MTX}
 */

exports.createFundTX = (address, value) => {
  // coinbase
  const mtx = new MTX();
  mtx.addInput(exports.dummyInput());
  mtx.addOutput(address, value);

  return mtx;
};

/**
 * Fund multisig wallet
 * @async
 * @param {WalletDB} wdb
 * @param {MultisigWallet} mswallet
 * @param {Number} amount - number in BTC
 */

exports.fundWalletBlock = async (wdb, mswallet, amount) => {
  const account = await mswallet.getAccount();
  const address = await account.receiveAddress();

  return exports.fundAddressBlock(wdb, address, amount);
};

exports.fundAddressBlock = async (wdb, address, amount) => {
  amount = Amount.fromBTC(amount).toValue();

  const mtx = exports.createFundTX(address, amount);

  await wdb.addBlock(exports.nextBlock(wdb), [mtx.toTX()]);
};

/*
 * Helpers
 */

function fromU32LE(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(num, 0, true);
  return data;
}
