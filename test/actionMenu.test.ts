import { expect, test } from "bun:test";
import { MENU_CLOSED, menuKey } from "../src/ui/actionMenu.tsx";

test("the arrow opens the menu on Enter, Space and Arrow Down with focus on the first item, Arrow Up on the last", () => {
  for (const key of ["Enter", " ", "ArrowDown"]) expect(menuKey(MENU_CLOSED, key, 3)).toEqual({ state: { open: true, index: 0 }, focus: "item", handled: true });
  expect(menuKey(MENU_CLOSED, "ArrowUp", 3)).toEqual({ state: { open: true, index: 2 }, focus: "item", handled: true });
  // Other keys pass through a closed menu untouched.
  expect(menuKey(MENU_CLOSED, "Tab", 3)).toEqual({ state: MENU_CLOSED, handled: false });
  expect(menuKey(MENU_CLOSED, "a", 3).handled).toBe(false);
});

test("arrow keys wrap, Home and End go to the ends", () => {
  const at = (index: number) => ({ open: true, index });
  expect(menuKey(at(0), "ArrowDown", 3).state).toEqual(at(1));
  expect(menuKey(at(2), "ArrowDown", 3).state).toEqual(at(0));
  expect(menuKey(at(0), "ArrowUp", 3).state).toEqual(at(2));
  expect(menuKey(at(2), "ArrowUp", 3).state).toEqual(at(1));
  expect(menuKey(at(2), "Home", 3)).toEqual({ state: at(0), focus: "item", handled: true });
  expect(menuKey(at(0), "End", 3)).toEqual({ state: at(2), focus: "item", handled: true });
});

test("Escape closes and returns focus to the arrow, Tab closes and moves on, Enter and Space activate", () => {
  const open = { open: true, index: 1 };
  expect(menuKey(open, "Escape", 3)).toEqual({ state: MENU_CLOSED, focus: "arrow", handled: true });
  expect(menuKey(open, "Tab", 3)).toEqual({ state: MENU_CLOSED, handled: false });
  for (const key of ["Enter", " "]) expect(menuKey(open, key, 3)).toEqual({ state: MENU_CLOSED, focus: "arrow", activate: 1, handled: true });
  expect(menuKey(open, "x", 3)).toEqual({ state: open, handled: false });
});

test("with no items there is no menu to open", () => {
  for (const key of ["Enter", " ", "ArrowDown", "ArrowUp"]) expect(menuKey(MENU_CLOSED, key, 0)).toEqual({ state: MENU_CLOSED, handled: false });
  expect(menuKey({ open: true, index: 0 }, "ArrowDown", 0)).toEqual({ state: MENU_CLOSED, handled: false });
});
