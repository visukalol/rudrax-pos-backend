const { Pool } = require('pg');
require('dotenv').config();

// PGSSL=true in .env enables SSL — required by cloud providers like Neon/Supabase.
const useSSL = process.env.PGSSL === 'true';

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

module.exports = pool;