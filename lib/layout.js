/*!
 * layout.js - data layout for multisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const bdb = require('bdb');

/*
 * Multisig wallet database
 *  V -> db version
 *  O -> flags for network verification
 *  w[wid] -> wallet
 *  W[wid] -> wallet id
 *  l[id] -> wid
 */

module.exports = {
  V: bdb.key('V'),
  O: bdb.key('O'),
  w: bdb.key('w', ['uint32']),
  W: bdb.key('W', ['uint32']),
  l: bdb.key('l', ['ascii'])
};
