import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { validateLogin, validateRegistration } from '../utils/authValidation.js';
import { signAccessToken } from '../utils/jwt.js';

const router = Router();
const SALT_ROUNDS = 12;

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function invalidInput(res, message) {
  return res.status(400).json({ error: { code: 'INVALID_INPUT', message } });
}

router.post('/register', async (req, res, next) => {
  const result = validateRegistration(req.body);
  if (result.error) return invalidInput(res, result.error);

  try {
    const { name, email, password } = result.value;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, role: 'patient' });
    return res.status(201).json({ user: publicUser(user), token: signAccessToken(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists' } });
    }
    return next(error);
  }
});

router.post('/login', async (req, res) => {
  const result = validateLogin(req.body);
  if (result.error) return invalidInput(res, result.error);

  const user = await User.findOne({ email: result.value.email }).select('+passwordHash');
  const passwordMatches = user && await bcrypt.compare(result.value.password, user.passwordHash);
  if (!passwordMatches || !user.isActive) {
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } });
  }

  return res.json({ user: publicUser(user), token: signAccessToken(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
