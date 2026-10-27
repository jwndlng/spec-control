import { expect, test } from "bun:test";
import { columnKind, promptBody } from "../src/ui/boardMarks.ts";
import { ChangeCard, meterText, needsYouText, type Card } from "../src/ui/kanban.tsx";
import { byTag, textOf } from "./vnode.ts";

test("column markers follow the lifecycle", () => {
  const kinds = ["Backlog", "Drafts", "Ready", "Implementing", "Done", "Archived", "Unknown"].map(columnKind);
  expect(kinds).toEqual(["neutral", "neutral", "accent", "accent", "success", "muted", "warning"]);
});

test("the detail view shows the prompt without the heading the create form writes", () => {
  expect(promptBody("# Prompt\n\nLog every mutation\nand keep it for a year\n")).toBe("Log every mutation\nand keep it for a year");
  expect(promptBody("  \n\n  Rotate keys weekly  ")).toBe("Rotate keys weekly");
  expect(promptBody("# Prompt\n\n   \n")).toBeUndefined();
  expect(promptBody(undefined)).toBeUndefined();
});

const card = (patch: Partial<Card>): Card => ({
  repoId: "r", repoName: "demo-ops", repoPath: "/w/acme/demo-ops", hue: 0,
  name: "confirm-retention", schema: "spec-driven",
  artifacts: ["proposal", "specs", "design", "tasks"].map((id) => ({ id, status: "done" as const })),
  tasks: { done: 13, awaiting: 2, total: 15 }, stage: "done", column: "Done", subState: "validate",
  ...patch,
});
const badges = (node: Card) => byTag(ChangeCard({ card: node, now: Date.parse("2026-09-29T12:00:00Z"), from: "" }), "span").filter((b) => String(b.props.class ?? "").startsWith("badge"));

const needsYou = (node: Card) => byTag(ChangeCard({ card: node, now: Date.parse("2026-09-29T12:00:00Z"), from: "/board" }), "a").filter((a) => String(a.props.class ?? "").includes("needs-you"));

test("a card with tasks that need the user shows the Needs you badge, in the warning role, saying what to do", () => {
  const tasks = { done: 13, awaiting: 2, awaitingTasks: ["Add the API token to the deployment secrets — you: set API_TOKEN", "Check the retry on a slow network"], total: 15 };
  const [badge] = needsYou(card({ tasks }));
  expect([badge.props.class, textOf(badge)]).toEqual(["badge warning needs-you", "2 need you"]);
  const text = "2 tasks need you — something to check or do that only you can:\n• Add the API token to the deployment secrets — you: set API_TOKEN\n• Check the retry on a slow network";
  expect([badge.props.title, badge.props["aria-label"]]).toEqual([text, text]);
  expect(needsYouText({ awaiting: 1, awaitingTasks: ["Sign in"] })).toBe("1 task needs you — something to check or do that only you can:\n• Sign in");
  // A snapshot from before the scan reported the text still says how many.
  expect(needsYouText({ awaiting: 2 })).toBe("2 tasks need you — something to check or do that only you can");
  // The text is the repository's, drawn as text: markup in it is just characters of the title.
  expect(needsYouText({ awaiting: 1, awaitingTasks: ["<b>x</b>"] })).toContain("• <b>x</b>");
});

test("the Needs you badge opens the change's tasks, carrying the board", () => {
  const [badge] = needsYou(card({}));
  expect(badge.props.href).toBe("/repo/r/change/confirm-retention?artifact=tasks&from=%2Fboard");
});

test("more tasks than the scan lists end in `and N more`", () => {
  const awaitingTasks = Array.from({ length: 10 }, (_, i) => `task ${i + 1}`);
  const [badge] = needsYou(card({ tasks: { done: 0, awaiting: 12, awaitingTasks, total: 12 } }));
  expect(textOf(badge)).toBe("12 need you");
  const lines = String(badge.props.title).split("\n");
  expect(lines.slice(1)).toEqual([...awaitingTasks.map((t) => `• ${t}`), "and 2 more"]);
});

test("no Needs you badge without awaiting tasks, and never on an archived change", () => {
  expect(needsYou(card({ tasks: { done: 15, awaiting: 0, total: 15 } }))).toEqual([]);
  // A snapshot cached before `awaiting` existed has none either.
  expect(needsYou(card({ tasks: { done: 15, total: 15 } }))).toEqual([]);
  expect(needsYou(card({ archived: "2026-06-18", stage: "archived", column: "Archived", subState: undefined }))).toEqual([]);
  // The former Validate badge is gone.
  expect(badges(card({})).map(textOf)).not.toContain("Validate");
  // The column marker of `Done` stays `success`: the column as a whole is still the done column.
  expect(columnKind("Done")).toBe("success");
});

test("the card's bar names the tasks that need the user in words", () => {
  const view = ChangeCard({ card: card({}), now: Date.parse("2026-09-29T12:00:00Z"), from: "" });
  const [bar] = byTag(view, "div").filter((d) => d.props.role === "progressbar");
  expect(textOf(bar)).toBe("13 + 2 need you / 15 Tasks");
  expect(bar.props["aria-label"]).toBe("13 of 15 tasks complete, 2 need the user, 0 open");
  expect(meterText(14, 15, "tasks", 1)).toBe("14 of 15 tasks complete, 1 needs the user, 0 open");
  expect(meterText(4, 12, "tasks", 0)).toBe("4 of 12 tasks complete");
});

test("a card is marked live only when told it is working, and its name still reads in full", () => {
  const frame = (working?: { tinted: boolean; sweeping: boolean }) => byTag(ChangeCard({ card: card({}), now: Date.parse("2026-09-29T12:00:00Z"), from: "", working }), "article")[0];
  const live = { tinted: true, sweeping: true };
  expect(frame(live).props.class).toBe("card live");
  // Tinted without motion: a pull request that only waits.
  expect(frame({ tinted: true, sweeping: false }).props.class).toBe("card live pr-waiting");
  expect(frame({ tinted: false, sweeping: false }).props.class).toBe("card");
  expect(frame().props.class).toBe("card");
  const name = byTag(frame(live), "span").find((s) => s.props.class === "name");
  expect(name && textOf(name)).toBe("confirm-retention");
});

const notes = (node: Card, running = false) =>
  byTag(ChangeCard({ card: node, now: Date.parse("2026-09-29T12:00:00Z"), from: "", running }), "span").filter((s) => s.props.class === "waits-for");
const blockedReady = card({
  stage: "ready", column: "Ready", subState: undefined, tasks: { done: 0, total: 12 }, blocked: true,
  dependsOn: [
    { name: "add-billing-schema", state: "met" },
    { name: "add-billing-api", state: "waiting" },
    { name: "add-billing-scheme", state: "missing" },
  ],
});

test("a blocked card in Ready waits instead of offering Implement, naming what it waits for", () => {
  const [note] = notes(blockedReady);
  expect(textOf(note)).toBe("⧗ waits for add-billing-api +1");
  expect(note.props.title).toBe("Implement is held back until these are done or archived in the main checkout: add-billing-api — waiting, add-billing-scheme — missing");
  expect(note.props["aria-label"]).toBe(note.props.title);
  // A note, not a control.
  expect(byTag(ChangeCard({ card: blockedReady, now: 0, from: "" }), "button")).toEqual([]);
  expect(notes({ ...blockedReady, stage: "implementing", column: "Implementing" })).toHaveLength(1);
  expect(textOf(notes({ ...blockedReady, dependsOn: undefined })[0])).toContain("depends-on.yaml unreadable");
});

test("no note while drafting, once unblocked, or while a session runs", () => {
  expect(notes({ ...blockedReady, stage: "drafts", column: "Drafts" })).toEqual([]);
  expect(notes({ ...blockedReady, blocked: undefined })).toEqual([]);
  expect(notes(blockedReady, true)).toEqual([]);
});
