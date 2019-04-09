'use strict';

const bcoin = require('bcoin');
const {MTX, KeyRing, Script} = bcoin;
const MultisigMTX = require('../../lib/primitives/mtx');

/**
 * Get MTX Signatures
 * @param {MTX} mtx
 * @param {KeyRing[]} rings
 * @returns {Buffer[]} - signatures
 */

function getMTXSignatures(mtx, rings) {
  let msMTX = mtx;

  if (!MultisigMTX.isMultisigMTX(mtx) && MTX.isMTX(mtx))
    msMTX = MultisigMTX.fromMTX(mtx);

  msMTX.view = mtx.view;

  return msMTX.getSignatures(rings);
}

/**
 * Get MTX Rings
 * @param {MTX} mtx
 * @param {Path[]} paths
 * @param {HDPrivateKey} xpriv
 * @param {HDPublicKey[]} xpubs
 * @param {Number} [m = 2]
 * @param {Boolean} [witness = true]
 * @returns {Buffer[]} - signatures
 */

function getMTXRings(mtx, paths, xpriv, xpubs, m = 2, witness = true) {
  const msMTX = MultisigMTX.fromMTX(mtx);
  msMTX.view = mtx.view;

  const rings = new Array(mtx.inputs.length);

  // sign transaction cosigner1
  mtx.inputs.forEach((input, i) => {
    const path = paths[i];

    if (!path)
      return;

    // derive correct priv key
    const priv = xpriv.derive(path.branch).derive(path.index);

    // derive pubkeys
    const pubkeys = xpubs.map((pubkey) => {
      return pubkey.derive(path.branch).derive(path.index).publicKey;
    });

    const ring = KeyRing.fromPrivate(priv.privateKey);

    ring.witness = witness;
    ring.script = Script.fromMultisig(
      m,
      pubkeys.length,
      pubkeys
    );

    rings[i] = ring;
  });

  return rings;
}

/*
 * Expose
 */

exports.getMTXSignatures = getMTXSignatures;
exports.getMTXRings = getMTXRings;
