/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const MultisigDB = require('../lib/multisigdb');

describe('Multisig Database', function () {
  it('should open database', async () => {
    const db = new MultisigDB();

    await db.open();
    await db.close();
  });
});
