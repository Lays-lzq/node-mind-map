import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4'
};

async function runSqlFile(connection, filename) {
    const filePath = path.join(__dirname, '..', 'sql', filename);
    const sql = await fs.readFile(filePath, 'utf8');
    await connection.query(sql);
    console.log(`✓ Executed ${filename}`);
}

async function main() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        console.log('Initializing MySQL database...');
        await runSqlFile(connection, 'schema.sql');
        await runSqlFile(connection, 'seed.sql');
        console.log('Database initialized successfully.');
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
});
