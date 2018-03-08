/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Logger = require('blgr');
const {wallet, hd, Network} = require('bcoin');
const {MasterKey} = wallet;
const {Mnemonic} = hd;

const MultisigWallet = require('../lib/wallet');

// This path does not do much.
const TEST_PATH = 'm/44\'/0\'/0\'/0/0';

// at this point we don't use anything from MSDB
const TEST_MSDB = {
  db: {},
  logger: Logger.global,
  network: Network.primary
};

const TEST_ACCOUNTS = [{
  id: 0,
  name: 'test1',
  path: TEST_PATH
}, {
  id: 1,
  name: 'test2',
  path: TEST_PATH
}];

const WALLET_OPTIONS = {
  wid: 1,
  id: 'test',
  m: 2,
  n: 2,
  cosigners: TEST_ACCOUNTS
};

describe('MultisigWallet', function () {
  it('should create wallet from options', () => {
    const options = WALLET_OPTIONS;

    const mWallet = new MultisigWallet(TEST_MSDB, options);

    {
      const keys = ['n', 'm', 'id', 'wid'];

      for (const key of keys)
        assert.strictEqual(mWallet[key], options[key]);
    }

    assert.strictEqual(mWallet.cosigners.length, 2);

    const cosopts = TEST_ACCOUNTS;
    const cosigners = mWallet.cosigners;
    const keys = Object.keys(cosopts[0]);

    for (const [i, cosigner] of cosigners.entries())
      for (const key of keys)
        assert.strictEqual(cosigner[key], cosopts[i][key]);
  });

  it('should reserialize correctly', () => {
    const options = WALLET_OPTIONS;
    const mWallet1 = new MultisigWallet(TEST_MSDB, options);

    // inject properties derived from bcoin#Wallet
    mWallet1.master = generateMaster();
    mWallet1.joinKey = mWallet1.getJoinKey();

    const data = mWallet1.toRaw();
    const mWallet2 = MultisigWallet.fromRaw(TEST_MSDB, data);

    // we don't care about wid/id
    mWallet1.wid = 0;
    mWallet1.id = null;
    mWallet1.master = mWallet2.master;

    assert.deepStrictEqual(mWallet2, mWallet1);
  });
});

/*
 * Helpers
 */

function generateMaster() {
  const master = new MasterKey();
  const mnemonic = new Mnemonic();
  const key = hd.fromMnemonic(mnemonic);

  master.fromKey(key, mnemonic);

  return master;
}
