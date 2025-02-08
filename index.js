const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const favicon = require('serve-favicon');
const pool = require('./db'); // MySQL connection setup
const { confirmPayment } = require('./confirmPayment/functions'); 
const { getRouterDetails, executeSSHCommand, deleteActiveConnection, changePppoePlan, setInactive } = require('./mikrotik/functions'); 

const { Client } = require('ssh2');
const bodyParser = require('body-parser');

const app = express();
const server = app.listen(3001, () => console.log('Server running on port 3001'));
const wss = new WebSocket.Server({ server });

// External Endpoints
const paymentRoutes = require('./payments/paymentRoutes');

const path = require('path');

// Middleware to parse JSON
app.use(bodyParser.json());

// Allow all origins
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }));

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

// Endpoint to receive object and return router details
app.post('/api/end_subscription', async (req, res) => {
    try {
        const { router, command, secret_name, customer_id } = req.body; 
        
        if (!router) {
            return res.status(400).json({ status: 'error', message: 'Missing Router in the request body' });
        }

        // Get router details from the database using the router_id
        const routerDetails = await getRouterDetails(router);
        // console.log("Router Details: ", routerDetails);

        if(routerDetails.ip_address) {
            executeSSHCommand(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, secret_name, command)
            deleteActiveConnection(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, secret_name)
            setInactive(customer_id)
        }

        // Return the router details
        return res.json({ status: 'success', data: routerDetails });
    } catch (error) {
        console.error('Error fetching router details:', error);
        return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});

// Endpoint to change PPPoE plan
app.post('/api/change-pppoe-plan', async (req, res) => {
    try {
        const { secret_name, new_plan, router, customer_id } = req.body;

        if (!secret_name || !new_plan) {
            return res.status(400).json({ status: 'error', message: 'Missing required parameters: secret_name and new_plan' });
        }

        // Log the received parameters
        console.log(`Received request to change PPPoE plan:`);
        console.log(`Secret Name: ${secret_name}`);
        console.log(`New Plan: ${new_plan}`);
        console.log(`Router ID: ${router}`);
        console.log(`New Plan: ${customer_id}`);

        // Respond with success message
        // 

        const routerDetails = await getRouterDetails(router);
        // console.log("Router Details: ", routerDetails);

        if(routerDetails.ip_address) {
            deleteActiveConnection(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, secret_name)
            changePppoePlan(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, secret_name, new_plan)
            return res.json({ status: 'success', message: `Received request to change ${secret_name} to plan ${new_plan}` });
        }
    } catch (error) {
        console.error('Error handling request:', error);
        return res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});


// Function to check if a row with given CheckoutRequestID exists
async function checkDatabase(CheckoutRequestID) {
    const sql = 'SELECT * FROM pppoe_payments WHERE CheckoutRequestID = ?';
    const [rows] = await pool.execute(sql, [CheckoutRequestID]);
    return rows.length > 0 ? rows[0] : null;
}

app.post('/watchTransaction', async (req, res) => {
    const { CheckoutRequestID, clientID } = req.body;

    if (!CheckoutRequestID || !clientID) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Create a new WebSocket connection
    const socket = new WebSocket('ws://139.59.60.20:3001');

    // Handle WebSocket connection open event
    socket.onopen = () => {
        console.log('Connected to WebSocket');
        socket.send(JSON.stringify({ CheckoutRequestID, clientID }));
    };

    // Handle WebSocket message event
    socket.onmessage = async (event) => {
        try {
            const response = JSON.parse(event.data);

            if (response.status === 'found' && response.data?.MpesaReceiptNumber) {
                console.log('Transaction found: ' + response.data.MpesaReceiptNumber);

                // Return response to the client
                res.json({
                    status: 'found',
                    data: response.data,
                    end_date: response.end_date ? formatFriendlyDate(response.end_date) : null,
                    mpesaReceipt: response.data.MpesaReceiptNumber,
                });

                socket.close(); // Close the WebSocket after response
            } else {
                console.log('Transaction not found');
                res.json({ status: 'not_found', message: 'We could not verify your payment.' });
                socket.close();
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
            res.status(500).json({ error: 'Internal server error' });
            socket.close();
        }
    };

    // Handle WebSocket close event
    socket.onclose = () => console.log('WebSocket connection closed');
});

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
