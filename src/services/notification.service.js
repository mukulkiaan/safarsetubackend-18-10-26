import prisma from '../prisma.js';

// In-memory log of recent notifications for in-app alert fallback
const recentNotifications = [];

/**
 * Send push notification via Expo Push Notification Service
 * Works on Android & iOS without any third-party paid service
 */
export async function sendExpoPushNotification({ tokens, title, body, data = {}, sound = 'default' }) {
  if (!tokens) return { success: false, reason: 'No tokens provided' };
  
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const validTokens = tokenList.filter(
    (t) => typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))
  );

  // Store in recent notifications for in-app polling/alert fallback
  const notifObj = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    title,
    body,
    data,
    createdAt: new Date().toISOString(),
  };
  recentNotifications.unshift(notifObj);
  if (recentNotifications.length > 100) recentNotifications.pop();

  if (validTokens.length === 0) {
    console.log(`[Notification Logged In-App Only]: ${title} - ${body}`);
    return { success: true, delivered: 0, inAppOnly: true };
  }

  const messages = validTokens.map((token) => ({
    to: token,
    sound,
    title,
    body,
    data,
    priority: 'high',
    channelId: 'safarsetu_default',
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    console.log(`[Expo Push Sent] to ${validTokens.length} devices:`, result?.data?.length || 0);
    return { success: true, result };
  } catch (error) {
    console.error('[Expo Push Error]:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 1. Admin Alert: First-Time Customer Registration / Visit
 */
export async function notifyAdminNewCustomer(customer) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPERADMIN'] },
        expoPushToken: { not: null },
      },
      select: { expoPushToken: true },
    });

    const tokens = admins.map((a) => a.expoPushToken).filter(Boolean);
    const title = '🎉 Naya Customer Aaya!';
    const body = `${customer.name || 'Naya Rider'} (${customer.phone}) ne pehli baar SafarSetu khola! Call karke booking offer karein.`;

    return await sendExpoPushNotification({
      tokens,
      title,
      body,
      data: { type: 'NEW_CUSTOMER', customerId: customer.id, phone: customer.phone },
    });
  } catch (e) {
    console.error('notifyAdminNewCustomer Error:', e.message);
  }
}

/**
 * 2. Admin Alert: New Ride Request Created by Customer
 */
export async function notifyAdminNewBooking(booking, customerName) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPERADMIN'] },
        expoPushToken: { not: null },
      },
      select: { expoPushToken: true },
    });

    const tokens = admins.map((a) => a.expoPushToken).filter(Boolean);
    const title = '🚖 Nayi Ride Request Aayi!';
    const body = `${customerName || 'Customer'}: ${booking.pickupText} ➔ ${booking.dropText} (${booking.distanceKm || 'XX'} KM) - ${booking.carName}`;

    return await sendExpoPushNotification({
      tokens,
      title,
      body,
      data: { type: 'NEW_BOOKING', bookingId: booking.id },
    });
  } catch (e) {
    console.error('notifyAdminNewBooking Error:', e.message);
  }
}

/**
 * 3. Admin Alert: Advance Payment Received from Customer
 */
export async function notifyAdminAdvancePayment(booking) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPERADMIN'] },
        expoPushToken: { not: null },
      },
      select: { expoPushToken: true },
    });

    const tokens = admins.map((a) => a.expoPushToken).filter(Boolean);
    const title = '💳 Advance Payment Received!';
    const body = `Booking #${booking.id?.slice(-4)}: Customer ne ₹${booking.advancePaid || 200} advance pay kiya (UTR: ${booking.advanceUtr || 'Submitted'}). Verify karein!`;

    return await sendExpoPushNotification({
      tokens,
      title,
      body,
      data: { type: 'ADVANCE_PAID', bookingId: booking.id },
    });
  } catch (e) {
    console.error('notifyAdminAdvancePayment Error:', e.message);
  }
}

/**
 * 4. Driver Alert: New Ride Assigned by Admin
 */
export async function notifyDriverNewAssignment(driverId, booking) {
  try {
    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      select: { expoPushToken: true, name: true },
    });

    if (!driver?.expoPushToken) {
      console.log(`Driver ${driverId} does not have push token registered`);
      return;
    }

    const title = '🚨 Nayi Ride Assignment!';
    const body = `${booking.pickupText} ➔ ${booking.dropText} (${booking.distanceKm} KM). Tap karke ride details dekhein!`;

    return await sendExpoPushNotification({
      tokens: [driver.expoPushToken],
      title,
      body,
      data: { type: 'NEW_ASSIGNMENT', bookingId: booking.id },
    });
  } catch (e) {
    console.error('notifyDriverNewAssignment Error:', e.message);
  }
}

/**
 * 5. Customer Alert: Driver Assigned
 */
export async function notifyCustomerDriverAssigned(booking, driverName, carNumber) {
  try {
    const customer = await prisma.user.findUnique({
      where: { id: booking.customerId },
      select: { expoPushToken: true },
    });

    if (!customer?.expoPushToken) return;

    const title = '🚖 Driver Confirm Ho Gaya!';
    const body = `${driverName || 'Elite Driver'} (${carNumber || 'SafarSetu Cab'}) aapko pick karne ke liye assign ho gaye hain!`;

    return await sendExpoPushNotification({
      tokens: [customer.expoPushToken],
      title,
      body,
      data: { type: 'DRIVER_ASSIGNED', bookingId: booking.id },
    });
  } catch (e) {
    console.error('notifyCustomerDriverAssigned Error:', e.message);
  }
}

/**
 * 6. Customer Alert: Trip Status Update (Arrived / Started / Completed)
 */
export async function notifyCustomerTripStatus(customerId, bookingId, status) {
  try {
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      select: { expoPushToken: true },
    });

    if (!customer?.expoPushToken) return;

    let title = 'SafarSetu Trip Update';
    let body = 'Aapki ride status update hui hai.';

    if (status === 'ARRIVED') {
      title = '📍 Driver Arrived!';
      body = 'Aapka driver pickup location par pahunch chuka hai.';
    } else if (status === 'STARTED') {
      title = '🚀 Ride Started!';
      body = 'Aapka Safar shuru ho chuka hai. Shubh Yatra!';
    } else if (status === 'COMPLETED') {
      title = '🏁 Ride Completed!';
      body = 'Aap manzil par pahunch gaye hain. SafarSetu se judne ke liye dhanyawad!';
    }

    return await sendExpoPushNotification({
      tokens: [customer.expoPushToken],
      title,
      body,
      data: { type: 'STATUS_UPDATE', bookingId, status },
    });
  } catch (e) {
    console.error('notifyCustomerTripStatus Error:', e.message);
  }
}

/**
 * Get recent in-app notifications
 */
export function getRecentNotifications() {
  return recentNotifications;
}
