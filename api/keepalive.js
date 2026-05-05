export default async function handler(req, res) {
  try {
    const response = await fetch("https://ubzcboqndsuugszwarls.supabase.co/rest/v1/app_health?id=eq.1", {
      headers: {
        apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViemNib3FuZHN1dWdzendhcmxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjE5NTMsImV4cCI6MjA5MjE5Nzk1M30.wCMA312v4VveY_9QmmE8saW2A35juRRmc5fE-6jVd28",
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViemNib3FuZHN1dWdzendhcmxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjE5NTMsImV4cCI6MjA5MjE5Nzk1M30.wCMA312v4VveY_9QmmE8saW2A35juRRmc5fE-6jVd28"
      }
    });

    const data = await response.json();

    res.status(200).json({
      ok: true,
      data
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}