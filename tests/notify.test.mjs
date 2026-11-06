import assert from "node:assert/strict";
import childProcess from "node:child_process";
import test from "node:test";

let fixtureId = 0;

function assistant(text = "Finished", stopReason = "stop") {
  return { role: "assistant", stopReason, content: [{ type: "text", text }] };
}

async function fixture(t, options = {}) {
  const originalEnvironment = {
    PI_NOTIFY_MIN_MS: process.env.PI_NOTIFY_MIN_MS,
    DISPLAY: process.env.DISPLAY,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const [key, value] of Object.entries({ PI_NOTIFY_MIN_MS: options.minMs, DISPLAY: options.display })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  let now = 10_000;
  t.mock.method(Date, "now", () => now);
  const calls = [];
  const execFile = t.mock.fn((file, args, settings, callback) => {
    calls.push({ file, args, settings, callback });
    assert.ok(file === "herbe" || file === "paplay", `Unexpected executable: ${file}`);
    callback(options.processError ?? null, "", "");
    return {};
  });
  const exports = { ...childProcess, execFile };
  t.mock.module("node:child_process", { namedExports: exports, defaultExport: exports });
  const { default: extension } = await import(new URL(`../src/index.ts?fixture=${fixtureId++}`, import.meta.url));
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler) });
  assert.deepEqual([...handlers.keys()], ["agent_start", "agent_end"]);
  const ctx = {
    hasUI: options.hasUI ?? true,
    hasPendingMessages: () => options.pending ?? false,
    cwd: options.cwd ?? "/workspace/project",
  };
  const start = () => handlers.get("agent_start")({ type: "agent_start" }, ctx);
  const end = (messages = [assistant()]) => handlers.get("agent_end")({ type: "agent_end", messages }, ctx);
  const advance = (milliseconds) => { now += milliseconds; };
  const run = async (messages = [assistant()], milliseconds = 3000) => {
    await start();
    advance(milliseconds);
    await end(messages);
  };
  return { calls, start, end, advance, run };
}

function notification(f, title, body, display = ":0") {
  assert.equal(f.calls.length, 2);
  const [herbe, audio] = f.calls;
  assert.equal(herbe.file, "herbe");
  assert.deepEqual(herbe.args, [title, body]);
  assert.equal(herbe.settings.timeout, 10_000);
  assert.equal(herbe.settings.killSignal, "SIGKILL");
  assert.equal(herbe.settings.env.DISPLAY, display);
  assert.equal(typeof herbe.callback, "function");
  assert.equal(audio.file, "paplay");
  assert.deepEqual(audio.args, ["/usr/share/sounds/freedesktop/stereo/message.oga"]);
  assert.deepEqual(Object.keys(audio.settings), ["env"]);
  assert.equal(audio.settings.env, herbe.settings.env);
  assert.equal(typeof audio.callback, "function");
  assert.notEqual(herbe.settings.env, process.env);
}

for (const [name, options, message, milliseconds] of [
  ["no UI", { hasUI: false }, assistant(), 3000],
  ["pending messages", { pending: true }, assistant(), 3000],
  ["short run", {}, assistant(), 2999],
  ["aborted response", {}, assistant("Partial answer", "aborted"), 3000],
]) {
  test(`suppresses notification for ${name}`, async (t) => {
    const f = await fixture(t, options);
    await f.run([message], milliseconds);
    assert.deepEqual(f.calls, []);
  });
}

test("notifies at the default threshold with bounded herbe and audio arguments", async (t) => {
  const f = await fixture(t);
  await f.run();
  notification(f, "pi - project", "Finished");
});

test("uses the last assistant text's first non-empty trimmed line", async (t) => {
  const f = await fixture(t);
  await f.run([
    assistant("Older failure", "error"),
    { role: "assistant", stopReason: "stop", content: [
      { type: "thinking", text: "Not a preview" },
      { type: "text", text: "\r\n   \r\n   Ready for review   \r\nDetails" },
      { type: "text", text: "Another block" },
      { type: "toolCall", text: "Not a preview" },
    ] },
    { role: "user", content: [{ type: "text", text: "Not the assistant" }] },
    { role: "toolResult", content: [{ type: "text", text: "Tool output" }] },
  ]);
  notification(f, "pi - project", "Ready for review");
});

test("combines text blocks while ignoring blocks with no text", async (t) => {
  const f = await fixture(t);
  await f.run([{ role: "assistant", content: [
    { type: "text" },
    { type: "thinking", text: "Hidden" },
    { type: "text", text: "  First useful block  " },
    { type: "text", text: "Later block" },
  ] }]);
  notification(f, "pi - project", "First useful block");
});

test("truncates a preview longer than 120 characters", async (t) => {
  const f = await fixture(t);
  await f.run([assistant("a".repeat(121))]);
  notification(f, "pi - project", `${"a".repeat(117)}\u2026`);
});

test("does not truncate a 120-character preview", async (t) => {
  const f = await fixture(t);
  await f.run([assistant("a".repeat(120))]);
  notification(f, "pi - project", "a".repeat(120));
});

test("marks an error preview and retains its first useful line", async (t) => {
  const f = await fixture(t);
  await f.run([assistant("\n Service unavailable\nRetry later", "error")]);
  notification(f, "pi - project", "\u274c Service unavailable");
});

test("uses the existing error fallback when no text is available", async (t) => {
  const f = await fixture(t);
  await f.run([assistant(" \n ", "error")]);
  notification(f, "pi - project", "\u274c Erreur");
});

test("uses the existing success fallback for a non-text answer", async (t) => {
  const f = await fixture(t);
  await f.run([{ role: "assistant", stopReason: "stop", content: [{ type: "toolCall" }] }]);
  notification(f, "pi - project", "\u2705 Termin\u00e9");
});

test("ignores assistant messages without array content", async (t) => {
  const f = await fixture(t);
  await f.run([assistant("Usable answer"), { role: "assistant", content: "Not an array", stopReason: "aborted" }]);
  notification(f, "pi - project", "Usable answer");
});

test("uses the success fallback when no assistant message exists", async (t) => {
  const f = await fixture(t);
  await f.run([]);
  notification(f, "pi - project", "\u2705 Termin\u00e9");
});

test("keeps the plain title for an empty cwd basename", async (t) => {
  const f = await fixture(t, { cwd: "/" });
  await f.run();
  notification(f, "pi", "Finished");
});

test("inherits an explicit display and the rest of the process environment", async (t) => {
  const f = await fixture(t, { display: ":7" });
  await f.run();
  notification(f, "pi - project", "Finished", ":7");
  assert.deepEqual(f.calls[0].settings.env, { ...process.env });
});

test("honors a custom minimum duration", async (t) => {
  const f = await fixture(t, { minMs: "5000" });
  await f.run([assistant()], 4999);
  assert.deepEqual(f.calls, []);
  await f.run([assistant()], 5000);
  notification(f, "pi - project", "Finished");
});

test("a zero minimum allows an immediate run ending", async (t) => {
  const f = await fixture(t, { minMs: "0" });
  await f.run([assistant()], 0);
  notification(f, "pi - project", "Finished");
});

test("an invalid minimum preserves the current zero fallback", async (t) => {
  const f = await fixture(t, { minMs: "invalid" });
  await f.run([assistant()], 0);
  notification(f, "pi - project", "Finished");
});

test("the minimum is read at module load rather than at run end", async (t) => {
  const f = await fixture(t, { minMs: "5000" });
  process.env.PI_NOTIFY_MIN_MS = "0";
  await f.run([assistant()], 4999);
  assert.deepEqual(f.calls, []);
});

test("a later agent_start resets timing after a suppressed end", async (t) => {
  const f = await fixture(t);
  await f.run([assistant()], 2999);
  assert.deepEqual(f.calls, []);
  f.advance(50_000);
  await f.run([assistant()], 1);
  assert.deepEqual(f.calls, []);
  await f.run();
  notification(f, "pi - project", "Finished");
});

test("an end without a recorded start bypasses the duration filter", async (t) => {
  const f = await fixture(t);
  await f.end();
  notification(f, "pi - project", "Finished");
});

test("subprocess callback errors are ignored without changing audio dispatch", async (t) => {
  const f = await fixture(t, { processError: new Error("Desktop backend unavailable") });
  await f.run();
  notification(f, "pi - project", "Finished");
});
