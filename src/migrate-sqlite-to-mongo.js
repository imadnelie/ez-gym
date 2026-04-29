require('dotenv').config();
const fs = require('fs');
const Database = require('better-sqlite3');
const { dbPath, dataDir } = require('./db');
const { connectMongo, closeMongo } = require('./mongo/connection');
const models = require('./mongo/models');

const {
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
} = models;

const backupPath = `${dataDir}/gym_backup_before_mongo_migration.sqlite`;

function asBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function readAll(db, table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}

async function upsertByLegacy(Model, legacyId, payload) {
  await Model.updateOne({ legacyId }, { $set: payload, $setOnInsert: { legacyId } }, { upsert: true });
  return Model.findOne({ legacyId });
}

async function mapByLegacy(Model) {
  const rows = await Model.find({}, '_id legacyId').lean();
  return new Map(rows.map((row) => [row.legacyId, row._id]));
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to migrate data to MongoDB.');
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found: ${dbPath}`);
  }

  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(backupPath);
    console.log(`SQLite backup created: ${backupPath}`);

    await connectMongo();
    await Promise.all(Object.values(models).map((Model) => Model.init()));

    const counts = {};

    const users = readAll(sqlite, 'users');
    for (const u of users) {
      await upsertByLegacy(User, u.id, {
        username: u.username,
        password_hash: u.password_hash,
        role: u.role,
        active: asBool(u.active),
        created_at: u.created_at,
        updated_at: u.updated_at
      });
    }
    counts.users = users.length;

    const branches = readAll(sqlite, 'branches');
    for (const b of branches) {
      await upsertByLegacy(Branch, b.id, {
        name: b.name,
        active: asBool(b.active),
        created_at: b.created_at,
        updated_at: b.updated_at
      });
    }
    counts.branches = branches.length;

    const trainingTypes = readAll(sqlite, 'training_types');
    for (const t of trainingTypes) {
      await upsertByLegacy(TrainingType, t.id, {
        name: t.name,
        duration_minutes: t.duration_minutes,
        active: asBool(t.active),
        created_at: t.created_at,
        updated_at: t.updated_at
      });
    }
    counts.trainingTypes = trainingTypes.length;

    const clients = readAll(sqlite, 'clients');
    for (const c of clients) {
      await upsertByLegacy(Client, c.id, {
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        notes: c.notes ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at
      });
    }
    counts.clients = clients.length;

    const typeMap = await mapByLegacy(TrainingType);
    const branchMap = await mapByLegacy(Branch);
    const clientMap = await mapByLegacy(Client);
    const userMap = await mapByLegacy(User);

    const trainers = readAll(sqlite, 'trainers');
    for (const tr of trainers) {
      const supportedIds = parseJson(tr.supported_training_type_ids, []).map(Number);
      const branchIds = parseJson(tr.branch_ids, []).map(Number);
      await upsertByLegacy(Trainer, tr.id, {
        first_name: tr.first_name,
        last_name: tr.last_name,
        phone: tr.phone ?? null,
        supported_training_type_ids: supportedIds,
        supportedTrainingTypes: supportedIds.map((id) => typeMap.get(id)).filter(Boolean),
        branch_ids: branchIds,
        branches: branchIds.map((id) => branchMap.get(id)).filter(Boolean),
        notes: tr.notes ?? null,
        active: asBool(tr.active),
        created_at: tr.created_at,
        updated_at: tr.updated_at
      });
    }
    counts.trainers = trainers.length;

    const packages = readAll(sqlite, 'packages');
    for (const p of packages) {
      await upsertByLegacy(Package, p.id, {
        name: p.name,
        training_type_id: p.training_type_id,
        trainingType: typeMap.get(p.training_type_id),
        sessions_count: p.sessions_count,
        price: p.price,
        description: p.description ?? null,
        active: asBool(p.active),
        created_at: p.created_at,
        updated_at: p.updated_at
      });
    }
    counts.packages = packages.length;

    const packageMap = await mapByLegacy(Package);

    const purchases = readAll(sqlite, 'client_package_purchases');
    for (const p of purchases) {
      await upsertByLegacy(Purchase, p.id, {
        client_id: p.client_id,
        client: clientMap.get(p.client_id),
        package_id: p.package_id,
        package: packageMap.get(p.package_id),
        package_snapshot: parseJson(p.package_snapshot, {}),
        training_type_id: p.training_type_id,
        trainingType: typeMap.get(p.training_type_id),
        sessions_purchased: p.sessions_purchased,
        sessions_used: p.sessions_used,
        sessions_remaining: p.sessions_remaining,
        purchase_date: p.purchase_date,
        expiry_date: p.expiry_date ?? null,
        status: p.status || 'active',
        created_by: p.created_by ?? null,
        createdBy: p.created_by ? userMap.get(p.created_by) : undefined,
        created_at: p.created_at,
        updated_at: p.updated_at
      });
    }
    counts.purchases = purchases.length;

    const purchaseMap = await mapByLegacy(Purchase);

    const payments = readAll(sqlite, 'payments');
    for (const p of payments) {
      await upsertByLegacy(Payment, p.id, {
        client_id: p.client_id ?? null,
        client: p.client_id ? clientMap.get(p.client_id) : undefined,
        package_purchase_id: p.package_purchase_id ?? null,
        packagePurchase: p.package_purchase_id ? purchaseMap.get(p.package_purchase_id) : undefined,
        amount_paid: p.amount_paid,
        payment_date: p.payment_date,
        payment_method: p.payment_method,
        notes: p.notes ?? null,
        branch_id: p.branch_id ?? null,
        branch: p.branch_id ? branchMap.get(p.branch_id) : undefined,
        created_by: p.created_by ?? null,
        createdBy: p.created_by ? userMap.get(p.created_by) : undefined,
        created_at: p.created_at,
        updated_at: p.updated_at
      });
    }
    counts.payments = payments.length;

    const expenses = readAll(sqlite, 'expenses');
    for (const e of expenses) {
      await upsertByLegacy(Expense, e.id, {
        title: e.title,
        amount: e.amount,
        date: e.date,
        branch_id: e.branch_id ?? null,
        branch: e.branch_id ? branchMap.get(e.branch_id) : undefined,
        notes: e.notes ?? null,
        created_by: e.created_by ?? null,
        createdBy: e.created_by ? userMap.get(e.created_by) : undefined,
        created_at: e.created_at,
        updated_at: e.updated_at
      });
    }
    counts.expenses = expenses.length;

    const trainerMap = await mapByLegacy(Trainer);

    const bookings = readAll(sqlite, 'bookings');
    for (const b of bookings) {
      await upsertByLegacy(Booking, b.id, {
        client_id: b.client_id,
        client: clientMap.get(b.client_id),
        trainer_id: b.trainer_id,
        trainer: trainerMap.get(b.trainer_id),
        branch_id: b.branch_id,
        branch: branchMap.get(b.branch_id),
        training_type_id: b.training_type_id,
        trainingType: typeMap.get(b.training_type_id),
        package_purchase_id: b.package_purchase_id,
        packagePurchase: purchaseMap.get(b.package_purchase_id),
        start_at: b.start_at,
        end_at: b.end_at,
        status: b.status || 'booked',
        notes: b.notes ?? null,
        created_by: b.created_by ?? null,
        createdBy: b.created_by ? userMap.get(b.created_by) : undefined,
        created_at: b.created_at,
        updated_at: b.updated_at,
        completed_session_deducted: asBool(b.completed_session_deducted, false)
      });
    }
    counts.bookings = bookings.length;

    console.log('MongoDB migration complete. Upserted rows:');
    for (const [name, count] of Object.entries(counts)) console.log(`${name}: ${count}`);
  } finally {
    sqlite.close();
    await closeMongo();
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
