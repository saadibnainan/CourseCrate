// Minimal ZIP writer. Files are stored, not compressed: course material is
// mostly PDF, Office, image and video files that are already compressed, and
// storing keeps memory and CPU use flat. UTF-8 names, no ZIP64 (4 GB cap).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Incremental CRC-32: crc32(chunk2, crc32(chunk1)). */
export function crc32(bytes, crc = 0) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export const ZIP_LIMIT = 0xffffffff - 64 * 1024 * 1024;

export class ZipTooLargeError extends Error {
  constructor() {
    super('This course is too big for a single ZIP (4 GB limit). Switch to "Folders" and run again.');
    this.name = 'ZipTooLargeError';
  }
}

export class ZipWriter {
  #parts = [];
  #central = [];
  #offset = 0;
  #names = new Set();
  #entries = 0;
  #enc = new TextEncoder();

  get size() { return this.#offset; }
  get count() { return this.#entries; }

  /**
   * @param {string} path   "Course/01 - Week 1/slides.pdf"
   * @param {(Uint8Array|Blob)[]} chunks file content
   * @param {number} size   total bytes
   * @param {number} crc    CRC-32 of the content
   * @param {Date} [mtime]
   */
  add(path, chunks, size, crc, mtime = new Date()) {
    if (this.#names.has(path)) return;
    if (this.#offset + size + 30 + path.length * 3 > ZIP_LIMIT || this.#entries >= 0xfffe) {
      throw new ZipTooLargeError();
    }
    this.#names.add(path);
    const name = this.#enc.encode(path);
    const { time, date } = dosDateTime(mtime);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 0x0314, true); // made by: Unix, spec 2.0
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r--
    central.setUint32(42, this.#offset, true);

    this.#parts.push(local.buffer, name, ...chunks);
    this.#central.push(central.buffer, name);
    this.#offset += 30 + name.length + size;
    this.#entries++;
  }

  addText(path, text, mtime) {
    const bytes = this.#enc.encode(text);
    this.add(path, [bytes], bytes.length, crc32(bytes), mtime);
  }

  /** @returns {Blob} */
  finish() {
    const cdSize = this.#central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.#offset, true);
    return new Blob([...this.#parts, ...this.#central, end.buffer], { type: 'application/zip' });
  }
}
