const { mongoose } = require('../connection');

const { Schema } = mongoose;

const schemaOptions = {
  versionKey: false,
  minimize: false
};

const legacyId = {
  type: Number,
  required: true,
  unique: true,
  index: true
};

const User = mongoose.model('User', new Schema({
  legacyId,
  username: { type: String, required: true, unique: true, index: true },
  password_hash: { type: String, required: true },
  role: { type: String, required: true },
  active: { type: Boolean, default: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Branch = mongoose.model('Branch', new Schema({
  legacyId,
  name: { type: String, required: true, unique: true, index: true },
  active: { type: Boolean, default: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const TrainingType = mongoose.model('TrainingType', new Schema({
  legacyId,
  name: { type: String, required: true, unique: true, index: true },
  duration_minutes: { type: Number, required: true },
  active: { type: Boolean, default: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Client = mongoose.model('Client', new Schema({
  legacyId,
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  phone: { type: String, required: true },
  notes: { type: String, default: null },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Trainer = mongoose.model('Trainer', new Schema({
  legacyId,
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  phone: { type: String, default: null },
  supported_training_type_ids: [{ type: Number }],
  supportedTrainingTypes: [{ type: Schema.Types.ObjectId, ref: 'TrainingType' }],
  branch_ids: [{ type: Number }],
  branches: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
  notes: { type: String, default: null },
  active: { type: Boolean, default: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Package = mongoose.model('Package', new Schema({
  legacyId,
  name: { type: String, required: true, index: true },
  training_type_id: { type: Number, required: true, index: true },
  trainingType: { type: Schema.Types.ObjectId, ref: 'TrainingType' },
  sessions_count: { type: Number, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: null },
  active: { type: Boolean, default: true },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Purchase = mongoose.model('Purchase', new Schema({
  legacyId,
  client_id: { type: Number, required: true, index: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  package_id: { type: Number, required: true, index: true },
  package: { type: Schema.Types.ObjectId, ref: 'Package' },
  package_snapshot: { type: Schema.Types.Mixed, required: true },
  training_type_id: { type: Number, required: true, index: true },
  trainingType: { type: Schema.Types.ObjectId, ref: 'TrainingType' },
  sessions_purchased: { type: Number, required: true },
  sessions_used: { type: Number, default: 0 },
  sessions_remaining: { type: Number, required: true },
  purchase_date: { type: String, required: true },
  expiry_date: { type: String, default: null },
  status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active', index: true },
  created_by: { type: Number, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Payment = mongoose.model('Payment', new Schema({
  legacyId,
  client_id: { type: Number, default: null, index: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  package_purchase_id: { type: Number, default: null, index: true },
  packagePurchase: { type: Schema.Types.ObjectId, ref: 'Purchase' },
  amount_paid: { type: Number, required: true },
  payment_date: { type: String, required: true, index: true },
  payment_method: { type: String, required: true },
  notes: { type: String, default: null },
  branch_id: { type: Number, default: null, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  created_by: { type: Number, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Expense = mongoose.model('Expense', new Schema({
  legacyId,
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: String, required: true, index: true },
  branch_id: { type: Number, default: null, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  notes: { type: String, default: null },
  created_by: { type: Number, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true }
}, schemaOptions));

const Booking = mongoose.model('Booking', new Schema({
  legacyId,
  client_id: { type: Number, required: true, index: true },
  client: { type: Schema.Types.ObjectId, ref: 'Client' },
  trainer_id: { type: Number, required: true, index: true },
  trainer: { type: Schema.Types.ObjectId, ref: 'Trainer' },
  branch_id: { type: Number, required: true, index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  training_type_id: { type: Number, required: true, index: true },
  trainingType: { type: Schema.Types.ObjectId, ref: 'TrainingType' },
  package_purchase_id: { type: Number, required: true, index: true },
  packagePurchase: { type: Schema.Types.ObjectId, ref: 'Purchase' },
  start_at: { type: String, required: true, index: true },
  end_at: { type: String, required: true },
  status: { type: String, enum: ['booked', 'completed', 'cancelled', 'no-show'], default: 'booked', index: true },
  notes: { type: String, default: null },
  created_by: { type: Number, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: String, required: true },
  updated_at: { type: String, required: true },
  completed_session_deducted: { type: Boolean, default: false }
}, schemaOptions));

module.exports = {
  User,
  Client,
  TrainingType,
  Package,
  Purchase,
  Trainer,
  Branch,
  Booking,
  Payment,
  Expense
};
