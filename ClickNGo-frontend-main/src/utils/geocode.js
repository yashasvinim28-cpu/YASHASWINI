export async function geocodeAddress(address) {
  const q = String(address || "").trim();
  if (!q) throw new Error("Address is required");
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ClicknGo/1.0" },
  });
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error("Could not geocode this address");
  const top = data[0];
  return {
    location_address: top.display_name || q,
    latitude: Number(top.lat),
    longitude: Number(top.lon),
  };
}
