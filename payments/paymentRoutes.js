const express = require('express');
const { getClientById, getPayheroSettings, initiatePayment, storePaymentRequest } = require('./functions'); // Import the function
const { getRouterDetails, executeSSHCommand, deleteActiveConnection, changePppoePlan, setActive } = require('../mikrotik/functions'); 


const router = express.Router();

// Define a POST endpoint to fetch client details
router.post('/payment', async (req, res) => {
    try {
        const { client_id, phone_number } = req.body;

        if (!client_id) {
            return res.status(400).json({ error: "Missing client_id" });
        }

        const client = await getClientById(client_id);

        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }

        const settings = await getPayheroSettings(client.company_id);

        if (!settings) {
            return res.status(404).json({ error: "PayHero settings not found" });
        }

        const paymentResponse = await initiatePayment(client, settings, phone_number);

        const paymentRequestStoreResponse = await storePaymentRequest(client, paymentResponse);

        const routerDetails = await getRouterDetails(client.router_id);
        // console.log("Router Details: ", routerDetails);

        if(routerDetails.ip_address) {
            executeSSHCommand(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, client.secret, "enable");
            setActive(client_id);
        }

        res.status(200).json({ client_details: client, response: paymentRequestStoreResponse });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// Change the client's status to enabled
router.post('/enable-client', async (req, res) => {
    try {
        const { client_id, phone_number } = req.body;

        if (!client_id) {
            return res.status(400).json({ error: "Missing client_id" });
        }

        const client = await getClientById(client_id);

        if (!client) {
            return res.status(404).json({ error: "Client not found" });
        }

        const routerDetails = await getRouterDetails(client.router_id);
        // console.log("Router Details: ", routerDetails);

        if(routerDetails.ip_address) {
            executeSSHCommand(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, client.secret, "enable");
            setActive(client_id);
        }

        res.status(200).json({ client_details: client, response: paymentRequestStoreResponse });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
