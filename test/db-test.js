/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const MultisigDB = require('../lib/multisigdb');
const layout = require('../lib/layout');

describe('Multisig Database', function () {
  it('should open database', async () => {
    const msdb = new MultisigDB({
      client: {}
    });

    await msdb.open();
    await msdb.close();
  });

  it('should create version entry', async () => {
    const msdb = new MultisigDB({
      client: {}
    });
    const db = msdb.db;

    await msdb.open();

    const version = await db.get(layout.V.build());
    const flags = await db.get(layout.O.build());

    assert(Buffer.isBuffer(version), 'DB must write version.');
    assert(Buffer.isBuffer(flags), 'DB must write flags.');

    await msdb.close();
  });
});
