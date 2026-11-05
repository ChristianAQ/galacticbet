import {
  createPrivateGroup,
  prepareGroupCompetitions,
  gameSeasonId,
} from "../src/lib/groupSetup";
import { sealRound } from "../src/lib/roundSubmission";
import { decodeDelivery } from "../src/lib/roundDelivery";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  documentId,
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
describe.skipIf(!enabled)("Firestore: permisos reales del backend", () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "demo-galacticbet",
      firestore: {
        rules: readFileSync("firestore.rules", "utf8"),
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });
  it("permite consultar el directorio público sin permitir listas ni escrituras", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "teamDirectory/featured")));
    await assertFails(getDocs(collection(db, "teamDirectory")));
    await assertFails(setDoc(doc(db, "teamDirectory/featured"), { teams: [] }));
    await assertFails(setDoc(doc(env.authenticatedContext("alice").firestore(), "teamDirectory/featured"), { teams: [] }));
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, "groups/g"), {
        name: "Amigos",
        ownerId: "alice",
        memberIds: ["alice", "bob"],
      });
      await setDoc(doc(db, "groups/g/gameSeasons/PD-2026"), {
        competition: "PD",
        seasonId: "PD-2026",
        mode: "classic",
      });
      for (const rid of ["r", "r2"])
        await setDoc(doc(db, `rounds/${rid}`), {
          seasonId: "PD-2026",
          requiredMatchIds: ["future"],
          submissionDeadline: Timestamp.fromMillis(Date.now() + 3600000),
        });
      for (const [id, offset] of [
        ["future", 3600000],
        ["future2", 7200000],
        ["closed", -3600000],
      ] as const)
        await setDoc(doc(db, `matches/${id}`), {
          competition: "PD",
          seasonId: "PD-2026",
          roundId: "r",
          kickoffAt: Timestamp.fromMillis(Date.now() + offset),
          status: "TIMED",
        });
      for (const matchId of ["future", "closed"])
        await setDoc(
          doc(db, `groups/g/gameSeasons/PD-2026/predictions/bob_${matchId}`),
          {
            userId: "bob",
            matchId,
            roundId: "r",
            value: "X",
            updatedAt: Timestamp.now(),
          },
        );
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  const prediction = (id: string, uid = "alice") => ({
    userId: uid,
    matchId: id,
    roundId: "r",
    value: "1",
    updatedAt: serverTimestamp(),
  });
  const deliver = (
    db: ReturnType<RulesTestContext["firestore"]>,
    uid: string,
    picks: Record<string, unknown>,
    rid = "r",
    sid = "PD-2026",
    encoded?: { mode: string; selections: string },
  ) => {
    const batch = writeBatch(db);
    const base = `groups/g/gameSeasons/${sid}`;
    batch.set(doc(db, `${base}/submissions/${uid}/rounds/${rid}`), {
      userId: uid,
      roundId: rid,
      formatVersion: 2,
      submittedAt: serverTimestamp(),
    });
    batch.set(doc(db, `${base}/roundEntries/${rid}/players/${uid}`), {
      userId: uid,
      roundId: rid,
      formatVersion: 2,
      submittedAt: serverTimestamp(),
      mode: "classic",
      matchIds: Object.keys(picks),
      selections: Object.values(picks)
        .map((v) => (typeof v === "string" ? v : "invalid"))
        .join(""),
      ...encoded,
    });
    batch.set(
      doc(db, `${base}/roundAttendance/${rid}`),
      { members: { [uid]: serverTimestamp() } },
      { merge: true },
    );
    return batch.commit();
  };
  it("permite guardar antes del inicio", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
        prediction("future"),
      ),
    );
  });
  it("permite nuevas temporadas Premier pero impide reactivar Copa desde el cliente", async () => {
    const db = env.authenticatedContext("alice").firestore();
    const value = (competition: string) => ({
      competition,
      seasonId: `${competition}-2026`,
      mode: "classic",
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(
      setDoc(doc(db, "groups/g/gameSeasons/PL-2026"), value("PL")),
    );
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/CDR-2026"), value("CDR")),
    );
  });
  it("publica solo la edición de noticias y prohíbe listar o modificar titulares", async () => {
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), "news/football"), { provider: "ESPN" }),
    );
    for (const db of [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext("alice").firestore(),
    ]) {
      await assertSucceeds(getDoc(doc(db, "news/football")));
      await assertFails(getDoc(doc(db, "news/private")));
      await assertFails(getDocs(collection(db, "news")));
      await assertFails(setDoc(doc(db, "news/football"), { provider: "fake" }));
      await assertFails(deleteDoc(doc(db, "news/football")));
    }
  });
  it("permite abrir detalles públicos, pero impide listados y cualquier escritura cliente", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "matchInsights/future"), {
        insight: { provider: "ESPN" },
      });
    });
    const guest = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(guest, "matchInsights/future")));
    await assertFails(getDocs(collection(guest, "matchInsights")));
    for (const db of [guest, env.authenticatedContext("alice").firestore()]) {
      await assertFails(
        setDoc(doc(db, "matchInsights/new"), { insight: null }),
      );
      await assertFails(
        updateDoc(doc(db, "matchInsights/future"), { insight: null }),
      );
      await assertFails(deleteDoc(doc(db, "matchInsights/future")));
    }
  });
  it("publica el marcador en directo solo para lectura y oculta el estado interno", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "live/football"), {
        formatVersion: 1,
        updatedAt: 1,
        matches: [],
      });
      await setDoc(doc(c.firestore(), "syncStatus/football"), {
        fullSyncAt: 1,
      });
    });
    for (const db of [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext("alice").firestore(),
    ]) {
      await assertSucceeds(getDoc(doc(db, "live/football")));
      await assertFails(getDoc(doc(db, "live/other")));
      await assertFails(getDocs(collection(db, "live")));
      await assertFails(getDoc(doc(db, "syncStatus/football")));
      await assertFails(
        setDoc(doc(db, "live/football"), { formatVersion: 1, matches: [] }),
      );
      await assertFails(deleteDoc(doc(db, "live/football")));
    }
  });
  it("permite leer calendarios agregados públicos pero nunca escribir resultados desde el cliente", async () => {
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), "calendars/PD-2026"), {
        formatVersion: 1,
        seasonId: "PD-2026",
        payload: "[]",
      }),
    );
    const anonymous = env.unauthenticatedContext().firestore();
    expect(
      (await assertSucceeds(getDocs(collection(anonymous, "calendars")))).size,
    ).toBe(1);
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(
      updateDoc(doc(db, "calendars/PD-2026"), { payload: "fake" }),
    );
    await assertFails(
      setDoc(doc(db, "calendars/CL-2026"), { payload: "fake" }),
    );
    await assertFails(
      updateDoc(doc(db, "matches/future"), { status: "FINISHED" }),
    );
  });
  it("permite consultar solo los pronósticos propios de la jornada sin revelar los ajenos", async () => {
    const db = env.authenticatedContext("bob").firestore();
    const ref = collection(db, "groups/g/gameSeasons/PD-2026/predictions");
    const own = await assertSucceeds(
      getDocs(
        query(ref, where("userId", "==", "bob"), where("roundId", "==", "r")),
      ),
    );
    expect(own.size).toBe(2);
    await assertFails(
      getDocs(
        query(ref, where("userId", "==", "alice"), where("roundId", "==", "r")),
      ),
    );
  });
  it("rechaza crear o editar después del inicio", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_closed"),
        prediction("closed"),
      ),
    );
    const bob = env.authenticatedContext("bob").firestore();
    await assertFails(
      setDoc(
        doc(bob, "groups/g/gameSeasons/PD-2026/predictions/bob_closed"),
        prediction("closed", "bob"),
      ),
    );
  });
  it("los borradores ajenos permanecen privados incluso tras el inicio", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(
      getDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/bob_future")),
    );
    await assertFails(
      getDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/bob_closed")),
    );
    const ref = collection(db, "groups/g/gameSeasons/PD-2026/predictions");
    await assertFails(getDocs(query(ref, where("matchId", "==", "closed"))));
    await assertFails(getDocs(query(ref, where("matchId", "==", "future"))));
  });
  it("permite consultar los propios, impide listar todos los abiertos", async () => {
    const db = env.authenticatedContext("bob").firestore();
    const ref = collection(db, "groups/g/gameSeasons/PD-2026/predictions");
    await assertSucceeds(getDocs(query(ref, where("userId", "==", "bob"))));
    await assertFails(getDocs(ref));
  });
  it("impide suplantación, puntos enviados y autoasignación de admin", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(updateDoc(doc(db, "groups/g"), { ownerId: "bob" }));
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/standings/bob"), {
        points: 999,
      }),
    );
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
        prediction("future"),
      ),
    );
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/bob_future"), {
        ...prediction("future", "bob"),
        points: 3,
      }),
    );
  });
  it("fija modalidad incluso para el administrador", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(
      updateDoc(doc(db, "groups/g/gameSeasons/PD-2026"), { mode: "exact" }),
    );
  });
  it("impide lecturas de no miembros", async () => {
    const db = env.authenticatedContext("outsider").firestore();
    await assertFails(
      getDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/bob_closed")),
    );
    await assertFails(
      getDocs(collection(db, "groups/g/gameSeasons/PD-2026/standings")),
    );
  });
  it("crea un grupo con membresía y ambas competiciones en el mismo lote", async () => {
    const db = env.authenticatedContext("charlie").firestore();
    const id = await createPrivateGroup(
      doc(db, "groups/g").firestore,
      "charlie",
      "  Grupo nuevo  ",
      "exact",
    );
    expect((await getDoc(doc(db, `groups/${id}`))).data()?.name).toBe(
      "Grupo nuevo",
    );
    expect(
      (await getDoc(doc(db, `groups/${id}/members/charlie`))).exists(),
    ).toBe(true);
    for (const competition of ["PD", "CL", "PL"]) {
      const season = await getDoc(
        doc(db, `groups/${id}/gameSeasons/${gameSeasonId(competition)}`),
      );
      expect(season.data()).toMatchObject({
        competition,
        seasonId: gameSeasonId(competition),
        mode: "exact",
      });
    }
  });
  it("prepara grupos antiguos de forma idempotente sin modificar modalidades fijadas", async () => {
    const sid = gameSeasonId("PD");
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), `groups/g/gameSeasons/${sid}`), {
        competition: "PD",
        seasonId: sid,
        mode: "exact",
      }),
    );
    const db = env.authenticatedContext("alice").firestore();
    const store = doc(db, "groups/g").firestore;
    await prepareGroupCompetitions(store, "alice", "g");
    for (const competition of ["PL"]) {
      expect(
        (
          await getDoc(
            doc(db, `groups/g/gameSeasons/${gameSeasonId(competition)}`),
          )
        ).data(),
      ).toMatchObject({ competition, mode: "exact" });
    }
    const path = `groups/g/gameSeasons/${gameSeasonId("CL")}`;
    const first = (await getDoc(doc(db, path))).data();
    expect(first?.mode).toBe("exact");
    await prepareGroupCompetitions(store, "alice", "g");
    expect((await getDoc(doc(db, path))).data()).toEqual(first);
    expect(
      (await getDoc(doc(db, `groups/g/gameSeasons/${sid}`))).data()?.mode,
    ).toBe("exact");
  });
  it("conserva modalidades distintas ya existentes y no permite preparar grupos ajenos", async () => {
    const pd = gameSeasonId("PD"),
      cl = gameSeasonId("CL");
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `groups/g/gameSeasons/${pd}`), {
        competition: "PD",
        seasonId: pd,
        mode: "classic",
      });
      await setDoc(doc(c.firestore(), `groups/g/gameSeasons/${cl}`), {
        competition: "CL",
        seasonId: cl,
        mode: "exact",
      });
    });
    const db = env.authenticatedContext("alice").firestore();
    await prepareGroupCompetitions(doc(db, "groups/g").firestore, "alice", "g");
    expect(
      (await getDoc(doc(db, `groups/g/gameSeasons/${pd}`))).data()?.mode,
    ).toBe("classic");
    expect(
      (await getDoc(doc(db, `groups/g/gameSeasons/${cl}`))).data()?.mode,
    ).toBe("exact");
    const bob = env.authenticatedContext("bob").firestore();
    await expect(
      prepareGroupCompetitions(doc(bob, "groups/g").firestore, "bob", "g"),
    ).rejects.toThrow("Solo el administrador");
    await assertFails(
      setDoc(doc(bob, "groups/g/gameSeasons/CL-2099"), {
        competition: "CL",
        seasonId: "CL-2099",
        mode: "exact",
        createdAt: serverTimestamp(),
      }),
    );
  });
  it("permite guardar el nombre propio pero nunca editar el perfil de otro usuario", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "users/alice"), {
        name: "Ana",
        avatar: null,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, "users/bob"), {
        name: "Nombre suplantado",
        avatar: null,
        updatedAt: serverTimestamp(),
      }),
    );
  });
  it("solo permite añadirse a sí mismo sin promover a nadie", async () => {
    const db = env.authenticatedContext("charlie").firestore();
    await assertFails(
      updateDoc(doc(db, "groups/g"), {
        memberIds: ["alice", "bob", "charlie", "eve"],
      }),
    );
    await assertFails(
      updateDoc(doc(db, "groups/g"), {
        memberIds: ["alice", "bob", "charlie"],
      }),
    );
    const batch = writeBatch(db);
    batch.update(doc(db, "groups/g"), {
      memberIds: ["alice", "bob", "charlie"],
    });
    batch.set(doc(db, "groups/g/members/charlie"), {
      userId: "charlie",
      joinedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it("confirma exactamente las elecciones revisadas y bloquea todo el resto de la jornada", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await setDoc(
      doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
      prediction("future"),
    );
    await sealRound(
      doc(db, "groups/g").firestore,
      "alice",
      "g",
      "PD-2026",
      "r",
      { future: "1" },
    );
    const ref = doc(
      db,
      "groups/g/gameSeasons/PD-2026/submissions/alice/rounds/r",
    );
    expect((await getDoc(ref)).exists()).toBe(true);
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"), {
        ...prediction("future"),
        value: "X",
      }),
    );
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future2"),
        prediction("future2"),
      ),
    );
    // Other players remain free to complete their own round.
    const bob = env.authenticatedContext("bob").firestore();
    await assertSucceeds(
      setDoc(
        doc(bob, "groups/g/gameSeasons/PD-2026/predictions/bob_future2"),
        prediction("future2", "bob"),
      ),
    );
  });
  it("rechaza confirmar un resumen antiguo tras un cambio desde otro dispositivo", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await setDoc(
      doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
      { ...prediction("future"), value: "X" },
    );
    await expect(
      sealRound(doc(db, "groups/g").firestore, "alice", "g", "PD-2026", "r", {
        future: "1",
      }),
    ).rejects.toThrow("otro dispositivo");
    expect(
      (
        await getDoc(
          doc(db, "groups/g/gameSeasons/PD-2026/submissions/alice/rounds/r"),
        )
      ).exists(),
    ).toBe(false);
  });
  it("un cierre no puede borrarse ni modificarse, tampoco por el administrador", async () => {
    const db = env.authenticatedContext("bob").firestore();
    const path = "groups/g/gameSeasons/PD-2026/submissions/bob/rounds/r";
    await sealRound(doc(db, "groups/g").firestore, "bob", "g", "PD-2026", "r", {
      future: "X",
    });
    await assertFails(deleteDoc(doc(db, path)));
    await assertFails(
      updateDoc(doc(db, path), { submittedAt: serverTimestamp() }),
    );
    const owner = env.authenticatedContext("alice").firestore();
    await assertFails(deleteDoc(doc(owner, path)));
  });
  it("impide cerrar por otro usuario, falsificar la fecha o usar una ronda de otra temporada", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/submissions/alice/rounds/r"),
        { userId: "alice", roundId: "r", submittedAt: serverTimestamp() },
      ),
    );
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/submissions/bob/rounds/r"), {
        userId: "bob",
        roundId: "r",
        submittedAt: Timestamp.fromMillis(1),
      }),
    );
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), "rounds/other"), { seasonId: "CL-2026" }),
    );
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/submissions/bob/rounds/other"),
        { userId: "bob", roundId: "other", submittedAt: serverTimestamp() },
      ),
    );
  });
  it("solo los miembros con entrega completa ven las entradas compartidas antes y después del inicio", async () => {
    const bob = env.authenticatedContext("bob").firestore();
    await sealRound(
      doc(bob, "groups/g").firestore,
      "bob",
      "g",
      "PD-2026",
      "r",
      { future: "X" },
    );
    const alice = env.authenticatedContext("alice").firestore();
    const peer = doc(
      alice,
      "groups/g/gameSeasons/PD-2026/roundEntries/r/players/bob",
    );
    await assertFails(getDoc(peer));
    await assertFails(
      getDoc(doc(alice, "groups/g/gameSeasons/PD-2026/predictions/bob_closed")),
    );
    await setDoc(
      doc(alice, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
      prediction("future"),
    );
    await sealRound(
      doc(alice, "groups/g").firestore,
      "alice",
      "g",
      "PD-2026",
      "r",
      { future: "1" },
    );
    expect(
      decodeDelivery((await assertSucceeds(getDoc(peer))).data()!),
    ).toEqual({
      future: "X",
    });
    const shared = collection(
      alice,
      "groups/g/gameSeasons/PD-2026/roundEntries/r/players",
    );
    expect(
      (
        await assertSucceeds(
          getDocs(query(shared, where(documentId(), "in", ["alice", "bob"]))),
        )
      ).size,
    ).toBe(2);
    await assertFails(
      getDoc(doc(alice, "groups/g/gameSeasons/PD-2026/predictions/bob_future")),
    );
    const outsider = env.authenticatedContext("outsider").firestore();
    await assertFails(
      getDoc(
        doc(
          outsider,
          "groups/g/gameSeasons/PD-2026/roundEntries/r/players/bob",
        ),
      ),
    );
  });
  it("no permite esquivar el cierre moviendo un pronóstico a otra ronda", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await sealRound(doc(db, "groups/g").firestore, "bob", "g", "PD-2026", "r", {
      future: "X",
    });
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "matches/future"), { roundId: "r2" }),
    );
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/bob_future"), {
        ...prediction("future", "bob"),
        roundId: "r2",
      }),
    );
  });

  it("confirma y bloquea también los marcadores exactos", async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "groups/g/gameSeasons/PD-2026"), {
        mode: "exact",
      }),
    );
    const db = env.authenticatedContext("alice").firestore();
    await setDoc(
      doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"),
      { ...prediction("future"), value: { home: 2, away: 1 } },
    );
    await sealRound(
      doc(db, "groups/g").firestore,
      "alice",
      "g",
      "PD-2026",
      "r",
      { future: { away: 1, home: 2 } },
    );
    await assertFails(
      setDoc(doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future"), {
        ...prediction("future"),
        value: { home: 2, away: 2 },
      }),
    );
  });
  it("exige todos los partidos y valores válidos aunque se escriba directamente desde el navegador", async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "rounds/r"), {
        requiredMatchIds: ["future", "future2"],
      }),
    );
    const db = env.authenticatedContext("alice").firestore();
    for (const picks of [
      { future: "1" },
      { future: "1", future2: "bad" },
      { future: "1", future2: "X", invented: "1" },
      { future: { home: 2, away: 1 }, future2: "X" },
    ])
      await assertFails(deliver(db, "alice", picks));
    await assertSucceeds(deliver(db, "alice", { future: "1", future2: "X" }));
    expect(
      (
        await getDoc(doc(db, "groups/g/gameSeasons/PD-2026/roundAttendance/r"))
      ).data()?.members.alice,
    ).toBeTruthy();
  });
  it("el plazo del primer partido cierra también partidos posteriores y usa el reloj del servidor", async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "rounds/r"), {
        submissionDeadline: Timestamp.fromMillis(1),
      }),
    );
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g/gameSeasons/PD-2026/predictions/alice_future2"),
        prediction("future2"),
      ),
    );
    await assertFails(deliver(db, "alice", { future: "1" }));
  });
  it("no permite fingir entregas, modificar las de otro ni reabrir una entrada completa", async () => {
    const bob = env.authenticatedContext("bob").firestore();
    const base = "groups/g/gameSeasons/PD-2026";
    await assertFails(
      setDoc(doc(bob, `${base}/roundAttendance/r`), {
        members: { bob: serverTimestamp() },
      }),
    );
    await assertFails(
      setDoc(doc(bob, `${base}/submissions/bob/rounds/r`), {
        userId: "bob",
        roundId: "r",
        submittedAt: serverTimestamp(),
        formatVersion: 2,
      }),
    );
    await deliver(bob, "bob", { future: "X" });
    const alice = env.authenticatedContext("alice").firestore();
    const status = await assertSucceeds(
      getDoc(doc(alice, `${base}/roundAttendance/r`)),
    );
    expect(Object.keys(status.data()!)).toEqual(["members"]);
    await assertFails(
      updateDoc(doc(alice, `${base}/roundAttendance/r`), {
        "members.bob": Timestamp.fromMillis(1),
      }),
    );
    await assertFails(
      updateDoc(doc(bob, `${base}/roundEntries/r/players/bob`), {
        picks: { future: "2" },
      }),
    );
    await assertFails(
      deleteDoc(doc(alice, `${base}/roundEntries/r/players/bob`)),
    );
  });
  it("dejar un grupo revoca las lecturas y no expone las entradas de antiguos participantes", async () => {
    const alice = env.authenticatedContext("alice").firestore(),
      bob = env.authenticatedContext("bob").firestore();
    await deliver(alice, "alice", { future: "1" });
    await deliver(bob, "bob", { future: "X" });
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "groups/g"), { memberIds: ["alice"] }),
    );
    await assertFails(
      getDoc(
        doc(bob, "groups/g/gameSeasons/PD-2026/roundEntries/r/players/alice"),
      ),
    );
    await assertFails(
      getDoc(
        doc(alice, "groups/g/gameSeasons/PD-2026/roundEntries/r/players/bob"),
      ),
    );
  });
  it("completa 64 marcadores exactos dentro de los límites de acceso y evaluación de reglas", async () => {
    const ids = Array.from({ length: 64 }, (_, i) => `match${i}`);
    const picks = Object.fromEntries(
      ids.map((id) => [id, { home: 99, away: 0 }]),
    );
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await updateDoc(doc(db, "groups/g/gameSeasons/PD-2026"), {
        mode: "exact",
      });
      await updateDoc(doc(db, "rounds/r"), { requiredMatchIds: ids });
      for (const id of ids)
        await setDoc(
          doc(db, `groups/g/gameSeasons/PD-2026/predictions/alice_${id}`),
          { userId: "alice", matchId: id, roundId: "r", value: picks[id] },
        );
    });
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      sealRound(
        doc(db, "groups/g").firestore,
        "alice",
        "g",
        "PD-2026",
        "r",
        picks,
      ),
    );
  });
  it("valida los marcadores exactos codificados en el servidor sin confiar en el cliente", async () => {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "groups/g/gameSeasons/PD-2026"), {
        mode: "exact",
      }),
    );
    const db = env.authenticatedContext("alice").firestore();
    for (const selections of [
      "-1:0",
      "100:0",
      "1:100",
      "1.5:0",
      "1:0,2:1",
      "1:",
    ])
      await assertFails(
        deliver(db, "alice", { future: "1" }, "r", "PD-2026", {
          mode: "exact",
          selections,
        }),
      );
    await assertSucceeds(
      deliver(db, "alice", { future: "1" }, "r", "PD-2026", {
        mode: "exact",
        selections: "99:99",
      }),
    );
  });
});
