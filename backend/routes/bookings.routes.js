const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const {
  createBooking,
  requestReschedule,
  rejectReschedule,
  approveReschedule,
  getMyBookings,
  requestExtension,
  respondToExtension,
  respondToBookingRequest,
  respondToCancellation,
  cancelBooking,
  providerCancelBooking,
  respondToProviderReschedule,
  withdrawCustomerReschedule,
} = require('../controllers/bookings.controller');

router.post('/', verifyToken, createBooking);
router.get('/my', verifyToken, getMyBookings);
router.post('/:id/reschedule', verifyToken, requestReschedule);
router.post('/:id/reschedule/approve', verifyToken, approveReschedule);
router.post('/:id/reschedule/reject', verifyToken, rejectReschedule);
router.post('/:id/reschedule/withdraw', verifyToken, withdrawCustomerReschedule);
router.post('/:id/provider-reschedule/:action', verifyToken, respondToProviderReschedule);
router.post('/:id/provider-cancel', verifyToken, providerCancelBooking);
router.post('/:id/extensions', verifyToken, requestExtension);
router.post('/:id/booking-request/:action', verifyToken, respondToBookingRequest);
router.post('/:id/cancel', verifyToken, cancelBooking);
router.post('/cancellations/:requestId/:action', verifyToken, respondToCancellation);
router.post('/extensions/:extensionId/:action', verifyToken, respondToExtension);

module.exports = router;
