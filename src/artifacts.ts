import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ARTIFACT_DIR = ".paper-html-writer";

export async function ensureProjectArtifacts(workspaceDir: string): Promise<string> {
  const root = join(workspaceDir, ARTIFACT_DIR);
  await mkdir(join(root, "sessions"), { recursive: true });
  await writeIfMissing(join(root, "project-prd.md"), projectPrdTemplate());
  await writeIfMissing(join(root, "project-spec.md"), projectSpecTemplate());
  await writeIfMissing(join(root, "section-tests.md"), sectionTestsTemplate());
  return root;
}

export async function createSessionDir(workspaceDir: string, date = new Date()): Promise<string> {
  const root = await ensureProjectArtifacts(workspaceDir);
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const dir = join(root, "sessions", stamp);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJsonArtifact(sessionDir: string, fileName: string, value: unknown): Promise<void> {
  await writeFile(join(sessionDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    await writeFile(path, content, "utf8");
  }
}

function projectPrdTemplate(): string {
  return `# Paper PRD\n\n- Problem Statement:\n- Central Claim:\n- Reader / Reviewer Stories:\n- Writing Decisions:\n- Out of Scope:\n- Verification Gaps:\n`;
}

function projectSpecTemplate(): string {
  return `# Paper Rewrite SPEC\n\n- Source Markdown:\n- Style Guide:\n- Forbidden Claims:\n- Provider Preferences:\n- Review Notes:\n`;
}

function sectionTestsTemplate(): string {
  return `# Section Tests\n\nUse one section at a time.\n\n- Reader-visible behavior:\n- Claim that must be visible:\n- Source gaps:\n- Pass / fail notes:\n`;
}
