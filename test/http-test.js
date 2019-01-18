/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const walletUtils = require('./util/wallet');
const testUtils = require('./util/utils');

const bcoin = require('bcoin');
const {Network, FullNode} = bcoin;
const {MTX, TX, Amount, KeyRing} = bcoin;
const {wallet, hd} = bcoin;
const Proposal = require('../lib/primitives/proposal');

const MultisigClient = require('../lib/client');
const {WalletClient} = require('bclient');

const NETWORK_NAME = 'regtest';
const API_KEY = 'foo';
const ADMIN_TOKEN = Buffer.alloc(32, 1).toString('hex');

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

  // logLevel: 'debug',

  plugins: [require('../lib/plugin')]
});

const wdb = walletNode.wdb;

// walletNode.on('error', err => console.error(err));

const WALLET_OPTIONS = {
  m: 2,
  n: 2,
  id: 'test'
};

describe('HTTP', function () {
  before(async () => {
    await fullNode.open();
    await walletNode.open();
  });

  after(async () => {
    await walletNode.close();
    await fullNode.close();
  });

  let adminClient;
  let multisigClient;
  let walletAdminClient;
  let testWalletClient1;
  let testWalletClient2;
  let joinKey;

  let pid1, pid2; // proposal ids

  const priv1 = getPrivKey().deriveAccount(44, 0, 0);
  const priv2 = getPrivKey().deriveAccount(44, 0, 0);
  const xpub1 = priv1.toPublic();
  const xpub2 = priv2.toPublic();

  beforeEach(async () => {
    adminClient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });

    multisigClient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY
    });

    walletAdminClient = new WalletClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });
  });

  it('should create multisig wallet', async () => {
    const xpub = xpub1.xpubkey(network);

    const cosignerName = 'cosigner1';
    const id = WALLET_OPTIONS.id;

    const walletOptions = Object.assign({
      cosignerName, xpub
    }, WALLET_OPTIONS);

    const wallet = await multisigClient.createWallet(id, walletOptions);
    const multisigWallets = await adminClient.getWallets();
    const wallets = await walletAdminClient.getWallets();

    assert.strictEqual(wallet.wid, 1);
    assert.strictEqual(wallet.id, id);
    assert.strictEqual(wallet.cosigners.length, 1);
    assert.strictEqual(wallet.m, 2);
    assert.strictEqual(wallet.n, 2);

    const cosigner = wallet.cosigners[0];
    assert.strictEqual(cosigner.name, 'cosigner1');
    assert.strictEqual(cosigner.path, '');
    assert.strictEqual(cosigner.token.length, 64);
    assert.strictEqual(cosigner.tokenDepth, 0);

    joinKey = wallet.joinKey;

    testWalletClient1 = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosigner.token
    });

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, [id]);

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', id]);
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
    assert.strictEqual(err.message, 'Authentication error.');
  });

  it('should join multisig wallet', async () => {
    const xpub = xpub2.xpubkey(network);
    const cosignerName = 'cosigner2';

    const mswallet = await multisigClient.joinWallet(WALLET_OPTIONS.id, {
      cosignerName, joinKey, xpub
    });

    assert(mswallet, 'Did not return multisig wallet.');
    assert.strictEqual(mswallet.wid, 1);
    assert.strictEqual(mswallet.id, 'test');
    assert.strictEqual(mswallet.cosigners.length, 2);
    assert.strictEqual(mswallet.initialized, true);

    const cosigners = mswallet.cosigners;

    assert.deepStrictEqual(cosigners[0], {
      id: 0,
      name: 'cosigner1'
    });

    assert.notTypeOf(cosigners[1].token, 'null');

    testWalletClient2 = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosigners[1].token
    });

    assert.deepStrictEqual(cosigners[1], Object.assign({
      id: 1,
      name: 'cosigner2',
      path: '',
      tokenDepth: 0
    }, {
      token: cosigners[1].token
    }));
  });

  it('should get multisig wallet by id', async () => {
    const multisigWallet = await testWalletClient1.getInfo('test');

    assert(multisigWallet, 'Can not get multisig wallet.');
    assert.strictEqual(multisigWallet.wid, 1);
    assert.strictEqual(multisigWallet.id, 'test');

    assert.strictEqual(multisigWallet.initialized, true);
    assert.strictEqual(multisigWallet.cosigners.length, 2);
    assert.deepEqual(multisigWallet.cosigners, [
      { id: 0, name: 'cosigner1' },
      { id: 1, name: 'cosigner2' }
    ]);

    // with details
    const msWalletDetails = await testWalletClient1.getInfo('test', true);
    const account = msWalletDetails.account;

    assert(msWalletDetails, 'Can not get multisig wallet');
    assert.strictEqual(msWalletDetails.wid, multisigWallet.wid);
    assert.strictEqual(msWalletDetails.id, multisigWallet.id);
    assert.strictEqual(msWalletDetails.initialized, true);

    assert(account, 'Could not get account details');
    assert.strictEqual(account.watchOnly, true);
    assert.strictEqual(account.initialized, msWalletDetails.initialized);
    assert(account.receiveAddress);
    assert(account.changeAddress);
    assert(account.nestedAddress);
    assert.strictEqual(account.keys.length, msWalletDetails.n);
  });

  it('should return null on non existing wallet', async () => {
    const nonMultisigWallet = await multisigClient.getInfo('primary');
    const nowallet = await multisigClient.getInfo('nowallet');

    assert.typeOf(nonMultisigWallet, 'null');
    assert.typeOf(nowallet, 'null');
  });

  it('should list multisig wallets', async () => {
    const multisigWallets = await adminClient.getWallets();
    const wallets = await walletAdminClient.getWallets();

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', 'test']);

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, ['test']);
  });

  it('should rescan db', async () => {
    const rescan = await adminClient.rescan(0);

    assert(rescan);
    assert.strictEqual(rescan.success, true);
  });

  it('should get wallet balance(proxy)', async () => {
    // no auth
    let err;
    try {
      await multisigClient.getBalance(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    // admin
    const balance1 = await adminClient.getBalance(WALLET_OPTIONS.id);

    // cosigner auth
    const balance2 = await testWalletClient1.getBalance(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert(balance1);
    assert(balance2);
  });

  it('should fail to get balance(proxy) with incorrect token', async () => {
    const msclient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: Buffer.alloc(32).toString('hex')
    });

    let err;
    try {
      await msclient.getBalance(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert(err.message, 'Authentication error.');
  });

  it('should get coin (proxy)', async () => {
    let err;

    try {
      await multisigClient.getCoins(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    const coins1 = await adminClient.getCoins(WALLET_OPTIONS.id);
    const coins2 = await testWalletClient1.getCoins(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert.strictEqual(coins1.length, 0);
    assert.strictEqual(coins2.length, 0);
  });

  it('should get address (proxy)', async () => {
    let err;

    try {
      await multisigClient.createAddress(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    const addr1 = await adminClient.createAddress(WALLET_OPTIONS.id);
    const addr2 = await testWalletClient2.createAddress(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert(addr1);
    assert(addr2);

    assert.strictEqual(addr1.index, 1);
    assert.strictEqual(addr2.index, 2);
    assert.strictEqual(addr1.name, 'default');
    assert.strictEqual(addr2.name, 'default');
    assert.strictEqual(addr1.account, 0);
    assert.strictEqual(addr2.account, 0);
  });

  it('should fund and create transaction', async () => {
    const msWalletDetails = await testWalletClient1.getInfo('test', true);
    const addr = msWalletDetails.account.receiveAddress;

    await walletUtils.fundAddressBlock(wdb, addr, 1);

    const txoptions = getTXOptions(1);

    const txjson = await testWalletClient1.createTX(
      WALLET_OPTIONS.id,
      txoptions
    );

    assert.strictEqual(typeof txjson, 'object');
    const tx = TX.fromJSON(txjson);

    assert.instanceOf(tx, TX);
    assert.strictEqual(tx.inputs.length, 1);
    assert.strictEqual(tx.outputs.length, 1);
  });

  it('should create proposal', async () => {
    const txoptions = getTXOptions(1);

    const proposal = await testWalletClient2.createProposal(
      WALLET_OPTIONS.id,
      { memo: 'proposal1', ...txoptions}
    );

    const tx = TX.fromRaw(proposal.tx, 'hex');

    pid1 = proposal.id;

    assert.instanceOf(tx, TX);
    assert.deepStrictEqual(proposal.author, { id: 1, name: 'cosigner2' });
    assert.strictEqual(proposal.memo, 'proposal1');
    assert.strictEqual(proposal.m, WALLET_OPTIONS.m);
    assert.strictEqual(proposal.n, WALLET_OPTIONS.n);
    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should list pending proposals', async () => {
    const proposals = await testWalletClient1.getProposals(WALLET_OPTIONS.id);
    const proposal = proposals[0];

    assert.strictEqual(proposals.length, 1);
    assert.deepStrictEqual(proposal.author, { id: 1, name: 'cosigner2'});
  });

  it('should get proposal', async () => {
    const proposal = await testWalletClient1.getProposalInfo(
      WALLET_OPTIONS.id,
      pid1
    );

    assert.strictEqual(proposal.memo, 'proposal1');
    assert.strictEqual(proposal.m, WALLET_OPTIONS.m);
    assert.strictEqual(proposal.n, WALLET_OPTIONS.n);
    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should get proposal tx', async () => {
    const txinfo = await testWalletClient1.getProposalMTX(
      WALLET_OPTIONS.id,
      pid1
    );

    assert(txinfo.tx);
  });

  it('should reject proposal', async () => {
    const proposal = await testWalletClient1.rejectProposal(
      WALLET_OPTIONS.id,
      pid1
    );

    const pendingProposals = await testWalletClient1.getProposals(
      WALLET_OPTIONS.id
    );

    const proposals = await testWalletClient1.getProposals(
      WALLET_OPTIONS.id,
      false
    );

    assert.strictEqual(pendingProposals.length, 0);
    assert.strictEqual(proposals.length, 1);

    assert.strictEqual(proposal.memo, 'proposal1');
    assert.strictEqual(proposal.statusCode, Proposal.status.REJECTED);
    assert.strictEqual(proposal.rejections.length, 1);
    assert.deepStrictEqual(proposal.rejections[0], {
      id: 0,
      name: 'cosigner1'
    });
  });

  it('should create another proposal using same coins', async () => {
    const txoptions = getTXOptions(1);
    const proposal = await testWalletClient1.createProposal(
      WALLET_OPTIONS.id,
      { memo: 'proposal2', ...txoptions }
    );

    pid2 = proposal.id;

    assert.strictEqual(proposal.memo, 'proposal2');
    assert.deepStrictEqual(proposal.author, {
      id: 0,
      name: 'cosigner1'
    });

    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should get transaction with input paths', async () => {
    const txinfo = await testWalletClient1.getProposalMTX(
      WALLET_OPTIONS.id,
      pid2,
      { paths: true }
    );

    const mtx = MTX.fromJSON(txinfo.tx);
    const paths = txinfo.paths;

    assert.instanceOf(mtx, MTX);
    assert.strictEqual(mtx.inputs.length, txinfo.paths.length);
    assert.strictEqual(paths[0].branch, 0);
    assert.strictEqual(paths[0].index, 2);
    assert.strictEqual(paths[0].receive, true);
  });

  it('should sign and approve proposal', async () => {
    const txinfo = await testWalletClient1.getProposalMTX(
      WALLET_OPTIONS.id,
      pid2,
      {
        paths: true,
        scripts: true
      }
    );

    const mtx = MTX.fromJSON(txinfo.tx);
    const paths = txinfo.paths;

    const rings = testUtils.getMTXRings(mtx, paths, priv1, [xpub1, xpub2], 2);

    for (const ring of rings) {
      if (!ring)
        continue;

      ring.witness = true;
    }

    const signatures = testUtils.getMTXSignatures(mtx, rings);

    const response = await testWalletClient1.approveProposal(
      WALLET_OPTIONS.id,
      pid2,
      signatures
    );

    const proposal = response.proposal;

    assert.strictEqual(proposal.approvals.length, 1);
    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should approve and verify', async () => {
    const balance1 = await testWalletClient1.getBalance(WALLET_OPTIONS.id);

    const txinfo = await testWalletClient1.getProposalMTX(
      WALLET_OPTIONS.id,
      pid2,
      {
        paths: true,
        scripts: true
      }
    );

    const mtx = MTX.fromJSON(txinfo.tx);
    const paths = txinfo.paths;

    const rings = testUtils.getMTXRings(mtx, paths, priv2, [xpub1, xpub2], 2);

    for (const ring of rings) {
      if (!ring)
        continue;

      ring.witness = true;
    }

    const signatures = testUtils.getMTXSignatures(mtx, rings);

    const response = await testWalletClient2.approveProposal(
      WALLET_OPTIONS.id,
      pid2,
      signatures
    );

    const proposal = response.proposal;

    // we are not spending it yet.
    await wdb.addBlock(walletUtils.nextBlock(wdb), []);
    assert.strictEqual(Amount.fromBTC(1).toValue(), balance1.confirmed);

    assert.strictEqual(proposal.statusCode, Proposal.status.APPROVED);
    assert.strictEqual(proposal.approvals.length, 2);

    // verify tx is signed
    const txinfo2 = await testWalletClient2.getProposalMTX(
      WALLET_OPTIONS.id,
      pid2,
    );

    const mtx2 = MTX.fromJSON(txinfo2.tx);
    assert(mtx2.verify(), 'Transaction is not valid.');

    const jsontx = await testWalletClient2.sendProposal(
      WALLET_OPTIONS.id,
      pid2
    );

    assert(jsontx, 'Transaction not found');

    const tx = TX.fromJSON(jsontx);

    await wdb.addBlock(walletUtils.nextBlock(wdb), [tx]);
    const balance2 = await testWalletClient1.getBalance(WALLET_OPTIONS.id);
    assert.strictEqual(0, balance2.confirmed);
  });

  it('should delete multisig wallet', async () => {
    const id = 'test';
    const multisigWalletsBefore = await adminClient.getWallets();
    const walletsBefore = await walletAdminClient.getWallets();
    const removed = await adminClient.removeWallet(id);
    const multisigWalletsAfter = await adminClient.getWallets();
    const walletsAfter = await walletAdminClient.getWallets();

    assert.strictEqual(removed, true, 'Could not remove wallet');
    assert.deepEqual(multisigWalletsBefore, [id]);
    assert.deepEqual(multisigWalletsAfter, []);
    assert.deepEqual(walletsBefore, ['primary', id]);
    assert.deepEqual(walletsAfter, ['primary']);
  });

  it('should fail deleting non existing multisig wallet', async () => {
    const removed = await adminClient.removeWallet('nowallet');
    const removedPrimary = await adminClient.removeWallet('primary');

    assert.strictEqual(removed, false, 'Removed non existing wallet');
    assert.strictEqual(removedPrimary, false, 'Can not remove primary wallet');
  });

  describe('Client', function () {
    it('should parse multisig path from path', () => {
      const path = '/test';
      const multisigPath = '/test/multisig';

      const client = new MultisigClient({ path });

      assert.strictEqual(client.rootPath, path);
      assert.strictEqual(client.path, multisigPath);
      assert.strictEqual(client.multisigPath, multisigPath);
    });

    it('should parse root path from multisig path', () => {
      const path = '/test';
      const multisigPath = '/test/multisig';

      const client = new MultisigClient({ multisigPath });
      assert.strictEqual(client.rootPath, path);
      assert.strictEqual(client.path, multisigPath);
      assert.strictEqual(client.multisigPath, multisigPath);
    });

    it('should parse root path from multisig path (trailing slash)', () => {
      const path = '/test';
      const multisigPath = '/test/multisig/';

      const client = new MultisigClient({ multisigPath });
      assert.strictEqual(client.rootPath, path);
      assert.strictEqual(client.path, multisigPath);
      assert.strictEqual(client.multisigPath, multisigPath);
    });

    it('should parse path from string', () => {
      const path = '/test';
      const multisigPath = '/test/multisig';
      const url = 'https://localhost/test';

      const client = new MultisigClient(url);
      assert.strictEqual(client.rootPath, path);
      assert.strictEqual(client.path, multisigPath);
      assert.strictEqual(client.multisigPath, multisigPath);
    });

    // not servers
    it('should specify separate wallet and multisig paths', () => {
      const path = '/test/wallet';
      const multisigPath = '/test/multisigPath';

      const client = new MultisigClient({ path, multisigPath });
      assert.strictEqual(client.rootPath, path);
      assert.strictEqual(client.path, multisigPath);
      assert.strictEqual(client.multisigPath, multisigPath);
    });
  });
});

/*
 * Helpers
 */

function getTXOptions(btc) {
  return {
    subtractFee: true,
    outputs: [{
      address: generateAddress().toString(network),
      value: Amount.fromBTC(btc).toValue()
    }]
  };
}

function getPrivKey() {
  return hd.PrivateKey.generate();
}

function generateAddress() {
  return KeyRing.generate().getAddress();
}
