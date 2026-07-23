import type { SourceRange } from "./types";

export function replaceRange(source: string, range: SourceRange, replacement: string): string {
  if (!isValidRange(source, range)) {
    throw new Error("Invalid source range.");
  }
  return `${source.slice(0, range.start)}${replacement}${source.slice(range.end)}`;
}

export function rangeTextMatches(source: string, range: SourceRange, expectedText: string): boolean {
  return isValidRange(source, range) && source.slice(range.start, range.end) === expectedText;
}

export function isValidRange(source: string, range: SourceRange): boolean {
  return Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start && range.end <= source.length;
}

export function normalizeSelectionText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}
