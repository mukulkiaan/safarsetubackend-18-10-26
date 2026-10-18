import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-in-production';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(requiredRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ message: 'Invalid token' });
    if (requiredRoles?.length && !requiredRoles.includes(payload.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.auth = payload;
    next();
  };
}
