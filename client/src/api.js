const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const TOKEN_KEY = 'medibook.accessToken';

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Unable to reach MediBook. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(error.message || `Request failed (${response.status})`, response.status, error.code || 'REQUEST_FAILED', error.details);
  }
  return payload;
}

export function formatApiError(error) {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'EMAIL_IN_USE') return 'An account with this email already exists. Try signing in instead.';
    if (error.status === 401 && error.code === 'INVALID_CREDENTIALS') return 'That email and password do not match. Please try again.';
    if (error.status === 409 && error.code === 'AVAILABILITY_CONFLICT') return error.message;
    if (error.status === 409 && ['SLOT_UNAVAILABLE', 'BOOKING_CONFLICT'].includes(error.code)) return 'That appointment slot was just taken. We refreshed availability; please choose another time.';
    if (error.status === 0) return error.message;
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
