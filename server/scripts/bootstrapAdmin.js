import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { validateRegistration } from '../src/utils/authValidation.js';

const SALT_ROUNDS = 12;
const LOCK_ID = 'first-admin-bootstrap-v1';
const PRODUCTION_CONFIRMATION = 'CREATE_FIRST_ADMIN_IN_PRODUCTION';
const STALE_LOCK_MS = 10 * 60 * 1000;

async function claimBootstrapLock(lockCollection) {
  try {
    await lockCollection.insertOne({ _id: LOCK_ID, createdAt: new Date() });
    return;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const [existingLock, adminCount] = await Promise.all([
    lockCollection.findOne({ _id: LOCK_ID }),
    User.countDocuments({ role: 'admin' }),
  ]);
  if (adminCount > 0 || !existingLock || Date.now() - new Date(existingLock.createdAt).getTime() < STALE_LOCK_MS) {
    throw new Error('The first-admin bootstrap has already been used or is currently running.');
  }

  // Recover only a stale in-progress marker when no admin exists. Exact timestamp matching
  // ensures that concurrent recovery attempts have a single winner.
  const removed = await lockCollection.deleteOne({ _id: LOCK_ID, createdAt: existingLock.createdAt });
  if (removed.deletedCount !== 1) throw new Error('The first-admin bootstrap is currently running.');
  await lockCollection.insertOne({ _id: LOCK_ID, createdAt: new Date() });
}

async function bootstrapAdmin() {
  const production = process.env.NODE_ENV?.trim().toLowerCase() === 'production';
  if (production && !(
    process.env.ADMIN_BOOTSTRAP_ALLOW_PRODUCTION === 'true' &&
    process.env.ADMIN_BOOTSTRAP_PRODUCTION_CONFIRMATION === PRODUCTION_CONFIRMATION
  )) {
    throw new Error('Production bootstrap requires explicit production opt-in and confirmation.');
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const input = {
    name: process.env.ADMIN_BOOTSTRAP_NAME,
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  };
  const validated = validateRegistration(input);
  if (validated.error) throw new Error(`Invalid bootstrap configuration: ${validated.error}`);

  await mongoose.connect(process.env.MONGODB_URI);
  await User.init();
  const lockCollection = mongoose.connection.collection('admin_bootstrap_locks');
  // A persistent singleton lock makes simultaneous runs safe even with different email addresses.
  await claimBootstrapLock(lockCollection);

  try {
    const count = await User.countDocuments({ role: 'admin' });
    if (count !== 0) throw new Error('An admin account already exists; bootstrap refused.');
    const passwordHash = await bcrypt.hash(validated.value.password, SALT_ROUNDS);
    await User.create({
      name: validated.value.name,
      email: validated.value.email,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
  } catch (error) {
    await lockCollection.deleteOne({ _id: LOCK_ID });
    if (error?.code === 11000) throw new Error('An account with the configured email already exists.');
    throw error;
  }
}

bootstrapAdmin()
  .then(() => console.info('Initial admin account created. Sign in through the MediBook login page.'))
  .catch((error) => {
    // Avoid printing the raw database error, which may contain credential-bearing connection data.
    console.error(error.message.startsWith('Invalid bootstrap configuration:') || error.message.includes('already') || error.message.includes('Production')
      ? error.message
      : 'Admin bootstrap failed. Check the database configuration and try again.');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
