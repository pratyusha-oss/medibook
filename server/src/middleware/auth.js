import { verifyAccessToken } from '../utils/jwt.js';
import { User } from '../models/User.js';

function unauthorized(res) {
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
}

export async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized(res);

  let payload;
  try {
    payload = verifyAccessToken(match[1]);
    if (typeof payload === 'string' || !payload.sub) return unauthorized(res);
  } catch {
    return unauthorized(res);
  }

  try {
    // A token only proves which account signed in. Reload its current role and active flag
    // so deactivation or a role change takes effect without waiting for token expiry.
    const user = await User.findById(payload.sub).select('name email role isActive');
    if (!user || !user.isActive) return unauthorized(res);

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this resource' } });
    }
    return next();
  };
}
