'use strict';

const bcoin = require('bcoin');
const hash256 = require('bcrypto/lib/hash256');
const random = require('bcrypto/lib/random');
const {Script, Amount, MTX, Input, Outpoint} = bcoin;

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
    hash: hash,
    prevBlock: prev,
    merkleRoot: root,
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
  const hash = random.randomBytes(32);
  return Input.fromOutpoint(new Outpoint(hash, 0));
};

exports.dummyCoinbase = () => {
  const hash = Buffer.alloc(32, 0).toString('hex');
  return Input.fromOutpoint(new Outpoint(hash, 0xffffffff));
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
 * @returns {MTX}
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

  return mtx;
};

exports.getDoubleSpendTransaction = (tx) => {
  const mtx = MTX.fromTX(tx);

  mtx.outputs = [];
  mtx.addOutput(Script.fromString(''));

  return mtx;
};

// Spend transaction
exports.doubleSpendTransaction = async (wdb, tx) => {
  const mtx = exports.getDoubleSpendTransaction(tx);

  await wdb.addBlock(exports.nextBlock(wdb), [mtx.toTX()]);
};

// Coinbase fund
exports.createCoinbaseFundTX = (address, value) => {
  const mtx = new MTX();
  mtx.addInput(exports.dummyCoinbase());
  mtx.addOutput(address, value);

  return mtx;
};

exports.fundWalletBlockCB = async (wdb, mswallet, amount) => {
  const account = await mswallet.getAccount();
  const address = await account.receiveAddress();

  return exports.fundAddressBlockCB(wdb, address, amount);
};

exports.fundAddressBlockCB = async (wdb, address, amount) => {
  amount = Amount.fromBTC(amount).toValue();

  const mtx = exports.createCoinbaseFundTX(address, amount);

  await wdb.addBlock(exports.nextBlock(wdb), [mtx.toTX()]);
};

exports.addBlock = async (wdb) => {
  await wdb.addBlock(exports.nextBlock(wdb), []);
};

exports.removeBlock = async (wdb) => {
  const block = exports.curBlock(wdb);

  await wdb.removeBlock(block);
};

/*
 * Helpers
 */

function fromU32LE(num) {
  const data = Buffer.allocUnsafe(4);
  data.writeUInt32LE(num, 0, true);
  return data;
}
