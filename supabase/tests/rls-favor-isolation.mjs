#!/usr/bin/env node
/**
 * Prueba de aislamiento RLS — favor_settings / favor_entries
 *
 * Usa solo clave anon/publishable + JWT de dos usuarios (sin service_role).
 * No modifica app.html. Credenciales de usuario solo por variables de entorno.
 *
 * Uso: ver supabase/tests/README-rls-favor-isolation.md
 */

import { createClient } from "@supabase/supabase-js";

const RUN_ID = `RLS_TEST_${Date.now()}`;
const MARKER = RUN_ID;
const MARKER_SPOOF = `${MARKER}_SPOOF`;

const url =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const emailA = process.env.RLS_TEST_USER_A_EMAIL;
const passA = process.env.RLS_TEST_USER_A_PASSWORD;
const emailB = process.env.RLS_TEST_USER_B_EMAIL;
const passB = process.env.RLS_TEST_USER_B_PASSWORD;

const results = [];
let failed = 0;

function requireEnv() {
  const missing = [];
  if (!url) missing.push("SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!emailA) missing.push("RLS_TEST_USER_A_EMAIL");
  if (!passA) missing.push("RLS_TEST_USER_A_PASSWORD");
  if (!emailB) missing.push("RLS_TEST_USER_B_EMAIL");
  if (!passB) missing.push("RLS_TEST_USER_B_PASSWORD");
  if (missing.length) {
    console.error("Faltan variables de entorno:\n  - " + missing.join("\n  - "));
    process.exit(2);
  }
}

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  OK  ${name}`);
}

function fail(name, detail) {
  failed++;
  results.push({ name, ok: false, detail });
  console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

function expectError(name, error) {
  if (error) pass(name);
  else fail(name, "se esperaba error RLS y la operación tuvo éxito");
}

function expectNoRows(name, data, error) {
  if (error) {
    fail(name, error.message);
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) pass(name);
  else fail(name, `devolvió ${rows.length} fila(s)`);
}

async function signIn(label, email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login falló (${label}): ${error.message}`);
  if (!data.user?.id) throw new Error(`Sin user.id tras login (${label})`);
  return { client, userId: data.user.id };
}

async function main() {
  requireEnv();
  console.log(`\n=== Prueba RLS Cupo de favores [${RUN_ID}] ===\n`);

  const cleanup = {
    userIdA: null,
    userIdB: null,
    entryIdsA: [],
    entryIdsB: [],
    createdSettingsA: false,
    createdSettingsB: false,
    quotaBackupA: null,
    quotaBackupB: null,
    quotaModifiedA: false,
    quotaModifiedB: false,
  };

  let clientA;
  let clientB;
  let userIdA;
  let userIdB;

  try {
    ({ client: clientA, userId: userIdA } = await signIn("usuario A", emailA, passA));
    ({ client: clientB, userId: userIdB } = await signIn("usuario B", emailB, passB));
    cleanup.userIdA = userIdA;
    cleanup.userIdB = userIdB;

    if (userIdA === userIdB) {
      throw new Error("A y B resolvieron al mismo user_id; usar dos cuentas distintas.");
    }

    console.log("Sesiones autenticadas (sin imprimir ids, tokens ni claves).\n");

    // ─── favor_entries — Usuario A ───────────────────────────────────────────
    console.log("favor_entries — sesión A");

    {
      const { data, error } = await clientA
        .from("favor_entries")
        .insert({
          user_id: userIdA,
          study_date: new Date().toISOString().slice(0, 10),
          modality: "TC",
          patient_ref: MARKER,
          requester: "RLS probe A",
          note: "temporal",
        })
        .select("id")
        .single();
      if (error) fail("A INSERT entry propio", error.message);
      else {
        cleanup.entryIdsA.push(data.id);
        pass("A INSERT entry propio");
      }
    }

    {
      const { data, error } = await clientA
        .from("favor_entries")
        .insert({
          user_id: userIdB,
          study_date: new Date().toISOString().slice(0, 10),
          modality: "TC",
          patient_ref: MARKER_SPOOF,
          requester: "RLS probe spoof",
        })
        .select("id");
      expectError("A INSERT entry con user_id de B (debe fallar)", error);
      if (!error && data?.[0]?.id) {
        fail("A INSERT entry con user_id de B", "RLS abierto: fila insertada (se intentará limpiar)");
        cleanup.entryIdsB.push(data[0].id);
      }
    }

    {
      const { data, error } = await clientA
        .from("favor_entries")
        .select("id")
        .eq("user_id", userIdB);
      expectNoRows("A SELECT entries filtrando user_id de B", data, error);
    }

    if (cleanup.entryIdsA[0]) {
      const { error } = await clientA
        .from("favor_entries")
        .update({ note: "RLS update ok" })
        .eq("id", cleanup.entryIdsA[0])
        .eq("patient_ref", MARKER);
      if (error) fail("A UPDATE entry propio", error.message);
      else pass("A UPDATE entry propio");
    }

    // ─── favor_entries — Usuario B (fila para pruebas cruzadas) ───────────────
    console.log("\nfavor_entries — sesión B");

    {
      const { data, error } = await clientB
        .from("favor_entries")
        .insert({
          user_id: userIdB,
          study_date: new Date().toISOString().slice(0, 10),
          modality: "RM",
          patient_ref: MARKER,
          requester: "RLS probe B",
        })
        .select("id")
        .single();
      if (error) fail("B INSERT entry propio", error.message);
      else {
        cleanup.entryIdsB.push(data.id);
        pass("B INSERT entry propio");
      }
    }

    const bEntryIdForCross = cleanup.entryIdsB.filter((id) => id).slice(-1)[0];
    if (bEntryIdForCross) {
      const { data, error } = await clientA
        .from("favor_entries")
        .update({ note: "hack" })
        .eq("id", bEntryIdForCross)
        .select("id");
      if (error) pass("A UPDATE entry de B por id (error o 0 filas)");
      else if (!data?.length) pass("A UPDATE entry de B por id (0 filas)");
      else fail("A UPDATE entry de B por id", "actualizó fila ajena");

      const { data: delData, error: delErr } = await clientA
        .from("favor_entries")
        .delete()
        .eq("id", bEntryIdForCross)
        .select("id");
      if (delErr) pass("A DELETE entry de B (error o 0 filas)");
      else if (!delData?.length) pass("A DELETE entry de B (0 filas)");
      else fail("A DELETE entry de B", "borró fila ajena");
    }

    {
      const { data, error } = await clientA.from("favor_entries").select("id, patient_ref");
      if (error) fail("A SELECT all entries (RLS)", error.message);
      else {
        const foreign = (data || []).filter(
          (r) => (r.patient_ref === MARKER || r.patient_ref === MARKER_SPOOF) && !cleanup.entryIdsA.includes(r.id)
        );
        if (foreign.length === 0) pass("A SELECT all entries no incluye entries marcador de B");
        else fail("A SELECT all entries no incluye entries marcador de B", `filas ajenas: ${foreign.length}`);
      }
    }

    // ─── favor_settings — Usuario A ──────────────────────────────────────────
    console.log("\nfavor_settings — sesión A");

    {
      const { data: existing, error: selErr } = await clientA
        .from("favor_settings")
        .select("weekly_quota")
        .eq("user_id", userIdA)
        .maybeSingle();

      if (selErr) fail("A SELECT settings propio", selErr.message);
      else if (existing) {
        pass("A SELECT settings propio (preexistente; sin UPDATE para no alterar cupo)");
      } else {
        const { error } = await clientA.from("favor_settings").insert({
          user_id: userIdA,
          weekly_quota: 4,
        });
        if (error) fail("A INSERT settings propio", error.message);
        else {
          cleanup.createdSettingsA = true;
          pass("A INSERT settings propio");
          const { error: updErr } = await clientA
            .from("favor_settings")
            .update({ weekly_quota: 5 })
            .eq("user_id", userIdA);
          if (updErr) fail("A UPDATE settings propio (fila creada en prueba)", updErr.message);
          else pass("A UPDATE settings propio (fila creada en prueba)");
        }
      }
    }

    {
      const { error } = await clientA.from("favor_settings").insert({
        user_id: userIdB,
        weekly_quota: 4,
      });
      expectError("A INSERT settings con user_id de B (debe fallar)", error);
    }

    {
      const { data, error } = await clientA
        .from("favor_settings")
        .select("user_id")
        .eq("user_id", userIdB);
      expectNoRows("A SELECT settings de B", data, error);
    }

    {
      const { data, error } = await clientA
        .from("favor_settings")
        .update({ weekly_quota: 1 })
        .eq("user_id", userIdB)
        .select("user_id");
      if (error) pass("A UPDATE settings de B (error o 0 filas)");
      else if (!data?.length) pass("A UPDATE settings de B (0 filas)");
      else fail("A UPDATE settings de B", "modificó fila ajena");
    }

    {
      const { data, error } = await clientA
        .from("favor_settings")
        .delete()
        .eq("user_id", userIdB)
        .select("user_id");
      if (error) pass("A DELETE settings de B (error o 0 filas)");
      else if (!data?.length) pass("A DELETE settings de B (0 filas)");
      else fail("A DELETE settings de B", "borró fila ajena");
    }

    // ─── favor_settings — Usuario B (simétrico mínimo) ───────────────────────
    console.log("\nfavor_settings — sesión B");

    {
      const { data: existing, error: selErr } = await clientB
        .from("favor_settings")
        .select("weekly_quota")
        .eq("user_id", userIdB)
        .maybeSingle();

      if (selErr) fail("B SELECT settings propio", selErr.message);
      else if (existing) {
        pass("B SELECT settings propio (preexistente; sin UPDATE para no alterar cupo)");
      } else {
        const { error } = await clientB.from("favor_settings").insert({
          user_id: userIdB,
          weekly_quota: 4,
        });
        if (error) fail("B INSERT settings propio", error.message);
        else {
          cleanup.createdSettingsB = true;
          pass("B INSERT settings propio");
        }
      }
    }

    {
      const { error } = await clientB.from("favor_settings").insert({
        user_id: userIdA,
        weekly_quota: 4,
      });
      expectError("B INSERT settings con user_id de A (debe fallar)", error);
    }
  } finally {
    console.log("\n--- Limpieza ---");
    await cleanupAll(clientA, clientB, cleanup);
  }

  console.log(`\n=== Resumen: ${results.length - failed}/${results.length} OK ===\n`);
  if (failed > 0) process.exit(1);
}

async function cleanupAll(clientA, clientB, cleanup) {
  const deleteEntry = async (client, label, id, patientRef) => {
    if (!client || !id) return;
    const { error } = await client
      .from("favor_entries")
      .delete()
      .eq("id", id)
      .eq("patient_ref", patientRef);
    if (error) console.warn(`  Limpieza ${label} entry: ${error.message}`);
    else console.log(`  Eliminado entry temporal ${label}`);
  };

  for (const id of cleanup.entryIdsA) {
    await deleteEntry(clientA, "A", id, MARKER);
  }
  for (const id of cleanup.entryIdsB) {
    await deleteEntry(clientB, "B", id, MARKER);
    await deleteEntry(clientA, "A-spoof-id", id, MARKER_SPOOF);
  }

  if (clientA) {
    const { error } = await clientA.from("favor_entries").delete().eq("patient_ref", MARKER_SPOOF);
    if (!error) console.log("  Limpieza entries spoof por patient_ref si existían");
  }

  if (cleanup.createdSettingsA && clientA && cleanup.userIdA) {
    const { error } = await clientA.from("favor_settings").delete().eq("user_id", cleanup.userIdA);
    if (error) console.warn(`  Limpieza settings A creado en prueba: ${error.message}`);
    else console.log("  Eliminado favor_settings creado en prueba (A)");
  }

  if (cleanup.createdSettingsB && clientB && cleanup.userIdB) {
    const { error } = await clientB.from("favor_settings").delete().eq("user_id", cleanup.userIdB);
    if (error) console.warn(`  Limpieza settings B creado en prueba: ${error.message}`);
    else console.log("  Eliminado favor_settings creado en prueba (B)");
  }

  if (cleanup.quotaModifiedA && cleanup.quotaBackupA != null && clientA && cleanup.userIdA) {
    const { error } = await clientA
      .from("favor_settings")
      .update({ weekly_quota: cleanup.quotaBackupA })
      .eq("user_id", cleanup.userIdA);
    if (error) console.warn(`  Restaurar cupo A: ${error.message}`);
    else console.log("  Cupo A restaurado al valor previo");
  }

  if (cleanup.quotaModifiedB && cleanup.quotaBackupB != null && clientB && cleanup.userIdB) {
    const { error } = await clientB
      .from("favor_settings")
      .update({ weekly_quota: cleanup.quotaBackupB })
      .eq("user_id", cleanup.userIdB);
    if (error) console.warn(`  Restaurar cupo B: ${error.message}`);
    else console.log("  Cupo B restaurado al valor previo");
  }
}

main().catch((err) => {
  console.error("\nError fatal:", err.message);
  process.exit(1);
});
