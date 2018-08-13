/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('./util/assert');
const Proposal = require('../lib/primitives/proposal');
const Cosigner = require('../lib/primitives/cosigner');
const {ApprovedRecord, SignaturesRecord} = Proposal;
const {hd} = require('bcoin');

const TEST_OPTIONS = {
  id: 1,
  name: 'test1',
  m: 2,
  n: 3,
  author: 0
};

const TEST_KEY = hd.generate().toPublic();

describe('Proposal', function () {
  it('should create proposal from option', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);

    for (const key of Object.keys(TEST_OPTIONS))
      assert.strictEqual(proposal[key], TEST_OPTIONS[key]);
  });

  it('should serialize to JSON and recover', () => {
    const proposal = new Proposal(TEST_OPTIONS);

    const json = proposal.toJSON();
    const proposal1 = Proposal.fromJSON(json);

    assert.strictEqual(proposal.equals(proposal1), true);
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
    const cosigner1 = Cosigner.fromOptions({
      id: 0,
      name: 'cosigner1',
      key: TEST_KEY
    });

    const cosigner2 = Cosigner.fromOptions({
      id: 1,
      name: 'cosigner2',
      key: TEST_KEY
    });

    proposal.reject(cosigner1);

    assert.strictEqual(proposal.rejections.length, 1);
    assert.strictEqual(proposal.status, Proposal.status.PROGRESS);
    assert.strictEqual(proposal.rejections[0], cosigner1.id);

    let err;
    try {
      proposal.reject(cosigner1);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cosigner already rejected.');

    proposal.reject(cosigner2);

    assert.strictEqual(proposal.rejections.length, 2);
    assert.strictEqual(proposal.status, Proposal.status.REJECTED);
    assert.deepStrictEqual(proposal.rejections, [0, 1]);
  });

  it('should approve proposal', () => {
    const proposal = Proposal.fromOptions(TEST_OPTIONS);
    const cosigner1 = Cosigner.fromOptions({
      id: 0,
      name: 'cosigner1',
      key: TEST_KEY
    });

    const cosigner2 = Cosigner.fromOptions({
      id: 1,
      name: 'cosigner2',
      key: TEST_KEY
    });

    proposal.approve(cosigner1);

    assert.strictEqual(proposal.approvals.length, 1);
    assert.strictEqual(proposal.status, Proposal.status.PROGRESS);
    assert.strictEqual(proposal.approvals[0], cosigner1.id);

    let err;
    try {
      proposal.approve(cosigner1);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Cosigner already approved.');

    proposal.approve(cosigner2);

    assert.strictEqual(proposal.approvals.length, 2);
    assert.strictEqual(proposal.status, Proposal.status.APPROVED);
    assert.deepStrictEqual(proposal.approvals, [0, 1]);
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
  });

  describe('ApprovedRecord', function () {
    it('should create empty record', () => {
      const approvedRecord = new ApprovedRecord();

      assert.strictEqual(approvedRecord.approvals.size, 0);
    });

    it('should reserialize empty record', () => {
      const approvedRecord = new ApprovedRecord();
      const raw = approvedRecord.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from([0x00])
      );

      const approvedRecord2 = ApprovedRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord.equals(approvedRecord2), true);
    });

    it('should reserialize approved record', () => {
      const sigRecord = new SignaturesRecord();
      const approvedRecord = new ApprovedRecord();

      approvedRecord.set(0, sigRecord);

      const raw = approvedRecord.toRaw();
      assert.bufferEqual(
        raw,
        Buffer.from('01000000', 'hex')
      );

      const approvedRecord2 = ApprovedRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord.equals(approvedRecord2), true);
    });

    it('should reserialize approved record with more sig records', () => {
      const sigs1 = [Buffer.alloc(1, 0), null, null, Buffer.alloc(5, 0)];
      const sigs2 = [Buffer.alloc(2, 0), Buffer.alloc(2, 0)];

      const sigRecord1 = SignaturesRecord.fromSignatures(sigs1);
      const sigRecord2 = SignaturesRecord.fromSignatures(sigs2);

      const hexSig1 = sigRecord1.toHex();
      const hexSig2 = sigRecord2.toHex();

      const approvedRecord1 = new ApprovedRecord();

      approvedRecord1.set(0, sigRecord1);
      approvedRecord1.set(1, sigRecord2);

      const raw = approvedRecord1.toRaw();

      assert.bufferEqual(
        raw,
        Buffer.from(`0200${hexSig1}01${hexSig2}`, 'hex')
      );

      const approvedRecord2 = ApprovedRecord.fromRaw(raw);

      assert.strictEqual(approvedRecord1.equals(approvedRecord2), true);
    });
  });
});
