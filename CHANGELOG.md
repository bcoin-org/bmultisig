Bmultisig CHANGELOG and notes.
=======

## 2.0.0-beta.1
Bmultisig will use latest version of bcoin from github.
Add proposal stats to get general overview of the wallet proposals.

**NOTE: Migration is necessary for this update, check migrate folder.** (#63)

### Bug Fixes:
 - Remove locks for approved proposal when tx is seen ([#63][proposal-api-changes]).
 - Fix deduped hashes ([#53][fix-deduped]).

### API Changes
  - All endpoints have updated cosigner object
that now are all consistent with all responses. ([#51][proposed-api-changes])
  - Also Cosigner meta-data (`purpose`, `fingerPrint`, and `data`)
now always return for each cosigner. ([#51][proposed-api-changes])
  - Add API Endpoint to get proposal by coin ([#63][proposal-api-changes]).
  - Lock coin in TXDB memory (bcoin compatible) ([#63][proposal-api-changes])
  - Unlock coin (TXDB or Reject proposal) ([#63][proposal-api-changes])
  - Add force parameter for forcefully rejecting proposals (admin only). ([#63][proposal-api-changes])
  - Return proposal stats when getting wallet info. ([#63][proposal-api-changes])

See Docs: [HTTP API](./docs/http.md)

### Features:
 - Add import/export of the bmultisig wallet([#61][import-export]).
 - Add proposal stats for the wallet ([#63][proposal-api-changes]).

[fix-deduped]: https://github.com/bcoin-org/bmultisig/pull/53
[proposed-api-changes]: https://github.com/bcoin-org/bmultisig/pull/51
[proposal-api-changes]: https://github.com/bcoin-org/bmultisig/pull/63
[import-export]: https://github.com/bcoin-org/bmultisig/pull/61

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
