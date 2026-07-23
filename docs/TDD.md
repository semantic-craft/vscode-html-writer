# TDD: HTML Writer

## Red

- Render a sample Chinese Markdown paper and assert paragraph IDs, headings, footnote refs, and footnote health.
- Mock each provider protocol and assert request shape and JSON extraction.
- Run the pipeline against a mock provider and assert five JSON artifact files are written.
- Preview a candidate and assert the Markdown string remains unchanged.
- Apply a candidate and assert only the selected range changes.

## Green

- Implement pure Markdown rendering and footnote health first.
- Implement Provider Adapter with injectable fetchers.
- Implement the pipeline as pure services independent from VS Code.
- Implement Webview and `WorkspaceEdit` integration last.

## Refactor

- Move prompt text and schemas into dedicated pipeline modules.
- Keep Webview UI state thin; source truth stays in extension host.
- Add provider-specific repair only after failures are observed.

## Acceptance Smoke

Open a real Chinese academic Markdown file, select one paragraph, run the five-step pipeline, preview a candidate in the full HTML paper, apply it, and confirm the Markdown source changes only in the selected paragraph.
