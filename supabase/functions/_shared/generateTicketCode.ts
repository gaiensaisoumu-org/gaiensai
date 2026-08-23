import {
  encodeAffiliation,
  encodeJuniorRelationshipBits,
} from './convertAffiliation.ts';
import { getBase58Alphabet, getEnv } from './getEnv.ts';
import {
  decodeBase64,
  encodeBase64Url,
  feistelFunction,
  generateMAC10,
  importHmacKey,
  toArrayBuffer,
} from './cryptoUtils.ts';
import {
  AFFILIATION_BITS,
  AFFILIATION_DATA_MASK,
  AFFILIATION_SHIFT,
  FEISTEL_HALF_BITS,
  FEISTEL_HALF_MASK,
  MAC_BITS,
  MANUAL_CODE_LENGTH,
  PERFORMANCE_BITS,
  PERFORMANCE_MASK,
  PERFORMANCE_SHIFT,
  RELATIONSHIP_BITS,
  RELATIONSHIP_MASK,
  RELATIONSHIP_SHIFT,
  SCHEDULE_BITS,
  SCHEDULE_MASK,
  SCHEDULE_SHIFT,
  SERIAL_BITS,
  SERIAL_MASK,
  SERIAL_SHIFT,
  JUNIOR_SERIAL_BITS,
  TYPE_BITS,
  TYPE_MASK,
  TYPE_SHIFT,
  YEAR_BITS,
  YEAR_MASK,
  YEAR_SHIFT,
  type TicketData,
  JUNIOR_AFFILIATION_MIN,
  JUNIOR_AFFILIATION_PREFIX,
  isDayTicketAffiliation,
} from './ticketDataType.ts';

// ---------------------------------------------------------
// チケットコード生成関数
// ---------------------------------------------------------

function generateJuniorRelationship(
  affiliation: number,
  relationshipFlag: number,
): number {
  if (affiliation < JUNIOR_AFFILIATION_MIN) {
    return relationshipFlag;
  }

  const juniorId = affiliation - JUNIOR_AFFILIATION_PREFIX;
  return encodeJuniorRelationshipBits(relationshipFlag, juniorId);
}

function generateDayTicketAffiliation(relationship: number): number {
  return relationship;
}

/**
 * オブジェクトを46bitのBigIntに変換 (MAC領域を除く36bit分)
 */
export function packTicket(data: TicketData): bigint {
  const affiliationBits = encodeAffiliation(data.affiliation);
  let serialBits = data.serial & Number(SERIAL_MASK);
  let relationshipBits: number;
  let finalAffiliationBits = affiliationBits;

  const grade = (affiliationBits >> 10) & 0x3;
  const isJunior =
    affiliationBits !== 0 &&
    grade === 0 &&
    !isDayTicketAffiliation(affiliationBits);

  if (isJunior) {
    const juniorId = data.affiliation - JUNIOR_AFFILIATION_PREFIX;
    // serial Bit4 は中学生ID Bit11。入力serialの一部ではない。
    serialBits = (serialBits & 0xf) | (((juniorId >> 11) & 0x1) << 4);
  }

  if (isDayTicketAffiliation(affiliationBits)) {
    // 当日券モード: grade=0 かつ class=16 の affiliation をフラグとして扱う
    relationshipBits = generateDayTicketAffiliation(data.relationship);
    // 拡張シリアル: 下位5bitはそのまま、上位6bitをaffiliationのnumber部分(下位6bit)に入れる
    const serialHigh = (data.serial >> Number(SERIAL_BITS)) & 0x3f;
    finalAffiliationBits = (affiliationBits & ~0x3f) | serialHigh;
  } else {
    if (isJunior) {
      // 中学生モード: IDの下位10bitをaffiliationに置き、上位ビットをrelationship/serialへ分散する
      relationshipBits = generateJuniorRelationship(
        data.affiliation,
        data.relationship,
      );
    } else {
      relationshipBits = data.relationship;
    }
  }

  assertBitRange('affiliation', finalAffiliationBits, AFFILIATION_BITS);
  assertBitRange('relationship', relationshipBits, RELATIONSHIP_BITS);
  assertBitRange('type', data.type, TYPE_BITS);
  assertBitRange('performance', data.performance, PERFORMANCE_BITS);
  assertBitRange('schedule', data.schedule, SCHEDULE_BITS);
  assertBitRange('year', data.year, YEAR_BITS);

  // 中学生モードではBit4をIDのBit11として使うため、シリアル値は4bit。
  const serialMaxBits = isDayTicketAffiliation(affiliationBits)
    ? SERIAL_BITS + 6n
    : isJunior
      ? JUNIOR_SERIAL_BITS
      : SERIAL_BITS;
  assertBitRange('serial', data.serial, serialMaxBits);

  let packed = 0n;
  packed |= BigInt(serialBits & Number(SERIAL_MASK)) << SERIAL_SHIFT;
  packed |= BigInt(data.year & Number(YEAR_MASK)) << YEAR_SHIFT;
  packed |= BigInt(data.schedule & Number(SCHEDULE_MASK)) << SCHEDULE_SHIFT;
  packed |=
    BigInt(data.performance & Number(PERFORMANCE_MASK)) << PERFORMANCE_SHIFT;
  packed |= BigInt(data.type & Number(TYPE_MASK)) << TYPE_SHIFT;
  packed |=
    BigInt(relationshipBits & Number(RELATIONSHIP_MASK)) << RELATIONSHIP_SHIFT;
  packed |=
    BigInt(finalAffiliationBits & Number(AFFILIATION_DATA_MASK)) <<
    AFFILIATION_SHIFT;

  return packed; // 36 bits
}

function assertBitRange(name: string, value: number, bits: bigint): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }

  const max = (1n << bits) - 1n;
  const valueAsBigInt = BigInt(value);

  if (valueAsBigInt < 0n || valueAsBigInt > max) {
    throw new Error(`${name} out of range (0..${max.toString()})`);
  }
}

// ---------------------------------------------------------
// 3. Web Crypto API の準備 (非同期)
// ---------------------------------------------------------
const RAW_MAC_KEY = decodeBase64(
  getEnv('TICKET_SIGNING_PRIVATE_KEY_MAC_BASE64'),
);
const RAW_CIPHER_KEY = decodeBase64(
  getEnv('TICKET_SIGNING_PRIVATE_KEY_CIPHER_BASE64'),
);

const ENCRYPTION_ROUNDS = 8;

export async function encryptFeistel46(
  data46: bigint,
  key: CryptoKey,
): Promise<bigint> {
  let L = data46 >> FEISTEL_HALF_BITS;
  let R = data46 & FEISTEL_HALF_MASK;
  for (let i = 0; i < ENCRYPTION_ROUNDS; i++) {
    const nextL = R;
    const nextR = L ^ (await feistelFunction(R, i, key));
    L = nextL;
    R = nextR;
  }
  return (L << FEISTEL_HALF_BITS) | R;
}

// ---------------------------------------------------------
// 5. Base58 エンコード
// ---------------------------------------------------------
/**
 * Base58エンコード関数
 * @param num - エンコードする数値 (bigint)
 * @returns Base58エンコードされた文字列
 */

const BASE58_ALPHABET = getBase58Alphabet();
const BASE58_BASE = 58n;

export function generateManualCode(num: bigint): string {
  if (num < 0n) {
    throw new Error('負の数はBase58に変換できません。');
  }
  if (num === 0n) {
    return BASE58_ALPHABET[0];
  }

  let encoded = '';
  let temp = num;
  while (temp > 0n) {
    encoded = BASE58_ALPHABET[Number(temp % BASE58_BASE)] + encoded;
    temp /= BASE58_BASE;
  }

  return encoded.padStart(MANUAL_CODE_LENGTH, BASE58_ALPHABET[0]);
}

// ---------------------------------------------------------
// 6. メインAPI (非同期化)
// ---------------------------------------------------------

/**
 * チケットコードを生成するメイン関数
 * @param data - チケットコードに含めるデータ
 * @returns 生成されたチケットコード (Base58エンコードされた文字列)
 */
export async function generateTicketCode(data: TicketData): Promise<string> {
  // 暗号化キーのインポート
  const macKey = await importHmacKey(RAW_MAC_KEY);
  const cipherKey = await importHmacKey(RAW_CIPHER_KEY);

  // yearをYEAR_MASKの範囲内に収める
  data.year = data.year % Number(YEAR_MASK + 1n);

  // チケットコード(本体)の生成
  const data36 = packTicket(data);
  // MAC(署名および誤り検知)の生成
  const mac10 = await generateMAC10(data36, macKey);

  const payload46 = (data36 << MAC_BITS) | mac10;

  // Feistel暗号でpayload46をシャッフル
  const encrypted46 = await encryptFeistel46(payload46, cipherKey);
  // Base58でエンコードして最終的なチケットコードを生成
  return generateManualCode(encrypted46);
}

// ---------------------------------------------------------
// 7. Ed25519署名関数 (非同期化)
// ---------------------------------------------------------

// Ed25519署名用秘密鍵をデコードする関数
const decodePrivateKeyBase64 = (encoded: string): Uint8Array => {
  const normalized = encoded.trim();
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

// Ed25519署名用の CryptoKey を生成する関数
const signingKeyPromise = (() => {
  const privateKeyBase64 = getEnv('TICKET_SIGNING_PRIVATE_KEY_Ed25519_BASE64');
  const privateKeyBytes = decodePrivateKeyBase64(privateKeyBase64);

  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(privateKeyBytes),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
})();

/**
 * チケットコードに対してEd25519署名を生成する関数
 * @param code 署名前のチケットコード
 * @returns チケットコードの署名
 */
export const signCode = async (code: string): Promise<string> => {
  const key = await signingKeyPromise;
  const payload = new TextEncoder().encode(code);
  const signature = await crypto.subtle.sign('Ed25519', key, payload);

  return encodeBase64Url(new Uint8Array(signature));
};
