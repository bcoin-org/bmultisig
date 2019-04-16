v2.0.0-beta - Signing and Verification
=======

## General information and definitions.

### Keys
Signatures and keys that are used in bmultisig are all using `secp256k1`.

### Signing data
Signatures will be generated from data using similar to
what `signmessage` RPC call does and will return signature with same encoding.
This way it will be compatible with bitcoind APIs as well as hardware signing.
We will be refering to this method when talking about signing.
  - varSize of magic string (Bitcoin Signed Message:\n)
  - magic string
  - varSize of data
  - data

All hashed using `hash256` (double sha256)  
Signature will use `signmessage` format as well for compatibility.

### General request signing
There wont be general request signing, we wont be using signatures
for authentication of the request. Currently all requests in Bmultisig are
using `token` that you set yourself and we will leave it at that.
There are several endpoints where signature will be required, that need
to provide signatures, we will describe them in this document.

## Wallet creation and joining.
### Wallet creation
Before creating wallet, author of the wallet will have to generate private key.
This private key will be used to sign joining request by other cosigners.

After generating `joinPrivateKey` for the wallet, author will
also create `joinPubKey` from the private key. Author will need to submit
`joinPubKey` and `joinSignature` (see below) to the server.

After wallet has been created author needs to share `joinPrivateKey` and
`walletName` with other cosigners.
  - Clients can decide how to format this data,
    e.g. `{ joinPrivKey: "...", "walletName": "..." }`
  - `token` and `joinPubKey` must be stored securely on client side.
  - `joinPubKey` can be used for verifying joining signatures of other
  - cosigners.

When creating wallet, following data is being passed to the server
(check `Wallet joining` for other options):
  - `id` - wallet name
  - `m`, `n` - multisig configurations
  - `witness` (default `true`)- if we want to derive P2WSH instead of P2SH.
  - `joinPubKey` - PubKey for JOIN request verification.
    joinPubKey must be generated separately, because private key is shared.
    Users are expected to store this information for verifying signatures.
  - joining data...

NOTE: Cosigner creating wallet automatically joins it.

### Wallet joining
When joining wallet, following data is being passed:

General cosigner information:
  - `cosignerName` - Cosigner name that will be displayed to other cosigners
  - `cosignerFingerPrint` - fingerprint of master key
  - `cosignerPurpose` - purpose of the derived accountKey.
  - `cosignerData` - This is arbitrary data storage for
    future proofing little bit, it allows data up to 100 bytes.
  - `accountKey` - XPUB of the users, this will be used for deriving addresses
    in conjuction to other cosigners XPUBs.
  - `accountKeyProof` - Proving that you own accountKey, is for validating
    xpubs, so you don't accidentally upload incorrect accountKey.
    - Data to sign: `walletName || cosignerName || authPubKey || accountKey`.
    - using private key at: `accountKey/MAX_NONHARDENED_INDEX/0`.

Used for authentication or verification:
  - `token` - token for authenticating HTTP requests(General authentication).
  - `authPubKey` - PubKey for authenticating proposal requests and actions.
    This can be derived from XPUB on client side, but server accepts plain
    compressed public key.
  - `joinSignature` - signature for proving that cosigner knows the secret.
    - Data to sign: `walletName || cosignerName || authPubKey || accountKey`
    - using joinPrivKey.

## Proposals
### Signatures by payload type
We don't want signatures to get reused, so we prepend one byte for payload type:
  - `0x00` - create proposal
  - `0x01` - reject proposal
So data to sign will be computed as `walletName || type || stringified json of proposal options`.

### Creating proposal
Proposal data:
  - `proposal` - This is proposal details (including client timestamp).
  - `signature` - signature of the proposal data signed using authPrivKey.
    `walletName || 0x00 || JSON.stringified(options)` in this version.

NOTE: there is no need to have Canonical JSON encoding, because original
proposal object will be stringified and stored as it is. It can be fetched
by other cosigners for verification.  
Signing will happen on HTTP request ready proposal object.

#### Getting proposal
Get proposal will include original `proposal` options, that were used
when creating the proposal. You can also use `tx` option to get
non-templated mtx with get proposal.

You may consider validating `MTX` - e.g. it is sane, outputs match,
 `rate` is applied properly.

### Approving proposal
This does not change, signatures are verified by the bmultisig
for the transaction.

### Rejecting proposal
  - `signature` - When rejecting proposal, cosigner has to provide signature
  of the `walletName || 0x01 || JSON.stringified(options)`, that is original proposal details
  signed using `authPubKey`.

## Verifying data
### Verifying `joinSignature`, `authPubKey`, `accountKey` and `cosignerName`

#### Joining wallet
First thing to verify, before joining, is `joinSignature`
and this must be done for all cosigners.

#### Everyone joined.
At this point, all cosigners must verify all signatures add up.  

#### Verification steps
For each cosigner:
  - fetch cosigner information
    - `cosignerName`
    - `authPubKey`
    - `accountKey`
    - `joinSignature`
  - use locally stored `joinPubKey`.
  - generate message hash(`cosignerName || authPubKey || accountKey`)  
    (Check `signing data` above.)
  - verify(`hash`, `joinSignature`, `joinPubKey`)

You can cache `cosignerName`, `authPubKey` and/or `accountKey`,
if you don't want to verify `authPubKey` everytime there's proposal or
rejection.

### Verifying `proposal signature` or `rejection signature`
For every new proposal or rejection, you must always verify proposal 
signature was created by one of the cosigners.

#### Verification steps
  - Verify `authPubKey` of the cosigner, if you have not cached it.
    (`authPubKey` verification above)
  - Get proposal information
    - `proposal` (options when requesting proposal, including client timestamp).
  - Verify timestamp is reasonable.
  - get `signature` from the action (rejection or creation)
  - hash(JSON.stringify(`proposal`))
  - verify(`hash`, `signature`, `cosigner.authPubKey`)

## Security Concerns and recommendations for clients.

**DISCLAIMER: This update does not mean server can not mess up wallet
or change some data (even keys and signatures), this
update tries to make most crucial parts verifiable. But
still requires some level of trust.**

### Issues
  Server operator can mess up wallet multiple ways, I will try to cover
endpoints related to signatures.

Endpoint `create wallet` & `join wallet`:
  - Any data that was not committed to the signature can be modified
  by the server operator. We may change what data do we commit in this
  endpoint. E.g. commit whole object and/or separate signatures to commit
  cosigner specific data separately, from general wallet information.

Endpoint `create proposal`:
  - Proposal option that are commited in the signature can be reused for
    other proposals (They can be exactly the same and still valid). This
    leads to an issue where server can replay that signature and create as many
    similar proposal as it wants. If cosigners are not careful they can
    be mislead into signing new MTX that they did not create.  
    Even though MTX may be spending different inputs, it will still go
    to same outputs.
    We have `timestamp` to limit ways how this can be exploited by server,
    author of the proposal will submit `timestamp` and clients will
    need to verify if `timestamp` is reasonable (depends on application context)

Endpoint `reject proposal`:
  - This will sign `pid` with the proposal options, so unless proposal
    is replaced using the same `pid`, it can't be reused and also this wont
    lead to situation where cosigners lose the money, whereas `create proposal`
    can potentially lead to that.

### TLS
TLS is not enforced by the bmultisig on HTTP, you can enable it on the
server or put server behind TLS reverse proxy. But production server
must always use TLS.

### Handling authPrivKey
`authPrivKey` as described above, can be stored on Hardware Device
and/or be one of XPUBs derivation paths (e.g. `XPUB/MAX_NONHARDENED_INDEX/1`)
or be totally independent from xpub.  
It should be stored securely depending on context and be only decrypted
for small time: proposal creation and proposal rejection.
It's recommended that you use different authPrivKey for different wallets.

### Handling token, joinPubKey
  - `token` is necessary for authenticating requests, so it's
  important you store it securely depending on context.
  - `joinPubKey` is necessary when you want to verify
  proposal signatures from other cosigners. You can
  do it once and cache other cosigners data, but it is
  advised to store joinPubKey as well.

### Caching other cosigners data
It can be really useful to cache other users `authPubKey`s.
You can do this after wallet is fully joined and all cosigners
have added their informations. This can help you avoid
unnecessary `authPubKey` checks using `joinPubKey` and their `joinSignature`s
all the time.

## Other updates
  - Getting proposal will accept `tx` option, to optionally return
  MTX with the proposal. (default=false)

