Bmultisig CHANGELOG and notes.
=======

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
