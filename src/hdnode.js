const base58check = require('bs58check');
const { hash160, createHmac } = require('./crypto');

const typeforce = require('typeforce');
const types = require('./types');
const NETWORKS = require('./networks');

const BigInteger = require('bigi');
const ECPair = require('./ecpair');

const ecurve = require('ecurve');
const curve = ecurve.getCurveByName('secp256k1');

class HDNode {
  constructor (keyPair, chainCode) {
    typeforce(types.tuple('ECPair', types.Buffer256bit), arguments);

    if (!keyPair.compressed) throw new TypeError('BIP32 only allows compressed keyPairs');

    this.keyPair = keyPair;
    this.chainCode = chainCode;
    this.depth = 0;
    this.index = 0;
    this.parentFingerprint = 0x00000000;
  }

  static fromSeedBuffer (seed, network) {
    typeforce(types.tuple(types.Buffer, types.maybe(types.Network)), arguments);

    if (seed.length < 16) throw new TypeError('Seed should be at least 128 bits');
    if (seed.length > 64) throw new TypeError('Seed should be at most 512 bits');

    const I = createHmac('sha512', HDNode.MASTER_SECRET).update(seed).digest();
    const IL = I.slice(0, 32);
    const IR = I.slice(32);

    // In case IL is 0 or >= n, the master key is invalid
    // This is handled by the ECPair constructor
    const pIL = BigInteger.fromBuffer(IL);
    const keyPair = new ECPair(pIL, null, {
      network
    });

    return new HDNode(keyPair, IR);
  }

  getAddress (coin) {
    return this.keyPair.getAddress(coin);
  }
  getPrivateKey (coin) {
    return this.keyPair.toWIF(coin);
  }
  getIdentifier () {
    return hash160(this.keyPair.getPublicKeyBuffer());
  }

  getFingerprint () {
    return this.getIdentifier().slice(0, 4);
  }

  getNetwork () {
    return this.keyPair.getNetwork();
  }

  getPublicKeyBuffer () {
    return this.keyPair.getPublicKeyBuffer();
  }

  neutered () {
    const neuteredKeyPair = new ECPair(null, this.keyPair.Q, {
      network: this.keyPair.network
    });

    const neutered = new HDNode(neuteredKeyPair, this.chainCode);
    neutered.depth = this.depth;
    neutered.index = this.index;
    neutered.parentFingerprint = this.parentFingerprint;

    return neutered;
  }

  sign (hash) {
    return this.keyPair.sign(hash);
  }

  verify (hash, signature) {
    return this.keyPair.verify(hash, signature);
  }

  toBase58 (__isPrivate) {
    if (__isPrivate !== undefined) throw new TypeError('Unsupported argument in 2.0.0');

    // Version
    const network = this.keyPair.network;
    const version = (!this.isNeutered()) ? network.bip32.private : network.bip32.public;
    const buffer = Buffer.allocUnsafe(78);

    // 4 bytes: version bytes
    buffer.writeUInt32BE(version, 0);

    // 1 byte: depth: 0x00 for master nodes, 0x01 for level-1 descendants, ....
    buffer.writeUInt8(this.depth, 4);

    // 4 bytes: the fingerprint of the parent's key (0x00000000 if master key)
    buffer.writeUInt32BE(this.parentFingerprint, 5);

    // 4 bytes: child number. This is the number i in xi = xpar/i, with xi the key being serialized.
    // This is encoded in big endian. (0x00000000 if master key)
    buffer.writeUInt32BE(this.index, 9);

    // 32 bytes: the chain code
    this.chainCode.copy(buffer, 13);

    // 33 bytes: the public key or private key data
    if (!this.isNeutered()) {
      // 0x00 + k for private keys
      buffer.writeUInt8(0, 45);
      this.keyPair.d.toBuffer(32).copy(buffer, 46);

      // 33 bytes: the public key
    } else {
      // X9.62 encoding for public keys
      this.keyPair.getPublicKeyBuffer().copy(buffer, 45);
    }

    return base58check.encode(buffer);
  }

  // https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#child-key-derivation-ckd-functions
  derive (index) {
    typeforce(types.UInt32, index);

    const isHardened = index >= HDNode.HIGHEST_BIT;
    const data = Buffer.allocUnsafe(37);

    // Hardened child
    if (isHardened) {
      if (this.isNeutered()) throw new TypeError('Could not derive hardened child key');

      // data = 0x00 || ser256(kpar) || ser32(index)
      data[0] = 0x00;
      this.keyPair.d.toBuffer(32).copy(data, 1);
      data.writeUInt32BE(index, 33);

      // Normal child
    } else {
      // data = serP(point(kpar)) || ser32(index)
      //      = serP(Kpar) || ser32(index)
      this.keyPair.getPublicKeyBuffer().copy(data, 0);
      data.writeUInt32BE(index, 33);
    }

    const I = createHmac('sha512', this.chainCode).update(data).digest();
    const IL = I.slice(0, 32);
    const IR = I.slice(32);

    const pIL = BigInteger.fromBuffer(IL);

    // In case parse256(IL) >= n, proceed with the next value for i
    if (pIL.compareTo(curve.n) >= 0) {
      return this.derive(index + 1);
    }

    // Private parent key -> private child key
    let derivedKeyPair;
    if (!this.isNeutered()) {
      // ki = parse256(IL) + kpar (mod n)
      const ki = pIL.add(this.keyPair.d).mod(curve.n);

      // In case ki == 0, proceed with the next value for i
      if (ki.signum() === 0) {
        return this.derive(index + 1);
      }

      derivedKeyPair = new ECPair(ki, null, {
        network: this.keyPair.network
      });

      // Public parent key -> public child key
    } else {
      // Ki = point(parse256(IL)) + Kpar
      //    = G*IL + Kpar
      const Ki = curve.G.multiply(pIL).add(this.keyPair.Q);

      // In case Ki is the point at infinity, proceed with the next value for i
      if (curve.isInfinity(Ki)) {
        return this.derive(index + 1);
      }

      derivedKeyPair = new ECPair(null, Ki, {
        network: this.keyPair.network
      });
    }

    const hd = new HDNode(derivedKeyPair, IR);
    hd.depth = this.depth + 1;
    hd.index = index;
    hd.parentFingerprint = this.getFingerprint().readUInt32BE(0);

    return hd;
  }

  deriveHardened (index) {
    typeforce(types.UInt31, index);

    // Only derives hardened private keys by default
    return this.derive(index + HDNode.HIGHEST_BIT);
  }

  // Private === not neutered
  // Public === neutered
  isNeutered () {
    return !(this.keyPair.d);
  }

  derivePath (path) {
    typeforce(types.BIP32Path, path);

    let splitPath = path.split('/');
    if (splitPath[0] === 'm') {
      if (this.parentFingerprint) {
        throw new Error('Not a master node');
      }

      splitPath = splitPath.slice(1);
    }

    return splitPath.reduce((prevHd, indexStr) => {
      let index;
      if (indexStr.slice(-1) === "'") {
        index = parseInt(indexStr.slice(0, -1), 10);
        return prevHd.deriveHardened(index);
      } else {
        index = parseInt(indexStr, 10);
        return prevHd.derive(index);
      }
    }, this);
  }
}

HDNode.HIGHEST_BIT = 0x80000000;
HDNode.LENGTH = 78;
HDNode.MASTER_SECRET = Buffer.from('Bitcoin seed', 'utf8');

HDNode.fromSeedHex = (hex, network) => HDNode.fromSeedBuffer(Buffer.from(hex, 'hex'), network);

HDNode.fromBase58 = (string, networks) => {
  const buffer = base58check.decode(string);
  if (buffer.length !== 78) throw new Error('Invalid buffer length');

  // 4 bytes: version bytes
  const version = buffer.readUInt32BE(0);
  let network;

  // list of networks?
  if (Array.isArray(networks)) {
    network = networks.filter(x => version === x.bip32.private ||
      version === x.bip32.public).pop();

    if (!network) throw new Error('Unknown network version');

    // otherwise, assume a network object (or default to bitcoin)
  } else {
    network = networks || NETWORKS.bitcoin;
  }

  if (version !== network.bip32.private &&
    version !== network.bip32.public) throw new Error('Invalid network version');

  // 1 byte: depth: 0x00 for master nodes, 0x01 for level-1 descendants, ...
  const depth = buffer[4];

  // 4 bytes: the fingerprint of the parent's key (0x00000000 if master key)
  const parentFingerprint = buffer.readUInt32BE(5);
  if (depth === 0) {
    if (parentFingerprint !== 0x00000000) throw new Error('Invalid parent fingerprint');
  }

  // 4 bytes: child number. This is the number i in xi = xpar/i, with xi the key being serialized.
  // This is encoded in MSB order. (0x00000000 if master key)
  const index = buffer.readUInt32BE(9);
  if (depth === 0 && index !== 0) throw new Error('Invalid index');

  // 32 bytes: the chain code
  const chainCode = buffer.slice(13, 45);
  let keyPair;

  // 33 bytes: private key data (0x00 + k)
  if (version === network.bip32.private) {
    if (buffer.readUInt8(45) !== 0x00) throw new Error('Invalid private key');

    const d = BigInteger.fromBuffer(buffer.slice(46, 78));
    keyPair = new ECPair(d, null, { network });

    // 33 bytes: public key data (0x02 + X or 0x03 + X)
  } else {
    const Q = ecurve.Point.decodeFrom(curve, buffer.slice(45, 78));
    // Q.compressed is assumed, if somehow this assumption is broken, `new HDNode` will throw

    // Verify that the X coordinate in the public point corresponds to a point on the curve.
    // If not, the extended public key is invalid.
    curve.validate(Q);

    keyPair = new ECPair(null, Q, { network });
  }

  const hd = new HDNode(keyPair, chainCode);
  hd.depth = depth;
  hd.index = index;
  hd.parentFingerprint = parentFingerprint;

  return hd;
};

module.exports = HDNode;
