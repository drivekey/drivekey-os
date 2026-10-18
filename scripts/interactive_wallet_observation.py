"""External observer semantics; this module never enters the guest image."""
def section_idle(state):
    # The real guest telemetry already combines not-busy, section mode and
    # closed settings. False can mean a successful result screen OR busy.
    return state.get('idle') is True

def observe_operation(seconds, name, sleep, capture):
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not 1 <= seconds <= 30:
        raise ValueError('Bounded operation observation requires 1..30 seconds')
    sleep(seconds)
    capture(name)
    return {'kind':'operation-screenshot-only','requiresVisualReview':True,'completionInferred':False}
