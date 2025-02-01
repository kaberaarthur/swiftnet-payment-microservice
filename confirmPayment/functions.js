const { getClientById } = require('../payments/functions'); 
const pool = require('../db'); // Import MySQL connection

async function confirmPayment(client_id, MpesaReceiptNumber) {
    console.log("Mpesa Receipt Number:", MpesaReceiptNumber);
    console.log("Client ID:", client_id);
    
    try {
        // Fetch client details
        const client = await getClientById(client_id);
        if (!client.router_id) {
            console.error('Client not found for client_id:', client_id);
            return;
        }

        console.log("Client Router ID:", client.router_id);

        // Find payment record
        const [paymentRows] = await pool.execute(
            'SELECT * FROM pppoe_payments WHERE MpesaReceiptNumber = ?', 
            [MpesaReceiptNumber]
        );

        if (paymentRows.length === 0) {
            console.error('Payment not found for MpesaReceiptNumber:', MpesaReceiptNumber);
            return;
        }

        const payment = paymentRows[0];
        // console.log('Payment Record:', payment);

        // Update pppoe_clients: set installation_fee = 0 and update end_date
        const newEndDate = new Date(client.end_date < Date.now() ? Date.now() : client.end_date);
        newEndDate.setMonth(newEndDate.getMonth() + 1);

        await pool.execute(
            'UPDATE pppoe_clients SET installation_fee = 0, end_date = ? WHERE id = ?', 
            [newEndDate, client_id]
        );
        console.log(`Updated pppoe_clients (installation_fee & end_date) for client_id: ${client_id}`);

        // Update pppoe_payments using client.company_id
        await pool.execute(
            'UPDATE pppoe_payments SET company_id = ?, customer_id = ?, router_id = ?, usedStatus = ? WHERE id = ?', 
            [client.company_id, client_id, client.router_id, "used", payment.id] // Ensure correct order
        );
        
        console.log(`Updated pppoe_payments (end_date) for payment ID: ${payment.id}, company_id: ${client.company_id}`);

        return newEndDate; // Return the new end date

    } catch (error) {
        console.error('Error confirming payment:', error);
    }
}

module.exports = { confirmPayment };
