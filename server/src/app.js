import cors from 'cors';
import express from 'express';
import authRouter from './routes/auth.js';
import doctorsRouter from './routes/doctors.js';
import appointmentsRouter from './routes/appointments.js';
import doctorDashboardRouter from './routes/doctorDashboard.js';
import adminRouter from './routes/admin.js';
import { getAllowedClientOrigins } from './config/cors.js';

const app = express();

app.use(
  cors({
    origin: getAllowedClientOrigins(),
  }),
);
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'medibook-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/doctors', doctorsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/doctor', doctorDashboardRouter);
app.use('/api/admin', adminRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use((err, _req, res, _next) => {
  const malformedJson = err.type === 'entity.parse.failed';
  const status = malformedJson
    ? 400
    : (Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500);
  const code = malformedJson
    ? 'INVALID_JSON'
    : (status < 500 && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR');
  const message = status < 500
    ? err.message
    : 'Something went wrong';
  if (status >= 500) console.error('Request failed', { errorName: err.name || 'Error' });
  const error = { code, message };
  if (status < 500 && ['DoctorDashboardError', 'AdminServiceError'].includes(err.name) && err.details !== undefined) error.details = err.details;
  res.status(status).json({ error });
});

export default app;
