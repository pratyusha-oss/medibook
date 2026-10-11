import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Doctor } from '../src/models/Doctor.js';
import { User } from '../src/models/User.js';

const DEMO_EMAIL = 'demo.doctor@medibook.test';
const DEMO_NAME = 'Dr. Maya Desai';
const SALT_ROUNDS = 12;
const AVAILABILITY = [1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '17:00',
}));

async function seedDoctor() {
  if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('The development doctor seed is disabled in production.');
  }

  const password = process.env.SEED_DOCTOR_PASSWORD;
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('SEED_DOCTOR_PASSWORD must be set and contain 8 to 72 UTF-8 bytes.');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User.init(), Doctor.init()]);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  let user = await User.findOne({ email: DEMO_EMAIL });

  if (user && user.role !== 'doctor') {
    throw new Error('The demo email already belongs to a non-doctor account; no changes were made.');
  }

  if (user) {
    user.name = DEMO_NAME;
    user.passwordHash = passwordHash;
    user.isActive = true;
    await user.save();
  } else {
    try {
      user = await User.create({
        name: DEMO_NAME,
        email: DEMO_EMAIL,
        passwordHash,
        role: 'doctor',
        isActive: true,
      });
    } catch (error) {
      // If two seed processes race on the unique email index, reuse the winner.
      if (error?.code !== 11000) throw error;
      user = await User.findOne({ email: DEMO_EMAIL });
      if (!user || user.role !== 'doctor') {
        throw new Error('The demo email was concurrently claimed by a non-doctor account.');
      }
      user.name = DEMO_NAME;
      user.passwordHash = passwordHash;
      user.isActive = true;
      await user.save();
    }
  }

  const doctor = await Doctor.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        specialty: 'Family Medicine',
        consultationFee: 650,
        bio: 'Dr. Maya Desai provides thoughtful primary care for adults and families, with a focus on preventive health and everyday wellbeing.',
        timezone: 'Asia/Kolkata',
        availability: AVAILABILITY,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  console.info(`Seeded active demo doctor ${DEMO_EMAIL} (profile ${doctor.id}).`);
}

seedDoctor()
  .catch(() => {
    // Avoid printing connection strings, passwords, or credential-bearing errors.
    const isProduction = process.env.NODE_ENV?.trim().toLowerCase() === 'production';
    console.error(isProduction
      ? 'The development doctor seed is disabled in production.'
      : 'Could not seed the demo doctor. Check the development database configuration and try again.');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
