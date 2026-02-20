const mysql = require('mysql2/promise');
const os = require('os');

// Get the server's IP address
const serverIP = os.networkInterfaces()['eth0']?.find(interface => interface.family === 'IPv4')?.address || 'localhost';

// Determine which host to use
const host = (serverIP === '63.250.41.172') ? 'localhost' : '63.250.41.172';

// MySQL connection setup
const pool = mysql.createPool({
    host: host,  // Dynamically set the host based on the server IP
    user: 'swiftnet',
    password: 'qa0odOWFVvdV90E9',
    database: 'swiftnet',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "+03:00"
});

module.exports = pool;
