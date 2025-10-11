const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '..', '.env') });

const {
    fetchClientsNearExpiry,
    sendWhatsappReminders,
} = require('./functions');


// Run the function
(async () => {
  try {
    const nearExpiryUsers = await fetchClientsNearExpiry();
    const results = await sendWhatsappReminders(nearExpiryUsers);
    console.log('Final Results:', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Error running sendWhatsappReminders:', err.message);
  }
})();