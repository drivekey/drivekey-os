"""Public-only candidate UI state. No filesystem, network or secret storage.

The broker/key worker reconstruct the cryptographic review; this state manages
fresh operator confirmation, asynchronous replies and bounded display data.
"""
import copy
import datetime as dt
import json
import re
import time


class SavingsActionState:
    def __init__(self):
        self.generation = 0
        self.clear()

    def clear(self):
        self.generation += 1
        self.review = None
        self._accepted_snapshot = None
        self.identity_checked = False
        self.approved = False

    def begin(self):
        self.clear()
        return self.generation

    @staticmethod
    def validated(reply):
        if not isinstance(reply, dict) or reply.get('ok') is not True or reply.get('identitySource') != 'untrusted-media; independent comparison required':
            raise ValueError('Savings review unavailable. No identity was verified.')
        r = reply.get('review')
        keys = {'kind', 'version', 'fingerprint', 'expectationFingerprint', 'signer', 'purpose', 'rows', 'actionId', 'authorizationDigest', 'requiredApprovals', 'timing', 'expectationProvenance', 'chainAuthenticated', 'receiptVerified', 'finalityVerified', 'fundingReady', 'productionReady', 'signingEnabled', 'warning'}
        if not isinstance(r, dict) or set(r) != keys or r.get('kind') != 'drivekey-savings-action-review' or type(r.get('version')) is not int or r['version'] != 1:
            raise ValueError('Unexpected savings review format.')
        for key in ('chainAuthenticated', 'receiptVerified', 'finalityVerified', 'fundingReady', 'productionReady', 'signingEnabled'):
            if r.get(key) is not False:
                raise ValueError('Unexpected savings readiness claim.')
        hash_value = lambda v: isinstance(v, str) and re.fullmatch(r'0x[0-9a-f]{64}', v) is not None
        for key in ('fingerprint', 'expectationFingerprint'):
            if not hash_value(r[key]):
                raise ValueError('Missing exact review fingerprint.')
        for key in ('actionId', 'authorizationDigest'):
            if r[key] is not None and not hash_value(r[key]):
                raise ValueError('Invalid savings authorization identity.')
        if not isinstance(r['signer'], str) or re.fullmatch(r'0x[0-9a-fA-F]{40}', r['signer']) is None or int(r['signer'][2:], 16) == 0:
            raise ValueError('Invalid local signer.')
        if r['purpose'] not in ('Queue withdrawal', 'Queue configuration change', 'Queue resume', 'Execute withdrawal', 'Execute configuration change', 'Execute resume', 'Pause vault', 'Cancel withdrawal', 'Cancel resume', 'Cancel configuration change'):
            raise ValueError('Unsupported savings purpose.')
        if type(r['requiredApprovals']) is not int or r['requiredApprovals'] not in (0, 1, 2):
            raise ValueError('Invalid approval count.')
        rows = r['rows']
        if not isinstance(rows, list) or not 12 <= len(rows) <= 64:
            raise ValueError('Missing exact review details.')
        for row in rows:
            if not isinstance(row, dict) or set(row) != {'label', 'value'} or not isinstance(row['label'], str) or not 1 <= len(row['label']) <= 160 or not isinstance(row['value'], str) or len(row['value']) > 1024:
                raise ValueError('Invalid review row.')
        if len({row['label'] for row in rows}) != len(rows):
            raise ValueError('Duplicate review labels.')
        by_label = {row['label']: row['value'] for row in rows}
        mandatory = {'Review purpose', 'Ethereum chain ID', 'Savings vault', 'Contract version', 'Expected runtime code hash', 'This offline signer', 'Current preset', 'Current approval threshold', 'Current policy epoch', 'Current configuration hash', 'Current paused state', 'Approvals needed for this operation', 'Authorization digest'}
        if not mandatory.issubset(by_label):
            raise ValueError('Missing vault identity or exact authorization details.')
        action_labels = {'Action', 'Asset address', 'Recipient', 'Amount in base units', 'Action nonce', 'Action expiry UTC', 'Action expiry Unix seconds', 'Action policy epoch', 'Action current configuration hash', 'Action proposed configuration hash'}
        allowed = mandatory | action_labels | {'Asset', 'Exact amount', 'New preset', 'New approval threshold', 'New withdrawal delay seconds', 'Exact action ID', 'Delay after successful on-chain queue seconds', 'Waiting period', 'Reported queue time UTC', 'Reported ready time UTC', 'Queue evidence', 'New vault signature', 'Pause effect', 'Cancellation effect', 'Target action ID', 'Configuration-cancellation nonce', 'Protection nonce', 'Protection expiry UTC', 'Protection expiry Unix seconds', 'Protection policy epoch', 'Protection current configuration hash'}
        allowed |= {'Current signer '+str(i) for i in range(1, 4)} | {'New signer '+str(i) for i in range(1, 4)}
        if not set(by_label).issubset(allowed):
            raise ValueError('Unsupported review fields.')
        preset = by_label['Current preset']
        count = 1 if preset == 'Standard' else 3 if preset == 'Strong' else 0
        signer_labels = {'Current signer '+str(i) for i in range(1, count+1)}
        if count == 0 or {k for k in by_label if k.startswith('Current signer ')} != signer_labels or by_label['Current approval threshold'] != ('1' if count == 1 else '2'):
            raise ValueError('Incomplete current signer configuration.')
        members = [by_label[k] for k in signer_labels]
        if any(re.fullmatch(r'0x[0-9a-fA-F]{40}', a) is None or int(a[2:], 16) == 0 for a in members) or len({a.lower() for a in members}) != count or r['signer'].lower() not in {a.lower() for a in members}:
            raise ValueError('Invalid current signer identities.')
        if by_label['Current paused state'] not in ('Paused', 'Not paused') or re.fullmatch(r'[1-9][0-9]{0,15}', by_label['Current policy epoch']) is None or not hash_value(by_label['Current configuration hash']) or not hash_value(by_label['Expected runtime code hash']):
            raise ValueError('Incomplete current policy identity.')
        if r['purpose'] != 'Pause vault' and not action_labels.issubset(by_label):
            raise ValueError('Incomplete exact action details.')
        uint = lambda v: isinstance(v, str) and re.fullmatch(r'0|[1-9][0-9]{0,77}', v) is not None and int(v) < 2**256
        addr = lambda v: isinstance(v, str) and re.fullmatch(r'0x[0-9a-fA-F]{40}', v) is not None
        timestamp = lambda v: dt.datetime.fromtimestamp(int(v), dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        withdrawal = r['purpose'].endswith('withdrawal')
        config_change = r['purpose'].endswith('configuration change')
        if r['purpose'] != 'Pause vault':
            expected_action = 'Withdraw' if withdrawal else 'Change signers or preset' if config_change else 'Resume vault'
            if by_label['Action'] != expected_action or not addr(by_label['Recipient']) or not addr(by_label['Asset address']) or not uint(by_label['Amount in base units']) or not uint(by_label['Action nonce']):
                raise ValueError('Invalid displayed action terms.')
            if not uint(by_label['Action expiry Unix seconds']) or not uint(by_label['Action policy epoch']) or int(by_label['Action policy epoch']) < 1 or not hash_value(by_label['Action current configuration hash']) or not hash_value(by_label['Action proposed configuration hash']):
                raise ValueError('Invalid displayed action policy or expiry.')
            if by_label['Action expiry UTC'] != timestamp(by_label['Action expiry Unix seconds']):
                raise ValueError('Displayed action times disagree.')
            if withdrawal:
                if not {'Asset', 'Exact amount'}.issubset(by_label) or int(by_label['Recipient'][2:], 16) == 0 or int(by_label['Amount in base units']) == 0:
                    raise ValueError('Missing exact withdrawal amount or recipient.')
                asset = by_label['Asset address'].lower()
                if asset not in ('0x'+'00'*20, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'):
                    raise ValueError('Unsupported savings asset.')
                symbol, decimals = ('ETH', 18) if int(asset[2:], 16) == 0 else ('USDC', 6)
                padded = by_label['Amount in base units'].rjust(decimals+1, '0')
                exact = padded[:-decimals]+'.'+(padded[-decimals:].rstrip('0') or '0')+' '+symbol
                if by_label['Asset'] != symbol or by_label['Exact amount'] != exact:
                    raise ValueError('Displayed amount differs from the exact base units.')
            elif by_label['Amount in base units'] != '0' or int(by_label['Recipient'][2:], 16) != 0 or int(by_label['Asset address'][2:], 16) != 0:
                raise ValueError('A security change cannot include a payment.')
        if r['purpose'] in ('Queue configuration change', 'Execute configuration change', 'Cancel configuration change'):
            new_preset = by_label.get('New preset');new_count = 1 if new_preset == 'Standard' else 3 if new_preset == 'Strong' else 0
            new_labels = {'New signer '+str(i) for i in range(1, new_count+1)}
            if new_count == 0 or {k for k in by_label if k.startswith('New signer ')} != new_labels or by_label.get('New approval threshold') != ('1' if new_count == 1 else '2') or by_label.get('New withdrawal delay seconds') != ('300' if new_count == 1 else '900'):
                raise ValueError('Incomplete proposed signer configuration.')
            new_members = [by_label[k] for k in new_labels]
            if any(re.fullmatch(r'0x[0-9a-fA-F]{40}', a) is None or int(a[2:], 16) == 0 for a in new_members) or len({a.lower() for a in new_members}) != new_count:
                raise ValueError('Invalid proposed signer identities.')
        if re.fullmatch(r'0x[0-9a-fA-F]{40}', by_label['Savings vault']) is None or int(by_label['Savings vault'][2:], 16) == 0 or by_label['Savings vault'].lower() in {a.lower() for a in members}:
            raise ValueError('Invalid savings vault.')
        if by_label['Contract version'] != '1' or by_label['Approvals needed for this operation'] != str(r['requiredApprovals']) or by_label['Authorization digest'] != (r['authorizationDigest'] or 'None: execution review does not request a new signature'):
            raise ValueError('Displayed authorization differs from the review identity.')
        if by_label.get('Review purpose') != r['purpose'] or by_label.get('This offline signer') != r['signer'] or by_label.get('Ethereum chain ID') != '1':
            raise ValueError('Review purpose or signer mismatch.')
        timing = r['timing']
        if not isinstance(timing, dict) or set(timing) != {'kind', 'delaySeconds', 'expiry', 'readyAt', 'source'} or type(timing['expiry']) is not int or type(timing['delaySeconds']) is not int or timing['delaySeconds'] not in (0, 300, 900, 3600):
            raise ValueError('Invalid savings timing.')
        now = int(time.time())
        if timing['expiry'] <= now or timing['expiry'] > now + 86400:
            raise ValueError('Approval expired or clock differs. Review a fresh request.')
        execute = r['purpose'].startswith('Execute ')
        queue = r['purpose'].startswith('Queue ')
        policy_quorum = 1 if count == 1 else 2
        expected_approvals = 0 if execute else policy_quorum if queue or config_change else 1
        expected_delay = ((300 if count == 1 else 900) if withdrawal else 3600) if queue or execute else 0
        if r['requiredApprovals'] != expected_approvals or timing['delaySeconds'] != expected_delay:
            raise ValueError('Approval count or waiting period differs from current policy.')
        expiry_label = 'Action expiry Unix seconds' if queue or execute else 'Protection expiry Unix seconds'
        if by_label.get(expiry_label) != str(timing['expiry']):
            raise ValueError('Displayed expiry differs from the authorization deadline.')
        if not (queue or execute):
            protection_labels = {'Protection expiry UTC', 'Protection expiry Unix seconds', 'Protection policy epoch', 'Protection current configuration hash'}
            nonce_label = 'Configuration-cancellation nonce' if config_change else 'Protection nonce'
            if not protection_labels.issubset(by_label) or not uint(by_label.get(nonce_label)) or by_label['Protection policy epoch'] != by_label['Current policy epoch'] or by_label['Protection current configuration hash'] != by_label['Current configuration hash'] or by_label['Protection expiry UTC'] != timestamp(timing['expiry']):
                raise ValueError('Incomplete protective authorization details.')
        if execute:
            if r['authorizationDigest'] is not None or r['requiredApprovals'] != 0 or timing['kind'] != 'reported-existing-queue' or timing['source'] != 'untrusted-host-rpc' or type(timing['readyAt']) is not int or timing['readyAt'] > now:
                raise ValueError('Invalid read-only execution review.')
        else:
            if not hash_value(r['authorizationDigest']) or r['requiredApprovals'] not in (1, 2) or timing['source'] != 'contract-rule' or timing['readyAt'] is not None:
                raise ValueError('Missing exact signing purpose.')
            if timing['kind'] != ('new-queue-delay' if queue else 'immediate-protection') or (queue and timing['delaySeconds'] not in (300, 900, 3600)) or (not queue and timing['delaySeconds'] != 0) or timing['expiry'] <= now + timing['delaySeconds']:
                raise ValueError('Insufficient time for the on-chain delay. Review a fresh request.')
        if r['expectationProvenance'] != 'caller-supplied-independent-review; origin is not authenticated by this function' or not isinstance(r['warning'], str) or len(r['warning']) > 2048:
            raise ValueError('Invalid identity provenance.')
        return copy.deepcopy(r)

    def accept(self, reply, generation):
        if generation != self.generation:
            return False
        try:
            self.review = self.validated(reply)
            self._accepted_snapshot = json.dumps(self.review, sort_keys=True, separators=(',', ':'))
            self.identity_checked = self.approved = False
            return True
        except Exception:
            self.clear()
            raise

    def revalidate(self):
        try:
            current = self.validated({'ok': True, 'identitySource': 'untrusted-media; independent comparison required', 'review': self.review})
            if self._accepted_snapshot is None or json.dumps(current, sort_keys=True, separators=(',', ':')) != self._accepted_snapshot:
                raise ValueError('Savings review changed. Compare identity and approve again.')
            self.review = current
        except Exception:
            self.clear()
            raise

    def confirm_identity(self):
        self.revalidate()
        self.identity_checked = True
        self.approved = False

    def approve(self):
        self.revalidate()
        if not self.identity_checked or self.review['authorizationDigest'] is None:
            raise ValueError('Independently compare vault identity before approving a signing request.')
        self.approved = True

    def signing_payload(self, password):
        self.revalidate()
        if not self.identity_checked or not self.approved or self.review['authorizationDigest'] is None:
            raise ValueError('Review and explicitly approve this exact savings action first.')
        # Consume before asynchronous work. A failure or retry needs fresh review.
        self.approved = False
        self.identity_checked = False
        return {'scope': 'savings-action', 'action': 'sign', 'fingerprint': self.review['fingerprint'], 'expectationFingerprint': self.review['expectationFingerprint'], 'independentlyCheckedIdentity': True, 'consent': True, 'password': password}
