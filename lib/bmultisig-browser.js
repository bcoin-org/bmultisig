/*!
 * bmultisig-browser.js - a bcoin client libraries.
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

'use strict';

/**
 * A bmultisig "environment" which exposes all
 * constructors for primitives, msdb, proposaldb.
 *
 * @exports bmultisig
 * @type {Object}
 */

const bmultisig = exports;

/*
 * Expose
 */

bmultisig.MultisigClient = require('./client');

// primitives
bmultisig.Cosigner = require('./primitives/cosigner');
bmultisig.Proposal = require('./primitives/proposal');
bmultisig.MultisigMTX = require('./primitives/mtx');

bmultisig.pkg = require('./pkg');
