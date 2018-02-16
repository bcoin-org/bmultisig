/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');
const bcoin = require('bcoin');
const {FullNode} = bcoin;
const {wallet} = bcoin;
const Client = require('../lib/client');
const {Network} = bcoin;

const NETWORK_NAME = 'regtest';
const API_KEY = 'foo';

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
  apiKey: options.apiKey,
  memory: options.memory,
  workers: options.workers,
  nodeApiKey: options.apiKey,
  plugins: [require('../lib/bmulsig')]
});

walletNode.on('error', err => console.error(err));
fullNode.on('error', err => console.error(err));

describe('HTTP', function () {
  before(async () => {
    console.log('before');
    await fullNode.open();
    await walletNode.open();
  });

  after(async () => {
    console.log('after.');
    await walletNode.close();
    await fullNode.close();
  });

  it('should open node', async () => {
    const client = new Client({
      port: network.walletPort,
      apiKey: API_KEY
    });
  });

  it('should concole', async () => {
    console.log('12141245');
  });
});


