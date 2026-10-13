import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDoctorDirectoryFilter, parseDoctorListQuery } from '../src/utils/doctorQuery.js';
import { specialtiesForSymptom } from '../src/utils/symptomSearch.js';

test('symptom search uses the explicit specialty map and accepts empty or unknown terms safely', () => {
  assert.deepEqual(specialtiesForSymptom(' Fever '), ['general medicine', 'internal medicine', 'family medicine', 'general practice']);
  assert.deepEqual(specialtiesForSymptom('MIGRAINE'), ['neurology']);
  assert.ok(specialtiesForSymptom('back   pain').includes('orthopaedics'));
  assert.equal(specialtiesForSymptom(''), null);
  assert.equal(specialtiesForSymptom('unlisted symptom'), null);
});

test('directory query validation bounds symptom input and combined filters remain conjunctive', () => {
  assert.match(parseDoctorListQuery({ symptom: 'x'.repeat(81) }).error, /80 characters/);
  const parsed = parseDoctorListQuery({ q: 'desai', symptom: 'migraine', specialty: 'neurology', feeMax: '800' });
  assert.equal(parsed.value.symptom, 'migraine');
  const filter = buildDoctorDirectoryFilter({
    activeDoctorIds: ['active-doctor'], matchingUserIds: ['named-doctor'], q: parsed.value.q,
    specialty: parsed.value.specialty, symptomSpecialties: specialtiesForSymptom(parsed.value.symptom), feeMax: parsed.value.feeMax,
  });
  assert.deepEqual(filter.user.$in, ['active-doctor']);
  assert.equal(filter.consultationFee.$lte, 800);
  assert.equal(filter.$and.length, 3);
  assert.equal(filter.$and[0].$or[2].user.$in[0], 'named-doctor');
  assert.equal(filter.$and[1].specialty.source, 'neurology');
  assert.equal(filter.$and[2].$or[0].specialty.source, '^neurology$');
  assert.deepEqual(buildDoctorDirectoryFilter({ activeDoctorIds: [], symptomSpecialties: [] }).$and[0]._id.$in, []);
});
