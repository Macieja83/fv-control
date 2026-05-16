import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_LIMIT_MESSAGE_MARKER,
  isFreePlanLimitMessage,
  stripFreePlanLimitErrors,
} from "./subscription-plans.js";

const LIMIT = `retry 7740001454-X: ${FREE_PLAN_LIMIT_MESSAGE_MARKER} (15 dokumentow). Wykup PRO.`;
const OTHER = "retry 9990001111-Y: KSeF 9105 Nieprawidlowy podpis.";

describe("isFreePlanLimitMessage", () => {
  it("wykrywa komunikat limitu Free", () => {
    expect(isFreePlanLimitMessage(LIMIT)).toBe(true);
  });
  it("inny blad / null / undefined => false", () => {
    expect(isFreePlanLimitMessage(OTHER)).toBe(false);
    expect(isFreePlanLimitMessage(null)).toBe(false);
    expect(isFreePlanLimitMessage(undefined)).toBe(false);
  });
});

describe("stripFreePlanLimitErrors", () => {
  it("wszystkie segmenty to limit Free => null", () => {
    expect(stripFreePlanLimitErrors([LIMIT, LIMIT].join(" | "))).toBeNull();
  });
  it("miks => zostaje tylko nie-limitowy segment", () => {
    expect(stripFreePlanLimitErrors([LIMIT, OTHER].join(" | "))).toBe(OTHER);
  });
  it("brak limitu => bez zmian", () => {
    expect(stripFreePlanLimitErrors(OTHER)).toBe(OTHER);
  });
  it("null / empty => null", () => {
    expect(stripFreePlanLimitErrors(null)).toBeNull();
    expect(stripFreePlanLimitErrors("")).toBeNull();
  });
});
