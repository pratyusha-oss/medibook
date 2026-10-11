const LOCAL_CLIENT_ORIGIN = 'http://localhost:5173';

export function getAllowedClientOrigins({
  clientUrl = process.env.CLIENT_URL,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const production = nodeEnv?.trim().toLowerCase() === 'production';
  const configuredOrigins = typeof clientUrl === 'string'
    ? clientUrl.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];

  if (configuredOrigins.length === 0) {
    if (production) throw new Error('CLIENT_URL is required in production.');
    return [LOCAL_CLIENT_ORIGIN];
  }

  const origins = [...new Set(configuredOrigins)];
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CLIENT_URL must contain valid frontend origin URLs.');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      (production && parsed.protocol !== 'https:')
    ) {
      throw new Error('CLIENT_URL must contain exact origin URLs; production origins must use HTTPS.');
    }
  }

  return origins;
}
