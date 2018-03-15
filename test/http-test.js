/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const bcoin = require('bcoin');
const {FullNode} = bcoin;
const {wallet} = bcoin;
const {Network} = bcoin;
const {hd} = bcoin;

const MultisigClient = require('../lib/client');
const {WalletClient} = require('bclient');

const NETWORK_NAME = 'regtest';
const API_KEY = 'foo';
const ADMIN_TOKEN = Buffer.alloc(32).toString('hex');

const network = Network.get(NETWORK_NAME);

const options = {
  network: NETWORK_NAME,
  apiKey: API_KEY,
  memory: true,
  workers: true
};

const fullNode = new FullNode({
  network: options.network,
  apiKey: options.apiKey,
  memory: options.memory,
  workers: options.workers
});

const walletNode = new wallet.Node({
  network: options.network,
  memory: options.memory,
  workers: options.workers,

  walletAuth: true,
  apiKey: options.apiKey,
  nodeApiKey: options.apiKey,
  adminToken: ADMIN_TOKEN,

  plugins: [require('../lib/bmultisig')]
});

describe('HTTP', function () {
  before(async () => {
    await fullNode.open();
    await walletNode.open();
  });

  after(async () => {
    await walletNode.close();
    await fullNode.close();
  });

  let multisigClient, walletClient;

  beforeEach(async () => {
    multisigClient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });

    walletClient = new WalletClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });

    await multisigClient.open();
  });

  afterEach(async () => {
    await multisigClient.close();
  });

  it('should create multisig wallet', async () => {
    const id = 'test';
    const xpub = hd.PrivateKey.generate().xpubkey(network);
    const wallet = await multisigClient.createWallet(id, {
      m: 1,
      n: 3,
      xpub: xpub,
      cosignerName: 'cosigner1'
    });

    const multisigWallets = await multisigClient.getWallets();
    const wallets = await walletClient.getWallets();

    assert.strictEqual(wallet.wid, 1);
    assert.strictEqual(wallet.id, id);
    assert.strictEqual(wallet.cosigners.length, 1);

    const cosigner = wallet.cosigners[0];
    assert.strictEqual(cosigner.name, 'cosigner1');
    assert.strictEqual(cosigner.path, '');

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, [id]);

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', id]);
  });

  it('should fail creating existing wallet', async () => {
    const xpub = hd.PrivateKey.generate().xpubkey(network);

    for (const id of ['test', 'primary']) {
      try {
        await multisigClient.createWallet(id, {
          m: 1,
          n: 3,
          xpub: xpub,
          cosignerName: 'test1'
        });

        assert.fail('creating wallet with existing id must fail.');
      } catch (err) {
        assert.instanceOf(err, Error);
        assert.strictEqual(err.message, 'WDB: Wallet already exists.');
      }
    }
  });

  it('should get multisig wallet by id', async () => {
    const multisigWallet = await multisigClient.getInfo('test');

    assert(multisigWallet, 'Can not get multisig wallet');
    assert.strictEqual(multisigWallet.wid, 1);
    assert.strictEqual(multisigWallet.id, 'test');

    assert.strictEqual(multisigWallet.cosigners.length, 1);
    assert.deepEqual(multisigWallet.cosigners, [{
      name: 'cosigner1',
      path: '',
      tokenDepth: 0
    }]);
  });

  it('should return null on non existing wallet', async () => {
    const nonMultisigWallet = await multisigClient.getInfo('primary');
    const nowallet = await multisigClient.getInfo('nowallet');

    assert.typeOf(nonMultisigWallet, 'null');
    assert.typeOf(nowallet, 'null');
  });

  it('should list multisig wallets', async () => {
    const multisigWallets = await multisigClient.getWallets();
    const wallets = await walletClient.getWallets();

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', 'test']);

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, ['test']);
  });

  it('should delete multisig wallet', async () => {
    const id = 'test';
    const multisigWalletsBefore = await multisigClient.getWallets();
    const walletsBefore = await walletClient.getWallets();
    const removed = await multisigClient.removeWallet(id);
    const multisigWalletsAfter = await multisigClient.getWallets();
    const walletsAfter = await walletClient.getWallets();

    assert.strictEqual(removed, true, 'Could not remove wallet');
    assert(removed);
    assert.deepEqual(multisigWalletsBefore, [id]);
    assert.deepEqual(multisigWalletsAfter, []);
    assert.deepEqual(walletsBefore, ['primary', id]);
    assert.deepEqual(walletsAfter, ['primary']);
  });

  it('should fail deleting non existing multisig wallet', async () => {
    const removed = await multisigClient.removeWallet('nowallet');
    const removedPrimary = await multisigClient.removeWallet('primary');

    assert.strictEqual(removed, false, 'Removed non existing wallet');
    assert.strictEqual(removedPrimary, false, 'Can not remove primary wallet');
  });
});
