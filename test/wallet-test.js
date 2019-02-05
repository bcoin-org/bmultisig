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
const Cosigner = require('../lib/primitives/cosigner');

// This path does not do much.
const TEST_XPUB_PATH = 'm/44\'/0\'/0\'';

// at this point we don't use anything from MSDB
const TEST_MSDB = {
  db: {},
  logger: Logger.global,
  network: Network.primary
};

const TEST_XPUB_1 = getPubKey();
const TEST_XPUB_2 = getPubKey();

const TEST_ACCOUNTS = [{
  id: 0,
  name: 'test1',
  path: TEST_XPUB_PATH,
  key: TEST_XPUB_1,
  token: Buffer.alloc(32, 1)
}, {
  id: 1,
  name: 'test2',
  path: TEST_XPUB_PATH,
  key: TEST_XPUB_2,
  token: Buffer.alloc(32, 2)
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

    const wdbClient = new WalletNodeClient({
      wdb
    });

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

    const mswallet = new MultisigWallet(TEST_MSDB, options);

    {
      const keys = ['n', 'm', 'id', 'wid'];

      for (const key of keys)
        assert.strictEqual(mswallet[key], options[key]);
    }

    assert.strictEqual(mswallet.cosigners.length, 2);

    const cosopts = TEST_ACCOUNTS;
    const cosigners = mswallet.cosigners;
    const keys = Object.keys(cosopts[0]);

    for (const [i, cosigner] of cosigners.entries())
      for (const key of keys)
        assert.strictEqual(cosigner[key], cosopts[i][key]);
  });

  it('should reserialize correctly', () => {
    const options = Object.assign({
      cosigners: TEST_ACCOUNTS
    }, WALLET_OPTIONS);

    const mswallet1 = new MultisigWallet(TEST_MSDB, options);

    // inject properties derived from bcoin#Wallet
    mswallet1.master = generateMaster();
    mswallet1.joinKey = mswallet1.getJoinKey();

    const data = mswallet1.toRaw();
    const mswallet2 = MultisigWallet.fromRaw(TEST_MSDB, data);

    // we don't care about wid/id/master
    mswallet1.wid = 0;
    mswallet1.id = null;

    assert.deepStrictEqual(mswallet1.toJSON(0), mswallet2.toJSON(0));
  });

  it('should create multisig wallet', async () => {
    const xpub = getPubKey();
    const cosigner = Cosigner.fromOptions({
      name: 'cosigner1',
      key: xpub,
      token: Buffer.alloc(32, 3)
    });
    const mswallet = await msdb.create(WALLET_OPTIONS, cosigner);

    const wallet = mswallet.wallet;
    const account = await wallet.getAccount(0);

    assert.strictEqual(mswallet.id, wallet.id);
    assert.strictEqual(mswallet.wid, wallet.wid);

    assert.strictEqual(mswallet.m, account.m);
    assert.strictEqual(mswallet.n, account.n);
    assert.strictEqual(account.accountKey.xpubkey(), xpub.xpubkey());
  });

  it('should fail creating existing wallet', async () => {
    const xpub = getPubKey();
    const cosigner = new Cosigner({
      name: 'cosigner1',
      key: xpub,
      token: Buffer.alloc(32, 4)
    });

    await msdb.create(WALLET_OPTIONS, cosigner);

    let err;

    try {
      const cosigner = Cosigner.fromOptions({
        name: 'cosigner2',
        key: xpub,
        token: Buffer.alloc(32, 4)
      });

      await msdb.create(WALLET_OPTIONS, cosigner);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');

    err = null;

    try {
      await msdb.create(Object.assign({}, WALLET_OPTIONS, {
        id: 'primary'
      }), Cosigner.fromOptions({
        name: 'cosigner2',
        key: xpub,
        token: Buffer.alloc(32, 5)
      }));
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');
  });

  it('should get multisig wallet', async () => {
    const xpub = getPubKey();
    const cosigner = Cosigner.fromOptions({ name: 'cosigner1', key: xpub });
    const mswallet = await msdb.create(WALLET_OPTIONS, cosigner);
    const wallet = mswallet.wallet;

    const mswalletInfo = await msdb.getWallet(WALLET_OPTIONS.id);
    const walletInfo = mswalletInfo.wallet;

    assert.deepStrictEqual(wallet, walletInfo);
    assert.deepStrictEqual(mswallet, mswalletInfo);

    // clear cache and try again
    msdb.unregister(mswallet);

    const mswalletInfo2 = await msdb.getWallet(WALLET_OPTIONS.id);

    assert.deepStrictEqual(
      mswalletInfo.toJSON(),
      mswalletInfo2.toJSON()
   );
  });

  it('should return null on non existing wallet', async () => {
    const mswallet = await msdb.getWallet('non-existing');
    const nonMultisigWallet = await msdb.getWallet('primary');

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

    const xpub = getPubKey();
    // add wallets
    await msdb.create(WALLET_OPTIONS, new Cosigner({
      name: 'cosigner',
      key: xpub,
      token: Buffer.alloc(32, 6)
    }));

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
    const xpub = getPubKey();
    await msdb.create(WALLET_OPTIONS, new Cosigner({
      name: 'cosigner1',
      key: xpub,
      token: Buffer.alloc(32, 7)
    }));
    const removed = await msdb.remove(WALLET_OPTIONS.id);
    const wallet = await msdb.getWallet(WALLET_OPTIONS.id);
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
    const xpub1 = getPubKey();
    const xpub2 = getPubKey();
    const xpub3 = getPubKey();

    const options1 = {
      m: 1,
      n: 3
    };

    const cosigner1 = Cosigner.fromOptions({name: 'cosigner1', key: xpub1 });
    const mswallet = await msdb.create(options1, cosigner1);

    const cosigner2 = Cosigner.fromOptions({ name: 'cosigner2', key: xpub2 });
    const join1 = await mswallet.join(cosigner2);

    assert(join1, 'Multisig wallet was not returned.');
    assert.strictEqual(join1.cosigners.length, 2,
      'Number of cosigners does not match.'
    );
    assert.strictEqual(join1.isInitialized(), false,
      'Wallet needs one more cosigner.'
    );

    assert.strictEqual(join1.cosigners[1].id, 1);
    assert.notTypeOf(join1.cosigners[1].token, 'null');

    const cosigner3 = Cosigner.fromOptions({
      name: 'cosigner3',
      path: '',
      key: xpub3
    });

    const join2 = await mswallet.join(cosigner3);

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

    const account = await mswallet.wallet.getAccount(0);

    // account.keys are sorted
    assert.strictEqual(account.accountKey.equals(xpub1), true);

    assert(account.keys.findIndex(k => k.equals(xpub2)) > -1);
    assert(account.keys.findIndex(k => k.equals(xpub3)) > -1);
  });

  it('should fail joining with duplicate XPUB', async () => {
    const xpub = getPubKey();
    const xpub2 = getPubKey();

    const options = Object.assign({
      m: 1,
      n: 3
    });

    const cosigner = Cosigner.fromOptions({ name: 'cosigner1', key: xpub });
    const mswallet = await msdb.create(options, cosigner);

    const cosigner2 = Cosigner.fromOptions({ name: 'cosigner2', key: xpub2 });
    await mswallet.join(cosigner2);

    let err;
    try {
      const cosigner3 = Cosigner.fromOptions({ name: 'cosigner3', key: xpub });

      await mswallet.join(cosigner3);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cannot add own key.');

    err = null;

    try {
      const cosigner3 = Cosigner.fromOptions({ name: 'cosigner3', key: xpub2 });
      await mswallet.join(cosigner3);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Can not add duplicate keys');
  });

  it('should fail joining full wallet', async () => {
    const options = {
      m: 1,
      n: 2
    };

    const xpub = getPubKey();
    const cosigner = Cosigner.fromOptions({ name: 'cosigner1', key: xpub });
    const mswallet = await msdb.create(options, cosigner);
    assert.strictEqual(mswallet.isInitialized(), false);

    const cosigner1 = Cosigner.fromOptions({
      name: 'cosigner2',
      path: '',
      key: getPubKey()
    });

    const cosigner2 = Cosigner.fromOptions({
      name: 'cosigner3',
      path: '',
      key: getPubKey()
    });

    await mswallet.join(cosigner1);
    assert.strictEqual(mswallet.isInitialized(), true);

    let err;

    try {
      await mswallet.join(cosigner2);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Multisig wallet is full.');
    assert.strictEqual(mswallet.isInitialized(), true);
  });

  it('should authenticate user with cosignerToken', async () => {
    const pubkey1 = getPubKey();
    const pubkey2 = getPubKey();

    const cosigner = Cosigner.fromOptions({
      name: 'cosigner1',
      key: pubkey1,
      token: Buffer.alloc(32, 1)
    });
    const mswallet = await msdb.create(WALLET_OPTIONS, cosigner);

    const cosigner1 = Cosigner.fromOptions({
      name: 'cosigner2',
      key: pubkey2,
      token: Buffer.alloc(32, 2)
    });

    await mswallet.join(cosigner1);

    const token1 = mswallet.cosigners[0].token;
    const token2 = mswallet.cosigners[1].token;

    const testCosigner1 = mswallet.auth(token1);
    const testCosigner2 = mswallet.auth(token2);

    assert.strictEqual(testCosigner1, mswallet.cosigners[0]);
    assert.strictEqual(testCosigner2, mswallet.cosigners[1]);

    const wrongToken = Buffer.alloc(32);
    let err;

    try {
      mswallet.auth(wrongToken);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
  });

  it('should set new token and authenticate', async () => {
    const pubkey1 = getPubKey();
    const token1 = Buffer.alloc(32, 1);
    const token2 = Buffer.alloc(32, 2);

    const cosigner = new Cosigner({
      name: 'cosigner1',
      key: pubkey1,
      token: token1
    });

    const mswallet = await msdb.create(WALLET_OPTIONS, cosigner);
    const oldToken = mswallet.cosigners[0].token;

    const acosigner1 = await mswallet.auth(oldToken);
    assert.bufferEqual(acosigner1.token, token1);
    assert.deepStrictEqual(mswallet.cosigners[0], acosigner1);

    const cosigner2 = await mswallet.setToken(cosigner, token2);
    const acosigner2 = await mswallet.auth(cosigner2.token);
    const newToken = cosigner2.token;

    assert.notBufferEqual(newToken, oldToken);
    assert.bufferEqual(oldToken, token1);
    assert.bufferEqual(newToken, token2);
    assert.deepStrictEqual(mswallet.cosigners[0], acosigner2);
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
