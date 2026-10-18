import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const forge = require('node-forge');

// Exercise the production transitive dependency, without adding it to the public API.
const yamlRequire = createRequire(createRequire(require.resolve('composerize-ts')).resolve('yamljs'));
const { sprintf } = createRequire(yamlRequire.resolve('argparse'))('sprintf-js');

test('sprintf retains ordinary formatting and rejects excessive width or precision', () => {
  assert.equal(sprintf('%04d / %.2f / %s', 7, 1.25, 'ok'), '0007 / 1.25 / ok');
  assert.equal(sprintf('%10000s', 'ok').length, 10000);
  for (const format of ['%10001s', '%.10001s', '%1000000000d', '%.99999999999999999999999f']) {
    assert.throws(() => sprintf(format, 1), /width or precision exceeds/);
  }
});

test('RSA verification accepts canonical DigestInfo and rejects extra nested algorithm elements', () => {
  // Private material stays in memory and is discarded after this regression test.
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const digest = forge.md.sha256.create().update('signature regression').digest().getBytes();
  const { asn1 } = forge;
  function encodeDigestInfo(extraElements, includeNull = true) {
    const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(forge.pki.oids.sha256).getBytes())];
    if (includeNull) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''));
    algorithm.push(...extraElements);
    return asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
    ])).getBytes();
  }
  for (const includeNull of [true, false]) {
    assert.equal(publicKey.verify(digest, privateKey.sign(encodeDigestInfo([], includeNull), 'NONE')), true);
  }
  for (const extra of [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'extra'),
  ]) {
    const signature = privateKey.sign(encodeDigestInfo([extra]), 'NONE');
    assert.throws(() => publicKey.verify(digest, signature), /DigestInfo/);
  }
});
