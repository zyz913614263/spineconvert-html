import { describe, expect, it } from "vitest";

import { fuzzyMatch, fuzzyTarget, rankFuzzy, sliceMatch } from "./fuzzy";

const match = (query: string, text: string) => fuzzyMatch(query, fuzzyTarget(text));
const score = (query: string, text: string) =>
  match(query, text)?.score ?? Number.NEGATIVE_INFINITY;

describe("fuzzyMatch", () => {
  it("matches non-contiguous characters", () => {
    expect("Adankelmo".includes("adk")).toBe(false);
    expect(match("adk", "Adankelmo")?.positions).toEqual([0, 1, 4]);
  });

  it("requires every query character, in order", () => {
    expect(match("adk", "Adenkelmo")).not.toBeNull();
    expect(match("kda", "Adankelmo")).toBeNull();
    expect(match("adkz", "Adankelmo")).toBeNull();
  });

  it("is case insensitive on the target", () => {
    expect(match("npc", "NPC_Priest")?.positions).toEqual([0, 1, 2]);
  });

  it("ranks a tight early match above a scattered one", () => {
    expect(score("adk", "Adankelmo")).toBeGreaterThan(score("adk", "Aimeeda_Skin04"));
  });

  it("rewards word starts over mid-word matches", () => {
    // Word-start positions give NPC_Snow_Knight the higher score.
    expect(score("nsk", "NPC_Snow_Knight")).toBeGreaterThan(score("nsk", "Transcendent_Skin"));
  });

  it("treats camelCase humps and digits as word starts", () => {
    expect(score("nk", "NecroKnight")).toBeGreaterThan(score("nk", "Nightshark"));
  });

  it("prefers the shorter target when matches start at the same position", () => {
    expect(score("lu", "Luna")).toBeGreaterThan(score("lu", "Luna_Ascended_Skin01"));
  });

  it("treats an empty query as a match with no positions", () => {
    expect(match("", "Anything")).toEqual({ score: 0, positions: [] });
  });
});

describe("rankFuzzy", () => {
  const items = ["Adankelmo", "Aimeeda_Skin04", "Bernhardt", "Adankelmo_Skin01"];
  const rank = (query: string) => rankFuzzy(items, query, fuzzyTarget).map((entry) => entry.item);

  it("keeps the original order and reports no match when the query is empty", () => {
    const ranked = rankFuzzy(items, "   ", fuzzyTarget);
    expect(ranked.map((entry) => entry.item)).toEqual(items);
    expect(ranked.every((entry) => entry.match === null)).toBe(true);
  });

  it("drops non-matches and orders the rest by score", () => {
    expect(rank("adk")).toEqual(["Adankelmo", "Adankelmo_Skin01", "Aimeeda_Skin04"]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(rank("zzz")).toEqual([]);
  });
});

describe("sliceMatch", () => {
  it("re-bases the positions inside a segment and drops the rest", () => {
    // Position 11 belongs to the variant in "Adankelmo Skin01".
    expect(sliceMatch([0, 1, 4, 11], 0, 9)).toEqual([0, 1, 4]);
    expect(sliceMatch([0, 1, 4, 11], 10, 16)).toEqual([1]);
  });
});
