import { describe, expect, it } from "vitest";
import { footnoteHealth, paragraphTextSet, renderMarkdownPaper } from "./markdown";

describe("markdown rendering", () => {
  it("renders headings, paragraphs, ids, and footnote refs", () => {
    const md = "# 题名\n\n第一段有注释[^1]。\n\n## 一、问题\n\n第二段。\n\n[^1]: 注释内容";
    const rendered = renderMarkdownPaper(md);
    expect(rendered.html).toContain("<h1");
    expect(rendered.html).toContain('data-paragraph-id="p-1"');
    expect(rendered.html).toContain('class="footnote-ref"');
    expect(rendered.paragraphs).toHaveLength(2);
    expect(rendered.footnoteHealth.total).toBe(1);
  });

  it("marks changed paragraphs after a previous baseline", () => {
    const previous = paragraphTextSet("第一段。\n\n第二段。");
    const rendered = renderMarkdownPaper("第一段。\n\n第二段改了。", { previousParagraphTexts: previous });
    expect(rendered.paragraphs[0].edited).toBe(false);
    expect(rendered.paragraphs[1].edited).toBe(true);
  });

  it("detects dangling, undefined, and duplicated footnotes", () => {
    const health = footnoteHealth("正文[^1]，再次引用[^1]，另有缺失[^2]。\n\n[^1]: 注释\n[^3]: 未引用");
    expect(health.duplicated).toEqual(["1"]);
    expect(health.undefined).toEqual(["2"]);
    expect(health.dangling).toEqual(["3"]);
  });
});
