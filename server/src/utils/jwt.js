import jwt from 'jsonwebtoken';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a value at least 32 characters long');
  }
  return secret;
}

export function signAccessToken(user) {
  return jwt.sign({}, getJwtSecret(), {
    subject: user.id,
    issuer: 'medibook',
    expiresIn: '7d',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret(), { issuer: 'medibook' });
}
