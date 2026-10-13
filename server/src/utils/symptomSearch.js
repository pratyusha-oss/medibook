// Explicit search terms only: this helps people find a specialty and does not diagnose.
export const SYMPTOM_SPECIALTIES = Object.freeze({
  fever: ['general medicine', 'internal medicine', 'family medicine', 'general practice'],
  migraine: ['neurology'],
  'back pain': ['orthopaedics', 'orthopedics', 'musculoskeletal', 'physiotherapy'],
});

export function normalizeSymptom(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function specialtiesForSymptom(value) {
  return SYMPTOM_SPECIALTIES[normalizeSymptom(value)] || null;
}
