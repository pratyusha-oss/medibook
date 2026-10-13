import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminServiceError, createAdminService } from '../src/services/adminService.js';

const ids = {
  admin: '507f1f77bcf86cd799439011',
  doctorUser: '507f1f77bcf86cd799439012',
  patient: '507f1f77bcf86cd799439013',
  doctor: '507f191e810c19729de860ea',
  appointment: '507f191e810c19729de860ec',
};

function query(value) {
  return {
    populate() { return this; }, select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function harness({ appointmentRows = [], grouped = [], patientCount = 4, activeDoctorIds = [ids.doctorUser], activeAdminCount = 2 } = {}) {
  const calls = { appointmentFilters: [], appointmentCounts: [], userFilters: [], userUpdates: [], doctorUpdates: [], doctorCountFilters: [] };
  const admin = { _id: ids.admin, id: ids.admin, name: 'Admin User', email: 'admin@example.test', role: 'admin', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') };
  const doctorUser = { _id: ids.doctorUser, id: ids.doctorUser, name: 'Doctor One', email: 'doctor@example.test', role: 'doctor', isActive: true };
  const patient = { _id: ids.patient, id: ids.patient, name: 'Patient One', email: 'patient@example.test', role: 'patient', isActive: true, createdAt: new Date('2026-02-01T00:00:00Z'), passwordHash: 'must-not-leak' };
  const doctor = { _id: ids.doctor, id: ids.doctor, user: doctorUser, specialty: 'Cardiology', consultationFee: 700, bio: 'Original bio', timezone: 'Asia/Kolkata', availability: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }] };
  const appointment = { _id: ids.appointment, startsAt: new Date('2026-10-12T03:30:00Z'), endsAt: new Date('2026-10-12T04:00:00Z'), status: 'accepted', reason: 'Review', patient, doctor, createdAt: new Date('2026-10-01T00:00:00Z'), patientId: ids.patient, doctorId: ids.doctor };
  const allUsers = [admin, doctorUser, patient];
  const User = {
    countDocuments: async (filter) => filter.role === 'patient' ? patientCount : filter.role === 'admin' ? activeAdminCount : 0,
    find(filter) {
      calls.userFilters.push(filter);
      if (filter.role === 'doctor' && filter.isActive === true) return { distinct: async () => activeDoctorIds };
      const matching = allUsers.filter((user) => (!filter.role || user.role === filter.role) && (filter.isActive === undefined || user.isActive === filter.isActive));
      return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return query(matching); }, distinct: async () => matching.map((user) => user._id) };
    },
    findById(id) { return query(allUsers.find((user) => String(user._id) === String(id)) || null); },
    findByIdAndUpdate(id, update) {
      calls.userUpdates.push({ id, update });
      const user = allUsers.find((record) => String(record._id) === String(id));
      if (!user) return query(null);
      Object.assign(user, update.$set);
      return query(user);
    },
  };
  const Doctor = {
    find(filter) { return { populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return query(filter.$or ? [] : [doctor]); } }; },
    countDocuments: async (filter) => { calls.doctorCountFilters.push(filter); return filter.user.$in.length; },
    findById(id) { return query(String(id) === ids.doctor ? doctor : null); },
    findByIdAndUpdate(id, update) {
      calls.doctorUpdates.push({ id, update });
      Object.assign(doctor, update.$set);
      return query(doctor);
    },
    findOne(filter) { return query(filter.user === ids.doctorUser ? { _id: ids.doctor } : null); },
  };
  Doctor.countDocuments = async (filter) => { calls.doctorCountFilters.push(filter); return filter.user.$in.length; };
  // The appointment query builder doubles as a thenable, matching the Mongoose chain used by the service.
  const Appointment = {
    find(filter) { calls.appointmentFilters.push(filter); return query(appointmentRows.length ? appointmentRows : [appointment]); },
    countDocuments: async (filter) => { calls.appointmentCounts.push(filter); return 11; },
    aggregate: async () => grouped,
  };
  return { service: createAdminService({ User, Doctor, Appointment, clock: () => new Date('2026-10-10T00:00:00Z') }), calls, doctor, appointment, patient };
}

test('admin appointment overview applies validated filters, paginates, and returns safe display DTOs', async () => {
  const { service, calls } = harness();
  const result = await service.listAppointments({
    page: '2', limit: '5', status: 'accepted', doctorId: ids.doctor, patientId: ids.patient,
    from: '2026-10-11T00:00:00Z', to: '2026-10-13T00:00:00Z',
  });
  const filter = calls.appointmentFilters[0];
  assert.equal(filter.status, 'accepted');
  assert.equal(filter.doctor, ids.doctor);
  assert.equal(filter.patient, ids.patient);
  assert.equal(filter.startsAt.$gte.toISOString(), '2026-10-11T00:00:00.000Z');
  assert.equal(result.pagination.total, 11);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.limit, 5);
  assert.equal(result.appointments[0].patient.name, 'Patient One');
  assert.equal(result.appointments[0].doctor.name, 'Doctor One');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(result).includes('email'), false);
});

test('admin appointment overview rejects malformed filters and ranges', async () => {
  const { service } = harness();
  for (const queryOptions of [
    { page: '0' }, { limit: '51' }, { status: 'unknown' }, { doctorId: 'bad-id' },
    { from: '2026-10-10T00:00:00Z' }, { from: '2026-10-12T00:00:00Z', to: '2026-10-11T00:00:00Z' },
  ]) {
    await assert.rejects(service.listAppointments(queryOptions), (error) => error.status === 400);
  }
});

test('admin statistics count database records and fill missing status counts with zero', async () => {
  const { service } = harness({ grouped: [{ _id: 'accepted', count: 3 }, { _id: 'requested', count: 2 }] });
  const { statistics } = await service.getStatistics();
  assert.deepEqual(statistics, {
    totalPatients: 4, activeDoctors: 1, totalAppointments: 5,
    appointmentsByStatus: { requested: 2, accepted: 3, rejected: 0, cancelled: 0, completed: 0 },
  });
});

test('statistics return zeros for empty appointment and active doctor collections', async () => {
  const { service } = harness({ grouped: [], patientCount: 0, activeDoctorIds: [] });
  const { statistics } = await service.getStatistics();
  assert.equal(statistics.totalPatients, 0);
  assert.equal(statistics.activeDoctors, 0);
  assert.equal(statistics.totalAppointments, 0);
  assert.ok(Object.values(statistics.appointmentsByStatus).every((count) => count === 0));
});

test('admin user list validates role filters and returns paginated public account fields', async () => {
  const { service, calls } = harness();
  const result = await service.listUsers({ page: '1', limit: '10', role: 'patient', status: 'active', q: 'Patient' });
  assert.equal(calls.userFilters.at(-1).role, 'patient');
  assert.equal(calls.userFilters.at(-1).isActive, true);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.users[0].createdAt.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(JSON.stringify(result).includes('passwordHash'), false);
  await assert.rejects(service.listUsers({ role: 'root' }), (error) => error.status === 400);
});

test('user status prevents self-deactivation and deactivation of the last active admin', async () => {
  const { service } = harness({ activeAdminCount: 1 });
  await assert.rejects(service.setUserStatus(ids.admin, { isActive: false }, ids.admin), (error) => error.code === 'SELF_DEACTIVATION_NOT_ALLOWED');
  await assert.rejects(service.setUserStatus(ids.admin, { isActive: false }, ids.patient), (error) => error.code === 'LAST_ACTIVE_ADMIN');
});

test('user status refuses deactivation when future appointments are active', async () => {
  const future = { _id: ids.appointment, startsAt: new Date('2026-10-12T03:30:00Z'), status: 'requested' };
  const { service, calls } = harness({ appointmentRows: [future] });
  await assert.rejects(service.setUserStatus(ids.patient, { isActive: false }, ids.admin), (error) => error.code === 'USER_HAS_UPCOMING_APPOINTMENTS');
  assert.equal(calls.userUpdates.length, 0);
});

test('doctor profile update validates fields and persists only supported profile data', async () => {
  const { service, doctor, calls } = harness({ appointmentRows: [] });
  const result = await service.updateDoctorProfile(ids.doctor, {
    specialty: '  Pediatrics ', bio: 'Updated bio', consultationFee: 900, qualification: 'MBBS', registrationNumber: 'Council ID supplied',
    languages: ['English', 'Hindi'], clinicAddress: 'OPD 2', isFictionalDemo: true,
  });
  assert.equal(calls.doctorUpdates[0].update.$set.specialty, 'Pediatrics');
  assert.equal(calls.doctorUpdates[0].update.$set.bio, 'Updated bio');
  assert.equal(calls.doctorUpdates[0].update.$set.consultationFee, 900);
  assert.equal(calls.doctorUpdates[0].update.$set.qualification, 'MBBS');
  assert.equal(calls.doctorUpdates[0].update.$set.registrationNumber, 'Council ID supplied');
  assert.deepEqual(calls.doctorUpdates[0].update.$set.languages, ['English', 'Hindi']);
  assert.equal(calls.doctorUpdates[0].update.$set.clinicAddress, 'OPD 2');
  assert.equal(calls.doctorUpdates[0].update.$set.isFictionalDemo, true);
  assert.equal(result.doctor.user.id, ids.doctorUser);
  assert.equal(doctor.specialty, 'Pediatrics');
  await assert.rejects(service.updateDoctorProfile(ids.doctor, { role: 'admin' }), (error) => error.status === 400);
  await assert.rejects(service.updateDoctorProfile(ids.doctor, { consultationFee: -1 }), (error) => error.status === 400);
});

test('doctor profile schedule updates do not exclude future active appointments', async () => {
  const futureAppointment = {
    _id: ids.appointment,
    startsAt: new Date('2026-10-12T03:30:00Z'),
    endsAt: new Date('2026-10-12T04:00:00Z'),
    status: 'accepted',
  };
  const { service, calls } = harness({ appointmentRows: [futureAppointment] });
  await assert.rejects(service.updateDoctorProfile(ids.doctor, { timezone: 'UTC', availability: [] }), (error) => error.code === 'AVAILABILITY_CONFLICT');
  assert.equal(calls.doctorUpdates.length, 0);
});
