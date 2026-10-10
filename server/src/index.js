import 'dotenv/config';
import app from './app.js';
import { connectToDatabase } from './config/db.js';
import { getJwtSecret } from './utils/jwt.js';

const port = Number(process.env.PORT) || 5000;

try {
  getJwtSecret();
  await connectToDatabase();
  app.listen(port, () => console.info(`MediBook API listening on port ${port}`));
} catch (error) {
  console.error('Server startup failed:', error.message);
  process.exitCode = 1;
}
