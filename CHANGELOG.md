Bmultisig CHANGELOG and notes.
=======

## 2.0.0-beta.1
Bmultisig will use latest version of bcoin from github.
Add proposal stats to get general overview of the wallet proposals.

**NOTE: Migration is necessary for this update, check migrate folder.** (#63)

### Bug Fixes:
 - Remove locks for approved proposal when tx is seen (#63).
 - Fix deduped hashes (#53).

### API Changes
  - All endpoints have updated cosigner object
that now are all consistent with all responses. (#51)
  - Also Cosigner meta-data (`purpose`, `fingerPrint`, and `data`)
now always return for each cosigner. (#51)
  - Add API Endpoint to get proposal by coin (#63).
  - Lock coin in TXDB memory (bcoin compatible) (#63)
  - Unlock coin (TXDB or Reject proposal) (#63)
  - Add force parameter for forcefully rejecting proposals (admin only). (#63)
  - Return proposal stats when getting wallet info. (#63)

See Docs: [HTTP API](./docs/http.md)

### Features:
 - Add import/export of the bmultisig wallet (Migration) (#61).

## 2.0.0-beta

### API Changes

#### Bmultisig Client
MultisigClient has moved back to bmultisig.
Client apis will have to use `bcrypto` as well as `bcoin`
primitives, so there is not big advantage of having them separate.

#### Signing and verification
  - Doc: [Signing and Verification](./docs/signing.md)

#### HTTP API
Proposal and cosigner json serializations have changed
so it affected Events and HTTP endpoints using them.

Some api endpoints, related to signing were changed:
  - Create multisig wallet (PUT /:id)
  - Join multisig wallet (POST /:id/join)
  - Set new token for cosigner (PUT /:id/token)
  - Removed retoken endpoint
  - Create proposal (POST /:id/proposal)
  - Get proposal info accept `tx` option. (GET /:id/proposal/:pid)
  - Approve proposal (POST /:id/proposal/:pid/approve)
  - Reject proposal (POST /:id/proposal/:pid/reject)

#### Events
Results for events are different and match endpoint responses.

#### other
  - Get proposal info will accept `tx` boolean parameter, if client
  wants to include `mtx` object in the response.
