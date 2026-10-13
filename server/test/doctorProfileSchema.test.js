import test from 'node:test';
import assert from 'node:assert/strict';
import { Doctor } from '../src/models/Doctor.js';

test('doctor schema accepts optional profile details and defaults fictional labeling off', () => {
  const doctor = new Doctor({
    user: '507f1f77bcf86cd799439011',
    specialty: 'Neurology',
    consultationFee: 800,
    qualification: 'Supplied qualification',
    registrationNumber: 'Supplied council identifier',
    languages: ['English', 'Hindi'],
    clinicAddress: 'OPD room supplied by profile owner',
  });
  assert.equal(doctor.validateSync(), undefined);
  assert.equal(doctor.isFictionalDemo, false);
});

test('doctor schema rejects profile fields beyond their documented length', () => {
  const doctor = new Doctor({
    user: '507f1f77bcf86cd799439011',
    specialty: 'Neurology',
    consultationFee: 800,
    qualification: 'x'.repeat(181),
  });
  assert.equal(doctor.validateSync().errors.qualification.kind, 'maxlength');
});
