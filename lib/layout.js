/*!
 * layout.js - data layout for mulsgi
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const bdb = require('bdb');

/*
 * Multisig wallet database
 *  V -> db version
 *  O -> flags for network verification
 */

module.exports = {
  V: bdb.key('V'),
  O: bdb.key('O')
};
