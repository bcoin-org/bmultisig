/*!
 * bmultisig.js - package constants
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org
 */

'use strict';

const pkg = exports;

/**
 * Package Name
 * @const {String}
 * @default
 */

pkg.name = require('../package.json').name;

/**
 * Organization Name
 * @const {String}
 * @default
 */

pkg.organization = 'bcoin-org';

/**
 * Repository URL.
 * @const {String}
 * @default
 */

pkg.url = `https://github.com/${pkg.organization}/${pkg.name}`;

/**
 * Current version string.
 * @const {String}
 */

pkg.version = require('../package.json').version;
