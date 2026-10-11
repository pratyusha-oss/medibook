import { Router } from 'express';
import { Appointment } from '../models/Appointment.js';
import { Doctor } from '../models/Doctor.js';
import { User } from '../models/User.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createAdminService } from '../services/adminService.js';

const router = Router();
const admin = createAdminService({ User, Doctor, Appointment });

router.use(authenticate, requireRole('admin'));

router.get('/doctors', async (req, res, next) => {
  try {
    return res.json(await admin.listDoctors(req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/appointments', async (req, res, next) => {
  try {
    return res.json(await admin.listAppointments(req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    return res.json(await admin.getStatistics());
  } catch (error) {
    return next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    return res.json(await admin.listUsers(req.query));
  } catch (error) {
    return next(error);
  }
});

router.post('/doctors', async (req, res, next) => {
  try {
    return res.status(201).json(await admin.createDoctor(req.body));
  } catch (error) {
    return next(error);
  }
});

router.patch('/doctors/:doctorId', async (req, res, next) => {
  try {
    return res.json(await admin.updateDoctorProfile(req.params.doctorId, req.body));
  } catch (error) {
    return next(error);
  }
});

router.patch('/doctors/:doctorId/status', async (req, res, next) => {
  try {
    return res.json(await admin.setDoctorStatus(req.params.doctorId, req.body));
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:userId/status', async (req, res, next) => {
  try {
    return res.json(await admin.setUserStatus(req.params.userId, req.body, req.user._id));
  } catch (error) {
    return next(error);
  }
});

export default router;
