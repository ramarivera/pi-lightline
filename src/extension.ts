export type ExtensionInfo = {
  name: string;
  description: string;
};

type CommandContext = {
  cwd?: string;
  sessionManager?: {
    getEntries?: () => unknown[];
  };
  ui?: {
    notify?: (message: string, type?: "info" | "warning" | "error") => void;
    select?: (title: string, options: string[]) => Promise<string | undefined>;
    setEditorText?: (text: string) => void;
    pasteToEditor?: (text: string) => void;
    setStatus?: (key: string, text: string | undefined) => void;
    setWorkingMessage?: (message?: string) => void;
  };
};

type PiApi = {
  on?: (
    event: string,
    handler: (event: unknown, ctx: CommandContext) => void | Promise<void>,
  ) => void;
  registerCommand?: (
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: CommandContext) => Promise<void> | void;
    },
  ) => void;
  exec?: (
    command: string,
    args: string[],
    options?: { cwd?: string },
  ) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
};

export type ShellHistoryEntry = {
  command: string;
  cwd: string;
  timestamp: number;
};

type LightlineDeps = {
  now?: () => number;
  homeDir?: () => string;
  runShellCommand?: (
    command: string,
    cwd: string | undefined,
    pi: PiApi,
  ) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, text: string) => Promise<void>;
  ensureDir?: (path: string) => Promise<void>;
};

export const extensionInfo: ExtensionInfo = {
  name: "lightline",
  description: "Lightweight Pi statusline and working-message extension",
};

const STATUS_MODE = "lightline-mode";
const STATUS_LAST_SHELL = "lightline-last-shell";
const DEFAULT_WORKING_VERBS = [
  "Working",
  "Thinking",
  "Reading",
  "Editing",
  "Testing",
  "Building",
  "Checking",
  "Tracing",
  "Measuring",
  "Patching",
  "Reviewing",
  "Searching",
  "Syncing",
  "Polishing",
];

function trimCommand(args: string): string {
  return args.trim();
}

function pickEntryText(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const role = record.role ?? record.type ?? record.kind;
  if (typeof role === "string" && !role.toLowerCase().includes("user"))
    return undefined;

  const candidates = [
    record.content,
    record.text,
    record.message,
    record.prompt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
    if (Array.isArray(candidate)) {
      const joined = candidate
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const text = (part as Record<string, unknown>).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .filter(Boolean)
        .join("");
      if (joined.trim()) return joined.trim();
    }
  }

  return undefined;
}

export function getPromptHistory(ctx: CommandContext, limit = 50): string[] {
  const entries = ctx.sessionManager?.getEntries?.() ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (
    let index = entries.length - 1;
    index >= 0 && result.length < limit;
    index -= 1
  ) {
    const text = pickEntryText(entries[index]);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result;
}

function getHistoryPath(home: string): string {
  return `${home.replace(/[\\/]$/, "")}/.pi/agent/lightline/shell-history.json`;
}

function getHistoryDir(home: string): string {
  return `${home.replace(/[\\/]$/, "")}/.pi/agent/lightline`;
}

function normalizeHistory(value: unknown): ShellHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const record = entry as Record<string, unknown>;
      const command =
        typeof record.command === "string" ? record.command.trim() : "";
      const cwd = typeof record.cwd === "string" ? record.cwd : "";
      const timestamp =
        typeof record.timestamp === "number" ? record.timestamp : 0;
      if (!command) return undefined;
      return { command, cwd, timestamp };
    })
    .filter((entry): entry is ShellHistoryEntry => Boolean(entry));
}

export async function readShellHistory(
  deps: Required<Pick<LightlineDeps, "homeDir" | "readTextFile">>,
) {
  try {
    const text = await deps.readTextFile(getHistoryPath(deps.homeDir()));
    return normalizeHistory(JSON.parse(text));
  } catch {
    return [];
  }
}

async function writeShellHistory(
  deps: Required<
    Pick<LightlineDeps, "homeDir" | "writeTextFile" | "ensureDir">
  >,
  entries: ShellHistoryEntry[],
) {
  await deps.ensureDir(getHistoryDir(deps.homeDir()));
  await deps.writeTextFile(
    getHistoryPath(deps.homeDir()),
    `${JSON.stringify(entries.slice(0, 100), null, 2)}\n`,
  );
}

async function appendShellHistory(
  deps: Required<
    Pick<
      LightlineDeps,
      "homeDir" | "readTextFile" | "writeTextFile" | "ensureDir" | "now"
    >
  >,
  command: string,
  cwd: string | undefined,
) {
  const existing = await readShellHistory(deps);
  const next = [
    { command, cwd: cwd ?? "", timestamp: deps.now() },
    ...existing.filter((entry) => entry.command !== command),
  ];
  await writeShellHistory(deps, next);
}

async function defaultRunShellCommand(
  command: string,
  cwd: string | undefined,
  pi: PiApi,
) {
  if (pi.exec) {
    return pi.exec(command, [], { cwd });
  }

  const { exec } = await import("node:child_process");
  return new Promise<{ stdout?: string; stderr?: string; exitCode?: number }>(
    (resolve) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        const exitCode =
          typeof (error as { code?: unknown } | null)?.code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ stdout, stderr, exitCode });
      });
    },
  );
}

async function defaultReadTextFile(path: string) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

async function defaultWriteTextFile(path: string, text: string) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, text, "utf8");
}

async function defaultEnsureDir(path: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
}

function defaultHomeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? ".";
}

function showChoices(ctx: CommandContext, title: string, choices: string[]) {
  if (choices.length === 0) {
    ctx.ui?.notify?.("No history yet", "info");
    return Promise.resolve(undefined);
  }
  return ctx.ui?.select?.(title, choices) ?? Promise.resolve(choices[0]);
}

function insertEditorText(ctx: CommandContext, text: string) {
  if (ctx.ui?.setEditorText) {
    ctx.ui.setEditorText(text);
    return;
  }
  ctx.ui?.pasteToEditor?.(text);
}

function shortCommand(command: string) {
  return command.length > 32 ? `${command.slice(0, 29)}...` : command;
}

export function createExtension(deps: LightlineDeps = {}) {
  const fullDeps = {
    now: deps.now ?? Date.now,
    homeDir: deps.homeDir ?? defaultHomeDir,
    runShellCommand: deps.runShellCommand ?? defaultRunShellCommand,
    readTextFile: deps.readTextFile ?? defaultReadTextFile,
    writeTextFile: deps.writeTextFile ?? defaultWriteTextFile,
    ensureDir: deps.ensureDir ?? defaultEnsureDir,
  };
  let workingIndex = 0;

  return {
    name: extensionInfo.name,
    async activate(pi?: PiApi) {
      pi?.on?.("session_start", (_event, ctx) => {
        ctx.ui?.setStatus?.(STATUS_MODE, "idle");
      });

      pi?.on?.("before_agent_start", (_event, ctx) => {
        const verb =
          DEFAULT_WORKING_VERBS[workingIndex % DEFAULT_WORKING_VERBS.length];
        workingIndex += 1;
        ctx.ui?.setWorkingMessage?.(`${verb}...`);
      });

      pi?.on?.("agent_end", (_event, ctx) => {
        ctx.ui?.setWorkingMessage?.();
      });

      pi?.registerCommand?.("shell", {
        description: "Run a shell command lazily and store lightweight history",
        handler: async (args, ctx) => {
          const command = trimCommand(args);
          if (!command) {
            ctx.ui?.notify?.("Usage: /shell <command>", "warning");
            return;
          }

          ctx.ui?.setStatus?.(STATUS_MODE, "shell");
          const result = await fullDeps.runShellCommand(command, ctx.cwd, pi);
          await appendShellHistory(fullDeps, command, ctx.cwd);
          ctx.ui?.setStatus?.(STATUS_LAST_SHELL, shortCommand(command));

          const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join("\n")
            .trim();
          ctx.ui?.notify?.(
            output || `Shell exited ${result.exitCode ?? 0}: ${command}`,
            result.exitCode ? "warning" : "info",
          );
        },
      });

      pi?.registerCommand?.("shell-history", {
        description:
          "Pick a previous shell command without reading history at startup",
        handler: async (_args, ctx) => {
          const history = await readShellHistory(fullDeps);
          const selected = await showChoices(
            ctx,
            "Shell history",
            history.map((entry) => entry.command),
          );
          if (selected) insertEditorText(ctx, `/shell ${selected}`);
        },
      });

      pi?.registerCommand?.("prompt-history", {
        description: "Pick a recent prompt from the current session lazily",
        handler: async (_args, ctx) => {
          const selected = await showChoices(
            ctx,
            "Prompt history",
            getPromptHistory(ctx),
          );
          if (selected) insertEditorText(ctx, selected);
        },
      });

      return extensionInfo;
    },
  };
}
