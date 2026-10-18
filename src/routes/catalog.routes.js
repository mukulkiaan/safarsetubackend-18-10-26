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

export default router;
