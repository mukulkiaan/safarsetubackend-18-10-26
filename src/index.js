import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import prisma from './prisma.js';
import authRoutes from './routes/auth.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import adminRoutes from './routes/admin.routes.js';
import superadminRoutes from './routes/superadmin.routes.js';
import mapsRoutes from './routes/maps.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import { initWhatsApp } from './services/whatsapp.service.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Railway/Proxy support
app.set('trust proxy', 1);

// Flexible CORS for Local + Production
const allowedOrigins = [
  'http://localhost:5173',
  'https://cab-book-barwani.netlify.app',
  process.env.CORS_ORIGIN
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health Check & Root Routes for Railway
app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    message: 'SafarSetu API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/test', async (_req, res) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ ok: true, database: 'connected', users: userCount });
  } catch (error) {
    res.status(500).json({ ok: false, database: 'error', error: error.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/admin', adminRoutes); // Admin stats & CRUD routes
app.use('/api/superadmin', superadminRoutes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global Error Handler
app.use((err, _req, res, _next) => {
  console.error('SERVER_ERROR:', err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🔗 Allowed Origins: ${allowedOrigins.join(', ')}`);
  
  // Test DB connection on startup
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }

  // Initialize SafarSetu WhatsApp OTP Engine
  try {
    initWhatsApp();
  } catch (err) {
    console.warn('⚠️ WhatsApp initialization notice:', err.message);
  }
});
