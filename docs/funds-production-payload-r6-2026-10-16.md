# Combined offline production payload r6

This is an application payload, not an accepted OS image or funds-ready release. It combines the separate ETH/WETH parser/key workers and desktop flow, exact LI.FI gas review fields, bounded startup diagnostics, and background-refresh/exit-dialog scheduling fixes.

The production bootstrap recorded and then independently recomputed its lock during the workspace build. It produced 35 workers and 114 artifacts from 796 source inputs. Compared with r5, only the desktop and GUI worker artifacts changed, with two WETH workers added. No source was removed; no consumed dependency file or compiler identity changed. This does not provide new upstream authentication or independent security review.

- Lock: `outputs/production-payload-lock-20261016-r6.json`, SHA-256 `6be7bf25d035369ff173bf645f19bd46d99aa114603c3c8ed5a61826b839d2aa`.
- Payload directory: `outputs/production-payload-20261016-r6`.
- Delta: `outputs/production-payload-r6-delta-20261016.json`.
- Source kit: `outputs/drivekey-production-source-kit-20261016-r6.zip`, 2,046,283 bytes, 250 members, SHA-256 `cffd6dc8b3e4df34aefb30604aab21929e0f61671fe40c9c4813a61596bf3c28`.

Validation includes the scoped WETH source/internal review, 73 LI.FI protocol/offline/signing cases and 21 actual desktop-method cases. The local WETH EVM result uses synthetic balances and source key-core execution; it does not establish guest confinement or public settlement. New online durable submission/recovery modules are separate from the offline payload and are not implied by its build success.

The source kit was packaged from the exact lock. A read-only archive consistency check verified all 250 members, including 249 manifest-declared entries, with no unexpected, duplicate, traversal or symbolic-link members (`outputs/funds-production-r6-kit-check-20261016.json`). A fresh extracted-kit rebuild has not been performed for r6. The earlier automated approval-review rejection of an extracted-kit rebuild remains an explicit limitation; this workspace build and packaging do not substitute for that verification.

Next acceptance must use a separately identified image assembled from this payload and the current signed-package base. In particular, the older r4 no-serial shutdown failure remains a failure until the new artifact passes. Neither older wallet/transaction screenshots nor an owner report about an earlier image transfers to r6. No funded gate was enabled.
