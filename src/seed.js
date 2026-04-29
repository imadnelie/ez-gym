const fs = require('fs');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const { initDb, getDb, closeDb, dbPath, dataDir } = require('./db');

const shouldReset = process.argv.includes('--reset');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

if (shouldReset) {
  closeDb();
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

initDb();
const db = getDb();

function upsertSeeds() {
  const now = dayjs().toISOString();
  const hash = bcrypt.hashSync('jimmy123', 10);

  db.prepare(`
    INSERT INTO users (username, password_hash, role, active, created_at, updated_at)
    VALUES (@username, @password_hash, @role, 1, @now, @now)
    ON CONFLICT(username) DO UPDATE SET
      password_hash=excluded.password_hash,
      role=excluded.role,
      active=1,
      updated_at=excluded.updated_at
  `).run({ username: 'jimmy', password_hash: hash, role: 'super_admin', now });

  const branches = [
    { name: 'Branch 1', address: 'Main Street 10', phone: '555-1001' },
    { name: 'Branch 2', address: 'Center Avenue 22', phone: '555-1002' },
    { name: 'Branch 3', address: 'West Road 5', phone: '555-1003' }
  ];

  for (const b of branches) {
    db.prepare(`
      INSERT INTO branches (name, address, phone, active, created_at, updated_at)
      VALUES (@name, @address, @phone, 1, @now, @now)
      ON CONFLICT(name) DO UPDATE SET
        address=excluded.address,
        phone=excluded.phone,
        active=1,
        updated_at=excluded.updated_at
    `).run({ ...b, now });
  }

  const trainingTypes = [
    { name: 'EMS', duration_minutes: 30 },
    { name: 'PT', duration_minutes: 60 },
    { name: 'Slimming Machine', duration_minutes: 30 },
    { name: 'Sauna Blanket Machine', duration_minutes: 40 }
  ];

  for (const t of trainingTypes) {
    db.prepare(`
      INSERT INTO training_types (name, duration_minutes, active, created_at, updated_at)
      VALUES (@name, @duration_minutes, 1, @now, @now)
      ON CONFLICT(name) DO UPDATE SET
        duration_minutes=excluded.duration_minutes,
        active=1,
        updated_at=excluded.updated_at
    `).run({ ...t, now });
  }

  const tt = db.prepare('SELECT id, name FROM training_types').all();
  const ttByName = Object.fromEntries(tt.map((x) => [x.name, x.id]));

  const packages = [
    { name: 'EMS Starter 8', training_type_id: ttByName['EMS'], sessions_count: 8, price: 320, validity_days: 60, description: 'Starter EMS pack' },
    { name: 'PT Pro 12', training_type_id: ttByName['PT'], sessions_count: 12, price: 900, validity_days: 90, description: 'Personal training plan' },
    { name: 'Slim 10', training_type_id: ttByName['Slimming Machine'], sessions_count: 10, price: 450, validity_days: 60, description: 'Slimming machine sessions' },
    { name: 'Sauna 6', training_type_id: ttByName['Sauna Blanket Machine'], sessions_count: 6, price: 300, validity_days: 45, description: 'Sauna recovery package' }
  ];

  for (const p of packages) {
    db.prepare(`
      INSERT INTO packages (name, training_type_id, sessions_count, price, validity_days, description, active, created_at, updated_at)
      VALUES (@name, @training_type_id, @sessions_count, @price, @validity_days, @description, 1, @now, @now)
    `).run({ ...p, now });
  }

  const clients = [
    { first_name: 'Sara', last_name: 'Lee', phone: '555-2221', notes: 'Morning preferred' },
    { first_name: 'David', last_name: 'Stone', phone: '555-2222', notes: '' },
    { first_name: 'Mona', last_name: 'Ali', phone: '555-2223', notes: 'Back injury history' }
  ];

  const existingClients = db.prepare('SELECT COUNT(*) count FROM clients').get().count;
  if (!existingClients) {
    for (const c of clients) {
      db.prepare(`
        INSERT INTO clients (first_name, last_name, phone, notes, created_at, updated_at)
        VALUES (@first_name, @last_name, @phone, @notes, @now, @now)
      `).run({ ...c, now });
    }
  }

  const existingTrainers = db.prepare('SELECT COUNT(*) count FROM trainers').get().count;
  if (!existingTrainers) {
    const branchIds = db.prepare('SELECT id FROM branches').all().map((x) => x.id);
    const trainers = [
      { first_name: 'Adam', last_name: 'Cole', phone: '555-3111', supported_training_type_ids: JSON.stringify([ttByName['EMS'], ttByName['PT']]), branch_ids: JSON.stringify(branchIds.slice(0, 2)), notes: 'Senior trainer' },
      { first_name: 'Nina', last_name: 'Park', phone: '555-3112', supported_training_type_ids: JSON.stringify([ttByName['Slimming Machine'], ttByName['Sauna Blanket Machine']]), branch_ids: JSON.stringify(branchIds.slice(1)), notes: '' }
    ];

    for (const t of trainers) {
      db.prepare(`
        INSERT INTO trainers (first_name, last_name, phone, supported_training_type_ids, branch_ids, notes, active, created_at, updated_at)
        VALUES (@first_name, @last_name, @phone, @supported_training_type_ids, @branch_ids, @notes, 1, @now, @now)
      `).run({ ...t, now });
    }
  }

  console.log('Seed completed.');
  console.log('Super admin -> username: jimmy, password: jimmy123');
}

upsertSeeds();
closeDb();
