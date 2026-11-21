import { Router } from 'express';
import prisma from '../prisma.js';

const router = Router();

router.get('/cars', async (_req, res) => {
  try {
    const cars = await prisma.carCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(
      cars.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        pricePerKm: c.pricePerKm,
        seats: c.seats,
        image: c.image,
        eta: c.eta,
        availability: 'Live',
      })),
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    let settings = null;
    try {
      settings = await prisma.appSettings.findFirst();
    } catch (_err) {
      // Table might not exist yet if db push hasn't run on local db
    }

    return res.json({
      qrCodeUrl: settings?.qrCodeUrl || null,
      upiId: settings?.upiId || '',
      advanceAmount: settings?.advanceAmount ?? 200,
      helpline1: settings?.helpline1 || '',
      helpline2: settings?.helpline2 || '',
    });
  } catch (e) {
    console.error('SETTINGS_FETCH_ERROR:', e);
    return res.json({
      qrCodeUrl: null,
      upiId: '',
      advanceAmount: 200,
      helpline1: '',
      helpline2: '',
    });
  }
});

export default router;
