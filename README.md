# HTML Writer

VS Code extension for reading, reviewing, and rewriting Chinese academic Markdown manuscripts through a live HTML surface.

The extension treats Markdown as the source of truth, HTML as the human-facing reading and review surface, and `.paper-html-writer/` as the hidden workspace for pipeline artifacts.

## MVP

- Live paper reader for Markdown manuscripts.
- Paragraph-level Review Cockpit.
- Five-step rewrite pipeline: facts, structure, drafts, audit, title.
- Provider adapter for Qwen, DeepSeek, Gemini, Anthropic, and MiMo.
- Candidate preview before Markdown write-back.

## Use

1. Open a Markdown manuscript in VS Code.
2. Run `HTML Writer: Open Paper Reader`.
3. Click a paragraph in the HTML reader, or select text in the editor.
4. Run `HTML Writer: Run Rewrite Pipeline`.
5. Compare candidates in the Review Cockpit.
6. Use `Preview` to see a candidate in the full HTML paper without writing Markdown.
7. Use `Apply` to replace only the selected Markdown range.

The Activity Bar shows a Model Catalog with each provider's current recommended fast and strong models. Clicking a model writes it to the corresponding VS Code setting.

Qwen defaults to Token Plan Anthropic Messages with `qwen3.6-flash`:

- Anthropic-compatible primary Base URL: `https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`
- OpenAI-compatible fallback Base URL: `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

Qwen model options are:

- `qwen3.6-flash`: default, fast path for frequent five-step runs.
- `qwen3.6-plus`: balanced route for routine reasoning and drafting.
- `qwen3.7-max`: strongest current Qwen option.
- `qwen3.7-max-2026-05-20`: dated snapshot for reproducible runs.
- `qwen3-coder-next` / `qwen3-coder-plus`: coding-oriented Qwen options.

Provider keys are stored with `HTML Writer: Set Provider API Key`. SecretStorage is checked first; environment variable fallback is:

- `TOKEN_PLAN_API_KEY`, `BAILIAN_TOKEN_PLAN_API_KEY`, `QWEN_TOKEN_PLAN_API_KEY`, or `QWEN_API_KEY` for Qwen Token Plan.
- `DEEPSEEK_API_KEY` for DeepSeek.
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` for Gemini.
- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` for Anthropic.
- `MIMO_API_KEY` for MiMo.

DeepSeek V4 model options are:

- `deepseek-v4-flash`: default, faster and cheaper.
- `deepseek-v4-pro`: stronger for harder reasoning and audit passes.

DeepSeek uses only its official Anthropic-compatible Base URL:

- `https://api.deepseek.com/anthropic`

Gemini model options are:

- `gemini-3.5-flash`: default, fast path for real-time reading and frequent rewrites.
- `gemini-3.1-pro`: user-facing alias for the current Pro preview API model.
- `gemini-3.1-pro-preview`: official API model ID for Gemini 3.1 Pro.
- `gemini-3-flash-preview` and `gemini-3.1-flash-lite`: additional Gemini fast-path options.

Anthropic model options are:

- `claude-opus-4-8`: strongest Claude option.
- `claude-sonnet-4-6`: default balanced Claude route.
- `claude-haiku-4-5-20251001` / `claude-haiku-4-5`: fast Claude routes.

MiMo defaults to Token Plan Anthropic-compatible mode when available:

- `mimo-v2.5`: default balanced route.
- `mimo-v2.5-pro`: stronger MiMo route.
- `mimo-v2-omni` / `mimo-v2-pro`: earlier Token Plan MiMo options.

## Verify

```bash
npm run check
npm run smoke:vscode
npm run probe:qwen-token-plan
npm audit --audit-level=moderate
npm run package
code --install-extension vscode-html-writer-0.0.8.vsix --force
```
