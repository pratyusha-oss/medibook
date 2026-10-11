import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppointmentError,
  createAppointmentService,
  generateSlots,
  parseDateRange,
  validateBookingInput,
} from '../src/services/appointmentService.js';
import { requireRole } from '../src/middleware/auth.js';

const doctorId = '507f1f77bcf86cd799439011';
const patientId = '507f191e810c19729de860ea';
const appointmentId = '507f191e810c19729de860eb';
const now = new Date('2026-10-10T00:00:00.000Z');
const from = new Date('2026-10-11T00:00:00.000Z');
const to = new Date('2026-10-13T00:00:00.000Z');
const mondayAvailability = [{ weekday: 1, startTime: '09:00', endTime: '10:00' }];

function fakeDoctor(availability = mondayAvailability) {
  return {
    _id: doctorId,
    timezone: 'Asia/Kolkata',
    availability,
    user: { role: 'doctor', isActive: true },
  };
}

function fakeModels({ doctor = fakeDoctor(), bookings = [], create, findOne, findOneAndUpdate } = {}) {
  let lastBookingFilter;
  let lastOwnerFilter;
  let lastUpdateFilter;
  let lastUpdate;
  const Doctor = {
    findById() {
      return { populate: async () => doctor };
    },
  };
  const Appointment = {
    find(filter) {
      lastBookingFilter = filter;
      return { select: async () => bookings };
    },
    create: create || (async (document) => ({ _id: appointmentId, ...document })),
    findOne: async (filter) => {
      lastOwnerFilter = filter;
      return findOne ? findOne(filter) : null;
    },
    findOneAndUpdate: async (filter, update) => {
      lastUpdateFilter = filter;
      lastUpdate = update;
      return findOneAndUpdate ? findOneAndUpdate(filter, update) : null;
    },
    countDocuments: async () => 0,
  };
  return {
    Doctor,
    Appointment,
    get lastBookingFilter() { return lastBookingFilter; },
    get lastOwnerFilter() { return lastOwnerFilter; },
    get lastUpdateFilter() { return lastUpdateFilter; },
    get lastUpdate() { return lastUpdate; },
  };
}

test('date range requires zoned ISO instants and is capped at 31 days', () => {
  assert.throws(() => parseDateRange({ from: '2026-10-11T00:00:00', to: '2026-10-12T00:00:00Z' }, now), AppointmentError);
  assert.throws(() => parseDateRange({ from: '2026-10-11T00:00:00Z', to: '2026-12-01T00:00:00Z' }, now), /31 days/);
});

test('booking validation requires a valid doctor, future zoned start, and bounded reason', () => {
  assert.throws(() => validateBookingInput({ doctorId, startsAt: '2026-10-12T03:30:00' }, now), /timezone/);
  assert.throws(() => validateBookingInput({ doctorId, startsAt: '2026-10-09T03:30:00Z' }, now), /future/);
  assert.throws(() => validateBookingInput({ doctorId: 'bad', startsAt: '2026-10-12T03:30:00Z' }, now), /doctor ID/);
  assert.throws(() => validateBookingInput({
    doctorId,
    startsAt: '2026-10-12T03:30:00Z',
    reason: 'x'.repeat(501),
  }, now), /500 characters/);
});

test('slot generation converts Asia/Kolkata windows to UTC 30-minute slots', () => {
  const slots = generateSlots({
    availability: mondayAvailability,
    timezone: 'Asia/Kolkata',
    from,
    to,
    now,
  });

  assert.deepEqual(slots.map(({ startsAt, endsAt }) => [startsAt.toISOString(), endsAt.toISOString()]), [
    ['2026-10-12T03:30:00.000Z', '2026-10-12T04:00:00.000Z'],
    ['2026-10-12T04:00:00.000Z', '2026-10-12T04:30:00.000Z'],
  ]);
});

test('slot generation omits active overlapping bookings and past slots', () => {
  const slots = generateSlots({
    availability: mondayAvailability,
    timezone: 'Asia/Kolkata',
    from,
    to,
    now: new Date('2026-10-12T03:45:00.000Z'),
    bookings: [{ startsAt: new Date('2026-10-12T04:00:00.000Z'), endsAt: new Date('2026-10-12T04:30:00.000Z') }],
  });
  assert.deepEqual(slots.map((slot) => slot.startsAt.toISOString()), []);
});

test('invalid or unavailable slots are rejected and client end times are ignored', async () => {
  const models = fakeModels();
  const service = createAppointmentService({ ...models, clock: () => now });
  await assert.rejects(
    service.book(patientId, { doctorId, startsAt: '2026-10-12T03:45:00Z', endsAt: '2099-01-01T00:00:00Z' }),
    (error) => error.code === 'SLOT_UNAVAILABLE' && error.status === 409,
  );
  assert.deepEqual(models.lastBookingFilter.status.$in, ['requested', 'accepted']);
});

test('booking uses the authenticated patient, computes end time, and reserves a unique key', async () => {
  let createdDocument;
  const models = fakeModels({ create: async (document) => {
    createdDocument = document;
    return { _id: appointmentId, ...document };
  } });
  const service = createAppointmentService({ ...models, clock: () => now });
  const appointment = await service.book(patientId, {
    doctorId,
    startsAt: '2026-10-12T03:30:00.000Z',
    patientId: 'client-supplied-value-is-ignored',
    endsAt: '2099-01-01T00:00:00Z',
    reason: '  Consultation  ',
  });

  assert.equal(createdDocument.patient, patientId);
  assert.equal(createdDocument.endsAt.toISOString(), '2026-10-12T04:00:00.000Z');
  assert.equal(createdDocument.activeSlotKey, `${doctorId}:2026-10-12T03:30:00.000Z`);
  assert.equal(createdDocument.reason, 'Consultation');
  assert.equal(appointment.endsAt, '2026-10-12T04:00:00.000Z');
  assert.equal(Object.hasOwn(appointment, 'activeSlotKey'), false);
});

test('duplicate-key booking races become HTTP 409 conflicts', async () => {
  const models = fakeModels({ create: async () => { throw { code: 11000 }; } });
  const service = createAppointmentService({ ...models, clock: () => now });
  await assert.rejects(
    service.book(patientId, { doctorId, startsAt: '2026-10-12T03:30:00Z' }),
    (error) => error.code === 'BOOKING_CONFLICT' && error.status === 409,
  );
});

test('cancellation scopes reads and atomic slot release to the owning patient', async () => {
  const ownedAppointment = {
    _id: appointmentId,
    doctor: doctorId,
    patient: patientId,
    startsAt: new Date('2026-10-12T03:30:00.000Z'),
    endsAt: new Date('2026-10-12T04:00:00.000Z'),
    status: 'requested',
    activeSlotKey: `${doctorId}:2026-10-12T03:30:00.000Z`,
  };
  const models = fakeModels({
    findOne: async (filter) => filter.patient === patientId ? ownedAppointment : null,
    findOneAndUpdate: async (filter, update) => ({ ...ownedAppointment, status: update.$set.status, activeSlotKey: undefined }),
  });
  const service = createAppointmentService({ ...models, clock: () => now });

  await assert.rejects(
    service.cancelForPatient('507f191e810c19729de860ec', appointmentId),
    (error) => error.status === 404,
  );
  assert.equal(models.lastOwnerFilter.patient, '507f191e810c19729de860ec');

  const cancelled = await service.cancelForPatient(patientId, appointmentId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(models.lastUpdateFilter.patient, patientId);
  assert.deepEqual(models.lastUpdate.$unset, { activeSlotKey: 1 });
});

test('patient-only route authorization rejects doctor users', () => {
  let status;
  let body;
  let continued = false;
  const response = {
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };

  requireRole('patient')({ user: { role: 'doctor' } }, response, () => { continued = true; });

  assert.equal(status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.equal(continued, false);
});
