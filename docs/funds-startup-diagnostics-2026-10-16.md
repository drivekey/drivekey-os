# Startup diagnostics and dashboard status

The fresh r4 BIOS campaign reached the desktop and passed its navigation,
Settings and shutdown assertions. Visual review found an initial generic worker
error, followed by successful dashboard checks. This remains an unresolved
initial dashboard failure: a successful later check does not explain it.

The candidate broker previously discarded all launch-check exception details.
The launch check has a fixed 15-second timeout. A timeout while hashing the
larger fresh runtime is a hypothesis, not a measured cause.

The new source helper reports only a fixed failure class (timeout, bounded-output
limit, missing executable, or other rejection), elapsed milliseconds and timeout.
It retains the exact policy executable, arguments, environment allowlist, output
bound and timeout. It never returns child output, exception text or command data.
The broker still checks core-dump policy and launch integrity before reading any
command input; failure returns a public diagnostic with `inputRead:false` and
leaves all readiness flags false. No check is skipped or cached.

Desktop status handling now requires a successful, nonempty dashboard object
before marking the inventory guard checked. A failed background refresh does not
replace a transaction/write warning. The dashboard's own failure message can be
replaced by a later successful inventory result without clearing unrelated
operation warnings. This fixes status presentation, not the initial worker error.

Seven launch-classification checks and eighteen actual desktop-method state tests
pass. Child invocation is a test double for classification; these tests do not
establish on-image timing, OS isolation or the cause of the r4 failure.
New worker and desktop bytes require a newly bound application payload/image and
fresh boot/visual acceptance. Existing published and r4/r5 artifacts are unchanged.
# Background inspection scheduling follow-up

The r6 BIOS observation reached the desktop with a failed initial status check and usable controls. The worker's structured launch diagnostic was present only in its JSON response; the desktop generic status message did not expose its class. A later source change now displays only fixed labels for timeout, output limit, missing checker or rejection, and only when the diagnostic explicitly identifies the launch policy, failed result and unread command input. Arbitrary diagnostic/error text is not displayed. Recovery can replace this status with a successful check while unrelated transaction warnings remain preserved. All 22 desktop-method tests pass. This change is outside the frozen r6 image; no cause is inferred from its generic failure message.

The r4 no-serial campaign observed a checked desktop but repeated shutdown clicks did not open confirmation. Source inspection found that automatic dashboard calls share the worker busy state and disable controls; the old five-second schedule could repeatedly occupy the UI during slow checks. This is a plausible cause, not a proven image diagnosis.

After any active worker result, the desktop now defers automatic refresh for at least 30 monotonic seconds. Explicit user operations retain their launch checks and busy-state protections; no security result is cached as authorization. Shutdown and terminal-recovery confirmation dialogs also suppress background refresh and reentrant exit dialogs while Tk runs its nested event loop. A finally block releases this guard on cancellation or dialog errors. The 21 actual-method callback tests pass, including cooldown, resumed refresh, busy refusal, cancellation and dialog failure. These changes require a new image and screenshot-bound shutdown acceptance; the r4 result is not upgraded by these source tests.

