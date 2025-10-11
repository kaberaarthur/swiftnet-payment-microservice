const moment = require("moment-timezone");
const pool = require('../db');
const path = require('path');
const axios = require('axios');

require("dotenv").config({ path: path.join(__dirname, '..', '.env') });

async function fetchRouters() {
    try {
        const [rows] = await pool.execute(
            'SELECT id, ip_address, username, router_secret, port FROM routers WHERE status = 1'
        );
        return rows;
    } catch (error) {
        console.error('Error fetching routers:', error);
        throw error;
    }
}

async function fetchExpiredPPPoEClients() {
    try {
        const currentDate = moment().tz('Africa/Nairobi').format('YYYY-MM-DD');
        const [rows] = await pool.execute(`
            SELECT pc.* 
            FROM pppoe_clients pc 
            INNER JOIN routers r ON pc.router_id = r.id 
            WHERE pc.expiry_date < ? AND r.status = 1 AND pc.active = 1
        `, [currentDate]);
        return rows;
    } catch (error) {
        console.error('Error fetching expired PPPoE clients:', error);
        throw error;
    }
}

async function fetchClientsByRouter(router_id) {
    try {
        const currentDate = moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
        const [rows] = await pool.execute(`
            SELECT pc.id, pc.secret, pc.phone_number, pc.active, pc.reminder, pc.router_id, pc.full_name, pc.end_date, pc.company_username, pc.plan_fee
            FROM pppoe_clients pc 
            INNER JOIN routers r ON pc.router_id = r.id 
            WHERE r.id = ? AND r.status = 1 AND pc.end_date < ? AND pc.active = 1
        `, [router_id, currentDate]);
        return rows;
    } catch (error) {
        console.error('Error fetching clients by router:', error);
        throw error;
    }
}

async function sendSMS(expired_users) {
  console.log("Sending SMS to the following users:", expired_users.length);

  for (const client of expired_users) {
    const message = `Hello ${client.company_username} client,\n\n` +
      `Your home fiber subscription has been temporarily disconnected due to non-payment.\n\n` +
      `To restore your service, please renew your subscription by paying ${client.plan_fee} ` +
      `to Paybill No. 4150219 and Account No. ${client.id}. Make sure you enter the CORRECT ACCOUNT NUMBER. `;

    const payload = {
      username: process.env.AFRICAS_TALKING_USERNAME,
      message,
      senderId: process.env.AFRICAS_TALKING_SENDER_ID,
      phoneNumbers: [client.phone_number],
    };

    console.log("Payload: ", payload);

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      apiKey: process.env.API_KEY,
    };

    try {
      const response = await fetch(process.env.AFRICAS_TALKING_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log(`✅ SMS sent to ${client.phone_number}:`, data);

    } catch (error) {
      console.error(`❌ Error sending SMS to ${client.phone_number}:`, error.message);
    }
  }

  console.log("✅ All messages processed.");
}

// Fetch Clients to Send Reminders
async function fetchClientsNearExpiry() {
    try {
        const currentDate = moment().tz('Africa/Nairobi').format('YYYY-MM-DD');
        const fiveDaysFromNow = moment().tz('Africa/Nairobi').add(5, 'days').format('YYYY-MM-DD');
        const oneDayFromNow = moment().tz('Africa/Nairobi').add(1, 'day').format('YYYY-MM-DD');
        
        const [rows] = await pool.execute(`
            SELECT pc.id, pc.phone_number, pc.company_username, pc.end_date, pc.plan_fee
            FROM pppoe_clients pc 
            INNER JOIN routers r ON pc.router_id = r.id 
            WHERE pc.end_date >= ? AND pc.end_date <= ? AND r.status = 1 AND pc.active = 1
        `, [oneDayFromNow, fiveDaysFromNow]);
        
        return rows;
    } catch (error) {
        console.error('Error fetching clients near expiry:', error);
        throw error;
    }
}

async function sendReminders(near_expiry_users) {
  console.log("Sending SMS to the following users:", near_expiry_users.length);

  const results = {
    total: near_expiry_users.length,
    successful: 0,
    failed: 0,
    errors: [],
    details: []
  };

  for (const client of near_expiry_users) {
    // Format phone number
    let formattedPhone = client.phone_number;
    
    // Remove any extra characters after the phone number (like /t, spaces, etc.)
    formattedPhone = formattedPhone.split(/[\/\s\t]/)[0].trim();
    
    // Convert 0790485731 format to +254790485731
    if (formattedPhone.startsWith('0') && formattedPhone.length === 10) {
      formattedPhone = '+254' + formattedPhone.substring(1);
    }
    
    // Format end date to human-friendly format (e.g., "12th Oct")
    const endDate = moment(client.end_date).tz('Africa/Nairobi');
    const day = endDate.date();
    const month = endDate.format('MMM');
    
    // Add ordinal suffix (st, nd, rd, th)
    const getOrdinalSuffix = (day) => {
      if (day > 3 && day < 21) return 'th';
      switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    
    const formattedDate = `${day}${getOrdinalSuffix(day)} ${month}`;

    const message = `Hello ${client.company_username} client,\n\n` +
      `Your home fiber subscription expires on ${formattedDate}.\n\n` +
      `To avoid disruption, kindly renew your subscription by paying ${client.plan_fee} ` +
      `to Paybill No. 4150219 and Account No. ${client.id}. Make sure you enter the CORRECT ACCOUNT NUMBER. `;

    const payload = {
      username: process.env.AFRICAS_TALKING_USERNAME,
      message,
      senderId: process.env.AFRICAS_TALKING_SENDER_ID,
      phoneNumbers: [formattedPhone],
    };

    console.log("Payload: ", payload);

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      apiKey: process.env.API_KEY,
    };

    try {
      const response = await fetch(process.env.AFRICAS_TALKING_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log(`✅ SMS sent to ${formattedPhone}:`, data);

      results.successful++;
      results.details.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        status: 'success',
        response: data
      });

    } catch (error) {
      console.error(`❌ Error sending SMS to ${formattedPhone}:`, error.message);
      
      results.failed++;
      results.errors.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        error: error.message
      });
      results.details.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        status: 'failed',
        error: error.message
      });
    }
  }

  console.log("✅ All messages processed.");
  console.log(`📊 Summary: ${results.successful} successful, ${results.failed} failed out of ${results.total} total`);
  
  return results;
}

async function sendWhatsappReminders(near_expiry_users) {
  console.log("Sending WhatsApp messages to the following users:", near_expiry_users.length);

  const results = {
    total: near_expiry_users.length,
    successful: 0,
    failed: 0,
    errors: [],
    details: []
  };

  for (const client of near_expiry_users) {
    // Format phone number
    let formattedPhone = client.phone_number;
    
    // Remove any extra characters after the phone number (like /t, spaces, etc.)
    formattedPhone = formattedPhone.split(/[\/\s\t]/)[0].trim();

    // If it starts with '00', remove only one leading zero (e.g., 0079... -> 079...)
    if (formattedPhone.startsWith('00')) {
      formattedPhone = formattedPhone.substring(1);
    }
    
    // Convert 0790485731 format to +254790485731
    if (formattedPhone.startsWith('0') && formattedPhone.length === 10) {
      formattedPhone = '+254' + formattedPhone.substring(1);
    }
    
    // Format end date to human-friendly format (e.g., "12th Oct")
    const endDate = moment(client.end_date).tz('Africa/Nairobi');
    const day = endDate.date();
    const month = endDate.format('MMM');
    
    // Add ordinal suffix (st, nd, rd, th)
    const getOrdinalSuffix = (day) => {
      if (day > 3 && day < 21) return 'th';
      switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    
    const formattedDate = `${day}${getOrdinalSuffix(day)} ${month}`;

    const message = `Hello ${client.company_username} client,\n\n` +
      `Your home fiber subscription expires on ${formattedDate}.\n\n` +
      `To avoid disruption, kindly renew your subscription by paying ${client.plan_fee} ` +
      `to Paybill No. 4150219 and Account No. ${client.id}. Make sure you enter the CORRECT ACCOUNT NUMBER.`;

    const payload = {
      phoneNumber: formattedPhone,
      message: message,
      type: 'text'
    };

    console.log("Payload: ", payload);

    const headers = {
      Authorization: `Bearer ${process.env.API_WAP_API_KEY}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.post(
        'https://api.apiwap.com/api/v1/whatsapp/send-message',
        payload,
        { headers }
      );

      console.log(`✅ WhatsApp message sent to ${formattedPhone}:`, response.data);

      results.successful++;
      results.details.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        status: 'success',
        response: response.data
      });

    } catch (error) {
      console.error(`❌ Error sending WhatsApp message to ${formattedPhone}:`, error.message);
      
      results.failed++;
      results.errors.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        error: error.message
      });
      results.details.push({
        clientId: client.id,
        phone: formattedPhone,
        username: client.company_username,
        status: 'failed',
        error: error.message
      });
    }
  }

  console.log("✅ All WhatsApp messages processed.");
  console.log(`📊 Summary: ${results.successful} successful, ${results.failed} failed out of ${results.total} total`);
  
  return results;
}

module.exports = { 
  fetchRouters, 
  fetchExpiredPPPoEClients, 
  fetchClientsByRouter, 
  sendSMS, 
  fetchClientsNearExpiry, 
  sendReminders,
  sendWhatsappReminders,
};