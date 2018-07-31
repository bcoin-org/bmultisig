/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const MultisigMTX = require('../lib/primitives/mtx');
const {KeyRing, Script, Coin} = require('bcoin');

const utils = require('./util/wallet');

// 1 BTC
const BTC = 100000000;

describe('MultisigMTX', function () {
  for (const witness of [true, false]) {
    it(`should get input signature (witness=${witness})`, async () => {
      const ring = createRing(witness);
      const ring2 = createRing(witness);
      const {mtx, coin} = await createSpendingTX(ring, BTC);

      // sign duplicate tx
      const signedMTX = mtx.clone();
      signedMTX.view = mtx.view;

      const isWitness = mtx.isWitnessCoin(coin, ring);
      assert.strictEqual(isWitness, witness);

      const signed = signedMTX.sign(ring);
      assert(signed, 'Could not sign transaction.');

      let sig;
      {
        // get signature from input
        const input = signedMTX.inputs[0];
        const signScript = isWitness ? input.witness : input.script;
        const vector = signScript.toStack();

        sig = vector.get(0);
      }

      const sig2 = mtx.getInputSignature(0, coin, ring);
      const check1 = mtx.checkSignature(0, coin, ring, sig);

      assert.bufferEqual(sig2, sig);
      assert.strictEqual(check1, true);

      let err;
      try {
        mtx.checkSignature(0, coin, ring2, sig);
      } catch (e) {
        err = e;
      }

      assert(err);
      assert.strictEqual(err.message, 'Coin does not belong to the ring.');

      // apply signature
      sig = null;
      err = null;

      mtx.scriptInput(0, coin, ring);
      let applied = mtx.applySignature(0, coin, ring, sig2);

      assert.strictEqual(applied, true);

      {
        const input = mtx.inputs[0];
        const signScript = isWitness ? input.witness : input.script;
        const vector = signScript.toStack();

        sig = vector.get(0);
      }

      assert.bufferEqual(sig, sig2);

      // reset mtx input
      applied = mtx.applySignature(0, coin, ring2, sig2);
      assert.strictEqual(applied, false);
    });

    it(`should get input signature multisig (witness=${witness})`, async () => {
      // generate keys
      const [ring1, ring2] = createMultisigRings(witness);
      const {mtx, coin} = await createSpendingTX(ring1, BTC);

      const signedMTX = mtx.clone();
      signedMTX.view = mtx.view;

      const isWitness = mtx.isWitnessCoin(coin, ring1);
      assert.strictEqual(isWitness, witness);

      // sign with first key.
      const signed = signedMTX.sign(ring1);
      assert(signed, 'Could not sign transaction.');

      let sig;

      {
        const input = signedMTX.inputs[0];
        const signScript = isWitness ? input.witness : input.script;
        const vector = signScript.toStack();

        // get signatures from stack
        const [sig1, sig2] = [vector.get(1), vector.get(2)];
        sig = sig1.length > 0 ? sig1 : sig2;
      }

      // choose correct signature
      const sig2 = mtx.getInputSignature(0, coin, ring1);

      assert.bufferEqual(sig2, sig, 'Signature is not correct.');
      assert.strictEqual(mtx.checkSignature(0, coin, ring1, sig), true);
      assert.strictEqual(mtx.checkSignature(0, coin, ring2, sig), false);

      mtx.scriptInput(0, coin, ring1);

      const applied = mtx.applySignature(0, coin, ring1, sig);
      assert.strictEqual(applied, true);

      sig = null;

      {
        const input = mtx.inputs[0];
        const signScript = isWitness ? input.witness : input.script;
        const vector = signScript.toStack();

        // get signatures from stack
        const [sig1, sig2] = [vector.get(1), vector.get(2)];
        sig = sig1.length > 0 ? sig1 : sig2;
      }

      assert.bufferEqual(sig, sig2);
    });
  }
});

/**
 * Create multisig 2-of-2 keyrings
 * @ignore
 * @param {Boolean} witness
 * @returns {[KeyRing, KeyRing]}
 */

function createMultisigRings(witness) {
  const key1 = KeyRing.generate(true);
  const key2 = KeyRing.generate(true);

  key1.witness = witness;
  key2.witness = witness;

  const [pub1, pub2] = [key1.publicKey, key2.publicKey];

  const script = Script.fromMultisig(2, 2, [pub1, pub2]);
  key1.script = script;
  key2.script = script;

  return [key1, key2];
}

/**
 * Create p2pkh keyring
 * @ignore
 * @param {Boolean} witness
 * @returns {KeyRing}
 */

function createRing(witness) {
  const key = KeyRing.generate(true);

  key.witness = witness;

  return key;
}

/*
 * Create spending transaction
 * 1 input, send from ourselves to ourselves.
 * @ignore
 * @param {KeyRing} ring
 * @param {Number} value
 * @return {MultisigMTX}
 */

async function createSpendingTX(ring, value) {
  const address = ring.getAddress();
  const fundTX = utils.createFundTX(address, value);

  const coin = Coin.fromTX(fundTX, 0, -1);
  const mtx = new MultisigMTX();

  // send money to ourselves.
  mtx.addOutput({ address, value });

  // fund tx
  await mtx.fund([coin], {
    changeAddress: address,
    rate: 0
  });

  return {
    mtx: mtx,
    coin: coin
  };
}
