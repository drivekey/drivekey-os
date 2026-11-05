DriveKey native Electron smoke verification

This harness launches actual candidate source in development Electron. It verifies the --user-data-dir path before invoking wallet operations. It creates only fresh synthetic vaults and separate backups beneath a unique test directory. Native file dialogs are substituted inside the test process. It does not import RPC configuration, sign transactions or broadcast anything.

Coverage: real UI wallet creation, Windows encrypted backup verification, Ethereum/Solana receive QR decoding, exact-amount USDC QR decoding, all reachable screens, real native content resizing, 2x Electron page zoom, keyboard focus, session clearing/reopening, offline navigation and network/preparation API denials. Screenshots use Electron webContents.capturePage rather than a resized or cropped browser screenshot.

Clipboard checks compare only freshly written synthetic values. They diagnose both Electron writeText/ClipboardItem and independent Windows PowerShell Set-Clipboard/Get-Clipboard. A host clipboard failure is recorded as blocked capability, never successful clipboard integration. When the host is blocked, the app must report the fixed clipboard-unavailable error; a false success message fails the suite. Reports distinguish passed checks from allCapabilitiesVerified.

From this workspace: node work/ui-verification/native-smoke.cjs
From a delivered candidate: node tests/ui/native-smoke.cjs

Optional environment variables:
  DRIVEKEY_UI_CANDIDATE: absolute candidate root (main.cjs and ui/)
  DRIVEKEY_BUILD_MODULES: absolute dependency package root with node_modules
  DRIVEKEY_UI_OUTPUT: absolute report/screenshot directory
  DRIVEKEY_UI_RUNS: absolute parent for unique disposable test profiles
  DRIVEKEY_UI_WORKSPACE: workspace root when using the work/ harness

The candidate must have been built before execution. The dependency root must contain the pinned installed Playwright, jsQR and Electron packages. The test resolves Electron's already installed executable directly, avoiding the package loader's automatic download behavior.

Each run retains a JSON report under a unique run name and updates NATIVE-SMOKE.json. Source hashes are recorded before and after; changed source invalidates stable-run success. Any failed check returns a nonzero exit status. A checks-pass-with-external-clipboard-blocker result still reports allCapabilitiesVerified=false.
