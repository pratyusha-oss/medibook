import mongoose from 'mongoose';
import { createInterface } from 'node:readline/promises';

const replacementEmails = [
  'doctor1@gmail.com',
  'doctor2@gmail.com',
  'doctor3@gmail.com',
  'doctor4@gmail.com',
];
const appointmentStatuses = ['requested', 'accepted', 'rejected', 'cancelled', 'completed'];

function resolveDatabaseName(uri) {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]*(?:\/([^?#]*))?(?:\?([^#]*))?/i);
  if (!match) throw new Error('invalid-uri');

  const options = new URLSearchParams(match[2] || '');
  const dbNameOption = [...options.entries()].find(([key]) => key.toLowerCase() === 'dbname')?.[1];
  const pathName = match[1] ? decodeURIComponent(match[1].split('/')[0]) : '';
  const databaseName = dbNameOption || pathName || 'test';
  if (!databaseName || databaseName.includes('/') || databaseName.includes('\0')) {
    throw new Error('invalid-database-name');
  }
  return databaseName;
}

function asId(value) {
  return value == null ? null : String(value);
}

async function readInventory(db) {
  const doctors = await db.collection('doctors').find({}, {
    projection: { _id: 1, user: 1 },
  }).sort({ _id: 1 }).toArray();
  const doctorIds = doctors.map(({ _id }) => _id);
  const linkedUserIds = doctors.map(({ user }) => user).filter(Boolean);

  const linkedUsers = linkedUserIds.length
    ? await db.collection('users').find({ _id: { $in: linkedUserIds } }, {
      projection: { _id: 1, name: 1, email: 1, role: 1, isActive: 1 },
    }).toArray()
    : [];
  const userById = new Map(linkedUsers.map((user) => [String(user._id), user]));

  const countsByDoctor = new Map();
  if (doctorIds.length) {
    const groups = await db.collection('appointments').aggregate([
      { $match: { doctor: { $in: doctorIds } } },
      { $group: { _id: { doctor: '$doctor', status: '$status' }, count: { $sum: 1 } } },
    ]).toArray();
    for (const group of groups) {
      const doctorId = String(group._id.doctor);
      if (!countsByDoctor.has(doctorId)) countsByDoctor.set(doctorId, {});
      countsByDoctor.get(doctorId)[String(group._id.status)] = group.count;
    }
  }

  const doctorRows = doctors.map((doctor) => {
    const userId = asId(doctor.user);
    const user = userId ? userById.get(userId) : null;
    const counts = { ...Object.fromEntries(appointmentStatuses.map((status) => [status, 0])), ...(countsByDoctor.get(String(doctor._id)) || {}) };
    return {
      profileId: String(doctor._id),
      linkedUserId: userId,
      doctorName: user?.name ?? null,
      email: user?.email ?? null,
      role: user?.role ?? null,
      isActive: typeof user?.isActive === 'boolean' ? user.isActive : null,
      linkedUserExists: Boolean(user),
      appointmentsByStatus: counts,
    };
  });

  const emailPattern = (email) => new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const conflictUsers = await db.collection('users').find({
    $or: replacementEmails.map((email) => ({ email: emailPattern(email) })),
  }, {
    projection: { _id: 1, name: 1, email: 1, role: 1, isActive: 1 },
  }).toArray();
  const doctorsByUserId = new Map(doctors.filter((doctor) => doctor.user).map((doctor) => [String(doctor.user), String(doctor._id)]));
  const conflictsByEmail = new Map();
  for (const user of conflictUsers) {
    const key = String(user.email || '').toLowerCase();
    if (!conflictsByEmail.has(key)) conflictsByEmail.set(key, []);
    conflictsByEmail.get(key).push({
      userId: String(user._id),
      doctorProfileId: doctorsByUserId.get(String(user._id)) ?? null,
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role ?? null,
      isActive: typeof user.isActive === 'boolean' ? user.isActive : null,
    });
  }

  return {
    doctors: doctorRows,
    replacementEmailConflicts: replacementEmails.map((email) => ({
      email,
      exists: Boolean(conflictsByEmail.get(email)),
      accounts: conflictsByEmail.get(email) || [],
    })),
  };
}

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error('MONGODB_URI must be supplied in the process environment. The local .env file is not read.');
    process.exitCode = 1;
    return;
  }

  let databaseName;
  try {
    databaseName = resolveDatabaseName(uri);
  } catch {
    console.error('The MongoDB URI could not be safely resolved. No connection or query was made.');
    process.exitCode = 1;
    return;
  }

  // The database name is the only target detail printed before the operator confirms it.
  console.log(`Resolved database name: ${JSON.stringify(databaseName)}`);
  if (!process.stdin.isTTY) {
    console.error('Interactive confirmation is required. No connection or query was made.');
    process.exitCode = 1;
    return;
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let confirmation;
  try {
    confirmation = await prompt.question('Type this exact name only if it is the intended production database: ');
  } finally {
    prompt.close();
  }
  if (confirmation !== databaseName) {
    console.error('Database name was not confirmed. No connection or query was made.');
    process.exitCode = 1;
    return;
  }

  try {
    // This standalone script does not load app models or normal startup, and disables
    // Mongoose collection/index creation. Its database operations below are read-only.
    mongoose.set('debug', false);
    await mongoose.connect(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 15000,
    });

    const db = mongoose.connection.db;
    if (!db || db.databaseName !== databaseName) {
      console.error('Connected database did not match the confirmed database name. No collection query was run.');
      process.exitCode = 1;
      return;
    }

    const inventory = await readInventory(db);
    console.log(JSON.stringify({ databaseName, ...inventory }, null, 2));
  } catch (error) {
    console.error(`Read-only inventory failed (${error?.name || 'Error'}). No write operation is performed by this script.`);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

await main();
