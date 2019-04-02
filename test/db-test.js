/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const MultisigDB = require('../lib/multisigdb');
const layout = require('../lib/layout').msdb;
const WalletNullClient = require('../lib/walletnullclient');

/*
 * Most test cases are handled by http-test
 */

describe('Multisig Database', function () {
  it('should open database', async () => {
    const client = new WalletNullClient();
    const msdb = new MultisigDB({ client });

    await msdb.open();
    await msdb.close();
  });

  it('should create version entry', async () => {
    const client = new WalletNullClient();
    const msdb = new MultisigDB({ client });
    const db = msdb.db;

    await msdb.open();

    const version = await db.get(layout.V.encode());
    const flags = await db.get(layout.O.encode());

    assert(Buffer.isBuffer(version), 'DB must write version.');
    assert(Buffer.isBuffer(flags), 'DB must write flags.');

    await msdb.close();
  });
});
