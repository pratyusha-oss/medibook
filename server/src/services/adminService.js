import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { validateRegistration } from '../utils/authValidation.js';
import { validateAvailabilityInput } from './doctorDashboardService.js';
import { ACTIVE_APPOINTMENT_STATUSES, parseInstant } from './appointmentService.js';
import { availabilityCoversAppointment } from './doctorDashboardService.js';

const SALT_ROUNDS = 12;
const APPOINTMENT_STATUSES = ['requested', 'accepted', 'rejected', 'cancelled', 'completed'];
const USER_ROLES = ['patient', 'doctor', 'admin'];
const MAX_PAGE_SIZE = 50;
const MAX_ADMIN_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export class AdminServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AdminServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function invalid(message) {
  throw new AdminServiceError(400, 'INVALID_INPUT', message);
}

function userDto(user) {
  return user && {
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    isActive: user.isActive,
  };
}

function doctorDto(doctor) {
  return {
    id: String(doctor._id || doctor.id),
    user: userDto(doctor.user),
    specialty: doctor.specialty,
    consultationFee: doctor.consultationFee,
    bio: doctor.bio,
    timezone: doctor.timezone,
    availability: doctor.availability,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paginationFromQuery(query, defaults = { page: 1, limit: 20 }) {
  const page = query.page === undefined ? defaults.page : Number(query.page);
  const limit = query.limit === undefined ? defaults.limit : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    invalid('page must be a positive integer and limit must be between 1 and 50');
  }
  return { page, limit };
}

function validateAdminAppointmentQuery(query) {
  const { page, limit } = paginationFromQuery(query);
  const filter = {};
  if (query.status !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(query.status)) invalid('status is not a valid appointment status');
    filter.status = query.status;
  }
  if (query.doctorId !== undefined) {
    if (typeof query.doctorId !== 'string' || !mongoose.isValidObjectId(query.doctorId)) invalid('doctorId must be a valid ID');
    filter.doctor = query.doctorId;
  }
  if (query.patientId !== undefined) {
    if (typeof query.patientId !== 'string' || !mongoose.isValidObjectId(query.patientId)) invalid('patientId must be a valid ID');
    filter.patient = query.patientId;
  }
  if (query.from !== undefined || query.to !== undefined) {
    if (query.from === undefined || query.to === undefined) invalid('from and to must be supplied together');
    let from;
    let to;
    try {
      from = parseInstant(query.from, 'from');
      to = parseInstant(query.to, 'to');
    } catch (error) {
      throw new AdminServiceError(400, error.code || 'INVALID_DATE', error.message);
    }
    if (to <= from) invalid('to must be later than from');
    if (to.getTime() - from.getTime() > MAX_ADMIN_DATE_RANGE_MS) invalid('Date range cannot exceed 366 days');
    filter.startsAt = { $gte: from, $lte: to };
  }
  return { page, limit, filter };
}

function appointmentDto(appointment) {
  const patient = appointment.patient;
  const doctor = appointment.doctor;
  return {
    id: String(appointment._id || appointment.id),
    startsAt: new Date(appointment.startsAt).toISOString(),
    endsAt: new Date(appointment.endsAt).toISOString(),
    status: appointment.status,
    reason: appointment.reason || '',
    patient: patient && { id: String(patient._id || patient.id), name: patient.name },
    doctor: doctor && {
      id: String(doctor._id || doctor.id),
      name: doctor.user?.name,
      specialty: doctor.specialty,
      consultationFee: doctor.consultationFee,
    },
    createdAt: appointment.createdAt,
  };
}

export function createAdminService({ User, Doctor, Appointment, hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS), clock = () => new Date() }) {
  async function listDoctors(query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      invalid('page must be positive and limit must be between 1 and 50');
    }
    const status = query.status || 'all';
    if (!['all', 'active', 'inactive'].includes(status)) invalid('status must be all, active, or inactive');
    const filter = {};
    if (query.q !== undefined) {
      if (typeof query.q !== 'string' || query.q.trim().length > 80) invalid('q must be 80 characters or fewer');
      const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
      const users = await User.find({ role: 'doctor', $or: [{ name: pattern }, { email: pattern }] }).distinct('_id');
      filter.$or = [{ specialty: pattern }, { bio: pattern }, { user: { $in: users } }];
    }
    if (status !== 'all') {
      const users = await User.find({ role: 'doctor', isActive: status === 'active' }).distinct('_id');
      filter.user = { $in: users };
    }
    const [records, total] = await Promise.all([
      Doctor.find(filter).populate({ path: 'user', select: 'name email role isActive' }).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit),
      Doctor.countDocuments(filter),
    ]);
    return { doctors: records.filter((doctor) => doctor.user?.role === 'doctor').map(doctorDto), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async function createDoctor(input) {
    const auth = validateRegistration(input);
    if (auth.error) invalid(auth.error);
    const specialty = typeof input.specialty === 'string' ? input.specialty.trim() : '';
    if (!specialty || specialty.length > 80) invalid('specialty must be between 1 and 80 characters');
    const fee = input.consultationFee;
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || fee > 1000000) invalid('consultationFee must be a number between 0 and 1000000');
    const bio = input.bio === undefined ? '' : input.bio;
    if (typeof bio !== 'string' || bio.length > 2000) invalid('bio must be 2000 characters or fewer');
    let availability;
    try {
      availability = validateAvailabilityInput({ timezone: input.timezone || 'Asia/Kolkata', availability: input.availability || [] });
    } catch (error) {
      throw new AdminServiceError(error.status || 400, error.code || 'INVALID_AVAILABILITY', error.message);
    }

    const { name, email, password } = auth.value;
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await User.create({ name, email, passwordHash, role: 'doctor', isActive: true });
    } catch (error) {
      if (error?.code === 11000) throw new AdminServiceError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
      throw error;
    }
    let doctor;
    try {
      doctor = await Doctor.create({ user: user._id, specialty, consultationFee: fee, bio: bio.trim(), ...availability });
    } catch (error) {
      // Compensate for a failed second insert; clean a possibly partial profile write too.
      await Doctor.deleteOne({ user: user._id });
      await User.deleteOne({ _id: user._id });
      if (error?.code === 11000) throw new AdminServiceError(409, 'DOCTOR_PROFILE_EXISTS', 'A doctor profile is already linked to this account');
      throw error;
    }
    await doctor.populate({ path: 'user', select: 'name email role isActive' });
    return { doctor: doctorDto(doctor) };
  }

  async function setDoctorStatus(doctorId, input) {
    if (!mongoose.isValidObjectId(doctorId)) throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    if (!input || typeof input.isActive !== 'boolean') invalid('isActive must be true or false');
    const doctor = await Doctor.findById(doctorId).populate({ path: 'user', select: 'name email role isActive' });
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor') throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    let changed;
    try {
      changed = await setUserStatus(doctor.user._id, input, undefined, { preventUpcoming: true });
    } catch (error) {
      if (error.code === 'USER_HAS_UPCOMING_APPOINTMENTS') {
        throw new AdminServiceError(409, 'DOCTOR_HAS_UPCOMING_APPOINTMENTS', error.message, error.details);
      }
      throw error;
    }
    doctor.user = changed.user;
    return { doctor: doctorDto(doctor) };
  }

  async function listAppointments(query = {}) {
    const { page, limit, filter } = validateAdminAppointmentQuery(query);
    const [records, total] = await Promise.all([
      Appointment.find(filter)
        .populate({ path: 'patient', select: 'name' })
        .populate({ path: 'doctor', select: 'specialty consultationFee user', populate: { path: 'user', select: 'name' } })
        .sort({ startsAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Appointment.countDocuments(filter),
    ]);
    return {
      appointments: records.map(appointmentDto),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async function getStatistics() {
    const [totalPatients, activeDoctorIds, groupedAppointments] = await Promise.all([
      User.countDocuments({ role: 'patient' }),
      User.find({ role: 'doctor', isActive: true }).distinct('_id'),
      Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const activeDoctors = await Doctor.countDocuments({ user: { $in: activeDoctorIds } });
    const appointmentsByStatus = Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, 0]));
    for (const row of groupedAppointments) {
      if (Object.hasOwn(appointmentsByStatus, row._id)) appointmentsByStatus[row._id] = row.count;
    }
    return {
      statistics: {
        totalPatients,
        activeDoctors,
        totalAppointments: Object.values(appointmentsByStatus).reduce((sum, count) => sum + count, 0),
        appointmentsByStatus,
      },
    };
  }

  async function listUsers(query = {}) {
    const { page, limit } = paginationFromQuery(query);
    const filter = {};
    if (query.role !== undefined) {
      if (!USER_ROLES.includes(query.role)) invalid('role must be patient, doctor, or admin');
      filter.role = query.role;
    }
    const status = query.status || 'all';
    if (!['all', 'active', 'inactive'].includes(status)) invalid('status must be all, active, or inactive');
    if (status !== 'all') filter.isActive = status === 'active';
    if (query.q !== undefined) {
      if (typeof query.q !== 'string' || query.q.trim().length > 80) invalid('q must be 80 characters or fewer');
      const search = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ name: search }, { email: search }];
    }
    const [records, total] = await Promise.all([
      User.find(filter).select('name email role isActive createdAt').sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    return {
      users: records.map((user) => ({ ...userDto(user), role: user.role, createdAt: user.createdAt })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async function setUserStatus(userId, input, actorId, { preventUpcoming = true } = {}) {
    if (!mongoose.isValidObjectId(userId)) throw new AdminServiceError(404, 'USER_NOT_FOUND', 'User not found');
    if (!input || typeof input.isActive !== 'boolean') invalid('isActive must be true or false');
    if (!input.isActive && actorId && String(userId) === String(actorId)) {
      throw new AdminServiceError(409, 'SELF_DEACTIVATION_NOT_ALLOWED', 'You cannot deactivate your own account');
    }
    const target = await User.findById(userId).select('name email role isActive');
    if (!target) throw new AdminServiceError(404, 'USER_NOT_FOUND', 'User not found');

    if (target.isActive && !input.isActive) {
      if (target.role === 'admin') {
        const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
        if (activeAdmins <= 1) throw new AdminServiceError(409, 'LAST_ACTIVE_ADMIN', 'The last active admin account cannot be deactivated');
      }
      if (preventUpcoming && ['doctor', 'patient'].includes(target.role)) {
        const doctor = target.role === 'doctor' ? await Doctor.findOne({ user: target._id }).select('_id') : null;
        const appointments = doctor || target.role === 'patient'
          ? await Appointment.find({
            status: { $in: ACTIVE_APPOINTMENT_STATUSES },
            startsAt: { $gt: clock() },
            [target.role === 'doctor' ? 'doctor' : 'patient']: target.role === 'doctor' ? doctor._id : target._id,
          }).select('_id startsAt status').sort({ startsAt: 1 })
          : [];
        if (appointments.length) {
          throw new AdminServiceError(409, 'USER_HAS_UPCOMING_APPOINTMENTS', 'Resolve future requested or accepted appointments before deactivating this account.', {
            appointments: appointments.map((appointment) => ({ id: String(appointment._id), startsAt: new Date(appointment.startsAt).toISOString(), status: appointment.status })),
          });
        }
      }
    }
    const user = await User.findByIdAndUpdate(userId, { $set: { isActive: input.isActive } }, { new: true }).select('name email role isActive createdAt');
    if (!user) throw new AdminServiceError(404, 'USER_NOT_FOUND', 'User not found');
    return { user: { ...userDto(user), role: user.role, createdAt: user.createdAt } };
  }

  async function updateDoctorProfile(doctorId, input = {}) {
    if (!mongoose.isValidObjectId(doctorId)) throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    const allowed = new Set(['specialty', 'bio', 'consultationFee', 'timezone', 'availability']);
    const keys = Object.keys(input);
    if (!keys.length || keys.some((key) => !allowed.has(key))) invalid('Only specialty, bio, consultationFee, timezone, and availability can be updated');
    const doctor = await Doctor.findById(doctorId).populate({ path: 'user', select: 'name email role isActive' });
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor') throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    const update = {};
    if (Object.hasOwn(input, 'specialty')) {
      if (typeof input.specialty !== 'string' || !input.specialty.trim() || input.specialty.trim().length > 80) invalid('specialty must be between 1 and 80 characters');
      update.specialty = input.specialty.trim();
    }
    if (Object.hasOwn(input, 'bio')) {
      if (typeof input.bio !== 'string' || input.bio.length > 2000) invalid('bio must be 2000 characters or fewer');
      update.bio = input.bio.trim();
    }
    if (Object.hasOwn(input, 'consultationFee')) {
      if (typeof input.consultationFee !== 'number' || !Number.isFinite(input.consultationFee) || input.consultationFee < 0 || input.consultationFee > 1000000) invalid('consultationFee must be a number between 0 and 1000000');
      update.consultationFee = input.consultationFee;
    }
    if (Object.hasOwn(input, 'timezone') || Object.hasOwn(input, 'availability')) {
      let schedule;
      try {
        schedule = validateAvailabilityInput({
          timezone: input.timezone ?? doctor.timezone,
          availability: input.availability ?? doctor.availability,
        });
      } catch (error) {
        throw new AdminServiceError(error.status || 400, error.code || 'INVALID_AVAILABILITY', error.message);
      }
      const appointments = await Appointment.find({
        doctor: doctor._id,
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        startsAt: { $gt: clock() },
      }).select('_id startsAt endsAt status').sort({ startsAt: 1 });
      const conflicts = appointments.filter((appointment) => !availabilityCoversAppointment(appointment, schedule.availability, schedule.timezone));
      if (conflicts.length) {
        throw new AdminServiceError(409, 'AVAILABILITY_CONFLICT', 'Changes would exclude future appointments. No profile changes were saved.', {
          appointments: conflicts.map((appointment) => ({ id: String(appointment._id), startsAt: new Date(appointment.startsAt).toISOString(), status: appointment.status })),
        });
      }
      Object.assign(update, schedule);
    }
    const updated = await Doctor.findByIdAndUpdate(doctorId, { $set: update }, { new: true, runValidators: true })
      .populate({ path: 'user', select: 'name email role isActive' });
    if (!updated) throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    return { doctor: doctorDto(updated) };
  }

  return { listDoctors, createDoctor, setDoctorStatus, listAppointments, getStatistics, listUsers, setUserStatus, updateDoctorProfile };
}
