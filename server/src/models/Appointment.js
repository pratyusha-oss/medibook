import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['requested', 'accepted', 'rejected', 'cancelled', 'completed'],
      default: 'requested',
      required: true,
    },
    reason: { type: String, default: '', trim: true, maxlength: 500 },
    // Present only while a slot is reserved; a unique sparse index lets MongoDB
    // reject two concurrent bookings for the same doctor and start time.
    activeSlotKey: { type: String, select: false },
  },
  { timestamps: true },
);

appointmentSchema.index({ activeSlotKey: 1 }, { unique: true, sparse: true });
appointmentSchema.index({ doctor: 1, status: 1, startsAt: 1 });
appointmentSchema.index({ patient: 1, startsAt: -1 });

export const Appointment = mongoose.model('Appointment', appointmentSchema);
