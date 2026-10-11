import { Router } from 'express';
import { Appointment } from '../models/Appointment.js';
import { Doctor } from '../models/Doctor.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createDoctorDashboardService } from '../services/doctorDashboardService.js';

const router = Router();
const dashboard = createDoctorDashboardService({ Doctor, Appointment });

router.use(authenticate, requireRole('doctor'));

router.get('/me', async (req, res, next) => {
  try {
    return res.json(await dashboard.getProfile(req.user._id));
  } catch (error) {
    return next(error);
  }
});

router.put('/me/availability', async (req, res, next) => {
  try {
    return res.json(await dashboard.updateAvailability(req.user._id, req.body));
  } catch (error) {
    return next(error);
  }
});

router.get('/appointments', async (req, res, next) => {
  try {
    return res.json(await dashboard.listAppointments(req.user._id, req.query));
  } catch (error) {
    return next(error);
  }
});

router.patch('/appointments/:id/status', async (req, res, next) => {
  try {
    return res.json(await dashboard.updateAppointmentStatus(req.user._id, req.params.id, req.body));
  } catch (error) {
    return next(error);
  }
});

export default router;
