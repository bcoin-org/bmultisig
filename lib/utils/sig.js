/*!
 * sig.js - Signature utilities for bmultisig.
 * Copyright (c) 2019, Nodari Chkuaselidze (MIT License)
 */

'use strict';

const assert = require('bsert');
const bufio = require('bufio');
const secp256k1 = require('bcrypto/lib/secp256k1');
const hash256 = require('bcrypto/lib/hash256');

/**
 * @exports multisig/utils/signature
 */

const sigutils = exports;

/**
 * Maximum possible non hardened derivation
 * @const
 * @default
 */

sigutils.PROOF_INDEX = 0x7fffffff;

/**
 * Bitcoin signing magic string.
 * @const
 * @default
 */

sigutils.BTC_MAGIC = 'Bitcoin Signed Message:\n';

/**
 * Encode message to hash
 * @param {Buffer} message
 * @param {String} magic
 */

sigutils.hashMessage = function hashMessage(message, magic = sigutils.BTC_MAGIC) {
  assert(message.length < 0xffff, 'Message is too big.');
  assert(Buffer.isBuffer(message), 'Message must be a buffer.');
  assert(typeof magic === 'string', 'magic must be a string.');

  const messageLength = message.length < 0xfd ? 1 : 3;
  const bw = bufio.write(magic.length + messageLength + message.length + 1);

  bw.writeVarString(magic);
  bw.writeVarBytes(message);

  return hash256.digest(bw.render());
};

/**
 * Verify hash.
 * @param {Buffer} hash
 * @param {Buffer} signature - 65 bytes
 * @param {Buffer} publicKey - compressed public key.
 * @returns {Boolean}
 */

sigutils.verifyHash = function verifyHash(hash, signature, publicKey) {
  assert(Buffer.isBuffer(hash));
  assert(Buffer.isBuffer(signature));
  assert(Buffer.isBuffer(publicKey));
  assert(hash.length === 32);
  assert(signature.length === 65);
  assert(publicKey.length === 33);

  return secp256k1.verify(hash, signature.slice(1), publicKey);
};

/**
 * Verify message.
 * @param {Buffer} message
 * @param {Buffer} publicKey
 * @returns {Boolean}
 */

sigutils.verifyMessage = function verifyMessage(message, publicKey) {
  const hash = sigutils.hashMessage(message);

  return sigutils.verifyHash(hash, publicKey);
};

/**
 * Sign hash.
 * TODO: Update to use recoverable signatures.
 *       https://github.com/bcoin-org/bcrypto/pull/13
 * @param {Buffer} hash
 * @param {Buffer} privateKey
 * @returns {Buffer}
 */

sigutils.signHash = function signHash(hash, privateKey) {
  const sig = secp256k1.sign(hash, privateKey);

  return sigutils.encodeSignature(sig);
};

/**
 * Sign message.
 * @param {Buffer} message
 * @param {Buffer} privateKey
 * @returns {Buffer} signature
 */

sigutils.signMessage = function signMessage(message, privateKey) {
  const hash = sigutils.hashMessage(message);

  return sigutils.signHash(hash, privateKey);
};

/**
 * Encode RS to coresig (Always compressed)
 * @param {Buffer} sig
 * @param {Number} recid
 * @returns {Buffer}
 */

sigutils.encodeSignature = function encodeSignature(sig, recid) {
  const encodedSignature = Buffer.allocUnsafe(65);

  // always compressed
  encodedSignature[0] = recid + 31;
  sig.copy(encodedSignature, 1);

  return encodedSignature;
};

/**
 * Get proof message from options
 * @param {Object} options
 * @param {String} options.name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @returns {Buffer}
 */

sigutils.encodeProofMessage = function encodeProofMessage(options) {
  assert(typeof options === 'object');
  assert(typeof options.name === 'string', 'Name must be a string');
  assert(Buffer.isBuffer(options.authPubKey), 'authPubKey must be a buffer.');

  const name = options.name;
  const authPubKey = options.authPubKey;
  const key = options.key;

  let size = Buffer.byteLength(name, 'latin1');
  size += authPubKey.length;
  size += key.getSize();

  const bw = bufio.write(size);

  bw.writeString(name, 'latin1');
  bw.writeBytes(authPubKey);
  bw.writeBytes(key.toRaw());

  return bw.render();
};

/**
 * Get Proof hash
 * @param {Object} options
 * @param {String} options.name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @returns {Buffer} - hash256
 */

sigutils.getProofHash = function getProofHash(options) {
  const data = sigutils.encodeProofMessage(options);
  return sigutils.hashMessage(data);
};
