// Cross-platform cryptographic utilities for Offline Auth & Local Storage sealing.
// Uses pure-JS SHA-256 / HMAC-SHA256 / PBKDF2-HMAC-SHA256 so it works identically
// on HTTPS, Capacitor native shells, AND HTTP LAN origins where window.crypto.subtle is absent.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const textEncoder = new TextEncoder();

function utf8Bytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return textEncoder.encode(String(input || ''));
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const data = utf8Bytes(input);
  const bitLen = data.length * 8;
  const padLen = ((56 - ((data.length + 1) % 64)) + 64) % 64;
  const totalLen = data.length + 1 + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data, 0);
  padded[data.length] = 0x80;

  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, hi, false);
  view.setUint32(totalLen - 4, lo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(input));
}

export function hmacSha256Bytes(keyInput: string | Uint8Array, msgInput: string | Uint8Array): Uint8Array {
  let key = utf8Bytes(keyInput);
  if (key.length > 64) key = sha256Bytes(key);
  const kPad = new Uint8Array(64);
  kPad.set(key, 0);

  const iKey = new Uint8Array(64);
  const oKey = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    iKey[i] = kPad[i] ^ 0x36;
    oKey[i] = kPad[i] ^ 0x5c;
  }

  const msg = utf8Bytes(msgInput);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(iKey, 0);
  inner.set(msg, 64);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(64 + 32);
  outer.set(oKey, 0);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}

export function generateRandomHex(byteLength = 16): string {
  const buf = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < byteLength; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(buf);
}

export async function pbkdf2Sha256Hex(
  password: string,
  saltHex: string,
  iterations = 12000
): Promise<string> {
  const passBytes = utf8Bytes(password);
  const saltBytes = hexToBytes(saltHex);

  // Prefer native WebCrypto PBKDF2 when running in secure context (HTTPS / localhost / Capacitor)
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function') {
    try {
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passBytes as unknown as BufferSource,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes as unknown as BufferSource,
          iterations,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      return bytesToHex(new Uint8Array(bits));
    } catch {
      // Fallback to pure-JS PBKDF2 below
    }
  }

  // Pure-JS PBKDF2-HMAC-SHA256 fallback (safe for HTTP LAN !isSecureContext)
  const block1Input = new Uint8Array(saltBytes.length + 4);
  block1Input.set(saltBytes, 0);
  block1Input[saltBytes.length] = 0;
  block1Input[saltBytes.length + 1] = 0;
  block1Input[saltBytes.length + 2] = 0;
  block1Input[saltBytes.length + 3] = 1;

  let u = hmacSha256Bytes(passBytes, block1Input);
  const result = new Uint8Array(u);
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256Bytes(passBytes, u);
    for (let j = 0; j < 32; j++) {
      result[j] ^= u[j];
    }
  }
  return bytesToHex(result);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Lightweight authenticated envelope for non-Electron IndexedDB storage (device-scoped key + HMAC-SHA256)
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function sealWithDeviceSecret(plainJson: unknown, secretSeed: string): {
  sealed: true;
  v: 1;
  iv: string;
  tag: string;
  ct: string;
} {
  const plainBytes = utf8Bytes(JSON.stringify(plainJson));
  const ivHex = generateRandomHex(16);
  const keyBytes = sha256Bytes(`AWLAD_SEAL::${secretSeed}`);
  const ct = new Uint8Array(plainBytes.length);

  let offset = 0;
  let counter = 0;
  while (offset < plainBytes.length) {
    const block = sha256Bytes(
      new Uint8Array([...keyBytes, ...hexToBytes(ivHex), counter & 0xff, (counter >> 8) & 0xff])
    );
    for (let i = 0; i < block.length && offset < plainBytes.length; i++, offset++) {
      ct[offset] = plainBytes[offset] ^ block[i];
    }
    counter += 1;
  }

  const tag = bytesToHex(hmacSha256Bytes(keyBytes, `${ivHex}:${bytesToBase64(ct)}`));
  return {
    sealed: true,
    v: 1,
    iv: ivHex,
    tag,
    ct: bytesToBase64(ct),
  };
}

export function unsealWithDeviceSecret<T = unknown>(
  envelope: { sealed?: boolean; v?: number; iv?: string; tag?: string; ct?: string } | null | undefined,
  secretSeed: string
): T | null {
  if (!envelope || !envelope.sealed || !envelope.iv || !envelope.tag || !envelope.ct) return null;
  try {
    const keyBytes = sha256Bytes(`AWLAD_SEAL::${secretSeed}`);
    const expectedTag = bytesToHex(hmacSha256Bytes(keyBytes, `${envelope.iv}:${envelope.ct}`));
    if (!constantTimeEqual(expectedTag, envelope.tag)) {
      return null;
    }
    const ct = base64ToBytes(envelope.ct);
    const plain = new Uint8Array(ct.length);
    let offset = 0;
    let counter = 0;
    while (offset < ct.length) {
      const block = sha256Bytes(
        new Uint8Array([...keyBytes, ...hexToBytes(envelope.iv), counter & 0xff, (counter >> 8) & 0xff])
      );
      for (let i = 0; i < block.length && offset < ct.length; i++, offset++) {
        plain[offset] = ct[offset] ^ block[i];
      }
      counter += 1;
    }
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
