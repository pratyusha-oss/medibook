import mongoose from 'mongoose';

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
    consultationFee: { type: Number, required: true, min: 0 },
    bio: { type: String, default: '', trim: true, maxlength: 2000 },
    availability: { type: [availabilityWindowSchema], default: [] },
  },
  { timestamps: true },
);

export const Doctor = mongoose.model('Doctor', doctorSchema);
