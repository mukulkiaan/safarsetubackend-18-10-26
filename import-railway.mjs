import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

async function importDb() {
  console.log('Connecting to Railway MySQL (altaria.proxy.rlwy.net:58076)...');
  const connection = await mysql.createConnection({
    host: 'altaria.proxy.rlwy.net',
    port: 58076,
    user: 'root',
    password: 'MvrSqyqLFxiYgxkVfFweetFufNYFtTcZ',
    database: 'railway',
    multipleStatements: true,
  });

  console.log('Connected successfully!');
  const sqlPath = path.resolve('..', 'cab-barwani.sql');
  console.log('Reading SQL file from:', sqlPath);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing SQL import into Railway MySQL...');
  await connection.query(sql);

  console.log('Verifying imported tables in database `railway`...');
  const [tables] = await connection.query('SHOW TABLES;');
  console.log('Tables in database `railway`:');

  for (const tableRow of tables) {
    const tableName = Object.values(tableRow)[0];
    const [[{ count }]] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    console.log(`  ✓ ${tableName} (${count} records)`);
  }

  await connection.end();
  console.log('\n--- SUCCESS: Database imported successfully into Railway MySQL! ---');
}

importDb().catch((err) => {
  console.error('Import failed with error:', err);
  process.exit(1);
});
