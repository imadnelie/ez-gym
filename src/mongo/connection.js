const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Set it in .env for local use or Render environment variables for deployment.');
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });
  return mongoose.connection;
}

async function closeMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = { connectMongo, closeMongo, mongoose };
