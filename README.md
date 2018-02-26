# CoinJS (coinjs-lib)
[![NPM](https://img.shields.io/npm/v/coinjs-lib.svg)](https://www.npmjs.org/package/coinjs-lib)

A simple fork of the famous and battle-tested [BitcoinJs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) for use with NodeJs(no browser support) v7+ only.

## Features
- All features of `bitcoinjs-lib@3.3.2`.
- Integrated [Bip39](https://github.com/bitcoinjs/bip39) module.
- Additional networks.
- Support for BCH's CashAddress format.
- Support for Ethereum.

## Example
```js
const coinjs = require('coinjs-lib');

// generate mnemonic seed
// const mnemonic = coinjs.bip39.generateMnemonic();
// or use your own valid bip39 mnemonic seed
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// validate mnemonic seed
console.log(coinjs.bip39.validateMnemonic(mnemonic));
// => true

// mnemonic to seed
const seed = coinjs.bip39.mnemonicToSeed(mnemonic);

const rootNode = coinjs.HDNode.fromSeedBuffer(seed);

// get bip44 constants https://github.com/satoshilabs/slips/blob/master/slip-0044.md
const ethbip44 = 60;
const btcbip44 = 0;
const bchbip44 = 145;

const ethchild = rootNode.derivePath(`m/44'/${ethbip44}'/0'/0/0`);
const btcchild = rootNode.derivePath(`m/44'/${btcbip44}'/0'/0/0`);
const bchchild = rootNode.derivePath(`m/44'/${bchbip44}'/0'/0/0`);

// get addresses
const ethaddress = ethchild.getAddress('eth');
const btcaddress = btcchild.getAddress();
const bchaddress = bchchild.getAddress('bch');

console.log(ethaddress);
// => 0x9858effd232b4033e47d90003d41ec34ecaeda94
console.log(btcaddress);
// => 1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA
console.log(bchaddress);
// => bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6

// get private key
const ethprivkey = ethchild.getPrivateKey('eth');
const btcprivkey = btcchild.getPrivateKey();
const bchprivkey = bchchild.getPrivateKey();

console.log(ethprivkey);
// => 1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727
console.log(btcprivkey);
// => L4p2b9VAf8k5aUahF1JCJUzZkgNEAqLfq8DDdQiyAprQAKSbu8hf
console.log(bchprivkey);
// => KxbEv3FeYig2afQp7QEA9R3gwqdTBFwAJJ6Ma7j1SkmZoxC9bAXZ

// All other methods and functions are the same with bitcoinjs-lib
```

## LICENSE [MIT](LICENSE)
