import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Doctor } from '../models/Doctor.js';
import { Appointment } from '../models/Appointment.js';

export async function connectToDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), Doctor.init(), Appointment.init()]);
  console.info('Connected to MongoDB');
}
