/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const utils = require('./util/wallet');

// const Logger = require('blgr');
const bcoin = require('bcoin');
const {Script, KeyRing, MTX, Amount, hd} = bcoin;
const WalletDB = bcoin.wallet.WalletDB;
const WalletNodeClient = require('../lib/walletclient');
const MultisigDB = require('../lib/multisigdb');
const Cosigner = require('../lib/cosigner');
const Proposal = require('../lib/proposal');

const TEST_XPUB_PATH = 'm/44\'/0\'/0\'';
const TEST_WALLET_ID = 'test';

const TEST_COSIGNER_1 = 'cosigner1';
const TEST_COSIGNER_2 = 'cosinger2';

const TEST_M = 2;
const TEST_N = 2;

describe('MultisigProposals', function () {
  // 2-of-2 will be used for tests
  const priv1 = getPrivKey().derivePath(TEST_XPUB_PATH);
  const priv2 = getPrivKey().derivePath(TEST_XPUB_PATH);
  const xpub1 = priv1.toPublic();
  const xpub2 = priv2.toPublic();

  let wdb, msdb;
  let mswallet, wallet, pdb;

  let cosigner1, cosigner2;

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

    mswallet = await msdb.create({
      id: TEST_WALLET_ID,
      m: TEST_M,
      n: TEST_N
    }, Cosigner.fromOptions({ name: TEST_COSIGNER_1 }), xpub1);

    wallet = mswallet.wallet;

    const joined = await msdb.join(TEST_WALLET_ID, Cosigner.fromOptions({
      name: TEST_COSIGNER_2
    }), xpub2);

    assert(joined, 'Could not join the wallet');

    pdb = mswallet.pdb;

    cosigner1 = mswallet.cosigners[0];
    cosigner2 = mswallet.cosigners[1];
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
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    const proposal1 = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal1, Proposal);

    const proposal2 = await mswallet.getProposalWithTX('proposal-1');

    assert.instanceOf(proposal2, Proposal);
    assert.deepStrictEqual(proposal1, proposal2);

    const proposal3 = await mswallet.getProposal('proposal-1');

    assert.instanceOf(proposal3, Proposal);
    assert.typeOf(proposal3.tx, 'null');

    proposal3.tx = proposal1.tx;
    assert.deepStrictEqual(proposal1, proposal3);
  });

  it('should fail getting non-existent proposal', async () => {
    const proposal = await mswallet.getProposal('test');
    assert.typeOf(proposal, 'null');
  });

  it('should get proposal mtx', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);
    await utils.fundWalletBlock(wdb, mswallet, 2);

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
    await utils.fundWalletBlock(wdb, mswallet, 1);
    await utils.fundWalletBlock(wdb, mswallet, 1);
    await utils.fundWalletBlock(wdb, mswallet, 1);

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

  it('should fail rejecting rejected proposal twice', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);

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

  it('should fail approving proposal twice', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);
    await utils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    const proposal = await mswallet.createProposal(
      'proposal',
      cosigner1,
      txoptions
    );

    await mswallet.createProposal('proposal1', cosigner1, txoptions);

    const pendingProposals = await mswallet.getPendingProposals();
    assert.strictEqual(pendingProposals.length, 2);

    const tx = proposal.tx;
    await mswallet.approveProposal('proposal', cosigner1, tx);

    let err;

    try {
      await mswallet.approveProposal('proposal', cosigner1, tx);
    } catch (e) {
      err = e;
    }

    assert.instanceOf(err, Error);
    assert.strictEqual(err.message, 'Cosigner already approved.');

    const proposal1 = await mswallet.approveProposal('proposal', cosigner2, tx);

    assert.strictEqual(proposal1.status, Proposal.status.VERIFY);

    // are coins free
    await mswallet.createProposal(
      'proposal2',
      cosigner1,
      txoptions
    );
  });

  it('should approve signed proposal', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);

    const txoptions = getTXOptions(1);

    await mswallet.createProposal('proposal', cosigner1, txoptions);

    const pending = await mswallet.getPendingProposals();
    assert.strictEqual(pending.length, 1);

    const approve = async (priv, cosigner) => {
      const proposal = await mswallet.getProposal('proposal');
      const mtx = await mswallet.getProposalMTX('proposal');
      const paths = await mswallet.getInputPaths(mtx);

      // sign transaction cosigner1
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

      // approve proposal
      await mswallet.approveProposal('proposal', cosigner, mtx);
    };

    await approve(priv1, cosigner1);
    await approve(priv2, cosigner2);
  });

  it('should recover coins on rejection', async () => {
    await utils.fundWalletBlock(wdb, mswallet, 1);

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
    const mtx = utils.createFundTX(account.receiveAddress(), amount);

    await wdb.addTX(mtx.toTX());

    await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    const dstx = utils.getDoubleSpendTransaction(mtx);

    await wdb.addTX(dstx.toTX());

    const checkProposal = await mswallet.getProposal('proposal-1');

    assert.instanceOf(checkProposal, Proposal);
    assert.strictEqual(checkProposal.status, Proposal.status.DBLSPEND);
  });

  it('should reject proposal on coin spend', async () => {
    const txoptions = getTXOptions(1);
    await utils.fundWalletBlock(wdb, mswallet, 1);

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

    await wdb.addBlock(utils.nextBlock(wdb), [mtx.toTX()]);

    const checkProposal = await mswallet.getProposal('proposal-1');

    assert.instanceOf(checkProposal, Proposal);
    assert.strictEqual(checkProposal.status, Proposal.status.DBLSPEND);
  });

  it('should reject proposal on reorg double spend', async () => {
    const txoptions = getTXOptions(1);
    const mtx = await utils.fundWalletBlock(wdb, mswallet, 1);

    const proposal1 = await mswallet.createProposal(
      'proposal-1',
      cosigner1,
      txoptions
    );

    assert.instanceOf(proposal1, Proposal);

    await utils.removeBlock(wdb);
    await utils.doubleSpendTransaction(wdb, mtx.toTX());

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
