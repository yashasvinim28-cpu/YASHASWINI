const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const {
  createPaymentOrder,
  verifyPaymentAndBook,
  createPayLaterBooking
} = require('../controllers/payments.controller');

router.post('/order', verifyToken, createPaymentOrder);
router.post('/verify-booking', verifyToken, verifyPaymentAndBook);
router.post('/pay-later-booking', verifyToken, createPayLaterBooking);

module.exports = router;
