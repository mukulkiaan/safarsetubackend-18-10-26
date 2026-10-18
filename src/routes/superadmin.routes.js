import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { authMiddleware } from '../auth.js';

const router = Router();

router.use(authMiddleware(['SUPERADMIN']));

router.get('/admins', async (_req, res) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', deleted: false },
      select: { id: true, name: true, phone: true },
    });
    return res.json(
      admins.map((a) => ({
        id: a.id,
        name: a.name,
        phone: a.phone,
        role: 'admin',
        passwordPlaceholder: true,
      })),
    );
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/admins/:id', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const data = {};
    if (phone) data.phone = phone;
    if (password) data.passwordHash = await bcrypt.hash(String(password), 10);
    const updated = await prisma.user.update({
      where: { id: req.params.id, role: 'ADMIN' },
      data,
      select: { id: true, name: true, phone: true },
    });
    return res.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      role: 'admin',
      passwordPlaceholder: true,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Update failed' });
  }
});

export default router;
