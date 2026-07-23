const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const sampleFile = process.env.VSCODE_HTML_WRITER_SMOKE_FILE;
  const extensionRoot = process.env.VSCODE_HTML_WRITER_EXTENSION_ROOT;
  assert.ok(sampleFile, "smoke file env var is required");
  assert.ok(extensionRoot, "extension root env var is required");

  const doc = await vscode.workspace.openTextDocument(sampleFile);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("vscodeHtmlWriter.openReader");

  const extension = vscode.extensions.getExtension("xianwei-zhang.vscode-html-writer");
  assert.ok(extension, "extension should be discoverable");
  await extension.activate();

  const { ReaderPanel } = require(path.join(extensionRoot, "out", "readerPanel.js"));
  assert.ok(ReaderPanel.current, "reader panel should be open after the command");

  const source = doc.getText();
  const start = source.indexOf("第二段存在");
  const end = start + "第二段存在可组织、可授权、可监督的表达，需要测试回写。".length;
  assert.ok(start > 0, "sample paragraph should be found");

  const panel = ReaderPanel.current;
  panel.activeTarget = {
    documentText: source,
    selectedText: source.slice(start, end),
    range: { start, end },
  };
  panel.candidates = [
    {
      candidate_id: "SMOKE",
      label: "Extension Host 回写",
      body: "第二段已经通过 VS Code Extension Host 回写。",
      revision_note: "smoke",
      source: "audit",
    },
  ];

  await panel.applyCandidate(0);
  const updated = doc.getText();
  assert.match(updated, /第一段保持不变。/);
  assert.match(updated, /第二段已经通过 VS Code Extension Host 回写。/);
  assert.doesNotMatch(updated, /可组织、可授权、可监督/);
  assert.match(updated, /第三段保持不变，并带有脚注/);
}

module.exports = { run };
