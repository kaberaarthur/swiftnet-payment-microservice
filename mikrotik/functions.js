const pool = require('../db');  // Import the connection pool from db.js
const { Client } = require('ssh2');

// New function to get client details
function getClientDetails(customer_id, callback) {
    const query = `
        SELECT full_name, phone_number, router_id, company_username, location 
        FROM pppoe_clients 
        WHERE id = ?
    `;
    
    pool.query(query, [customer_id], (err, results) => {
        if (err) {
            console.error("Error fetching client details:", err);
            return callback(err, null);
        }
        
        if (results.length > 0) {
            // Return the first (and should be only) result
            callback(null, results[0]);
        } else {
            console.log(`No client found with ID ${customer_id}`);
            callback(null, null);
        }
    });
}

function setInactive(customer_id) {
    const getClientQuery = `
        SELECT full_name, phone_number, router_id, company_username, location 
        FROM pppoe_clients 
        WHERE id = ?
    `;
    
    pool.query(getClientQuery, [customer_id], (err, clientResults) => {
        if (err) {
            console.error("Error fetching client details:", err);
            return;
        }

        // Proceed with update if client exists
        if (clientResults.length > 0) {
            const client = clientResults[0];
            const updateQuery = "UPDATE pppoe_clients SET active = 0 WHERE id = ?";
            
            pool.query(updateQuery, [customer_id], (err, updateResults) => {
                if (err) {
                    console.error("Error updating customer:", err);
                    return;
                }

                if (updateResults.affectedRows > 0) {
                    console.log(`Customer with ID ${customer_id} is now inactive.`);

                    // Construct the log description
                    const description = `System set the user ${client.full_name} of ${client.phone_number} to inactive`;
                    
                    // Insert into local_logs
                    const logQuery = `
                        INSERT INTO local_logs (
                            user_type, 
                            ip_address, 
                            description, 
                            company_id, 
                            company_username, 
                            user_id, 
                            name, 
                            router_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    
                    // Sample values - adjust these based on your actual context
                    const logValues = [
                        'system',                  // user_type
                        '127.0.0.1',              // ip_address (you might want to pass this as parameter)
                        description,              // description
                        2,                       // company_id (adjust as needed)
                        client.company_username,  // company_username
                        customer_id,             // user_id
                        client.full_name,        // name
                        client.router_id         // router_id
                    ];

                    pool.query(logQuery, logValues, (err, logResults) => {
                        if (err) {
                            console.error("Error creating log entry:", err);
                            return;
                        }
                        console.log("Log entry created successfully");
                    });
                } else {
                    console.log(`No customer found with ID ${customer_id}.`);
                }
            });
        } else {
            console.log(`No client found with ID ${customer_id} to set inactive`);
        }
    });
}

function setActive(customer_id) {
    const query = "UPDATE pppoe_clients SET active = 1 WHERE id = ?";
    
    pool.query(query, [customer_id], (err, results) => {
        if (err) {
            console.error("Error updating customer:", err);
            return;
        }
        
        if (results.affectedRows > 0) {
            console.log(`Customer with ID ${customer_id} is now inactive.`);
        } else {
            console.log(`No customer found with ID ${customer_id}.`);
        }
    });
}

// Function to fetch router details from the database
function getRouterDetails(router_id) {
    return new Promise(async (resolve, reject) => {
        try {
            // Get a connection from the pool
            const connection = await pool.getConnection();
            
            // SQL query to get router details
            const query = "SELECT ip_address, username, router_secret FROM routers WHERE id = ?";
            const [rows] = await connection.execute(query, [router_id]);
            
            // Release the connection back to the pool
            connection.release();

            if (rows.length === 0) {
                reject('Router not found');
            } else {
                resolve(rows[0]);  // Return the first matching row
            }
        } catch (err) {
            reject(`Database Error: ${err}`);
        }
    });
}

// Function to execute the SSH command on MikroTik
function executeSSHCommand(ip_address, username, password, secret_name, command) {
    return new Promise((resolve, reject) => {
        const ssh = new Client();

        ssh.on('ready', () => {
            const sshCommand = `/ppp secret set [find name=${secret_name}] disabled=${command === 'disable' ? 'yes' : 'no'}`;
            // console.log(sshCommand);
            ssh.exec(sshCommand, (err, stream) => {
                if (err) {
                    reject(`SSH Error: ${err}`);
                    ssh.end();
                } else {
                    let output = '';
                    let error = '';
                    stream.on('data', (data) => {
                        output += data.toString();
                    });
                    stream.on('stderr', (data) => {
                        error += data.toString();
                    });
                    stream.on('close', () => {
                        ssh.end();
                        if (error) {
                            reject({ status: 'error', message: error });
                        } else {
                            resolve({ status: 'success', message: `PPP Secret '${secret_name}' ${command}d successfully.` });
                        }
                    });
                }
            });
        }).on('error', (err) => {
            reject(`SSH Connection Failed: ${err}`);
        }).connect({
            host: ip_address,
            username: username,
            password: password,
            port: 22,
        });
    });
}

function deleteActiveConnection(ip_address, username, password, secret_name) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            console.log('SSH Connection Established');

            // MikroTik command to find and remove the active PPPoE session
            const command = `/ppp active remove [find name=${secret_name}]`;

            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject({ status: 'error', message: `SSH command error: ${err.message}` });
                }

                let output = '';
                let error = '';

                stream.on('data', (data) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    error += data.toString();
                });

                stream.on('close', () => {
                    conn.end();
                    if (error) {
                        reject({ status: 'error', message: error.trim() });
                    } else {
                        resolve({ status: 'success', message: `Active PPPoE session '${secret_name}' removed.` });
                    }
                });
            });
        });

        conn.on('error', (err) => {
            reject({ status: 'error', message: `SSH Connection Error: ${err.message}` });
        });

        conn.connect({
            host: ip_address,
            port: 22,
            username: username,
            password: password
        });
    });
}


function changePppoePlan(ip_address, username, password, secret_name, new_plan) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            console.log('SSH Connection Established');

            // MikroTik command to update the PPPoE secret profile
            const command = `/ppp secret set [find name=${secret_name}] profile="${new_plan}"`;
            console.log("Change PPPoE Plan: ", command)

            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject({ status: 'error', message: `SSH command error: ${err.message}` });
                }

                let output = '';
                let error = '';

                stream.on('data', (data) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    error += data.toString();
                });

                stream.on('close', () => {
                    conn.end();
                    if (error) {
                        reject({ status: 'error', message: error.trim() });
                    } else {
                        resolve({ status: 'success', message: `PPP secret '${secret_name}' updated to plan '${new_plan}'.` });
                    }
                });
            });
        });

        conn.on('error', (err) => {
            reject({ status: 'error', message: `SSH Connection Error: ${err.message}` });
        });

        conn.connect({
            host: ip_address,
            port: 22,
            username: username,
            password: password
        });
    });
}

module.exports = { getRouterDetails, executeSSHCommand, deleteActiveConnection, changePppoePlan, setInactive, setActive };