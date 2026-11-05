import type { FastMoneyQuestion, Question } from './types';

export interface ParseResult<T> {
  items: T[];
  warnings: string[];
}

/** RFC 4180-ish parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function headerIndex(header: string[], names: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const idx = norm.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

interface RawRow {
  line: number;
  group: number;
  question: string;
  answer: string;
  points: number;
}

function readRows(
  text: string,
  groupNames: string[],
  label: string,
): { rows: RawRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], warnings: [`${label}: file is empty.`] };
  }
  const header = table[0];
  const gi = headerIndex(header, groupNames);
  const qi = headerIndex(header, ['question', 'prompt']);
  const ai = headerIndex(header, ['answer']);
  const pi = headerIndex(header, ['points', 'score', 'value']);
  const missing: string[] = [];
  if (gi === -1) missing.push(groupNames[0]);
  if (qi === -1) missing.push('question');
  if (ai === -1) missing.push('answer');
  if (pi === -1) missing.push('points');
  if (missing.length) {
    return {
      rows: [],
      warnings: [`${label}: missing column(s) ${missing.join(', ')}. Expected header: ${groupNames[0]},question,answer,points`],
    };
  }

  const rows: RawRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const line = r + 1;
    const group = Number.parseInt((cells[gi] ?? '').trim(), 10);
    const question = (cells[qi] ?? '').trim();
    const answer = (cells[ai] ?? '').trim();
    const pointsRaw = (cells[pi] ?? '').trim();
    const points = Number.parseInt(pointsRaw, 10);
    if (!Number.isFinite(group)) {
      warnings.push(`${label} line ${line}: "${cells[gi] ?? ''}" is not a ${groupNames[0]} number, row skipped.`);
      continue;
    }
    if (!question || !answer) {
      warnings.push(`${label} line ${line}: question or answer is blank, row skipped.`);
      continue;
    }
    if (!Number.isFinite(points) || points < 0) {
      warnings.push(`${label} line ${line}: points "${pointsRaw}" is not a number, row skipped.`);
      continue;
    }
    rows.push({ line, group, question, answer, points });
  }
  return { rows, warnings };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function parseRoundsCsv(text: string): ParseResult<Question> {
  const { rows, warnings } = readRows(text, ['round', 'order', 'number'], 'Rounds CSV');
  const byKey = new Map<string, Question>();
  for (const row of rows) {
    const key = `${row.group}|${row.question}`;
    let q = byKey.get(key);
    if (!q) {
      q = { id: `q${row.group}-${slug(row.question)}`, round: row.group, prompt: row.question, answers: [] };
      byKey.set(key, q);
    }
    q.answers.push({ id: `${q.id}-a${q.answers.length + 1}`, text: row.answer, points: row.points });
  }
  const items = [...byKey.values()].sort((a, b) => a.round - b.round);
  for (const q of items) {
    if (q.answers.length > 8) {
      warnings.push(`Round ${q.round} "${q.prompt}" has ${q.answers.length} answers; the board is built for 8, slabs will shrink.`);
    }
    if (q.answers.length < 2) {
      warnings.push(`Round ${q.round} "${q.prompt}" has only ${q.answers.length} answer.`);
    }
  }
  return { items, warnings };
}

export function parseFastMoneyCsv(text: string): ParseResult<FastMoneyQuestion> {
  const { rows, warnings } = readRows(text, ['order', 'round', 'number'], 'Fast Money CSV');
  const byKey = new Map<string, FastMoneyQuestion>();
  for (const row of rows) {
    const key = `${row.group}|${row.question}`;
    let q = byKey.get(key);
    if (!q) {
      q = { id: `fm${row.group}-${slug(row.question)}`, order: row.group, prompt: row.question, answers: [] };
      byKey.set(key, q);
    }
    q.answers.push({ text: row.answer, points: row.points });
  }
  const items = [...byKey.values()].sort((a, b) => a.order - b.order);
  if (items.length > 0 && items.length < 5) {
    warnings.push(`Fast Money has ${items.length} question(s); it plays with 5.`);
  }
  if (items.length > 5) {
    warnings.push(`Fast Money has ${items.length} questions; the first 5 by order are used.`);
  }
  return { items, warnings };
}
