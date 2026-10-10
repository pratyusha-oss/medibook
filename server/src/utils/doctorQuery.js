const MAX_PAGE = 1000;
const MAX_FEE = 1_000_000;

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseDoctorListQuery(query) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const specialty = typeof query.specialty === 'string' ? query.specialty.trim() : '';
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 12 : Number(query.limit);
  const feeMax = query.feeMax === undefined ? undefined : Number(query.feeMax);

  if (q.length > 80 || specialty.length > 80) {
    return { error: 'Search and specialty values must be 80 characters or fewer' };
  }
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return { error: `Page must be an integer between 1 and ${MAX_PAGE}` };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { error: 'Limit must be an integer between 1 and 50' };
  }
  if (feeMax !== undefined && (!Number.isFinite(feeMax) || feeMax < 0 || feeMax > MAX_FEE)) {
    return { error: `feeMax must be a number between 0 and ${MAX_FEE}` };
  }

  return { value: { q, specialty, page, limit, feeMax } };
}
