import { describe, expect, it } from "vitest";
import { analyticsAvailable, readConsent, screen, screenName, track } from "../src/lib/analytics";

describe("estadísticas de uso", () => {
  it("cuenta pantallas, no partidos ni competiciones concretas", () => {
    expect(screenName("/")).toBe("/");
    expect(screenName("/quiniela")).toBe("/quiniela");
    expect(screenName("/partido/PD-2026-123")).toBe("/partido/:id");
    expect(screenName("/competicion/ABC123/partido/m9")).toBe("/competicion/:id/partido/:id");
    expect(screenName("/competicion/ABC123")).toBe("/competicion/:id");
  });

  it("sin identificador ni permiso no se carga nada ni se envía nada", async () => {
    expect(analyticsAvailable).toBe(false);
    expect(readConsent()).toBeNull();
    expect(() => {
      screen("/quiniela");
      track("sellar_quiniela", { competicion: "PD" });
    }).not.toThrow();
  });
});
