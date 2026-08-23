import type { Borders, Workbook } from 'exceljs';
import { formatTicketCode } from './formatTicketCode';

export type RosterXlsxRound = { id: number; name: string };
export type RosterXlsxTicket = {
  affiliation: number | null;
  name?: string;
  relationship: number;
  code: string;
  createdAt: string;
  roundId: number;
};
export type RosterXlsxSheet = {
  name: string;
  rounds: RosterXlsxRound[];
  tickets: RosterXlsxTicket[];
  generalCapacity: number;
};

const formatAffiliation = (affiliation: number | null) =>
  affiliation !== null && affiliation >= 10000 && affiliation <= 39999
    ? `${Math.floor(affiliation / 10000)}年${Math.floor((affiliation % 10000) / 100)}組${affiliation % 100}番`
    : '';

const addRosterSheet = (
  workbook: Workbook,
  roster: RosterXlsxSheet,
  relationshipNames: Map<number, string>,
  usedSheetNames: Set<string>,
) => {
  const baseSheetName =
    roster.name
      .replace(/[\\/?*:]/g, ' ')
      .replaceAll('[', ' ')
      .replaceAll(']', ' ') || '名簿';
  let sheetName = baseSheetName.slice(0, 31);
  let suffix = 2;
  while (usedSheetNames.has(sheetName)) {
    const suffixText = ` (${suffix})`;
    sheetName = `${baseSheetName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedSheetNames.add(sheetName);

  const ticketsByRound = roster.rounds.map((round) =>
    roster.tickets
      .filter((ticket) => ticket.roundId === round.id)
      .sort(
        (a, b) =>
          (a.affiliation ?? 0) - (b.affiliation ?? 0) ||
          a.code.localeCompare(b.code, 'ja'),
      ),
  );
  const headers = [
    '連番',
    '学年・クラス・番号',
    '氏名',
    '間柄',
    'コード番号',
    '発行日',
  ];
  const rows: string[][] = [
    ['クラス・部活名', '', roster.name],
    [
      '出力日',
      new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).format(new Date()),
    ],
    roster.rounds.flatMap((round) => [round.name, '', '', '', '', '']),
    roster.rounds.flatMap(() => headers),
  ];
  const maxLength = Math.max(
    roster.generalCapacity,
    ...ticketsByRound.map((tickets) => tickets.length),
  );
  for (let index = 0; index < maxLength; index += 1) {
    rows.push(
      ticketsByRound.flatMap((tickets) => {
        const ticket = tickets[index];
        return [
          String(index + 1),
          ticket ? formatAffiliation(ticket.affiliation) : '',
          ticket?.name ?? '',
          ticket ? (relationshipNames.get(ticket.relationship) ?? '—') : '',
          ticket ? formatTicketCode(ticket.code) : '',
          ticket ? new Date(ticket.createdAt).toLocaleString('ja-JP') : '',
        ];
      }),
    );
  }

  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRows(rows);
  const lastColumn = Math.max(3, roster.rounds.length * 6);
  worksheet.mergeCells(1, 1, 1, 2);
  worksheet.mergeCells(1, 3, 1, lastColumn);
  roster.rounds.forEach((_, index) =>
    worksheet.mergeCells(3, index * 6 + 1, 3, index * 6 + 6),
  );
  const border: Partial<Borders> = {
    top: { style: 'thin', color: { argb: 'FFA6A6A6' } },
    bottom: { style: 'thin', color: { argb: 'FFA6A6A6' } },
    left: { style: 'thin', color: { argb: 'FFA6A6A6' } },
    right: { style: 'thin', color: { argb: 'FFA6A6A6' } },
  };
  for (let row = 3; row <= rows.length; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = worksheet.getCell(row, column);
      cell.font = { name: 'Yu Gothic' };
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
    }
  }
  for (let column = 1; column <= lastColumn; column += 1) {
    const performanceCell = worksheet.getCell(3, column);
    const headerCell = worksheet.getCell(4, column);
    performanceCell.font = {
      name: 'Yu Gothic',
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    performanceCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' },
    };
    performanceCell.border = border;
    performanceCell.alignment = { horizontal: 'center', vertical: 'middle' };
    headerCell.font = { name: 'Yu Gothic', bold: true };
    headerCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9EAF7' },
    };
    headerCell.border = border;
    headerCell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
  }
  for (const cell of ['A1', 'C1', 'A2', 'B2']) {
    worksheet.getCell(cell).font = { name: 'Yu Gothic', bold: cell === 'C1' };
  }
  worksheet.columns = roster.rounds.flatMap(() => [
    { width: 8 },
    { width: 20 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
    { width: 22 },
  ]);
};

export const downloadRosterXlsx = async ({
  rosters,
  relationships,
  filename,
}: {
  rosters: RosterXlsxSheet[];
  relationships: { id: number; name: string }[];
  filename: string;
}) => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const relationshipNames = new Map(
    relationships.map(({ id, name }) => [id, name]),
  );
  const usedSheetNames = new Set<string>();
  rosters.forEach((roster) =>
    addRosterSheet(workbook, roster, relationshipNames, usedSheetNames),
  );
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
