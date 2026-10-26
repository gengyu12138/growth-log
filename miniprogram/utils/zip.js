// ZIP Store 模式：逐文件写入，不重新压缩照片，不在内存中拼接整个备份包。
// 格式依据 PKWARE APPNOTE 4.3；本工具仅支持受控 ASCII 路径和非 ZIP64 小文件。
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[i] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8(text) {
  const bytes = [];
  for (const char of text) {
    let code = char.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return new Uint8Array(bytes);
}

function createZip(append, maxBytes = 80 * 1024 * 1024) {
  let offset = 0, finished = false;
  const directory = [], names = new Set();
  async function write(bytes) {
    await append(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    offset += bytes.byteLength;
  }
  return {
    async add(name, bytes) {
      if (finished || names.has(name) || !/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || name.startsWith('/')) throw new Error('备份文件名无效');
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      const path = utf8(name), crc = crc32(bytes);
      const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
      if (offset + bytes.length + 30 + path.length + directorySize + 46 + path.length + 22 > maxBytes || directory.length >= 65534) {
        throw new Error('备份超过 80 MB，请缩小照片日期范围后重试');
      }
      const local = new Uint8Array(30 + path.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true);
      l.setUint16(12, 33, true); // DOS 日期 1980-01-01；拍摄日期保留在记录清单中。
      l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true);
      l.setUint16(26, path.length, true); local.set(path, 30);
      const central = new Uint8Array(46 + path.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(14, 33, true); c.setUint32(16, crc, true);
      c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, path.length, true);
      c.setUint32(42, offset, true); central.set(path, 46);
      await write(local); if (bytes.length) await write(bytes);
      directory.push(central); names.add(name);
    },
    async finish() {
      if (finished) throw new Error('备份已经结束');
      finished = true;
      const start = offset;
      for (const entry of directory) await write(entry);
      const end = new Uint8Array(22), view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true); view.setUint16(8, directory.length, true); view.setUint16(10, directory.length, true);
      view.setUint32(12, offset - start, true); view.setUint32(16, start, true);
      await write(end);
      return offset;
    },
  };
}

module.exports = { createZip, utf8 };
