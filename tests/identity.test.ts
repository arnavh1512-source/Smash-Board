import { describe, expect, it } from "vitest";
import { duplicatePeople, personKey } from "@/lib/identity";

/**
 * Who a name belongs to.
 *
 * SmashBoard infers a person from their name, so the inference has to be
 * boringly deterministic: the same human typed twice must collapse to one key
 * however sloppily they were typed, and two different people must never
 * collapse into one. Everything downstream leans on it — above all the order of
 * play, which owes its rest to a person rather than to an entry.
 */

describe("personKey", () => {
  it("reads the same person written several ways as one person", () => {
    const forms = [
      "Arnav Hendre",
      "  Arnav Hendre  ",
      "arnav hendre",
      "ARNAV HENDRE",
      "Arnav   Hendre",
      "Arnav\tHendre",
      "Arnav Hendre",
    ];
    expect(new Set(forms.map(personKey)).size).toBe(1);
    expect(personKey(forms[1])).toBe("arnav hendre");
  });

  it("folds the Unicode a spreadsheet or a phone keyboard slips in", () => {
    // A composed e-acute against an e with a combining accent, and a full-width
    // run pasted out of a spreadsheet. Both are the same name to a human.
    expect(personKey("André")).toBe(personKey("André"));
    expect(personKey("Ａｎｎａ")).toBe("anna");
  });

  it("keeps two different people apart", () => {
    expect(personKey("Arnav H")).not.toBe(personKey("Arnav Hendre"));
    expect(personKey("Ravi Kumar")).not.toBe(personKey("Ravi Kumaran"));
  });

  it("is idempotent, so a key fed back through itself does not drift", () => {
    const key = personKey("  Mixed   CASE name ");
    expect(personKey(key)).toBe(key);
  });
});

describe("duplicatePeople", () => {
  it("says nothing about a clean list", () => {
    expect(
      duplicatePeople([{ playerOne: "One" }, { playerOne: "Two" }, { playerOne: "Three" }]),
    ).toEqual([]);
  });

  it("catches the same person entered twice under different spellings", () => {
    const clashes = duplicatePeople([
      { playerOne: "Arnav Hendre" },
      { playerOne: "  arnav   hendre " },
      { playerOne: "Someone Else" },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].key).toBe("arnav hendre");
    expect(clashes[0].count).toBe(2);
    expect(clashes[0].spellings).toEqual(["Arnav Hendre", "arnav   hendre"]);
  });

  it("looks at both halves of a doubles pair", () => {
    const clashes = duplicatePeople([
      { playerOne: "A One", playerTwo: "B Two" },
      { playerOne: "C Three", playerTwo: "b two" },
    ]);
    expect(clashes.map((clash) => clash.key)).toEqual(["b two"]);
  });

  it("catches a partner typed in twice, which is the other way a pair goes wrong", () => {
    const clashes = duplicatePeople([{ playerOne: "Same Player", playerTwo: "same player" }]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].count).toBe(2);
  });

  it("ignores the empty second name a singles entrant carries", () => {
    expect(
      duplicatePeople([
        { playerOne: "One", playerTwo: "" },
        { playerOne: "Two", playerTwo: null },
        { playerOne: "Three", playerTwo: "   " },
      ]),
    ).toEqual([]);
  });
});
