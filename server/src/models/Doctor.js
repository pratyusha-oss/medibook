import mongoose from 'mongoose';

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

const availabilityWindowSchema = new mongoose.Schema(
  {
    weekday: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
    endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
  },
  { _id: false },
);

const doctorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    specialty: { type: String, required: true, trim: true, maxlength: 80 },
    qualification: { type: String, default: '', trim: true, maxlength: 180 },
    registrationNumber: { type: String, default: '', trim: true, maxlength: 100 },
    languages: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    clinicAddress: { type: String, default: '', trim: true, maxlength: 300 },
    isFictionalDemo: { type: Boolean, default: false },
    consultationFee: { type: Number, required: true, min: 0 },
    bio: { type: String, default: '', trim: true, maxlength: 2000 },
    timezone: {
      type: String,
      required: true,
      default: DEFAULT_TIME_ZONE,
      validate: {
        validator(value) {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value });
            return true;
          } catch {
            return false;
          }
        },
        message: 'timezone must be a valid IANA timezone',
      },
    },
    availability: { type: [availabilityWindowSchema], default: [] },
  },
  { timestamps: true },
);

export const Doctor = mongoose.model('Doctor', doctorSchema);
