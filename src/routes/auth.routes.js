import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { signToken, authMiddleware } from '../auth.js';
import { sendSmsOtp } from '../services/sms.service.js';
import { sendWhatsAppOtp, isWhatsAppReady, getWhatsAppStatus } from '../services/whatsapp.service.js';

const router = Router();

// In-memory OTP storage: phone -> { otp, expiresAt }
const otpStore = new Map();

// Helper to sanitize phone number (extract last 10 digits)
function sanitizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// ── WHATSAPP BOT STATUS & QR VIEWER ──
router.get('/whatsapp/status', (_req, res) => {
  return res.json(getWhatsAppStatus());
});

router.get('/whatsapp/qr', (_req, res) => {
  const status = getWhatsAppStatus();
  if (status.ready) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>SafarSetu WhatsApp Bot - Active</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px 20px;background:#F5F1EA;">
        <div style="max-width:420px;margin:auto;background:white;padding:36px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,0.06);border:1px solid #EAE5DB;">
          <div style="font-size:56px;margin-bottom:12px;">✅</div>
          <h2 style="color:#15803D;margin:0 0 8px 0;font-weight:900;">WhatsApp Bot Connected!</h2>
          <p style="color:#666;font-size:14px;line-height:22px;margin:0;">SafarSetu WhatsApp OTP Engine is live. Real OTP messages will now be delivered directly to customers' WhatsApp chats.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (status.qrDataUrl) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Scan SafarSetu WhatsApp QR</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px 20px;background:#F5F1EA;">
        <div style="max-width:420px;margin:auto;background:white;padding:32px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,0.08);border:1px solid #EAE5DB;">
          <div style="font-size:40px;margin-bottom:8px;">📲</div>
          <h2 style="color:#111;margin:0 0 6px 0;font-weight:900;">Scan with WhatsApp</h2>
          <p style="color:#666;font-size:13px;line-height:20px;margin:0 0 16px 0;">Open WhatsApp on phone → Tap <b>3 Dots / Settings</b> → <b>Linked Devices</b> → <b>Link a Device</b> and point camera here:</p>
          <img src="${status.qrDataUrl}" style="width:260px;height:260px;margin:0 auto 16px auto;display:block;border-radius:16px;border:3px solid #E8B34B;" />
          <p style="color:#888;font-size:11px;margin:0;">⚡ Auto-refreshes every 4 seconds</p>
        </div>
        <script>setTimeout(() => window.location.reload(), 4000);</script>
      </body>
      </html>
    `);
  }

  return res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Initializing WhatsApp...</title><meta http-equiv="refresh" content="3"></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#F5F1EA;">
      <h3>Initializing SafarSetu WhatsApp Engine...</h3>
      <p style="color:#777;">Please wait 3 seconds...</p>
    </body>
    </html>
  `);
});

// ── SEND OTP ──
router.post('/send-otp', async (req, res) => {
  try {
    const rawPhone = req.body.phone;
    const phone = sanitizePhone(rawPhone);

    if (!phone || phone.length !== 10) {
      return res.status(400).json({ message: 'Valid 10-digit mobile number required' });
    }

    // Generate random 4-digit numeric code
    const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

    // 1. If WhatsApp Bot is connected -> Deliver directly to real WhatsApp & BLOCK FAKE NUMBERS
    if (isWhatsAppReady()) {
      const waResult = await sendWhatsAppOtp(phone, generatedOtp);
      if (!waResult.success) {
        return res.status(400).json({
          success: false,
          message: waResult.message,
        });
      }

      otpStore.set(phone, { otp: generatedOtp, expiresAt });
      return res.json({
        success: true,
        channel: 'WHATSAPP',
        message: 'OTP aapke WhatsApp par bhej diya gaya hai! Kripya WhatsApp message check karein.',
        phone,
        expiresIn: 300,
      });
    }

    // 2. If WhatsApp bot is not yet linked, fallback to SMS / screen code
    otpStore.set(phone, { otp: generatedOtp, expiresAt });
    console.log(`📲 [FALLBACK OTP GENERATED] Phone: ${phone} -> OTP: ${generatedOtp}`);

      const serverUrl = process.env.APP_URL || 'https://safarsetubackend-18-10-26.onrender.com';
      return res.json({
        success: true,
        channel: 'SCREEN_FALLBACK',
        message: `WhatsApp Bot connect nahi hai. QR scan karne ke liye ${serverUrl}/api/auth/whatsapp/qr kholein.`,
        phone,
        otp: generatedOtp,
        expiresIn: 300,
      });
  } catch (e) {
    console.error('SEND_OTP_ERROR:', e);
    return res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// ── VERIFY OTP & AUTO-LOGIN / REGISTER ──
router.post('/verify-otp', async (req, res) => {
  try {
    const { otp } = req.body;
    const phone = sanitizePhone(req.body.phone);

    if (!phone || !otp) {
      return res.status(400).json({ message: 'Phone and OTP are required' });
    }

    const stored = otpStore.get(phone);

    if (!stored) {
      return res.status(400).json({ message: 'No OTP requested for this number, or it has expired. Please request a new OTP.' });
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(phone);
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    const enteredOtp = String(otp).trim();
    if (stored.otp !== enteredOtp) {
      return res.status(400).json({ message: 'Incorrect OTP. Please enter the exact code shown on screen or received via SMS.' });
    }

    // Clean up stored OTP once verified
    otpStore.delete(phone);

    // Find existing customer
    let user = await prisma.user.findFirst({
      where: { phone, role: 'CUSTOMER', deleted: false },
    });

    // If new customer, auto-register without requiring signup form
    if (!user) {
      const defaultPassword = Math.random().toString(36).slice(-8);
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      const defaultName = `Rider ${phone.slice(-4)}`;

      user = await prisma.user.create({
        data: {
          phone,
          passwordHash,
          name: defaultName,
          role: 'CUSTOMER',
          location: 'Barwani, Madhya Pradesh',
        },
      });
      console.log(`✅ [NEW CUSTOMER CREATED] Phone: ${phone}, Name: ${user.name}`);
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role.toLowerCase(),
        name: user.name || `Rider ${user.phone.slice(-4)}`,
        location: user.location || '',
        whatsapp: user.whatsapp || '',
      },
    });
  } catch (e) {
    console.error('VERIFY_OTP_ERROR:', e);
    return res.status(500).json({ message: 'Server error during OTP verification' });
  }
});

// ── FIREBASE PHONE AUTH LOGIN & AUTO-REGISTRATION ──
router.post('/firebase-login', async (req, res) => {
  try {
    const rawPhone = req.body.phone;
    const phone = sanitizePhone(rawPhone);

    if (!phone || phone.length !== 10) {
      return res.status(400).json({ message: 'Valid 10-digit phone number required' });
    }

    // Find existing customer
    let user = await prisma.user.findFirst({
      where: { phone, role: 'CUSTOMER', deleted: false },
    });

    let isNewUser = false;
    // If new customer, auto-register
    if (!user) {
      isNewUser = true;
      const defaultPassword = Math.random().toString(36).slice(-8);
      const passwordHash = await bcrypt.hash(defaultPassword, 10);
      const defaultName = `Rider ${phone.slice(-4)}`;

      user = await prisma.user.create({
        data: {
          phone,
          passwordHash,
          name: defaultName,
          role: 'CUSTOMER',
          location: 'Barwani, Madhya Pradesh',
        },
      });
      console.log(`✅ [FIREBASE AUTH: NEW CUSTOMER CREATED] Phone: ${phone}, Name: ${user.name}`);
    } else {
      console.log(`✅ [FIREBASE AUTH: RETURNING CUSTOMER] Phone: ${phone}, Name: ${user.name}`);
    }

    const token = signToken(user);
    return res.json({
      token,
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role.toLowerCase(),
        name: user.name || `Rider ${user.phone.slice(-4)}`,
        location: user.location || '',
        whatsapp: user.whatsapp || '',
      },
    });
  } catch (e) {
    console.error('FIREBASE_LOGIN_ERROR:', e);
    return res.status(500).json({ message: 'Server error during Firebase login' });
  }
});

// ── GET CURRENT USER PROFILE ──
router.get('/me', authMiddleware(['CUSTOMER', 'DRIVER', 'ADMIN', 'SUPERADMIN']), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      include: { driverProfile: true },
    });
    if (!user || user.deleted) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({
      id: user.id,
      phone: user.phone,
      role: user.role.toLowerCase(),
      name: user.name,
      location: user.location || '',
      whatsapp: user.whatsapp || '',
      driverProfile: user.driverProfile || null,
    });
  } catch (e) {
    console.error('GET_ME_ERROR:', e);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// ── UPDATE CUSTOMER / USER PROFILE ──
router.patch('/profile', authMiddleware(['CUSTOMER', 'DRIVER', 'ADMIN']), async (req, res) => {
  try {
    const { name, location, whatsapp } = req.body;
    const updateData = {};
    if (name && name.trim()) updateData.name = name.trim();
    if (location !== undefined) updateData.location = location;
    if (whatsapp !== undefined) updateData.whatsapp = whatsapp;

    const updated = await prisma.user.update({
      where: { id: req.auth.sub },
      data: updateData,
    });

    return res.json({
      success: true,
      user: {
        id: updated.id,
        phone: updated.phone,
        role: updated.role.toLowerCase(),
        name: updated.name,
        location: updated.location || '',
        whatsapp: updated.whatsapp || '',
      },
    });
  } catch (e) {
    console.error('UPDATE_PROFILE_ERROR:', e);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
});

// ── STANDARD LOGIN (FOR ADMIN, SUPERADMIN, DRIVER) ──
router.post('/login', async (req, res) => {
  try {
    const { phone: rawPhone, password } = req.body;
    if (!rawPhone || !password) {
      return res.status(400).json({ message: 'phone and password required' });
    }

    const input = String(rawPhone).trim();
    const cleanDigits = input.replace(/\D/g, '');
    const clean10 = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;

    let user = null;

    if (input.toLowerCase() === 'admin') {
      user = await prisma.user.findFirst({ where: { role: 'ADMIN', deleted: false } });
    } else if (input.toLowerCase() === 'superadmin') {
      user = await prisma.user.findFirst({ where: { role: 'SUPERADMIN', deleted: false } });
    } else {
      user = await prisma.user.findFirst({
        where: {
          deleted: false,
          OR: [
            { phone: input },
            ...(clean10 ? [{ phone: clean10 }] : []),
            ...(cleanDigits ? [{ phone: cleanDigits }] : []),
            { name: { equals: input } },
          ],
        },
      });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify password via bcrypt hash or plain fallback
    const ok = (await bcrypt.compare(password, user.passwordHash)) || (user.plainPassword && user.plainPassword === password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    if (user.role === 'DRIVER') {
      const p = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
      if (!p || p.approvalStatus !== 'APPROVED') {
        return res.status(403).json({ message: 'Driver registration is pending admin approval.' });
      }
    }

    const token = signToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role.toLowerCase(),
        name: user.name || user.phone,
        location: user.location || '',
        whatsapp: user.whatsapp || '',
      },
    });
  } catch (e) {
    console.error('LOGIN_ERROR:', e);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

// ── STANDARD REGISTER (FOR DRIVER OR CUSTOMER FALLBACK) ──
router.post('/register', async (req, res) => {
  try {
    const {
      phone,
      password,
      name,
      location,
      role,
      carType,
      vehicleNumber,
      vehiclePhotoUrl,
      licensePhotoUrl,
    } = req.body;

    if (!phone || !password || !name || !role) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const r = role.toUpperCase();
    if (r !== 'CUSTOMER' && r !== 'DRIVER') {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const cleanDigits = String(phone).replace(/\D/g, '');
    const clean10 = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const phoneWithPlus91 = `+91${clean10}`;

    const exists = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: clean10 },
          { phone: phoneWithPlus91 },
          { phone: String(phone).trim() },
        ],
      },
    });

    if (exists) {
      if (r === 'DRIVER') {
        const passwordHash = await bcrypt.hash(password, 10);
        const updated = await prisma.user.update({
          where: { id: exists.id },
          data: {
            role: 'DRIVER',
            phone: clean10,
            name: name || exists.name,
            passwordHash,
            plainPassword: password,
            location: location || exists.location,
            driverProfile: {
              upsert: {
                create: {
                  carType: carType || 'Mini',
                  vehicleNumber: vehicleNumber || 'NA',
                  vehiclePhotoUrl: vehiclePhotoUrl || null,
                  licensePhotoUrl: licensePhotoUrl || null,
                  approvalStatus: 'PENDING',
                },
                update: {
                  carType: carType || 'Mini',
                  vehicleNumber: vehicleNumber || 'NA',
                  vehiclePhotoUrl: vehiclePhotoUrl || null,
                  licensePhotoUrl: licensePhotoUrl || null,
                  approvalStatus: 'PENDING',
                },
              },
            },
          },
        });

        const finalCarName = carType || 'Mini';
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

        return res.json({
          message: 'Application submitted! SafarSetu admin will review and approve shortly.',
          user: { id: updated.id, phone: updated.phone, role: 'driver', name: updated.name },
        });
      }
      return res.status(409).json({ message: 'Phone number already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        phone: clean10,
        passwordHash,
        plainPassword: password,
        name,
        location: location || null,
        role: r,
        ...(r === 'DRIVER' && {
          driverProfile: {
            create: {
              carType: carType || 'Mini',
              vehicleNumber: vehicleNumber || 'NA',
              vehiclePhotoUrl: vehiclePhotoUrl || null,
              licensePhotoUrl: licensePhotoUrl || null,
              approvalStatus: 'PENDING',
            },
          },
        }),
      },
    });

    if (r === 'CUSTOMER') {
      const token = signToken(user);
      return res.json({
        token,
        user: { id: user.id, phone: user.phone, role: 'customer', name: user.name, location: user.location || '' },
      });
    }

    const finalCarName = carType || 'Mini';
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

    return res.json({
      message: 'Registered. Admin will verify driver soon.',
      user: { id: user.id, phone: user.phone, role: 'driver', name: user.name },
    });
  } catch (e) {
    console.error('REGISTER_ENDPOINT_ERROR:', e);
    return res.status(500).json({ message: e.message || 'Server error during registration' });
  }
});

export default router;

