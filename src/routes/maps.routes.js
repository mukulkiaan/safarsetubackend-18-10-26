import { Router } from 'express';
import { resolveRoute, searchLocations, reverseGeocode } from '../services/map.service.js';

const router = Router();

router.post('/route', async (req, res) => {
  try {
    const { pickup, drop, pickupCoords, dropCoords } = req.body;
    if (!pickup && !pickupCoords && !drop && !dropCoords) {
      return res.status(400).json({ message: 'Pickup or drop required' });
    }
    const route = await resolveRoute(
      pickup ? String(pickup).trim() : '',
      drop ? String(drop).trim() : '',
      pickupCoords,
      dropCoords
    );
    return res.json(route);
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ message: e.message || 'Map error' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const results = await searchLocations(String(q));
    return res.json(results);
  } catch (e) {
    return res.status(500).json({ message: e.message || 'Search error' });
  }
});

router.get('/reverse', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ message: 'lat and lng required' });
    const address = await reverseGeocode(parseFloat(lat), parseFloat(lng));
    return res.json({ address });
  } catch (e) {
    return res.status(500).json({ message: e.message || 'Reverse geocode error' });
  }
});

export default router;

