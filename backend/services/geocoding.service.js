const DEFAULT_PROVIDER = process.env.GEOCODER_PROVIDER || 'nominatim';

async function geocodeWithNominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': process.env.GEOCODER_USER_AGENT || 'ClickNGo/1.0',
    },
  });
  if (!res.ok) throw new Error('Geocoding provider request failed');
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return {
    location_address: data[0].display_name || address,
    latitude: Number(data[0].lat),
    longitude: Number(data[0].lon),
  };
}

async function geocodeAddress(address) {
  const query = String(address || '').trim();
  if (!query) throw new Error('location_address is required');
  if (DEFAULT_PROVIDER === 'nominatim') {
    return geocodeWithNominatim(query);
  }
  throw new Error(`Unsupported geocoding provider: ${DEFAULT_PROVIDER}`);
}

module.exports = { geocodeAddress };
