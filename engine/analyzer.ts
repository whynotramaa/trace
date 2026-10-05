import { porterStem } from "./porter.ts";

export type AnalyzerMode = "anserini" | "technical";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is",
  "it", "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there",
  "these", "they", "this", "to", "was", "will", "with",
]);

// StandardTokenizer uses UAX #29. Bun's ICU is the closest native equivalent,
// but its Unicode data can differ from Lucene's pinned UAX 12.1 tables.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const HAN = /\p{Script=Han}/u;
const HIRAGANA = /\p{Script=Hiragana}/u;
const COMPLEX_CONTEXT = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const REGIONAL_INDICATORS = /\p{Regional_Indicator}/u;
const KEYCAP = /[0-9#*]\uFE0F?\u20E3/u;

type RawToken = { text: string; end: number };

function splitLuceneScriptToken(text: string): string[] {
  if (!HAN.test(text) && !HIRAGANA.test(text)) return [text];
  const result: string[] = [];
  let current = "";
  for (const character of text) {
    if (HAN.test(character) || HIRAGANA.test(character)) {
      if (current) result.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) result.push(current);
  return result;
}

function isLuceneEmoji(text: string): boolean {
  return EMOJI.test(text) || (REGIONAL_INDICATORS.test(text) && [...text].length >= 2) || KEYCAP.test(text);
}

function rawStandardTokens(text: string): string[] {
  const result: RawToken[] = [];
  for (const part of SEGMENTER.segment(text)) {
    if (!part.isWordLike && !isLuceneEmoji(part.segment)) continue;
    const pieces = splitLuceneScriptToken(part.segment);
    for (const piece of pieces) {
      const previous = result[result.length - 1];
      // Lucene deliberately keeps South/Southeast Asian complex-context text
      // together; ICU may dictionary-segment it into several word-like parts.
      if (previous && previous.end === part.index && COMPLEX_CONTEXT.test(previous.text) && COMPLEX_CONTEXT.test(piece)) {
        previous.text += piece;
      } else {
        result.push({ text: piece, end: part.index + part.segment.length });
      }
    }
  }
  return result.map(({ text: token }) => token);
}

function analyzeAnserini(text: string): string[] {
  const result: string[] = [];
  for (const raw of rawStandardTokens(text)) {
    const possessive = raw.replace(/['’＇][sS]$/u, "");
    const token = possessive.toLowerCase();
    if (STOP_WORDS.has(token)) continue;
    result.push(porterStem(token));
  }
  return result;
}

// Deliberately separate from parity mode: retain source spelling and common
// programming-token punctuation for the technical-corpus experiment.
const TECHNICAL_TOKEN = /https?:\/\/[^\s<>"'`]+|C\+\+|C#|[A-Za-z0-9_$@~+-]+(?:[/.][A-Za-z0-9_$@~+-]+)+|[$A-Za-z_][A-Za-z0-9_$-]*/gu;

function analyzeTechnical(text: string): string[] {
  const result: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TECHNICAL_TOKEN)) {
    const index = match.index ?? cursor;
    result.push(...rawStandardTokens(text.slice(cursor, index)));
    result.push(match[0]);
    cursor = index + match[0].length;
  }
  result.push(...rawStandardTokens(text.slice(cursor)));
  return result;
}

export function analyze(text: string, mode: AnalyzerMode = "anserini"): string[] {
  return mode === "technical" ? analyzeTechnical(text) : analyzeAnserini(text);
}
