# SPEC: HTML Writer

## Source Model

- Markdown is the only source of truth.
- HTML is generated and disposable.
- Pipeline artifacts are written under `.paper-html-writer/sessions/<timestamp>/`.
- Project helper templates are written under `.paper-html-writer/`.

## Commands

- `vscodeHtmlWriter.openReader`: open or reveal the live reader for the active Markdown file.
- `vscodeHtmlWriter.runRewritePipeline`: run the five-step pipeline for the current editor selection or selected reader paragraph.
- `vscodeHtmlWriter.previewCandidate`: preview a selected candidate in the reader only.
- `vscodeHtmlWriter.applyCandidate`: apply the selected candidate to Markdown via `WorkspaceEdit`.
- `vscodeHtmlWriter.setApiKey`: store a provider API key in VS Code SecretStorage.

## Reader Behavior

The reader renders a single Markdown document into standalone Webview HTML with:

- journal-like typography derived from `paper-html-proof`;
- clickable TOC;
- live CJK body count excluding footnotes;
- footnote hover cards;
- footnote health panel for dangling, undefined, and duplicate references;
- paragraph IDs and source ranges;
- click-to-select paragraph behavior;
- changed-paragraph highlighting after source edits.

## Pipeline

The five steps are:

1. `facts`: extract hard facts, normative claims, reader implications, open questions, and forbidden claims.
2. `structure`: design argument structure without drafting.
3. `draft`: produce conservative, concise, and structural rewrite candidates.
4. `audit`: sentence-level support audit and polished result.
5. `title`: title or subheading candidates.

Each step receives only the prior step outputs it needs. Each step writes JSON. Invalid JSON or schema failure stops the pipeline and leaves prior artifacts for review.

## Providers

Supported providers are `qwen`, `deepseek`, `gemini`, `anthropic`, and `mimo`.

- If a provider exposes an Anthropic-compatible endpoint, the extension uses Anthropic Messages as the default route.
- Qwen defaults to Token Plan Anthropic-compatible messages at `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`, with OpenAI-compatible Token Plan kept as fallback at `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`.
- Qwen model options include `qwen3.6-flash`, `qwen3.6-plus`, `qwen3.7-max`, `qwen3.7-max-2026-05-20`, `qwen3-coder-next`, and `qwen3-coder-plus`. The extension defaults to Flash for speed/cost; use Max for harder drafting or audit passes.
- DeepSeek uses only its official Anthropic-compatible endpoint at `https://api.deepseek.com/anthropic`.
- DeepSeek exposes `deepseek-v4-flash` and `deepseek-v4-pro`; the extension defaults to Flash for speed/cost and lets the user select Pro for harder reasoning.
- Gemini uses native `generateContent` and `generationConfig.responseMimeType = "application/json"` for JSON steps.
- Gemini exposes `gemini-3.5-flash`, `gemini-3.1-pro`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, and `gemini-3.1-flash-lite`; `gemini-3.1-pro` is a user-facing alias that is normalized to the official `gemini-3.1-pro-preview` API ID before requests.
- Anthropic is a first-class native provider with `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, and `claude-haiku-4-5`.
- MiMo defaults to Token Plan Anthropic-compatible messages when available, with OpenAI-compatible chat completions kept as an override.
- The Activity Bar Model Catalog displays each provider's recommended models and lets the user write model settings by clicking a model.

API keys are read from VS Code SecretStorage first, then from environment variables. Qwen checks `TOKEN_PLAN_API_KEY`, `BAILIAN_TOKEN_PLAN_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, then `QWEN_API_KEY`; Anthropic checks `ANTHROPIC_API_KEY` then `CLAUDE_API_KEY`. Keys are never echoed into logs or UI.

## Apply Rules

- Preview never writes Markdown.
- Apply replaces only the selected source range.
- Apply is disabled if no candidate exists, if the source document changed enough to invalidate the range, or if the candidate body is empty.
