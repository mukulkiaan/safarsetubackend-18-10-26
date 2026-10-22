import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.join(__dirname, '../../whatsapp-session');

let sock = null;
let isReady = false;
let latestQr = null;
let latestQrDataUrl = null;
let isInitializing = false;

export async function initWhatsApp() {
  if (isInitializing) return;
  isInitializing = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['SafarSetu Transport', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => jid?.endsWith('@g.us') || jid?.includes('broadcast'),
      getMessage: async () => undefined,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
        try {
          latestQrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          latestQrDataUrl = null;
        }

        console.log('\n======================================================');
        const serverUrl = process.env.APP_URL || 'https://safarsetubackend-18-10-26.onrender.com';
        console.log(`Or Open In Browser: ${serverUrl}/api/auth/whatsapp/qr`);
        console.log('======================================================\n');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (e) {
          // Terminal formatting fallback
        }
      }

      if (connection === 'open') {
        isReady = true;
        latestQr = null;
        latestQrDataUrl = null;
        console.log('\n======================================================');
        console.log('✅ [WHATSAPP BOT CONNECTED] SafarSetu WhatsApp OTP Engine is LIVE!');
        console.log('======================================================\n');
      }

      if (connection === 'close') {
        isReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ [WHATSAPP BOT DISCONNECTED] Status: ${statusCode || 'Unknown'}. Reconnecting: ${shouldReconnect}`);
        isInitializing = false;

        if (shouldReconnect) {
          setTimeout(initWhatsApp, 4000);
        } else {
          console.log('❌ [WHATSAPP BOT LOGGED OUT] Please restart and scan a new QR code.');
        }
      }
    });
  } catch (err) {
    console.error('❌ [WHATSAPP INIT ERROR]:', err.message);
    isInitializing = false;
  }
}

export function isWhatsAppReady() {
  return isReady;
}

export function getWhatsAppStatus() {
  return {
    ready: isReady,
    qr: latestQr,
    qrDataUrl: latestQrDataUrl,
  };
}

export async function sendWhatsAppOtp(phone, otp) {
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

  if (!cleanPhone || cleanPhone.length < 10) {
    return {
      success: false,
      reason: 'INVALID_PHONE',
      message: 'Kripya sahi 10-digit mobile number enter karein.',
    };
  }

  if (!isReady || !sock) {
    return {
      success: false,
      reason: 'BOT_NOT_CONNECTED',
      message: 'WhatsApp Bot abhi connect nahi hai. Kripya pehle QR scan karein.',
    };
  }

  try {
    const jid = `91${cleanPhone}@s.whatsapp.net`;

    // 🛡️ FAKE NUMBER CHECK: Check if this phone number exists on WhatsApp
    const results = await sock.onWhatsApp(jid);
    const targetUser = Array.isArray(results) ? results[0] : null;

    if (!targetUser || !targetUser.exists) {
      console.warn(`🛑 [FAKE NUMBER REJECTED] Phone +91${cleanPhone} is NOT on WhatsApp!`);
      return {
        success: false,
        reason: 'NUMBER_NOT_ON_WHATSAPP',
        message: 'Yeh mobile number WhatsApp par exist nahi karta! Kripya apna valid active mobile number daalein.',
      };
    }

    // Message template
    const textMessage =
      `🚖 *SAFARSETU VERIFICATION CODE*\n\n` +
      `Namaste! SafarSetu me login karne ke liye aapka OTP hai:\n` +
      `👉 *${otp}*\n\n` +
      `⏱️ Yeh code 5 minute ke liye valid hai.\n` +
      `⚠️ Suraksha ke liye ise kisi ke sath share na karein.`;

    await sock.sendMessage(targetUser.jid, { text: textMessage });
    console.log(`✅ [WHATSAPP OTP DELIVERED] Successfully sent OTP ${otp} to +91${cleanPhone}`);

    return {
      success: true,
      message: 'OTP aapke WhatsApp par bhej diya gaya hai!',
    };
  } catch (err) {
    console.error(`❌ [WHATSAPP SEND ERROR for +91${cleanPhone}]:`, err.message);
    return {
      success: false,
      reason: 'DELIVERY_FAILED',
      message: 'WhatsApp par message bhejne me samasya aayi. Kripya dobara koshish karein.',
    };
  }
}
