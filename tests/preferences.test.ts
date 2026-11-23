import { expect, it } from "vitest";
import {
  createPreferenceStore,
  PREFERENCES_KEY,
  resolveSelectedGroup,
} from "../src/lib/preferences";
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) || null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
it("recuerda grupo y competición tras recargar, separados por usuario", () => {
  const disk = storage(),
    store = createPreferenceStore(() => disk);
  store.update("alice", { groupId: "friends", competition: "CL" });
  store.update("bob", { groupId: "work" });
  const reopened = createPreferenceStore(() => disk);
  expect(reopened.get("alice")).toEqual({
    groupId: "friends",
    competition: "CL",
    liga: "",
  });
  expect(reopened.get("bob")).toEqual({ groupId: "work", competition: "PD", liga: "" });
  expect(reopened.get("charlie")).toEqual({ groupId: "", competition: "PD", liga: "" });
  expect(reopened.get("constructor")).toEqual({
    groupId: "",
    competition: "PD",
    liga: "",
  });
});
it("da prioridad al enlace válido y descarta grupos a los que ya no se pertenece", () => {
  const groups = [{ id: "friends" }, { id: "work" }];
  expect(resolveSelectedGroup(groups, null, "work")).toBe("work");
  expect(resolveSelectedGroup(groups, "friends", "work")).toBe("friends");
  expect(resolveSelectedGroup(groups, "outsider", "deleted")).toBe("friends");
  expect(resolveSelectedGroup([], null, "work")).toBe("");
});
it("mantiene la selección en memoria cuando el navegador bloquea almacenamiento", () => {
  const store = createPreferenceStore(() => {
    throw new Error("SecurityError");
  });
  expect(() =>
    store.update("alice", { groupId: "work", competition: "CL" }),
  ).not.toThrow();
  expect(store.get("alice")).toEqual({ groupId: "work", competition: "CL", liga: "" });
});
it("tolera preferencias corruptas y limita el tamaño persistido a cinco cuentas", () => {
  const disk = storage();
  disk.setItem(PREFERENCES_KEY, "{bad json");
  const store = createPreferenceStore(() => disk);
  expect(store.get("alice")).toEqual({ groupId: "", competition: "PD", liga: "" });
  for (let i = 0; i < 8; i++)
    store.update("user" + i, { groupId: "group" + i });
  const raw = disk.getItem(PREFERENCES_KEY)!;
  expect(Object.keys(JSON.parse(raw))).toHaveLength(5);
  expect(raw.length).toBeLessThan(4096);
  expect(raw).not.toContain("predictions");
});
it("notifica cambios y permite refrescar preferencias modificadas en otra pestaña", () => {
  const disk = storage(),
    store = createPreferenceStore(() => disk);
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  store.update("alice", { groupId: "friends" });
  store.update("alice", { groupId: "friends" });
  expect(changes).toBe(1);
  disk.setItem(
    PREFERENCES_KEY,
    JSON.stringify({ alice: { groupId: "work", competition: "CL" } }),
  );
  store.refresh();
  expect(store.get("alice").groupId).toBe("work");
  expect(changes).toBe(2);
  unsubscribe();
});
it("recuerda también la liga propia elegida, y volver a una oficial la olvida", () => {
  const disk = storage(),
    store = createPreferenceStore(() => disk);
  store.update("alice", { liga: "AbC123xyz" });
  expect(createPreferenceStore(() => disk).get("alice")).toMatchObject({ competition: "PD", liga: "AbC123xyz" });
  store.update("alice", { competition: "CL", liga: "" });
  expect(createPreferenceStore(() => disk).get("alice")).toMatchObject({ competition: "CL", liga: "" });
  store.update("alice", { liga: "bad/id" });
  expect(store.get("alice").liga).toBe("");
});
