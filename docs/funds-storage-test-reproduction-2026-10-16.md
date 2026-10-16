# Host namespace storage test reproduction — 2026-10-16

This runner exercises the packaged lifecycle Node/workers with **host Linux `/usr` libraries**, not the complete guest. The existing test mock of `assertOfflineEnvironment` is unchanged; acceptance is limited to storage/lifecycle behavior. Production worker isolation is still invoked. No funds, public RPC or physical disks are involved.

Prerequisites: Debian-compatible Linux x86-64 with Python3, bubblewrap, util-linux `prlimit`, a root-capable isolated test host, and the complete corresponding source checkout plus its lockfile-resolved JavaScript dependencies (Vitest 3.2.7). The partial public source handoff is not a complete dependency-installable project. Do not infer otherwise or install a guessed baseline. The root-owned extracted image tree must already exist at `/opt/drivekey-interactive-images/interactive-20261016-r1792160000002/rootfs`, with matching build/contents manifests in the checkout's `outputs/security-interactive-images/interactive-20261016-r1792160000002`. The runner validates those manifests before and after execution; it neither creates nor repairs the image.

The Linux native optional packages below were missing from the Windows dependency installation. On a separate preparation step with network access, use a trusted host Node/npm installation to create the exact optional-dependency prefix. Do not execute these inside the test namespace:

```sh
mkdir -p /var/tmp/drivekey-wallet-vitest-native-20261016
npm install --prefix /var/tmp/drivekey-wallet-vitest-native-20261016 --ignore-scripts --save-exact --no-audit --no-fund @rollup/rollup-linux-x64-gnu@4.63.1 @esbuild/linux-x64@0.28.2
```

Require the generated `package-lock.json` to record these exact versions and integrity values before execution:

- `@rollup/rollup-linux-x64-gnu` 4.63.1: `sha512-gfI5T24WLLuFfSKw7Go/zDXjAAV0fny0swTaDv+WjK7vqcw4cRhFfdsyKL1n+ukI+ooBxn3bVQnyrn06WpI50w==`
- `@esbuild/linux-x64` 0.28.2: `sha512-4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==`

These are the observed npm lockfile integrity values, not an independent upstream authenticity audit. Preparation is not performed automatically by the runner. Both packages declare MIT in the observed lockfile. Preserve that lockfile and notices for review.

From the complete checkout, run:

```sh
sudo python3 -B scripts/run-interactive-multi-files-tests.py
```

The runner sets `NODE_PATH` and `ESBUILD_BINARY_PATH` only inside its network-isolated namespace, uses packaged `/opt/drivekey/node/bin/node`, and stores bounded evidence under `outputs/funds-multi-files-packaged-runtime-*`. Fixture outputs live in a temporary host directory and are removed on exit. Source, packaged runtime and host policy are rechecked. Do not disable swap or edit kernel policy to satisfy these tests; the test's existing environment mock means this run cannot establish the guest's environmental acceptance.

Final observed result: 4/4 tests passed in `outputs/funds-multi-files-packaged-runtime-1792163971702`. The old assertion incorrectly matched the ordinary word `passphrase` in public guidance; it now recursively rejects sensitive property names and exact fixture passphrase values. Production files remained unchanged. Descendant production bubblewrap processes were observed; the short-lived `prlimit` exec was not captured by 20ms polling. Its invocation is evidenced by the unchanged production spawning code, not syscall tracing. See `outputs/funds-storage-acceptance-20261016.json` for exact hashes, old failures, process observations and namespace bindings.
