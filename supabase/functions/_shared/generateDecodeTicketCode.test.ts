/* eslint-disable no-console */
import { YEAR_MASK } from './ticketDataType.ts';
import type { TicketData } from './ticketDataType.ts';

type QRPayload = {
  code: string;
  exp: number;
};

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
};

const assertTicketDataEqual = (
  actual: TicketData | null,
  expected: TicketData,
  message: string,
) => {
  if (!actual) {
    throw new Error(`${message}\nactual is null`);
  }
  if (
    actual.affiliation !== expected.affiliation ||
    actual.relationship !== expected.relationship ||
    actual.type !== expected.type ||
    actual.performance !== expected.performance ||
    actual.schedule !== expected.schedule ||
    actual.year !== (expected.year & Number(YEAR_MASK)) ||
    actual.serial !== expected.serial
  ) {
    throw new Error(
      `${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`,
    );
  }
};

const createTestEnv = async () => {
  const macKey = crypto.getRandomValues(new Uint8Array(32));
  const cipherKey = crypto.getRandomValues(new Uint8Array(32));
  const edKeyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify'],
  );

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', edKeyPair.privateKey),
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey('spki', edKeyPair.publicKey),
  );

  const publicKeySpkiBase64 = toBase64(spki);

  Deno.env.set('BASE58_ALPHABET', BASE58_ALPHABET);
  Deno.env.set('TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64', toBase64(macKey));
  Deno.env.set('TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64', toBase64(cipherKey));
  Deno.env.set('TICKET_SIGNING_PRIVATE_KEY_Ed25519_BASE64', toBase64(pkcs8));

  const { generateTicketCode, signCode } =
    await import('./generateTicketCode.ts');
  const { decodeTicketCode } = await import('./decodeTicketCode.ts');
  const { verifyCodeSignature } = await import('./verifyCodeSignature.ts');

  return {
    generateTicketCode,
    decodeTicketCode,
    signCode,
    verifyCodeSignature,
    publicKeySpkiBase64,
  };
};

let setupCache: Awaited<ReturnType<typeof createTestEnv>> | null = null;

const setupTestEnv = async () => {
  if (setupCache) {
    return setupCache;
  }

  setupCache = await createTestEnv();
  return setupCache;
};

const createQR = async (
  payload: QRPayload,
  signCode: (code: string) => Promise<string>,
): Promise<string> => {
  const payloadText = JSON.stringify(payload);
  const signature = await signCode(payloadText);

  return `${payloadText}.${signature}`;
};

const restoreQR = async (
  token: string,
  publicKeySpkiBase64: string,
  verifyCodeSignature: (
    code: string,
    signature: string,
    publicKeySpkiBase64: string,
  ) => Promise<boolean>,
  now = Date.now(),
): Promise<QRPayload> => {
  if (!token) {
    throw new Error('empty token');
  }

  const delimiter = token.lastIndexOf('.');
  if (delimiter <= 0 || delimiter === token.length - 1) {
    throw new Error('malformed token');
  }

  const payloadText = token.slice(0, delimiter);
  const signatureText = token.slice(delimiter + 1);

  let payload: QRPayload;
  try {
    payload = JSON.parse(payloadText) as QRPayload;
  } catch {
    throw new Error('invalid payload');
  }

  const ok = await verifyCodeSignature(
    payloadText,
    signatureText,
    publicKeySpkiBase64,
  );

  if (!ok) {
    throw new Error('invalid signature');
  }

  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('expired token');
  }

  return payload;
};

const isValidQR = async (
  token: string,
  publicKeySpkiBase64: string,
  verifyCodeSignature: (
    code: string,
    signature: string,
    publicKeySpkiBase64: string,
  ) => Promise<boolean>,
  now = Date.now(),
): Promise<boolean> => {
  try {
    await restoreQR(token, publicKeySpkiBase64, verifyCodeSignature, now);
    return true;
  } catch {
    return false;
  }
};

Deno.test({
  name: 'convertAffiliation encode and decode are consistent',
  fn: async () => {
    const { encodeAffiliation, decodeAffiliation, getAffiliationEligibility } =
      await import('./convertAffiliation.ts');
    const cases = [
      {
        affiliation: 0,
        relationship: 0,
      },
      {
        affiliation: 10101, // Grade 1, Class 1, Number 1
        relationship: 0,
      },
      {
        affiliation: 21563, // Grade 2, Class 15, Number 63 (Max)
        relationship: 2,
      },
      {
        affiliation: 31663, // Grade 3, Class 16, Number 63
        relationship: 7,
      },
      {
        affiliation: 100001, // 中学生モード: flag 0, ID 1
        relationship: 0,
        eligibility: 'middle-school',
      },
      {
        affiliation: 103839, // 中学生モードの上限値
        relationship: 5,
        eligibility: 'both',
      },
      {
        affiliation: 100257, // 中学生モード: flag 1, ID 257
        relationship: 2,
        eligibility: 'guardian',
      },
      {
        affiliation: 101025, // 中学生モード: flag 2, ID 1025
        relationship: 5,
        eligibility: 'both',
      },
      {
        affiliation: 103839, // 中学生モード: ID 3839 (最大)
        relationship: 5, // 入場資格2 + juniorId Bit10
        eligibility: 'both',
      },
    ];

    for (const { affiliation, relationship, eligibility } of cases) {
      const encoded = encodeAffiliation(affiliation);
      const serialExtraBit =
        affiliation >= 100001 ? ((affiliation - 100000) >> 11) & 0x1 : 0;
      const decoded = decodeAffiliation(encoded, relationship, serialExtraBit);
      if (decoded !== affiliation) {
        throw new Error(
          `Affiliation round-trip mismatch: original=${affiliation} decoded=${decoded}`,
        );
      }

      if (eligibility) {
        const resolvedEligibility = getAffiliationEligibility(
          encoded,
          relationship,
        );
        if (resolvedEligibility !== eligibility) {
          throw new Error(
            `Eligibility mismatch: original=${affiliation} relationship=${relationship} eligibility=${resolvedEligibility}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: 'getAffiliationEligibility returns null for non-junior and day-ticket modes',
  fn: async () => {
    const { encodeAffiliation, getAffiliationEligibility } =
      await import('./convertAffiliation.ts');

    const nonJuniorBits = encodeAffiliation(10101);
    const dayTicketBits = encodeAffiliation(1601);

    if (getAffiliationEligibility(0, 0) !== null) {
      throw new Error('Expected null for anonymous affiliation');
    }
    if (getAffiliationEligibility(nonJuniorBits, 2) !== null) {
      throw new Error('Expected null for non-junior affiliation');
    }
    if (getAffiliationEligibility(dayTicketBits, 2) !== null) {
      throw new Error('Expected null for day-ticket affiliation');
    }
  },
});

Deno.test({
  name: 'generateTicketCode -> decodeTicketCode round-trip keeps original data',
  permissions: { env: true },
  fn: async () => {
    const { generateTicketCode, decodeTicketCode } = await setupTestEnv();

    const cases: Array<{ source: TicketData; expected: TicketData }> = [
      {
        source: {
          affiliation: 10101, // Grade 1, Class 1, Number 1
          relationship: 1,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 1,
        },
        expected: {
          affiliation: 10101,
          relationship: 1,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 1,
        },
      },
      {
        source: {
          affiliation: 100001, // 中学生モード: flag 0, ID 1
          relationship: 0,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 1,
        },
        expected: {
          affiliation: 100001,
          relationship: 0,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 1,
        },
      },
      {
        source: {
          affiliation: 100001,
          relationship: 2,
          type: 5,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 6,
        },
        expected: {
          affiliation: 100001,
          relationship: 2,
          type: 5,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 6,
        },
      },
      {
        source: {
          affiliation: 101919, // 中学生モード上限
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 2,
        },
        expected: {
          affiliation: 101919,
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 2,
        },
      },
      {
        source: {
          affiliation: 100257, // 中学生モード: flag 1, ID 257
          relationship: 1,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 3,
        },
        expected: {
          affiliation: 100257,
          relationship: 1,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 3,
        },
      },
      {
        source: {
          affiliation: 101025, // 中学生モード: flag 2, ID 1025
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 4,
        },
        expected: {
          affiliation: 101025,
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 4,
        },
      },
      {
        source: {
          affiliation: 103839, // 中学生モード: ID 3839（Bit11を使用）
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 15,
        },
        expected: {
          affiliation: 103839,
          relationship: 2,
          type: 1,
          performance: 1,
          schedule: 1,
          year: 2025,
          serial: 15,
        },
      },
      {
        source: {
          affiliation: 21563, // Grade 2, Class 15, Number 63 (Max)
          relationship: 2,
          type: 4,
          performance: 11,
          schedule: 8,
          year: 2020,
          serial: 15,
        },
        expected: {
          affiliation: 21563,
          relationship: 2,
          type: 4,
          performance: 11,
          schedule: 8,
          year: 2020,
          serial: 15,
        },
      },
      {
        source: {
          affiliation: 31663, // Grade 3, Class 16, Number 63
          relationship: 7,
          type: 15,
          performance: 31,
          schedule: 15,
          year: 2080,
          serial: 31, // 5bit max
        },
        expected: {
          affiliation: 31663,
          relationship: 7,
          type: 15,
          performance: 31,
          schedule: 15,
          year: 2080,
          serial: 31,
        },
      },
    ];

    const dayTicketCases: TicketData[] = [
      {
        affiliation: 1600, // Grade 0, Class 16, Number 0 -> 当日券モード
        relationship: 3,
        type: 1, // Typeが当日券以外でも affiliation で当日券モードになる
        performance: 1,
        schedule: 1,
        year: 2025,
        serial: 31,
      },
      {
        affiliation: 1600, // Grade 0, Class 16
        relationship: 2,
        type: 8,
        performance: 5,
        schedule: 2,
        year: 2025,
        serial: 12,
      },
      {
        affiliation: 10101, // Grade 1, Class 1 -> 通常モード (Type 8/9であっても)
        relationship: 0,
        type: 8,
        performance: 1,
        schedule: 1,
        year: 2025,
        serial: 10,
      },
    ];

    for (const { source, expected } of cases) {
      const code = await generateTicketCode(source);
      const decoded = await decodeTicketCode(code);
      console.debug(`Source data: ${JSON.stringify(source)}`);
      console.debug(`Decoded data: ${JSON.stringify(decoded)}`);
      assertTicketDataEqual(
        decoded,
        expected,
        `round-trip mismatch for code=${code}`,
      );
    }

    for (const source of dayTicketCases) {
      const code = await generateTicketCode(source);
      const decoded = await decodeTicketCode(code);
      console.debug(`Source data: ${JSON.stringify(source)}`);
      console.debug(`Decoded data: ${JSON.stringify(decoded)}`);
      assertTicketDataEqual(
        decoded,
        source,
        `round-trip mismatch for code=${code}`,
      );
    }
  },
});

Deno.test({
  name: 'Day ticket serial number extension (11-bit) works at boundaries',
  permissions: { env: true },
  fn: async () => {
    const { generateTicketCode, decodeTicketCode } = await setupTestEnv();

    // Grade 0, Class 16 (内部的には1600) は当日券フラグとして扱われる
    const dayTicketAffiliation = 1600;

    // 11ビットの境界値テスト: 0, 31 (5bit最大), 32 (拡張開始), 2047 (11bit最大)
    const testSerials = [0, 31, 32, 1024, 2047];

    for (const serial of testSerials) {
      const source: TicketData = {
        affiliation: dayTicketAffiliation,
        relationship: 1,
        type: 8,
        performance: 1,
        schedule: 1,
        year: 2025,
        serial,
      };

      const code = await generateTicketCode(source);
      const decoded = await decodeTicketCode(code);

      assertTicketDataEqual(
        decoded,
        source,
        `Day ticket serial 11-bit extension failed for serial=${serial}`,
      );
    }

    // 11ビットの上限超過 (2048) でエラーになることを確認
    let overflowError: unknown;
    try {
      await generateTicketCode({
        affiliation: dayTicketAffiliation,
        relationship: 1,
        type: 8,
        performance: 1,
        schedule: 1,
        year: 2025,
        serial: 2048,
      });
    } catch (e) {
      overflowError = e;
    }

    if (
      !(overflowError instanceof Error) ||
      !overflowError.message.includes('serial out of range')
    ) {
      throw new Error(
        'Expected serial=2048 to throw out of range error for day ticket',
      );
    }
  },
});

Deno.test({
  name: 'generateTicketCode rejects junior affiliations that collide with day tickets',
  permissions: { env: true },
  fn: async () => {
    const { generateTicketCode } = await setupTestEnv();
    let thrown: unknown;
    try {
      await generateTicketCode({
        affiliation: 100960, // class bits 15 => day ticket overlap
        relationship: 0,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2025,
        serial: 1,
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('Expected junior/day-ticket overlap to throw');
    }
  },
});

Deno.test({
  name: 'generateTicketCode rejects out-of-range junior relationship flags',
  permissions: { env: true },
  fn: async () => {
    const { generateTicketCode } = await setupTestEnv();
    let thrown: unknown;
    try {
      await generateTicketCode({
        affiliation: 100001,
        relationship: 3, // junior flag supports only 0..2
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2025,
        serial: 1,
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error(
        'Expected out-of-range junior relationship flag to throw',
      );
    }
  },
});

Deno.test({
  name: 'generateTicketCode throws error for out-of-range values',
  permissions: { env: true },
  fn: async () => {
    const { generateTicketCode } = await setupTestEnv();

    const outOfRangeCases: TicketData[] = [
      {
        affiliation: 40101, // Grade 4 (out of 0-3)
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 11701, // Class 17 (out of 1-16)
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10164, // Number 64 (out of 0-63)
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 103840, // junior affiliation upper bound exceeded
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10101,
        relationship: 8, // 3bit max is 7
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10101,
        relationship: 1,
        type: 16, // 4bit max is 15
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10101,
        relationship: 1,
        type: 1,
        performance: 32, // 5bit max is 31
        schedule: 1,
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10101,
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 16, // 4bit max is 15
        year: 2026,
        serial: 1,
      },
      {
        affiliation: 10101,
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 32, // 5bit max is 31
      },
      {
        affiliation: 100001,
        relationship: 1,
        type: 1,
        performance: 1,
        schedule: 1,
        year: 2026,
        serial: 16, // 中学生モードは4bit
      },
    ];

    for (const source of outOfRangeCases) {
      let thrown: unknown;
      try {
        await generateTicketCode(source);
      } catch (error) {
        thrown = error;
        console.error(`Expected error for input: ${JSON.stringify(source)}`);
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!(thrown instanceof Error)) {
        throw new Error(
          `Expected generateTicketCode to throw for input=${JSON.stringify(source)}`,
        );
      }
    }
  },
});

Deno.test({
  name: 'QR signature check: tampered payload fails restore',
  permissions: { env: true },
  fn: async () => {
    const { signCode, verifyCodeSignature, publicKeySpkiBase64 } =
      await setupTestEnv();

    const validPayload = JSON.stringify({
      code: 'ABC123',
      exp: Date.now() + 60_000,
    });
    const validSignature = await signCode(validPayload);
    const tampered = `${validPayload.slice(0, -1)}X.${validSignature}`;

    let thrown: unknown;
    try {
      await restoreQR(tampered, publicKeySpkiBase64, verifyCodeSignature);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('Expected tampered QR to throw');
    }
  },
});

Deno.test({
  name: 'QR signature check: empty token throws',
  permissions: { env: true },
  fn: async () => {
    const { verifyCodeSignature, publicKeySpkiBase64 } = await setupTestEnv();

    let thrown: unknown;
    try {
      await restoreQR('', publicKeySpkiBase64, verifyCodeSignature);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error) || thrown.message !== 'empty token') {
      throw new Error(`Expected empty token error, got: ${String(thrown)}`);
    }
  },
});

Deno.test({
  name: 'QR signature check: valid signature passes and tampered fails',
  permissions: { env: true },
  fn: async () => {
    const { signCode, verifyCodeSignature, publicKeySpkiBase64 } =
      await setupTestEnv();

    const validPayload = JSON.stringify({
      code: 'ABC123',
      exp: Date.now() + 60_000,
    });
    const validSignature = await signCode(validPayload);

    const valid = await verifyCodeSignature(
      validPayload,
      validSignature,
      publicKeySpkiBase64,
    );
    if (!valid) {
      throw new Error('Expected valid signature to pass');
    }

    const tamperedPayload = `${validPayload}x`;
    const tampered = await verifyCodeSignature(
      tamperedPayload,
      validSignature,
      publicKeySpkiBase64,
    );
    if (tampered) {
      throw new Error('Expected tampered payload to fail signature check');
    }
  },
});

Deno.test({
  name: 'QR signature check: expired QR is invalid',
  permissions: { env: true },
  fn: async () => {
    const { signCode, verifyCodeSignature, publicKeySpkiBase64 } =
      await setupTestEnv();

    const expired = await createQR(
      { code: 'ABC123', exp: Date.now() - 1 },
      signCode,
    );

    const isValid = await isValidQR(
      expired,
      publicKeySpkiBase64,
      verifyCodeSignature,
    );

    if (isValid) {
      throw new Error('Expected expired QR to be invalid');
    }
  },
});

// Additional tests for decodeTicketCode internals and error cases

Deno.test({
  name: 'resolveKeys throws when required keys are missing',
  permissions: { env: true },
  fn: async () => {
    // clear relevant env vars
    Deno.env.delete('BASE58_ALPHABET');
    Deno.env.delete('TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64');
    Deno.env.delete('TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64');

    const { resolveKeys } = await import('./decodeTicketCode.ts');

    let err: unknown;
    try {
      resolveKeys();
    } catch (e) {
      err = e;
    }
    if (!(err instanceof Error)) {
      throw new Error('Expected resolveKeys to throw when keys missing');
    }

    // restore env for further tests; recreate environment directly
    await createTestEnv();
  },
});

Deno.test({
  name: 'decodeBase58 returns null for invalid characters',
  fn: async () => {
    const { decodeBase58 } = await import('./decodeTicketCode.ts');
    const alphabet = 'ABC';
    const result = decodeBase58('DA', alphabet); // D not in alphabet
    if (result !== null) {
      throw new Error('Expected null for invalid base58 string');
    }
  },
});

Deno.test({
  name: 'decodeTicketCode handles bad input gracefully',
  permissions: { env: true },
  fn: async () => {
    const { decodeTicketCode } = await setupTestEnv();

    // too long (Base58 46bit is approx 8 chars, limit is 10)
    if ((await decodeTicketCode('12345678901')) !== null) {
      throw new Error('Expected null for code longer than 10');
    }
    // zero length
    if ((await decodeTicketCode('')) !== null) {
      throw new Error('Expected null for empty code');
    }
    // non-alphabet char
    const { alphabet } = (await import('./decodeTicketCode.ts')).resolveKeys();
    const invalid = '!' + alphabet.slice(1);
    if ((await decodeTicketCode(invalid)) !== null) {
      throw new Error('Expected null for invalid character');
    }

    // tamper legitimate code (MAC mismatch)
    const ticket = {
      affiliation: 1101,
      relationship: 1,
      type: 1,
      performance: 1,
      schedule: 1,
      year: 2025,
      serial: 1,
    };
    const code = await (await setupTestEnv()).generateTicketCode(ticket);
    const tampered =
      code.slice(0, -1) +
      alphabet[(alphabet.indexOf(code.slice(-1)) + 1) % alphabet.length];
    if ((await decodeTicketCode(tampered)) !== null) {
      throw new Error('Expected null for tampered code');
    }
  },
});
