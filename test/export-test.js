/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const Network = require('bcoin/lib/protocol/network');

const {
  WalletDetails,
  AccountDetails,
  CosignerDetails
} = require('../lib/export');

const NETWORK_NAME = 'regtest';
const network = Network.get(NETWORK_NAME);
const data = require('./data/export.json');

describe('Export serializations', function() {
  describe('Cosigner', function() {
    it('should reserialize JSON', async () => {
      const cosignerJSON = data.json.cosigners[0];
      const cosigner = CosignerDetails.fromJSON(cosignerJSON, network);
      const json = cosigner.getJSON(network);

      assert.deepStrictEqual(json, cosignerJSON);
    });

    it('should reserialize binary', async () => {
      const cosignerJSON = data.json.cosigners[0];
      const cosigner1 = CosignerDetails.fromJSON(cosignerJSON, network);
      const raw1 = cosigner1.toRaw(network);

      const cosigner2 = CosignerDetails.fromRaw(raw1, network);
      assert.deepStrictEqual(cosigner2, cosigner1);

      const raw2 = cosigner2.toRaw(network);
      assert.bufferEqual(raw2, raw1);
      assert.strictEqual(data.rawCosigner0, raw2.toString('hex'));
    });
  });

  describe('Account', function() {
    it('should reserialize JSON', async () => {
      const accountJSON = data.json.accounts[0];
      const account = AccountDetails.fromJSON(accountJSON, network);
      const json = account.getJSON(network);

      assert.deepStrictEqual(json, accountJSON);
    });

    it('should reserialize binary', async () => {
      const accountJSON = data.json.accounts[0];
      const account1 = AccountDetails.fromJSON(accountJSON, network);

      const raw1 = account1.toRaw();
      const account2 = AccountDetails.fromRaw(raw1);
      assert.deepStrictEqual(account2, account1);

      const raw2 = account2.toRaw();
      assert.bufferEqual(raw2, raw1);
      assert.strictEqual(data.rawAccount, raw2.toString('hex'));
    });
  });

  describe('Wallet', function() {
    it('should reserialize JSON', async () => {
      const walletJSON = data.json;
      const wallet = WalletDetails.fromJSON(walletJSON, network);
      const json1 = wallet.getJSON(network);

      assert.deepStrictEqual(json1, walletJSON);
    });

    it('should reserialize binary', async () => {
      const walletJSON = data.json;
      const walletRAW = data.rawWallet;
      const wallet1 = WalletDetails.fromJSON(walletJSON, network);
      const raw1 = wallet1.toRaw(network);

      const wallet2 = WalletDetails.fromRaw(raw1, network);
      const json2 = wallet2.getJSON(network);
      const raw2 = wallet2.toRaw(network);

      assert.bufferEqual(raw2, raw1);
      assert.strictEqual(raw2.toString('hex'), walletRAW);
      assert.deepStrictEqual(json2, walletJSON);
    });
  });
});
