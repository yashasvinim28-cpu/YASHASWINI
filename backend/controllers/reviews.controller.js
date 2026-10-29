const { supabase, unwrap } = require('../config/supabase');

const createReview = async (req, res, next) => {
  try {
    const { booking_id, rating, comment } = req.body;
    const score = Number(rating);
    if (!booking_id || !Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ error: 'booking_id and rating (1-5) are required' });
    }
    const booking = await unwrap(supabase.from('_bookings')
      .select('id,customer_id,status').eq('id', booking_id).maybeSingle());
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.customer_id !== req.user.id) return res.status(403).json({ error: 'Unauthorized to review this booking' });
    if (booking.status !== 'COMPLETED') return res.status(400).json({ error: 'Only completed bookings can be reviewed' });

    const review = await unwrap(supabase.from('_reviews').insert({
      booking_id,
      user_id: req.user.id,
      rating: score,
      comment: comment || null,
    }).select('id,booking_id,user_id,rating,comment,created_at').single());
    res.status(201).json({ message: 'Review submitted', review });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Review already exists for this booking' });
    next(error);
  }
};

const getServiceReviews = async (req, res, next) => {
  try {
    const reviews = await unwrap(supabase.from('_reviews')
      .select('id,booking_id,user_id,rating,comment,created_at,booking:_bookings!_reviews_booking_id_fkey!inner(service_id),reviewer:_users!_reviews_user_id_fkey(name)')
      .eq('booking.service_id', req.params.serviceId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }));
    res.status(200).json(reviews.map(({ booking, reviewer, ...review }) => ({
      ...review,
      reviewer_name: reviewer?.name || null,
    })));
  } catch (error) { next(error); }
};

const getMyPendingReviews = async (req, res, next) => {
  try {
    const bookings = await unwrap(supabase.from('_bookings')
      .select('id,service_id,service:_services!_bookings_service_id_fkey(title),availability:_availabilities!_bookings_availability_id_fkey(start_time,end_time),provider:_users!_bookings_provider_id_fkey(name),review:_reviews!_reviews_booking_id_fkey(id)')
      .eq('customer_id', req.user.id)
      .eq('status', 'COMPLETED')
      .eq('is_deleted', false));
    const pending = bookings.filter((booking) => !booking.review)
      .sort((a, b) => new Date(a.availability?.end_time || 0) - new Date(b.availability?.end_time || 0))
      .map((booking) => ({
        booking_id: booking.id,
        service_id: booking.service_id,
        service_title: booking.service?.title || null,
        start_time: booking.availability?.start_time || null,
        end_time: booking.availability?.end_time || null,
        provider_name: booking.provider?.name || null,
      }));
    res.status(200).json(pending);
  } catch (error) { next(error); }
};

module.exports = { createReview, getServiceReviews, getMyPendingReviews };
