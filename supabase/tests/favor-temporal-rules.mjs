#!/usr/bin/env node
/**
 * Prueba reglas temporales Fase 4 — favor_entries
 *
 * Migraciones aplicadas (en orden):
 *   20261019193000_cupo_favores_fase4_temporal_rules.sql
 *   20261019200000_cupo_favores_fase4_no_past_insert.sql
 *   20261019213000_cupo_favores_fase4_delete_today.sql
 *
 * Uso: supabase/tests/README-favor-temporal-rules.md
 */

import { createClient } from "@supabase/supabase-js";

const RUN_ID = `F4_TEST_${Date.now()}`;
const MARKER = RUN_ID;

const url =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const email = process.env.RLS_TEST_USER_A_EMAIL;
const passA = process.env.RLS_TEST_USER_A_PASSWORD;
const emailB = process.env.RLS_TEST_USER_B_EMAIL;
const passB = process.env.RLS_TEST_USER_B_PASSWORD;

const results = [];
let failed = 0;

function requireEnv() {
  const missing = [];
  if (!url) missing.push("SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!email) missing.push("RLS_TEST_USER_A_EMAIL");
  if (!passA) missing.push("RLS_TEST_USER_A_PASSWORD");
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

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true });
  console.log(`  SKIP ${name} (${reason})`);
}

function expectError(name, error) {
  if (error) pass(name);
  else fail(name, "se esperaba error y la operación tuvo éxito");
}

function madridYMD(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const dt = new Date(y, m - 1, d + offsetDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function signIn(label, em, pw) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: em, password: pw });
  if (error) throw new Error(`Login falló (${label}): ${error.message}`);
  if (!data.user?.id) throw new Error(`Sin user.id tras login (${label})`);
  return { client, userId: data.user.id };
}

async function insertEntry(client, userId, studyDate, suffix) {
  return client
    .from("favor_entries")
    .insert({
      user_id: userId,
      study_date: studyDate,
      modality: "TC",
      patient_ref: `${MARKER}_${suffix}`.slice(0, 32),
      requester: "Prueba F4",
      note: "temporal",
    })
    .select("id")
    .single();
}

async function findOwnPastEntryId(client, userId, beforeYMD) {
  const { data, error } = await client
    .from("favor_entries")
    .select("id")
    .eq("user_id", userId)
    .lt("study_date", beforeYMD)
    .order("study_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.id || null;
}

async function cleanupMarkerEntries(client) {
  if (!client) return;
  const { data: rows } = await client
    .from("favor_entries")
    .select("id, study_date, patient_ref")
    .like("patient_ref", `${MARKER}%`);
  const today = madridYMD(0);
  let removed = 0;
  let leftPast = 0;
  for (const row of rows || []) {
    if (row.study_date >= today) {
      const { error } = await client.from("favor_entries").delete().eq("id", row.id);
      if (!error) removed++;
    } else {
      leftPast++;
    }
  }
  console.log(
    `  Limpieza marker: ${removed} eliminada(s) (hoy/futuro); ${leftPast} pasada(s) no borrable(s) por RLS (OK si existían)`
  );
}

async function main() {
  requireEnv();
  console.log(`\n=== Prueba temporal Fase 4 [${RUN_ID}] ===\n`);

  const ids = [];
  let clientA;
  let userIdA;

  const yPast = madridYMD(-2);
  const yToday = madridYMD(0);
  const yFuture = madridYMD(3);
  const yFuture2 = madridYMD(5);

  try {
    ({ client: clientA, userId: userIdA } = await signIn("A", email, passA));

    console.log("1. INSERT pasado rechazado");
    {
      const { data, error } = await insertEntry(clientA, userIdA, yPast, "pasado");
      expectError("INSERT pasado (debe fallar)", error);
      if (!error && data?.id) ids.push({ id: data.id, label: "pasado" });
    }

    console.log("\n2–3. INSERT hoy y futuro permitidos");
    for (const [label, day] of [
      ["hoy", yToday],
      ["futuro", yFuture],
    ]) {
      const { data, error } = await insertEntry(clientA, userIdA, day, label);
      if (error) fail(`INSERT ${label}`, error.message);
      else {
        ids.push({ id: data.id, label });
        pass(`INSERT ${label}`);
      }
    }

    const byLabel = (l) => ids.find((x) => x.label === l)?.id;

    console.log("\n4. UPDATE datos históricos (si hay fila pasada propia)");
    {
      const pastId = await findOwnPastEntryId(clientA, userIdA, yToday);
      if (!pastId) {
        skip("UPDATE nota histórico", "sin fila pasada propia en BD");
      } else {
        const { error } = await clientA
          .from("favor_entries")
          .update({ note: "corregido histórico F4" })
          .eq("id", pastId);
        if (error) fail("UPDATE nota histórico", error.message);
        else pass("UPDATE nota histórico");
      }
    }

    console.log("\n5. Cambio de study_date pasado/hoy rechazado");
    for (const label of ["hoy"]) {
      const id = byLabel(label);
      if (!id) continue;
      const { error } = await clientA
        .from("favor_entries")
        .update({ study_date: yFuture2 })
        .eq("id", id);
      expectError(`UPDATE study_date ${label} → futuro (debe fallar)`, error);
    }
    {
      const pastId = await findOwnPastEntryId(clientA, userIdA, yToday);
      if (pastId) {
        const { error } = await clientA
          .from("favor_entries")
          .update({ study_date: yFuture2 })
          .eq("id", pastId);
        expectError("UPDATE study_date pasado → futuro (debe fallar)", error);
      } else {
        skip("UPDATE study_date pasado → futuro", "sin fila pasada propia");
      }
    }

    console.log("\nUPDATE study_date futuro → otro futuro (auxiliar)");
    {
      const id = byLabel("futuro");
      if (id) {
        const { error } = await clientA
          .from("favor_entries")
          .update({ study_date: yFuture2 })
          .eq("id", id);
        if (error) fail("UPDATE study_date futuro", error.message);
        else pass("UPDATE study_date futuro");
      }
    }

    console.log("\n6. DELETE pasado rechazado");
    {
      const pastId = await findOwnPastEntryId(clientA, userIdA, yToday);
      if (!pastId) {
        skip("DELETE pasado", "sin fila pasada propia en BD");
      } else {
        const { data, error } = await clientA
          .from("favor_entries")
          .delete()
          .eq("id", pastId)
          .select("id");
        if (error) pass("DELETE pasado (error)");
        else if (!data?.length) pass("DELETE pasado (0 filas)");
        else fail("DELETE pasado", "borró fila histórica");
      }
    }

    console.log("\n7. DELETE hoy permitido");
    {
      const id = byLabel("hoy");
      if (!id) fail("DELETE hoy", "sin fila de prueba");
      else {
        const { data, error } = await clientA.from("favor_entries").delete().eq("id", id).select("id");
        if (error) fail("DELETE hoy", error.message);
        else if (data?.length === 1) pass("DELETE hoy");
        else fail("DELETE hoy", "0 filas (¿migración delete_today aplicada?)");
      }
    }

    console.log("\n8. DELETE futuro permitido");
    {
      const id = byLabel("futuro");
      if (!id) fail("DELETE futuro", "sin fila de prueba");
      else {
        const { data, error } = await clientA.from("favor_entries").delete().eq("id", id).select("id");
        if (error) fail("DELETE futuro", error.message);
        else if (data?.length === 1) pass("DELETE futuro");
        else fail("DELETE futuro", "0 filas");
      }
    }

    console.log("\n9. Usuario A no elimina favor de B");
    if (!emailB || !passB) {
      skip("A DELETE entry de B", "faltan RLS_TEST_USER_B_*");
    } else {
      let clientB;
      let userIdB;
      let bEntryId = null;
      try {
        ({ client: clientB, userId: userIdB } = await signIn("B", emailB, passB));
        const { data, error } = await insertEntry(clientB, userIdB, yFuture, "b_futuro");
        if (error) fail("B INSERT entry para cruce", error.message);
        else {
          bEntryId = data.id;
          const { data: delData, error: delErr } = await clientA
            .from("favor_entries")
            .delete()
            .eq("id", bEntryId)
            .select("id");
          if (delErr) pass("A DELETE entry de B (error)");
          else if (!delData?.length) pass("A DELETE entry de B (0 filas)");
          else fail("A DELETE entry de B", "borró fila ajena");
        }
      } finally {
        if (clientB && bEntryId) {
          await clientB.from("favor_entries").delete().eq("id", bEntryId);
        }
      }
    }
  } finally {
    console.log("\n--- Limpieza ---");
    await cleanupMarkerEntries(clientA);
  }

  console.log(`\n=== Resumen: ${results.length - failed}/${results.length} OK ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nError fatal:", err.message);
  process.exit(1);
});
