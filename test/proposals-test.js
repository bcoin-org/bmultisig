/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const walletUtils = require('./util/wallet');
const testUtils = require('./util/utils');

// const Logger = require('blgr');
const bcoin = require('bcoin');
const {Script, KeyRing, MTX, Amount, hd} = bcoin;
const WalletDB = bcoin.wallet.WalletDB;
const WalletNodeClient = require('../lib/walletclient');
const MultisigDB = require('../lib/multisigdb');
const Cosigner = require('../lib/primitives/cosigner');
const Proposal = require('../lib/primitives/proposal');

const TEST_WALLET_ID = 'test1';
const TEST_WALLET_ID2 = 'test2';

const TEST_COSIGNER_1 = 'cosigner1';
const TEST_COSIGNER_2 = 'cosinger2';
const TEST_COSIGNER_3 = 'cosigner3';

const TEST_M = 2;
const TEST_N = 2;

describe('MultisigProposals', function () {
  // 2-of-2 will be used for tests
  const priv1 = getPrivKey().deriveAccount(44, 0, 0);
  const priv2 = getPrivKey().deriveAccount(44, 0, 0);
  const priv3 = getPrivKey().deriveAccount(44, 0, 0);
  const xpub1 = priv1.toPublic();
  const xpub2 = priv2.toPublic();
  const xpub3 = priv3.toPublic();

  let wdb, msdb;
  let mswallet, wallet, pdb; // 2-of-2
  let mswallet2; // 2-of-3

  let cosigner1, cosigner2, cosigner3;

  beforeEach(async () => {
    // const logger = new Logger({
    //   level: 'debug',
    //   console: true
    // });

    // await logger.open();

    wdb = new WalletDB({ });

    const wdbClient = new WalletNodeClient({ wdb });

    msdb = new MultisigDB({
      // logger,
      client: wdbClient
    });

    wdb.on('error', () => {});
    msdb.on('error', () => {});

    msdb.init();

    await wdb.open();
    await msdb.open();

    cosigner1 = Cosigner.fromOptions({
      name: TEST_COSIGNER_1,
      key: xpub1
    });

    cosigner2 = Cosigner.fromOptions({
      name: TEST_COSIGNER_2,
      key: xpub2
    });

    cosigner3 = Cosigner.fromOptions({
      name: TEST_COSIGNER_3,
      key: xpub3
    });

    mswallet = await msdb.create({
      id: TEST_WALLET_ID,
      m: TEST_M,
      n: TEST_N
    }, cosigner1);

    wallet = mswallet.wallet;

    let joined = await msdb.join(TEST_WALLET_ID, cosigner2);

    assert(joined, 'Could not join the wallet');
    assert.strictEqual(cosigner1, joined.cosigners[0]);
    assert.strictEqual(cosigner2, joined.cosigners[1]);

    pdb = mswallet.pdb;

    mswallet2 = await msdb.create({
      id: TEST_WALLET_ID2,
      m: 2,
      n: 3
    }, cosigner1);

    for (const cosigner of [cosigner2, cosigner3]) {
      joined = await msdb.join(TEST_WALLET_ID2, cosigner);

      assert(joined);
    }

    assert.strictEqual(cosigner1, joined.cosigners[0]);
    assert.strictEqual(cosigner2, joined.cosigners[1]);
    assert.strictEqual(cosigner3, joined.cosigners[2]);
  });

  afterEach(async () => {
    await wdb.close();
    await msdb.close();
  });

  it('should create pdb with wallet', async () => {
    assert.strictEqual(mswallet.isInitialized(), true,
      'Wallet was not initalized');
    assert(mswallet, 'Multisig wallet not found');
    assert(pdb, 'ProposalsDB not found');
  });

  it('should create transaction', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const account = await mswallet.getAccount();
    const address = account.receiveAddress();

    const txoptions = {
      subtractFee: true,
      outputs: [{
        address: address,
        value: Amount.fromBTC(1).toValue()
      }]
    };

    const tx = await mswallet.createTX(txoptions);

    assert.instanceOf(tx, MTX);
    assert.strictEqual(tx.isSane(), true);
  });

  it('should lock the coins and recover locked coins', async () => {
    // this is mostly wallet test than proposal
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const coins = await wallet.getCoins();
    assert.strictEqual(coins.length, 1);

    const txoptions = getTXOptions(1);

    // create proposal
    const mtx = await mswallet.createTX(txoptions);
    assert.instanceOf(mtx, MTX);

    for (const coin of coins)
      await mswallet.lockCoin(coin);

    let err;
    try {
      await mswallet.createTX(txoptions);
    } catch (e) {
      err = e;
    }

    const message = 'Not enough funds. (available=0.0, required=1.0)';
    assert(err);
    assert.strictEqual(err.message, message);

    for (const coin of coins)
      await mswallet.unlockCoin(coin);

    const mtx2 = await mswallet.createTX(txoptions);
    assert.instanceOf(mtx2, MTX);
  });

  it('should lock the coins on proposal creation', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const coins = await wallet.getCoins();
    assert.strictEqual(coins.length, 1);

    const txoptions = getTXOptions(1);

    const proposal = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal, Proposal);

    let err;
    try {
      await mswallet.createProposal(
        'proposal-2',
        cosigner2,
        txoptions
      );
    } catch (e) {
      err = e;
    }

    const message = 'Not enough funds. (available=0.0, required=1.0)';
    assert(err);
    assert.strictEqual(err.message, message);
  });

  it('should lock the coins after server restart', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const coins = await wallet.getCoins();
    assert.strictEqual(coins.length, 1);

    const txoptions = getTXOptions(1);

    const proposal = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal, Proposal);

    await msdb.close();
    await wdb.close();

    await wdb.open();
    await msdb.open();

    mswallet = await msdb.getWallet(TEST_WALLET_ID);

    let err;
    try {
      await mswallet.createProposal(
        'proposal-2',
        cosigner2,
        txoptions
      );
    } catch (e) {
      err = e;
    }

    const message = 'Not enough funds. (available=0.0, required=1.0)';
    assert(err, 'Create proposal must throw an error.');
    assert.strictEqual(err.message, message, 'Incorrect error message.');
  });

  it('should get proposal by coin', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const coins = await wallet.getCoins();

    const proposal = await mswallet.createProposal(
      'proposal',
      cosigner1,
      getTXOptions(1)
    );

    assert.instanceOf(proposal, Proposal);

    const pid = await mswallet.getPIDByOutpoint(coins[0]);
    const proposal2 = await mswallet.getProposalByOutpoint(coins[0]);

    assert.strictEqual(proposal.id, pid);
    assert(proposal.equals(proposal2));
  });

  it('should get proposal', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    const proposal1 = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal1, Proposal);

    const proposal2 = await mswallet.getProposal('proposal-1');

    assert.instanceOf(proposal2, Proposal);

    assert.deepStrictEqual(proposal1, proposal2);
  });

  it('should fail getting non-existent proposal', async () => {
    const proposal = await mswallet.getProposal('test');
    assert.typeOf(proposal, 'null');
  });

  it('should get proposal mtx', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 2);

    const txoptions = getTXOptions(3);

    await mswallet.createProposal('proposal', cosigner1, txoptions);

    const proposal = await mswallet.getProposal('proposal');
    const mtx = await mswallet.getProposalMTX('proposal');

    assert.instanceOf(proposal, Proposal);
    assert.instanceOf(mtx, MTX);

    const inputPaths = await mswallet.getInputPaths(mtx);

    assert.strictEqual(inputPaths.length, 2);
  });

  it('should reject proposal', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    await mswallet.createProposal('proposal', cosigner1, txoptions);
    await mswallet.createProposal('proposal1', cosigner1, txoptions);
    await mswallet.createProposal('proposal2', cosigner1, txoptions);

    const pendingProposals = await mswallet.getPendingProposals();

    assert.strictEqual(pendingProposals.length, 3);

    const proposal1 = await mswallet.rejectProposal('proposal', cosigner1);
    assert.strictEqual(proposal1.status, Proposal.status.REJECTED);

    const pendingProposals2 = await mswallet.getPendingProposals();
    assert.strictEqual(pendingProposals2.length, 2);

    const proposal2 = await mswallet.createProposal(
      'proposal3',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal2, Proposal);
  });

  it('should fail rejecting rejected proposal', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    await mswallet.createProposal('proposal', cosigner1, txoptions);
    await mswallet.rejectProposal('proposal', cosigner1);

    let err;
    try {
      await mswallet.rejectProposal('proposal', cosigner2);
    } catch (e) {
      err = e;
    }

    assert.instanceOf(err, Error);
    assert.strictEqual(err.message, 'Can not reject non pending proposal.');
  });

  it('should approve proposal', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const pending = await mswallet.getPendingProposals();
    assert.strictEqual(pending.length, 0);

    // create proposal
    const proposalName = 'proposal1';
    const txoptions = getTXOptions(2);
    const proposal = await mswallet.createProposal(
      proposalName,
      cosigner1,
      txoptions
    );

    const mtx = await mswallet.getProposalMTX(proposal.id);
    const paths = await mswallet.getInputPaths(mtx);

    const rings = testUtils.getMTXRings(mtx, paths, priv1, [xpub1, xpub2], 2);
    const sigs = testUtils.getMTXSignatures(mtx, rings);

    assert.strictEqual(sigs.length, 2, 'Wrong number of signatures.');

    let err;

    try {
      // bad sigs
      const sigs = [
        Buffer.alloc(32, 0),
        Buffer.alloc(32, 0)
      ];

      await mswallet.approveProposal(
        proposalName,
        cosigner1,
        sigs
      );
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Signature(s) incorrect.');

    err = null;
    try {
      // bad cosigner
      await mswallet.approveProposal(
        proposalName,
        cosigner2,
        sigs
      );
    } catch (e) {
      err = e;
    }

    assert(err);
    assert(err.message, 'Signature(s) incorrect.');

    const approved = await mswallet.approveProposal(
      proposalName,
      cosigner1,
      sigs
    );

    assert.strictEqual(approved.approvals.size, 1);
    assert.strictEqual(approved.approvals.has(cosigner1.id), true);

    // approve by second cosigner
    const rings2 = testUtils.getMTXRings(mtx, paths, priv2, [xpub1, xpub2], 2);
    const sigs2 = testUtils.getMTXSignatures(mtx, rings2);

    const approved2 = await mswallet.approveProposal(
      proposalName,
      cosigner2,
      sigs2
    );

    assert.strictEqual(approved2.approvals.size, 2);
    assert.strictEqual(approved2.approvals.has(cosigner1.id), true);
    assert.strictEqual(approved2.approvals.has(cosigner2.id), true);
  });

  it('should approve proposal (2-of-3)', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet2, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet2, 1);

    const pending = await mswallet2.getPendingProposals();
    assert.strictEqual(pending.length, 0);

    const proposalName = 'proposal1';
    const txoptions = getTXOptions(2);
    const proposal = await mswallet2.createProposal(
      proposalName,
      cosigner1,
      txoptions
    );

    const mtx = await mswallet2.getProposalMTX(proposal.id);
    const paths = await mswallet2.getInputPaths(mtx);

    const xpubs = [xpub1, xpub2, xpub3];

    { // cosigner2
      const rings = testUtils.getMTXRings(mtx, paths, priv2, xpubs, 2);
      const sigs = testUtils.getMTXSignatures(mtx, rings);

      assert.strictEqual(sigs.length, 2);

      const approved = await mswallet2.approveProposal(
        proposalName,
        cosigner2,
        sigs
      );

      assert.strictEqual(approved.approvals.size, 1);
      assert.strictEqual(approved.approvals.has(cosigner2.id), true);
    }

    { // cosigner3
      const rings = testUtils.getMTXRings(mtx, paths, priv3, xpubs, 2);
      const sigs = testUtils.getMTXSignatures(mtx, rings);

      assert.strictEqual(sigs.length, 2);

      const approved = await mswallet2.approveProposal(
        proposalName,
        cosigner3,
        sigs
      );

      assert.strictEqual(approved.approvals.size, 2);
      assert.strictEqual(approved.approvals.has(cosigner3.id), true);
    }
  });

  it('should fail approving proposal twice', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    const proposal = await mswallet.createProposal(
      'proposal',
      cosigner1,
      txoptions
    );

    await mswallet.createProposal('proposal1', cosigner1, txoptions);

    const pendingProposals = await mswallet.getPendingProposals();
    assert.strictEqual(pendingProposals.length, 2);

    const mtx = await mswallet.getProposalMTX(proposal.id);
    const paths = await mswallet.getInputPaths(mtx);

    const rings = testUtils.getMTXRings(mtx, paths, priv1, [xpub1, xpub2], 2);
    const signatures = testUtils.getMTXSignatures(mtx, rings);

    await mswallet.approveProposal(
      'proposal',
      cosigner1,
      signatures
    );

    let err;

    try {
      await mswallet.approveProposal('proposal', cosigner1, signatures);
    } catch (e) {
      err = e;
    }

    assert.instanceOf(err, Error);
    assert.strictEqual(err.message, 'Cosigner already approved.');
  });

  it('should approve signed proposal', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    await mswallet.createProposal('proposal', cosigner1, txoptions);

    const pending = await mswallet.getPendingProposals();
    assert.strictEqual(pending.length, 1);

    const approve = async (priv, cosigner) => {
      const mtx = await mswallet.getProposalMTX('proposal');
      const paths = await mswallet.getInputPaths(mtx);

      const rings = testUtils.getMTXRings(mtx, paths, priv, [xpub1, xpub2], 2);
      const signatures = testUtils.getMTXSignatures(mtx, rings);

      // approve proposal
      await mswallet.approveProposal(
        'proposal',
        cosigner,
        signatures
      );
    };

    await approve(priv1, cosigner1);
    await approve(priv2, cosigner2);
  });

  it('should recover coins on rejection', async () => {
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const proposal = await mswallet.createProposal(
      'proposal',
      cosigner1,
      getTXOptions(1)
    );

    assert.instanceOf(proposal, Proposal);

    const coins = await mswallet.getProposalCoins('proposal');
    const rejected = await mswallet.rejectProposal('proposal', cosigner1);

    const coin = coins[0];
    const pidByOutpoint = await mswallet.getPIDByOutpoint(coin);

    assert.strictEqual(rejected.status, Proposal.status.REJECTED);
    assert.strictEqual(pidByOutpoint, -1);
  });

  it('should reject proposal on mempool double spend', async () => {
    const txoptions = getTXOptions(1);

    const amount = Amount.fromBTC(1).toValue();
    const account = await mswallet.getAccount();
    const mtx = walletUtils.createFundTX(account.receiveAddress(), amount);

    await wdb.addTX(mtx.toTX());

    await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    const dstx = walletUtils.getDoubleSpendTransaction(mtx);

    await wdb.addTX(dstx.toTX());

    const checkProposal = await mswallet.getProposal('proposal-1');

    assert.instanceOf(checkProposal, Proposal);
    assert.strictEqual(checkProposal.status, Proposal.status.DBLSPEND);
  });

  it('should reject proposal on coin spend', async () => {
    const txoptions = getTXOptions(1);
    await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const proposal = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    const mtx = await mswallet.getProposalMTX('proposal-1');
    const paths = await mswallet.getInputPaths(mtx);

    const sign = async (priv) => {
      mtx.inputs.forEach((input, i) => {
        const path = paths[i];

        // derive correct priv key
        const _priv = priv.derive(path.branch).derive(path.index);

        // derive pubkeys
        const p1 = xpub1.derive(path.branch).derive(path.index);
        const p2 = xpub2.derive(path.branch).derive(path.index);

        const ring = KeyRing.fromPrivate(_priv.privateKey);

        ring.script = Script.fromMultisig(
          proposal.m,
          proposal.n,
          [p1.publicKey, p2.publicKey]
        );

        const signed = mtx.sign(ring);

        assert.strictEqual(signed, 1);
      });
    };

    sign(priv1);
    sign(priv2);

    await wdb.addBlock(walletUtils.nextBlock(wdb), [mtx.toTX()]);

    const checkProposal = await mswallet.getProposal('proposal-1');

    assert.instanceOf(checkProposal, Proposal);
    assert.strictEqual(checkProposal.status, Proposal.status.DBLSPEND);
  });

  it('should reject proposal on reorg double spend', async () => {
    const txoptions = getTXOptions(1);
    const mtx = await walletUtils.fundWalletBlock(wdb, mswallet, 1);

    const proposal1 = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal1, Proposal);

    await walletUtils.removeBlock(wdb);
    await walletUtils.doubleSpendTransaction(wdb, mtx.toTX());

    // TODO: remove timeout after events
    await new Promise(r => setTimeout(r, 100));

    const checkProposal = await mswallet.getProposal('proposal-1');

    assert.instanceOf(checkProposal, Proposal);
    assert.strictEqual(checkProposal.status, Proposal.status.DBLSPEND);
  });
});

/*
 * Helpers
 */

function getTXOptions(btc) {
  return {
    subtractFee: true,
    outputs: [{
      address: generateAddress(),
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
