import { Router } from 'express';
import { Appointment } from '../models/Appointment.js';
import { Doctor } from '../models/Doctor.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createAppointmentService } from '../services/appointmentService.js';

const router = Router();
const appointments = createAppointmentService({ Doctor, Appointment });

router.post('/', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const appointment = await appointments.book(req.user._id, req.body);
    return res.status(201).json({ appointment });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    return res.json(await appointments.listForPatient(req.user._id, req.query));
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/cancel', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const appointment = await appointments.cancelForPatient(req.user._id, req.params.id);
    return res.json({ appointment });
  } catch (error) {
    return next(error);
  }
});

export default router;
