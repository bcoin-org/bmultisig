/*!
 * sig.js - Signature utilities for bmultisig.
 * Copyright (c) 2019, The Bcoin Developers (MIT License).
 */

'use strict';

const assert = require('bsert');
const {enforce} = assert;
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
  enforce(Buffer.isBuffer(message), 'message', 'buffer');
  assert(message.length < 0xffff, 'Message is too big.');
  enforce(typeof magic === 'string', magic, 'string');

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
  enforce(Buffer.isBuffer(hash), 'hash', 'buffer');
  enforce(Buffer.isBuffer(signature), 'signature', 'buffer');
  enforce(Buffer.isBuffer(publicKey), 'publicKey', 'buffer');
  assert(hash.length === 32, 'hash must be 32 bytes.');
  assert(signature.length === 65, 'signature must be 65 bytes.');
  assert(publicKey.length === 33, 'public key must be 33 bytes.');

  // first byte contains recid and compressed flag
  // and is not important for verifying the signature.
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
 * @param {Buffer} hash
 * @param {Buffer} privateKey
 * @returns {Buffer}
 */

sigutils.signHash = function signHash(hash, privateKey) {
  const [
    signature,
    recovery
  ] = secp256k1.signRecoverable(hash, privateKey);

  return sigutils.encodeSignature(signature, recovery);
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
 * Get join message from options for signing.
 * @param {String} walletName
 * @param {Object} options - cosigner options
 * @param {String} options.name - cosigner name
 * @param {HDPublicKey} options.key
 * @param {Buffer} options.authPubKey
 * @returns {Buffer}
 */

sigutils.encodeJoinMessage = function encodeJoinMessage(walletName, options, network) {
  enforce(typeof walletName === 'string', 'walletName', 'string');
  enforce(options && typeof options === 'object', 'options', 'object');
  enforce(typeof options.name === 'string', 'options.name', 'string');
  enforce(Buffer.isBuffer(options.authPubKey), 'options.authPubKey', 'string');
  enforce(HDPublicKey.isHDPublicKey(options.key), 'options.key', 'HDPublicKey');

  network = Network.get(network);

  let size = 0;
  size += Buffer.byteLength(walletName, 'utf8');
  size += Buffer.byteLength(options.name, 'utf8');
  size += options.authPubKey.length;
  size += options.key.getSize();

  const bw = bufio.write(size);
  bw.writeString(walletName, 'utf8');
  bw.writeString(options.name, 'utf8');
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

/**
 * Get proposal message from json string.
 * @param {String} walletName
 * @param {ProposalPayloadType} type
 * @param {String} json
 * @returns {@Buffer}
 */

sigutils.encodeProposalJSON = function encodeProposalJSON(walletName, type, json) {
  enforce(typeof walletName === 'string', 'walletName', 'string');
  enforce((type & 0xff) === type, 'type', 'u8.');
  enforce(typeof json === 'string', 'json', 'string');

  let size = Buffer.byteLength(walletName, 'utf8') + 1;
  size += Buffer.byteLength(json, 'utf8');
  const data = Buffer.allocUnsafe(size);

  // NOTE: data.write will return bytes written
  // BUT: data.writeUInt8 will return bytes written + offset....
  // ..... maybe rewrite using bufio?
  let written = 0;
  written = data.write(walletName, 'utf8');
  written = data.writeUInt8(type, written);
  written += data.write(json, written, 'utf8');

  assert(size === written);

  return data;
};

/**
 * Get proposal hash from json string.
 * @param {ProposalPayloadType} type - payload type.
 * @param {String} json - stringified json.
 * @returns {Buffer}
 */

sigutils.getProposalHash = function getProposalHash(walletName, type, json) {
  const data = sigutils.encodeProposalJSON(walletName, type, json);
  return sigutils.hashMessage(data);
};
