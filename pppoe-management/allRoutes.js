const express = require('express');
const pool = require('../db');
const { 
    fetchRouters, 
    fetchExpiredPPPoEClients, 
    fetchClientsByRouter, 
    sendSMS,
    fetchClientsNearExpiry,
    sendReminders
} = require('./functions');

const router = express.Router();

// Get all active Routers
router.get('/routers/active', async (req, res) => {
    try {
        const routers = await fetchRouters();
        res.json(routers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch routers' });
    }
});

// Get expired PPPoE clients by Router ID
router.get('/expired/:router_id', async (req, res) => {
    const { router_id } = req.params;
    try {
        const clients = await fetchClientsByRouter(router_id);
        res.json(clients);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch clients for the specified router' });
    }
});

// Async Express endpoint for bulk update -active status to 0
router.patch('/update-status', async (req, res) => {
  const { ids, expired_users } = req.body;

  console.log("Expired users: ", expired_users);

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided or invalid format' });
  }

  try {
    // Dynamically create placeholders like (?, ?, ?, ...)
    const placeholders = ids.map(() => '?').join(',');
    const query = `UPDATE pppoe_clients SET active = 0 WHERE id IN (${placeholders})`;

    const [result] = await pool.execute(query, ids);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'No records found to update' });
    }

    // Send SMS to expired users
    if(expired_users && expired_users.length > 0) {
        await sendSMS(expired_users);
    }

    res.json({
      message: 'Updated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error updating records:', error);
    res.status(500).json({ error: 'Server error occurred while updating records' });
  }
});

// Send Reminders to customers about to expire
router.post('/send-reminders', async (req, res) => {
  try {
    const nearExpiryUsers = await fetchClientsNearExpiry();
    const results = await sendReminders(nearExpiryUsers);
    
    res.json({
      success: true,
      message: 'Reminder SMS process completed',
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send reminders',
      error: error.message
    });
  }
});

module.exports = router;