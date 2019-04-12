/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const Logger = require('blgr');
const {wallet, hd, Network} = require('bcoin');
const {WalletDB, MasterKey} = wallet;
const {Mnemonic} = hd;

const MultisigDB = require('../lib/multisigdb');
const WalletNodeClient = require('../lib/walletclient');
const MultisigWallet = require('../lib/wallet');
const CosignerCtx = require('./util/cosigner-context');

// at this point we don't use anything from MSDB
const TEST_MSDB = {
  db: {},
  logger: Logger.global,
  network: Network.primary
};

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
    const cosignerCtx1 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      token: Buffer.alloc(32, 1)
    });

    const cosignerCtx2 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      token: Buffer.alloc(32, 2),
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const testCosigners = [
      cosignerCtx1.toCosigner(),
      cosignerCtx2.toCosigner()
    ];

    const options = {
      wid: 1,
      cosigners: testCosigners,
      joinPubKey: cosignerCtx1.joinPubKey,
      ...WALLET_OPTIONS
    };

    const mswallet = new MultisigWallet(TEST_MSDB, options);

    {
      const keys = ['n', 'm', 'id', 'wid'];
      for (const key of keys)
        assert.strictEqual(mswallet[key], options[key]);

      assert.strictEqual(mswallet.cosigners.length, 2);
    }

    const cosopts = testCosigners;
    const cosigners = mswallet.cosigners;
    const keys = Object.keys(cosopts[0]).filter(k => k !== 'id');

    for (const [i, cosigner] of cosigners.entries()) {
      assert.strictEqual(cosigner.id, i);

      for (const key of keys)
        assert.strictEqual(cosigner[key], cosopts[i][key],
          `value of ${key} does not match`);
    }
  });

  it('should reserialize correctly', () => {
    const cosignerCtx1 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      token: Buffer.alloc(32, 1)
    });

    const cosignerCtx2 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      token: Buffer.alloc(32, 2),
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const testCosigners = [
      cosignerCtx1.toCosigner(),
      cosignerCtx2.toCosigner()
    ];

    const options = {
      cosigners: testCosigners,
      joinPubKey: cosignerCtx1.joinPubKey,
      ...WALLET_OPTIONS
    };

    const mswallet1 = new MultisigWallet(TEST_MSDB, options);

    // inject properties derived from bcoin#Wallet
    mswallet1.master = generateMaster();

    const data = mswallet1.toRaw();
    const mswallet2 = MultisigWallet.fromRaw(TEST_MSDB, data);

    // we don't care about wid/id/master
    mswallet1.wid = 0;
    mswallet1.id = null;

    assert.deepStrictEqual(mswallet1.toJSON(0), mswallet2.toJSON(0));
  });

  it('should create multisig wallet', async () => {
    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      token: Buffer.alloc(32, 3)
    });

    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };

    const mswallet = await msdb.create(walletOptions, cosigner);

    const wallet = mswallet.wallet;
    const account = await wallet.getAccount(0);

    assert.strictEqual(mswallet.id, wallet.id);
    assert.strictEqual(mswallet.wid, wallet.wid);

    assert.strictEqual(mswallet.m, account.m);
    assert.strictEqual(mswallet.n, account.n);
    assert.strictEqual(account.accountKey.xpubkey(), cosignerCtx.xpub);
  });

  it('should fail creating existing wallet', async () => {
    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner1',
      token: Buffer.alloc(32, 4)
    });

    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };

    await msdb.create(walletOptions, cosigner);

    let err;

    try {
      const cosignerCtx2 = new CosignerCtx({
        walletName: WALLET_OPTIONS.id,
        name: 'cosigner2',
        master: cosignerCtx.master,
        token: Buffer.alloc(32, 4)
      });

      const cosigner = cosignerCtx2.toCosigner();
      const walletOptions = {
        joinPubKey: cosignerCtx2.joinPubKey,
        ...WALLET_OPTIONS
      };

      await msdb.create(walletOptions, cosigner);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');

    err = null;

    try {
      const cosignerCtx3 = new CosignerCtx({
        walletName: WALLET_OPTIONS.id,
        name: 'cosigner2',
        master: cosignerCtx.master,
        token: Buffer.alloc(32, 5)
      });

      const cosigner = cosignerCtx3.toCosigner();
      const walletOptions = {
        id: 'primary',
        joinPubKey: cosignerCtx3.joinPubKey,
        ...WALLET_OPTIONS
      };

      await msdb.create(walletOptions, cosigner);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'WDB: Wallet already exists.');
  });

  it('should get multisig wallet', async () => {
    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner1'
    });
    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };
    const mswallet = await msdb.create(walletOptions, cosigner);
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

    assert.strictEqual(mswallet, null);
    assert.strictEqual(nonMultisigWallet, null);
  });

  it('should list multisig wallets', async () => {
    {
      const mswallets = await msdb.getWallets();
      const wallets = await wdb.getWallets();

      assert.deepStrictEqual(mswallets, []);
      assert.deepStrictEqual(wallets, ['primary']);
    }

    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner',
      token: Buffer.alloc(32, 6)
    });

    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };

    // add wallets
    await msdb.create(walletOptions, cosigner);

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
    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner1',
      token: Buffer.alloc(32, 7)
    });

    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };

    await msdb.create(walletOptions, cosigner);
    const removed = await msdb.remove(WALLET_OPTIONS.id);
    const wallet = await msdb.getWallet(WALLET_OPTIONS.id);
    const wallets = await msdb.getWallets();

    assert.strictEqual(removed, true);
    assert.strictEqual(wallet, null);
    assert.strictEqual(wallets.length, 0);
  });

  it('should fail deleting non existing multisig wallet', async () => {
    const removed = await msdb.remove('test');
    const removeNonMultisig = await msdb.remove('primary');

    assert.strictEqual(removed, false);
    assert.strictEqual(removeNonMultisig, false);
  });

  it('should join wallet with joinKey', async () => {
    const walletName = 'wallet-1of3';
    const cosignerCtx1 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner1'
    });
    const cosignerCtx2 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner2',
      joinPrivKey: cosignerCtx1.joinPrivKey
    });
    const cosignerCtx3 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner3',
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const options = {
      id: walletName,
      m: 1,
      n: 3,
      joinPubKey: cosignerCtx1.joinPubKey
    };

    const cosigner1 = cosignerCtx1.toCosigner();
    const mswallet = await msdb.create(options, cosigner1);

    const cosigner2 = cosignerCtx2.toCosigner();
    const join1 = await mswallet.join(cosigner2);

    assert(join1, 'Multisig wallet was not returned.');
    assert.strictEqual(join1.cosigners.length, 2,
      'Number of cosigners does not match.'
    );
    assert.strictEqual(join1.isInitialized(), false,
      'Wallet needs one more cosigner.'
    );

    assert.strictEqual(join1.cosigners[1].id, 1);
    assert.ok(Buffer.isBuffer(join1.cosigners[1].token));

    const cosigner3 = cosignerCtx3.toCosigner();

    const join2 = await mswallet.join(cosigner3);

    assert(join2, 'Multisig wallet was not returned.');
    assert.strictEqual(join2.cosigners.length, 3,
      'Number of cosigners does not match'
    );
    assert.strictEqual(join2.isInitialized(), true,
      'Wallet was not initialized'
    );
    assert.strictEqual(join2.cosigners[2].id, 2);
    assert.ok(Buffer.isBuffer(join2.cosigners[2].token));
    assert.strictEqual(join2.cosigners[2].name, cosigner3.name);

    const account = await mswallet.wallet.getAccount(0);

    // account.keys are sorted
    assert.strictEqual(
      account.accountKey.equals(cosignerCtx1.accountKey),
      true
    );

    assert(account.keys.findIndex(k => k.equals(cosignerCtx2.accountKey)) > -1);
    assert(account.keys.findIndex(k => k.equals(cosignerCtx3.accountKey)) > -1);
  });

  it('should fail joining with duplicate XPUB', async () => {
    const walletName = 'wallet-1of3';
    const cosignerCtx1 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner1'
    });
    const cosignerCtx2 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner2',
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const options = {
      id: walletName,
      m: 1,
      n: 3,
      joinPubKey: cosignerCtx1.joinPubKey
    };

    const cosigner = cosignerCtx1.toCosigner();
    const mswallet = await msdb.create(options, cosigner);

    const cosigner2 = cosignerCtx2.toCosigner();
    await mswallet.join(cosigner2);

    let err;
    try {
      const cosignerCtx = new CosignerCtx({
        walletName: walletName,
        name: 'cosigner3',
        master: cosignerCtx1.master,
        joinPrivKey: cosignerCtx1.joinPrivKey
      });

      const cosigner3 = cosignerCtx.toCosigner();

      await mswallet.join(cosigner3);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cannot add own key.');

    err = null;

    try {
      const cosignerCtx = new CosignerCtx({
        walletName: walletName,
        name: 'cosigner3',
        master: cosignerCtx2.master,
        joinPrivKey: cosignerCtx1.joinPrivKey
      });

      const cosigner3 = cosignerCtx.toCosigner();
      await mswallet.join(cosigner3);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Can not add duplicate keys.');
  });

  it('should fail joining full wallet', async () => {
    const walletName = 'wallet-1of2';

    const cosignerCtx1 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner1'
    });
    const cosignerCtx2 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner2',
      joinPrivKey: cosignerCtx1.joinPrivKey
    });
    const cosignerCtx3 = new CosignerCtx({
      walletName: walletName,
      name: 'cosigner3',
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const options = {
      id: walletName,
      m: 1,
      n: 2,
      joinPubKey: cosignerCtx1.joinPubKey
    };

    const cosigner1 = cosignerCtx1.toCosigner();
    const mswallet = await msdb.create(options, cosigner1);
    assert.strictEqual(mswallet.isInitialized(), false);

    const cosigner2 = cosignerCtx2.toCosigner();
    const cosigner3 = cosignerCtx3.toCosigner();

    await mswallet.join(cosigner2);
    assert.strictEqual(mswallet.isInitialized(), true);

    let err;

    try {
      await mswallet.join(cosigner3);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Multisig wallet is full.');
    assert.strictEqual(mswallet.isInitialized(), true);
  });

  it('should authenticate user with cosignerToken', async () => {
    const cosignerCtx1 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner1',
      token: Buffer.alloc(32, 1)
    });

    const cosignerCtx2 = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner2',
      token: Buffer.alloc(32, 2),
      joinPrivKey: cosignerCtx1.joinPrivKey
    });

    const cosigner1 = cosignerCtx1.toCosigner();
    const cosigner2 = cosignerCtx2.toCosigner();

    const walletOptions = {
      joinPubKey: cosignerCtx1.joinPubKey,
      ...WALLET_OPTIONS
    };

    const mswallet = await msdb.create(walletOptions, cosigner1);

    await mswallet.join(cosigner2);

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
    const token1 = Buffer.alloc(32, 1);
    const token2 = Buffer.alloc(32, 2);

    const cosignerCtx = new CosignerCtx({
      walletName: WALLET_OPTIONS.id,
      name: 'cosigner1',
      token: token1
    });

    const cosigner = cosignerCtx.toCosigner();
    const walletOptions = {
      joinPubKey: cosignerCtx.joinPubKey,
      ...WALLET_OPTIONS
    };

    const mswallet = await msdb.create(walletOptions, cosigner);
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
