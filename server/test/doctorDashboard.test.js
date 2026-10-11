import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/middleware/auth.js';
import { generateSlots } from '../src/services/appointmentService.js';
import {
  availabilityCoversAppointment,
  createDoctorDashboardService,
  DoctorDashboardError,
  validateAvailabilityInput,
} from '../src/services/doctorDashboardService.js';

const doctorUserId = '507f1f77bcf86cd799439011';
const doctorProfileId = '507f191e810c19729de860ea';
const otherDoctorProfileId = '507f191e810c19729de860eb';
const appointmentId = '507f191e810c19729de860ec';
const patientId = '507f191e810c19729de860ed';
const now = new Date('2026-10-10T00:00:00.000Z');
const scheduledAppointment = {
  _id: appointmentId,
  doctor: doctorProfileId,
  patient: { _id: patientId, name: 'A patient' },
  startsAt: new Date('2026-10-12T03:30:00.000Z'),
  endsAt: new Date('2026-10-12T04:00:00.000Z'),
  status: 'requested',
  reason: 'Consultation',
};
const weekdayAvailability = [{ weekday: 1, startTime: '09:00', endTime: '10:00' }];

function fakeDoctor(availability = weekdayAvailability) {
  return {
    _id: doctorProfileId,
    user: { _id: doctorUserId, name: 'Dr. Test', role: 'doctor', isActive: true },
    specialty: 'Family Medicine',
    consultationFee: 500,
    bio: '',
    timezone: 'Asia/Kolkata',
    availability,
  };
}

function fakeModels({
  doctor = fakeDoctor(),
  appointments = [],
  counts = {},
  findOneAndUpdate,
  findByIdAndUpdate,
} = {}) {
  const calls = {};
  const Doctor = {
    findOne(filter) {
      calls.profileFilter = filter;
      return { populate: async () => String(filter.user) === String(doctor.user._id) ? doctor : null };
    },
    findByIdAndUpdate(id, update, options) {
      calls.profileUpdate = { id, update, options };
      return { populate: async () => findByIdAndUpdate ? findByIdAndUpdate(id, update, options) : { ...doctor, ...update.$set } };
    },
  };
  const Appointment = {
    find(filter) {
      calls.appointmentFilter = filter;
      return {
        populate() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit: async () => appointments,
        then(resolve, reject) { return Promise.resolve(appointments).then(resolve, reject); },
      };
    },
    countDocuments: async (filter = {}) => filter.status ? (counts[filter.status] ?? appointments.filter((appointment) => appointment.status === filter.status).length) : (counts.total ?? appointments.length),
    findOneAndUpdate(filter, update, options) {
      calls.statusUpdate = { filter, update, options };
      return {
        populate: async () => findOneAndUpdate ? findOneAndUpdate(filter, update, options) : null,
      };
    },
    findOne(filter) {
      calls.scopedFind = filter;
      return {
        select: async () => appointments.find((appointment) =>
          String(appointment._id) === String(filter._id) && String(appointment.doctor) === String(filter.doctor),
        ) || null,
      };
    },
  };
  return { Doctor, Appointment, calls };
}

test('availability validation accepts valid weekly windows and adjacent windows', () => {
  const result = validateAvailabilityInput({
    timezone: 'Asia/Kolkata',
    availability: [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '12:00', endTime: '17:00' },
    ],
  });
  assert.equal(result.timezone, 'Asia/Kolkata');
  assert.equal(result.availability.length, 2);
});

test('availability validation rejects invalid weekdays, time formats, ranges, zones, and overlaps', () => {
  const invalidInputs = [
    { timezone: 'Asia/Kolkata', availability: [{ weekday: 7, startTime: '09:00', endTime: '10:00' }] },
    { timezone: 'Asia/Kolkata', availability: [{ weekday: 1, startTime: '9:00', endTime: '10:00' }] },
    { timezone: 'Asia/Kolkata', availability: [{ weekday: 1, startTime: '10:00', endTime: '09:00' }] },
    { timezone: 'Not/A_Timezone', availability: [] },
    { timezone: 'Asia/Kolkata', availability: [
      { weekday: 1, startTime: '09:00', endTime: '12:00' },
      { weekday: 1, startTime: '11:30', endTime: '13:00' },
    ] },
  ];
  for (const input of invalidInputs) {
    assert.throws(() => validateAvailabilityInput(input), (error) => error.status === 400 && error.code === 'INVALID_AVAILABILITY');
  }
});

test('existing appointment coverage uses the proposed local timezone and 30-minute slot grid', () => {
  assert.equal(availabilityCoversAppointment(scheduledAppointment, weekdayAvailability, 'Asia/Kolkata'), true);
  assert.equal(availabilityCoversAppointment(scheduledAppointment, weekdayAvailability, 'UTC'), false);
  assert.equal(availabilityCoversAppointment(scheduledAppointment, [{ weekday: 1, startTime: '09:15', endTime: '10:15' }], 'Asia/Kolkata'), false);
});

test('doctor appointment list is scoped to the profile linked to the authenticated user', async () => {
  const models = fakeModels({ appointments: [scheduledAppointment] });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.listAppointments(doctorUserId, { page: '1', limit: '10' });

  assert.deepEqual(models.calls.profileFilter, { user: doctorUserId });
  assert.deepEqual(models.calls.appointmentFilter, { doctor: doctorProfileId });
  assert.equal(result.doctor.timezone, 'Asia/Kolkata');
  assert.equal(result.appointments[0].patient.name, 'A patient');
});

test('doctor dashboard summary and pagination totals count database records beyond the current page', async () => {
  const models = fakeModels({ appointments: [scheduledAppointment], counts: { total: 27, requested: 8, accepted: 6 } });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.listAppointments(doctorUserId, { page: '2', limit: '1' });

  assert.equal(result.appointments.length, 1);
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 27, pages: 27 });
  assert.deepEqual(result.summary, { totalAppointments: 27, requestedAppointments: 8, acceptedAppointments: 6 });
});

test('doctor status update is scoped and rejection atomically releases the active slot key', async () => {
  const models = fakeModels({ findOneAndUpdate: async () => ({ ...scheduledAppointment, status: 'rejected' }) });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'rejected' });

  assert.deepEqual(models.calls.statusUpdate.filter, {
    _id: appointmentId,
    doctor: doctorProfileId,
    status: 'requested',
  });
  assert.deepEqual(models.calls.statusUpdate.update.$unset, { activeSlotKey: 1 });
  assert.equal(result.appointment.status, 'rejected');
});

test('doctor can complete only an owned accepted appointment and releases its reserved slot key', async () => {
  const accepted = { ...scheduledAppointment, status: 'accepted' };
  const models = fakeModels({ appointments: [accepted], findOneAndUpdate: async () => ({ ...accepted, status: 'completed' }) });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'completed' });

  assert.deepEqual(models.calls.statusUpdate.filter, { _id: appointmentId, doctor: doctorProfileId, status: 'accepted' });
  assert.deepEqual(models.calls.statusUpdate.update.$unset, { activeSlotKey: 1 });
  assert.equal(result.appointment.status, 'completed');

  const foreign = fakeModels({ appointments: [{ ...accepted, doctor: otherDoctorProfileId }] });
  const foreignService = createDoctorDashboardService({ ...foreign, clock: () => now });
  await assert.rejects(foreignService.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'completed' }), (error) => error.status === 404 && error.code === 'APPOINTMENT_NOT_FOUND');
});

test('doctor cannot update another doctor appointment and cannot transition a non-requested appointment', async () => {
  const foreignAppointment = { ...scheduledAppointment, doctor: otherDoctorProfileId };
  const foreignModels = fakeModels({ appointments: [foreignAppointment] });
  const foreignService = createDoctorDashboardService({ ...foreignModels, clock: () => now });
  await assert.rejects(
    foreignService.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'accepted' }),
    (error) => error.status === 404 && error.code === 'APPOINTMENT_NOT_FOUND',
  );
  assert.equal(String(foreignModels.calls.statusUpdate.filter.doctor), doctorProfileId);

  const accepted = { ...scheduledAppointment, status: 'accepted' };
  const stateModels = fakeModels({ appointments: [accepted] });
  const stateService = createDoctorDashboardService({ ...stateModels, clock: () => now });
  await assert.rejects(
    stateService.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'rejected' }),
    (error) => error.status === 409 && error.code === 'INVALID_STATUS_TRANSITION',
  );
});

test('invalid doctor appointment statuses are rejected before any write', async () => {
  const models = fakeModels();
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  await assert.rejects(
    service.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'canceled' }),
    (error) => error.status === 400 && error.code === 'INVALID_STATUS',
  );
  assert.equal(models.calls.statusUpdate, undefined);
});

test('cancelled, rejected, requested, and completed appointments cannot be marked completed', async () => {
  for (const status of ['cancelled', 'rejected', 'requested', 'completed']) {
    const models = fakeModels({ appointments: [{ ...scheduledAppointment, status }] });
    const service = createDoctorDashboardService({ ...models, clock: () => now });
    await assert.rejects(service.updateAppointmentStatus(doctorUserId, appointmentId, { status: 'completed' }), (error) => error.status === 409 && error.code === 'INVALID_STATUS_TRANSITION');
    assert.equal(models.calls.statusUpdate.filter.status, 'accepted');
  }
});

test('doctor can update only safe fields on the linked profile', async () => {
  const models = fakeModels();
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.updateProfile(doctorUserId, { specialty: '  Pediatrics ', bio: 'New bio', consultationFee: 750 });
  assert.deepEqual(models.calls.profileUpdate.update.$set, { specialty: 'Pediatrics', bio: 'New bio', consultationFee: 750 });
  assert.equal(result.doctor.name, 'Dr. Test');
  await assert.rejects(service.updateProfile('507f1f77bcf86cd799439013', { specialty: 'Other' }), (error) => error.status === 404 && error.code === 'DOCTOR_PROFILE_NOT_FOUND');
  await assert.rejects(service.updateProfile(doctorUserId, { role: 'admin' }), (error) => error.status === 400 && error.code === 'INVALID_PROFILE');
});

test('availability update reports future booking conflicts and leaves profile unchanged', async () => {
  const models = fakeModels({ appointments: [scheduledAppointment] });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  await assert.rejects(
    service.updateAvailability(doctorUserId, { timezone: 'UTC', availability: [] }),
    (error) => error.status === 409 && error.code === 'AVAILABILITY_CONFLICT' && error.details.appointments.length === 1,
  );
  assert.equal(models.calls.profileUpdate, undefined);
});

test('saved availability is returned in the shape used by public slot generation', async () => {
  const newAvailability = [{ weekday: 1, startTime: '10:00', endTime: '11:00' }];
  const models = fakeModels({
    findByIdAndUpdate: async (id, update) => ({ ...fakeDoctor(), ...update.$set }),
  });
  const service = createDoctorDashboardService({ ...models, clock: () => now });
  const result = await service.updateAvailability(doctorUserId, { timezone: 'Asia/Kolkata', availability: newAvailability });

  assert.deepEqual(result.doctor.availability, newAvailability);
  const slots = generateSlots({
    availability: result.doctor.availability,
    timezone: result.doctor.timezone,
    from: new Date('2026-10-12T00:00:00.000Z'),
    to: new Date('2026-10-13T00:00:00.000Z'),
    now,
  });
  assert.deepEqual(slots.map((slot) => slot.startsAt.toISOString()), [
    '2026-10-12T04:30:00.000Z',
    '2026-10-12T05:00:00.000Z',
  ]);
});

test('doctor-only middleware rejects patients', () => {
  let status;
  let body;
  let continued = false;
  const response = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };

  requireRole('doctor')({ user: { role: 'patient' } }, response, () => { continued = true; });

  assert.equal(status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(continued, false);
});

test('doctor profile and completion routes reject non-doctor roles', () => {
  let status;
  let body;
  const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  requireRole('doctor')({ user: { role: 'patient' } }, response, () => assert.fail('patient must not reach doctor profile or appointment actions'));
  assert.equal(status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
});
