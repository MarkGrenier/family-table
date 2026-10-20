import { describe, expect, it } from "vitest";
import { deriveShareKey } from "../src/auth";
import { shareKey } from "../scripts/print-share-keys.mjs";

describe("share key script", () => {
  it("prints the same keys the server accepts", async () => {
    const passcode = "print-check";
    expect(shareKey(passcode, "Mark")).toBe(await deriveShareKey(passcode, "Mark"));
    expect(shareKey(passcode, "Emma")).toBe(await deriveShareKey(passcode, "Emma"));
    expect(shareKey(passcode, "Mark")).not.toContain(passcode);
  });
});
