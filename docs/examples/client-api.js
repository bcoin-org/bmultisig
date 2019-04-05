
'use strict';

// can be useful for updating API Docs.

const bcoin = require('bcoin');
const {Network, wallet, FullNode} = bcoin;

const bmultisig = require('../../lib/bmultisig');
const {MultisigClient, Plugin} = bmultisig;

const NETWORK = 'regtest';
const NODE_API_KEY = 'foo';
const WALLET_API_KEY = 'bar';
const ADMIN_TOKEN = Buffer.alloc(32, 1).toString('hex');

/**
 * We could use `cosigner-context` utility to make managing keys
 * much easier, but we will try to rely as less as possible on
 * helper classes that should not be used in production.
 *
 * We will create and use `2-of-3` multisig wallet.
 */

// setup servers
(async () => {
  const {fullNode, walletNode} = setupServers();
  const network = Network.get(NETWORK);

  await fullNode.open();
  await walletNode.open();

  // we don't have wallet, so we create wallet first.
  // First cosigner is also called author.
  const authorClient = new MultisigClient({
    apiKey: WALLET_API_KEY,
    port: network.walletPort
  });

  await fullNode.close();
  await walletNode.close();
})().catch((e) => {
  console.error(e);
});

/**
 * We don't actually need fullnode,
 * we need some server to run in the background.
 * @returns {WalletNode} walletNode
 */

function setupServers() {
  const fullnode = new FullNode({
    memory: true,
    workers: true,
    apiKey: NODE_API_KEY,
    network: NETWORK
  });

  const walletNode = new wallet.Node({
    memory: true,
    walletAuth: true,

    network: NETWORK,
    nodeApiKey: NODE_API_KEY,
    apiKey: WALLET_API_KEY,
    adminToken: ADMIN_TOKEN,

    plugins: [Plugin]
  });

  return {
    fullNode: fullnode,
    walletNode: walletNode,
    wdb: walletNode.wdb
  };
}
