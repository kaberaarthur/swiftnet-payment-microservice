const express = require('express');
const WebSocket = require('ws');
const favicon = require('serve-favicon');
const pool = require('./db'); // MySQL connection setup
const { confirmPayment } = require('./confirmPayment/functions'); 

const app = express();
const server = app.listen(3000, () => console.log('Server running on port 3000'));
const wss = new WebSocket.Server({ server });

// External Endpoints
const paymentRoutes = require('./payments/paymentRoutes');

const path = require('path');

// Serve the favicon.ico from the public folder (or wherever your favicon is)
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

app.use(express.json()); // Add this to parse JSON body requests

app.use(express.static('public')); // Serve static HTML

// Route to serve an HTML page
app.get('/api/deploy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'deploy.html'));
});

app.get('/api/message', (req, res) => {
    res.send("Hello from the server!");
});

// Use the payment routes
app.use('/api', paymentRoutes);


// Function to check if a row with given CheckoutRequestID exists
async function checkDatabase(CheckoutRequestID) {
    const sql = 'SELECT * FROM pppoe_payments WHERE CheckoutRequestID = ?';
    const [rows] = await pool.execute(sql, [CheckoutRequestID]);
    return rows.length > 0 ? rows[0] : null;
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        // console.log('Received message:', message.toString('utf8'));
        const { CheckoutRequestID, clientID } = JSON.parse(message);  // Extract both values
        console.log(`Received CheckoutRequestID: ${CheckoutRequestID} and clientID: ${clientID}`);

        let found = false;
        let elapsedTime = 0;
        const maxWaitTime = 60000; // 3 minutes (in milliseconds)
        const checkInterval = 3000; // 3 seconds per check

        while (!found && elapsedTime < maxWaitTime) {
            const result = await checkDatabase(CheckoutRequestID);
            if (result) {
                found = true;
                // Run a Function to Confirm Payment Here
                const updatedEndDate = await confirmPayment(clientID, result.MpesaReceiptNumber);

                ws.send(JSON.stringify({ status: "found", data: result, end_date: updatedEndDate })); // Send data to frontend
                return; // Stop further checks
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
            elapsedTime += checkInterval;
        }

        // If no record found after 3 minutes
        if (!found) {
            ws.send(JSON.stringify({ status: "not_found", message: "We did not receive your payment. Contact support for help." }));
            ws.close(); // Close the connection
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
});
