module.exports = {
  bitcoin: {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bc',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80
  },
  testnet: {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'tb',
    bip32: {
      public: 0x043587cf,
      private: 0x04358394
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef
  },
  litecoin: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bip32: {
      public: 0x019da462,
      private: 0x019d9cfe
    },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0
  },
  dogecoin: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bip32: {
      private: 0x02fac398,
      public: 0x02facafd
    },
    wif: 0x9e,
    pubKeyHash: 0x1e,
    scriptHash: 0x16
  },
  dash: {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bip32: {
      public: 0x02fe52f8,
      private: 0x02fe52cc
    },
    pubKeyHash: 0x4c,
    scriptHash: 0x10,
    wif: 0xcc
  },
  digibyte: {
    messagePrefix: '\x19DigiByte Signed Message:\n',
    bip32: {
      public: 0,
      private: 0
    },
    pubKeyHash: 0x1e,
    scriptHash: 0x5,
    wif: 0x80
  },
  namecoin: {
    messagePrefix: '\x19Bitcoin Signed Message:\n',
    bip32: {
      public: 0x0488B21E,
      private: 0x0488ADE4
    },
    pubKeyHash: 0x34,
    scriptHash: 0x0d,
    wif: 0xe4
  },
  blackcoin: {
    messagePrefix: '\x19Blackcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x19,
    scriptHash: 0x55,
    wif: 0x99
  },
  bitcoin_gold: {
    messagePrefix: '\x19Bitcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x26,
    scriptHash: 0x17,
    wif: 0x80
  },
  bitcoin_cash: {
    messagePrefix: '\x19Bitcoin Cash Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80
  },
  monacoin: {
    messagePrefix: '\x19Monacoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x32,
    scriptHash: 0x37,
    wif: 0xB2
  },
  nubits: {
    messagePrefix: '\x19Nubits Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x19,
    scriptHash: 0x1a,
    wif: 0x96
  },
  peercoin: {
    messagePrefix: '\x19Peercoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x44,
    scriptHash: 0x05,
    wif: 0xc4
  },
  vertcoin: {
    messagePrefix: '\x19Vertcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x47,
    scriptHash: 0x05,
    wif: 0x80
  },
  reddcoin: {
    messagePrefix: '\x19Reddcoin Signed Message:\n',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    pubKeyHash: 0x3d,
    scriptHash: 0x05,
    wif: 0xbd
  }
};
