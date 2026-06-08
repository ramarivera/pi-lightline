import assert from "node:assert/strict";
import test from "node:test";
import extension, {
  createExtension,
  extensionInfo,
  getPromptHistory,
  readShellHistory,
} from "../src/index.ts";

function createPiHarness() {
  const events = new Map<
    string,
    (event: unknown, ctx: Record<string, unknown>) => Promise<void> | void
  >();
  const commands = new Map<
    string,
    {
      handler: (
        args: string,
        ctx: Record<string, unknown>,
      ) => Promise<void> | void;
    }
  >();
  const pi = {
    on(
      name: string,
      handler: (
        event: unknown,
        ctx: Record<string, unknown>,
      ) => Promise<void> | void,
    ) {
      events.set(name, handler);
    },
    registerCommand(
      name: string,
      options: {
        handler: (
          args: string,
          ctx: Record<string, unknown>,
        ) => Promise<void> | void;
      },
    ) {
      commands.set(name, options);
    },
  };

  return { pi, events, commands };
}

test("factory exposes the extension identity", async () => {
  assert.equal(extensionInfo.name, "lightline");

  const created = createExtension();
  assert.equal(created.name, "lightline");
  assert.equal(extension.name, created.name);
  assert.deepEqual(await created.activate(), extensionInfo);
});

test("activation registers lazy commands and lifecycle hooks", async () => {
  const { pi, events, commands } = createPiHarness();
  const created = createExtension();

  await created.activate(pi);

  assert.deepEqual(
    [...commands.keys()],
    ["shell", "shell-history", "prompt-history"],
  );
  assert.equal(events.has("session_start"), true);
  assert.equal(events.has("before_agent_start"), true);
  assert.equal(events.has("agent_end"), true);
});

test("working message rotates through cheap built-in verbs", async () => {
  const { pi, events } = createPiHarness();
  const messages: Array<string | undefined> = [];
  const ctx = {
    ui: {
      setWorkingMessage(message?: string) {
        messages.push(message);
      },
    },
  };

  await createExtension().activate(pi);
  await events.get("before_agent_start")?.({}, ctx);
  await events.get("before_agent_start")?.({}, ctx);
  await events.get("agent_end")?.({}, ctx);

  assert.deepEqual(messages, ["Working...", "Thinking...", undefined]);
});

test("shell command runs lazily and writes history only when invoked", async () => {
  const { pi, commands } = createPiHarness();
  const writes: string[] = [];
  const notifications: string[] = [];
  let ranCommand = "";

  await createExtension({
    now: () => 123,
    homeDir: () => "C:/Users/ramar",
    readTextFile: async () => "[]",
    ensureDir: async (path) => {
      assert.equal(path, "C:/Users/ramar/.pi/agent/lightline");
    },
    writeTextFile: async (_path, text) => {
      writes.push(text);
    },
    runShellCommand: async (command) => {
      ranCommand = command;
      return { stdout: "done", exitCode: 0 };
    },
  }).activate(pi);

  assert.equal(ranCommand, "");
  await commands.get("shell")?.handler(" git status ", {
    cwd: "C:/repo",
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      setStatus() {},
    },
  });

  assert.equal(ranCommand, "git status");
  assert.equal(notifications.at(-1), "done");
  assert.match(writes[0], /"command": "git status"/);
  assert.match(writes[0], /"cwd": "C:\/repo"/);
});

test("shell-history reads lazily and inserts selected shell command", async () => {
  const { pi, commands } = createPiHarness();
  const inserted: string[] = [];
  let reads = 0;

  await createExtension({
    homeDir: () => "C:/Users/ramar",
    readTextFile: async () => {
      reads += 1;
      return JSON.stringify([
        { command: "npm test", cwd: "C:/repo", timestamp: 9 },
      ]);
    },
  }).activate(pi);

  assert.equal(reads, 0);
  await commands.get("shell-history")?.handler("", {
    ui: {
      select: async (_title: string, options: string[]) => options[0],
      setEditorText(text: string) {
        inserted.push(text);
      },
    },
  });

  assert.equal(reads, 1);
  assert.deepEqual(inserted, ["/shell npm test"]);
});

test("prompt-history extracts newest unique user prompts", () => {
  const prompts = getPromptHistory({
    sessionManager: {
      getEntries: () => [
        { role: "user", content: "first" },
        { role: "assistant", content: "ignore me" },
        { type: "user_message", text: "second" },
        { role: "user", content: "first" },
      ],
    },
  });

  assert.deepEqual(prompts, ["first", "second"]);
});

test("readShellHistory tolerates missing or malformed history", async () => {
  const missing = await readShellHistory({
    homeDir: () => "C:/Users/ramar",
    readTextFile: async () => {
      throw new Error("missing");
    },
  });
  const malformed = await readShellHistory({
    homeDir: () => "C:/Users/ramar",
    readTextFile: async () => "{",
  });

  assert.deepEqual(missing, []);
  assert.deepEqual(malformed, []);
});
