import mongoose from 'mongoose';

export const SLOT_DURATION_MINUTES = 30;
export const SLOT_DURATION_MS = SLOT_DURATION_MINUTES * 60 * 1000;
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
export const ACTIVE_APPOINTMENT_STATUSES = ['requested', 'accepted'];
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const APPOINTMENT_STATUSES = ['requested', 'accepted', 'rejected', 'cancelled', 'completed'];
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const formatterCache = new Map();

export class AppointmentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppointmentError';
    this.status = status;
    this.code = code;
  }
}

export function parseInstant(value, fieldName) {
  if (typeof value !== 'string') {
    throw new AppointmentError(400, 'INVALID_DATE', `${fieldName} must be an ISO datetime with a timezone`);
  }

  const match = value.match(INSTANT_PATTERN);
  if (!match) {
    throw new AppointmentError(400, 'INVALID_DATE', `${fieldName} must be an ISO datetime with a timezone`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;

  if (
    year < 1970 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 ||
    (zone !== 'Z' && (Number(offsetHourText) > 14 || Number(offsetMinuteText) > 59 || (Number(offsetHourText) === 14 && Number(offsetMinuteText) !== 0)))
  ) {
    throw new AppointmentError(400, 'INVALID_DATE', `${fieldName} must be a valid ISO datetime`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppointmentError(400, 'INVALID_DATE', `${fieldName} must be a valid ISO datetime`);
  }
  return date;
}

export function parseDateRange(query, now = new Date()) {
  const from = parseInstant(query.from, 'from');
  const to = parseInstant(query.to, 'to');
  if (to <= from) {
    throw new AppointmentError(400, 'INVALID_DATE_RANGE', 'to must be later than from');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new AppointmentError(400, 'INVALID_DATE_RANGE', 'Date range cannot exceed 31 days');
  }
  return { from, to };
}

export function validateBookingInput(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppointmentError(400, 'INVALID_INPUT', 'Request body must be an object');
  }
  if (typeof input.doctorId !== 'string' || !mongoose.isValidObjectId(input.doctorId)) {
    throw new AppointmentError(400, 'INVALID_DOCTOR_ID', 'doctorId must be a valid doctor ID');
  }

  const startsAt = parseInstant(input.startsAt, 'startsAt');
  if (startsAt <= now) {
    throw new AppointmentError(400, 'PAST_APPOINTMENT', 'Appointment start time must be in the future');
  }

  const reason = input.reason === undefined ? '' : input.reason;
  if (typeof reason !== 'string' || reason.trim().length > 500) {
    throw new AppointmentError(400, 'INVALID_REASON', 'reason must be a string no longer than 500 characters');
  }

  return { doctorId: input.doctorId, startsAt, reason: reason.trim() };
}

export function validateAppointmentListQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    throw new AppointmentError(400, 'INVALID_PAGE', 'page must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AppointmentError(400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 50');
  }
  if (query.status !== undefined && !APPOINTMENT_STATUSES.includes(query.status)) {
    throw new AppointmentError(400, 'INVALID_STATUS', 'status is not a valid appointment status');
  }
  return { page, limit, status: query.status };
}

function formatterFor(timezone) {
  if (!formatterCache.has(timezone)) {
    // Reuse the timezone formatter while generating many slots; Intl formatters are relatively expensive to create.
    formatterCache.set(timezone, new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timezone);
}

function localPartsAt(date, timezone) {
  const values = Object.fromEntries(formatterFor(timezone).formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday,
  };
}

function weekdayNumber(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function wallClockToInstant(local, timezone) {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let candidate = target;

  // Treat the local clock reading as a UTC guess, then adjust by the difference the
  // timezone formatter reports. This converts a doctor's wall-clock time to a real instant.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = localPartsAt(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const difference = target - actualAsUtc;
    if (difference === 0) return new Date(candidate);
    candidate += difference;
  }

  // Nonexistent wall-clock times during a daylight-saving jump do not map to an instant.
  return null;
}

function parseClock(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function generateSlots({ availability, timezone, from, to, now = new Date(), bookings = [] }) {
  let formatter;
  try {
    formatter = formatterFor(timezone || DEFAULT_TIME_ZONE);
    formatter.format(new Date());
  } catch {
    throw new AppointmentError(500, 'INVALID_DOCTOR_TIMEZONE', 'Doctor availability timezone is invalid');
  }

  const zone = timezone || DEFAULT_TIME_ZONE;
  const firstLocalDay = localPartsAt(from, zone);
  const lastLocalDay = localPartsAt(new Date(to.getTime() - 1), zone);
  // Walk calendar days in the doctor's timezone, not the server's timezone. Each
  // local opening window is converted to UTC before it is returned to the browser.
  let dayCursor = Date.UTC(firstLocalDay.year, firstLocalDay.month - 1, firstLocalDay.day);
  const lastDay = Date.UTC(lastLocalDay.year, lastLocalDay.month - 1, lastLocalDay.day);
  const uniqueSlots = new Map();

  while (dayCursor <= lastDay) {
    const date = new Date(dayCursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const weekday = date.getUTCDay();

    for (const window of availability || []) {
      if (Number(window.weekday) !== weekday) continue;
      const windowStart = parseClock(window.startTime);
      const windowEnd = parseClock(window.endTime);
      if (windowStart === null || windowEnd === null || windowEnd <= windowStart) continue;

      for (let localMinute = windowStart; localMinute + SLOT_DURATION_MINUTES <= windowEnd; localMinute += SLOT_DURATION_MINUTES) {
        const localStart = {
          year,
          month,
          day,
          hour: Math.floor(localMinute / 60),
          minute: localMinute % 60,
        };
        const localEndTotal = localMinute + SLOT_DURATION_MINUTES;
        const localEnd = {
          year,
          month,
          day,
          hour: Math.floor(localEndTotal / 60),
          minute: localEndTotal % 60,
        };
        const startsAt = wallClockToInstant(localStart, zone);
        const expectedEnd = wallClockToInstant(localEnd, zone);
        if (!startsAt || !expectedEnd) continue;

        const endsAt = new Date(startsAt.getTime() + SLOT_DURATION_MS);
        // Skip slots spanning a DST transition; all accepted slots are exactly 30 real minutes.
        if (expectedEnd.getTime() !== endsAt.getTime()) continue;
        if (startsAt <= now || startsAt < from || startsAt >= to) continue;

        const overlapsBooking = bookings.some((booking) =>
          new Date(booking.startsAt) < endsAt && new Date(booking.endsAt) > startsAt,
        );
        if (!overlapsBooking) uniqueSlots.set(startsAt.getTime(), { startsAt, endsAt });
      }
    }

    dayCursor += 24 * 60 * 60 * 1000;
  }

  return [...uniqueSlots.values()].sort((a, b) => a.startsAt - b.startsAt);
}

function appointmentDto(appointment) {
  return {
    id: String(appointment._id || appointment.id),
    doctorId: String(appointment.doctor?._id || appointment.doctor),
    startsAt: new Date(appointment.startsAt).toISOString(),
    endsAt: new Date(appointment.endsAt).toISOString(),
    status: appointment.status,
    reason: appointment.reason || '',
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

function ensureDoctorId(doctorId) {
  if (!mongoose.isValidObjectId(doctorId)) {
    throw new AppointmentError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
  }
}

export function createAppointmentService({ Doctor, Appointment, clock = () => new Date() }) {
  async function findActiveDoctor(doctorId) {
    ensureDoctorId(doctorId);
    const doctor = await Doctor.findById(doctorId).populate({ path: 'user', select: 'role isActive' });
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor' || !doctor.user.isActive) {
      throw new AppointmentError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    }
    return doctor;
  }

  async function availableSlotsForDoctor(doctor, from, to) {
    const bookings = await Appointment.find({
      doctor: doctor._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      startsAt: { $lt: to },
      endsAt: { $gt: from },
    }).select('startsAt endsAt');

    return generateSlots({
      availability: doctor.availability,
      timezone: doctor.timezone || DEFAULT_TIME_ZONE,
      from,
      to,
      now: clock(),
      bookings,
    });
  }

  async function getDoctorSlots(doctorId, query) {
    const now = clock();
    const { from, to } = parseDateRange(query, now);
    const doctor = await findActiveDoctor(doctorId);
    const bookings = await Appointment.find({
      doctor: doctor._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      startsAt: { $lt: to },
      endsAt: { $gt: from },
    }).select('startsAt endsAt');
    const candidates = generateSlots({
      availability: doctor.availability,
      timezone: doctor.timezone || DEFAULT_TIME_ZONE,
      from,
      to,
      now,
    });
    const isBooked = (slot) => bookings.some((booking) =>
      new Date(booking.startsAt) < slot.endsAt && new Date(booking.endsAt) > slot.startsAt,
    );
    return {
      doctor,
      timezone: doctor.timezone || DEFAULT_TIME_ZONE,
      slots: candidates.filter((slot) => !isBooked(slot)),
      unavailableSlots: candidates.filter(isBooked).map((slot) => ({ ...slot, reason: 'booked' })),
    };
  }

  async function book(patientId, input) {
    const { doctorId, startsAt, reason } = validateBookingInput(input, clock());
    const doctor = await findActiveDoctor(doctorId);
    const slotEndRange = new Date(startsAt.getTime() + 1);
    const slots = await availableSlotsForDoctor(doctor, startsAt, slotEndRange);
    const slot = slots.find((candidate) => candidate.startsAt.getTime() === startsAt.getTime());
    if (!slot) {
      throw new AppointmentError(409, 'SLOT_UNAVAILABLE', 'Requested appointment slot is unavailable');
    }

    const activeSlotKey = `${doctor._id}:${slot.startsAt.toISOString()}`;
    try {
      // This key is uniquely indexed in MongoDB. The earlier availability read makes
      // normal conflicts friendly; the index also catches two requests racing together.
      const appointment = await Appointment.create({
        patient: patientId,
        doctor: doctor._id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'requested',
        reason,
        activeSlotKey,
      });
      return appointmentDto(appointment);
    } catch (error) {
      if (error?.code === 11000) {
        throw new AppointmentError(409, 'BOOKING_CONFLICT', 'This appointment slot was just booked');
      }
      throw error;
    }
  }

  async function listForPatient(patientId, query) {
    const { page, limit, status } = validateAppointmentListQuery(query);
    const filter = { patient: patientId };
    if (status) filter.status = status;
    const [appointments, total] = await Promise.all([
      Appointment.find(filter)
        .sort({ startsAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Appointment.countDocuments(filter),
    ]);
    return {
      appointments: appointments.map(appointmentDto),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async function cancelForPatient(patientId, appointmentId) {
    if (!mongoose.isValidObjectId(appointmentId)) {
      throw new AppointmentError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
    }
    const appointment = await Appointment.findOne({ _id: appointmentId, patient: patientId });
    if (!appointment) {
      throw new AppointmentError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
    }
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status) || appointment.startsAt <= clock()) {
      throw new AppointmentError(409, 'CANCELLATION_NOT_ALLOWED', 'This appointment can no longer be cancelled');
    }

    // Cancel only if it is still this patient's future active appointment, and release
    // the reservation in that same atomic write so another patient may book the slot.
    const cancelled = await Appointment.findOneAndUpdate(
      {
        _id: appointmentId,
        patient: patientId,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        startsAt: { $gt: clock() },
      },
      { $set: { status: 'cancelled' }, $unset: { activeSlotKey: 1 } },
      { new: true, runValidators: true },
    );
    if (!cancelled) {
      throw new AppointmentError(409, 'CANCELLATION_NOT_ALLOWED', 'This appointment changed and can no longer be cancelled');
    }
    return appointmentDto(cancelled);
  }

  return { getDoctorSlots, book, listForPatient, cancelForPatient };
}
