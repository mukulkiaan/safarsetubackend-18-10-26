import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { authMiddleware } from '../auth.js';

const router = Router();

router.use(authMiddleware(['ADMIN', 'SUPERADMIN']));

function driverRow(user) {
  const p = user.driverProfile;
  return {
    id: user.id,
    userId: user.id,
    name: user.name,
    phone: user.phone,
    password: user.plainPassword || '',
    location: user.location || '',
    carType: p?.carType || '',
    vehicleNumber: p?.vehicleNumber || '',
    vehiclePhoto: p?.vehiclePhotoUrl || 'https://placehold.co/120x80?text=Vehicle',
    licensePhoto: p?.licensePhotoUrl || 'https://placehold.co/120x80?text=License',
    approvalStatus: p?.approvalStatus === 'APPROVED' ? 'Approved' : p?.approvalStatus === 'REJECTED' ? 'Rejected' : 'Pending',
    status: p?.workStatus === 'BUSY' ? 'Busy' : 'Available',
    createdAt: user.createdAt,
  };
}

function customerRow(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    password: user.plainPassword || '',
    location: user.location || '',
    joined: user.createdAt.toLocaleDateString('en-GB'),
    totalRides: 0,
    spent: 0,
    status: user.deleted ? 'Suspended' : 'Active',
    createdAt: user.createdAt,
  };
}

router.get('/drivers', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'DRIVER' },
    include: { driverProfile: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users.map(driverRow));
});

router.post('/drivers', async (req, res) => {
  const { name, phone, location, vehicleName, vehicleNumber, password, vehiclePhotoUrl, licensePhotoUrl } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ message: 'Missing fields' });
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await prisma.user.create({
    data: {
      phone: String(phone),
      name,
      location: location || null,
      role: 'DRIVER',
      passwordHash,
      plainPassword: String(password),
      driverProfile: {
        create: {
          carType: vehicleName || 'Mini',
          vehicleNumber: vehicleNumber || 'NA',
          vehiclePhotoUrl: vehiclePhotoUrl || null,
          licensePhotoUrl: licensePhotoUrl || null,
          approvalStatus: 'PENDING',
        },
      },
    },
    include: { driverProfile: true },
  });

  const finalCarName = vehicleName || 'Mini';
  const existingCar = await prisma.carCategory.findFirst({ where: { name: finalCarName } });
  if (!existingCar) {
    await prisma.carCategory.create({
      data: {
        name: finalCarName,
        type: 'Standard',
        pricePerKm: 12,
        seats: 4,
        image: vehiclePhotoUrl || 'https://placehold.co/200x100?text=New+Car',
      }
    });
  }

  res.status(201).json(driverRow(user));
});

router.patch('/drivers/:userId', async (req, res) => {
  const { name, phone, location, vehicleName, vehicleNumber, password, vehiclePhotoUrl, licensePhotoUrl } = req.body;
  const userId = req.params.userId;
  const data = {};
  if (name) data.name = name;
  if (phone) data.phone = phone;
  if (location != null) data.location = location;
  if (password) {
    data.passwordHash = await bcrypt.hash(String(password), 10);
    data.plainPassword = String(password);
  }
  const pData = {};
  if (vehicleName) pData.carType = vehicleName;
  if (vehicleNumber) pData.vehicleNumber = vehicleNumber;
  if (vehiclePhotoUrl !== undefined) pData.vehiclePhotoUrl = vehiclePhotoUrl;
  if (licensePhotoUrl !== undefined) pData.licensePhotoUrl = licensePhotoUrl;

  const user = await prisma.user.update({
    where: { id: userId, role: 'DRIVER' },
    data: {
      ...data,
      ...(Object.keys(pData).length && {
        driverProfile: { update: pData },
      }),
    },
    include: { driverProfile: true },
  });

  if (vehicleName) {
    const existingCar = await prisma.carCategory.findFirst({ where: { name: vehicleName } });
    if (!existingCar) {
      await prisma.carCategory.create({
        data: {
          name: vehicleName,
          type: 'Standard',
          pricePerKm: 12,
          seats: 4,
          image: vehiclePhotoUrl || user.driverProfile?.vehiclePhotoUrl || 'https://placehold.co/200x100?text=New+Car',
        }
      });
    }
  }

  res.json(driverRow(user));
});

router.patch('/drivers/:userId/approval', async (req, res) => {
  const { status } = req.body;
  if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const user = await prisma.user.update({
    where: { id: req.params.userId, role: 'DRIVER' },
    data: { driverProfile: { update: { approvalStatus: status } } },
    include: { driverProfile: true },
  });
  res.json(driverRow(user));
});

router.delete('/drivers/:userId', async (req, res) => {
  const driverBookings = await prisma.booking.findMany({ where: { driverId: req.params.userId } });
  if (driverBookings.length > 0) {
    await prisma.booking.updateMany({ where: { driverId: req.params.userId }, data: { driverId: null } });
  }
  const dp = await prisma.driverProfile.findUnique({ where: { userId: req.params.userId } });
  if (dp) await prisma.driverProfile.delete({ where: { userId: req.params.userId } });
  await prisma.user.delete({ where: { id: req.params.userId, role: 'DRIVER' } });
  res.json({ ok: true });
});

router.get('/customers', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
  });
  const withStats = await Promise.all(
    users.map(async (u) => {
      const agg = await prisma.booking.aggregate({
        where: { customerId: u.id, status: 'COMPLETED' },
        _count: { id: true },
        _sum: { fare: true },
      });
      return {
        ...customerRow(u),
        totalRides: agg._count.id,
        spent: Math.round(agg._sum.fare || 0),
      };
    }),
  );
  res.json(withStats);
});

router.post('/customers', async (req, res) => {
  const { name, phone, location, password } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ message: 'Missing fields' });
  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await prisma.user.create({
    data: {
      phone: String(phone),
      name,
      location: location || null,
      role: 'CUSTOMER',
      passwordHash,
      plainPassword: String(password),
    },
  });
  res.status(201).json(customerRow(user));
});

router.patch('/customers/:userId', async (req, res) => {
  const { name, phone, location, password } = req.body;
  const data = {};
  if (name) data.name = name;
  if (phone) data.phone = phone;
  if (location != null) data.location = location;
  if (password) {
    data.passwordHash = await bcrypt.hash(String(password), 10);
    data.plainPassword = String(password);
  }
  const user = await prisma.user.update({
    where: { id: req.params.userId, role: 'CUSTOMER' },
    data,
  });
  res.json(customerRow(user));
});

router.delete('/customers/:userId', async (req, res) => {
  const customerBookings = await prisma.booking.findMany({ where: { customerId: req.params.userId } });
  if (customerBookings.length > 0) {
    const bookingIds = customerBookings.map(b => b.id);
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { customerId: req.params.userId } });
  }
  await prisma.user.delete({ where: { id: req.params.userId, role: 'CUSTOMER' } });
  res.json({ ok: true });
});

router.get('/cars', async (_req, res) => {
  const cars = await prisma.carCategory.findMany({ orderBy: { id: 'desc' } });
  res.json(
    cars.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      pricePerKm: c.pricePerKm,
      seats: c.seats,
      image: c.image,
      eta: c.eta,
      commissionPercent: Number(c.commissionPercent ?? 12.0),
      availability: 'Live',
    })),
  );
});

router.post('/cars', async (req, res) => {
  const { name, type, pricePerKm, seats, image, eta, commissionPercent } = req.body;
  if (!name || !type || !pricePerKm || !seats) {
    return res.status(400).json({ message: 'Missing fields' });
  }
  const c = await prisma.carCategory.create({
    data: {
      name,
      type,
      pricePerKm: Number(pricePerKm),
      seats: Number(seats),
      image: image || 'https://placehold.co/200x100?text=New+Car',
      eta: eta || '5 mins',
      commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : 12.0,
    }
  });
  res.status(201).json({
    id: c.id,
    name: c.name,
    type: c.type,
    pricePerKm: c.pricePerKm,
    seats: c.seats,
    image: c.image,
    eta: c.eta,
    commissionPercent: Number(c.commissionPercent ?? 12.0),
    availability: 'Live',
  });
});

router.patch('/cars/commissions/bulk', async (req, res) => {
  try {
    const { commissions } = req.body; // [{ id, commissionPercent }]
    if (!Array.isArray(commissions)) {
      return res.status(400).json({ message: 'commissions must be an array' });
    }
    const updates = await Promise.all(
      commissions.map(async (item) => {
        if (!item) return null;
        const val = Number(item.commissionPercent);
        if (isNaN(val) || val < 0 || val > 100) return null;
        if (item.id) {
          return prisma.carCategory.update({
            where: { id: Number(item.id) },
            data: { commissionPercent: val },
          });
        }
        return null;
      })
    );
    res.json({ ok: true, updated: updates.filter(Boolean).length });
  } catch (err) {
    console.error('Bulk commission update error:', err);
    res.status(500).json({ message: err.message || 'Failed to update commissions' });
  }
});

router.patch('/cars/:id', async (req, res) => {
  const { name, type, pricePerKm, seats, image, eta, commissionPercent } = req.body;
  const data = {};
  if (name) data.name = name;
  if (type) data.type = type;
  if (pricePerKm !== undefined) data.pricePerKm = Number(pricePerKm);
  if (seats !== undefined) data.seats = Number(seats);
  if (image) data.image = image;
  if (eta) data.eta = eta;
  if (commissionPercent !== undefined) data.commissionPercent = Number(commissionPercent);

  const c = await prisma.carCategory.update({
    where: { id: Number(req.params.id) },
    data,
  });
  res.json({
    id: c.id,
    name: c.name,
    type: c.type,
    pricePerKm: c.pricePerKm,
    seats: c.seats,
    image: c.image,
    eta: c.eta,
    commissionPercent: Number(c.commissionPercent ?? 12.0),
    availability: 'Live',
  });
});

router.delete('/cars/:id', async (req, res) => {
  await prisma.carCategory.delete({
    where: { id: Number(req.params.id) },
  });
  res.json({ ok: true });
});

router.get('/payments', async (_req, res) => {
  try {
    // 1. Sync any COMPLETED bookings that don't have a payment record yet
    const completedBookings = await prisma.booking.findMany({
      where: { status: 'COMPLETED' },
      include: { customer: true, driver: true },
      orderBy: { createdAt: 'desc' }
    });

    for (const b of completedBookings) {
      const existing = await prisma.payment.findFirst({ where: { bookingId: b.id } });
      if (!existing) {
        const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' };
        const formattedDate = b.createdAt
          ? new Date(b.createdAt).toLocaleDateString('en-GB', dateOptions)
          : 'Live';
        await prisma.payment.create({
          data: {
            bookingId: b.id,
            customerName: b.customer?.name || 'Customer',
            amount: Number(b.fare) || 0,
            method: 'Online',
            status: 'Completed',
            date: formattedDate,
          },
        });
      }
    }

    // 2. Fetch all completed payments with booking, customer and driver details
    const rows = await prisma.payment.findMany({
      where: { status: 'Completed' },
      include: {
        booking: {
          include: { customer: true, driver: true }
        }
      },
      orderBy: { id: 'desc' }
    });

    // 3. Load car commission rates
    const carCategories = await prisma.carCategory.findMany();
    const commMap = {};
    carCategories.forEach(c => {
      const rate = Number(c.commissionPercent ?? 12.0);
      if (c.name) commMap[c.name.trim().toLowerCase()] = rate;
      if (c.type) commMap[c.type.trim().toLowerCase()] = rate;
    });
    const getRate = (carName) => {
      if (!carName) return 12.0;
      return commMap[String(carName).trim().toLowerCase()] ?? 12.0;
    };

    const results = rows.map((p) => {
      const carName = p.booking?.carName || 'Standard';
      const rate = getRate(carName);
      const amount = Number(p.amount) || 0;
      const adminCommission = Math.floor(amount * (rate / 100));
      const driverPayout = amount - adminCommission;

      return {
        id: p.id,
        bookingId: p.bookingId || String(p.id),
        customer: p.customerName || p.booking?.customer?.name || 'Customer',
        driverName: p.booking?.driver?.name || 'Assigned Driver',
        carName: carName,
        pickup: p.booking?.pickupText || '',
        drop: p.booking?.dropText || '',
        amount: amount,
        adminCommission: adminCommission,
        driverPayout: driverPayout,
        commissionPercent: rate,
        method: p.method || 'Online',
        status: p.status,
        date: p.date || (p.booking?.createdAt ? new Date(p.booking.createdAt).toLocaleDateString('en-GB') : '22 May 2026'),
        rawDate: p.booking?.createdAt ? p.booking.createdAt : new Date().toISOString(),
      };
    });

    res.json(results);
  } catch (err) {
    console.error('Admin /payments error:', err);
    res.status(500).json({ message: 'Failed to load payments' });
  }
});

router.get('/dashboard-stats', async (req, res) => {
  try {
    const allBookings = await prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const carCategories = await prisma.carCategory.findMany();
    const commRateMap = {};
    carCategories.forEach(c => {
      const rate = Number(c.commissionPercent ?? 12.0);
      if (c.name) commRateMap[c.name.trim().toLowerCase()] = rate;
      if (c.type) commRateMap[c.type.trim().toLowerCase()] = rate;
    });

    const getCarCommRate = (carName) => {
      if (!carName) return 12.0;
      const key = String(carName).trim().toLowerCase();
      return commRateMap[key] ?? 12.0;
    };

    const completed = allBookings.filter(b => b.status === 'COMPLETED');
    const dbCommissions = completed.reduce((sum, b) => {
      const rate = getCarCommRate(b.carName);
      return sum + Math.floor((Number(b.fare) || 0) * (rate / 100));
    }, 0);
    const driverPayouts = completed.reduce((sum, b) => {
      const fare = Number(b.fare) || 0;
      const rate = getCarCommRate(b.carName);
      const comm = Math.floor(fare * (rate / 100));
      return sum + (fare - comm);
    }, 0);

    const approvedDrivers = await prisma.user.count({
      where: { role: 'DRIVER', driverProfile: { approvalStatus: 'APPROVED' } }
    });
    const totalDrivers = await prisma.user.count({ where: { role: 'DRIVER' } });
    const busyDrivers = await prisma.driverProfile.count({ where: { workStatus: 'BUSY' } });

    const completedPayments = await prisma.payment.findMany({
      where: { status: 'Completed' }
    });
    const paymentsTotal = completedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const walletBalance = paymentsTotal || completed.reduce((sum, b) => sum + (b.fare || 0), 0);
    const totalCommissions = dbCommissions;

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const revenueData = dayNames.map(name => ({ name, revenue: 0, commission: 0, driverPay: 0 }));

    completed.forEach(b => {
      if (b.bookingDate) {
        const date = new Date(b.bookingDate);
        if (!isNaN(date.getTime())) {
          const dayIndex = date.getDay(); // 0 Sunday, 1 Monday, ...
          const idx = dayIndex === 0 ? 6 : dayIndex - 1; // Mon -> 0, ..., Sun -> 6
          if (idx >= 0 && idx < 7) {
            const fare = Number(b.fare) || 0;
            const rate = getCarCommRate(b.carName);
            const comm = Math.floor(fare * (rate / 100));
            revenueData[idx].revenue += fare;
            revenueData[idx].commission += comm;
            revenueData[idx].driverPay += (fare - comm);
          }
        }
      }
    });

    const pendingCount = allBookings.filter(b => b.status === 'PENDING').length;
    const assignedCount = allBookings.filter(b => b.status === 'ASSIGNED').length;
    const acceptedCount = allBookings.filter(b => b.status === 'ACCEPTED').length;
    const completedCount = completed.length;
    const cancelledCount = allBookings.filter(b => b.status === 'CANCELLED').length;

    const pieData = [
      { name: 'Completed', value: completedCount, color: '#22c55e' },
      { name: 'Pending', value: pendingCount + assignedCount + acceptedCount, color: '#eab308' },
      { name: 'Cancelled', value: cancelledCount, color: '#ef4444' },
    ];

    const totalBookingsCount = allBookings.length;
    const successRate = totalBookingsCount > 0 ? Math.round((completedCount / totalBookingsCount) * 100) : 100;
    const fleetUtil = totalDrivers > 0 ? Math.round((busyDrivers / totalDrivers) * 100) : (approvedDrivers > 0 ? 50 : 0);

    const operationalMetrics = [
      { labelKey: 'admin.booking_success_rate', val: `${successRate}%`, color: 'bg-green-500' },
      { labelKey: 'admin.driver_response_time', val: '2.5m', color: 'bg-primary' },
      { labelKey: 'admin.customer_satisfaction', val: completedCount > 0 ? '4.9/5' : '5.0/5', color: 'bg-blue-500' },
      { labelKey: 'admin.fleet_utilization', val: `${fleetUtil}%`, color: 'bg-red-500' },
    ];

    res.json({
      totalBookings: totalBookingsCount,
      approvedDrivers,
      totalCommissions,
      walletBalance,
      driverPayouts,
      revenueData,
      pieData,
      operationalMetrics
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
