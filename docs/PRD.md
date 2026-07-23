# PRD: HTML Writer

## Problem

Chinese academic manuscripts are usually edited in Markdown but judged by reading them as continuous, typeset prose. Chat-style AI editing breaks the reading loop: the author must copy text out, ask for edits, paste results back, and then separately judge whether the revised passage works in the full paper.

## Product Goal

Create a VS Code extension that lets the author read the full Markdown manuscript as a journal-style HTML document, select a problematic paragraph or section, run a disciplined five-step AI rewrite pipeline, preview candidates in context, and apply only the chosen rewrite back to Markdown.

## Success Criteria

- A Markdown manuscript opens in a live HTML reader with TOC, footnote hover, word count, footnote health, paragraph selection, and changed-paragraph highlighting.
- The author can select a paragraph in the reader or editor and run the five-step pipeline.
- Each pipeline step is visible as structured JSON-backed UI, not a black-box rewrite.
- Candidates can be previewed in the full rendered paper without modifying the Markdown source.
- Applying a candidate uses a VS Code workspace edit and highlights the changed paragraph after re-render.

## Non-Goals For MVP

- DOCX export.
- Direct Claude skill runtime integration.
- Full scholarly source verification.
- Multi-file manuscript assembly.

## Users

The primary user is a Chinese legal academic author who writes in Markdown, needs to read the manuscript in a polished surface, and wants AI assistance without losing control over claims, evidence, and prose judgment.
