/*!
 * bmultisig.js - a bcoin multisig server.
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

/* eslint prefer-arrow-callback: "off" */

'use strict';

/**
 * @module multisig
 */

/**
 * A bmultisig "environment" which exposes all
 * constructors for primitives, msdb, proposaldb.
 *
 * @exports bmultisig
 * @type {Object}
 */

const bmultisig = exports;

/**
 * Define a module for lazy loading.
 * @param {String} name
 * @param {String} path
 */

bmultisig.define = function define(name, path) {
  let cache = null;
  Object.defineProperty(bmultisig, name, {
    get() {
      if (!cache)
        cache = require(path);
      return cache;
    }
  });
};

/*
 * Expose
 */

bmultisig.define('Plugin', './plugin');
bmultisig.define('MultisigClient', './client');

// primitives
bmultisig.define('Cosigner', './primitives/cosigner');
bmultisig.define('Proposal', './primitives/proposal');
bmultisig.define('MultisigMTX', './primitives/mtx');

bmultisig.define('MultisigDB', './multisigdb');
bmultisig.define('ProposalDB', './proposaldb');

bmultisig.define('pkg', './pkg');
