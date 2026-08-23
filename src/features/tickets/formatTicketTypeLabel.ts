type FormatTicketTypeLabelParams = {
  type?: string | null;
  name?: string | null;
  fallback?: string;
  separator?: string;
};

export const formatTicketTypeLabel = ({
  type,
  name,
  fallback = '-',
  separator = '\n',
}: FormatTicketTypeLabelParams): string => {
  const normalizedType =
    typeof type === 'string' && type.length > 0 ? type : null;
  const normalizedName =
    typeof name === 'string' && name.length > 0 ? name : null;

  if (normalizedType && normalizedName) {
    return `${normalizedType}${separator}${normalizedName}`;
  }
  if (normalizedType) {
    return normalizedType;
  }
  if (normalizedName) {
    return normalizedName;
  }

  return fallback;
};
