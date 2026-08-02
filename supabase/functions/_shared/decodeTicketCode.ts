import { decodeAffiliation } from './convertAffiliation.ts';
import {
  decodeBase64,
  feistelFunction,
  generateMAC10,
  importHmacKey,
} from './cryptoUtils.ts';
import {
  AFFILIATION_DATA_MASK,
  AFFILIATION_SHIFT,
  AFFILIATION_GRADE_MAX,
  AFFILIATION_GRADE_SHIFT,
  FEISTEL_HALF_BITS,
  FEISTEL_HALF_MASK,
  MAC_BITS,
  MAC_MASK,
  PERFORMANCE_MASK,
  PERFORMANCE_SHIFT,
  RELATIONSHIP_MASK,
  RELATIONSHIP_SHIFT,
  SCHEDULE_MASK,
  SCHEDULE_SHIFT,
  SERIAL_MASK,
  SERIAL_SHIFT,
  TYPE_MASK,
  TYPE_SHIFT,
  YEAR_MASK,
  YEAR_SHIFT,
  type TicketData,
  isDayTicketAffiliation,
  SERIAL_BITS,
} from './ticketDataType.ts';

// ---------------------------------------------------------
// チケットコードデコード関数
// ---------------------------------------------------------

export function unpackTicket(packed: bigint): TicketData {
  let serial = Number((packed >> SERIAL_SHIFT) & SERIAL_MASK);
  const year = Number((packed >> YEAR_SHIFT) & YEAR_MASK);
  const schedule = Number((packed >> SCHEDULE_SHIFT) & SCHEDULE_MASK);
  const performance = Number((packed >> PERFORMANCE_SHIFT) & PERFORMANCE_MASK);
  const type = Number((packed >> TYPE_SHIFT) & TYPE_MASK);
  const relationshipBits = Number(
    (packed >> RELATIONSHIP_SHIFT) & RELATIONSHIP_MASK,
  );
  const affiliationBits = Number(
    (packed >> AFFILIATION_SHIFT) & AFFILIATION_DATA_MASK,
  );

  let finalAffiliationBits = affiliationBits;
  if (isDayTicketAffiliation(affiliationBits)) {
    const serialHigh = affiliationBits & 0x3f;
    serial = (serialHigh << Number(SERIAL_BITS)) | serial;
    // affiliationを本来の当日券フラグ値(number=0)に戻してデコードする
    finalAffiliationBits = affiliationBits & ~0x3f;
  }

  const grade =
    (finalAffiliationBits >> Number(AFFILIATION_GRADE_SHIFT)) &
    Number(AFFILIATION_GRADE_MAX);
  const isJuniorAffiliation =
    finalAffiliationBits !== 0 &&
    grade === 0 &&
    !isDayTicketAffiliation(finalAffiliationBits);
  const juniorSerialExtraBit = isJuniorAffiliation ? (serial >> 4) & 0x1 : 0;
  if (isJuniorAffiliation) {
    serial &= 0xf;
  }
  const relationship = isJuniorAffiliation
    ? (relationshipBits >> 1) & 0x3
    : relationshipBits;

  const data: TicketData = {
    serial,
    year,
    schedule,
    performance,
    type,
    relationship,
    affiliation: decodeAffiliation(
      finalAffiliationBits,
      relationshipBits,
      juniorSerialExtraBit,
    ),
  };

  return data;
}

type DecodeOptions = {
  ticketSigningPrivateKeyMacBase64?: string;
  ticketSigningPrivateKeyCipherBase64?: string;
  base58Alphabet?: string;
};

function resolveKeys(options?: DecodeOptions) {
  const readRuntimeEnv = (key: string): string | undefined => {
    const deno = (
      globalThis as {
        Deno?: { env?: { get: (k: string) => string | undefined } };
      }
    ).Deno;
    if (deno?.env) {
      return deno.env.get(key);
    }

    const meta = import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    };
    if (meta.env) {
      return meta.env[key];
    }

    return undefined;
  };

  const macBase64 =
    options?.ticketSigningPrivateKeyMacBase64 ??
    readRuntimeEnv('TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64') ??
    readRuntimeEnv('VITE_TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64');
  const cipherBase64 =
    options?.ticketSigningPrivateKeyCipherBase64 ??
    readRuntimeEnv('TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64') ??
    readRuntimeEnv('VITE_TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64');
  const alphabet =
    options?.base58Alphabet ??
    readRuntimeEnv('BASE58_ALPHABET') ??
    readRuntimeEnv('VITE_BASE58_ALPHABET');

  // If caller provided options (frontend), validate presence and give a helpful error
  if (!macBase64 || !cipherBase64 || !alphabet) {
    throw new Error(
      'Missing decode keys. Set TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64, TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64, BASE58_ALPHABET (or VITE_ prefixed variants on frontend).',
    );
  }

  const RAW_MAC_KEY = decodeBase64(macBase64);
  const RAW_CIPHER_KEY = decodeBase64(cipherBase64);

  return { RAW_MAC_KEY, RAW_CIPHER_KEY, alphabet } as const;
}

const ENCRYPTION_ROUNDS = 8;

async function decryptFeistel46(
  cipher46: bigint,
  key: CryptoKey,
): Promise<bigint> {
  let L = cipher46 >> FEISTEL_HALF_BITS;
  let R = cipher46 & FEISTEL_HALF_MASK;
  for (let i = ENCRYPTION_ROUNDS - 1; i >= 0; i--) {
    const prevR = L;
    const prevL = R ^ (await feistelFunction(L, i, key));
    L = prevL;
    R = prevR;
  }
  return (L << FEISTEL_HALF_BITS) | R;
}

const BASE58_BASE = 58n;

function decodeBase58(str: string, alphabet: string): bigint | null {
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const charIndex = alphabet.indexOf(str[i]);
    if (charIndex === -1) {
      return null;
    }
    num = num * BASE58_BASE + BigInt(charIndex);
  }
  return num;
}

/**
 * MACの検証
 */
export async function validateMAC(
  data36: bigint,
  mac10: bigint,
  key: CryptoKey,
): Promise<boolean> {
  const expectedMac10 = await generateMAC10(data36, key);
  return mac10 === expectedMac10;
}

export async function decodeTicketCode(
  code: string,
  options?: DecodeOptions,
): Promise<TicketData | null> {
  if (code.length < 1 || code.length > 10) {
    // Base58 46bitは約8文字だが余裕を持つ
    return null;
  }

  const {
    RAW_MAC_KEY: macKeyRaw,
    RAW_CIPHER_KEY: cipherKeyRaw,
    alphabet,
  } = await resolveKeys(options);

  const encrypted46 = decodeBase58(code, alphabet);
  if (encrypted46 === null) {
    return null;
  }

  const macKey = await importHmacKey(macKeyRaw);
  const cipherKey = await importHmacKey(cipherKeyRaw);

  const payload46 = await decryptFeistel46(encrypted46, cipherKey);
  const data36 = payload46 >> MAC_BITS;
  const mac10 = payload46 & MAC_MASK;

  if (!(await validateMAC(data36, mac10, macKey))) {
    return null;
  } // 署名エラー（偽造）

  return unpackTicket(data36);
}

// helpers exported for testing
export { resolveKeys, decryptFeistel46, decodeBase58 };
