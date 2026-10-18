import unittest
from interactive_wallet_observation import section_idle, observe_operation

class ObservationTests(unittest.TestCase):
    def test_result_and_busy_cannot_be_distinguished_by_false_idle(self):
        self.assertFalse(section_idle({'idle':False}))
        self.assertFalse(section_idle({'idle':False,'mode':'result'}))
        self.assertFalse(section_idle({'idle':False,'busy':True}))
    def test_only_explicit_section_idle_is_navigation_ready(self):
        self.assertTrue(section_idle({'idle':True}))
        self.assertFalse(section_idle({}))
        self.assertFalse(section_idle({'idle':1}))
    def test_operation_capture_never_waits_for_section_or_claims_success(self):
        events=[]
        result=observe_operation(2,'result',lambda seconds:events.append(('wait',seconds)),lambda name:events.append(('capture',name)))
        self.assertEqual(events,[('wait',2),('capture','result')])
        self.assertTrue(result['requiresVisualReview'])
        self.assertFalse(result['completionInferred'])
        self.assertNotIn('success',result)
    def test_observation_budget_is_bounded(self):
        for seconds in [0,31,True,'2']:
            with self.assertRaises(ValueError):observe_operation(seconds,'result',lambda _:None,lambda _:None)

if __name__=='__main__':unittest.main()
