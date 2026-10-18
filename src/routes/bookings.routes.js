import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { authMiddleware } from '../auth.js';
import { bookingToJson, STATUS_FROM_UI, getBookingOtp } from '../formatters.js';
import { resolveRoute } from '../services/map.service.js';

const router = Router();

const includeBooking = {
  customer: true,
  driver: { include: { driverProfile: true } },
};

async function ensureRoute(body) {
  let {
    pickupLat,
    pickupLng,
    dropLat,
    dropLng,
    routeCoords,
    distanceKm,
    pickup,
    drop,
  } = body;

  if (
    pickupLat != null &&
    pickupLng != null &&
    dropLat != null &&
    dropLng != null &&
    routeCoords?.length >= 2 &&
    distanceKm != null
  ) {
    return {
      pickupLat,
      pickupLng,
      dropLat,
      dropLng,
      routeGeoJson: JSON.stringify(routeCoords),
      distanceKm: Number(distanceKm),
    };
  }

  const route = await resolveRoute(String(pickup).trim(), String(drop).trim());
  return {
    pickupLat: route.pickup.lat,
    pickupLng: route.pickup.lng,
    dropLat: route.drop.lat,
    dropLng: route.drop.lng,
    routeGeoJson: JSON.stringify(route.coordinates),
    distanceKm: route.distanceKm,
  };
}

router.get('/', authMiddleware(['CUSTOMER', 'DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const { role, sub } = req.auth;
    let where = {};
    if (role === 'CUSTOMER') where = { customerId: sub };
    else if (role === 'DRIVER') where = { driverId: sub };
    else if (role === 'ADMIN') where = {};
    const list = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: includeBooking,
    });
    return res.json(list.map(bookingToJson));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', authMiddleware(['CUSTOMER']), async (req, res) => {
  try {
    const { pickup, drop, bookingDate, bookingTime, carName, fare } = req.body;
    if (!pickup || !drop || !bookingDate || !bookingTime || !carName) {
      return res.status(400).json({ message: 'Missing booking fields' });
    }

    const route = await ensureRoute({ ...req.body, pickup, drop });
    const fareNum = fare != null ? Number(fare) : route.distanceKm * 12;

    const booking = await prisma.booking.create({
      data: {
        customerId: req.auth.sub,
        pickupText: pickup,
        dropText: drop,
        bookingDate,
        bookingTime,
        carName,
        fare: Math.round(fareNum),
        status: 'PENDING',
        ...route,
      },
      include: includeBooking,
    });
    return res.status(201).json(bookingToJson(booking));
  } catch (e) {
    console.error(e);
    const status = e.status || 500;
    return res.status(status).json({ message: e.message || 'Server error' });
  }
});

router.post('/admin', authMiddleware(['ADMIN']), async (req, res) => {
  try {
    const { customer, phone, pickup, drop, car, date, time, fare } = req.body;
    if (!customer || !phone || !pickup || !drop || !date || !time || !car) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    let cust = await prisma.user.findFirst({
      where: { phone: String(phone), role: 'CUSTOMER', deleted: false },
    });
    if (!cust) {
      const passwordHash = await bcrypt.hash('changeme123', 10);
      cust = await prisma.user.create({
        data: {
          phone: String(phone),
          name: customer,
          passwordHash,
          role: 'CUSTOMER',
          location: pickup,
        },
      });
    }

    const route = await ensureRoute({ pickup, drop });
    const fareNum = fare != null ? Number(fare) : Math.round(route.distanceKm * 12);

    const booking = await prisma.booking.create({
      data: {
        customerId: cust.id,
        pickupText: pickup,
        dropText: drop,
        bookingDate: date,
        bookingTime: time,
        carName: car,
        fare: fareNum,
        status: 'PENDING',
        ...route,
      },
      include: includeBooking,
    });
    return res.status(201).json(bookingToJson(booking));
  } catch (e) {
    console.error(e);
    const status = e.status || 500;
    return res.status(status).json({ message: e.message || 'Server error' });
  }
});

router.patch('/:id', authMiddleware(['ADMIN', 'DRIVER', 'CUSTOMER']), async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id }, include: includeBooking });
    if (!booking) return res.status(404).json({ message: 'Not found' });

    // Customer cancellation
    if (req.auth.role === 'CUSTOMER') {
      if (booking.customerId !== req.auth.sub) {
        return res.status(403).json({ message: 'Not your ride request' });
      }
      if (booking.status === 'COMPLETED') {
        return res.status(400).json({ message: 'Cannot cancel a completed ride' });
      }
      const updated = await prisma.booking.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: includeBooking,
      });
      return res.json(bookingToJson(updated));
    }

    if (req.auth.role === 'DRIVER') {
      if (booking.driverId !== req.auth.sub) return res.status(403).json({ message: 'Not your ride' });
      if ((req.body.action === 'accept' || req.body.status === 'Accepted') && (booking.status === 'ASSIGNED' || booking.status === 'PENDING')) {
        const updated = await prisma.booking.update({
          where: { id },
          data: { status: 'ACCEPTED' },
          include: includeBooking,
        });
        return res.json(bookingToJson(updated));
      }
      if (req.body.action === 'complete' || req.body.action === 'verify_otp' || req.body.status === 'Completed') {
        if (req.body.otp) {
          const expectedOtp = getBookingOtp(booking.id);
          if (String(req.body.otp).trim() !== expectedOtp) {
            return res.status(400).json({ message: 'Invalid Customer OTP. Please ask customer for the correct 4-digit Ride OTP.' });
          }
        }
        const updated = await prisma.booking.update({
          where: { id },
          data: { status: 'COMPLETED' },
          include: includeBooking,
        });

        // Ensure Payment record is immediately created for Admin and Driver logs
        try {
          const existingPay = await prisma.payment.findFirst({ where: { bookingId: id } });
          if (!existingPay) {
            const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' };
            const formattedDate = new Date().toLocaleDateString('en-GB', dateOptions);
            await prisma.payment.create({
              data: {
                bookingId: id,
                customerName: updated.customer?.name || 'Customer',
                amount: Number(updated.fare) || 0,
                method: 'Online',
                status: 'Completed',
                date: formattedDate
              }
            });
          }
        } catch (payErr) {
          console.error('Auto payment creation error on trip completion:', payErr);
        }

        return res.json(bookingToJson(updated));
      }
      return res.status(400).json({ message: 'Invalid driver update' });
    }

    const data = {};
    if (req.body.pickup != null) data.pickupText = req.body.pickup;
    if (req.body.drop != null) data.dropText = req.body.drop;
    if (req.body.fare != null) data.fare = Number(req.body.fare);
    if (req.body.date != null) data.bookingDate = req.body.date;
    if (req.body.time != null) data.bookingTime = req.body.time;

    if (req.body.driverId) {
      data.driverId = req.body.driverId;
      data.status = 'ASSIGNED';
    }

    if (req.body.status && STATUS_FROM_UI[req.body.status]) {
      data.status = STATUS_FROM_UI[req.body.status];
    }

    if (req.body.pickup && req.body.drop && (req.body.pickup !== booking.pickupText || req.body.drop !== booking.dropText)) {
      const route = await ensureRoute({ pickup: req.body.pickup, drop: req.body.drop });
      Object.assign(data, route);
    }

    const prevStatus = booking.status;
    const updated = await prisma.booking.update({
      where: { id },
      data,
      include: includeBooking,
    });

    if (updated.status === 'COMPLETED' && prevStatus !== 'COMPLETED') {
      const existingPay = await prisma.payment.findFirst({
        where: { bookingId: id }
      });
      if (!existingPay) {
        const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' };
        const formattedDate = new Date().toLocaleDateString('en-GB', dateOptions);
        
        await prisma.payment.create({
          data: {
            bookingId: id,
            customerName: updated.customer?.name || 'Customer',
            amount: updated.fare,
            method: 'Wallet',
            status: 'Completed',
            date: formattedDate
          }
        });
      }
    }

    return res.json(bookingToJson(updated));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: e.message || 'Server error' });
  }
});

router.delete('/:id', authMiddleware(['ADMIN']), async (req, res) => {
  try {
    await prisma.booking.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: 'Delete failed' });
  }
});

router.get('/driver-stats', authMiddleware(['DRIVER']), async (req, res) => {
  try {
    const driverId = req.auth.sub;
    const completed = await prisma.booking.findMany({
      where: { driverId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' }
    });
    
    const allDriverBookings = await prisma.booking.findMany({
      where: { driverId }
    });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const getEarning = (b) => (b.fare || 0) - Math.floor((b.fare || 0) * 0.12);

    const todayEarnings = completed
      .filter(b => b.bookingDate === todayStr || (b.createdAt && new Date(b.createdAt).toDateString() === now.toDateString()))
      .reduce((sum, b) => sum + getEarning(b), 0);

    const weekEarnings = completed
      .filter(b => b.createdAt && new Date(b.createdAt) >= sevenDaysAgo)
      .reduce((sum, b) => sum + getEarning(b), 0);

    const monthEarnings = completed
      .filter(b => b.createdAt && new Date(b.createdAt) >= thirtyDaysAgo)
      .reduce((sum, b) => sum + getEarning(b), 0);

    const totalEarnings = completed.reduce((sum, b) => sum + getEarning(b), 0);

    const assignedCount = allDriverBookings.length;
    const acceptance = assignedCount > 0 ? `${Math.min(100, Math.round(((completed.length + allDriverBookings.filter(b => b.status === 'ACCEPTED').length) / assignedCount) * 100))}%` : '100%';

    res.json({
      todayEarnings,
      weekEarnings: weekEarnings || todayEarnings,
      monthEarnings: monthEarnings || totalEarnings,
      totalEarnings,
      bonuses: Math.floor(todayEarnings * 0.05),
      rating: completed.length > 0 ? "4.95" : "5.0",
      tripsDone: completed.length,
      onlineHours: completed.length > 0 ? `${(completed.length * 0.8).toFixed(1)}h` : "0h",
      acceptance
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
