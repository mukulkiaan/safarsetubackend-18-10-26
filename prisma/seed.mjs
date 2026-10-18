import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.carCategory.deleteMany();

  const hash = (p) => bcrypt.hashSync(p, 10);

  const superadmin = await prisma.user.create({
    data: {
      phone: '0000000000',
      name: 'Super Admin',
      passwordHash: hash('superadmin'),
      role: 'SUPERADMIN',
    },
  });

  const admin = await prisma.user.create({
    data: {
      phone: '9999999999',
      name: 'Main Admin',
      passwordHash: hash('admin'),
      role: 'ADMIN',
    },
  });

  const customer = await prisma.user.create({
    data: {
      phone: '7777777777',
      name: 'Rahul Sharma',
      passwordHash: hash('user'),
      role: 'CUSTOMER',
      location: 'Village Road 1',
    },
  });

  const driverUser = await prisma.user.create({
    data: {
      phone: '8888888888',
      name: 'Aman',
      passwordHash: hash('driver'),
      role: 'DRIVER',
      location: 'Village Road 4',
      driverProfile: {
        create: {
          carType: 'SUV',
          vehicleNumber: 'UP-32-AB-1234',
          vehiclePhotoUrl:
            'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=400',
          licensePhotoUrl:
            'https://images.unsplash.com/photo-1554224155-1696413565d3?auto=format&fit=crop&q=80&w=400',
          approvalStatus: 'APPROVED',
          workStatus: 'AVAILABLE',
        },
      },
    },
  });

  await prisma.carCategory.createMany({
    data: [
      {
        name: 'Mini',
        type: 'Hatchback',
        pricePerKm: 12,
        seats: 4,
        image: '/mini.png',
        eta: '3 mins',
        sortOrder: 1,
      },
      {
        name: 'Sedan',
        type: 'Comfort',
        pricePerKm: 15,
        seats: 4,
        image: 'https://cdn-icons-png.flaticon.com/512/744/744465.png',
        eta: '5 mins',
        sortOrder: 2,
      },
      {
        name: 'SUV',
        type: 'Large',
        pricePerKm: 18,
        seats: 7,
        image: 'https://cdn-icons-png.flaticon.com/512/3085/3085330.png',
        eta: '8 mins',
        sortOrder: 3,
      },
      {
        name: 'Luxury',
        type: 'Premium',
        pricePerKm: 25,
        seats: 4,
        image: '/luxury.png',
        eta: '12 mins',
        sortOrder: 4,
      },
    ],
  });

  const routeGeo = JSON.stringify([
    [28.6139, 77.209],
    [28.4595, 77.0266],
  ]);

  const b1 = await prisma.booking.create({
    data: {
      customerId: customer.id,
      pickupText: 'New Delhi Railway Station',
      dropText: 'Gurgaon Cyber City',
      pickupLat: 28.6139,
      pickupLng: 77.209,
      dropLat: 28.4595,
      dropLng: 77.0266,
      routeGeoJson: routeGeo,
      distanceKm: 25,
      fare: 420,
      carName: 'SUV',
      status: 'COMPLETED',
      bookingDate: '2026-05-11',
      bookingTime: '10:30',
      driverId: driverUser.id,
    },
  });

  await prisma.payment.createMany({
    data: [
      {
        bookingId: b1.id,
        customerName: 'Rahul Sharma',
        amount: 420,
        method: 'UPI',
        status: 'Completed',
        date: '22 May 2026',
      },
      {
        customerName: 'Priya Singh',
        amount: 120,
        method: 'Wallet',
        status: 'Completed',
        date: '22 May 2026',
      },
      {
        customerName: 'Amit Kumar',
        amount: 200,
        method: 'Cash',
        status: 'Pending',
        date: '23 May 2026',
      },
    ],
  });

  console.log('Seed OK', { superadmin: superadmin.phone, admin: admin.phone, driver: driverUser.phone });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
