/*!
 * common.js - common utility functions
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

/**
 * Get current time in unix time (seconds).
 * @returns {Number}
 */

exports.now = function now() {
  return Math.floor(Date.now() / 1000);
};
