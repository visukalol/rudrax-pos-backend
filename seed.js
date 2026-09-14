// Run once after schema.sql has been loaded:
//   npm run seed
// This overwrites the placeholder PIN hashes with real bcrypt hashes so
// you can sign in with PIN 1234 (Rohit Patel / manager) or 1111 (Bob Patel / cashier).
const bcrypt = require('bcryptjs');
const pool = require('./db/pool');

async function run() {
  const rohitHash = await bcrypt.hash('1234', 10);
  const bobHash = await bcrypt.hash('1111', 10);

  await pool.query('UPDATE employees SET pin_hash = $1 WHERE full_name = $2', [rohitHash, 'Rohit Patel']);
  await pool.query('UPDATE employees SET pin_hash = $1 WHERE full_name = $2', [bobHash, 'Bob Patel']);

  console.log('Seed complete. Sign in with PIN 1234 (Rohit / manager) or 1111 (Bob / cashier).');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
