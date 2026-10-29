const { supabase, unwrap } = require('../config/supabase');
const { isAllowedExtension } = require('../utils/bookingLifecycle');

function isSlotConflict(error) {
  return /slot|availability|overlap|booked|locked|request.*expired/i.test(error?.message || '');
}

function isMissingOptionalCancellationReason(error) {
  const details = `${error?.message || ''} ${error?.details || ''}`;
  return ['42703', 'PGRST204'].includes(error?.code)
    && /(?:_bookings\.)?cancellation_reason/i.test(details);
}

function isMissingCancellationRequestsTable(error) {
  const details = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return ['42P01', 'PGRST205'].includes(error?.code)
    && /_booking_cancellation_requests/i.test(details);
}

async function createBookingForCustomer({
  customerId,
  providerId,
  serviceId,
  startTime,
  availabilityId,
  finalStatus = 'PENDING',
  paymentAmount = null,
  paymentStatus = null,
  paymentMethod = null,
  transactionId = null,
}) {
  if (!providerId || !serviceId || (!startTime && !availabilityId)) {
    throw new Error('provider_id, service_id and either start_time or availability_id are required');
  }
  return unwrap(supabase.rpc('create_booking_with_slots', {
    p_customer_id: customerId,
    p_provider_id: providerId,
    p_service_id: serviceId,
    p_start_time: startTime || null,
    p_availability_id: availabilityId || null,
    p_final_status: finalStatus,
    p_payment_amount: paymentAmount,
    p_payment_status: paymentStatus,
    p_payment_method: paymentMethod,
    p_transaction_id: transactionId,
  }));
}

const createBooking = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can book services' });
    const booking = await createBookingForCustomer({
      customerId: req.user.id,
      providerId: req.body.provider_id,
      serviceId: req.body.service_id,
      startTime: req.body.start_time,
      availabilityId: req.body.availability_id,
    });
    res.status(201).json({
      message: 'Booking successful',
      booking_id: booking.booking_id,
      status: 'PENDING',
      slots_used: booking.slots_used,
    });
  } catch (error) {
    if (isSlotConflict(error)) {
      return res.status(409).json({ error: error.message });
    }
    res.status(400).json({ error: error.message || 'Booking failed' });
  }
};

const requestReschedule = async (req, res, next) => {
  try {
    if (!['CUSTOMER', 'PROVIDER'].includes(req.user.role)) return res.status(403).json({ error: 'Only the customer or booking provider can request a reschedule' });
    const bookingId = req.params.id;
    const { target_availability_id } = req.body;
    if (!bookingId || !target_availability_id) return res.status(400).json({ error: 'booking_id and target_availability_id are required' });

    const booking = await unwrap(supabase.from('_bookings')
      .select('customer_id,provider_id,availability_id,status')
      .eq('id', bookingId).maybeSingle());
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role === 'CUSTOMER' && booking.customer_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (req.user.role === 'PROVIDER' && booking.provider_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    if (!['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(booking.status)) {
      return res.status(400).json({ error: `Cannot reschedule booking with status ${booking.status}` });
    }
    if (booking.availability_id === target_availability_id) return res.status(400).json({ error: 'New slot must be different' });

    const target = await unwrap(supabase.from('_availabilities').select('id,provider_id')
      .eq('id', target_availability_id).eq('is_deleted', false).maybeSingle());
    if (!target) return res.status(404).json({ error: 'Target slot not found' });
    if (target.provider_id !== booking.provider_id) return res.status(400).json({ error: 'Slot must belong to same provider' });

    const success = await unwrap(supabase.rpc(req.user.role === 'PROVIDER' ? 'request_provider_reschedule' : 'request_customer_reschedule', {
      p_booking_id: bookingId,
      [req.user.role === 'PROVIDER' ? 'p_provider_id' : 'p_customer_id']: req.user.id,
      p_target_availability_id: target_availability_id,
    }));
    if (!success) return res.status(409).json({ error: 'The requested time is unavailable or locked. The original booking remains unchanged.' });
    res.status(200).json({ message: req.user.role === 'PROVIDER' ? 'Reschedule proposal sent to the customer (valid for 24h)' : 'Reschedule requested (valid for 24h)' });
  } catch (error) {
    if (isSlotConflict(error) || /3 hours|cancellation request is pending|10:00|6:00 PM|working hours/i.test(error.message || '')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const requestExtension = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can request an extension' });
    const additionalMinutes = Number(req.body.additional_minutes);
    if (!isAllowedExtension(additionalMinutes)) {
      return res.status(400).json({ error: 'additional_minutes must be 15, 30, or 60' });
    }
    const extensionId = await unwrap(supabase.rpc('request_booking_extension', {
      p_booking_id: req.params.id,
      p_customer_id: req.user.id,
      p_extra_minutes: additionalMinutes,
    }));
    res.status(201).json({ message: 'Extension request sent to provider', extension_id: extensionId });
  } catch (error) {
    if (/not available|already pending|not found|invalid|multiple of 15|locked|cancellation request|6:00 PM/i.test(error.message || '')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const respondToExtension = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can respond to extension requests' });
    const approved = req.params.action === 'approve';
    if (!approved && req.params.action !== 'reject') return res.status(400).json({ error: 'Action must be approve or reject' });
    const result = await unwrap(supabase.rpc('respond_booking_extension', {
      p_extension_id: req.params.extensionId,
      p_provider_id: req.user.id,
      p_approve: approved,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Extension request is missing, expired, or unauthorized' });
    if (approved && row.status !== 'APPROVED') {
      return res.status(409).json({ error: 'The requested extension is no longer available. The original booking is unchanged.', extension: row });
    }
    res.status(200).json({
      message: approved ? 'Extension approved; customer payment is pending' : 'Extension rejected',
      extension: row,
      extension_payment_status: approved ? 'PENDING' : null,
    });
  } catch (error) {
    if (isSlotConflict(error)) return res.status(409).json({ error: error.message });
    next(error);
  }
};

const respondToBookingRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can respond to booking requests' });
    const approved = req.params.action === 'approve';
    if (!approved && req.params.action !== 'reject') return res.status(400).json({ error: 'Action must be approve or reject' });
    const result = await unwrap(supabase.rpc('respond_to_booking_request', {
      p_booking_id: req.params.id,
      p_provider_id: req.user.id,
      p_approve: approved,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Booking request is missing, expired, or unauthorized' });
    res.status(200).json({
      message: approved ? 'Booking confirmed' : 'Booking rejected',
      booking: row,
    });
  } catch (error) {
    if (/booking|slot|availability|cancellation request|locked/i.test(error.message || '')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can cancel bookings' });
    const requestId = await unwrap(supabase.rpc('request_customer_cancellation', {
      p_booking_id: req.params.id,
      p_customer_id: req.user.id,
    }));
    if (!requestId) return res.status(409).json({ error: 'Could not create cancellation request' });
    res.status(201).json({ message: 'Cancellation request sent to provider', cancellation_request_id: requestId, status: 'PENDING' });
  } catch (error) {
    if (/cancel|3 hours|pending extension/i.test(error.message || '')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const providerCancelBooking = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can cancel provider bookings' });
    const result = await unwrap(supabase.rpc('provider_cancel_booking', {
      p_booking_id: req.params.id,
      p_provider_id: req.user.id,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Booking is no longer active or does not belong to this provider' });
    res.status(200).json({ message: 'Booking cancelled and customer notified', booking: row });
  } catch (error) {
    if (/booking|cancel|active|3 hours/i.test(error.message || '')) return res.status(409).json({ error: error.message });
    next(error);
  }
};

const respondToProviderReschedule = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only the customer can respond to a provider reschedule proposal' });
    const approved = req.params.action === 'approve';
    if (!approved && req.params.action !== 'reject') return res.status(400).json({ error: 'Action must be approve or reject' });
    const result = await unwrap(supabase.rpc('respond_provider_reschedule', {
      p_booking_id: req.params.id,
      p_customer_id: req.user.id,
      p_approve: approved,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Provider reschedule proposal is missing, expired, or unauthorized' });
    res.status(200).json({ message: approved ? 'Provider reschedule proposal accepted' : 'Provider reschedule proposal declined', booking: row });
  } catch (error) {
    if (/reschedule|booking|expired|available/i.test(error.message || '')) return res.status(409).json({ error: error.message });
    next(error);
  }
};

const withdrawCustomerReschedule = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only the customer can withdraw their reschedule request' });
    const result = await unwrap(supabase.rpc('withdraw_customer_reschedule', {
      p_booking_id: req.params.id,
      p_customer_id: req.user.id,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Reschedule request is missing, expired, or was sent by the provider' });
    res.status(200).json({ message: 'Reschedule request withdrawn', booking: row });
  } catch (error) {
    if (/reschedule|booking|expired/i.test(error.message || '')) return res.status(409).json({ error: error.message });
    next(error);
  }
};

const respondToCancellation = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can respond to cancellation requests' });
    const approved = req.params.action === 'approve';
    if (!approved && req.params.action !== 'reject') return res.status(400).json({ error: 'Action must be approve or reject' });
    const result = await unwrap(supabase.rpc('respond_customer_cancellation', {
      p_request_id: req.params.requestId,
      p_provider_id: req.user.id,
      p_approve: approved,
    }));
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return res.status(409).json({ error: 'Cancellation request is missing, expired, or unauthorized' });
    if (approved && row.status !== 'APPROVED') {
      return res.status(409).json({ error: 'The booking is no longer active. Cancellation request was rejected.', request: row });
    }
    res.status(200).json({ message: approved ? 'Cancellation approved' : 'Cancellation rejected', request: row });
  } catch (error) {
    if (/cancellation request|booking is no longer active/i.test(error.message || '')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
};

const approveReschedule = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only provider can approve' });
    const booking = await unwrap(supabase.rpc('approve_safe_reschedule', {
      p_booking_id: req.params.id,
      p_provider_id: req.user.id,
    }));
    const row = Array.isArray(booking) ? booking[0] : booking;
    if (!row) {
      const ownedBooking = await unwrap(supabase.from('_bookings').select('status')
        .eq('id', req.params.id).eq('provider_id', req.user.id).maybeSingle());
      if (ownedBooking && ownedBooking.status !== 'RESCHEDULE_REQUESTED') {
        return res.status(409).json({ error: 'The requested time is no longer available. The original booking remains unchanged.' });
      }
      return res.status(409).json({ error: 'Reschedule request is missing, expired, or unauthorized' });
    }
    res.status(200).json({ message: 'Reschedule approved', booking: row });
  } catch (error) { next(error); }
};

const rejectReschedule = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only provider can reject' });
    const booking = await unwrap(supabase.rpc('reject_safe_reschedule', {
      p_booking_id: req.params.id,
      p_provider_id: req.user.id,
    }));
    const row = Array.isArray(booking) ? booking[0] : booking;
    if (!row) return res.status(409).json({ error: 'Reschedule request is missing or unauthorized' });
    res.status(200).json({ message: 'Reschedule rejected', booking: row });
  } catch (error) { next(error); }
};

const getMyBookings = async (req, res, next) => {
  try {
    if (!['CUSTOMER', 'PROVIDER'].includes(req.user.role)) return res.status(403).json({ error: 'Customer or provider access required' });
    await unwrap(supabase.rpc('expire_booking_holds'));
    const bookingFields = [
      'id,status,created_at,target_availability_id,availability_id,duration_minutes,extension_amount_due',
      'service:_services!_bookings_service_id_fkey(id,title,price,duration_minutes)',
      'availability:_availabilities!_bookings_availability_id_fkey(start_time,end_time)',
      'target_availability:_availabilities!_bookings_target_availability_id_fkey(start_time)',
      'customer:_users!_bookings_customer_id_fkey(id,name)',
      'provider:_users!_bookings_provider_id_fkey(id,name)',
      'payment:_payments!_payments_booking_id_fkey(amount,status,payment_method,is_deleted)',
    ].join(',');
    const buildBookingsQuery = (fields) => {
      let scopedQuery = supabase.from('_bookings').select(fields);
      scopedQuery = req.user.role === 'PROVIDER'
        ? scopedQuery.eq('provider_id', req.user.id)
        : scopedQuery.eq('customer_id', req.user.id);
      return scopedQuery.eq('is_deleted', false).order('created_at', { ascending: false });
    };
    // Cancellation reason is optional display metadata added by a later
    // migration. Booking actions must keep working against schemas that do
    // not have it, so it is deliberately not part of this required query.
    const rows = await unwrap(buildBookingsQuery(bookingFields));
    const bookingIds = rows.map((booking) => booking.id);
    const cancellationReasons = new Map();
    if (bookingIds.length) {
      try {
        const reasons = await unwrap(supabase.from('_bookings')
          .select('id,cancellation_reason').in('id', bookingIds));
        for (const row of reasons) cancellationReasons.set(row.id, row.cancellation_reason);
      } catch (error) {
        if (!isMissingOptionalCancellationReason(error)) throw error;
        console.warn('Optional _bookings.cancellation_reason is unavailable; the booking list will be returned without cancellation-reason metadata until its existing migration is applied.');
      }
    }
    const extensions = bookingIds.length
      ? await unwrap(supabase.from('_booking_extensions')
        .select('id,booking_id,additional_minutes,additional_price,status,expires_at,created_at')
        .in('booking_id', bookingIds).order('created_at', { ascending: false }))
      : [];
    let cancellationRequests = [];
    if (bookingIds.length) {
      try {
        cancellationRequests = await unwrap(supabase.from('_booking_cancellation_requests')
          .select('id,booking_id,customer_id,provider_id,status,created_at,reviewed_at')
          .in('booking_id', bookingIds).order('created_at', { ascending: false }));
      } catch (error) {
        if (!isMissingCancellationRequestsTable(error)) throw error;
        console.warn('Optional _booking_cancellation_requests table is unavailable; bookings will be returned without cancellation-request metadata until its existing migration is applied.');
      }
    }
    const rescheduleRequests = bookingIds.length
      ? await unwrap(supabase.from('_booking_reschedule_requests')
        .select('id,booking_id,customer_id,provider_id,original_availability_id,target_availability_id,status,requested_by_role,requested_by,created_at,reviewed_at')
        .in('booking_id', bookingIds).order('created_at', { ascending: false }))
      : [];
    const extensionsByBooking = new Map();
    for (const extension of extensions) {
      if (!extensionsByBooking.has(extension.booking_id)) extensionsByBooking.set(extension.booking_id, []);
      extensionsByBooking.get(extension.booking_id).push(extension);
    }
    const cancellationByBooking = new Map();
    for (const request of cancellationRequests) {
      if (!cancellationByBooking.has(request.booking_id)) cancellationByBooking.set(request.booking_id, []);
      cancellationByBooking.get(request.booking_id).push(request);
    }
    const rescheduleByBooking = new Map();
    for (const request of rescheduleRequests) {
      if (!rescheduleByBooking.has(request.booking_id)) rescheduleByBooking.set(request.booking_id, []);
      rescheduleByBooking.get(request.booking_id).push(request);
    }
    res.status(200).json(rows.map((booking) => {
      const durationMinutes = booking.duration_minutes ?? booking.service?.duration_minutes ?? null;
      const startTime = booking.availability?.start_time || null;
      return ({
      id: booking.id,
      availability_id: booking.availability_id,
      status: booking.status,
      cancellation_reason: cancellationReasons.get(booking.id) || null,
      cancellation_requests: cancellationByBooking.get(booking.id) || [],
      reschedule_requests: rescheduleByBooking.get(booking.id) || [],
      created_at: booking.created_at,
      target_availability_id: booking.target_availability_id,
      target_start_time: booking.target_availability?.start_time || null,
      service_id: booking.service?.id || null,
      service_title: booking.service?.title || null,
      price: booking.service?.price ?? null,
      duration_minutes: durationMinutes,
      extension_amount_due: booking.extension_amount_due ?? 0,
      extension_payment_status: Number(booking.extension_amount_due || 0) > 0 ? 'PENDING' : 'NONE',
      extensions: extensionsByBooking.get(booking.id) || [],
      start_time: startTime,
      end_time: startTime && durationMinutes
        ? new Date(new Date(startTime).getTime() + durationMinutes * 60_000).toISOString()
        : booking.availability?.end_time || null,
      customer_id: booking.customer?.id || null,
      customer_name: booking.customer?.name || null,
      provider_id: booking.provider?.id || null,
      provider_name: booking.provider?.name || null,
      paid_amount: booking.payment && !booking.payment.is_deleted ? booking.payment.amount : null,
      payment_status: booking.payment && !booking.payment.is_deleted ? booking.payment.status : null,
      payment_method: booking.payment && !booking.payment.is_deleted ? booking.payment.payment_method : null,
    });
    }));
  } catch (error) { next(error); }
};

module.exports = {
  createBooking, createBookingForCustomer, requestReschedule, approveReschedule,
  rejectReschedule, requestExtension, respondToExtension, respondToBookingRequest, cancelBooking,
  providerCancelBooking, respondToProviderReschedule, withdrawCustomerReschedule, respondToCancellation, getMyBookings,
};
