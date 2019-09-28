'use strict';

const path = require('path');
const assert = require('bsert');
const Config = require('bcfg');
const bdb = require('bdb');
const layout = require('../lib/layout');
const msdbLayout = layout.msdb;
const pdbLayout = layout.proposaldb;
const ProposalDB = require('../lib/proposaldb');
const {ProposalStats} = ProposalDB;
const Coin = require('bcoin/lib/primitives/coin');
const walletLayout = require('bcoin/lib/wallet/layout');
const wdbLayout = walletLayout.wdb;
const txdbLayout = walletLayout.txdb;
const Proposal = require('../lib/primitives/proposal');

// Changes:
//  - Index proposal stats.

let config = null;
let wdb = null;
let msdb = null;
let parent = null;

async function getVersion() {
  const raw = await msdb.get(msdbLayout.V.encode());

  return raw.readUInt32LE(8, true);
}

async function updateVersion() {
  const buf = Buffer.allocUnsafe(8 + 4);
  buf.write('multisig', 0, 'ascii');
  buf.writeUInt32LE(1, 8);

  console.log('Updating msdb version to 1.');
  parent.put(msdbLayout.V.encode(), buf);
}

async function backup() {
  const now = Date.now();
  const backup = path.join(process.env.HOME, `multisig-bak-${now}`);

  console.log(`Backing up db at: ${backup}`);
  if (!config.get('dry'))
    await msdb.backup(backup);
}

async function collectCoinValues(wid, outpoints) {
  const bucket = wdb.bucket(wdbLayout.t.encode(wid));
  const values = [];

  for (const [hash, index] of outpoints) {
    const raw = await bucket.get(txdbLayout.c.encode(hash, index));

    assert(raw,
      `Could not find wdb coin for: ${hash.toString('hex')}/${index}`);
    const coin = Coin.fromRaw(raw);
    values.push(coin.value);
  }

  return values;
}

async function collectProposalOutpoints(bucket, pid) {
  const outpoints = await bucket.keys({
    gte: pdbLayout.C.min(pid),
    lte: pdbLayout.C.max(pid),
    parse: (key) => {
      const [, hash, index] = pdbLayout.C.decode(key);
      return [hash, index];
    }
  });

  return outpoints;
}

async function collectProposalStats(bucket, wid) {
  const proposalStats = new ProposalStats();
  const proposals = await bucket.values({
    gte: pdbLayout.p.min(),
    lte: pdbLayout.p.max(),
    parse: raw => Proposal.decode(raw)
  });

  proposalStats.addProposals(proposals.length);

  for (const proposal of proposals) {
    if (proposal.isRejected()) {
      proposalStats.addRejected(1);
      continue;
    }

    if (proposal.isApproved()) {
      proposalStats.addApproved(1);
      continue;
    }

    assert(proposal.isPending());
    proposalStats.addPending(1);

    const outpoints = await collectProposalOutpoints(bucket, proposal.id);
    const values = await collectCoinValues(wid, outpoints);

    proposalStats.addOwnLockedCoin(outpoints.length);
    proposalStats.addOwnLockedBalance(values.reduce((p, c) => {
      return p + c;
    }, 0));
  }

  return proposalStats;
}

async function updatePDB() {
  const wids = await msdb.keys({
    gte: msdbLayout.w.min(),
    lte: msdbLayout.w.max(),
    parse: key => msdbLayout.w.decode(key)[0]
  });

  console.log('Updating wallets..');

  let total = 0;

  for (const wid of wids) {
    const bucket = msdb.bucket(msdbLayout.p.encode(wid));
    const batch = bucket.wrap(parent);
    const stats = await bucket.get(pdbLayout.S.encode());
    assert(stats === null);

    const proposalStats = await collectProposalStats(bucket, wid);

    console.log(`Writing proposal stats for wallet ${wid}`, proposalStats);
    batch.put(pdbLayout.S.encode(), proposalStats.encode());
    total++;
  }

  console.log(`Updated ${total} wallets.`);
}

(async () => {
  config = new Config('multisig-migrate-0to1', {
    alias: { 'h': 'help' }
  });

  config.load({
    env: true,
    argv: true
  });

  const help = config.bool('help');
  const dry = config.bool('dry');
  const wdbLocation = config.str(0);
  const msdbLocation = config.str(1);

  if (help || !msdbLocation || !wdbLocation) {
    console.log(`Migration tool from multisig v0 to v1.\n
USAGE:
  node migrate/multisigdb0to1 [OPTIONS] WDBPATH MSDBPATH
OPTIONS:
  -h, --help
  \t Show this help
  --dry
  \t Dry run. Don't affect db or create back up.
    `);
    process.exit(1);
  }

  wdb = bdb.create({
    location: wdbLocation,
    memory: false,
    compression: true,
    cacheSize: 8 << 20,
    createIfMissing: false
  });

  msdb = bdb.create({
    location: msdbLocation,
    memory: false,
    compression: true,
    cacheSize: 8 << 20,
    createIfMissing: false
  });

  await wdb.open();
  await msdb.open();
  parent = msdb.batch();

  if (dry)
    console.log('Dry run, this wont affect anything.');

  console.log('Opened wallet db: %s.', wdbLocation);
  console.log('Opened multisig db: %s.', msdbLocation);

  const version = await getVersion();

  switch (version) {
    case 0:
      await backup();
      await updatePDB();
      await updateVersion();

      console.log('Writing changes to the database.');
      if (!dry) {
        await parent.write();
      }
      break;
    case 1:
      console.log('Already upgraded.');
      break;
    default:
      console.log(`MSDB Version: ${version}`);
  }

  await wdb.close();
  await msdb.close();
})().then(() => {
  console.log('Migration complete.');
  process.exit(0);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
