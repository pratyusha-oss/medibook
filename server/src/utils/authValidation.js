const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

export function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Request body must be an object' };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (name.length < 2 || name.length > 100) {
    return { error: 'Name must be between 2 and 100 characters' };
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { error: 'Enter a valid email address' };
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
    return { error: 'Password must be at least 8 characters and no more than 72 bytes' };
  }

  return { value: { name, email, password } };
}

export function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Request body must be an object' };
  }

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (email.length > 254 || !EMAIL_PATTERN.test(email) || password.length === 0) {
    return { error: 'Email or password is incorrect' };
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
    return { error: 'Email or password is incorrect' };
  }

  return { value: { email, password } };
}
