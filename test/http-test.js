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

/*
 * Setup nodes
 */

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

const WALLET_OPTIONS = {
  m: 1,
  n: 2,
  id: 'test'
};

describe('HTTP', function () {
  let joinKey;

  before(async () => {
    await fullNode.open();
    await walletNode.open();
  });

  after(async () => {
    await walletNode.close();
    await fullNode.close();
  });

  let multisigClient;
  let walletClient;
  let cosignerToken;

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
    const xpub = getXPUB();
    const cosignerName = 'cosigner1';
    const id = WALLET_OPTIONS.id;

    const walletOptions = Object.assign({
      cosignerName, xpub
    }, WALLET_OPTIONS);

    const wallet = await multisigClient.createWallet(id, walletOptions);
    const multisigWallets = await multisigClient.getWallets();
    const wallets = await walletClient.getWallets();

    assert.strictEqual(wallet.wid, 1);
    assert.strictEqual(wallet.id, id);
    assert.strictEqual(wallet.cosigners.length, 1);
    assert.strictEqual(wallet.m, 1);
    assert.strictEqual(wallet.n, 2);

    const cosigner = wallet.cosigners[0];
    assert.strictEqual(cosigner.name, 'cosigner1');
    assert.strictEqual(cosigner.path, '');
    assert.strictEqual(cosigner.token.length, 64);
    assert.strictEqual(cosigner.tokenDepth, 0);

    joinKey = wallet.joinKey;
    cosignerToken = cosigner.token;

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, [id]);

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', id]);
  });

  it('should get multisig wallet by id', async () => {
    const multisigWallet = await multisigClient.getInfo('test');

    assert(multisigWallet, 'Can not get multisig wallet.');
    assert.strictEqual(multisigWallet.wid, 1);
    assert.strictEqual(multisigWallet.id, 'test');

    assert.strictEqual(multisigWallet.cosigners.length, 1);
    assert.deepEqual(multisigWallet.cosigners, [{
      name: 'cosigner1',
      path: '',
      tokenDepth: 0,
      token: null
    }]);
  });

  it('should get multisig wallet by id - authenticated', async () => {
    const msclient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosignerToken
    });

    const mswallet = await msclient.getInfo('test');

    assert(mswallet, 'Could not get wallet.');
  });

  it('should fail getting multisig wallet - non authenticated', async () => {
    const msclient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY
    });

    let err;
    try {
      await msclient.getInfo('test');
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Auth failure.');
  });

  it('should join multisig wallet', async () => {
    const xpub = getXPUB();
    const cosignerName = 'cosigner2';

    const mswallet = await multisigClient.join(WALLET_OPTIONS.id, {
      cosignerName, joinKey, xpub
    });

    assert(mswallet, 'Did not return multisig wallet.');
    assert.strictEqual(mswallet.wid, 1);
    assert.strictEqual(mswallet.id, 'test');
    assert.strictEqual(mswallet.cosigners.length, 2);
    assert.strictEqual(mswallet.initialized, true);

    const cosigners = mswallet.cosigners;

    assert.deepStrictEqual(cosigners[0], {
      name: 'cosigner1',
      path: '',
      tokenDepth: 0,
      token: null
    });

    assert.notTypeOf(cosigners[1].token, 'null');

    assert.deepStrictEqual(cosigners[1], Object.assign({
      name: 'cosigner2',
      path: '',
      tokenDepth: 0
    }, {
      token: cosigners[1].token
    }));
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

/*
 * Helpers
 */

function getXPUB() {
  return hd.PrivateKey.generate()
    .derivePath('m/44\'/0\'/0\'')
    .xpubkey(network);
}
