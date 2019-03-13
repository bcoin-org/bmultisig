Events
======

Bmultisig from `1.1.0-beta` will have events related to bmultisig functionality.

List of events:
 - `join` - when someone joins the wallet.
 - `proposal created` - when someone in the wallet creates a proposal.
 - `proposal approved` - when proposal is approved partially or fully.
 - `proposal rejected` - when proposal is rejected either by other cosigner or
other reasons, such as double spend or final tx verification failure.

## Authorization
Admin clients can subscribe to any wallet and use admin token for that.
For normal wallet users you need to have `cosignerToken`.

## client example

```javascript
  const client = new MultisigClient({
    //...
  });

  client.on('connect', async () => {
    await client.join('walletID', cosignerToken);
    // ...
  });

  client.bind('join', (wid, cosigner) => {
    // ..
  });

  client.bind('proposal created', (wid, proposal) => {
    // ..
  });

  client.bind('proposal approved', (wid, details) => {
    const {proposal, cosigner} = details;
    // ..
  });

  client.bind('proposal rejected', (wid, details) => {
    const {proposal, cosigner} = details;
    // .. cosigner can be null.
  });

  await client.open();
```

```javascript
  // or wallet
  const wallet = client.wallet(wid, cosignerToken);

  await client.open()
  await wallet.open(); // this will subscribe to events.

  wallet.on('join', cosigner => {
   // ..
  });

```


# Event Reponses
## `join`
When someone joins a wallet, all subscribed users will get notified by the
`join` event and it will include the cosigner who joined.

```json
{
  "id": 0,
  "name": "cosignerName"
}
```

## `proposal created`
When someone creates a proposal.

```json
{
  "id": 0,
  "memo": "Some information",
  "tx": "raw transaction hex",
  "author": 1,
  "authorDetails": {
    "id": 1,
    "name": "cosignerName"
  },
  "approvals": [],
  "rejections": [],
  "cosignerApprovals": [],
  "cosignerRejections": [],
  "createdAt": 1548267365,
  "rejectedAt": null,
  "approvedAt": null,
  "m": 2,
  "n": 2,
  "statusCode": 0,
  "statusMessage": "Proposal is in progress."
}
```

## `proposal approved`
This event will be called when someone approves a proposal, whether it's
the first signature or last one (which will finalize).  

NOTE: `proposal.tx` will only be available when proposal is finalized.

 - `proposal` - proposal that was approved. (or partially approved)
 - `cosigner` - cosigner that approved proposal.

```json
{
  "proposal": {
    "id": 1,
    "memo": "Proposal memo",
    "tx": null,
    "author": 0,
    "authorDetails": {
      "id": 0,
      "name": "cosigner1"
    },
    "approvals": [
      0
    ],
    "rejections": [],
    "cosignerApprovals": [
      {
        "id": 0,
        "name": "cosigner1"
      }
    ],
    "cosignerRejections": [],
    "createdAt": 1548267680,
    "rejectedAt": null,
    "approvedAt": null,
    "m": 2,
    "n": 2,
    "statusCode": 0,
    "statusMessage": "Proposal is in progress."
  },
  "cosigner": {
    "id": 0,
    "name": "cosigner1"
  }
}
```

## `proposal rejected`
This event can be emitted for multiple reasons:
 - Other cosigner rejected proposal. (Can be partial)
 - Transaction in proposal was double spent.
 - After final approval transaction was incorrect. (verification failure)

Returns:
  - `proposal` - proposal that was rejected. (or partially rejected)
  - `cosigner` - cosigner that rejected transaction (if any) - can be null.

```json
{
  "proposal": {
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
    "createdAt": 1548268334,
    "rejectedAt": 1548268334,
    "approvedAt": null,
    "m": 2,
    "n": 2,
    "statusCode": 2,
    "statusMessage": "Cosigners rejected the proposal."
  },
  "cosigner": {
    "id": 0,
    "name": "cosigner1"
  }
}
```

