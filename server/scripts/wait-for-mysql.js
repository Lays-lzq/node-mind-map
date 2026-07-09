import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: 'server/.env' });
dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root'
};

const maxAttempts = 30;
const delayMs = 2000;

async function waitForMySQL() {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const connection = await mysql.createConnection(dbConfig);
            await connection.ping();
            await connection.end();
            console.log('MySQL is ready.');
            return;
        } catch (error) {
            console.log(`Waiting for MySQL... (${attempt}/${maxAttempts})`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw new Error('MySQL did not become ready in time. Run `npm run db:up` and try again.');
}

waitForMySQL().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
