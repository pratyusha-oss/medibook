import { Router } from 'express';
import mongoose from 'mongoose';
import { Doctor } from '../models/Doctor.js';
import { Appointment } from '../models/Appointment.js';
import { User } from '../models/User.js';
import { escapeRegex, parseDoctorListQuery } from '../utils/doctorQuery.js';
import { createAppointmentService, SLOT_DURATION_MINUTES } from '../services/appointmentService.js';

const router = Router();
const appointmentService = createAppointmentService({ Doctor, Appointment });

function publicDoctor(doctor) {
  return {
    id: doctor.id,
    name: doctor.user.name,
    specialty: doctor.specialty,
    consultationFee: doctor.consultationFee,
    bio: doctor.bio,
    availability: doctor.availability,
  };
}

function invalidQuery(res, message) {
  return res.status(400).json({ error: { code: 'INVALID_QUERY', message } });
}

router.get('/', async (req, res) => {
  const parsed = parseDoctorListQuery(req.query);
  if (parsed.error) return invalidQuery(res, parsed.error);

  const { q, specialty, page, limit, feeMax } = parsed.value;
  const activeDoctorIds = await User.find({ role: 'doctor', isActive: true }).distinct('_id');
  const filter = { user: { $in: activeDoctorIds } };

  if (specialty) filter.specialty = new RegExp(escapeRegex(specialty), 'i');
  if (feeMax !== undefined) filter.consultationFee = { $lte: feeMax };

  if (q) {
    const search = new RegExp(escapeRegex(q), 'i');
    const matchingUsers = await User.find({
      role: 'doctor',
      isActive: true,
      name: search,
    }).distinct('_id');
    filter.$or = [{ specialty: search }, { bio: search }, { user: { $in: matchingUsers } }];
  }

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .populate({ path: 'user', select: 'name' })
      .sort({ consultationFee: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Doctor.countDocuments(filter),
  ]);

  return res.json({
    doctors: doctors.map(publicDoctor),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

router.get('/:doctorId/slots', async (req, res, next) => {
  try {
    const { timezone, slots } = await appointmentService.getDoctorSlots(req.params.doctorId, req.query);
    return res.json({
      doctorId: req.params.doctorId,
      timezone,
      slotDurationMinutes: SLOT_DURATION_MINUTES,
      slots: slots.map(({ startsAt, endsAt }) => ({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' } });
  }

  const doctor = await Doctor.findById(req.params.id)
    .populate({ path: 'user', select: 'name', match: { role: 'doctor', isActive: true } });
  if (!doctor || !doctor.user) {
    return res.status(404).json({ error: { code: 'DOCTOR_NOT_FOUND', message: 'Doctor not found' } });
  }

  return res.json({ doctor: publicDoctor(doctor) });
});

export default router;
