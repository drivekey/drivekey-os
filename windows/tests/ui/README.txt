DriveKey renderer verification — reproducible fixture suite

Run from the candidate root after installing the pinned development dependencies:
  node tests/ui/renderer-suite.cjs --list
  node tests/ui/renderer-suite.cjs
  node tests/ui/renderer-suite.cjs --filter 19e

Playwright Chromium must already be available. No dependency or browser download is initiated by this test. Dependencies resolve from this candidate's package.json/node_modules; there is no path to the original workspace or preserved baseline.

Outputs default to verification/ui. Set DRIVEKEY_UI_TEST_OUTPUT (or DRIVEKEY_TEST_OUTPUT) to a chosen output directory. A unique run scratch directory under work/ui-tests holds browser temporary files/downloads; its resolved path is checked to remain within this candidate. The harness never opens the installed DriveKey app or its existing profile.

The actual local HTML, CSS, shell.js and routes.js load through a loopback-only static server. An explicit finite synthetic window.drivekey fixture is installed before page scripts. External browser requests are rejected. No main process, RPC provider, wallet key, signing worker, blockchain signature or broadcast is involved. Password-like test values are fixture-only strings and are redacted in call traces.

Screenshots have a SYNTHETIC UI FIXTURE banner. A green fixture report establishes renderer behavior under those modeled responses, not native IPC validation, real DPAPI storage, live provider settlement, hardware isolation or complete accessibility certification. Native source-Electron and packaged-build checks are separate required evidence.

The suite includes all 24 planned screen groups and 74 named cases. It verifies failures/cancellations, stale-result discards, exact decimal conversion, typed route selection, private quote-versus-proof copy, activity state-dependent actions, existing-intent resume, expired signed request reconciliation, public-wallet restrictions, backup gates, signature export cancellation, keyboard focus, compact layout and missing decoration behavior.

RENDERER-FIXTURE-REPORT.json records passed/failed cases, coverage, synthetic API call traces, computed visual measurements and before/after hashes of the four renderer source files. Any source change during a run makes passed=false. --filter explicitly reports selectedSuiteOnly and missingScreenGroups, so a subset cannot stand in for complete coverage.

Visual measurements report overflow, image decode failures, unnamed controls and computed contrast estimates. Gradients/translucency still require screenshot inspection. The deliberate missing-decoration test is expected to report its intercepted image as absent while the controls remain functional.

The original full run in the task workspace passed 74/74 with all 24 screen groups and stable source hashes. This packaged copy has syntax/list verification only until invoked from this candidate; do not claim a fresh native or packaged run based on that historical renderer result.

Final renderer coverage includes actual sampled gradient/glass backing contrast at three visible viewports, explicit modal Tab/Shift+Tab trapping and close focus restoration, compact menu keyboard behavior, a keyboard-only receive-request journey, minimum critical text15px, file-card metadata, named storage/backup/gas/quote/expiry states, and request creation time. These remain synthetic renderer tests.
