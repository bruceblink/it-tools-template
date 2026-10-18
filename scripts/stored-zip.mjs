const crcTable = Uint32Array.from({ length: 256 }, (_value, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

/** Write a deterministic, uncompressed ZIP with bounded 32-bit entries. */
export function createStoredZip(entries) {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new RangeError('A stored ZIP must contain between 1 and 65535 files.');
  }

  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const contents = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents);
    if (name.length === 0 || name.length > 0xffff || contents.length > 0xffffffff) {
      throw new RangeError('A stored ZIP path or file exceeds the format limit.');
    }

    const checksum = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0x0021, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([localHeader, name, contents]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([centralHeader, name]));
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  if (localOffset > 0xffffffff || centralDirectory.length > 0xffffffff) {
    throw new RangeError('A stored ZIP exceeds the non-ZIP64 archive limit.');
  }

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

/** Calculate ZIP CRC-32 with a lookup table for large but bounded resources. */
export function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
