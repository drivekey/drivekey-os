# LI.FI continuation: review fields and cross-chain acceptance

The current version-9 signer supports only the pinned Ethereum native ETH to USDC Sushi call. Comparison quotes for other pairs are not executable approvals. No cross-chain completion is claimed.

The offline review now exposes gas limit, maximum fee per gas in wei and maximum priority fee per gas in wei directly from the validated unsigned transaction. These accompany the existing aggregate gas ceiling, provider fee, amount, minimum output, recipient, router, identity digest and expiry warning. The signed format, fingerprints and accepted pins are unchanged. The generic desktop review renderer consumes these fields; exact-image visual acceptance remains outstanding.

Validation: 73 native protocol, offline and isolated-signing tests passed in `outputs/funds-lifi-review-fields-20261016.json`. The new case verifies exact fee-cap display, preservation of the no-on-chain-deadline warning, and rejection before review of an excessive gas limit. This is source evidence, not new-image or public settlement acceptance.

Official LI.FI guidance distinguishes source confirmation, bridge transfer and any subsequent destination action. A route requiring another destination transaction needs a separate request and offline approval after the received amount is known; a source-chain receipt cannot prove that step completed. See [API execution guidance](https://help.li.fi/hc/en-us/articles/16509431041307-How-do-I-use-the-API-endpoints-and-interprete-the-responses).

The status API's `DONE` alone is insufficient: `COMPLETED`, `PARTIAL` and `REFUNDED` represent different outcomes. A partial route may deliver an intermediate asset rather than the requested output. Recovery must retain that distinction and correlate source/destination chain, transaction and asset evidence before crediting delivery. See [status and recovery guidance](https://help.li.fi/hc/en-us/articles/10980935994779-Can-a-transfer-result-in-stuck-or-lost-funds) and [intermediate tokens](https://help.li.fi/hc/en-us/articles/45779493502747-Intermediate-tokens-Why-do-I-received-different-asset).

Remaining implementation requires an explicitly supported bridge route with verified contract/deployment identities and decoded calldata, enforceable amount/recipient/minimum/deadline semantics, independent source and destination finality checks, and durable partial/refund recovery. Current v9 local expiry cannot revoke signed Ethereum bytes. It must not be relabeled as an on-chain deadline or generalized to arbitrary bridge calldata.
