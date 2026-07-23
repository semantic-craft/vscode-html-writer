import type { FootnoteHealth, ParagraphBlock, RenderedPaper } from "./types";

interface RenderOptions {
  previousParagraphTexts?: Set<string>;
  previewRange?: { start: number; end: number; body: string };
}

interface FootnoteDef {
  id: string;
  text: string;
}

const HAN_RE = /[\u4e00-\u9fff]/g;

export function renderMarkdownPaper(markdown: string, options: RenderOptions = {}): RenderedPaper {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const renderedSource = options.previewRange ? replacePreviewRange(normalized, options.previewRange) : normalized;
  const footnoteDefs = extractFootnoteDefs(renderedSource);
  const health = footnoteHealth(renderedSource);
  const paragraphs: ParagraphBlock[] = [];
  const htmlParts: string[] = [];
  const lines = renderedSource.split("\n");
  let offset = 0;
  let paraLines: Array<{ text: string; start: number; end: number }> = [];
  let paraIndex = 0;

  const flushParagraph = () => {
    if (!paraLines.length) return;
    const start = paraLines[0].start;
    const end = paraLines[paraLines.length - 1].end;
    const text = paraLines.map((line) => line.text.trim()).join(" ").trim();
    const id = `p-${++paraIndex}`;
    const edited = Boolean(options.previousParagraphTexts && text && !options.previousParagraphTexts.has(text));
    paragraphs.push({ id, text, range: { start, end }, edited });
    htmlParts.push(
      `<p data-paragraph-id="${escapeAttribute(id)}" class="${edited ? "edited" : ""}">${renderInline(text)}</p>`,
    );
    paraLines = [];
  };

  for (const line of lines) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }
    if (/^\[\^[^\]]+\]:/.test(trimmed)) {
      flushParagraph();
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = `sec-${htmlSlug(title)}-${start}`;
      htmlParts.push(`<h${level} id="${escapeAttribute(id)}">${renderInline(title)}</h${level}>`);
      continue;
    }
    const list = /^[-*]\s+(.+)$/.exec(trimmed);
    if (list) {
      flushParagraph();
      htmlParts.push(`<ul class="single-list"><li>${renderInline(list[1].trim())}</li></ul>`);
      continue;
    }
    paraLines.push({ text: line, start, end });
  }
  flushParagraph();

  if (footnoteDefs.length) {
    htmlParts.push(renderFootnotes(footnoteDefs));
  }

  const bodyText = stripMarkdownFootnotes(renderedSource);
  return {
    html: htmlParts.join("\n"),
    bodyText,
    paragraphs,
    footnoteHealth: health,
  };
}

export function paragraphTextSet(markdown: string): Set<string> {
  return new Set(renderMarkdownPaper(markdown).paragraphs.map((p) => p.text).filter(Boolean));
}

export function footnoteHealth(markdown: string): FootnoteHealth {
  const defs = new Set<string>();
  const refs = new Map<string, number>();
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    const def = /^\[\^([^\]]+)\]:/.exec(line);
    if (def) {
      defs.add(def[1]);
      continue;
    }
    for (const match of line.matchAll(/\[\^([^\]]+)\]/g)) {
      refs.set(match[1], (refs.get(match[1]) ?? 0) + 1);
    }
  }
  const sortKey = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
  return {
    dangling: [...defs].filter((id) => !refs.has(id)).sort(sortKey),
    undefined: [...refs.keys()].filter((id) => !defs.has(id)).sort(sortKey),
    duplicated: [...refs.entries()].filter(([, count]) => count >= 2).map(([id]) => id).sort(sortKey),
    total: defs.size,
  };
}

export function countCjk(text: string): number {
  return text.match(HAN_RE)?.length ?? 0;
}

function replacePreviewRange(source: string, range: { start: number; end: number; body: string }): string {
  return `${source.slice(0, range.start)}${range.body}${source.slice(range.end)}`;
}

function extractFootnoteDefs(markdown: string): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^\s*\[\^([^\]]+)\]:\s*(.+?)\s*$/.exec(line);
    if (match) defs.push({ id: match[1], text: match[2] });
  }
  return defs;
}

function stripMarkdownFootnotes(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*\[\^[^\]]+\]:/.test(line))
    .join("\n");
}

function renderFootnotes(defs: FootnoteDef[]): string {
  const items = defs
    .map((def) => `<li id="fn-${escapeAttribute(def.id)}"><p>${renderInline(def.text)}</p></li>`)
    .join("\n");
  return `<section class="footnotes"><ol>\n${items}\n</ol></section>`;
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\^([^\]]+)\]/g, (_m, id: string) => `<a class="footnote-ref" href="#fn-${escapeAttribute(id)}"><sup>${escapeHtml(id)}</sup></a>`);
}

function htmlSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "section";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
