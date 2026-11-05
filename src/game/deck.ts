import { parseFastMoneyCsv, parseRoundsCsv } from './csv';
import type { Deck, FastMoneyFile, FastMoneyQuestion } from './types';

const FAST_MONEY_DIR = 'public/data/fast-money';

const fastMoneyModules = import.meta.glob('../../public/data/fast-money/*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface DeckLoad {
  deck: Deck;
  warnings: string[];
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: 'no-store' });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || type.includes('text/html')) throw new Error(`${url} was not found`);
  return r.text();
}

export async function loadDefaultDeck(): Promise<DeckLoad> {
  const warnings: string[] = [];
  let questions: Deck['questions'] = [];
  let fastMoney: Deck['fastMoney'] = [];
  try {
    const r = parseRoundsCsv(await fetchText('/data/rounds.csv'));
    questions = r.items;
    warnings.push(...r.warnings);
  } catch (err) {
    warnings.push(`Rounds: ${err instanceof Error ? err.message : err}`);
  }
  const files = loadFastMoneyFolder();
  warnings.push(...files.warnings);
  fastMoney = files.active;
  return {
    deck: {
      questions,
      fastMoney,
      roundsSource: 'public/data/rounds.csv',
      fastMoneySource: files.activeName,
      fastMoneyFiles: files.files,
    },
    warnings,
  };
}

function loadFastMoneyFolder(): { files: FastMoneyFile[]; active: FastMoneyQuestion[]; activeName: string; warnings: string[] } {
  const warnings: string[] = [];
  const paths = Object.keys(fastMoneyModules).sort();
  if (paths.length === 0) {
    return { files: [], active: [], activeName: FAST_MONEY_DIR, warnings: [`Fast Money: no CSV files in ${FAST_MONEY_DIR}.`] };
  }
  const files: FastMoneyFile[] = [];
  for (const path of paths) {
    const name = path.split('/').pop() ?? path;
    const parsed = parseFastMoneyCsv(fastMoneyModules[path]);
    warnings.push(...parsed.warnings.map((w) => `${name}: ${w}`));
    files.push({ name, questions: parsed.items });
  }
  const first = files[0];
  return { files, active: first.questions, activeName: `${FAST_MONEY_DIR}/${first.name}`, warnings };
}

export function deckWithFastMoneySet(deck: Deck, name: string): Deck {
  const file = deck.fastMoneyFiles?.find((f) => f.name === name);
  if (!file) return deck;
  return { ...deck, fastMoney: file.questions, fastMoneySource: `${FAST_MONEY_DIR}/${file.name}` };
}

export async function deckWithRoundsFile(deck: Deck, file: File): Promise<DeckLoad> {
  const r = parseRoundsCsv(await file.text());
  if (r.items.length === 0) return { deck, warnings: [`${file.name}: no questions found.`, ...r.warnings] };
  return { deck: { ...deck, questions: r.items, roundsSource: file.name }, warnings: r.warnings };
}

export async function deckWithFastMoneyFile(deck: Deck, file: File): Promise<DeckLoad> {
  const r = parseFastMoneyCsv(await file.text());
  if (r.items.length === 0) return { deck, warnings: [`${file.name}: no questions found.`, ...r.warnings] };
  return { deck: { ...deck, fastMoney: r.items, fastMoneySource: file.name }, warnings: r.warnings };
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
