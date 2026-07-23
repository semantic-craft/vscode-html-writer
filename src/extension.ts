import * as vscode from "vscode";
import { ReaderPanel, setProviderApiKey, setProviderModel } from "./readerPanel";
import { HtmlWriterSidebarProvider } from "./sidebar";

export function activate(context: vscode.ExtensionContext): void {
  const sidebarProvider = new HtmlWriterSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("vscodeHtmlWriter.cockpit", sidebarProvider),
    vscode.commands.registerCommand("vscodeHtmlWriter.openReader", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Open a Markdown manuscript first.");
        return;
      }
      ReaderPanel.open(context, editor.document);
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.runRewritePipeline", async () => {
      const panel = await ensurePanel(context);
      await panel?.runPipelineFromCommand();
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.previewCandidate", async () => {
      await ReaderPanel.current?.previewCandidateFromCommand();
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.applyCandidate", async () => {
      await ReaderPanel.current?.applyCandidateFromCommand();
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.setApiKey", async () => {
      await setProviderApiKey(context);
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.selectProviderModel", async (providerId, modelId) => {
      await setProviderModel(providerId, modelId);
      sidebarProvider.refresh();
    }),
    vscode.commands.registerCommand("vscodeHtmlWriter.refreshSidebar", () => {
      sidebarProvider.refresh();
    }),
  );
}

export function deactivate(): void {
  // No background processes.
}

async function ensurePanel(context: vscode.ExtensionContext): Promise<ReaderPanel | undefined> {
  if (ReaderPanel.current) return ReaderPanel.current;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    vscode.window.showWarningMessage("Open a Markdown manuscript first.");
    return undefined;
  }
  return ReaderPanel.open(context, editor.document);
}
