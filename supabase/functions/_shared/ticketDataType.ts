export interface TicketData {
  affiliation: number; // 12 bit (Grade 2 / Class 4 / Number 6)
  relationship: number; // 3 bit
  type: number; // 4 bit
  performance: number; // 5 bit
  schedule: number; // 4 bit
  year: number; // 3 bit
  serial: number; // 通常5bit / 中学生モード4bit（Bit4はID拡張用）
}

// チケットデータのビット割り当て（合計36ビット + MAC 10ビット = 46ビット）
export const MAC_BITS = 10n;
export const SERIAL_BITS = 5n;
// 中学生モードでは serial Bit4 を juniorId Bit11 に使用するため、入力値は4bit。
export const JUNIOR_SERIAL_BITS = 4n;
export const JUNIOR_SERIAL_LIMIT = 1n << JUNIOR_SERIAL_BITS;
export const YEAR_BITS = 3n;
export const SCHEDULE_BITS = 4n;
export const PERFORMANCE_BITS = 5n;
export const TYPE_BITS = 4n;
export const RELATIONSHIP_BITS = 3n;
export const AFFILIATION_BITS = 12n;

// Affiliation（所属）の内訳定数
export const AFFILIATION_GRADE_BITS = 2n;
export const AFFILIATION_CLASS_BITS = 4n;
export const AFFILIATION_NUMBER_BITS = 6n;

export const AFFILIATION_GRADE_SHIFT = 10; // (Class 4bit + Number 6bit)
export const AFFILIATION_CLASS_SHIFT = 6; // (Number 6bit)

export const AFFILIATION_GRADE_MAX = 0x3; // 2bit最大値 (3)
export const AFFILIATION_CLASS_MAX = 0xf; // 4bit最大値 (15)
export const AFFILIATION_NUMBER_MAX = 0x3f; // 6bit最大値 (63)

export const AFFILIATION_GRADE_DIVIDER = 10000; // 5桁表示の1万の位
export const AFFILIATION_CLASS_DIVIDER = 100; // 5桁表示の100の位

// 中学生モードの表示用接頭辞
export const JUNIOR_AFFILIATION_PREFIX = 100000;
export const JUNIOR_AFFILIATION_MIN = 100001;
export const JUNIOR_AFFILIATION_MAX = 103839; // (2^4 - 1) * 2^6 * 2 * 2 - 1 = 3839 + 100000

// 当日券モード（Grade 0, Class 16。内部0始まりでは Class 15）
export const DAY_TICKET_FLAG_GRADE = 0;
export const DAY_TICKET_FLAG_CLASS = 15;

// ビットパッキング用シフト量 (36bitデータ領域内)
export const SERIAL_SHIFT = 0n;
export const YEAR_SHIFT = SERIAL_BITS;
export const SCHEDULE_SHIFT = YEAR_SHIFT + YEAR_BITS;
export const PERFORMANCE_SHIFT = SCHEDULE_SHIFT + SCHEDULE_BITS;
export const TYPE_SHIFT = PERFORMANCE_SHIFT + PERFORMANCE_BITS;
export const RELATIONSHIP_SHIFT = TYPE_SHIFT + TYPE_BITS;
export const AFFILIATION_SHIFT = RELATIONSHIP_SHIFT + RELATIONSHIP_BITS;

// ビット抽出用マスク
export const SERIAL_MASK = (1n << SERIAL_BITS) - 1n;
export const YEAR_MASK = (1n << YEAR_BITS) - 1n;
export const SCHEDULE_MASK = (1n << SCHEDULE_BITS) - 1n;
export const PERFORMANCE_MASK = (1n << PERFORMANCE_BITS) - 1n;
export const TYPE_MASK = (1n << TYPE_BITS) - 1n;
export const RELATIONSHIP_MASK = (1n << RELATIONSHIP_BITS) - 1n;
export const AFFILIATION_DATA_MASK = (1n << AFFILIATION_BITS) - 1n;
export const MAC_MASK = (1n << MAC_BITS) - 1n;

// 合計の確認
export const TOTAL_BITS = 46n;
export const FEISTEL_HALF_BITS = TOTAL_BITS / 2n; // 23bit
export const FEISTEL_HALF_MASK = (1n << FEISTEL_HALF_BITS) - 1n;
export const MANUAL_CODE_LENGTH = 8;

export function isDayTicketAffiliation(affiliationBits: number): boolean {
  const grade =
    (affiliationBits >> Number(AFFILIATION_GRADE_SHIFT)) & Number(AFFILIATION_GRADE_MAX);
  const classNum =
    (affiliationBits >> Number(AFFILIATION_CLASS_SHIFT)) & Number(AFFILIATION_CLASS_MAX);
  return grade === DAY_TICKET_FLAG_GRADE && classNum === DAY_TICKET_FLAG_CLASS;
}
