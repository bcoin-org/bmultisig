/*!
 * proposaldb.js - proposal database
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const layout = require('./layout').proposaldb;

/**
 * Proposal DB
 */

class ProposalDB {
  /**
   * Create ProposalsDB
   * @constructor
   * @param {MultisigDB} msdb
   * @param {Number} wid
   */

  constructor(msdb, wid) {
    this.msdb = msdb;
    this.db = msdb.db;
    this.logger = msdb.logger;

    this.wid = wid || 0;
    this.bucket = null;
    this.wallet = null;
  }

  /**
   * Open ProposalsDB
   * @param {MultisigWallet} wallet
   */

  open(wallet) {
    const prefix = layout.prefix.build(wallet.wid);

    this.bucket = this.db.bucket(prefix);
    this.wid = wallet.wid;
    this.wallet = wallet;
  }
}

module.exports = ProposalDB;
