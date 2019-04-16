/*!
 * mtx.js - MTX extended for multisig
 * Copyright (c) 2018, The Bcoin Developers (MIT License).
 * https://github.com/bcoin-org/bmultisig
 */

'use strict';

const assert = require('bsert');
const {enforce} = assert;
const MTX = require('bcoin/lib/primitives/mtx');
const Coin = require('bcoin/lib/primitives/coin');
const Script = require('bcoin/lib/script/script');
const Witness = require('bcoin/lib/script/witness');

/**
 * Multisig MTX
 * TODO: throw correct errors.
 * @alias module:primitives.MultisigMTX
 */

class MultisigMTX extends MTX {
  constructor(options) {
    super(options);
  }

  /**
   * Check if coin we are spending
   * is witness.
   * TODO: Belongs to Coin.
   * @param {Coin} coin
   * @param {KeyRing} ring
   * @returns {Boolean} - true if it's witness program,
   * false if it is normal or ring does not own coin.
   */

  isWitnessCoin(coin, ring) {
    assert(ring.ownOutput(coin), 'Coin does not belong to the ring.');
    const prev = coin.script;

    if (prev.isProgram())
      return true;

    const sh = prev.getScripthash();

    if (sh) {
      const redeem = ring.getRedeem(sh);

      // should not happen
      if (!redeem)
        throw new Error('redeem script not found.');

      if (redeem.isProgram())
        return true;
    }

    return false;
  }

  /**
   * Get script to sign.
   * TODO: Belongs to Coin.
   * @param {Coin} coin
   * @param {KeyRing} ring
   * @returns {Script?}
   */

  getPrevScript(coin, ring) {
    const prev = coin.script;

    const sh = prev.getScripthash();

    if (sh) {
      const redeem = ring.getRedeem(sh);

      if (!redeem)
        return null;

      // Regular P2SH.
      if (!redeem.isProgram())
        return redeem.clone();

      // nested P2WSH
      const wsh = redeem.getWitnessScripthash();

      if (wsh) {
        const wredeem = ring.getRedeem(wsh);

        if (!wredeem)
          return null;

        return wredeem.clone();
      }

      // nested P2WPKH
      const wpkh = redeem.getWitnessPubkeyhash();

      if (wpkh)
        return Script.fromPubkeyhash(wpkh);

      // Unknown witness program.
      return null;
    }

    // normal output.
    if (!prev.isProgram())
      return prev.clone();

    // P2WSH
    const wsh = prev.getWitnessScripthash();

    if (wsh) {
      const wredeem = ring.getRedeem(wsh);

      if (!wredeem)
        return null;

      return wredeem.clone();
    }

    // P2WPKH
    const wpkh = prev.getWitnessPubkeyhash();

    if (wpkh)
      return Script.fromPubkeyhash(wpkh);

    return null;
  }

  /**
   * Verify signature without modifying transaction
   * TODO: move to TX
   * TODO: verifySignature
   * @param {Number} index - index of input being verified.
   * @param {Coin} coin
   * @param {KeyRing} ring
   * @param {Buffer} signature
   * @param {SighashType} type
   * @return {Boolean}
   */

  checkSignature(index, coin, ring, signature) {
    const input = this.inputs[index];
    const value = coin.value;

    assert(input, 'Input does not exist.');
    enforce(Coin.isCoin(coin), 'coin', 'Coin');
    enforce(Buffer.isBuffer(signature), 'signature', 'buffer');

    const prev = this.getPrevScript(coin, ring);
    const version = this.isWitnessCoin(coin, ring) ? 1 : 0;
    const key = ring.publicKey;

    return this.checksig(index, prev, value, signature, key, version);
  }

  /**
   * Sign and return signature
   * TODO: move to TX
   * TODO: Rename
   * @param {Number} index - index of input being signed.
   * @param {Coin|Output} coin
   * @param {KeyRing} ring
   * @param {SighashType} type
   * @returns {Buffer}
   */

  getInputSignature(index, coin, ring, type) {
    const input = this.inputs[index];

    assert(input, 'Input does not exist.');
    assert(coin, 'Input does not exist.');
    assert(ring.privateKey, 'No private key available.');

    const key = ring.privateKey;
    const value = coin.value;
    const version = this.isWitnessCoin(coin, ring) ? 1 : 0;
    const prev = this.getPrevScript(coin, ring);

    return this.signature(index, prev, value, key, type, version);
  }

  /**
   * Sign and return input signatures for a ring.
   * TODO: move to TX
   * TODO: rename
   * @param {KeyRing[]} rings - Keyring
   * @param {SighashType} type - Sighash type
   * @returns {Buffer[]}
   */

  getSignatures(rings, type) {
    assert(rings.length === this.inputs.length);
    const signatures = new Array(this.inputs.length);

    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];

      if (!ring)
        continue;

      const {prevout} = this.inputs[i];
      const coin = this.view.getOutput(prevout);

      if (!coin)
        continue;

      if (!ring.ownOutput(coin))
        throw new Error('Input does not belong to the key.');

      signatures[i] = this.getInputSignature(i, coin, ring, type);
    }

    return signatures;
  }

  /**
   * Apply signature without validating signature
   * @param {Number} index - index of input being signed.
   * @param {Coin|Output} coin
   * @param {KeyRing} ring
   * @param {Buffer} signature
   * @param {Boolean} valid - verify signature
   * @returns {Boolean} whether the signature was applied.
   */

  applySignature(index, coin, ring, signature, valid) {
    const input = this.inputs[index];
    const key = ring.publicKey;

    assert(input, 'Input does not exist.');
    assert(coin, 'No coin passed.');
    assert(signature, 'No signature passed.');

    // Get the previous output's script
    const value = coin.value;
    let prev = coin.script;
    let vector = input.script;
    let version = 0;
    let redeem = false;

    // Grab regular p2sh redeem script.
    if (prev.isScripthash()) {
      prev = input.script.getRedeem();
      if (!prev)
        throw new Error('Input has not been templated.');
      redeem = true;
    }

    // If the output script is a witness program,
    // we have to switch the vector to the witness
    // and potentially alter the length. Note that
    // witnesses are stack items, so the `dummy`
    // _has_ to be an empty buffer (what OP_0
    // pushes onto the stack).
    if (prev.isWitnessScripthash()) {
      prev = input.witness.getRedeem();
      if (!prev)
        throw new Error('Input has not been templated.');
      vector = input.witness;
      redeem = true;
      version = 1;
    } else {
      const wpkh = prev.getWitnessPubkeyhash();
      if (wpkh) {
        prev = Script.fromPubkeyhash(wpkh);
        vector = input.witness;
        redeem = false;
        version = 1;
      }
    }

    if (valid && !this.checksig(index, prev, value, signature, key, version))
      return false;

    if (redeem) {
      const stack = vector.toStack();
      const redeem = stack.pop();

      const result = this.signVector(prev, stack, signature, ring);

      if (!result)
        return false;

      result.push(redeem);

      vector.fromStack(result);

      return true;
    }

    const stack = vector.toStack();
    const result = this.signVector(prev, stack, signature, ring);

    if (!result)
      return false;

    vector.fromStack(result);

    return true;
  }

  /**
   * Apply signatures without validating signatures.
   * TODO: partially applied?
   * @param {KeyRing[]} rings - ring per signature
   * @param {Buffer[]} signatures - signatures
   * @param {Boolean} verify - should we verify applied signature(s)
   * @return {Boolean} whether the signature was applied.
   */

  applySignatures(rings, signatures, verify) {
    assert(signatures.length === this.inputs.length);
    assert(signatures.length === rings.length);

    for (let i = 0; i < signatures.length; i++) {
      const signature = signatures[i];
      const ring = rings[i];

      if (!signature)
        continue;

      if (!ring)
        throw new Error('Could not find key.');

      const {prevout} = this.inputs[i];
      const coin = this.view.getOutput(prevout);

      if (!coin)
        throw new Error('Could not find coin.');

      if (!ring.ownOutput(coin))
        throw new Error('Coin does not belong to the key.');

      // Build script for input
      if (!this.scriptInput(i, coin, ring))
        continue;

      if (!this.applySignature(i, coin, ring, signature, verify))
        return false;
    }

    return true;
  }

  /**
   * Check signatures
   * @param {KeyRing[]} rings - ring per signature
   * @param {Buffer[]} signatures
   * @returns {Number} number of valid signatures
   */

  checkSignatures(rings, signatures) {
    assert(signatures.length === this.inputs.length);

    let valid = 0;

    for (let i = 0; i < signatures.length; i++) {
      const signature = signatures[i];
      const ring = rings[i];

      if (!signature)
        continue;

      if (!ring)
        throw new Error('Could not find key.');

      const {prevout} = this.inputs[i];
      const coin = this.view.getCoin(prevout);

      if (!coin)
        throw new Error('Could not find coin.');

      if (!ring.ownOutput(coin))
        throw new Error('Coin does not belong to the key.');

      if (this.checkSignature(i, coin, ring, signature))
        valid += 1;
    }

    return valid;
  }

  /**
   * Empties input scripts and witness
   */

  emptyInputs() {
    for (const input of this.inputs) {
      const {script, witness} = input;

      if (script.length > 0)
        input.script = new Script();

      if (witness.length > 0)
        input.witness = new Witness();
    }
  }

  toMTX() {
    return new MTX().inject(this);
  }

  /**
   * Instantiate MultisigMTX from MTX.
   * @param {MTX} mtx
   * @returns {MultisigMTX}
   */

  static fromMTX(mtx) {
    return new this().inject(mtx);
  }

  /**
   * Test whether an object is a MultisigMTX.
   * @param {Object} obj
   * @returns {Boolean}
   */

  static isMultisigMTX(obj) {
    return obj instanceof MultisigMTX;
  }
}

/*
 * Expose
 */

module.exports = MultisigMTX;
