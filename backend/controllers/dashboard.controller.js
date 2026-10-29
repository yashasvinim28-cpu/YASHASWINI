const { supabase, unwrap } = require('../config/supabase');

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED'];

const getMyDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const [profile, bookings, providerServices] = await Promise.all([
      unwrap(supabase.from('_users').select('id,name,email,phone,role,created_at')
        .eq('id', userId).eq('is_deleted', false).maybeSingle()),
      unwrap(supabase.from('_bookings')
        .select('id,status,created_at,service:_services(title),availability:_availabilities!_bookings_availability_id_fkey(start_time),provider:_users!_bookings_provider_id_fkey(name),review:_reviews!_reviews_booking_id_fkey(id)')
        .eq('customer_id', userId).eq('is_deleted', false)),
      role === 'PROVIDER'
        ? unwrap(supabase.from('_services').select('id').eq('provider_id', userId).eq('is_deleted', false))
        : Promise.resolve([]),
    ]);

    const upcomingBookings = bookings
      .filter((booking) => booking.availability && new Date(booking.availability.start_time) > new Date())
      .sort((a, b) => new Date(a.availability.start_time) - new Date(b.availability.start_time))
      .slice(0, 5)
      .map((booking) => ({
        id: booking.id,
        status: booking.status,
        service_title: booking.service?.title || null,
        provider_name: booking.provider?.name || null,
        start_time: booking.availability?.start_time || null,
      }));

    res.status(200).json({
      profile,
      bookingSummary: {
        total: bookings.length,
        completed: bookings.filter((booking) => booking.status === 'COMPLETED').length,
        cancelled: bookings.filter((booking) => booking.status === 'CANCELLED').length,
        active: bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status)).length,
      },
      upcomingBookings,
      pendingReviews: bookings.filter((booking) => booking.status === 'COMPLETED' && !booking.review).length,
      providerSummary: { services_count: providerServices.length },
    });
  } catch (error) { next(error); }
};

const getProviderDashboard = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can access provider dashboard' });
    const services = await unwrap(supabase.from('_services')
      .select('id,price,approval_status,bookings:_bookings!_bookings_service_id_fkey(id,status)')
      .eq('provider_id', req.user.id).eq('is_deleted', false));
    const bookings = services.flatMap((service) => (service.bookings || []).map((booking) => ({ ...booking, service_price: Number(service.price || 0) })));
    const completed = bookings.filter((booking) => booking.status === 'COMPLETED');
    res.status(200).json({
      totalBookings: bookings.length,
      completedBookings: completed.length,
      pendingBookings: bookings.filter((booking) => ACTIVE_STATUSES.includes(booking.status)).length,
      totalRevenue: completed.reduce((sum, booking) => sum + booking.service_price, 0).toFixed(2),
      totalServicesOffered: services.length,
      pendingServices: services.filter((service) => service.approval_status === 'PENDING').length,
      approvedServices: services.filter((service) => service.approval_status === 'APPROVED').length,
      rejectedServices: services.filter((service) => service.approval_status === 'REJECTED').length,
    });
  } catch (error) { next(error); }
};

module.exports = { getMyDashboard, getProviderDashboard };
