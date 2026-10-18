# Offline fee and identity review continuation

The current source now includes separate gas limit, maximum fee per gas (wei),
and maximum priority fee per gas (wei) fields in Ethereum native/token payment,
allowance and Uniswap review output. Robinhood ERC-20 review also exposes these
fields and the request-bound token code hash for both generic v3 and pinned-proxy
v6 requests. The existing total maximum network fee remains displayed.

These fields are derived after request validation from the exact unsigned
transaction bytes; they do not change request formats, approval fingerprints,
accepted code pins or signing/release policy. A supplied token code hash is not
proof of token legitimacy. Existing metadata and upgrade warnings remain.

The desktop review iterates all returned fields. Broker checks exercise native
ETH, Ethereum WETH/USDC payment/allowance/swaps and multichain requests to verify
that the fields survive routing and parser/key-worker boundaries. These checks
use synthetic IPC/media shims, not OS isolation or public-chain execution.

Validation: 73 protocol/identity tests and 87 broker tests pass. The four initial
new negative assertions failed because ethers refused to serialize their invalid
priority fee before reaching the review function. The corrected negative cases
serialize an excessive gas limit and verify that the review itself rejects it.
Both initial and final test reports are retained in outputs.

This is source-only progress. Neither published image r1792160000002 nor the
separately frozen fresh-OS r1792170000004 contains these changes. Updated source
closure, rebuilt workers, new image hashes, rendered review checks and exact-image
transaction acceptance are required before crediting the change to a release.
No funding gate was enabled and no transaction was broadcast.
