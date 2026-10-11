import mongoose from 'mongoose';
import { ACTIVE_APPOINTMENT_STATUSES, validateAppointmentListQuery } from './appointmentService.js';

const SLOT_DURATION_MINUTES = 30;
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class DoctorDashboardError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'DoctorDashboardError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function invalidAvailability(message) {
  throw new DoctorDashboardError(400, 'INVALID_AVAILABILITY', message);
}

function parseClock(value) {
  const match = typeof value === 'string' ? value.match(CLOCK_PATTERN) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function validateAvailabilityInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidAvailability('Request body must be an object');
  }

  const timezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!timezone || timezone.length > 100) invalidAvailability('timezone must be an IANA timezone identifier');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    invalidAvailability('timezone must be a valid IANA timezone identifier');
  }

  if (!Array.isArray(input.availability) || input.availability.length > 42) {
    invalidAvailability('availability must be an array of up to 42 weekly windows');
  }

  const windows = input.availability.map((window, index) => {
    if (!window || typeof window !== 'object' || Array.isArray(window)) {
      invalidAvailability(`availability[${index}] must be an object`);
    }
    if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) {
      invalidAvailability(`availability[${index}].weekday must be an integer from 0 (Sunday) to 6 (Saturday)`);
    }
    const startMinute = parseClock(window.startTime);
    const endMinute = parseClock(window.endTime);
    if (startMinute === null || endMinute === null) {
      invalidAvailability(`availability[${index}] times must use 24-hour HH:mm format`);
    }
    if (startMinute >= endMinute) {
      invalidAvailability(`availability[${index}].endTime must be later than startTime`);
    }
    return {
      weekday: window.weekday,
      startTime: window.startTime,
      endTime: window.endTime,
      startMinute,
      endMinute,
    };
  });

  const sorted = [...windows].sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous.weekday === current.weekday && current.startMinute < previous.endMinute) {
      invalidAvailability(`Weekly windows overlap on weekday ${current.weekday}`);
    }
  }

  return {
    timezone,
    availability: windows.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
  };
}

function localTimeParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function availabilityCoversAppointment(appointment, availability, timezone) {
  let start;
  let end;
  try {
    start = localTimeParts(appointment.startsAt, timezone);
    end = localTimeParts(appointment.endsAt, timezone);
  } catch {
    invalidAvailability('timezone must be a valid IANA timezone identifier');
  }

  const startMinute = Number(start.hour) * 60 + Number(start.minute);
  const endMinute = Number(end.hour) * 60 + Number(end.minute);
  if (
    start.year !== end.year || start.month !== end.month || start.day !== end.day ||
    start.second !== '00' || end.second !== '00' ||
    new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime() !== SLOT_DURATION_MINUTES * 60 * 1000
  ) return false;

  const weekday = WEEKDAY_INDEX[start.weekday];
  return availability.some((window) => {
    if (window.weekday !== weekday) return false;
    const windowStart = parseClock(window.startTime);
    const windowEnd = parseClock(window.endTime);
    return startMinute >= windowStart && endMinute <= windowEnd &&
      endMinute === startMinute + SLOT_DURATION_MINUTES &&
      (startMinute - windowStart) % SLOT_DURATION_MINUTES === 0;
  });
}

function doctorDto(doctor) {
  return {
    id: String(doctor._id || doctor.id),
    name: doctor.user?.name || doctor.name,
    specialty: doctor.specialty,
    consultationFee: doctor.consultationFee,
    bio: doctor.bio,
    timezone: doctor.timezone,
    availability: doctor.availability,
  };
}

function appointmentDto(appointment) {
  return {
    id: String(appointment._id || appointment.id),
    startsAt: new Date(appointment.startsAt).toISOString(),
    endsAt: new Date(appointment.endsAt).toISOString(),
    status: appointment.status,
    reason: appointment.reason || '',
    patient: appointment.patient && {
      id: String(appointment.patient._id || appointment.patient.id),
      name: appointment.patient.name,
    },
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  };
}

function parseAppointmentId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new DoctorDashboardError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
  }
}

export function createDoctorDashboardService({ Doctor, Appointment, clock = () => new Date() }) {
  async function findDoctorForUser(userId) {
    const doctor = await Doctor.findOne({ user: userId }).populate({ path: 'user', select: 'name role isActive' });
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor' || !doctor.user.isActive) {
      throw new DoctorDashboardError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'Doctor profile not found');
    }
    return doctor;
  }

  async function getProfile(userId) {
    const doctor = await findDoctorForUser(userId);
    return { doctor: doctorDto(doctor) };
  }

  async function listAppointments(userId, query) {
    const doctor = await findDoctorForUser(userId);
    let pagination;
    try {
      pagination = validateAppointmentListQuery(query);
    } catch (error) {
      if (error.status) throw error;
      throw new DoctorDashboardError(400, error.code || 'INVALID_QUERY', error.message);
    }
    const { page, limit, status } = pagination;
    const filter = { doctor: doctor._id };
    if (status) filter.status = status;
    const [appointments, total, requestedAppointments, acceptedAppointments, totalAppointments] = await Promise.all([
      Appointment.find(filter)
        .populate({ path: 'patient', select: 'name' })
        .sort({ startsAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Appointment.countDocuments(filter),
      Appointment.countDocuments({ doctor: doctor._id, status: 'requested' }),
      Appointment.countDocuments({ doctor: doctor._id, status: 'accepted' }),
      Appointment.countDocuments({ doctor: doctor._id }),
    ]);

    return {
      doctor: doctorDto(doctor),
      appointments: appointments.map(appointmentDto),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: { totalAppointments, requestedAppointments, acceptedAppointments },
    };
  }

  async function updateAppointmentStatus(userId, appointmentId, input) {
    const doctor = await findDoctorForUser(userId);
    parseAppointmentId(appointmentId);
    const status = input?.status;
    if (!['accepted', 'rejected', 'completed'].includes(status)) {
      throw new DoctorDashboardError(400, 'INVALID_STATUS', 'status must be accepted, rejected, or completed');
    }

    const currentStatus = status === 'completed' ? 'accepted' : 'requested';
    const update = status === 'rejected' || status === 'completed'
      ? { $set: { status }, $unset: { activeSlotKey: 1 } }
      : { $set: { status } };
    const updated = await Appointment.findOneAndUpdate(
      { _id: appointmentId, doctor: doctor._id, status: currentStatus },
      update,
      { new: true, runValidators: true },
    ).populate({ path: 'patient', select: 'name' });

    if (updated) return { appointment: appointmentDto(updated) };

    const existing = await Appointment.findOne({ _id: appointmentId, doctor: doctor._id }).select('status');
    if (!existing) {
      throw new DoctorDashboardError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');
    }
    throw new DoctorDashboardError(409, 'INVALID_STATUS_TRANSITION', `A ${existing.status} appointment cannot be changed by this action`);
  }

  async function updateProfile(userId, input = {}) {
    const doctor = await findDoctorForUser(userId);
    const allowed = new Set(['specialty', 'bio', 'consultationFee']);
    const fields = Object.keys(input);
    if (!fields.length || fields.some((field) => !allowed.has(field))) {
      throw new DoctorDashboardError(400, 'INVALID_PROFILE', 'Only specialty, bio, and consultationFee can be updated');
    }
    const update = {};
    if (Object.hasOwn(input, 'specialty')) {
      if (typeof input.specialty !== 'string' || !input.specialty.trim() || input.specialty.trim().length > 80) {
        throw new DoctorDashboardError(400, 'INVALID_PROFILE', 'specialty must be between 1 and 80 characters');
      }
      update.specialty = input.specialty.trim();
    }
    if (Object.hasOwn(input, 'bio')) {
      if (typeof input.bio !== 'string' || input.bio.length > 2000) {
        throw new DoctorDashboardError(400, 'INVALID_PROFILE', 'bio must be 2000 characters or fewer');
      }
      update.bio = input.bio.trim();
    }
    if (Object.hasOwn(input, 'consultationFee')) {
      if (typeof input.consultationFee !== 'number' || !Number.isFinite(input.consultationFee) || input.consultationFee < 0 || input.consultationFee > 1000000) {
        throw new DoctorDashboardError(400, 'INVALID_PROFILE', 'consultationFee must be a number between 0 and 1000000');
      }
      update.consultationFee = input.consultationFee;
    }
    const updated = await Doctor.findByIdAndUpdate(doctor._id, { $set: update }, { new: true, runValidators: true })
      .populate({ path: 'user', select: 'name role isActive' });
    if (!updated) throw new DoctorDashboardError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'Doctor profile not found');
    return { doctor: doctorDto(updated) };
  }

  async function updateAvailability(userId, input) {
    const doctor = await findDoctorForUser(userId);
    const nextAvailability = validateAvailabilityInput(input);
    const futureBookings = await Appointment.find({
      doctor: doctor._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      startsAt: { $gt: clock() },
    }).populate({ path: 'patient', select: 'name' });

    const conflicts = futureBookings
      .filter((appointment) => !availabilityCoversAppointment(appointment, nextAvailability.availability, nextAvailability.timezone))
      .map((appointment) => ({
        id: String(appointment._id),
        startsAt: new Date(appointment.startsAt).toISOString(),
        patientName: appointment.patient?.name || 'Patient',
        status: appointment.status,
      }));

    if (conflicts.length) {
      throw new DoctorDashboardError(
        409,
        'AVAILABILITY_CONFLICT',
        `Changes would exclude ${conflicts.length} future appointment${conflicts.length === 1 ? '' : 's'}. No changes were saved.`,
        { appointments: conflicts },
      );
    }

    const updated = await Doctor.findByIdAndUpdate(
      doctor._id,
      { $set: nextAvailability },
      { new: true, runValidators: true },
    ).populate({ path: 'user', select: 'name role isActive' });
    if (!updated) throw new DoctorDashboardError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'Doctor profile not found');
    return { doctor: doctorDto(updated) };
  }

  return { getProfile, listAppointments, updateAppointmentStatus, updateProfile, updateAvailability };
}
