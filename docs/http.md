Multisig HTTP
=============

Multisig HTTP Server adds some API methods and disables several existing ones.

#### Authentication Configs
It's recommended, that you setup `API_KEY` for HTTP in general and turn on `walletAuth`.
This will make sure no route can be called without authentication.

#### API_KEY
You will still need to set `API_KEY` for http server, which is same as Node HTTP or Wallet HTTP in
bcoin.

### Authentication
Multisig wallet uses cosigner `token`s to authenticate cosigners, that are configured by cosigners
when joining. (*NOTE: Admin token wont be able to access cosigner APIs. So don't use admin token
as cosigner token.*)  
There are some routes that do not require authentication or only admin `token` can query.

Some endpoints need signatures and public keys, you can check recent updates: [signing](signing.md)
This document will also include some steps to reproduce signatures.

Some examples:
  * PUT /multisig/:id* - used for wallet creation does not need any authentication (you should use
  `API_KEY` to control access to the API itself).
  * GET /multisig/:id/proposal/ - can be requested using cosigner token.
  * GET /multisig* and *DEL /multisig/:id* can be requested only with admin `token`.
  * POST /multisig/join* - will check `joinSignature`.
  * POST /multisig/:id/proposal - needs `signature` (using `authPubKey`).


### Additional API Endpoints
#### GET /multisig (Admin Only)
This will return list of the available multisig wallets
```js
await client.getWallets(); // returns [ 'mswallet1', 'mswallet2' ]
```
HTTP Response
```
{ wallets: [ 'mswallet1', 'mswallet2' ]
```

#### PUT /multisig/:id
Create multisig wallet

Params:
```js
// id -- wallet name
{ // Create 2-of-3 multisig wallet
  n: 3, // Total number of cosigners
  m: 2, // Number of signatures required to sign transaction
  witness: true, // if witness is enabled for this wallet [default=true]
  //  Xpub of the wallet creator
  xpub: 'rpubKBAFN1UW89HZFE3uvd4L5MyxCJwLC2RsYMFPFGmaKwGnXMVfNCCijt5gej8FTsMmwGV46Jq8kz6F7...'
  cosignerName: 'cosigner1', // Name of the cosigner
  cosignerPath: 'm/44\'/3\'/0\'' // Extra data, if you want to store your XPUB path on the server
}
```

```js
await client.createWallet('name-of-wallet', { ...options });
```

HTTP Response:
```js
{
  network: 'regtest', // Network of the wallet (e.g. 'main')
  wid: 1, // Wallet id
  m: 2,
  n: 3,
  initialized: false, // returns true if all cosigners joined
  // joinKey must be shared with other cosigners, this will be used when joining wallet.
  joinKey: '7aaba14912923138d3b6031b6dcf27d73b99c62c215d536f1d23bf3d54f36ae6',
  balance: null, // number when initialized
  cosigners: // list of joined cosigners
   [ { id: 0, // id of the cosigner
       name: 'cosigner1', // name
       path: '', // path
       tokenDepth: 0, // generated tokens
       // This token will be used as cosigner `token`.
       token: '508d6486aef2ea2c63f1ecbe5f56697ed157eb4b95b1b8b2a80db1443b94d19a' } ],
  account: null // Account is only included when you request getWallet
}
```

#### POST /multisig/:id/join
Join the wallet, you will need `joinKey` from the wallet creator.

Params:
```js
// id - wallet name
{
  cosignerName: 'cosigner2', // see wallet creation
  cosignerPath: 'm/44'/3'/0',
  joinKey: '7aaba14912923138d3b6031b6dcf27d73b99c62c215d536f1d23bf3d54f36ae6',
  // xpub of the cosigner
  xpub: 'rpubKBApV5icPgVjYtNVpTnn5eTCsDUmQCc6uSGEbzPZmV852k5nbuk4KcgLfeZMFUDjMdXwH4c26rNhwjwz3...'
}
```

```js
await client.joinWallet('name-of-wallet', { ...options });
```

HTTP Response
```js
{ network: 'regtest',
  wid: 1,
  id: 'name-of-wallet',
  m: 2,
  n: 2,
  initialized: true,
  joinKey: null,
  balance: null,
  cosigners:
   [ { id: 0, name: 'cosigner1' }, // You only receive id and name of other cosigners.
     { id: 1,
       name: 'cosigner2',
       path: '',
       tokenDepth: 0,
       // This token will be used as cosigner `token`.
       token: 'b52a42944c67a29a194bda60efaf781e2f723b51ada7694c4f614025002ddc66' } ],
  account: null }
```

#### GET /multisig/:id/name-of-wallet
Get the wallet info. *Cosigner authentication*.

Query Params:
```js
{
  details: true // If we want account details e.g. address
}
```

```js
await client.getInfo('name-of-wallet', true);
```

HTTP Response:
```js
{ network: 'regtest',
  wid: 1,
  id: 'name-of-wallet',
  m: 2,
  n: 2,
  initialized: true,
  joinKey: null,
  balance: { tx: 0, coin: 0, unconfirmed: 0, confirmed: 0 },
  cosigners: [ { id: 0, name: 'cosigner1' }, { id: 1, name: 'cosigner2' } ],
  account:
   { initialized: true,
     watchOnly: true,
     witness: true,
     receiveDepth: 1,
     changeDepth: 1,
     nestedDepth: 1,
     lookahead: 10,
     receiveAddress: 'rb1qx6453vk949uu9ffzwym9q6phxmtuvr4d50tgrynur0fc62hft8esqtzqr9',
     changeAddress: 'rb1q4skzgvd2k84y3vxawwjp0kse4pgsfkuq7uvhcvvhhtu2hdrfwypqkd3v7e',
     nestedAddress: 'GceX7YpsubJbspvHuEzUzGKPDa6GkKvVCv',
     // xpubs of cosigners (sorted).
     keys: [
       'rpubKBBZkjs33CCjSgy6ZskpSvauKDZ84r7TZp2LJfnU8EZUxjBMMEbbLqUjPznajCssDd9yN1Tnz8G2VfZFn8n...'
       'rpubKBAUjQ5j6FNZveAkDdHeuq8cKxpehKTVyGZrNGNyXCpGL7pwfjSSHsUEQY1NEDrvrBzMGP4yaHdgLhHXZDi...'
     ],
     balance: { tx: 0, coin: 0, unconfirmed: 0, confirmed: 0 } } }
```

#### DELETE /multisig/:id/name-of-wallet
Delete wallet. *Admin Only*

```js
await client.removeWallet('name-of-wallet'); // true/false
```

```js
{
  success: true
}
```

#### POST /multisig/:id/create
Create transaction without signing and locking coins.

See TXOptioins in bcoin docs.

```js
await client.createTX(id, options)
```

#### POST /multisig/:id/retoken
This will generate new token for the cosigner and invalidate previous cosigner token.
*Cosigner authentication.*

```
await client.retoken(id);
```

#### GET /multisig/:id/proposal
List existing proposals. *Cosigner authentication.*

Query Params:
```
{
  pending: true // when true, this will only list pending proposals [default=true]
}
```

```js
await client.getProposals(id, true);
```

HTTP Response:
```json
{
  "proposals": [
  {
    "id": 0,
    "memo": "proposal1",
    "tx": null,
    "author": 1,
    "authorDetails": {
      "id": 1,
      "name": "cosigner2"
    },
    "approvals": [],
    "rejections": [],
    "cosignerApprovals": [],
    "cosignerRejections": [],
    "createdAt": 1548414212,
    "rejectedAt": null,
    "approvedAt": null,
    "m": 2,
    "n": 2,
    "statusCode": 0,
    "statusMessage": "Proposal is in progress."
  }]
}
```

#### PUT /:id/proposal/:name
Create proposal. *Cosigner authentication.*
After creating proposal, you still need to approve it.  
This will lock coins, so these coins won't be used for
create TX or another proposal creation.

Params:
```js
// id - name of the wallet
// name -  name of the proposal
{
  ...TXOptions // see create transaction
}
```

```js
await client.createProposal(id, txoptions);
```

HTTP Response:
```json
{
  "id": 0,
  "memo": "proposal1",
  "tx": "0100000000010169143a6c8d1544eae5e9eec4a3662118d4dd29b3fa28b95a8b84e14c08658e8600000000...",
  "author": 1,
  "authorDetails": {
    "id": 1,
    "name": "cosigner2"
  },
  "approvals": [],
  "rejections": [],
  "cosignerApprovals": [],
  "cosignerRejections": [],
  "createdAt": 1548414389,
  "rejectedAt": null,
  "approvedAt": null,
  "m": 2,
  "n": 2,
  "statusCode": 0,
  "statusMessage": "Proposal is in progress."
}
```


#### GET /multisig/:id/proposal/:pid
Get proposal by proposal id. *Cosigner authentication.*

```js
await client.getProposalInfo(id, pid);
```

HTTP Response:
```json
{
  "id": 0,
  "memo": "proposal1",
  "tx": null,
  "author": 1,
  "authorDetails": {
    "id": 1,
    "name": "cosigner2"
  },
  "approvals": [],
  "rejections": [],
  "cosignerApprovals": [],
  "cosignerRejections": [],
  "createdAt": 1548414389,
  "rejectedAt": null,
  "approvedAt": null,
  "m": 2,
  "n": 2,
  "statusCode": 0,
  "statusMessage": "Proposal is in progress."
}
```

#### GET /multisig/:id/proposal/:name/tx
Get transaction details of the proposal. *Cosigner authentication.*

Query Params:
```js
{
  path: true, // return paths used for each input
  scripts: true // return pubScripts
}
```

```js
await client.getProposalMTX(id, name, options);
```

HTTP Response:
```js
{
  tx: {
   hash: '0b26d5b1a3c8192ec6d069f5a5ebf25f2ed2751422da3c5f4117c421e763cdc3',
    witnessHash: '71915e434f807f2673e35ccbb8fd4e77ea5180d34b5a18697409b4456398d604',
    fee: 3660,
    rate: 34857,
    mtime: 1523045899,
    version: 1,
    inputs: [{
      prevout: {
        hash: '869552fa81c42bd68ae47359d90ff5dab8b4c39fe234283ee6915347ee4327fd',
        index: 0
      },
      script: '',
      witness: '04000000475221024be129059a32141c9257ce43ef5ac149af3953466ce846f0d1c2912b1e388...',
      sequence: 4294967295,
      coin: {
        version: 1,
        height: 1,
        value: 100000000,
        script: '0020ef4c21ffa707ab0018183f5b403de82f60d63391fd3d03e8a3cae1410ff86c18',
        address: 'rb1qaaxzrla8q74sqxqc8ad5q00g9asdvvu3l57s869rets5zrlcdsvqexnwp4',
        coinbase: false
      }
    }],
    outputs: [{
      value: 99996340,
      script: '76a914bd8e6080878cb4dbe663069f3ddab04cd951d06e88ac',
       address: 'RSZUMJAN76rgZZf3b6i4ZY5x765T72ee8d'
    }],
    locktime: 0,
    hex: '010000000001014f632c2f4f8086e6a63c661f257496c3b8fb9ad056fa8b6729591ed5aa94d15800000...'
  },
  paths: [{
    branch: 0,
    index: 2,
    receive: true,
    change: false,
    nested: false
  }],
  scripts: [ '522102686baa579ed2c7bb0f8e77e7df27995fb92a3b4272cd1e9dcf27c98e724036d62103fd4394...' ]
}
```

#### POST /:id/proposal/:name/approve
Approve with signed transaction. *Cosigner authentication.*

*Note: This won't check for signatures until all cosigners sign.*
*In future update, this will only accept signatures and verify it before accepting.*

Params:
```js
{
  tx: 'hex.' // signed raw transaction
  broadcast: false // Do we want to broadcast transaction(if our approval was last once)
}
```

```js
await client.approveProposal(id, name, rawtx);
```

HTTP Response:
```json
{
  "broadcasted": false,
  "proposal": {
    "id": 1,
    "memo": "proposal2",
    "tx": null,
    "author": 0,
    "approvals": [
      0
    ],
    "rejections": [],
    "createdAt": 1548414501,
    "rejectedAt": null,
    "approvedAt": null,
    "m": 2,
    "n": 2,
    "statusCode": 0,
    "statusMessage": "Proposal is in progress."
  }
}
```

#### POST /:id/proposal/:name/reject
Reject proposal. *Cosigner authentication.*

When there are sufficient rejections (Not enough cosigners left to sign transaction)
proposal will get rejected and locked coins will be released.

```js
await client.rejectProposal(id, name);
```

HTTP Response
```json
{
  "id": 0,
  "memo": "proposal1",
  "tx": null,
  "author": 1,
  "authorDetails": {
    "id": 1,
    "name": "cosigner2"
  },
  "approvals": [],
  "rejections": [
    0
  ],
  "cosignerApprovals": [],
  "cosignerRejections": [
    {
      "id": 0,
      "name": "cosigner1"
    }
  ],
  "createdAt": 1548414604,
  "rejectedAt": 1548414604,
  "approvedAt": null,
  "m": 2,
  "n": 2,
  "statusCode": 2,
  "statusMessage": "Cosigners rejected the proposal."
}
```

