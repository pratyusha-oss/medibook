import cors from 'cors';
import express from 'express';
import authRouter from './routes/auth.js';
import doctorsRouter from './routes/doctors.js';
import appointmentsRouter from './routes/appointments.js';

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
  }),
);
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'medibook-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/doctors', doctorsRouter);
app.use('/api/appointments', appointmentsRouter);

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
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { code, message } });
});

export default app;
