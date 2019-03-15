v2.0.0-beta - Signing and Verification
=======

## General information and definitions.

### Signing data
Signatures will be generated from data using similar to
what `signmessage` RPC call does and will return signature with same encoding.
This way it will be compatible to ore APIs as well as hardware signing.
We will be refering to this method when talking about signing.
`bmultisig-client` will include additional utilities for handling
signatures and others.
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
Before creating wallet, author of the wallet
will first generate private key, public key and choose a name
for a wallet. PrivateKey + WalletName will be shared
to other cosigners to join the wallet.
  - Clients can decide how to format this data,
    e.g. `{ joinPrivKey: "...", "walletName": "..." }`
  - `token` and `joinPubKey` must be stored securely on
    client side, `joinPubKey` will be used for verification.

When creating wallet, following data is being passed to the server
(check `Wallet joining` for other options):
  - `id` - wallet name
  - `m`, `n` - multisig configurations
  - `witness` - if we want to derive P2WSH instead of P2SH.
  - `joinPubKey` - PubKey for JOIN request verification.
    joinPubKey must be generated separately, because private key is shared.
    Users are expected to store this information for verifying signatures.
  - joining data...

NOTE: Cosigner creating wallet automatically joins it.

### Wallet joining
When joining wallet, following data is being passed:

General cosigner information:
  - `cosignerName` - Cosigner name that will be displayed to other cosigners
  - `cosignerPath` - This will store information related to derivation path:
    - `masterFingerPrint` - fingerprint of master key
    - `purpose` - purpose of the derived XPUB.
  - `cosignerData` - This is arbitrary data storage for
    future proofing little bit, it allows data up to 100 bytes.
  - `accountKey` - XPUB of the users, this will be used for deriving addresses
    in conjuction to other cosigners XPUBs.
  - `accountKeyProof` - Proving that you own accountKey, is for validating
    xpubs, so you don't accidentally upload incorrect XPUB.
    Derivation used for signing is: `XPUB/MAX_NONHARDENED_INDEX/0`.
    - Data to sign: `cosignerName || authPubKey || accountKey`.

Used for authentication or verification:
  - `token` - token for authenticating HTTP requests(General authentication).
  - `authPubKey` - PubKey for authenticating proposal requests and actions.
    This can be derived from XPUB on client side, but server accepts any
    public key.
  - `joinSignature` - signature for proving that cosigner knows the secret.
  Following data will be used for generating the `hash256`:
    - Data to sign: `cosignerName || authPubKey || accountKey`

## Proposals
### Creating proposal
Proposal data:
  - `proposal` - This is proposal details.
  - `signature` - signature of the proposal data signed using authPubKey.
    JSON.stringified in this version.

NOTE: there is no need to have Canonical JSON encoding, because original
proposal object will be stringified and stored as it is. It can be fetched
by other cosigners for verification.

You may consider validating `MTX` - e.g. it is sane, outputs match,
 `rate` is applied properly.

### Approving proposal
This does not change, signatures are verified by the bmultisig
for the transaction.

### Rejecting proposal
  - `signature` - When rejecting proposal, cosigner has to provide signature
  of the `proposal` object, that is original proposal details
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
    - `proposal` (options when requesting proposal).
  - get `signature` from the action (rejection or creation)
  - hash(JSON.stringify(`proposal`))
  - verify(`hash`, `signature`, `cosigner.authPubKey`)

## Security Concerns and recommendations for clients.

**DISCLAIMER: This update does not mean server can not mess up wallet
or change some data (even keys and signatures), this
update tries to make most crucial parts verifiable. But
still requires some level of trust.**

### TLS
TLS must be enforced for all `multisig` use cases.

### Handling authPrivKey
`authPrivKey` as described above, can be stored on Hardware Device
and/or be one of XPUBs derivation paths (e.g. `XPUB/MAX_NONHARDENED_INDEX/1`)
or be totally independent from xpub.  
It should be stored securely depending on context and be only decrypted
for small time: proposal creation and proposal rejection.

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

