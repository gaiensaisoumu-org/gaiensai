/** チケットコードを読みやすい4桁区切りで表示する。 */
export const formatTicketCode = (code: string): string =>
  code.match(/.{1,4}/g)?.join('-') ?? '';
