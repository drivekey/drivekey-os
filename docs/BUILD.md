# DriveKey OS source

This repository includes the offline desktop, signer, shared protocol code,
companion, contracts, packaging assets and image build scripts. The hosted web
frontend and local deployment configuration are maintained separately.

## Languages

| Component | Language |
| --- | --- |
| Offline desktop, appearance and boot-clock helpers | Python |
| Offline signing, validation, companion and shared protocols | TypeScript |
| Live-image packaging and launchers | Shell |
| Agent-wallet contracts | Solidity |
| Windows volume watcher | C# |
| Build tooling | JavaScript |

GitHub computes its Languages panel from the checked-in source; compiled ISO
assets and dependency caches are not included in that calculation.

## Build the signer and companion

Use Node.js 22 or later and the pnpm version declared in package.json.

```sh
pnpm install --frozen-lockfile
pnpm build:tools
pnpm test
```

The output is written to `outputs/tools-v2/`. On Windows the build additionally
compiles `companion/VolumeWatcher.cs` with the .NET Framework compiler. On Linux
only the portable JavaScript bundles are produced.

The default test suite uses temporary, synthetic wallets and mocked state.
`rules-v4.test.ts` is a separate local-Anvil integration suite: first run
`pnpm build:contracts`, install the Anvil runtime, then invoke that file with
Vitest. `rules-presentation.test.ts` additionally requires a synthetic
`work/rc20-simple/browser-context.json` fixture; personal wallet data is not
distributed as a substitute. Both suites are excluded from the default command.

On a Linux host with Python 3 and Tk available:

```sh
python3 scripts/test-rtc-clock.py
python3 scripts/test-terminal-clock.py
```

## Image packaging

`packaging/` contains the Linux launchers, desktop and supporting assets.
`scripts/build-*.sh` contains the historical image-build chain. These scripts
require a Linux build host, root privileges, xorriso, squashfs-tools, and the
specific previous image and staged bundles named inside each script. They are
not a one-command, clean-room reproducible build: older base images and build
staging are not included in this source checkout. Read the script prerequisites
before running it; published ISO assets are available separately in Releases.

The current image step is `scripts/build-ui-rc20-warsaw-rtc-image.sh`. Its
hardware compatibility requirements are documented on the release page.

## Source provenance

`source-manifest.json` records SHA-256 hashes of files copied from the maintained
project at publication. Repository packaging files and documentation are added
for this source distribution. This is a current source snapshot, not a claim of
byte-for-byte reproducibility of the ISO. The release verification report records
the checks performed on the actual image.

Runtime vaults, passphrases, environment files, signing responses, machine-local
deployment settings and dependency caches are excluded. Test credentials in the
unit tests are synthetic fixtures. MIT and bundled third-party notices are
preserved; font licenses and provenance are included under `packaging/fonts/`.
