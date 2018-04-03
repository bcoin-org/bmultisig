/*!
 * layout.js - data layout for multisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const bdb = require('bdb');

/*
 * Multisig wallet database layout:
 *  V -> db version
 *  O -> flags for network verification
 *  w[wid] -> wallet
 *  W[wid] -> wallet id
 *  l[id] -> wid
 *  p[wid]* -> proposaldb
 */

exports.msdb = {
  V: bdb.key('V'),
  O: bdb.key('O'),
  w: bdb.key('w', ['uint32']),
  W: bdb.key('W', ['uint32']),
  l: bdb.key('l', ['ascii']),
  p: bdb.key('p', ['uint32'])
};

/*
 * Proposal Database layout:
 *  D -> proposal id depth
 *  p[pid] -> proposal
 *  i[name] -> proposal index
 *  t[pid] -> transaction (value is also store with proposal)
 *  e[pid] -> dummy (pending proposals)
 *  f[pid] -> dummy (finished proposals)
 *  c[hash][index] -> dummy (locked coins)
 *  C[pid][hash][index] -> dummy (locked coins by proposal)
 *  P[hash][index] -> pid (proposals by coins)
 */

exports.proposaldb = {
  prefix: bdb.key('p', ['uint32']),

  D: bdb.key('D'),
  p: bdb.key('p', ['uint32']),
  i: bdb.key('i', ['ascii']),
  t: bdb.key('t', ['uint32']),
  e: bdb.key('e', ['uint32']),
  f: bdb.key('f', ['uint32']),
  c: bdb.key('c', ['hash256', 'uint32']),
  C: bdb.key('C', ['uint32', 'hash256', 'uint32']),
  P: bdb.key('P', ['hash256', 'uint32'])
};
