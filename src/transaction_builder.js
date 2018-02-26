const baddress = require('./address');
const bcrypto = require('./crypto');
const bscript = require('./script');
const btemplates = require('./templates');
const networks = require('./networks');
const ops = require('bitcoin-ops');
const typeforce = require('typeforce');
const types = require('./types');
const scriptTypes = btemplates.types;
const SIGNABLE = [btemplates.types.P2PKH, btemplates.types.P2PK, btemplates.types.MULTISIG];
const P2SH = SIGNABLE.concat([btemplates.types.P2WPKH, btemplates.types.P2WSH]);

const ECPair = require('./ecpair');
const ECSignature = require('./ecsignature');
const Transaction = require('./transaction');

function supportedType (type) {
  return SIGNABLE.includes(type);
}

function supportedP2SHType (type) {
  return P2SH.includes(type);
}

function extractChunks (type, chunks, script) {
  let pubKeys = [];
  let signatures = [];
  switch (type) {
    case scriptTypes.P2PKH:
      // if (redeemScript) throw new Error('Nonstandard... P2SH(P2PKH)')
      pubKeys = chunks.slice(1);
      signatures = chunks.slice(0, 1);
      break;

    case scriptTypes.P2PK:
      pubKeys[0] = script ? btemplates.pubKey.output.decode(script) : undefined;
      signatures = chunks.slice(0, 1);
      break;

    case scriptTypes.MULTISIG:
      if (script) {
        const multisig = btemplates.multisig.output.decode(script);
        pubKeys = multisig.pubKeys;
      }

      signatures = chunks.slice(1).map(chunk => chunk.length === 0 ? undefined : chunk);
      break;
  }

  return {
    pubKeys,
    signatures
  };
}

function expandInput (scriptSig, witnessStack) {
  if (scriptSig.length === 0 && witnessStack.length === 0) return {};

  let prevOutScript;
  let prevOutType;
  let scriptType;
  let script;
  let redeemScript;
  let witnessScript;
  let witnessScriptType;
  let redeemScriptType;
  let witness = false;
  let p2wsh = false;
  let p2sh = false;
  let witnessProgram;
  let chunks;

  const scriptSigChunks = bscript.decompile(scriptSig);
  const sigType = btemplates.classifyInput(scriptSigChunks, true);
  if (sigType === scriptTypes.P2SH) {
    p2sh = true;
    redeemScript = scriptSigChunks[scriptSigChunks.length - 1];
    redeemScriptType = btemplates.classifyOutput(redeemScript);
    prevOutScript = btemplates.scriptHash.output.encode(bcrypto.hash160(redeemScript));
    prevOutType = scriptTypes.P2SH;
    script = redeemScript;
  }

  const classifyWitness = btemplates.classifyWitness(witnessStack, true);
  if (classifyWitness === scriptTypes.P2WSH) {
    witnessScript = witnessStack[witnessStack.length - 1];
    witnessScriptType = btemplates.classifyOutput(witnessScript);
    p2wsh = true;
    witness = true;
    if (scriptSig.length === 0) {
      prevOutScript = btemplates.witnessScriptHash.output.encode(bcrypto.sha256(witnessScript));
      prevOutType = scriptTypes.P2WSH;
      if (redeemScript !== undefined) {
        throw new Error('Redeem script given when unnecessary');
      }
      // bare witness
    } else {
      if (!redeemScript) {
        throw new Error('No redeemScript provided for P2WSH, but scriptSig non-empty');
      }
      witnessProgram = btemplates.witnessScriptHash.output.encode(bcrypto.sha256(witnessScript));
      if (!redeemScript.equals(witnessProgram)) {
        throw new Error('Redeem script didn\'t match witnessScript');
      }
    }

    if (!supportedType(btemplates.classifyOutput(witnessScript))) {
      throw new Error('unsupported witness script');
    }

    script = witnessScript;
    scriptType = witnessScriptType;
    chunks = witnessStack.slice(0, -1);
  } else if (classifyWitness === scriptTypes.P2WPKH) {
    witness = true;
    const key = witnessStack[witnessStack.length - 1];
    const keyHash = bcrypto.hash160(key);
    if (scriptSig.length === 0) {
      prevOutScript = btemplates.witnessPubKeyHash.output.encode(keyHash);
      prevOutType = scriptTypes.P2WPKH;
      if (typeof redeemScript !== 'undefined') {
        throw new Error('Redeem script given when unnecessary');
      }
    } else {
      if (!redeemScript) {
        throw new Error('No redeemScript provided for P2WPKH, but scriptSig wasn\'t empty');
      }
      witnessProgram = btemplates.witnessPubKeyHash.output.encode(keyHash);
      if (!redeemScript.equals(witnessProgram)) {
        throw new Error('Redeem script did not have the right witness program');
      }
    }

    scriptType = scriptTypes.P2PKH;
    chunks = witnessStack;
  } else if (redeemScript) {
    if (!supportedP2SHType(redeemScriptType)) {
      throw new Error('Bad redeemscript!');
    }

    script = redeemScript;
    scriptType = redeemScriptType;
    chunks = scriptSigChunks.slice(0, -1);
  } else {
    prevOutType = scriptType = btemplates.classifyInput(scriptSig);
    chunks = scriptSigChunks;
  }

  const expanded = extractChunks(scriptType, chunks, script);

  const result = {
    pubKeys: expanded.pubKeys,
    signatures: expanded.signatures,
    prevOutScript,
    prevOutType,
    signType: scriptType,
    signScript: script,
    witness: Boolean(witness)
  };

  if (p2sh) {
    result.redeemScript = redeemScript;
    result.redeemScriptType = redeemScriptType;
  }

  if (p2wsh) {
    result.witnessScript = witnessScript;
    result.witnessScriptType = witnessScriptType;
  }

  return result;
}

// could be done in expandInput, but requires the original Transaction for hashForSignature
function fixMultisigOrder (input, transaction, vin) {
  if (input.redeemScriptType !== scriptTypes.MULTISIG || !input.redeemScript) return;
  if (input.pubKeys.length === input.signatures.length) return;

  const unmatched = input.signatures.concat();

  input.signatures = input.pubKeys.map(pubKey => {
    const keyPair = ECPair.fromPublicKeyBuffer(pubKey);
    let match;

    // check for a signature
    unmatched.some((signature, i) => {
      // skip if undefined || OP_0
      if (!signature) return false;

      // TODO: avoid O(n) hashForSignature
      const parsed = ECSignature.parseScriptSignature(signature);
      const hash = transaction.hashForSignature(vin, input.redeemScript, parsed.hashType);

      // skip if signature does not match pubKey
      if (!keyPair.verify(hash, parsed.signature)) return false;

      // remove matched signature from unmatched
      unmatched[i] = undefined;
      match = signature;

      return true;
    });

    return match;
  });
}

function expandOutput (script, scriptType, ourPubKey) {
  typeforce(types.Buffer, script);

  const scriptChunks = bscript.decompile(script);
  if (!scriptType) {
    scriptType = btemplates.classifyOutput(script);
  }

  let pubKeys = [];

  switch (scriptType) {
    // does our hash160(pubKey) match the output scripts?
    case scriptTypes.P2PKH:
      if (!ourPubKey) break;

      const pkh1 = scriptChunks[2];
      const pkh2 = bcrypto.hash160(ourPubKey);
      if (pkh1.equals(pkh2)) pubKeys = [ourPubKey];
      break;

      // does our hash160(pubKey) match the output scripts?
    case scriptTypes.P2WPKH:
      if (!ourPubKey) break;

      const wpkh1 = scriptChunks[1];
      const wpkh2 = bcrypto.hash160(ourPubKey);
      if (wpkh1.equals(wpkh2)) pubKeys = [ourPubKey];
      break;

    case scriptTypes.P2PK:
      pubKeys = scriptChunks.slice(0, 1);
      break;

    case scriptTypes.MULTISIG:
      pubKeys = scriptChunks.slice(1, -2);
      break;

    default:
      return { scriptType };
  }

  return {
    pubKeys,
    scriptType,
    signatures: pubKeys.map(() => undefined)
  };
}

function checkP2SHInput (input, redeemScriptHash) {
  if (input.prevOutType) {
    if (input.prevOutType !== scriptTypes.P2SH) throw new Error('PrevOutScript must be P2SH');

    const prevOutScriptScriptHash = bscript.decompile(input.prevOutScript)[1];
    if (!prevOutScriptScriptHash.equals(redeemScriptHash)) throw new Error('Inconsistent hash160(RedeemScript)');
  }
}

function checkP2WSHInput (input, witnessScriptHash) {
  if (input.prevOutType) {
    if (input.prevOutType !== scriptTypes.P2WSH) throw new Error('PrevOutScript must be P2WSH');

    const scriptHash = bscript.decompile(input.prevOutScript)[1];
    if (!scriptHash.equals(witnessScriptHash)) throw new Error('Inconsistent sha25(WitnessScript)');
  }
}

function prepareInput (input, kpPubKey, redeemScript, witnessValue, witnessScript) {
  let expanded;
  let prevOutType;
  let prevOutScript;

  let p2sh = false;
  let p2shType;
  let redeemScriptHash;

  let witness = false;
  let p2wsh = false;
  let witnessType;
  let witnessScriptHash;

  let signType;
  let signScript;

  if (redeemScript && witnessScript) {
    redeemScriptHash = bcrypto.hash160(redeemScript);
    witnessScriptHash = bcrypto.sha256(witnessScript);
    checkP2SHInput(input, redeemScriptHash);

    if (!redeemScript.equals(btemplates.witnessScriptHash.output.encode(witnessScriptHash))) throw new Error('Witness script inconsistent with redeem script');

    expanded = expandOutput(witnessScript, undefined, kpPubKey);
    if (!expanded.pubKeys) throw new Error(`WitnessScript not supported "${bscript.toASM(redeemScript)}"`);

    prevOutType = btemplates.types.P2SH;
    prevOutScript = btemplates.scriptHash.output.encode(redeemScriptHash);
    p2sh = witness = p2wsh = true;
    p2shType = btemplates.types.P2WSH;
    signType = witnessType = expanded.scriptType;
    signScript = witnessScript;
  } else if (redeemScript) {
    redeemScriptHash = bcrypto.hash160(redeemScript);
    checkP2SHInput(input, redeemScriptHash);

    expanded = expandOutput(redeemScript, undefined, kpPubKey);
    if (!expanded.pubKeys) throw new Error(`RedeemScript not supported "${bscript.toASM(redeemScript)}"`);

    prevOutType = btemplates.types.P2SH;
    prevOutScript = btemplates.scriptHash.output.encode(redeemScriptHash);
    p2sh = true;
    signType = p2shType = expanded.scriptType;
    signScript = redeemScript;
    witness = signType === btemplates.types.P2WPKH;
  } else if (witnessScript) {
    witnessScriptHash = bcrypto.sha256(witnessScript);
    checkP2WSHInput(input, witnessScriptHash);

    expanded = expandOutput(witnessScript, undefined, kpPubKey);
    if (!expanded.pubKeys) throw new Error(`WitnessScript not supported "${bscript.toASM(redeemScript)}"`);

    prevOutType = btemplates.types.P2WSH;
    prevOutScript = btemplates.witnessScriptHash.output.encode(witnessScriptHash);
    witness = p2wsh = true;
    signType = witnessType = expanded.scriptType;
    signScript = witnessScript;
  } else if (input.prevOutType) {
    // embedded scripts are not possible without a redeemScript
    if (input.prevOutType === scriptTypes.P2SH ||
      input.prevOutType === scriptTypes.P2WSH) {
      throw new Error(`PrevOutScript is ${input.prevOutType}, requires redeemScript`);
    }

    prevOutType = input.prevOutType;
    prevOutScript = input.prevOutScript;
    expanded = expandOutput(input.prevOutScript, input.prevOutType, kpPubKey);
    if (!expanded.pubKeys) return;

    witness = (input.prevOutType === scriptTypes.P2WPKH);
    signType = prevOutType;
    signScript = prevOutScript;
  } else {
    prevOutScript = btemplates.pubKeyHash.output.encode(bcrypto.hash160(kpPubKey));
    expanded = expandOutput(prevOutScript, scriptTypes.P2PKH, kpPubKey);

    prevOutType = scriptTypes.P2PKH;
    witness = false;
    signType = prevOutType;
    signScript = prevOutScript;
  }

  if (signType === scriptTypes.P2WPKH) {
    signScript = btemplates.pubKeyHash.output.encode(btemplates.witnessPubKeyHash.output.decode(signScript));
  }

  if (p2sh) {
    input.redeemScript = redeemScript;
    input.redeemScriptType = p2shType;
  }

  if (p2wsh) {
    input.witnessScript = witnessScript;
    input.witnessScriptType = witnessType;
  }

  input.pubKeys = expanded.pubKeys;
  input.signatures = expanded.signatures;
  input.signScript = signScript;
  input.signType = signType;
  input.prevOutScript = prevOutScript;
  input.prevOutType = prevOutType;
  input.witness = witness;
}

function buildStack (type, signatures, pubKeys, allowIncomplete) {
  if (type === scriptTypes.P2PKH) {
    if (signatures.length === 1 && Buffer.isBuffer(signatures[0]) && pubKeys.length === 1) return btemplates.pubKeyHash.input.encodeStack(signatures[0], pubKeys[0]);
  } else if (type === scriptTypes.P2PK) {
    if (signatures.length === 1 && Buffer.isBuffer(signatures[0])) return btemplates.pubKey.input.encodeStack(signatures[0]);
  } else if (type === scriptTypes.MULTISIG) {
    if (signatures.length > 0) {
      signatures = signatures.map(signature => signature || ops.OP_0);
      if (!allowIncomplete) {
        // remove blank signatures
        signatures = signatures.filter(x => x !== ops.OP_0);
      }

      return btemplates.multisig.input.encodeStack(signatures);
    }
  } else {
    throw new Error('Not yet supported');
  }

  if (!allowIncomplete) throw new Error('Not enough signatures provided');
  return [];
}

function buildInput (input, allowIncomplete) {
  let scriptType = input.prevOutType;
  let sig = [];
  let witness = [];

  if (supportedType(scriptType)) {
    sig = buildStack(scriptType, input.signatures, input.pubKeys, allowIncomplete);
  }

  let p2sh = false;
  if (scriptType === btemplates.types.P2SH) {
    // We can remove this error later when we have a guarantee prepareInput
    // rejects unsignable scripts - it MUST be signable at this point.
    if (!allowIncomplete && !supportedP2SHType(input.redeemScriptType)) {
      throw new Error('Impossible to sign this type');
    }

    if (supportedType(input.redeemScriptType)) {
      sig = buildStack(input.redeemScriptType, input.signatures, input.pubKeys, allowIncomplete);
    }

    // If it wasn't SIGNABLE, it's witness, defer to that
    if (input.redeemScriptType) {
      p2sh = true;
      scriptType = input.redeemScriptType;
    }
  }

  switch (scriptType) {
    // P2WPKH is a special case of P2PKH
    case btemplates.types.P2WPKH:
      witness = buildStack(btemplates.types.P2PKH, input.signatures, input.pubKeys, allowIncomplete);
      break;

    case btemplates.types.P2WSH:
      // We can remove this check later
      if (!allowIncomplete && !supportedType(input.witnessScriptType)) {
        throw new Error('Impossible to sign this type');
      }

      if (supportedType(input.witnessScriptType)) {
        witness = buildStack(input.witnessScriptType, input.signatures, input.pubKeys, allowIncomplete);
        witness.push(input.witnessScript);
        scriptType = input.witnessScriptType;
      }

      break;
  }

  // append redeemScript if necessary
  if (p2sh) {
    sig.push(input.redeemScript);
  }

  return {
    type: scriptType,
    script: bscript.compile(sig),
    witness
  };
}

class TransactionBuilder {
  constructor (network, maximumFeeRate) {
    this.prevTxMap = {};
    this.network = network || networks.bitcoin;

    // WARNING: This is __NOT__ to be relied on, its just another potential safety mechanism (safety in-depth)
    this.maximumFeeRate = maximumFeeRate || 2500;

    this.inputs = [];
    this.tx = new Transaction();
  }

  setLockTime (locktime) {
    typeforce(types.UInt32, locktime);

    // if any signatures exist, throw
    if (this.inputs.some(input => {
      if (!input.signatures) return false;

      return input.signatures.some(s => s);
    })) {
      throw new Error('No, this would invalidate signatures');
    }

    this.tx.locktime = locktime;
  }

  setVersion (version) {
    typeforce(types.UInt32, version);

    // XXX: this might eventually become more complex depending on what the versions represent
    this.tx.version = version;
  }

  addInput (txHash, vout, sequence, prevOutScript) {
    if (!this.__canModifyInputs()) {
      throw new Error('No, this would invalidate signatures');
    }

    let value;

    // is it a hex string?
    if (typeof txHash === 'string') {
      // transaction hashs's are displayed in reverse order, un-reverse it
      txHash = Buffer.from(txHash, 'hex').reverse();

      // is it a Transaction object?
    } else if (txHash instanceof Transaction) {
      const txOut = txHash.outs[vout];
      prevOutScript = txOut.script;
      value = txOut.value;

      txHash = txHash.getHash();
    }

    return this.__addInputUnsafe(txHash, vout, {
      sequence,
      prevOutScript,
      value
    });
  }

  __addInputUnsafe (txHash, vout, options) {
    if (Transaction.isCoinbaseHash(txHash)) {
      throw new Error('coinbase inputs not supported');
    }

    const prevTxOut = `${txHash.toString('hex')}:${vout}`;
    if (this.prevTxMap[prevTxOut] !== undefined) throw new Error(`Duplicate TxOut: ${prevTxOut}`);

    let input = {};

    // derive what we can from the scriptSig
    if (options.script !== undefined) {
      input = expandInput(options.script, options.witness || []);
    }

    // if an input value was given, retain it
    if (options.value !== undefined) {
      input.value = options.value;
    }

    // derive what we can from the previous transactions output script
    if (!input.prevOutScript && options.prevOutScript) {
      let prevOutType;

      if (!input.pubKeys && !input.signatures) {
        const expanded = expandOutput(options.prevOutScript);

        if (expanded.pubKeys) {
          input.pubKeys = expanded.pubKeys;
          input.signatures = expanded.signatures;
        }

        prevOutType = expanded.scriptType;
      }

      input.prevOutScript = options.prevOutScript;
      input.prevOutType = prevOutType || btemplates.classifyOutput(options.prevOutScript);
    }

    const vin = this.tx.addInput(txHash, vout, options.sequence, options.scriptSig);
    this.inputs[vin] = input;
    this.prevTxMap[prevTxOut] = vin;
    return vin;
  }

  addOutput (scriptPubKey, value) {
    if (!this.__canModifyOutputs()) {
      throw new Error('No, this would invalidate signatures');
    }

    // Attempt to get a script if it's a base58 address string
    if (typeof scriptPubKey === 'string') {
      scriptPubKey = baddress.toOutputScript(scriptPubKey, this.network);
    }

    return this.tx.addOutput(scriptPubKey, value);
  }

  build () {
    return this.__build(false);
  }

  buildIncomplete () {
    return this.__build(true);
  }

  __build (allowIncomplete) {
    if (!allowIncomplete) {
      if (!this.tx.ins.length) throw new Error('Transaction has no inputs');
      if (!this.tx.outs.length) throw new Error('Transaction has no outputs');
    }

    const tx = this.tx.clone();
    // Create script signatures from inputs
    this.inputs.forEach((input, i) => {
      const scriptType = input.witnessScriptType || input.redeemScriptType || input.prevOutType;
      if (!scriptType && !allowIncomplete) throw new Error('Transaction is not complete');
      const result = buildInput(input, allowIncomplete);

      // skip if no result
      if (!allowIncomplete) {
        if (!supportedType(result.type) && result.type !== btemplates.types.P2WPKH) {
          throw new Error(`${result.type} not supported`);
        }
      }

      tx.setInputScript(i, result.script);
      tx.setWitness(i, result.witness);
    });

    if (!allowIncomplete) {
      // do not rely on this, its merely a last resort
      if (this.__overMaximumFees(tx.virtualSize())) {
        throw new Error('Transaction has absurd fees');
      }
    }

    return tx;
  }

  sign (vin, keyPair, redeemScript, hashType, witnessValue, witnessScript) {
    // TODO: remove keyPair.network matching in 4.0.0
    if (keyPair.network && keyPair.network !== this.network) throw new TypeError('Inconsistent network');
    if (!this.inputs[vin]) throw new Error(`No input at index: ${vin}`);
    hashType = hashType || Transaction.SIGHASH_ALL;

    const input = this.inputs[vin];

    // if redeemScript was previously provided, enforce consistency
    if (input.redeemScript !== undefined &&
      redeemScript &&
      !input.redeemScript.equals(redeemScript)) {
      throw new Error('Inconsistent redeemScript');
    }

    const kpPubKey = keyPair.publicKey || keyPair.getPublicKeyBuffer();
    if (!canSign(input)) {
      if (witnessValue !== undefined) {
        if (input.value !== undefined && input.value !== witnessValue) throw new Error('Input didn\'t match witnessValue');
        typeforce(types.Satoshi, witnessValue);
        input.value = witnessValue;
      }

      if (!canSign(input)) prepareInput(input, kpPubKey, redeemScript, witnessValue, witnessScript);
      if (!canSign(input)) throw Error(`${input.prevOutType} not supported`);
    }

    // ready to sign
    let signatureHash;
    if (input.witness) {
      signatureHash = this.tx.hashForWitnessV0(vin, input.signScript, input.value, hashType);
    } else {
      signatureHash = this.tx.hashForSignature(vin, input.signScript, hashType);
    }

    // enforce in order signing of public keys
    const signed = input.pubKeys.some((pubKey, i) => {
      if (!kpPubKey.equals(pubKey)) return false;
      if (input.signatures[i]) throw new Error('Signature already exists');
      if (kpPubKey.length !== 33 &&
        input.signType === scriptTypes.P2WPKH) throw new Error('BIP143 rejects uncompressed public keys in P2WPKH or P2WSH');

      let signature = keyPair.sign(signatureHash);
      if (Buffer.isBuffer(signature)) signature = ECSignature.fromRSBuffer(signature);

      input.signatures[i] = signature.toScriptSignature(hashType);
      return true;
    });

    if (!signed) throw new Error('Key pair cannot sign for this input');
  }

  __canModifyInputs () {
    return this.inputs.every(input => {
      // any signatures?
      if (input.signatures === undefined) return true;

      return input.signatures.every(signature => {
        if (!signature) return true;
        const hashType = signatureHashType(signature);

        // if SIGHASH_ANYONECANPAY is set, signatures would not
        // be invalidated by more inputs
        return hashType & Transaction.SIGHASH_ANYONECANPAY;
      });
    });
  }

  __canModifyOutputs () {
    const nInputs = this.tx.ins.length;
    const nOutputs = this.tx.outs.length;

    return this.inputs.every(input => {
      if (input.signatures === undefined) return true;

      return input.signatures.every(signature => {
        if (!signature) return true;
        const hashType = signatureHashType(signature);

        const hashTypeMod = hashType & 0x1f;
        if (hashTypeMod === Transaction.SIGHASH_NONE) return true;
        if (hashTypeMod === Transaction.SIGHASH_SINGLE) {
          // if SIGHASH_SINGLE is set, and nInputs > nOutputs
          // some signatures would be invalidated by the addition
          // of more outputs
          return nInputs <= nOutputs;
        }
      });
    });
  }

  __overMaximumFees (bytes) {
    // not all inputs will have .value defined
    const incoming = this.inputs.reduce((a, x) => a + (x.value >>> 0), 0);

    // but all outputs do, and if we have any input value
    // we can immediately determine if the outputs are too small
    const outgoing = this.tx.outs.reduce((a, x) => a + x.value, 0);
    const fee = incoming - outgoing;
    const feeRate = fee / bytes;

    return feeRate > this.maximumFeeRate;
  }
}

TransactionBuilder.fromTransaction = (transaction, network) => {
  const txb = new TransactionBuilder(network);

  // Copy transaction fields
  txb.setVersion(transaction.version);
  txb.setLockTime(transaction.locktime);

  // Copy outputs (done first to avoid signature invalidation)
  transaction.outs.forEach(txOut => {
    txb.addOutput(txOut.script, txOut.value);
  });

  // Copy inputs
  transaction.ins.forEach(txIn => {
    txb.__addInputUnsafe(txIn.hash, txIn.index, {
      sequence: txIn.sequence,
      script: txIn.script,
      witness: txIn.witness
    });
  });

  // fix some things not possible through the public API
  txb.inputs.forEach((input, i) => {
    fixMultisigOrder(input, transaction, i);
  });

  return txb;
};

function canSign (input) {
  return input.prevOutScript !== undefined &&
    input.signScript !== undefined &&
    input.pubKeys !== undefined &&
    input.signatures !== undefined &&
    input.signatures.length === input.pubKeys.length &&
    input.pubKeys.length > 0 &&
    (
      input.witness === false ||
      (input.witness === true && input.value !== undefined)
    );
}

function signatureHashType (buffer) {
  return buffer.readUInt8(buffer.length - 1);
}

module.exports = TransactionBuilder;
