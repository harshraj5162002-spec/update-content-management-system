const mongoose = require('mongoose');
const { mongoUri } = require('./env');

async function connectDb() {
  if (!mongoUri) {
    console.log('MongoDB not configured; running with in-memory demo data.');
    return false;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB connected');
    return true;
  } catch (error) {
    console.warn('MongoDB connection failed. Falling back to in-memory mode:', error.message);
    return false;
  }
}

module.exports = { connectDb };
