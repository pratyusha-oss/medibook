const PROFILE_TEXT_FIELDS = {
  qualification: 180,
  registrationNumber: 100,
  clinicAddress: 300,
};

export function validateAdditionalDoctorFields(input, { allowDemoFlag = false } = {}) {
  const fields = ['qualification', 'registrationNumber', 'languages', 'clinicAddress'];
  if (allowDemoFlag) fields.push('isFictionalDemo');
  const update = {};

  for (const [field, maxLength] of Object.entries(PROFILE_TEXT_FIELDS)) {
    if (!Object.hasOwn(input, field)) continue;
    if (typeof input[field] !== 'string' || input[field].trim().length > maxLength) {
      return { error: `${field} must be a string of ${maxLength} characters or fewer` };
    }
    update[field] = input[field].trim();
  }

  if (Object.hasOwn(input, 'languages')) {
    if (!Array.isArray(input.languages) || input.languages.length > 20 || input.languages.some((language) => typeof language !== 'string' || !language.trim() || language.trim().length > 50)) {
      return { error: 'languages must be a list of up to 20 language names, each 50 characters or fewer' };
    }
    update.languages = [...new Set(input.languages.map((language) => language.trim()))];
  }

  if (Object.hasOwn(input, 'isFictionalDemo')) {
    if (!allowDemoFlag || typeof input.isFictionalDemo !== 'boolean') {
      return { error: 'isFictionalDemo must be a boolean set by an administrator' };
    }
    update.isFictionalDemo = input.isFictionalDemo;
  }

  return { value: update, allowedFields: fields };
}
