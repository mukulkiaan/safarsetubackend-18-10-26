/**
 * SMS Gateway Service
 * Supports:
 * 1. Fast2SMS (Indian SMS Gateway - easiest for OTPs in India)
 * 2. Twilio (Global SMS)
 * 3. Fallback: Terminal Log & Screen Display (when API key is not configured)
 */

export async function sendSmsOtp(phone, otp) {
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const fast2SmsKey = process.env.FAST2SMS_API_KEY;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

  // 1. If Fast2SMS API Key is present in .env
  if (fast2SmsKey && fast2SmsKey.trim()) {
    try {
      console.log(`📡 [SMS GATEWAY] Sending live SMS via Fast2SMS to +91${cleanPhone}...`);
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(fast2SmsKey.trim())}&route=otp&variables_values=${encodeURIComponent(otp)}&numbers=${encodeURIComponent(cleanPhone)}`;
      
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'cache-control': 'no-cache' },
      });
      const data = await res.json();
      console.log(`✅ [FAST2SMS RESPONSE]:`, data);

      if (data.return === true || data.status_code === 200) {
        return {
          success: true,
          gateway: 'Fast2SMS',
          message: 'SMS sent to mobile number',
        };
      } else {
        console.warn(`⚠️ [FAST2SMS WARNING]:`, data.message);
      }
    } catch (err) {
      console.error(`❌ [FAST2SMS ERROR]:`, err.message);
    }
  }

  // 2. If Twilio Credentials are present in .env
  if (twilioSid && twilioAuthToken && twilioFrom) {
    try {
      console.log(`📡 [SMS GATEWAY] Sending live SMS via Twilio to +91${cleanPhone}...`);
      const auth = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
      const bodyParams = new URLSearchParams({
        To: `+91${cleanPhone}`,
        From: twilioFrom,
        Body: `Your SafarSetu verification code is: ${otp}. Valid for 5 minutes. Do not share this OTP.`,
      });

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
      });
      const data = await res.json();
      if (data.sid) {
        console.log(`✅ [TWILIO SMS SENT] SID: ${data.sid}`);
        return { success: true, gateway: 'Twilio', message: 'SMS sent to mobile number' };
      }
    } catch (err) {
      console.error(`❌ [TWILIO ERROR]:`, err.message);
    }
  }

  // 3. Fallback: Real SMS Gateway is not yet configured in .env
  console.log(`ℹ️ [SMS GATEWAY SIMULATION] No FAST2SMS_API_KEY found in .env.`);
  console.log(`📲 Generated OTP for +91${cleanPhone} is: ${otp}`);
  return {
    success: false,
    gateway: 'SIMULATION',
    message: 'SMS gateway not configured in .env. Use the generated OTP displayed on screen.',
  };
}
