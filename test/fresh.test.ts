import { describe, expect, it } from "vitest";
import { freshTiming } from "../src/fresh";

describe("fresh due dates", () => {
  it("is due the day before, including across a week boundary", () => {
    expect(freshTiming(true, [{ date: "2026-10-26", recipeName: "Sheet-pan salmon" }])).toEqual({
      dueDate: "2026-10-25",
      dinnerDate: "2026-10-26",
      recipeName: "Sheet-pan salmon",
    });
    expect(freshTiming(true, [{ date: "2026-11-01", recipeName: "Shrimp tacos" }])).toEqual({
      dueDate: "2026-10-31",
      dinnerDate: "2026-11-01",
      recipeName: "Shrimp tacos",
    });
  });

  it("uses the earliest meal, and skips a line that is not fresh or has no date", () => {
    expect(
      freshTiming(true, [
        { date: "2026-11-01", recipeName: "Shrimp tacos" },
        { date: "2026-10-26", recipeName: "Sheet-pan salmon" },
      ]),
    ).toEqual({
      dueDate: "2026-10-25",
      dinnerDate: "2026-10-26",
      recipeName: "Sheet-pan salmon",
    });
    expect(freshTiming(false, [{ date: "2026-10-26", recipeName: "Sheet-pan salmon" }])).toEqual({
      dueDate: null,
      dinnerDate: null,
      recipeName: null,
    });
    expect(freshTiming(true, [])).toEqual({ dueDate: null, dinnerDate: null, recipeName: null });
  });

  it("includes a due date on that day and leaves a later one out", () => {
    const monday = freshTiming(true, [{ date: "2026-10-26", recipeName: "Sheet-pan salmon" }]);
    const sunday = freshTiming(true, [{ date: "2026-11-01", recipeName: "Shrimp tacos" }]);
    const due = (day: string) =>
      [monday, sunday].filter((item) => item.dueDate && item.dueDate <= day).map((item) => item.recipeName);
    expect(due("2026-10-24")).toEqual([]);
    expect(due("2026-10-25")).toEqual(["Sheet-pan salmon"]);
    expect(due("2026-10-31")).toEqual(["Sheet-pan salmon", "Shrimp tacos"]);
  });
});
