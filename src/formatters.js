const UI_STATUS = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function getBookingOtp(id) {
  if (!id) return '4821';
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum = (sum * 31 + id.charCodeAt(i)) % 10000;
  }
  const otpVal = 1000 + (Math.abs(sum) % 9000);
  return String(otpVal);
}

export function bookingToJson(b) {
  const driverProfile = b.driver?.driverProfile;
  return {
    id: b.id,
    customer: b.customer?.name || 'Customer',
    phone: b.customer?.phone || '',
    pickup: b.pickupText,
    drop: b.dropText,
    date: b.bookingDate,
    time: b.bookingTime,
    distance: `${Number(b.distanceKm).toFixed(1)} km`,
    fare: Math.round(b.fare),
    car: b.carName,
    status: UI_STATUS[b.status] || b.status,
    otp: getBookingOtp(b.id),
    driverUserId: b.driverId || null,
    driver:
      b.driver && driverProfile
        ? {
            name: b.driver.name,
            phone: b.driver.phone,
            vehicleName: driverProfile.carType,
            vehicleNumber: driverProfile.vehicleNumber,
          }
        : b.driver
          ? {
              name: b.driver.name,
              phone: b.driver.phone,
              vehicleName: b.carName,
              vehicleNumber: '',
            }
          : null,
    routeCoords: b.routeGeoJson ? JSON.parse(b.routeGeoJson) : null,
    pickupLat: b.pickupLat,
    pickupLng: b.pickupLng,
    dropLat: b.dropLat,
    dropLng: b.dropLng,
  };
}

export const STATUS_FROM_UI = {
  Pending: 'PENDING',
  Assigned: 'ASSIGNED',
  Accepted: 'ACCEPTED',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
};
