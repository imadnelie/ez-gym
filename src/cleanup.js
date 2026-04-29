const readline = require('readline');
const fs = require('fs');
const Database = require('better-sqlite3');
const { dbPath, dataDir } = require('./db');

const backupPath = `${dataDir}/gym_backup_before_cleanup.sqlite`;

function askConfirmation() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('This will permanently delete packages, purchases, and bookings. Continue? (yes/no) ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const confirmed = await askConfirmation();
  if (!confirmed) {
    console.log('Cleanup cancelled. No records were deleted.');
    return;
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  try {
    await db.backup(backupPath);
    console.log(`Backup created: ${backupPath}`);

    const protectedTables = ['clients', 'trainers', 'branches', 'training_types', 'users'];
    const protectedCountsBefore = Object.fromEntries(protectedTables.map((table) => [table, countRows(db, table)]));

    const deleted = db.transaction(() => {
      const bookings = db.prepare('DELETE FROM bookings').run().changes;
      const linkedPayments = db.prepare('DELETE FROM payments WHERE package_purchase_id IS NOT NULL').run().changes;
      const purchases = db.prepare('DELETE FROM client_package_purchases').run().changes;
      const packages = db.prepare('DELETE FROM packages').run().changes;
      return { bookings, linkedPayments, purchases, packages };
    })();

    const protectedCountsAfter = Object.fromEntries(protectedTables.map((table) => [table, countRows(db, table)]));
    const changedProtectedTables = protectedTables.filter((table) => protectedCountsBefore[table] !== protectedCountsAfter[table]);
    if (changedProtectedTables.length) {
      throw new Error(`Protected table counts changed unexpectedly: ${changedProtectedTables.join(', ')}`);
    }

    console.log('Cleanup complete.');
    console.log(`Deleted bookings: ${deleted.bookings}`);
    console.log(`Deleted linked payments: ${deleted.linkedPayments}`);
    console.log(`Deleted purchases: ${deleted.purchases}`);
    console.log(`Deleted packages: ${deleted.packages}`);
    console.log('Verified empty tables:');
    console.log(`packages: ${countRows(db, 'packages')}`);
    console.log(`client_package_purchases: ${countRows(db, 'client_package_purchases')}`);
    console.log(`bookings: ${countRows(db, 'bookings')}`);
    console.log('Protected table row counts unchanged: clients, trainers, branches, training_types, users');
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Cleanup failed: ${err.message}`);
  process.exit(1);
});
