/*!
 * sig.js - Signature utilities for bmultisig.
 * Copyright (c) 2019, Nodari Chkuaselidze (MIT License)
 */

'use strict';

const assert = require('bsert');
const bufio = require('bufio');
const Network = require('bcoin/lib/protocol/network');
const HDPublicKey = require('bcoin/lib/hd/public');
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

sigutils.verifyMessage = function verifyMessage(message, signature, publicKey) {
  const hash = sigutils.hashMessage(message);

  return sigutils.verifyHash(hash, signature, publicKey);
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
 * @param {Network} [network=main]
 * @returns {Buffer}
 */

sigutils.encodeProofMessage = function encodeProofMessage(options, network) {
  assert(typeof options === 'object');
  assert(typeof options.name === 'string', 'Name must be a string');
  assert(Buffer.isBuffer(options.authPubKey), 'authPubKey must be a buffer.');
  assert(HDPublicKey.isHDPublicKey(options.key), 'key must be a HDPublicKey.');

  network = Network.get(network);

  const name = options.name;
  const authPubKey = options.authPubKey;
  const key = options.key;

  let size = 0;
  size += Buffer.byteLength(name, 'binary');
  size += authPubKey.length;
  size += key.getSize();

  const bw = bufio.write(size);
  bw.writeString(name, 'binary');
  bw.writeBytes(authPubKey);
  bw.writeBytes(key.toRaw(network));

  return bw.render();
};

/**
 * Get Proof hash
 * @param {Object} options
 * @param {String} options.name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @param {Network} [network=main]
 * @returns {Buffer} - hash256
 */

sigutils.getProofHash = function getProofHash(options, network) {
  const data = sigutils.encodeProofMessage(options, network);
  return sigutils.hashMessage(data);
};

/**
 * Get join message from options for signing.
 * @param {String} walletName
 * @param {Object} options - cosigner options
 * @param {String} options.name - cosigner name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @returns {Buffer}
 */

sigutils.encodeJoinMessage = function encodeJoinMessage(walletName, options, network) {
  assert(typeof walletName === 'string');
  assert(typeof options === 'object');
  assert(typeof options.name === 'string');
  assert(Buffer.isBuffer(options.authPubKey));
  assert(HDPublicKey.isHDPublicKey(options.key));

  network = Network.get(network);

  let size = 0;
  size += Buffer.byteLength(walletName, 'binary');
  size += Buffer.byteLength(options.name, 'binary');
  size += options.authPubKey.length;
  size += options.key.getSize();

  const bw = bufio.write(size);
  bw.writeString(walletName, 'binary');
  bw.writeString(options.name, 'binary');
  bw.writeBytes(options.authPubKey);
  bw.writeBytes(options.key.toRaw(network));

  return bw.render();
};

/**
 * Get join message hash from options for signing.
 * @param {String} walletName
 * @param {Object} options - cosigner options
 * @param {String} options.name - cosigner name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @param {Network} [network=main]
 * @returns {Buffer}
 */

sigutils.getJoinHash = function getJoinHash(walletName, options, network) {
  const data = sigutils.encodeJoinMessage(walletName, options, network);
  return sigutils.hashMessage(data);
};
