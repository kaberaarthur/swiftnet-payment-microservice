const pool = require('../db'); // Import MySQL connection
const axios = require('axios');

// Function to fetch client details by client_id
async function getClientById(client_id) {
    try {
        const clientQuery = 'SELECT * FROM pppoe_clients WHERE id = ?';
        const [clientRows] = await pool.execute(clientQuery, [client_id]);

        if (clientRows.length === 0) {
            return null; // Return null if client is not found
        }

        return clientRows[0]; // Return client details
    } catch (error) {
        console.error("Error fetching client details:", error);
        throw error; // Propagate the error
    }
}

// Function to fetch PayHero settings by company_id
async function getPayheroSettings(company_id) {
    try {
        const settingsQuery = 'SELECT * FROM payhero_settings WHERE company_id = ?';
        const [settingsRows] = await pool.execute(settingsQuery, [company_id]);

        if (settingsRows.length === 0) {
            return null; // Return null if no settings found
        }

        return settingsRows[0]; // Return the settings row
    } catch (error) {
        console.error("Error fetching PayHero settings:", error);
        throw error; // Propagate the error
    }
}

// Function to initiate a payment request
async function initiatePayment(client, settings) {
    const paymentData = {
        amount: Number(client.plan_fee) + Number(client.installation_fee),
        phone_number: client.phone_number,
        channel_id: settings.channel_id,
        provider: "m-pesa",
        external_reference: "INV-009",
        customer_name: client.full_name,
        callback_url: settings.pppoe_callback_url
    };

    try {
        const response = await axios.post('https://backend.payhero.co.ke/api/v2/payments', paymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': settings.payhero_token
            }
        });
        
        // console.log("Payment Request Response: ", response.data);
        return response.data; // Return the response data
    } catch (error) {
        console.error("Error initiating payment:", error.response ? error.response.data : error.message);
        throw error; // Propagate the error
    }
}

// Function to store payment request in the database
async function storePaymentRequest(client, paymentResponse) {
    try {
        const query = `
            INSERT INTO pppoe_payment_requests 
            (success, status, reference, CheckoutRequestID, company_id, company_username, router_id, 
             plan_id, plan_name, phone_number, payment_type, installation_fee, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const values = [
            paymentResponse.success ? 1 : 0, // Convert boolean to integer
            paymentResponse.status,
            paymentResponse.reference,
            paymentResponse.CheckoutRequestID,
            client.company_id,
            client.company_username,
            client.router_id,
            client.plan_id,
            client.plan_name,
            client.phone_number,
            Number(client.installation_fee) > 0 ? 'first' : 'repeat',
            client.installation_fee
        ];

        const [result] = await pool.execute(query, values);
        return { success: true, insertId: result.insertId, CheckoutRequestID: paymentResponse.CheckoutRequestID };
    } catch (error) {
        console.error("Error storing payment request:", error);
        throw error; // Propagate the error
    }
}

module.exports = { getClientById, getPayheroSettings, initiatePayment, storePaymentRequest };
