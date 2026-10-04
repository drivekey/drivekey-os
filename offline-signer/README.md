# DriveKey offline signer

This is a separate command-line program for a disconnected Windows machine. It validates a DriveKey request, recomputes its fingerprint, parses and compares every EIP-1559 field, displays the transaction, requires the operator to type `SIGN`, accepts the matching private key through a masked terminal prompt, and writes `drivekey-signed.json`.

It never connects to an RPC endpoint, never broadcasts, and never writes the private key to disk. It must not be run on the online dashboard machine.

## One-time preparation

While the signing computer is connected, install Node.js 22 and run `pnpm install --frozen-lockfile` in the DriveKey source directory. Then disconnect Wi-Fi, Ethernet, Bluetooth, and every other network before handling a private key.

## Sign a request

In PowerShell on the disconnected computer:

```powershell
pnpm sign-offline -- E:\drivekey-request.json E:\drivekey-signed.json
```

Review every displayed field and compare the fingerprint with the online screen or a separately recorded value. Type `SIGN` only if all values are correct. Enter the disposable wallet's private key at the masked prompt. Do not paste a recovery phrase; this signer accepts one 32-byte EVM private key only.

The output file contains only a signed transaction and public metadata. Move it to the online machine, import it into DriveKey, and inspect the exact-match result before broadcasting.

## Safety limits

- Robinhood Chain mainnet (`4663`) only.
- Native EIP-1559 ETH transfers only.
- Maximum value `0.005 ETH`.
- Five-minute requests only; expired or modified requests are rejected.
- Existing output files are never overwritten.
- JavaScript cannot guarantee secure memory erasure. Use a disposable low-balance key on a dedicated offline machine for this first version.
