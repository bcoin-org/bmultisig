Bmultisig CHANGELOG and notes.
=======

## 2.0.0-beta.2
Bmultisig will use latest version of bcoin from github.
Add proposal stats to get general overview of the wallet proposals.

**NOTE: Migration is necessary for this update, check migrate folder.** (#63)

Fix (#63):
 - Remove locks for approved proposal when tx is seen.

HTTP API Updates (#63):
 - Add API Endpoint to get proposal by coin.
 - Lock coin in TXDB memory (bcoin compatible)
 - Unlock coin (TXDB or Reject proposal)
 - Add force parameter for forcefully rejecting proposals (admin only).
 - Return proposal stats when getting wallet info.

Features:
 - Add import/export of the bmultisig wallet (#61).

## 2.0.0-beta.1

### API Changes
All endpoints have updated cosigner object
that now are all consistent with all responses.

Also Cosigner meta-data (`purpose`, `fingerPrint`, and `data`)
now always return for each cosigner.

See Docs: [HTTP API](./docs/http.md)

#### Other
node.js version check: `>=8.0.0` and `<12.0.0`.


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
