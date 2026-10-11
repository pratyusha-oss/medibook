import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { validateRegistration } from '../utils/authValidation.js';
import { validateAvailabilityInput } from './doctorDashboardService.js';
import { ACTIVE_APPOINTMENT_STATUSES } from './appointmentService.js';

const SALT_ROUNDS = 12;

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
    if (doctor.user.isActive && !input.isActive) {
      const appointments = await Appointment.find({ doctor: doctor._id, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startsAt: { $gt: clock() } })
        .select('_id startsAt status').sort({ startsAt: 1 });
      if (appointments.length) {
        throw new AdminServiceError(409, 'DOCTOR_HAS_UPCOMING_APPOINTMENTS', 'Resolve future requested or accepted appointments before deactivating this doctor.', {
          appointments: appointments.map((appointment) => ({ id: String(appointment._id), startsAt: new Date(appointment.startsAt).toISOString(), status: appointment.status })),
        });
      }
    }
    const user = await User.findByIdAndUpdate(doctor.user._id, { $set: { isActive: input.isActive } }, { new: true }).select('name email role isActive');
    if (!user) throw new AdminServiceError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
    doctor.user = user;
    return { doctor: doctorDto(doctor) };
  }

  return { listDoctors, createDoctor, setDoctorStatus };
}
