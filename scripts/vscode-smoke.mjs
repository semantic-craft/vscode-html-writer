import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = await mkdtemp(join(tmpdir(), "html-writer-vscode-"));
const sampleFile = join(workspaceDir, "paper.md");

await writeFile(
  sampleFile,
  [
    "# VS Code Smoke",
    "",
    "第一段保持不变。",
    "",
    "第二段存在可组织、可授权、可监督的表达，需要测试回写。",
    "",
    "第三段保持不变，并带有脚注[^1]。",
    "",
    "[^1]: 注释内容。",
  ].join("\n"),
  "utf8",
);

process.env.VSCODE_HTML_WRITER_SMOKE_FILE = sampleFile;
process.env.VSCODE_HTML_WRITER_EXTENSION_ROOT = root;

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test", "vscode-smoke", "index.js"),
  launchArgs: [workspaceDir, "--disable-workspace-trust"],
  vscodeExecutablePath: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
});
