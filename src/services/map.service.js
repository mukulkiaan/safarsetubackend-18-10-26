/**
 * Geocoding + routing: OSRM (free high-precision driving routing) +
 * OpenRouteService / Nominatim / Photon for search and reverse geocoding.
 */

const ORS_BASE = 'https://api.openrouteservice.org';

// Regional local directory for instant accurate matching
const LOCAL_HUBS = [
  { keywords: ['bodhwada', 'badwada'], lat: 22.1842, lng: 74.9654, label: 'Bodhwada, Madhya Pradesh' },
  { keywords: ['borlay', 'borlai'], lat: 22.0360, lng: 75.0049, label: 'Borlay, Madhya Pradesh' },
  { keywords: ['manawar'], lat: 22.2333, lng: 75.0833, label: 'Manawar, Madhya Pradesh' },
  { keywords: ['kukshi'], lat: 22.2024, lng: 74.7533, label: 'Kukshi, Madhya Pradesh' },
  { keywords: ['barwani', 'badwani'], lat: 22.0366, lng: 74.9031, label: 'Barwani, Madhya Pradesh' },
  { keywords: ['indore', 'rajwada', 'vijay nagar', 'palasia'], lat: 22.7196, lng: 75.8577, label: 'Indore, Madhya Pradesh' },
  { keywords: ['rau'], lat: 22.6288, lng: 75.8087, label: 'Rau, Madhya Pradesh' },
  { keywords: ['sendhwa'], lat: 21.6833, lng: 75.0934, label: 'Sendhwa, Madhya Pradesh' },
  { keywords: ['khargone'], lat: 21.8236, lng: 75.6178, label: 'Khargone, Madhya Pradesh' },
  { keywords: ['khandwa'], lat: 21.8314, lng: 76.3498, label: 'Khandwa, Madhya Pradesh' },
  { keywords: ['dhamnod'], lat: 22.2198, lng: 75.4674, label: 'Dhamnod, Madhya Pradesh' },
  { keywords: ['dhar'], lat: 22.6025, lng: 75.2997, label: 'Dhar, Madhya Pradesh' },
  { keywords: ['julwania'], lat: 21.8493, lng: 75.1274, label: 'Julwania, Madhya Pradesh' },
  { keywords: ['maheshwar'], lat: 22.1764, lng: 75.5861, label: 'Maheshwar, Madhya Pradesh' },
  { keywords: ['ujjain'], lat: 23.1765, lng: 75.7885, label: 'Ujjain, Madhya Pradesh' },
  { keywords: ['bhopal'], lat: 23.2599, lng: 77.4126, label: 'Bhopal, Madhya Pradesh' },
  { keywords: ['jaipur'], lat: 26.9154, lng: 75.8189, label: 'Jaipur, Rajasthan' },
  { keywords: ['mumbai'], lat: 19.0760, lng: 72.8777, label: 'Mumbai, Maharashtra' },
  { keywords: ['delhi', 'new delhi', 'railway station'], lat: 28.6139, lng: 77.2090, label: 'New Delhi, Delhi' },
  { keywords: ['gurgaon', 'gurugram', 'cyber city'], lat: 28.4595, lng: 77.0266, label: 'Gurugram, Haryana' },
  { keywords: ['pune'], lat: 18.5204, lng: 73.8567, label: 'Pune, Maharashtra' },
  { keywords: ['ahmedabad'], lat: 23.0225, lng: 72.5714, label: 'Ahmedabad, Gujarat' },
];

export function findLocalHub(text) {
  if (!text) return null;
  const q = text.toLowerCase().trim();
  for (const hub of LOCAL_HUBS) {
    if (hub.keywords.some((k) => q.includes(k))) {
      return { lat: hub.lat, lng: hub.lng, label: hub.label };
    }
  }
  return null;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function generateInterpolatedRoute(lat1, lng1, lat2, lng2, steps = 12) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const curveOffset = Math.sin(frac * Math.PI) * 0.005;
    const lat = lat1 + (lat2 - lat1) * frac + curveOffset;
    const lng = lng1 + (lng2 - lng1) * frac + curveOffset;
    coords.push([Math.round(lat * 100000) / 100000, Math.round(lng * 100000) / 100000]);
  }
  return coords;
}

export async function directionsOSRM(lat1, lng1, lat2, lng2) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SafarSetuApp/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates) return null;

    // Convert [lng, lat] to [lat, lng] for Leaflet
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
    const durationMin = Math.max(5, Math.round(route.duration / 60));

    return { coordinates, distanceKm, durationMin };
  } catch (e) {
    console.error('OSRM directions error:', e.message);
    return null;
  }
}

export async function geocodePhoton(text) {
  try {
    // Bias towards Central India / India bounding
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=1&lat=22.7&lon=75.8`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data?.features?.[0];
    if (!feat?.geometry?.coordinates) return null;
    const [lng, lat] = feat.geometry.coordinates;
    
    // Ensure coordinates are within India rough bounds [lat: 6 to 37, lng: 68 to 98]
    if (lat < 6 || lat > 38 || lng < 67 || lng > 98) return null;

    const props = feat.properties || {};
    const label = [props.name, props.city || props.county, props.state, props.country].filter(Boolean).join(', ') || text;
    return { lat, lng, label };
  } catch {
    return null;
  }
}

export async function geocodeNominatim(text) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&countrycodes=in&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SafarSetuCabs/1.0 (contact@safarsetu.local)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (lat < 6 || lat > 38 || lng < 67 || lng > 98) return null;
    return { lat, lng, label: data[0].display_name };
  } catch {
    return null;
  }
}

export async function searchLocations(query) {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim();
  const results = [];

  // Match local hubs first
  const matchedHubs = LOCAL_HUBS.filter(h => h.keywords.some(k => k.includes(q.toLowerCase()) || q.toLowerCase().includes(k)));
  for (const h of matchedHubs) {
    results.push({ name: h.label, lat: h.lat, lng: h.lng, type: 'city' });
  }

  // Fetch from Photon API (free OpenStreetMap autocomplete biased to India)
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=22.7&lon=75.8`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      for (const feat of (data?.features || [])) {
        const [lng, lat] = feat.geometry.coordinates;
        // Filter out non-India results
        if (lat < 6 || lat > 38 || lng < 67 || lng > 98) continue;

        const p = feat.properties || {};
        const title = p.name || p.street || p.city || 'Location';
        const subtitle = [p.district, p.city, p.state].filter(Boolean).join(', ');
        const fullLabel = subtitle ? `${title}, ${subtitle}` : title;

        // Avoid duplicate coordinates
        if (!results.some(r => Math.abs(r.lat - lat) < 0.005 && Math.abs(r.lng - lng) < 0.005)) {
          results.push({ name: fullLabel, lat, lng, type: p.type || 'place' });
        }
      }
    }
  } catch {
    /* fallback to local */
  }

  return results.slice(0, 7);
}

export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SafarSetuCabs/1.0 (contact@safarsetu.local)' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.display_name) {
        const addr = data.address || {};
        const shortName = [addr.road || addr.suburb || addr.neighbourhood, addr.city || addr.town || addr.county, addr.state].filter(Boolean).join(', ');
        return shortName || data.display_name;
      }
    }
  } catch {
    /* ignore */
  }
  return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
}

export async function resolveRoute(pickupInput, dropInput, pickupCoords = null, dropCoords = null) {
  let pickup = pickupCoords && pickupCoords.lat && pickupCoords.lng ? { lat: pickupCoords.lat, lng: pickupCoords.lng, label: pickupInput } : null;
  let drop = dropCoords && dropCoords.lat && dropCoords.lng ? { lat: dropCoords.lat, lng: dropCoords.lng, label: dropInput } : null;

  if (!pickup && pickupInput) {
    pickup = findLocalHub(pickupInput);
    if (!pickup) pickup = await geocodePhoton(pickupInput);
    if (!pickup) pickup = await geocodeNominatim(pickupInput);
  }

  if (!drop && dropInput) {
    drop = findLocalHub(dropInput);
    if (!drop) drop = await geocodePhoton(dropInput);
    if (!drop) drop = await geocodeNominatim(dropInput);
  }

  // Fallback defaults if unmatched
  if (!pickup) {
    pickup = { lat: 28.6139, lng: 77.2090, label: pickupInput || 'New Delhi' };
  }
  if (!drop) {
    drop = { lat: 28.4595, lng: 77.0266, label: dropInput || 'Gurugram' };
  }

  // 1. Try real OSRM road directions
  const osrmRoute = await directionsOSRM(pickup.lat, pickup.lng, drop.lat, drop.lng);
  if (osrmRoute && osrmRoute.coordinates?.length) {
    return {
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label || pickupInput },
      drop: { lat: drop.lat, lng: drop.lng, label: drop.label || dropInput },
      coordinates: osrmRoute.coordinates,
      distanceKm: Math.max(1, osrmRoute.distanceKm),
      durationMin: osrmRoute.durationMin,
    };
  }

  // 2. Fallback to Haversine with realistic curve
  const distanceKm = haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng);
  const coordinates = generateInterpolatedRoute(pickup.lat, pickup.lng, drop.lat, drop.lng, 12);
  const durationMin = Math.max(5, Math.round((distanceKm / 40) * 60));

  return {
    pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label || pickupInput },
    drop: { lat: drop.lat, lng: drop.lng, label: drop.label || dropInput },
    coordinates,
    distanceKm: Math.max(1, Math.round(distanceKm * 10) / 10),
    durationMin,
  };
}

