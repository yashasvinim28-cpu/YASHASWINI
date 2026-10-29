const { supabase, unwrap } = require('../config/supabase');

function ensureAdmin(req, res) {
  if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

const statusOrder = { PENDING: 0, REJECTED: 1, APPROVED: 2 };

const getAdminDashboard = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const [users, services, bookings, payments] = await Promise.all([
      unwrap(supabase.from('_users').select('id,role').eq('is_deleted', false)),
      unwrap(supabase.from('_services')
        .select('id,title,price,duration_minutes,approval_status,admin_review_note,created_at,reviewed_at,category:_categories(name),provider:_users!_services_provider_id_fkey(name,email),reviewer:_users!_services_reviewed_by_fkey(name)')
        .eq('is_deleted', false)),
      unwrap(supabase.from('_bookings').select('id').eq('is_deleted', false)),
      unwrap(supabase.from('_payments').select('amount').eq('is_deleted', false).eq('status', 'SUCCESS')),
    ]);

    const overview = {
      customers_count: users.filter((user) => user.role === 'CUSTOMER').length,
      providers_count: users.filter((user) => user.role === 'PROVIDER').length,
      admins_count: users.filter((user) => user.role === 'ADMIN').length,
      total_services: services.length,
      pending_services: services.filter((service) => service.approval_status === 'PENDING').length,
      approved_services: services.filter((service) => service.approval_status === 'APPROVED').length,
      rejected_services: services.filter((service) => service.approval_status === 'REJECTED').length,
      total_bookings: bookings.length,
      total_revenue: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toFixed(2),
    };
    const breakdown = ['PENDING', 'APPROVED', 'REJECTED'].map((approval_status) => ({
      approval_status,
      total: overview[`${approval_status.toLowerCase()}_services`],
    }));
    const recentServices = [...services]
      .sort((a, b) => (statusOrder[a.approval_status] ?? 3) - (statusOrder[b.approval_status] ?? 3)
        || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8)
      .map(({ category, provider, reviewer, ...service }) => ({
        ...service,
        category_name: category?.name || null,
        provider_name: provider?.name || null,
        provider_email: provider?.email || null,
        reviewer_name: reviewer?.name || null,
      }));

    res.status(200).json({ overview, breakdown, recentServices });
  } catch (error) { next(error); }
};

const getAdminServices = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const status = String(req.query.status || 'ALL').toUpperCase();
    let query = supabase.from('_services')
      .select('id,provider_id,title,description,price,duration_minutes,tags,location_address,approval_status,admin_review_note,created_at,reviewed_at,category:_categories(name),provider:_users!_services_provider_id_fkey(name,email),reviewer:_users!_services_reviewed_by_fkey(name)')
      .eq('is_deleted', false);
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) query = query.eq('approval_status', status);
    const services = await unwrap(query.order('created_at', { ascending: false }));
    services.sort((a, b) => (statusOrder[a.approval_status] ?? 3) - (statusOrder[b.approval_status] ?? 3)
      || new Date(b.created_at) - new Date(a.created_at));
    res.status(200).json(services.map(({ category, provider, reviewer, ...service }) => ({
      ...service,
      category_name: category?.name || null,
      provider_name: provider?.name || null,
      provider_email: provider?.email || null,
      reviewer_name: reviewer?.name || null,
    })));
  } catch (error) { next(error); }
};

const reviewService = async (req, res, next) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const approvalStatus = String(req.body.approval_status || '').toUpperCase();
    const adminReviewNote = req.body.admin_review_note ? String(req.body.admin_review_note).trim() : null;
    if (!['APPROVED', 'REJECTED'].includes(approvalStatus)) {
      return res.status(400).json({ error: 'approval_status must be APPROVED or REJECTED' });
    }
    const service = await unwrap(supabase.from('_services').update({
      approval_status: approvalStatus,
      admin_review_note: adminReviewNote,
      reviewed_at: new Date().toISOString(),
      reviewed_by: req.user.id,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('is_deleted', false).select('*').maybeSingle());
    if (!service) return res.status(404).json({ error: 'Service not found' });
    res.status(200).json({
      message: approvalStatus === 'APPROVED' ? 'Service approved' : 'Service rejected',
      service,
    });
  } catch (error) { next(error); }
};

module.exports = { getAdminDashboard, getAdminServices, reviewService };
