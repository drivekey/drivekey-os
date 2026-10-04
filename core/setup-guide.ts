export const setupSteps = [
 {id:'requirements',title:'Check what you need',intro:'Your USB. Your vault. Your approval.',steps:[
  'Have a compatible USB and a Windows PC able to boot an x86-64 Linux image. Support varies by drive, computer and firmware; this image is not a universal Mac or ARM installer.',
  'Make sure you can save your work and restart this PC. Booting and signing take a separate offline session.',
  'Choose a unique vault passphrase and a separate safe location for an encrypted backup. Do not use a password from a chat.',
  'If this USB already holds a vault, follow the upgrade path below. Do not flash it before verifying a separate encrypted backup.'
 ],check:'I checked compatibility and have a backup plan.'},
 {id:'download',title:'Download and verify',intro:'A real bootable image. Everything needed for offline signing is bundled.',steps:[
  'When the download is available below, save the bootable ISO to your PC. No account or running local server is needed. If the download is temporarily unavailable, wait before continuing.',
  'Desktop r20 opens a graphical offline wallet with Home, Vaults, Requests, Review & sign, Files and System. Mouse, keyboard and reduced-motion controls are included. BIOS/UEFI and supported signing flows were tested with unfunded wallets in disconnected VMs; physical hardware remains unverified. Updating the website does not update an already flashed USB.',
  'Open PowerShell in the folder containing your download. Copy and run the checksum command below.',
  'Compare all 64 hexadecimal characters with the published SHA256. A match confirms the downloaded bytes match this release; it does not establish a security audit or trusted firmware.'
 ],check:'My downloaded ISO checksum matches.'},
 {id:'prepare',title:'Prepare the USB',intro:'Use Rufus to write the image—not a normal file copy.',warning:'Flashing erases the selected USB. Never overwrite the only copy of a vault. For upgrades, prefer another empty USB and verify a separate encrypted backup first.',steps:[
  'Connect the intended empty USB. In Rufus, identify its device name and capacity; disconnect unrelated removable drives if that helps avoid mistakes.',
  'Choose SELECT and select the verified DriveKey ISO.',
  'Recheck the exact target before START. When Rufus offers ISO or DD mode, choose DD image mode.',
  'Read every erasure confirmation. Proceed only when you recognize the intended empty target and accept erasing it.',
  'Wait for completion. If Windows asks to initialize or format an unfamiliar partition afterward, cancel. Do not format the Linux boot partition.'
 ],check:'I prepared the intended USB and Rufus finished.'},
 {id:'boot',title:'Boot DriveKey offline',intro:'A separate Linux session, started from your USB.',steps:[
  'Save your Windows work and disconnect Ethernet and Wi-Fi. Leave the USB connected and shut down.',
  'Power on and open your PC’s one-time boot menu using the manufacturer’s instructions. Select the USB boot entry.',
  'The graphical DriveKey Desktop starts automatically. Use the mouse or Tab/Enter; Alt+1–6 switches sections, Page Up/Down scrolls and Escape cancels. System also offers the terminal recovery interface.',
  'Open System → Correct UTC clock. Compare UTC with an independent clock. If genuinely wrong, enter the actual current UTC as YYYY-MM-DD HH:MM:SS or an ISO timestamp ending Z, review and confirm the correction. This changes only the live Linux session, not Windows or the hardware clock. Never use a request deadline to set the time.',
  'If Windows opens instead, shut down and check the selected boot entry and image-writing result. Consult your manufacturer for compatibility. Do not blindly disable Secure Boot or change BitLocker/firmware protections.',
  'A virtual machine is suitable for unfunded functional demonstrations, not protecting real keys from a compromised host.'
 ],check:'I reached DriveKey Desktop offline.'},
 {id:'vault',title:'Create and check your vault',intro:'Your keys stay out of the website.',steps:[
  'For a new native ETH wallet, select the Native ETH profile, open Vaults and choose “Create new vault.” Read the recovery information.',
  'Enter a unique passphrase locally, repeat it and explicitly confirm creation. Input is hidden. If confirmation differs, correct it and retry.',
  'Open Vaults to record the full public address or show its address QR. Never share the passphrase or private vault file.',
  'Choose “Verify passphrase” and verify the new passphrase before leaving Linux.',
  'For an existing native ETH wallet upgrade, do NOT create a different wallet. Place your verified vault-backup.json in the new USB’s DriveKey folder while shut down, then boot, select the Native ETH profile and choose Vaults → Restore to empty target. Verify the recovered address matches your original. Multichain uses its separate profile and vault-multi-backup.json.'
 ],check:'I verified my vault passphrase and full public address offline.'},
 {id:'backup',title:'Back up and verify',intro:'A backup only helps if you can restore it.',warning:'A copy on the same USB does not protect against losing that USB. Recovery requires a separate encrypted copy AND its passphrase. Reconnecting cannot reset a forgotten passphrase.',steps:[
  'Open Vaults → Create encrypted backup. The Native ETH profile saves vault-backup.json without replacing an existing backup; Multichain uses vault-multi-backup.json.',
  'Choose “Verify encrypted backup” and enter the passphrase locally. Check the public address.',
  'Use “Safe shutdown.” Only after the PC is fully off, return to Windows and copy the encrypted backup to a separate safe location.',
  'Test recovery on an empty configured target: place vault-backup.json in its DriveKey folder while shut down, boot offline, restore and verify the original address.',
  'Never upload vault-encrypted.json or vault-backup.json to this website. Keep the passphrase separate from its backup.'
 ],check:'I verified a separate encrypted backup and understand recovery.'},
 {id:'return',title:'Return to Windows',intro:'Bring back the public file—not your private key.',steps:[
  'Choose Vaults → Export public wallet if wallet-public.json needs to be restored, then choose “Safe shutdown.”',
  'Keep the USB connected until the PC is fully off. Start Windows using the normal Windows boot entry.',
  'Find the DRIVEKEY data partition and its DriveKey folder. The drive letter may differ between PCs.',
  'Open Offline transfer and select only wallet-public.json. The page shows your full public address and Robinhood Chain / 4663; compare them with the offline screen.',
  'This public metadata identifies your wallet but cannot sign transactions. There is no vault passphrase field on the website.'
 ],check:'My public wallet is loaded and its address matches.'},
 {id:'transfer',title:'Make your first transfer',intro:'Prepare online. Approve offline. Verify before sending.',steps:[
  'Load wallet-public.json in Offline transfer. Enter the full recipient and native ETH amount.',
  'Prepare and review the network, recipient, amount, maximum fee and total debit. Explicitly confirm the review.',
  'Download unsigned-request.json into the USB’s DriveKey folder with that exact filename. Keep this original website URL and browser session.',
  'Shut down and boot the USB offline. Open Review & sign → Inspect exact transaction.',
  'Verify every field independently: full sender/recipient, network, amount, fees, nonce, UTC expiry and fingerprint. Choose “I approve this exact transaction” only after review, then enter the passphrase locally and select “Sign and save.”',
  'Wait for “Signed response saved — not sent.” Use “Safe shutdown” and return to Windows.',
  'Upload signed-response.json into the original website session. The site verifies it against the saved request.',
  'When submission is enabled, explicitly authorize the exact payment. Current network checks happen before submission. Do not treat verification as sending.',
  'Check the receipt. Signed means approved offline; submitted means handed to the network; confirmed means successfully included. An uncertain result must be checked before another attempt.',
  'Check UTC and time remaining before rebooting. If genuinely expired, prepare a fresh request and approve it offline. Never change a clock or edit a request to bypass expiry. Application expiry cannot revoke signed transaction bytes.'
 ],check:'I understand signing, submission and receipt verification are separate.'},
] as const;
