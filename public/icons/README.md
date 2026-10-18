# DriveKey icon assets

34 Lucide interface SVGs and eight cryptocurrency SVGs, downloaded for the r21 icon refresh. These are bundled files: the browser and offline desktop never contact an icon CDN.

- Lucide 0.468.0: https://github.com/lucide-icons/lucide/tree/0.468.0/icons — ISC and Feather-derived MIT terms, retained in `lucide/LICENSE`.
- Cryptocurrency Icons: https://github.com/spothq/cryptocurrency-icons — CC0, retained in `crypto/LICENSE.md`.
- Exact source URLs, cryptocurrency repository revision and SHA-256 hashes: `PROVENANCE.json`.

## Meaning and usage

Home uses a house; offline vaults use a safe; incoming transaction requests use an inbox; signing uses a document and pen; files use a folder; system settings use sliders. Send and Receive use opposing diagonal arrows. A payment request uses a QR symbol, keeping it distinct from receiving funds. Swap uses opposing horizontal arrows, while transaction history uses a clock/history symbol. The balance action uses a wallet offline and refresh arrows online. Eye and crossed-out eye reflect visible and hidden balances.

Use 24px optical boxes, a 1.75px stroke, and consistent button padding. Keep a visible text label or an accessible name and keyboard tooltip on every icon-only action. Asset marks preserve their original proportions and colours; they identify assets, not support or approval. ETH and wrapped ETH share Ethereum artwork but retain distinct text labels. Robinhood native ETH also uses the ETH mark; its network remains explicitly labelled.

Website action components use the already installed matching Lucide React version. Cryptocurrency images are loaded from `/icons/crypto/`. Unknown symbols receive a generic coin icon rather than another asset's logo.

Run `node scripts/build-ui-icons.cjs` to generate the high-resolution PNGs used by Tk. SVG processing happens at build time only; the desktop opens only its local bundled PNGs.
