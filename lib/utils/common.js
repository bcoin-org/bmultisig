/*!
 * common.js - common utility functions
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const HDPublicKey = require('bcoin/lib/hd/public');

/**
 * Get current time in unix time (seconds).
 * @returns {Number}
 */

exports.now = function now() {
  return Math.floor(Date.now() / 1000);
};

/**
 * Clone HDPublicKey.
 * @param {HDPublicKey} key
 * @returns {HDPublicKey}
 */

exports.cloneHDPublicKey = function cloneHDPublicKey(key) {
  assert(HDPublicKey.isHDPublicKey(key));

  const ckey = new HDPublicKey();

  ckey.depth = key.depth;
  ckey.parentFingerPrint = key.parentFingerPrint;
  ckey.childIndex = key.childIndex;
  ckey.fingerPrint = key.fingerPrint;

  // clone buffers
  ckey.chainCode = Buffer.allocUnsafe(32);
  ckey.publicKey = Buffer.allocUnsafe(33);

  key.chainCode.copy(ckey.chainCode);
  key.publicKey.copy(ckey.publicKey);

  return ckey;
};
