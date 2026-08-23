import {
  AFFILIATION_CLASS_DIVIDER,
  DAY_TICKET_FLAG_CLASS,
  AFFILIATION_CLASS_MAX,
  AFFILIATION_CLASS_SHIFT,
  AFFILIATION_GRADE_DIVIDER,
  DAY_TICKET_FLAG_GRADE,
  AFFILIATION_GRADE_MAX,
  AFFILIATION_GRADE_SHIFT,
  AFFILIATION_NUMBER_MAX,
  JUNIOR_AFFILIATION_MAX,
  JUNIOR_AFFILIATION_MIN,
  JUNIOR_AFFILIATION_PREFIX,
} from './ticketDataType.ts';

export type JuniorEntryEligibility = 'middle-school' | 'guardian' | 'both';

const decodeJuniorEligibility = (
  relationshipBits: number,
): JuniorEntryEligibility => {
  const flag = (relationshipBits >> 1) & 0x3;
  if (flag === 0) {
    return 'middle-school';
  }
  if (flag === 1) {
    return 'guardian';
  }
  if (flag === 2) {
    return 'both';
  }
  throw new Error(`relationship out of range: ${relationshipBits}`);
};

export const encodeJuniorRelationshipBits = (
  relationshipFlag: number,
  juniorId: number,
): number => {
  if (
    !Number.isInteger(relationshipFlag) ||
    relationshipFlag < 0 ||
    relationshipFlag > 2
  ) {
    throw new Error(`relationship flag out of range: ${relationshipFlag}`);
  }

  const topBit = (juniorId >> 10) & 0x1;
  return (relationshipFlag << 1) | topBit;
};

const encodeJuniorAffiliation = (affiliation: number): number => {
  if (
    !Number.isInteger(affiliation) ||
    affiliation < JUNIOR_AFFILIATION_MIN ||
    affiliation > JUNIOR_AFFILIATION_MAX
  ) {
    throw new Error(`junior affiliation out of range: ${affiliation}`);
  }

  const juniorId = affiliation - JUNIOR_AFFILIATION_PREFIX;
  const classBits =
    (juniorId >> AFFILIATION_CLASS_SHIFT) & AFFILIATION_CLASS_MAX;
  const number = juniorId & AFFILIATION_NUMBER_MAX;

  if (classBits === DAY_TICKET_FLAG_CLASS) {
    throw new Error(`class out of range: ${classBits}`);
  }

  return (classBits << AFFILIATION_CLASS_SHIFT) | number;
};

export function encodeAffiliation(affiliation: number): number {
  if (affiliation === 0) {
    return 0; // 無所属は全ビット0
  }

  if (affiliation >= JUNIOR_AFFILIATION_MIN) {
    return encodeJuniorAffiliation(affiliation);
  }

  // 10000の位(学年)、100の位(組)で各フィールドを分割抽出
  const grade = Math.floor(affiliation / AFFILIATION_GRADE_DIVIDER) % 10;
  const classNum =
    Math.floor(
      (affiliation % AFFILIATION_GRADE_DIVIDER) / AFFILIATION_CLASS_DIVIDER,
    ) - 1; // 組は1始まりなので-1して0始まりに変換
  const number = affiliation % AFFILIATION_CLASS_DIVIDER;

  // バリデーションチェック：ビット領域に収まるかを確認
  // 余り(%)でビット幅に切り詰める前に実行することで、不正な入力を確実に検知
  if (grade < 0 || grade > AFFILIATION_GRADE_MAX) {
    throw new Error(`grade out of range: ${grade}`);
  }
  if (classNum < 0 || classNum > AFFILIATION_CLASS_MAX) {
    throw new Error(`class out of range: ${classNum}`);
  }
  if (number < 0 || number > AFFILIATION_NUMBER_MAX) {
    throw new Error(`number out of range: ${number}`);
  }

  // ビットパッキング (Grade | Class | Number)
  return (
    (grade << AFFILIATION_GRADE_SHIFT) |
    (classNum << AFFILIATION_CLASS_SHIFT) |
    number
  );
}

export function decodeAffiliation(
  bits: number,
  relationship = 0,
  serialExtraBit = 0,
): number {
  if (bits === 0) {
    return 0; // 無所属は全ビット0
  }

  // マスクを使用して各フィールドを抽出
  const grade = (bits >> AFFILIATION_GRADE_SHIFT) & AFFILIATION_GRADE_MAX;
  const classBits = (bits >> AFFILIATION_CLASS_SHIFT) & AFFILIATION_CLASS_MAX;
  const classNum = classBits + 1; // 組は0始まりなので+1して1始まりに変換
  const number = bits & AFFILIATION_NUMBER_MAX;

  if (grade === 0 && classBits !== DAY_TICKET_FLAG_CLASS) {
    const juniorId =
      ((serialExtraBit & 0x1) << 11) |
      ((relationship & 0x1) << 10) |
      (classBits << 6) |
      number;
    return JUNIOR_AFFILIATION_PREFIX + juniorId;
  }

  // 学年0かつ当日券フラグではない場合のみ、Relationshipビットを10万の位に配置して返す
  const isDayTicketAffiliation =
    grade === DAY_TICKET_FLAG_GRADE && classBits === DAY_TICKET_FLAG_CLASS;
  const relOffset =
    grade === 0 && !isDayTicketAffiliation
      ? relationship * (AFFILIATION_GRADE_DIVIDER * 10)
      : 0;

  // 人間が読める形式（GccNN）に復元
  return (
    relOffset +
    grade * AFFILIATION_GRADE_DIVIDER +
    classNum * AFFILIATION_CLASS_DIVIDER +
    number
  );
}

export function getJuniorEntryEligibility(
  relationshipBits: number,
): JuniorEntryEligibility {
  return decodeJuniorEligibility(relationshipBits);
}

export function getAffiliationEligibility(
  bits: number,
  relationshipBits: number,
): JuniorEntryEligibility | null {
  if (bits === 0) {
    return null;
  }

  const grade = (bits >> AFFILIATION_GRADE_SHIFT) & AFFILIATION_GRADE_MAX;
  const classBits = (bits >> AFFILIATION_CLASS_SHIFT) & AFFILIATION_CLASS_MAX;

  if (grade !== 0 || classBits === DAY_TICKET_FLAG_CLASS) {
    return null;
  }

  return decodeJuniorEligibility(relationshipBits);
}
