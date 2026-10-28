import { expect, test } from "bun:test";
import { countRunning, quitPlan, quitQuestion, stopOwned, stopServer } from "../../desktop/src/logic/quit.ts";

test("an attached server is never stopped, however many sessions run", () => {
  expect(quitPlan({ ownsServer: false, running: 0 })).toEqual({ kind: "exit" });
  expect(quitPlan({ ownsServer: false, running: 2 })).toEqual({ kind: "exit" });
});

test("an owned server stops without asking when nothing runs, and asks with the count otherwise", () => {
  expect(quitPlan({ ownsServer: true, running: 0 })).toEqual({ kind: "stop" });
  expect(quitPlan({ ownsServer: true, running: 2 })).toEqual({ kind: "confirm", running: 2 });
});

test("running sessions are counted from the sessions endpoint's body", () => {
  expect(countRunning({ sessions: [{ state: "running" }, { state: "exited" }, { state: "running" }, { state: "failed" }] })).toBe(2);
  expect(countRunning({ sessions: [] })).toBe(0);
  expect(countRunning(null)).toBe(0);
  expect(countRunning({ error: "agent sessions are not available" })).toBe(0);
});

test("the question names how many sessions stop", () => {
  expect(quitQuestion(2).title).toBe("Stop 2 running agent sessions?");
  expect(quitQuestion(1).title).toBe("Stop 1 running agent session?");
  expect(quitQuestion(2).buttons).toEqual(["Quit", "Cancel"]);
});

test("SIGTERM first; SIGKILL only when the grace period runs out", async () => {
  const signals: unknown[] = [];
  let exit = () => {};
  const polite = {
    kill: (s?: unknown) => {
      signals.push(s);
      exit();
    },
    exited: new Promise<void>((r) => (exit = r)),
  };
  expect(await stopServer(polite, 1000)).toBe("stopped");
  expect(signals).toEqual(["SIGTERM"]);

  signals.length = 0;
  let die = () => {};
  const stubborn = {
    kill: (s?: unknown) => {
      signals.push(s);
      if (s === "SIGKILL") die();
    },
    exited: new Promise<void>((r) => (die = r)),
  };
  expect(await stopServer(stubborn, 20)).toBe("killed");
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("a real child that handles SIGTERM exits within the grace period", async () => {
  const child = Bun.spawn(["bun", "-e", `process.on("SIGTERM", () => setTimeout(() => process.exit(0), 50)); console.log("up"); setInterval(() => {}, 1000);`], { stdout: "pipe" });
  const reader = child.stdout.getReader();
  await reader.read(); // started and handling signals
  expect(await stopServer(child, 5000)).toBe("stopped");
  expect(child.exitCode).toBe(0);
});

test("Another instance took the lock while the server started: the server the app started is stopped", async () => {
  const signals: unknown[] = [];
  let exit = () => {};
  const started = {
    kill: (s?: unknown) => {
      signals.push(s);
      exit();
    },
    exited: new Promise<void>((r) => (exit = r)),
  };
  expect(await stopOwned(started, 1000)).toBe("stopped");
  expect(signals).toEqual(["SIGTERM"]);
});

test("Attached server is left alone: with nothing started, nothing is stopped", async () => {
  expect(await stopOwned(undefined)).toBe("none");
});
