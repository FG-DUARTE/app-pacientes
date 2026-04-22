import { supabase } from "@/lib/supabase/client";

export default async function TestDbPage() {
  const { data, error } = await supabase.from("patients").select("*").limit(5);

  return (
    <main style={{ padding: 24 }}>
      <h1>Prueba Supabase</h1>

      {error ? (
        <pre>{JSON.stringify(error, null, 2)}</pre>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}