// Reviewed LI.FI mainnet/Sushi native-only identities, 2026-10-04.
// See docs/lifi-native-execution.md for sources and limits.
export const LIFI_PINS = {
  "Diamond": {
    "address": "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    "codeHash": "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220"
  },
  "Facet": {
    "address": "0x8C9dBA771220Ed09580b77F0765e7153fbDE7790",
    "codeHash": "0xda9530646a98537f040e10ef2d46cea3b1e12a8ceafc4561f68ff197fba303df"
  },
  "FeeForwarder": {
    "address": "0xCE40449B773a3E6E5e769ADb4e567179d4828cbd",
    "codeHash": "0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74"
  },
  "Sushi": {
    "address": "0xAC4c6e212A361c968F1725b4d055b47E63F80b75",
    "codeHash": "0x0f03d21210d372bcd652717df8057c8bf40d1b4fcc4db49614de1e56be80db51"
  },
  "Executor": {
    "address": "0xc10ee9031f2a0b84766a86b55a8d90f357910fb4",
    "codeHash": "0x3b63d5c4ef22be9d1b47f4203a290463f13e6281880bece6544b3c2f62d893e4"
  },
  "SafeExecutor": {
    "address": "0xad27827c312cd5e71311d68e180a9872d42de23d",
    "codeHash": "0x67dbb96e562812cb3d1fea1468574a66029a602ff944088f1c66c33c104bb595"
  }
} as const;
