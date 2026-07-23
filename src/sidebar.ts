import * as vscode from "vscode";
import { DEFAULT_PROVIDER_ORDER, MODEL_CATALOG, modelsForProvider, providerTitle } from "./modelCatalog";
import type { ModelInfo } from "./modelCatalog";
import type { ProviderId } from "./types";

type SidebarActionId = "openReader" | "runPipeline" | "previewCandidate" | "applyCandidate" | "setApiKey";
type SidebarKind = "action" | "modelSection" | "provider" | "model";

interface SidebarAction {
  id: SidebarActionId;
  label: string;
  description: string;
  command: string;
  icon: vscode.ThemeIcon;
}

const ACTIONS: SidebarAction[] = [
  {
    id: "openReader",
    label: "Open Paper Reader",
    description: "Read the current Markdown manuscript as HTML",
    command: "vscodeHtmlWriter.openReader",
    icon: new vscode.ThemeIcon("open-preview"),
  },
  {
    id: "runPipeline",
    label: "Run Five-Step Pipeline",
    description: "Facts, structure, draft, audit, title",
    command: "vscodeHtmlWriter.runRewritePipeline",
    icon: new vscode.ThemeIcon("run"),
  },
  {
    id: "previewCandidate",
    label: "Preview Candidate",
    description: "Preview without writing Markdown",
    command: "vscodeHtmlWriter.previewCandidate",
    icon: new vscode.ThemeIcon("preview"),
  },
  {
    id: "applyCandidate",
    label: "Apply Candidate",
    description: "Replace only the selected source range",
    command: "vscodeHtmlWriter.applyCandidate",
    icon: new vscode.ThemeIcon("check"),
  },
  {
    id: "setApiKey",
    label: "Set Provider API Key",
    description: "Store provider or Token Plan API key",
    command: "vscodeHtmlWriter.setApiKey",
    icon: new vscode.ThemeIcon("key"),
  },
];

export class HtmlWriterSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (!element) {
      return [
        ...ACTIONS.map((action) => SidebarItem.action(action)),
        SidebarItem.modelSection(),
      ];
    }
    if (element.kind === "modelSection") {
      return DEFAULT_PROVIDER_ORDER.map((id) => SidebarItem.provider(id));
    }
    if (element.kind === "provider" && element.providerId) {
      return modelsForProvider(element.providerId).map((model) => SidebarItem.model(element.providerId!, model));
    }
    return [];
  }
}

class SidebarItem extends vscode.TreeItem {
  readonly kind: SidebarKind;
  providerId?: ProviderId;

  private constructor(label: string, kind: SidebarKind, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
    this.kind = kind;
  }

  static action(action: SidebarAction): SidebarItem {
    const item = new SidebarItem(action.label, "action", vscode.TreeItemCollapsibleState.None);
    item.id = action.id;
    item.description = action.description;
    item.tooltip = `${action.label}: ${action.description}`;
    item.iconPath = action.icon;
    item.command = {
      command: action.command,
      title: action.label,
    };
    return item;
  }

  static modelSection(): SidebarItem {
    const item = new SidebarItem("Model Catalog", "modelSection", vscode.TreeItemCollapsibleState.Expanded);
    item.id = "modelCatalog";
    item.description = "latest recommended models";
    item.tooltip = "Click a model to set it as the configured model for that provider.";
    item.iconPath = new vscode.ThemeIcon("list-tree");
    return item;
  }

  static provider(providerId: ProviderId): SidebarItem {
    const current = vscode.workspace.getConfiguration("vscodeHtmlWriter").get<string>(`${providerId}.model`, MODEL_CATALOG[providerId].defaultModel);
    const item = new SidebarItem(providerTitle(providerId), "provider", vscode.TreeItemCollapsibleState.Collapsed);
    item.providerId = providerId;
    item.id = `provider:${providerId}`;
    item.description = current;
    item.tooltip = `${MODEL_CATALOG[providerId].protocolNote}\nCurrent model: ${current}`;
    item.iconPath = new vscode.ThemeIcon(providerId === "anthropic" ? "hubot" : "server-process");
    return item;
  }

  static model(providerId: ProviderId, model: ModelInfo): SidebarItem {
    const current = vscode.workspace.getConfiguration("vscodeHtmlWriter").get<string>(`${providerId}.model`, MODEL_CATALOG[providerId].defaultModel);
    const item = new SidebarItem(model.label, "model", vscode.TreeItemCollapsibleState.None);
    const isCurrent = current === model.id;
    item.id = `model:${providerId}:${model.id}`;
    item.providerId = providerId;
    item.description = [model.role, model.recommended ? "recommended" : "", isCurrent ? "current" : ""].filter(Boolean).join(" · ");
    item.tooltip = `${model.id}\n${model.description}`;
    item.iconPath = new vscode.ThemeIcon(isCurrent ? "check" : model.recommended ? "star-full" : "symbol-string");
    item.command = {
      command: "vscodeHtmlWriter.selectProviderModel",
      title: "Select Provider Model",
      arguments: [providerId, model.id],
    };
    return item;
  }
}
