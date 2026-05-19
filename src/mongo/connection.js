const mongoose = require('mongoose');

const READY_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting'
};

function readyStateLabel(state = mongoose.connection.readyState) {
  return READY_STATE_LABELS[state] || `unknown(${state})`;
}

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Set it in .env for local use or Render environment variables for deployment.');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once('connected', resolve);
      mongoose.connection.once('error', reject);
    });
    if (mongoose.connection.readyState !== 1) {
      throw new Error(`MongoDB connection failed; readyState=${readyStateLabel()}`);
    }
    return mongoose.connection;
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });

  if (mongoose.connection.readyState !== 1) {
    throw new Error(`MongoDB connection failed; readyState=${readyStateLabel()}`);
  }

  return mongoose.connection;
}

async function ensureMongoConnected() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error(`MongoDB is not connected; readyState=${readyStateLabel()}`);
  }
  return mongoose.connection;
}

async function closeMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = {
  connectMongo,
  ensureMongoConnected,
  closeMongo,
  mongoose,
  readyStateLabel
};
