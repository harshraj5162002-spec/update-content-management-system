require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
const aiProvider = process.env.AI_PROVIDER || 'local';
const defaultCorsOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
if (nodeEnv === 'production' && (jwtSecret.length < 32 || jwtSecret === 'dev-secret-change-me')) {
  throw new Error('JWT_SECRET must be set to a unique value with at least 32 characters in production.');
}
if (!['local', 'gemini'].includes(aiProvider)) {
  throw new Error('AI_PROVIDER must be either "local" or "gemini".');
}
if (aiProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required when AI_PROVIDER is "gemini".');
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  jwtSecret,
  mongoUri: process.env.MONGODB_URI || '',
  nodeEnv,
  corsOrigins: [...new Set([
    ...(process.env.CORS_ORIGIN || defaultCorsOrigins.join(',')).split(',').map((origin) => origin.trim()).filter(Boolean),
    ...(nodeEnv === 'development' ? defaultCorsOrigins : []),
  ])],
  aiProvider,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
};
