/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const Proposal = require('../lib/primitives/proposal');
const Cosigner = require('../lib/primitives/cosigner');
const {ApprovalsMapRecord} = Proposal;
const {RejectionsMapRecord} = Proposal;
const {SignaturesRecord} = Proposal;
const {hd} = require('bcoin');
const secp256k1 = require('bcrypto/lib/secp256k1');

const ZERO_SIG = Buffer.alloc(65, 0x00);
const TX_SIG = Buffer.alloc(5, 0x00);

const PROPOSAL_OPTIONS = {
  id: 1,
  memo: 'test1',
  m: 2,
  n: 3,
  author: 0,
  timestamp: Math.floor(Date.now() / 1000)
};

const TEST_OPTIONS = {
  ...PROPOSAL_OPTIONS,
  options: PROPOSAL_OPTIONS,
  signature: Buffer.alloc(65, 0)
};

const TEST_KEY = hd.generate().toPublic();

const COSIGNERS = [];

for (let i = 0; i < 3; i++) {
  const privKey = secp256k1.privateKeyGenerate();
  const pubKey = secp256k1.publicKeyCreate(privKey, true);

  const cosigner = Cosigner.fromOptions({
    id: i,
    name: 'cosigner' + (i + 1),
    key: TEST_KEY,
    authPubKey: pubKey,
    joinSignature: Buffer.alloc(65, 1)
  });

  COSIGNERS.push(cosigner);
}

describe('Proposal', function () {
  it('should create proposal from option', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);

    for (const key of Object.keys(PROPOSAL_OPTIONS))
      assert.strictEqual(proposal[key], PROPOSAL_OPTIONS[key]);

    assert.strictEqual(proposal.options, JSON.stringify(PROPOSAL_OPTIONS));
    assert.bufferEqual(proposal.signature, TEST_OPTIONS.signature);
  });

  it('should serialize to JSON and recover', () => {
    const proposal = new Proposal(TEST_OPTIONS);

    const json = proposal.toJSON();
    const proposal1 = Proposal.fromJSON(json);

    assert.strictEqual(proposal.equals(proposal1), true);
  });

  it('should serialize to JSON and recover (cosigners)', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);
    const cosigner1 = Cosigner.fromOptions(COSIGNERS[1]);
    const cosigner2 = Cosigner.fromOptions(COSIGNERS[2]);

    proposal.approve(cosigner1, [null, TX_SIG]);
    proposal.reject(cosigner2, Buffer.alloc(65));

    const json = proposal.getJSON(null, COSIGNERS);
    const proposal1 = Proposal.fromJSON(json);

    // check author details first
    assert.deepStrictEqual(
      json.cosignerDetails[json.author],
      COSIGNERS[0].toJSON()
    );

    for (const id of Object.keys(json.approvals)) {
      const details = json.cosignerDetails[id];

      assert.deepStrictEqual(details, COSIGNERS[id].toJSON());
    }

    for (const id of Object.keys(json.rejections)) {
      const details = json.cosignerDetails[id];

      assert.deepStrictEqual(details, COSIGNERS[id].toJSON());
    }

    assert(proposal.equals(proposal1), true);
  });

  it('should serialize to Raw and recover', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);

    const raw = proposal.toRaw();
    const proposal1 = Proposal.fromRaw(raw);

    // m and n are not stored in raw serialization
    // they are assigned from wallet after recovering
    // the proposal.
    proposal1.m = proposal.m;
    proposal1.n = proposal.n;

    assert.strictEqual(proposal.equals(proposal1), true);
  });

  it('should reject proposal', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);
    const cosigner1 = COSIGNERS[0];
    const cosigner2 = COSIGNERS[1];

    proposal.reject(cosigner1, Buffer.alloc(65));

    assert.strictEqual(proposal.rejections.size, 1);
    assert.strictEqual(proposal.status, Proposal.status.PROGRESS);
    assert.strictEqual(proposal.rejections.has(cosigner1.id), true);
    assert.deepStrictEqual(
      Array.from(proposal.rejections.keys()),
      [cosigner1.id]
    );

    let err;
    try {
      proposal.reject(cosigner1, Buffer.alloc(65));
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cosigner already rejected.');

    proposal.reject(cosigner2, Buffer.alloc(65));

    assert.strictEqual(proposal.rejections.size, 2);
    assert.notStrictEqual(proposal.closedAt, 0);
    assert.strictEqual(proposal.status, Proposal.status.REJECTED);
    assert.strictEqual(proposal.rejections.has(0), true);
    assert.strictEqual(proposal.rejections.has(1), true);
    assert.deepStrictEqual(
      Array.from(proposal.rejections.keys()),
      [0, 1]
    );

    assert.deepStrictEqual(proposal.rejections.toJSON(), {
      0: ZERO_SIG.toString('hex'),
      1: ZERO_SIG.toString('hex')
    });
  });

  it('should approve proposal', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);
    const cosigner1 = COSIGNERS[0];
    const cosigner2 = COSIGNERS[1];

    proposal.approve(cosigner1, [null, TX_SIG]);

    assert.strictEqual(proposal.approvals.size, 1);
    assert.strictEqual(proposal.status, Proposal.status.PROGRESS);
    assert.strictEqual(proposal.approvals.has(0), true);

    let err;
    try {
      proposal.approve(cosigner1, [null, TX_SIG]);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cosigner already approved.');

    proposal.approve(cosigner2, [null, TX_SIG]);

    assert.strictEqual(proposal.approvals.size, 2);
    assert.notStrictEqual(proposal.closedAt, 0);
    assert.strictEqual(proposal.status, Proposal.status.APPROVED);
    assert.strictEqual(proposal.approvals.has(0), true);
    assert.strictEqual(proposal.approvals.has(1), true);
    assert.deepStrictEqual(Array.from(proposal.approvals.keys()), [0, 1]);
    assert.deepStrictEqual(proposal.approvals.toJSON(), {
      0: [undefined, TX_SIG.toString('hex')],
      1: [undefined, TX_SIG.toString('hex')]
    });
  });

  it('should force reject proposal', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);

    let err;

    try {
      proposal.forceReject(Proposal.status.APPROVED);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert(err.message, 'status needs to be a rejection.');

    proposal.forceReject(Proposal.status.DBLSPEND);

    assert.strictEqual(proposal.status, Proposal.status.DBLSPEND);

    err = null;
    try {
      proposal.forceReject(Proposal.status.REJECTED);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Can not reject non pending proposal.');
  });

  describe('SignaturesRecord', function () {
    it('should create empty signature record', () => {
      const sigRecord = new SignaturesRecord();

      assert.strictEqual(sigRecord.signatures.size, 0);
      assert.strictEqual(sigRecord.toSignatures().length, 0);
    });

    it('should reserialize signatures record', () => {
      const sigRecord = new SignaturesRecord();
      const raw = sigRecord.toRaw();
      const sigRecord2 = SignaturesRecord.fromRaw(raw);

      assert.bufferEqual(raw, Buffer.from([0x00, 0x00]));
      assert.strictEqual(sigRecord.equals(sigRecord2), true);
    });

    it('should create signature record', () => {
      const sigRecord = SignaturesRecord.fromSignatures([
        Buffer.alloc(32, 0),
        Buffer.alloc(32, 0)
      ]);

      assert.strictEqual(sigRecord.signatures.size, 2);
    });

    it('should reserialize signature record', () => {
      const sigRecord = SignaturesRecord.fromSignatures([
        Buffer.alloc(2, 0),
        Buffer.alloc(2, 0)
      ]);

      const raw = sigRecord.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from('02020002000001020000', 'hex')
      );

      const sigRecord2 = SignaturesRecord.fromRaw(raw);
      assert.strictEqual(sigRecord.equals(sigRecord2), true);
    });

    it('should reserialize signature record with null elements', () => {
      const sigRecord = SignaturesRecord.fromSignatures([
        Buffer.alloc(1, 0),
        null, // null element
        null, // another null element
        Buffer.alloc(5, 0)
      ]);

      const raw = sigRecord.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from('040200010003050000000000', 'hex')
      );

      const sigRecord2 = SignaturesRecord.fromRaw(raw);

      assert.strictEqual(sigRecord.equals(sigRecord2), true);
    });

    it('should serialize to JSON and deserialize', () => {
      const signatures = [
        Buffer.alloc(5, 0),
        Buffer.alloc(32, 0)
      ];

      const signaturesRecord1 = SignaturesRecord.fromSignatures(signatures);
      const json = signaturesRecord1.toJSON();
      const signaturesRecord2 = SignaturesRecord.fromJSON(json);

      assert.ok(signaturesRecord1.equals(signaturesRecord2));
    });
  });

  describe('RejectionsMapRecord', function () {
    it('should create empty rejections map', () => {
      const rejRecord1 = new RejectionsMapRecord();

      assert.strictEqual(rejRecord1.size, 0);

      const raw = rejRecord1.toRaw();
      const rejRecord2 = RejectionsMapRecord.fromRaw(raw);

      assert.bufferEqual(raw, Buffer.from([0x00]));

      assert.strictEqual(rejRecord2.size, 0);
      assert.strictEqual(rejRecord1.equals(rejRecord2), true);
    });

    it('should reserialize empty record', () => {
      const rejectionsRecord = new RejectionsMapRecord();
      const raw = rejectionsRecord.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from([0x00])
      );

      const rejectionsRecord2 = RejectionsMapRecord.fromRaw(raw);

      assert.strictEqual(rejectionsRecord.equals(rejectionsRecord2), true);
    });

    it('should reserialize record (1)', () => {
      const record1 = new RejectionsMapRecord();
      const signature = Buffer.alloc(65, 1);

      record1.set(0, signature);

      const raw = record1.toRaw();
      const json = record1.toJSON();

      assert.bufferEqual(
        raw,
        Buffer.concat([Buffer.from('0100', 'hex'), signature])
      );

      const record2 = RejectionsMapRecord.fromRaw(raw);
      const record3 = RejectionsMapRecord.fromJSON(json);

      assert(record2.equals(record1));
      assert(record3.equals(record1));
    });

    it('should reserialize record (4)', () => {
      const json = {
        0: Buffer.alloc(65, 0).toString('hex'),
        1: Buffer.alloc(65, 1).toString('hex'),
        2: Buffer.alloc(65, 2).toString('hex'),
        10: Buffer.alloc(65, 10).toString('hex')
      };

      const record1 = RejectionsMapRecord.fromJSON(json);

      assert.strictEqual(record1.size, 4);

      const raw = record1.toRaw();
      const json1 = record1.toJSON() ;
      const record2 = RejectionsMapRecord.fromRaw(raw);

      assert(record2.equals(record1));
      assert.deepStrictEqual(json, json1);
    });

    it('should clone record', () => {
      const record1 = RejectionsMapRecord.fromJSON({
        32: Buffer.alloc(65, 32).toString('hex'),
        45: Buffer.alloc(65, 45).toString('hex')
      });

      assert.strictEqual(record1.size, 2);

      const record2 = record1.clone();

      assert(record1.equals(record2));
    });
  });

  describe('ApprovalsMapRecord', function () {
    it('should create empty record', () => {
      const approvedRecord = new ApprovalsMapRecord();

      assert.strictEqual(approvedRecord.approvals.size, 0);
    });

    it('should reserialize empty record', () => {
      const approvedRecord = new ApprovalsMapRecord();
      const raw = approvedRecord.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from([0x00])
      );

      const approvedRecord2 = ApprovalsMapRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord.equals(approvedRecord2), true);
    });

    it('should reserialize approved record', () => {
      const sigRecord = new SignaturesRecord();
      const approvedRecord = new ApprovalsMapRecord();

      approvedRecord.set(0, sigRecord);

      const raw = approvedRecord.toRaw();
      assert.bufferEqual(
        raw,
        Buffer.from('01000000', 'hex')
      );

      const approvedRecord2 = ApprovalsMapRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord.equals(approvedRecord2), true);
    });

    it('should reserialize approved record with more sig records', () => {
      const sigs1 = [Buffer.alloc(1, 0), null, null, Buffer.alloc(5, 0)];
      const sigs2 = [Buffer.alloc(2, 0), Buffer.alloc(2, 0)];

      const sigRecord1 = SignaturesRecord.fromSignatures(sigs1);
      const sigRecord2 = SignaturesRecord.fromSignatures(sigs2);

      const hexSig1 = sigRecord1.toHex();
      const hexSig2 = sigRecord2.toHex();

      const approvedRecord1 = new ApprovalsMapRecord();

      approvedRecord1.set(0, sigRecord1);
      approvedRecord1.set(1, sigRecord2);

      const raw = approvedRecord1.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from(`0200${hexSig1}01${hexSig2}`, 'hex')
      );

      const approvedRecord2 = ApprovalsMapRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord1.equals(approvedRecord2), true);
    });

    it('should reserialize approval map record', () => {
      const sigs1 = [Buffer.alloc(20, 0)];
      const sigs2 = [Buffer.alloc(10, 1)];

      const sigRecord1 = SignaturesRecord.fromSignatures(sigs1);
      const sigRecord2 = SignaturesRecord.fromSignatures(sigs2);

      const approvedRecord1 = new ApprovalsMapRecord();

      approvedRecord1.set(0, sigRecord1);
      approvedRecord1.set(2, sigRecord2);

      const json = approvedRecord1.toJSON();
      const approvedRecord2 = ApprovalsMapRecord.fromJSON(json);

      assert.strictEqual(approvedRecord1.size, approvedRecord2.size);

      for (const key of approvedRecord1.keys())
        assert(approvedRecord2.has(key));
    });
  });
});
