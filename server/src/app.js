import cors from 'cors';
import express from 'express';
import authRouter from './routes/auth.js';
import doctorsRouter from './routes/doctors.js';

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

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status === 400 ? 400 : 500;
  const code = status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
  const message = status === 400 ? 'Request body must contain valid JSON' : 'Something went wrong';
  res.status(status).json({ error: { code, message } });
});

export default app;
