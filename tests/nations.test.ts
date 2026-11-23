import { expect, it } from "vitest";
import { nation } from "../src/lib/nations";

it("nacionalidades del proveedor: nombre en español y bandera", () => {
  expect(nation("France")).toEqual({ name: "Francia", flag: "🇫🇷" });
  expect(nation("Côte d'Ivoire")?.flag).toBe("🇨🇮");
  expect(nation("England")).toEqual({ name: "Inglaterra", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" });
  expect(nation("Kosovo")).toEqual({ name: "Kosovo", flag: "🇽🇰" });
  // Unknown: the name as published, without a flag.
  expect(nation("Atlantis")).toEqual({ name: "Atlantis", flag: null });
  expect(nation("")).toBeNull();
  expect(nation(null)).toBeNull();
});
