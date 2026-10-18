# Diagnostic and revocation payload r7

The workspace build recomputed and matched `outputs/production-payload-lock-20261016-r7.json`, SHA-256 `336dba790555975ff9de6d57e437b4ccc70cab13b7d0e0cb9a1e9bc25755196a`. It contains 35 workers and 114 artifacts from 796 inputs. The only source differences from r6 are `core/trade-protocol.ts` and `packaging/drivekey-desktop.py`.

The desktop exposes a fixed, bounded launch-failure category without displaying arbitrary worker text. The trade protocol permits zero only for a version-7 approval to the existing pinned router, with an explicit revocation review. Zero payments, swaps and legacy approvals remain unsupported. Eight artifacts changed because several worker bundles consume the shared protocol; the full list is recorded in `outputs/production-payload-r7-delta-20261016.json`.

The corresponding online receipt verifier and preparation/recovery paths are separate source modules. They are not included merely by building the offline payload. Scoped source evidence includes 101 revocation/protocol tests, 22 desktop-method tests, and a fresh 113-case Husher/native-ETH isolation and signing regression (`outputs/funds-r7-shared-protocol-regression-20261016.json`). Internal reviewers found no scoped blocker. These tests do not establish guest or independent security acceptance.

Source kit: `outputs/drivekey-production-source-kit-20261016-r7.zip`, 250 members, 2,046,624 bytes, SHA-256 `304ff98d4f26dee49c109ef21ccb26d9e475de92dc55ed9ff6e6300369427d3d`. This is an application source kit, not a complete OS bootstrap or authenticated release. No fresh extracted-kit rebuild is claimed.

The r6 image passed BIOS boot, Settings and clean shutdown but showed isolation failures before and after a successful dashboard check. That recurring failure is not resolved by this source build. A separately identified r7 image uses the same r9 base so its bounded diagnostic can help identify the cause. Wallet lifecycle and actual guest signing acceptance remain pending; no prior-image result transfers automatically. No release gate or timeout was weakened, and funds readiness remains false.
