// Keccak-256 as Ethereum uses it (the original Keccak padding, not SHA3-256's), so the publisher needs no package:
// node:crypto's "sha3-256" gives other values. Each 64-bit lane is two 32-bit words, low word first.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RC_LO = Uint32Array.from(RC, (c) => Number(c & 0xffffffffn));
const RC_HI = Uint32Array.from(RC, (c) => Number(c >> 32n));

/** The rho rotation of lane x + 5y. */
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
/** The pi step moves lane x + 5y to lane y + 5((2x + 3y) mod 5). */
const PI = Array.from({ length: 25 }, (_, i) => {
  const x = i % 5;
  const y = (i - x) / 5;
  return y + 5 * ((2 * x + 3 * y) % 5);
});

const RATE = 136;

/** @param {Uint32Array} s 50 words: the 25 lanes. */
function permute(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      c[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      c[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const n = (x + 1) % 5;
      const p = (x + 4) % 5;
      const lo = c[2 * p] ^ ((c[2 * n] << 1) | (c[2 * n + 1] >>> 31));
      const hi = c[2 * p + 1] ^ ((c[2 * n + 1] << 1) | (c[2 * n] >>> 31));
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= lo;
        s[2 * (x + y) + 1] ^= hi;
      }
    }
    for (let i = 0; i < 25; i++) {
      const lo = s[2 * i];
      const hi = s[2 * i + 1];
      const r = ROT[i];
      const j = PI[i];
      if (r === 0) {
        b[2 * j] = lo;
        b[2 * j + 1] = hi;
      } else if (r < 32) {
        b[2 * j] = (lo << r) | (hi >>> (32 - r));
        b[2 * j + 1] = (hi << r) | (lo >>> (32 - r));
      } else if (r === 32) {
        b[2 * j] = hi;
        b[2 * j + 1] = lo;
      } else {
        const m = r - 32;
        b[2 * j] = (hi << m) | (lo >>> (32 - m));
        b[2 * j + 1] = (lo << m) | (hi >>> (32 - m));
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = x + y;
        const i1 = ((x + 1) % 5) + y;
        const i2 = ((x + 2) % 5) + y;
        s[2 * i] = b[2 * i] ^ (~b[2 * i1] & b[2 * i2]);
        s[2 * i + 1] = b[2 * i + 1] ^ (~b[2 * i1 + 1] & b[2 * i2 + 1]);
      }
    }
    s[0] ^= RC_LO[round];
    s[1] ^= RC_HI[round];
  }
}

const encoder = new TextEncoder();

/**
 * Keccak-256 of `input`: a string is hashed as its UTF-8 bytes, as viem's keccak256(toBytes(text)) does.
 * @param {string | Uint8Array} input
 * @returns {string} 0x and 64 lowercase hex digits
 */
export function keccak256(input) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const padded = new Uint8Array(bytes.length + RATE - (bytes.length % RATE));
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Uint32Array(50);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let k = 0; k < RATE; k += 4) {
      s[k >> 2] ^= padded[off + k] | (padded[off + k + 1] << 8) | (padded[off + k + 2] << 16) | (padded[off + k + 3] << 24);
    }
    permute(s);
  }
  let hex = "0x";
  for (let w = 0; w < 8; w++) {
    for (let k = 0; k < 4; k++) hex += ((s[w] >>> (8 * k)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}
