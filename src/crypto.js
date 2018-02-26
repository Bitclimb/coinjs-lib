const crypto = require('crypto');

function ripemd160 (buffer) {
  return crypto.createHash('rmd160').update(buffer).digest();
}

function sha1 (buffer) {
  return crypto.createHash('sha1').update(buffer).digest();
}

function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function randomBytes (len) {
  return crypto.randomBytes(len);
}

function hash160 (buffer) {
  return ripemd160(sha256(buffer));
}

function hash256 (buffer) {
  return sha256(sha256(buffer));
}

module.exports = {
  hash160,
  hash256,
  ripemd160,
  sha1,
  sha256,
  randomBytes,
  createHmac: crypto.createHmac
};