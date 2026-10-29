const crypto = require('crypto');
const { supabase, unwrap } = require('../config/supabase');
const { createBookingForCustomer } = require('./bookings.controller');

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';
const PAYMENT_PLANS = { ADVANCE_50: 0.5, FULL: 1 };

function isSlotConflict(error) {
  return /slot|availability|overlap|booked|locked|consecutive/i.test(error?.message || '');
}

function getRazorpayAuthHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay credentials are missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

async function razorpayRequest(path, options = {}) {
  const response = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: getRazorpayAuthHeader(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.description || data.error?.reason || 'Razorpay request failed');
  return data;
}

function normalizePaymentPlan(plan) {
  return PAYMENT_PLANS[plan] ? plan : 'ADVANCE_50';
}

async function getServicePricing(serviceId, providerId) {
  const service = await unwrap(supabase.from('_services')
    .select('id,provider_id,title,price')
    .eq('id', serviceId).eq('is_deleted', false).maybeSingle());
  if (!service) throw new Error('Service not found');
  if (service.provider_id !== providerId) throw new Error('Invalid provider for this service');
  return { service, totalAmountPaise: Math.round(Number(service.price || 0) * 100) };
}

function computePayableAmount(totalAmountPaise, paymentPlan) {
  if (totalAmountPaise <= 0) return 0;
  const multiplier = PAYMENT_PLANS[paymentPlan] || PAYMENT_PLANS.ADVANCE_50;
  return paymentPlan === 'FULL' ? totalAmountPaise : Math.max(100, Math.round(totalAmountPaise * multiplier));
}

const createPaymentOrder = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can pay for bookings' });
    const { provider_id, service_id, availability_id, start_time, payment_plan } = req.body;
    if (!provider_id || !service_id || !availability_id || !start_time) {
      return res.status(400).json({ error: 'provider_id, service_id, availability_id and start_time are required' });
    }
    const plan = normalizePaymentPlan(payment_plan);
    const { service, totalAmountPaise } = await getServicePricing(service_id, provider_id);
    const payableAmountPaise = computePayableAmount(totalAmountPaise, plan);
    if (payableAmountPaise <= 0) return res.status(400).json({ error: 'This service has no payable amount. Use the normal booking flow instead.' });

    const receipt = `cng_${Date.now()}_${service.id.slice(0, 8)}`;
    const order = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: payableAmountPaise,
        currency: 'INR',
        receipt,
        notes: {
          customer_id: String(req.user.id), provider_id: String(provider_id), service_id: String(service_id),
          availability_id: String(availability_id), start_time: String(start_time), payment_plan: plan,
        },
      }),
    });
    res.status(201).json({
      key: process.env.RAZORPAY_KEY_ID,
      order,
      paymentPlan: plan,
      serviceTitle: service.title,
      pricing: {
        totalAmountPaise,
        payableAmountPaise,
        totalAmount: (totalAmountPaise / 100).toFixed(2),
        payableAmount: (payableAmountPaise / 100).toFixed(2),
      },
    });
  } catch (error) { next(error); }
};

const verifyPaymentAndBook = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can pay for bookings' });
    const {
      provider_id, service_id, availability_id, start_time, payment_plan,
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
    } = req.body;
    if (!provider_id || !service_id || !availability_id || !start_time) {
      return res.status(400).json({ error: 'provider_id, service_id, availability_id and start_time are required' });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
    }
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const signatureBuffer = Buffer.from(expectedSignature);
    const suppliedBuffer = Buffer.from(String(razorpay_signature));
    if (signatureBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, suppliedBuffer)) {
      return res.status(400).json({ error: 'Payment signature verification failed' });
    }

    const plan = normalizePaymentPlan(payment_plan);
    const { service, totalAmountPaise } = await getServicePricing(service_id, provider_id);
    const payableAmountPaise = computePayableAmount(totalAmountPaise, plan);
    const order = await razorpayRequest(`/orders/${encodeURIComponent(razorpay_order_id)}`);
    if (Number(order.amount) !== payableAmountPaise) return res.status(400).json({ error: 'Paid amount does not match the expected booking amount' });

    const booking = await createBookingForCustomer({
      customerId: req.user.id,
      providerId: provider_id,
      serviceId: service_id,
      startTime: start_time,
      availabilityId: availability_id,
      finalStatus: 'CONFIRMED',
      paymentAmount: payableAmountPaise / 100,
      paymentStatus: 'SUCCESS',
      paymentMethod: plan === 'FULL' ? 'RAZORPAY_FULL' : 'RAZORPAY_ADVANCE_50',
      transactionId: razorpay_payment_id,
    });
    res.status(201).json({
      message: 'Payment verified and booking confirmed',
      booking_id: booking.booking_id,
      service_title: service.title,
      payment: {
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
        plan,
        amount_paid: (payableAmountPaise / 100).toFixed(2),
        total_amount: (totalAmountPaise / 100).toFixed(2),
      },
    });
  } catch (error) {
    if (isSlotConflict(error)) {
      return res.status(409).json({ error: 'This time was just booked by someone else. No booking was created.' });
    }
    next(error);
  }
};

const createPayLaterBooking = async (req, res, next) => {
  try {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Only customers can book services' });
    const { provider_id, service_id, availability_id, start_time } = req.body;
    if (!provider_id || !service_id || !availability_id || !start_time) {
      return res.status(400).json({ error: 'provider_id, service_id, availability_id and start_time are required' });
    }
    const { service, totalAmountPaise } = await getServicePricing(service_id, provider_id);
    const booking = await createBookingForCustomer({
      customerId: req.user.id,
      providerId: provider_id,
      serviceId: service_id,
      startTime: start_time,
      availabilityId: availability_id,
      finalStatus: 'PENDING',
      paymentAmount: totalAmountPaise > 0 ? totalAmountPaise / 100 : null,
      paymentStatus: totalAmountPaise > 0 ? 'PENDING' : null,
      paymentMethod: totalAmountPaise > 0 ? 'PAY_AFTER_SERVICE' : null,
    });
    res.status(201).json({
      message: 'Booking request sent to the provider. Payment is due after the service.',
      booking_id: booking.booking_id,
      status: 'PENDING',
      service_title: service.title,
      payment: { plan: 'PAY_LATER', amount_due: (totalAmountPaise / 100).toFixed(2) },
    });
  } catch (error) {
    if (isSlotConflict(error)) {
      return res.status(409).json({ error: 'This time is no longer available. No booking was created.' });
    }
    next(error);
  }
};

module.exports = { createPaymentOrder, verifyPaymentAndBook, createPayLaterBooking };
