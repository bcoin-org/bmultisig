/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Logger = require('blgr');
const {wallet, hd, Network} = require('bcoin');
const {WalletDB, MasterKey} = wallet;
const {Mnemonic} = hd;

const MultisigDB = require('../lib/multisigdb');
const WalletNodeClient = require('../lib/walletclient');
const MultisigWallet = require('../lib/wallet');
const Cosigner = require('../lib/cosigner');

// This path does not do much.
const TEST_XPUB_PATH = 'm/44\'/0\'/0\'';

// at this point we don't use anything from MSDB
const TEST_MSDB = {
  db: {},
  logger: Logger.global,
  network: Network.primary
};

const TEST_ACCOUNTS = [{
  id: 0,
  name: 'test1',
  path: TEST_XPUB_PATH
}, {
  id: 1,
  name: 'test2',
  path: TEST_XPUB_PATH
}];

const WALLET_OPTIONS = {
  id: 'test',
  m: 2,
  n: 2
};

describe('MultisigWallet', function () {
  let wdb, msdb;

  beforeEach(async () => {
    wdb = new WalletDB();

    const wdbClient = new WalletNodeClient({});
    wdbClient.wdb = wdb;

    msdb = new MultisigDB({
      client: wdbClient
    });

    await wdb.open();
    await msdb.open();
  });

  afterEach(async () => {
    await wdb.close();
    await msdb.close();
  });

  it('should create wallet from options', () => {
    const options = Object.assign({
      cosigners: TEST_ACCOUNTS,
      wid: 1
    }, WALLET_OPTIONS);

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
    const options = Object.assign({
      cosigners: TEST_ACCOUNTS
    }, WALLET_OPTIONS);

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

  it('should create multisig wallet', async () => {
    const xpub = getXPUB();
    const mswallet = await msdb.create(Object.assign({
      xpub,
      cosignerName: 'cosigner1'
    }, WALLET_OPTIONS));

    const wallet = mswallet.wallet;
    const account = await wallet.getAccount(0);

    assert.strictEqual(mswallet.id, wallet.id);
    assert.strictEqual(mswallet.wid, wallet.wid);

    assert.strictEqual(mswallet.m, account.m);
    assert.strictEqual(mswallet.n, account.n);
    assert.strictEqual(account.accountKey.xpubkey(), xpub);
  });

  it('should fail creating existing wallet', async () => {
    await msdb.create(Object.assign({
      cosignerName: 'cosigner1'
    }, WALLET_OPTIONS));

    let err;

    try {
      await msdb.create(Object.assign({
        cosignerName: 'cosigner2'
      }, WALLET_OPTIONS));
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');

    err = null;

    try {
      await msdb.create(
        Object.assign(
          { cosignerName: 'cosigner2' },
          WALLET_OPTIONS,
          { id: 'primary' }
        )
      );
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');
  });

  it('should get multisig wallet', async () => {
    const walletOptions = Object.assign({
      cosignerName: 'cosigner1'
    }, WALLET_OPTIONS);

    const mswallet = await msdb.create(walletOptions);
    const wallet = mswallet.wallet;

    const mswalletInfo = await msdb.get(walletOptions.id);
    const walletInfo = mswalletInfo.wallet;

    assert.deepStrictEqual(wallet, walletInfo);
    assert.deepStrictEqual(mswallet, mswalletInfo);
  });

  it('should return null on non existing wallet', async () => {
    const mswallet = await msdb.get('non-existing');
    const nonMultisigWallet = await msdb.get('primary');

    assert.typeOf(mswallet, 'null');
    assert.typeOf(nonMultisigWallet, 'null');
  });

  it('should list multisig wallets', async () => {
    {
      const mswallets = await msdb.getWallets();
      const wallets = await wdb.getWallets();

      assert.deepStrictEqual(mswallets, []);
      assert.deepStrictEqual(wallets, ['primary']);
    }

    // add wallets
    await msdb.create(Object.assign({
      cosignerName: 'test'
    }, WALLET_OPTIONS));

    {
      const mswallets = await msdb.getWallets();
      const wallets = await wdb.getWallets();

      assert.deepStrictEqual(mswallets, ['test']);
      assert.deepStrictEqual(wallets, ['primary', 'test']);
    }

    // add normal wallet
    await wdb.create({
      id: 'tmp'
    });

    {
      const mswallets = await msdb.getWallets();
      const wallets = await wdb.getWallets();

      assert.deepStrictEqual(mswallets, ['test']);
      assert.deepStrictEqual(wallets, ['primary', 'test', 'tmp']);
    }
  });

  it('should remove multisig wallet', async () => {
    const options = Object.assign(
      { cosignerName: 'cosigner1' },
      WALLET_OPTIONS,
      { id: 'test1' }
    );

    await msdb.create(options);
    const removed = await msdb.remove(options.id);
    const wallet = await msdb.get(options.id);
    const wallets = await msdb.getWallets();

    assert.strictEqual(removed, true);
    assert.typeOf(wallet, 'null');
    assert.strictEqual(wallets.length, 0);
  });

  it('should fail deleting non existing multisig wallet', async () => {
    const removed = await msdb.remove('test');
    const removeNonMultisig = await msdb.remove('primary');

    assert.strictEqual(removed, false);
    assert.strictEqual(removeNonMultisig, false);
  });

  it('should join wallet with joinKey', async () => {
    const xpub1b58 = getXPUB();
    const xpub2 = getPubKey();
    const xpub3 = getPubKey();

    const options1 = {
      cosignerName: 'cosigner1',
      xpub: xpub1b58,
      m: 1,
      n: 3
    };

    const mswallet = await msdb.create(options1);
    const cosigner2 = Cosigner.fromOptions({
      name: 'cosigner2',
      path: ''
    });

    const join1 = await mswallet.join(cosigner2, xpub2);

    assert(join1, 'Multisig wallet was not returned.');
    assert.strictEqual(join1.cosigners.length, 2,
      'Number of cosigners does not match.'
    );
    assert.strictEqual(join1.isInitialized(), false,
      'Wallet needs one more cosigner.'
    );

    assert.strictEqual(join1.cosigners[1].id, 1);
    assert.notTypeOf(join1.cosigners[1].token, 'null');

    const cosigner3 = Cosigner.fromOptions(msdb, {
      name: 'cosigner3',
      path: ''
    });

    const join2 = await mswallet.join(cosigner3, xpub3);

    assert(join2, 'Multisig wallet was not returned.');
    assert.strictEqual(join2.cosigners.length, 3,
      'Number of cosigners does not match'
    );
    assert.strictEqual(join2.isInitialized(), true,
      'Wallet was not initialized'
    );
    assert.strictEqual(join2.cosigners[2].id, 2);
    assert.notTypeOf(join2.cosigners[2].token, 'null');
    assert.strictEqual(join2.cosigners[2].name, cosigner3.name);
  });

  it('should fail joining with duplicate XPUB', async () => {
    const xpub = getPubKey();
    const b58 = xpub.xpubkey();
    const xpub2 = getPubKey();

    const options = Object.assign({
      cosignerName: 'cosigner1',
      xpub: b58,
      m: 1,
      n: 3
    });

    const mswallet = await msdb.create(options);

    const cosigner2 = Cosigner.fromOptions(msdb, { name: 'cosigner2' });
    await mswallet.join(cosigner2, xpub2);

    const cosigner3 = Cosigner.fromOptions(msdb, { name: 'cosigner3' });

    let err;
    try {
      await mswallet.join(cosigner3, xpub);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cannot add own key.');

    err = null;

    try {
      await mswallet.join(cosigner3, xpub2);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Can not add duplicate keys');
  });

  it('should fail joining full wallet', async () => {
    const options = {
      cosignerName: 'cosigner1',
      xpub: getXPUB(),
      m: 1,
      n: 2
    };

    const mswallet = await msdb.create(options);
    assert.strictEqual(mswallet.isInitialized(), false);

    const cosigner1 = Cosigner.fromOptions({
      name: 'cosigner2',
      path: ''
    });

    const cosigner2 = Cosigner.fromOptions({
      name: 'cosigner3',
      path: ''
    });

    await mswallet.join(cosigner1, getPubKey());
    assert.strictEqual(mswallet.isInitialized(), true);

    let err;

    try {
      await mswallet.join(cosigner2, getPubKey());
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Multisig wallet is full.');
    assert.strictEqual(mswallet.isInitialized(), true);
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

function getPubKey() {
  return hd.PrivateKey.generate()
    .derivePath(TEST_XPUB_PATH).toPublic();
}

function getXPUB() {
  return getPubKey().xpubkey();
}
