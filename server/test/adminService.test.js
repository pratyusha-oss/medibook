import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/middleware/auth.js';
import { AdminServiceError, createAdminService } from '../src/services/adminService.js';

const userId = '507f1f77bcf86cd799439011';
const doctorId = '507f191e810c19729de860ea';
const appointmentId = '507f191e810c19729de860ec';

function authGuardFor(role) {
  const middleware = requireRole('admin');
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let nextCalled = false;
  middleware({ user: { role } }, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

function modelHarness({ doctorCreate, userCreate, appointments = [] } = {}) {
  const calls = { usersCreated: [], profilesCreated: [], deleted: [], profilesDeleted: [], userUpdates: [] };
  const user = { _id: userId, id: userId, name: 'Dr. Ada Example', email: 'ada@example.test', role: 'doctor', isActive: true };
  const doctor = {
    _id: doctorId, id: doctorId, user, specialty: 'Cardiology', consultationFee: 700, bio: '',
    timezone: 'Asia/Kolkata', availability: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
    async populate() { return this; },
  };
  const User = {
    async create(input) {
      calls.usersCreated.push(input);
      if (userCreate) return userCreate(input);
      return { ...user, ...input, _id: userId, id: userId };
    },
    async deleteOne(filter) { calls.deleted.push(filter); },
    find(query) {
      return { distinct: async () => query.isActive === false ? [] : [userId] };
    },
    async findByIdAndUpdate(id, update) {
      calls.userUpdates.push({ id, update });
      return { ...user, isActive: update.$set.isActive };
    },
  };
  const Doctor = {
    async create(input) {
      calls.profilesCreated.push(input);
      if (doctorCreate) return doctorCreate(input);
      return { ...doctor, ...input, user: { ...user, _id: input.user }, async populate() { return this; } };
    },
    find(filter) {
      const records = filter.user?.$in?.length === 0 ? [] : [doctor];
      return {
        populate() { return this; }, sort() { return this; }, skip() { return this; }, limit: async () => records,
      };
    },
    async deleteOne(filter) { calls.profilesDeleted.push(filter); },
    countDocuments: async () => 1,
    findById() { return { populate: async () => ({ ...doctor, user: { ...user, _id: userId } }) }; },
  };
  const Appointment = {
    find() { return { select() { return this; }, sort: async () => appointments }; },
  };
  return { service: createAdminService({ User, Doctor, Appointment, hashPassword: async (password) => `hashed:${password}` }), calls };
}

test('admin route role guard rejects patients and doctors while permitting admins', () => {
  for (const role of ['patient', 'doctor']) {
    const result = authGuardFor(role);
    assert.equal(result.response.statusCode, 403);
    assert.equal(result.response.body.error.code, 'FORBIDDEN');
    assert.equal(result.nextCalled, false);
  }
  assert.equal(authGuardFor('admin').nextCalled, true);
});

test('doctor provisioning creates linked active doctor records and omits credentials from response', async () => {
  const { service, calls } = modelHarness();
  const result = await service.createDoctor({
    name: 'Dr. Ada Example', email: 'ada@example.test', password: 'temporary-pass-123', role: 'admin',
    specialty: 'Cardiology', consultationFee: 700, bio: 'Cardiology care', timezone: 'Asia/Kolkata',
    availability: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
  });
  assert.equal(calls.usersCreated[0].role, 'doctor');
  assert.equal(calls.usersCreated[0].passwordHash, 'hashed:temporary-pass-123');
  assert.equal(Object.hasOwn(calls.usersCreated[0], 'password'), false);
  assert.equal(String(calls.profilesCreated[0].user), userId);
  assert.equal(result.doctor.user.id, userId);
  assert.equal(result.doctor.user.isActive, true);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.equal(JSON.stringify(result).includes('hashed:'), false);
});

test('duplicate email maps to 409 without creating a profile', async () => {
  const { service, calls } = modelHarness({ userCreate: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); } });
  await assert.rejects(service.createDoctor({ name: 'Dr. Ada Example', email: 'ada@example.test', password: 'temporary-pass-123', specialty: 'Cardiology', consultationFee: 700 }),
    (error) => error instanceof AdminServiceError && error.status === 409 && error.code === 'EMAIL_IN_USE');
  assert.equal(calls.profilesCreated.length, 0);
});

test('failed profile creation compensates by removing the newly created login account', async () => {
  const { service, calls } = modelHarness({ doctorCreate: async () => { throw new Error('profile write failed'); } });
  await assert.rejects(service.createDoctor({ name: 'Dr. Ada Example', email: 'ada@example.test', password: 'temporary-pass-123', specialty: 'Cardiology', consultationFee: 700 }), /profile write failed/);
  assert.deepEqual(calls.deleted, [{ _id: userId }]);
  assert.deepEqual(calls.profilesDeleted, [{ user: userId }]);
});

test('doctor provisioning rejects invalid and overlapping availability', async () => {
  const { service } = modelHarness();
  await assert.rejects(service.createDoctor({ name: 'Dr. Ada Example', email: 'ada@example.test', password: 'temporary-pass-123', specialty: 'Cardiology', consultationFee: 700, timezone: 'Not/AZone', availability: [] }),
    (error) => error.status === 400 && error.code === 'INVALID_AVAILABILITY');
});

test('deactivation refuses future active bookings and returns safe conflict details', async () => {
  const appointment = { _id: appointmentId, startsAt: new Date('2027-01-02T09:00:00Z'), status: 'accepted' };
  const { service, calls } = modelHarness({ appointments: [appointment] });
  await assert.rejects(service.setDoctorStatus(doctorId, { isActive: false }), (error) =>
    error.status === 409 && error.code === 'DOCTOR_HAS_UPCOMING_APPOINTMENTS' && error.details.appointments[0].id === appointmentId);
  assert.equal(calls.userUpdates.length, 0);
});
