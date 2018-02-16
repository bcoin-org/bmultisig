/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('assert');
const bcoin = require('bcoin');
const {FullNode} = bcoin;
const {wallet} = bcoin;
const {Network} = bcoin;

const pkg = require('../package.json');
const Client = require('../lib/client');

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

  apiKey: options.apiKey,
  nodeApiKey: options.apiKey,
  adminToken: ADMIN_TOKEN,

  plugins: [require('../lib/bmulsig')]
});

walletNode.on('error', err => console.error('Wallet', err));
fullNode.on('error', err => console.error('FullNode', err));

describe('HTTP', function () {
  before(async () => {
    await fullNode.open();
    await walletNode.open();
  });

  after(async () => {
    await walletNode.close();
    await fullNode.close();
  });

  let client;

  beforeEach(async () => {
    client = new Client({
      port: network.walletPort,
      apiKey: API_KEY,
      adminToken: ADMIN_TOKEN
    });

    await client.open();
  });

  afterEach(async () => {
    await client.close();
  });

  it('Get mulsig plugin info', async () => {
    const info = await client.getInfo();

    assert(info, 'Get info should return results');
    assert.strictEqual(info.version, pkg.version,
      'Plugin version was not correct'
    );
  });
});
