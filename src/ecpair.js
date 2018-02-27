const baddress = require('./address');
const bcrypto = require('./crypto');
const ecdsa = require('./ecdsa');
const typeforce = require('typeforce');
const types = require('./types');
const wif = require('wif');
const NETWORKS = require('./networks');
const BigInteger = require('bigi');
const ecurve = require('ecurve');
const secp256k1 = ecdsa.__curve;

class ECPair {
  constructor (d, Q, options) {
    if (options) {
      typeforce({
        compressed: types.maybe(types.Boolean),
        network: types.maybe(types.Network)
      }, options);
    }

    options = options || {};

    if (d) {
      if (d.signum() <= 0) throw new Error('Private key must be greater than 0');
      if (d.compareTo(secp256k1.n) >= 0) throw new Error('Private key must be less than the curve order');
      if (Q) throw new TypeError('Unexpected publicKey parameter');

      this.d = d;
    } else {
      typeforce(types.ECPoint, Q);

      this.__Q = Q;
    }

    this.compressed = options.compressed === undefined ? true : options.compressed;
    this.network = options.network || NETWORKS.bitcoin;
  }

  get Q () {
    if (!this.__Q && this.d) {
      this.__Q = secp256k1.G.multiply(this.d);
    }

    return this.__Q;
  }

  getAddress (coin) {
    let address;
    if (coin !== 'eth') {
      address = baddress.toBase58Check(bcrypto.hash160(this.getPublicKeyBuffer()), this.getNetwork().pubKeyHash);
    } else {
      address = baddress.ethpubToAddress(baddress.bip32PublicToEthereumPublic(this.getPublicKeyBuffer()));
      address = `0x${address.toString('hex')}`;
      if (!baddress.isValidEthAddress(address)) {
        throw new Error('Invalid Ethereum address');
      }
    }
    return coin === 'bch' ? baddress.toCashAddress(address) : address;
  }

  getNetwork () {
    return this.network;
  }

  getPublicKeyBuffer () {
    return this.Q.getEncoded(this.compressed);
  }

  sign (hash) {
    if (!this.d) throw new Error('Missing private key');

    return ecdsa.sign(hash, this.d);
  }

  toWIF (coin) {
    if (!this.d) throw new Error('Missing private key');
    let privkey;
    if (coin !== 'eth') {
      privkey = wif.encode(this.network.wif, this.d.toBuffer(32), this.compressed);
    } else {
      privkey = this.d.toBuffer(32);
      if (!isValidPrivate(privkey)) {
        throw new Error('Invalid Ethereum private key');
      } else {
        privkey = privkey.toString('hex');
      }
    }
    return privkey;
  }

  verify (hash, signature) {
    return ecdsa.verify(hash, signature, this.Q);
  }
}

ECPair.fromPublicKeyBuffer = (buffer, network) => {
  const Q = ecurve.Point.decodeFrom(secp256k1, buffer);

  return new ECPair(null, Q, {
    compressed: Q.compressed,
    network
  });
};

ECPair.fromWIF = (string, network) => {
  const decoded = wif.decode(string);
  const version = decoded.version;

  // list of networks?
  if (types.Array(network)) {
    network = network.filter(x => version === x.wif).pop();

    if (!network) throw new Error('Unknown network version');

    // otherwise, assume a network object (or default to bitcoin)
  } else {
    network = network || NETWORKS.bitcoin;

    if (version !== network.wif) throw new Error('Invalid network version');
  }

  const d = BigInteger.fromBuffer(decoded.privateKey);

  return new ECPair(d, null, {
    compressed: decoded.compressed,
    network
  });
};

ECPair.makeRandom = options => {
  options = options || {};

  const rng = options.rng || bcrypto.randomBytes;

  let d;
  do {
    const buffer = rng(32);
    typeforce(types.Buffer256bit, buffer);

    d = BigInteger.fromBuffer(buffer);
  } while (d.signum() <= 0 || d.compareTo(secp256k1.n) >= 0);

  return new ECPair(d, null, options);
};

module.exports = ECPair;
