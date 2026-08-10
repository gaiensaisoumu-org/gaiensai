export type RemainingMode = 'general' | 'junior' | 'total';
export type AvailabilityStatus = 'circle' | 'triangle' | 'cross';

export const getClassRemaining = ({
  totalCapacity,
  juniorCapacity,
  issuedGeneral = 0,
  issuedJunior = 0,
  issuedOther = 0,
  mode,
  isJuniorReleased,
}: {
  totalCapacity: number;
  juniorCapacity: number;
  issuedGeneral?: number;
  issuedJunior?: number;
  issuedOther?: number;
  mode: RemainingMode;
  isJuniorReleased: boolean;
}) => {
  const generalCapacity = Math.max(totalCapacity - juniorCapacity, 0);
  const totalIssued = issuedGeneral + issuedJunior + issuedOther;
  const generalRemaining = generalCapacity - issuedGeneral - issuedOther;
  const remaining =
    mode === 'total' || isJuniorReleased
      ? totalCapacity - totalIssued
      : mode === 'junior'
        ? juniorCapacity - issuedJunior - Math.max(-generalRemaining, 0)
        : generalRemaining;
  return Math.max(remaining, 0);
};

export const getGymRemaining = getClassRemaining;

export const getAvailabilityStatus = (
  remaining: number,
  capacity: number,
): AvailabilityStatus => {
  if (remaining <= 0) return 'cross';
  if (capacity > 0 && remaining <= Math.max(1, Math.ceil(capacity * 0.1))) {
    return 'triangle';
  }
  return 'circle';
};

export const getCapacityForMode = (
  totalCapacity: number,
  juniorCapacity: number,
  mode: RemainingMode,
) =>
  mode === 'total'
    ? totalCapacity
    : mode === 'junior'
      ? juniorCapacity
      : Math.max(totalCapacity - juniorCapacity, 0);

export const getPublicRemainingMode = (email?: string | null): RemainingMode => {
  const localPart = email?.split('@')[0] ?? '';
  const id = Number(localPart);
  return Number.isInteger(id) && id >= 10000 && id <= 40000
    ? 'general'
    : email
      ? 'junior'
      : 'total';
};
