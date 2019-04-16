/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const walletUtils = require('./util/wallet');
const testUtils = require('./util/utils');

const bcoin = require('bcoin');
const {Network, FullNode} = bcoin;
const {MTX, TX, Amount, KeyRing} = bcoin;
const {wallet} = bcoin;
const Proposal = require('../lib/primitives/proposal');
const CosignerCtx = require('./util/cosigner-context');
const {CREATE, REJECT} = Proposal.payloadType;

const MultisigClient = require('../lib/client');
const {WalletClient} = require('bclient');

const NETWORK_NAME = 'regtest';
const API_KEY = 'foo';
const ADMIN_TOKEN = Buffer.alloc(32, 250).toString('hex');

const network = Network.get(NETWORK_NAME);

for (const WITNESS of [true, false])
describe(`HTTP ${WITNESS ? 'witness' : 'legacy'}`, function () {
  const options = {
    network: NETWORK_NAME,
    apiKey: API_KEY,
    memory: true,
    workers: true
  };

  const WALLET_OPTIONS = {
    m: 2,
    n: 2,
    id: 'test',
    witness: WITNESS
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

  before(async () => {
    await fullNode.open();
    await fullNode.connect();
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

  let pid1, pid2; // proposal ids
  let poptions1;

  const cosignerCtx1 = new CosignerCtx({
    walletName: WALLET_OPTIONS.id,
    name: 'cosigner1',
    token: Buffer.alloc(32, 1),
    data: Buffer.alloc(10, 99),
    network
  });

  const cosignerCtx2 = new CosignerCtx({
    walletName: WALLET_OPTIONS.id,
    name: 'cosigner2',
    token: Buffer.alloc(32, 2),
    joinPrivKey: cosignerCtx1.joinPrivKey,
    network
  });

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

    adminClient.open();
    multisigClient.open();
    walletAdminClient.open();

    if (testWalletClient1)
      testWalletClient1.open();

    if (testWalletClient2)
      testWalletClient2.open();

    await Promise.all([
      waitFor(adminClient, 'connect'),
      waitFor(multisigClient, 'connect'),
      waitFor(walletAdminClient, 'connect'),
      testWalletClient1 ? waitFor(testWalletClient1, 'connect') : null,
      testWalletClient2 ? waitFor(testWalletClient2, 'connect') : null
    ]);

    if (testWalletClient1 && testWalletClient1.opened)
      testWalletClient1.join(WALLET_OPTIONS.id, testWalletClient1.token);

    if (testWalletClient2 && testWalletClient2.opened)
      testWalletClient2.join(WALLET_OPTIONS.id, testWalletClient2.token);

    // subscribe to all wallet events. (admin only)
    await adminClient.all(ADMIN_TOKEN);
    await walletAdminClient.all(ADMIN_TOKEN);
  });

  afterEach(async () => {
    await adminClient.leave('*');
    await walletAdminClient.leave('*');

    await adminClient.close();
    await multisigClient.close();
    await walletAdminClient.close();

    if (testWalletClient1 && testWalletClient1.opened)
      await testWalletClient1.close();

    if (testWalletClient2 && testWalletClient2.opened)
      await testWalletClient2.close();
  });

  it('should create multisig wallet', async () => {
    const id = WALLET_OPTIONS.id;
    const options = cosignerCtx1.toHTTPOptions();
    const joinPubKey = cosignerCtx1.joinPubKey.toString('hex');

    const walletOptions = Object.assign({},
      WALLET_OPTIONS,
      options,
      {joinPubKey}
    );

    const wallet = await multisigClient.createWallet(id, walletOptions);
    const multisigWallets = await adminClient.getWallets();
    const wallets = await walletAdminClient.getWallets();

    assert.strictEqual(wallet.wid, 1);
    assert.strictEqual(wallet.id, id);
    assert.strictEqual(wallet.cosigners.length, 1);

    const cosigner = wallet.cosigners[0];
    assert.strictEqual(cosigner.name, options.cosignerName);
    assert.strictEqual(cosigner.purpose, options.cosignerPurpose);
    assert.strictEqual(cosigner.data, options.cosignerData);
    assert.strictEqual(cosigner.fingerPrint, options.cosignerFingerPrint);
    assert.strictEqual(cosigner.token, options.token);
    assert.strictEqual(cosigner.token.length, 64);
    assert.strictEqual(cosigner.tokenDepth, 0);
    assert.strictEqual(cosigner.authPubKey, options.authPubKey);
    assert.strictEqual(cosigner.joinSignature, options.joinSignature);
    assert.strictEqual(cosigner.key.xpubkey, options.accountKey);

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
      await msclient.getInfo(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');

    // try to listen wallet events
    msclient.open();

    await waitFor(msclient, 'connect');

    err = null;
    try {
      await msclient.join(WALLET_OPTIONS.id, Buffer.alloc(0, 32));
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Bad token.');

    await msclient.close();
  });

  it('should join multisig wallet', async () => {
    const id = WALLET_OPTIONS.id;
    const options = cosignerCtx2.toHTTPOptions();

    // join event
    // TODO: Rewrite so we don't have uncaught rejections.
    // We don't have cancallable promises...
    const joinEvents = Promise.all([
      waitForBind(testWalletClient1, 'join'),
      waitForBind(adminClient, 'join'),
      waitForBind(walletAdminClient, 'join')
    ]);

    const mswallet = await multisigClient.joinWallet(id, options);

    const eventResponses = await joinEvents;

    const cosigners = mswallet.cosigners;
    for (const response of eventResponses) {
      assert.strictEqual(response[0], WALLET_OPTIONS.id);

      const cosigner = response[1];

      assert.deepStrictEqual(cosigner.name, cosigners[1].name);
      assert.deepStrictEqual(cosigner.id, cosigners[1].id);
    }

    assert(mswallet, 'Did not return multisig wallet.');
    assert.strictEqual(mswallet.wid, 1);
    assert.strictEqual(mswallet.id, 'test');
    assert.strictEqual(mswallet.cosigners.length, 2);
    assert.strictEqual(mswallet.initialized, true);

    assert.deepStrictEqual(cosigners[0], {
      id: 0,
      name: cosignerCtx1.name,
      authPubKey: cosignerCtx1.authPubKey.toString('hex'),
      joinSignature: cosignerCtx1.joinSignature.toString('hex'),
      key: cosignerCtx1.accountKey.toJSON(network)
    });

    assert.strictEqual(cosigners[1].token, options.token);

    testWalletClient2 = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosigners[1].token
    });

    assert.deepStrictEqual(cosigners[1], {
      id: 1,
      name: options.cosignerName,
      token: options.token,
      tokenDepth: 0,
      data: options.cosignerData,
      authPubKey: options.authPubKey,
      joinSignature: options.joinSignature,
      fingerPrint: options.cosignerFingerPrint,
      purpose: options.cosignerPurpose,
      key: {
        xpubkey: options.accountKey
      }
    });
  });

  it('should get multisig wallet by id', async () => {
    const walletName = WALLET_OPTIONS.id;
    const multisigWallet = await testWalletClient1.getInfo(walletName);

    assert(multisigWallet, 'Can not get multisig wallet.');
    assert.strictEqual(multisigWallet.wid, 1);
    assert.strictEqual(multisigWallet.id, 'test');

    assert.strictEqual(multisigWallet.initialized, true);
    assert.strictEqual(multisigWallet.cosigners.length, 2);
    assert.deepEqual(multisigWallet.cosigners, [
      {
        id: 0,
        name: cosignerCtx1.name,
        authPubKey: cosignerCtx1.authPubKey.toString('hex'),
        joinSignature: cosignerCtx1.joinSignature.toString('hex'),
        key: cosignerCtx1.accountKey.toJSON(network)
      },
      {
        id: 1,
        name: cosignerCtx2.name,
        authPubKey: cosignerCtx2.authPubKey.toString('hex'),
        joinSignature: cosignerCtx2.joinSignature.toString('hex'),
        key: cosignerCtx2.accountKey.toJSON(network)
      }
    ]);

    // with details
    const msWalletDetails = await testWalletClient1.getInfo(walletName, true);
    const account = await testWalletClient1.getAccount(walletName, 'default');

    assert(msWalletDetails, 'Can not get multisig wallet');
    assert.strictEqual(msWalletDetails.wid, multisigWallet.wid);
    assert.strictEqual(msWalletDetails.id, multisigWallet.id);
    assert.strictEqual(msWalletDetails.initialized, true);

    assert(account, 'Could not get account details');
    assert.strictEqual(account.watchOnly, true);
    assert.strictEqual(account.initialized, msWalletDetails.initialized);
    assert(account.receiveAddress);
    assert(account.changeAddress);
    if (WALLET_OPTIONS.witness)
      assert(account.nestedAddress);
    assert.strictEqual(account.m, 2);
    assert.strictEqual(account.n, 2);
    assert.strictEqual(account.keys.length, 1);
  });

  it('should return null on non existing wallet', async () => {
    const nonMultisigWallet = await multisigClient.getInfo('primary');
    const nowallet = await multisigClient.getInfo('nowallet');

    assert.ok(nonMultisigWallet === null);
    assert.ok(nowallet === null);
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

  it('should change token', async () => {
    const currentToken = testWalletClient1.token;
    const newToken = Buffer.alloc(32, 3).toString('hex');

    {
      const cosigner = await testWalletClient1.setToken(WALLET_OPTIONS.id, {
        newToken: newToken
      });

      assert.strictEqual(cosigner.name, cosignerCtx1.name);
      assert.strictEqual(cosigner.token, newToken);
    }

    let err;
    try {
      await testWalletClient1.setToken(WALLET_OPTIONS.id, {
        newToken: Buffer.alloc(32, 99).toString('hex')
      });
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');

    {
      testWalletClient1.token = newToken;
      const cosigner = await testWalletClient1.setToken(WALLET_OPTIONS.id, {
        newToken: currentToken
      });

      assert.strictEqual(cosigner.name, cosignerCtx1.name);
      assert.strictEqual(cosigner.token, currentToken.toString('hex'));
      testWalletClient1.token = currentToken;
    }
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
    const account = await testWalletClient1.getAccount(WALLET_OPTIONS.id);
    const addr = account.receiveAddress;

    await walletUtils.fundAddressBlock(wdb, addr, 1);

    const txoptions = getTXOptions(1);

    const txjson = await testWalletClient1.createTX(
      WALLET_OPTIONS.id,
      txoptions
    );

    assert.strictEqual(typeof txjson, 'object');
    const tx = TX.fromJSON(txjson);

    assert.ok(tx instanceof TX);
    assert.strictEqual(tx.inputs.length, 1);
    assert.strictEqual(tx.outputs.length, 1);
  });

  it('should create proposal', async () => {
    const createEvents = Promise.all([
      waitForBind(adminClient, 'proposal created'),
      waitForBind(walletAdminClient, 'proposal created'),
      waitForBind(testWalletClient2, 'proposal created')
    ]);

    const txoptions = getTXOptions(1);
    const proposalOptions = {
      memo: 'proposal1',
      timestamp: now(),
      txoptions
    };

    const signature = cosignerCtx2.signProposal(CREATE, proposalOptions);
    const proposal = await testWalletClient2.createProposal(
      WALLET_OPTIONS.id,
      {
        proposal: proposalOptions,
        signature: signature.toString('hex')
      }
    );

    const eventResults = await createEvents;

    for (const [wid, result] of eventResults) {
      assert.strictEqual(wid, WALLET_OPTIONS.id);
      assert.deepStrictEqual(result, proposal);
    }

    assert.deepStrictEqual(proposal.options, proposalOptions);

    const tx = TX.fromRaw(proposal.tx, 'hex');

    pid1 = proposal.id;
    poptions1 = proposal.options;

    assert.ok(tx instanceof TX);
    assert.strictEqual(proposal.author, 1);
    assert.deepStrictEqual(proposal.cosignerDetails[1], {
      id: 1,
      name: cosignerCtx2.name,
      authPubKey: cosignerCtx2.authPubKey.toString('hex'),
      joinSignature: cosignerCtx2.joinSignature.toString('hex'),
      key: cosignerCtx2.accountKey.toJSON(network)
    });

    assert.strictEqual(proposal.memo, 'proposal1');
    assert.strictEqual(proposal.m, WALLET_OPTIONS.m);
    assert.strictEqual(proposal.n, WALLET_OPTIONS.n);
    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should list pending proposals', async () => {
    const proposals = await testWalletClient1.getProposals(WALLET_OPTIONS.id);
    const proposal = proposals[0];

    assert.strictEqual(proposals.length, 1);
    assert.strictEqual(proposal.author, 1);
    assert.deepStrictEqual(proposal.cosignerDetails[proposal.author], {
      id: 1,
      name: cosignerCtx2.name,
      authPubKey: cosignerCtx2.authPubKey.toString('hex'),
      joinSignature: cosignerCtx2.joinSignature.toString('hex'),
      key: cosignerCtx2.accountKey.toJSON(network)
    });
  });

  it('should get proposal without tx', async () => {
    const proposal = await testWalletClient1.getProposalInfo(
      WALLET_OPTIONS.id,
      pid1,
      false
    );

    assert.strictEqual(proposal.memo, 'proposal1');
    assert.strictEqual(proposal.m, WALLET_OPTIONS.m);
    assert.strictEqual(proposal.n, WALLET_OPTIONS.n);
    assert.strictEqual(proposal.statusCode, Proposal.status.PROGRESS);
  });

  it('should get proposal with tx', async () => {
    const proposal = await testWalletClient1.getProposalInfo(
      WALLET_OPTIONS.id,
      pid1,
      true
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

  it('should get proposal tx with input txs', async () => {
    const txinfo = await testWalletClient1.getProposalMTX(
      WALLET_OPTIONS.id,
      pid1,
      { txs: true, paths: true }
    );

    const {tx,txs} = txinfo;
    // the same number of tx inputs as txs, since
    // each of the txs represent a raw tx input
    assert.equal(tx.inputs.length, txs.length);

    for (const [i, input] of Object.entries(tx.inputs)) {
      // convert the transaction the prevout
      // comes from into a mtx
      const mtx = MTX.fromRaw(txs[i], 'hex');
      // the hashes should match
      assert.equal(input.prevout.hash, mtx.txid().toString('hex'));

      // we can safely grab the output object after we know the hashes match
      // by using the prevout index
      const output = mtx.outputs[input.prevout.index];

      // assert that the values match
      assert.equal(output.value, input.coin.value);

      // assert that the scripts are equal
      assert.equal(
        output.script.toRaw('hex').toString('hex'),
        input.coin.script
      );
    }
  });

  it('should reject proposal', async () => {
    const rejectEvents = Promise.all([
      waitForBind(testWalletClient1, 'proposal rejected'),
      waitForBind(testWalletClient2, 'proposal rejected'),
      waitForBind(adminClient, 'proposal rejected'),
      waitForBind(walletAdminClient, 'proposal rejected')
    ]);

    const signature = cosignerCtx1.signProposal(REJECT, poptions1);
    const proposal = await testWalletClient1.rejectProposal(
      WALLET_OPTIONS.id,
      pid1,
      { signature: signature.toString('hex') }
    );

    const eventResults = await rejectEvents;

    for (const [wid, result] of eventResults) {
      assert.strictEqual(wid, WALLET_OPTIONS.id);
      assert.deepStrictEqual(result.proposal, proposal);
      assert.deepStrictEqual(result.cosigner, {
        id: 0,
        name: cosignerCtx1.name,
        authPubKey: cosignerCtx1.authPubKey.toString('hex'),
        joinSignature: cosignerCtx1.joinSignature.toString('hex'),
        key: cosignerCtx1.accountKey.toJSON(network)
      });
    }

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
    assert.strictEqual(Object.keys(proposal.rejections).length, 1);
    assert.strictEqual(proposal.rejections[0], signature.toString('hex'));
  });

  it('should create another proposal using same coins', async () => {
    const txoptions = getTXOptions(1);
    const proposalOptions = {
      memo: 'proposal2',
      timestamp: now(),
      txoptions
    };

    const signature = cosignerCtx1.signProposal(CREATE, proposalOptions);

    const proposal = await testWalletClient1.createProposal(
      WALLET_OPTIONS.id,
      {
        proposal: proposalOptions,
        signature: signature.toString('hex')
      }
    );

    assert.deepStrictEqual(proposal.options, proposalOptions);

    pid2 = proposal.id;

    assert.strictEqual(proposal.memo, 'proposal2');
    assert.strictEqual(proposal.author, 0);
    assert.deepStrictEqual(proposal.cosignerDetails[proposal.author], {
      id: 0,
      name: cosignerCtx1.name,
      authPubKey: cosignerCtx1.authPubKey.toString('hex'),
      joinSignature: cosignerCtx1.joinSignature.toString('hex'),
      key: cosignerCtx1.accountKey.toJSON(network)
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

    assert.ok(mtx instanceof MTX);
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

    const priv1 = cosignerCtx1.accountPrivKey;
    const xpub1 = cosignerCtx1.accountKey;
    const xpub2 = cosignerCtx2.accountKey;

    const rings = testUtils.getMTXRings(
      mtx, paths, priv1, [xpub1, xpub2], 2, WITNESS
    );

    const signatures = testUtils.getMTXSignatures(mtx, rings);

    const approveEvents = Promise.all([
      waitForBind(testWalletClient1, 'proposal approved'),
      waitForBind(testWalletClient2, 'proposal approved'),
      waitForBind(adminClient, 'proposal approved'),
      waitForBind(walletAdminClient, 'proposal approved')
    ]);

    const response = await testWalletClient1.approveProposal(
      WALLET_OPTIONS.id,
      pid2,
      {
        signatures: signatures.map(s => s.toString('hex')),
        broadcast: true
      }
    );

    const proposal = response.proposal;
    const eventResults = await approveEvents;
    const cosigner = {
      id: 0,
      name: cosignerCtx1.name,
      authPubKey: cosignerCtx1.authPubKey.toString('hex'),
      joinSignature: cosignerCtx1.joinSignature.toString('hex'),
      key: cosignerCtx1.accountKey.toJSON(network)
    };

    for (const [wid, result] of eventResults) {
      assert.strictEqual(wid, WALLET_OPTIONS.id);
      assert.deepStrictEqual(result.proposal, proposal);
      assert.deepStrictEqual(result.cosigner, cosigner);
    }

    assert.strictEqual(Object.keys(proposal.approvals).length, 1);
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

    const priv2 = cosignerCtx2.accountPrivKey;
    const xpub1 = cosignerCtx1.accountKey;
    const xpub2 = cosignerCtx2.accountKey;
    const rings = testUtils.getMTXRings(
      mtx,
      paths,
      priv2,
      [xpub1, xpub2],
      2,
      WALLET_OPTIONS.witness
    );

    const signatures = testUtils.getMTXSignatures(mtx, rings);

    const approveEvents = Promise.all([
      waitForBind(testWalletClient1, 'proposal approved'),
      waitForBind(testWalletClient2, 'proposal approved'),
      waitForBind(adminClient, 'proposal approved'),
      waitForBind(walletAdminClient, 'proposal approved')
    ]);

    const response = await testWalletClient2.approveProposal(
      WALLET_OPTIONS.id,
      pid2,
      {
        signatures: signatures.map(s => s.toString('hex')),
        broadcast: true
      }
    );

    const proposal = response.proposal;
    const eventResults = await approveEvents;
    const cosigners = {
      0: {
        id: 0,
        name: cosignerCtx1.name,
        authPubKey: cosignerCtx1.authPubKey.toString('hex'),
        joinSignature: cosignerCtx1.joinSignature.toString('hex'),
        key: cosignerCtx1.accountKey.toJSON(network)
      },
      1: {
        id: 1,
        name: cosignerCtx2.name,
        authPubKey: cosignerCtx2.authPubKey.toString('hex'),
        joinSignature: cosignerCtx2.joinSignature.toString('hex'),
        key: cosignerCtx2.accountKey.toJSON(network)
      }
    };

    for (const [wid, result] of eventResults) {
      assert.strictEqual(wid, WALLET_OPTIONS.id);
      assert.deepStrictEqual(result.proposal, proposal);
      assert.deepStrictEqual(result.cosigner, cosigners[1]);
    }

    // we are not spending it yet.
    await wdb.addBlock(walletUtils.nextBlock(wdb), []);
    assert.strictEqual(Amount.fromBTC(1).toValue(), balance1.confirmed);

    assert.strictEqual(proposal.statusCode, Proposal.status.APPROVED);
    assert.strictEqual(Object.keys(proposal.approvals).length, 2);

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

    // clean up wallets
    await testWalletClient1.close();
    await testWalletClient2.close();
    testWalletClient1 = null;
    testWalletClient2 = null;

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

function generateAddress() {
  return KeyRing.generate(true).getAddress();
}

function waitFor(emitter, event, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error('Timeout.'));
    }, timeout);

    emitter.once(event, (...args) => {
      clearTimeout(t);
      resolve(...args);
    });
  });
}

// TODO: remove once bcurl/bclient PRs get merged and published
function waitForBind(client, event, timeout = 1000) {
  const unbind = client.socket.unbind.bind(client.socket);

  return new Promise((resolve, reject) => {
    let t;

    const cb = function cb(...args) {
      clearTimeout(t);
      resolve(args);
    };

    t = setTimeout(() => {
      unbind(event, cb);
      reject(new Error('Timeout.'));
    }, timeout);

    client.bind(event, cb);
  });
}

function now() {
  return Math.floor(Date.now() / 1000);
}
