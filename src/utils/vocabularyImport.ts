import { CEFRLevel, SavedWord } from '../types';
import { analyzeGermanWordLocally, COMMON_GERMAN_DICTIONARY } from '../data/germanDictionary';

export interface InvalidImportLine {
  lineNumber: number;
  content: string;
  reason: string;
}

export interface ParsedManualWordsResult {
  entries: Omit<SavedWord, 'id' | 'dateSaved'>[];
  invalidLines: InvalidImportLine[];
  totalLines: number;
}

const VALID_LEVELS = new Set<CEFRLevel>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const HAS_ARABIC_RE = /[\u0600-\u06FF]/;
const HAS_LATIN_RE = /[a-zA-ZäöüÄÖÜß]/;

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isLikelyCsvHeader(cells: string[]): boolean {
  const first = (cells[0] || '').toLowerCase();
  const joined = cells.join(' ').toLowerCase();
  return (
    first === 'german' ||
    first === 'word' ||
    first === 'deutsch' ||
    first === 'الكلمة' ||
    first === 'الكلمة الألمانية' ||
    (joined.includes('المعنى بالعربية') && joined.includes('الأداة'))
  );
}

function extractArticleAndWord(rawGerman: string): { article?: string; word: string } {
  const cleaned = rawGerman.replace(/[„"“»«]/g, '').trim();
  const articleMatch = cleaned.match(/^(der|die|das|ein|eine)\s+(.+)$/i);
  if (articleMatch) {
    const article = articleMatch[1].toLowerCase();
    const rest = articleMatch[2].trim();
    if (HAS_LATIN_RE.test(rest)) {
      return { article, word: rest };
    }
  }
  return { word: cleaned };
}

function normalizeLevel(rawLevel: string | undefined, fallback: CEFRLevel): CEFRLevel {
  const upper = (rawLevel || '').trim().toUpperCase() as CEFRLevel;
  return VALID_LEVELS.has(upper) ? upper : fallback;
}

function buildSavedWordEntry(params: {
  germanRaw: string;
  arabicRaw?: string;
  articleOverride?: string;
  pluralOverride?: string;
  pronunciationOverride?: string;
  ipaOverride?: string;
  posOverride?: string;
  level: CEFRLevel;
  exampleGermanOverride?: string;
  exampleArabicOverride?: string;
}): Omit<SavedWord, 'id' | 'dateSaved'> {
  const { article: parsedArticle, word } = extractArticleAndWord(params.germanRaw);
  const cleanWord = word.replace(/[.,!?;:()]+$/g, '').trim();
  const dictHit = COMMON_GERMAN_DICTIONARY[cleanWord.toLowerCase()];
  const analyzed = analyzeGermanWordLocally(cleanWord);

  const explicitArabic = (params.arabicRaw || '').trim();
  const resolvedArabicMeaning =
    explicitArabic ||
    (dictHit ? dictHit.contextMeaningArabic : analyzed.contextMeaningArabic);

  return {
    germanWord: cleanWord,
    article: params.articleOverride?.trim() || parsedArticle || analyzed.nounInfo?.article,
    plural: params.pluralOverride?.trim() || analyzed.nounInfo?.plural,
    arabicMeaning: resolvedArabicMeaning,
    ipa: params.ipaOverride?.trim() || analyzed.ipa,
    arabicPronunciation: params.pronunciationOverride?.trim() || analyzed.pronunciationArabic,
    partOfSpeech: params.posOverride?.trim() || analyzed.partOfSpeech,
    exampleGerman: params.exampleGermanOverride?.trim() || analyzed.exampleGerman,
    exampleArabic: params.exampleArabicOverride?.trim() || analyzed.exampleArabic,
    level: params.level,
    sourceTitle: 'إضافة يدوية مجمّعة',
    mastery: 'learning',
  };
}

function splitPairLine(line: string): string[] | null {
  // Priority: Tab, Pipe, spaced dash/en-dash/em-dash, Equals, Colon, Semicolon, Comma
  if (line.includes('\t')) {
    return line.split('\t').map((s) => s.trim());
  }
  if (line.includes('|')) {
    return line.split('|').map((s) => s.trim());
  }
  const dashMatch = line.match(/^(.+?)\s+[–—-]\s+(.+)$/);
  if (dashMatch) {
    return [dashMatch[1].trim(), dashMatch[2].trim()];
  }
  if (line.includes('=')) {
    const idx = line.indexOf('=');
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  }
  if (line.includes(':') || line.includes('：')) {
    const idx = line.search(/[:：]/);
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  }
  if (line.includes(';') || line.includes('؛')) {
    return line.split(/[;؛]/).map((s) => s.trim());
  }
  if (line.includes(',') || line.includes('،')) {
    // If line has Arabic letters, treat first comma as German <-> Arabic separator
    if (HAS_ARABIC_RE.test(line)) {
      const idx = line.search(/[,،]/);
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }
  }
  return null;
}

/**
 * Parses a manually pasted/uploaded batch of German words (with or without Arabic meanings,
 * bullet lists, CSV exports, or comma-separated German words).
 */
export function parseManualWordsInput(
  rawText: string,
  defaultLevel: CEFRLevel
): ParsedManualWordsResult {
  const cleanText = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rawLines = cleanText.split('\n');

  const entries: Omit<SavedWord, 'id' | 'dateSaved'>[] = [];
  const invalidLines: InvalidImportLine[] = [];
  let totalNonEmpty = 0;

  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    let line = rawLine.trim();
    if (!line) return;

    totalNonEmpty += 1;

    // 1. Check for full CSV export row (4+ columns or quoted CSV)
    if (line.includes('"') || (line.split(',').length >= 3 && !HAS_ARABIC_RE.test(line.split(',')[0]))) {
      const cells = parseCsvRow(line);
      if (isLikelyCsvHeader(cells)) {
        return;
      }
      if (cells.length >= 4 && HAS_LATIN_RE.test(cells[0])) {
        const hasFullSchema = cells.length >= 8 && VALID_LEVELS.has(cells[7].trim().toUpperCase() as CEFRLevel);
        if (hasFullSchema) {
          entries.push(
            buildSavedWordEntry({
              germanRaw: cells[0],
              articleOverride: cells[1],
              pluralOverride: cells[2],
              arabicRaw: cells[3],
              pronunciationOverride: cells[4],
              ipaOverride: cells[5],
              posOverride: cells[6],
              level: normalizeLevel(cells[7], defaultLevel),
              exampleGermanOverride: cells[8],
              exampleArabicOverride: cells[9],
            })
          );
          return;
        }
        entries.push(
          buildSavedWordEntry({
            germanRaw: cells[0],
            arabicRaw: cells[1],
            level: normalizeLevel(cells[2], defaultLevel),
            exampleGermanOverride: cells[3],
          })
        );
        return;
      }
    }

    // Strip leading list markers like "1. ", "1) ", "• ", "* "
    line = line.replace(/^\s*(?:\d+[.)]\s+|[•*]\s+)/, '').trim();
    if (!line) return;

    // 2. Try splitting as German <-> Arabic pair (or multi-column line)
    const parts = splitPairLine(line);
    if (parts && parts.length >= 2) {
      let left = parts[0];
      let right = parts[1];

      // Auto-swap if user typed Arabic first and German second (e.g. "الطاولة - der Tisch")
      if (HAS_ARABIC_RE.test(left) && !HAS_LATIN_RE.test(left) && HAS_LATIN_RE.test(right)) {
        const tmp = left;
        left = right;
        right = tmp;
      }

      if (!HAS_LATIN_RE.test(left) || HAS_ARABIC_RE.test(left)) {
        invalidLines.push({
          lineNumber,
          content: rawLine.trim(),
          reason: 'لم يتم التعرف على كلمة ألمانية صالحة في هذا السطر.',
        });
        return;
      }

      const maybeLevel = parts[2] ? normalizeLevel(parts[2], defaultLevel) : defaultLevel;
      const maybeExample = parts[3] || undefined;

      entries.push(
        buildSavedWordEntry({
          germanRaw: left,
          arabicRaw: right,
          level: maybeLevel,
          exampleGermanOverride: maybeExample,
        })
      );
      return;
    }

    // 3. Single line without explicit pair separator:
    //    Could be comma-separated German words ("Haus, Beruf, lernen") or one German word/noun ("der Tisch").
    if (!HAS_ARABIC_RE.test(line) && line.includes(',')) {
      const multiTokens = line
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      let addedAny = false;
      for (const tok of multiTokens) {
        if (HAS_LATIN_RE.test(tok) && !HAS_ARABIC_RE.test(tok)) {
          entries.push(buildSavedWordEntry({ germanRaw: tok, level: defaultLevel }));
          addedAny = true;
        }
      }
      if (!addedAny) {
        invalidLines.push({
          lineNumber,
          content: rawLine.trim(),
          reason: 'السطر لا يحتوي على كلمات ألمانية صالحة.',
        });
      }
      return;
    }

    if (HAS_LATIN_RE.test(line) && !HAS_ARABIC_RE.test(line)) {
      entries.push(buildSavedWordEntry({ germanRaw: line, level: defaultLevel }));
      return;
    }

    invalidLines.push({
      lineNumber,
      content: rawLine.trim(),
      reason: 'يجب أن يحتوي السطر على كلمة ألمانية (مثل: der Tisch - الطاولة).',
    });
  });

  return {
    entries,
    invalidLines,
    totalLines: totalNonEmpty,
  };
}
