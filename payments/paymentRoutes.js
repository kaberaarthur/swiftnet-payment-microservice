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
            executeSSHCommand(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, client.secret, "enable", routerDetails.port);
            setActive(client_id);
        }

        res.status(200).json({ client_details: client, response: paymentRequestStoreResponse });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post('/enable-client', async (req, res) => {
    try {
        console.log("Request received:", req.body);
        const { client_id, phone_number } = req.body;

        if (!client_id) {
            console.error("Error: Missing client_id");
            return res.status(400).json({ error: "Missing client_id" });
        }

        const client = await getClientById(client_id);
        console.log("Client lookup result:", client);

        if (!client) {
            console.error("Error: Client not found for ID", client_id);
            return res.status(404).json({ error: "Client not found" });
        }

        console.log("Fetching router details for router_id:", client.router_id);
        const routerDetails = await getRouterDetails(client.router_id);
        console.log("Router Details:", routerDetails);

        if (!routerDetails || !routerDetails.ip_address) {
            console.error("Error: Router Connection Impaired");
            return res.status(404).json({ error: "Router Connection Impaired" });
        }

        console.log("Executing SSH Command...");
        await executeSSHCommand(routerDetails.ip_address, routerDetails.username, routerDetails.router_secret, client.secret, "enable", routerDetails.port);

        console.log("Setting client as active...");
        await setActive(client_id);

        // Define or remove paymentRequestStoreResponse if it's not needed
        const paymentRequestStoreResponse = {}; // Placeholder

        console.log("Sending success response...");
        return res.status(200).json({ client_details: client, response: paymentRequestStoreResponse });

    } catch (error) {
        console.error("Internal Server Error:", error);
        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
});

module.exports = router;
