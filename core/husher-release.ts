import {liveExecutionEnabled} from './live-release-policy';
// Provider order creation and deposit submission require funded release approval.
export const HUSHER_STANDARD_ACCEPTED=liveExecutionEnabled('husher');
export const HUSHER_PRIVATE_ACCEPTED=false;
