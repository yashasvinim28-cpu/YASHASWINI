const { supabase, unwrap } = require('../config/supabase');
const { geocodeAddress } = require('../services/geocoding.service');
const { isMissingAvailabilitySettings } = require('../utils/availabilitySchema');

const serviceFields = 'id,provider_id,category_id,title,description,price,duration_minutes,tags,approval_status,admin_review_note,reviewed_at,location_address,latitude,longitude,created_at';

const createService = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can create services' });
    const { category_id, title, description, price, duration_minutes, tags, location_address } = req.body;
    if (!location_address) return res.status(400).json({ error: 'location_address is required' });

    let geo;
    try { geo = await geocodeAddress(location_address); }
    catch (error) { return res.status(400).json({ error: error.message || 'Could not resolve location coordinates' }); }
    if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)) {
      return res.status(400).json({ error: 'Could not resolve location coordinates' });
    }

    const service = await unwrap(supabase.from('_services').insert({
      provider_id: req.user.id,
      category_id,
      title,
      description: description || null,
      price,
      duration_minutes,
      tags: tags || [],
      location_address: geo.location_address,
      latitude: geo.latitude,
      longitude: geo.longitude,
      approval_status: 'PENDING',
    }).select('*').single());
    res.status(201).json({ message: 'Service created and sent for admin review', service });
  } catch (error) { next(error); }
};

const getServices = async (req, res, next) => {
  try {
    const { q, category_id, category } = req.query;
    let query = supabase.from('_services')
      .select(`${serviceFields},category:_categories(name)`)
      .eq('is_deleted', false)
      .eq('approval_status', 'APPROVED');
    if (category_id) query = query.eq('category_id', category_id);
    if (category) {
      const categories = await unwrap(supabase.from('_categories').select('id,name'));
      const slug = String(category).toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = categories.find((item) => item.name.toLowerCase().replace(/[^a-z0-9]/g, '') === slug);
      if (!match) return res.status(200).json([]);
      query = query.eq('category_id', match.id);
    }
    if (q) query = query.textSearch('search_vector', String(q), { config: 'english', type: 'plain' });
    const rows = await unwrap(query.order('created_at', { ascending: false }));
    res.status(200).json(rows.map(({ category: categoryInfo, ...service }) => ({
      ...service,
      category_name: categoryInfo?.name || null,
    })));
  } catch (error) { next(error); }
};

const getServiceCategories = async (req, res, next) => {
  try {
    const rows = await unwrap(supabase.from('_categories').select('id,name').eq('is_deleted', false).order('name'));
    res.status(200).json(rows.map((category) => ({
      ...category,
      slug: category.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    })));
  } catch (error) { next(error); }
};

const getMyServices = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can access their services' });
    const services = await unwrap(supabase.from('_services').select(serviceFields)
      .eq('provider_id', req.user.id).eq('is_deleted', false).order('created_at', { ascending: false }));
    res.status(200).json(services);
  } catch (error) { next(error); }
};

const getMyServiceById = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can access their services' });
    const service = await unwrap(supabase.from('_services').select(serviceFields)
      .eq('id', req.params.id).eq('provider_id', req.user.id).eq('is_deleted', false).maybeSingle());
    if (!service) return res.status(404).json({ error: 'Service not found' });
    res.status(200).json(service);
  } catch (error) { next(error); }
};

const getServiceById = async (req, res, next) => {
  try {
    const service = await unwrap(supabase.from('_services').select(serviceFields)
      .eq('id', req.params.id).eq('is_deleted', false).eq('approval_status', 'APPROVED').maybeSingle());
    if (!service) return res.status(404).json({ error: 'Service not found' });
    let providerTimeZone = 'Asia/Kolkata';
    try {
      const settings = await unwrap(supabase.from('_provider_availability_settings').select('time_zone')
        .eq('provider_id', service.provider_id).maybeSingle());
      providerTimeZone = settings?.time_zone || providerTimeZone;
    } catch (error) {
      if (!isMissingAvailabilitySettings(error)) throw error;
    }
    res.status(200).json({ ...service, provider_time_zone: providerTimeZone });
  } catch (error) { next(error); }
};

const updateService = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can update services' });
    const updates = {};
    for (const key of ['category_id', 'title', 'description', 'price', 'duration_minutes', 'tags']) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.duration_minutes && req.body.duration_minutes % 15 !== 0) {
      return res.status(400).json({ error: 'Duration must be multiple of 15 minutes' });
    }
    if (req.body.location_address !== undefined) {
      let geo;
      try { geo = await geocodeAddress(req.body.location_address); }
      catch (error) { return res.status(400).json({ error: error.message || 'Could not resolve location coordinates' }); }
      if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)) {
        return res.status(400).json({ error: 'Could not resolve location coordinates' });
      }
      Object.assign(updates, {
        location_address: geo.location_address,
        latitude: geo.latitude,
        longitude: geo.longitude,
      });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields provided for update' });
    Object.assign(updates, {
      approval_status: 'PENDING',
      admin_review_note: null,
      reviewed_at: null,
      reviewed_by: null,
      updated_at: new Date().toISOString(),
    });
    const service = await unwrap(supabase.from('_services').update(updates)
      .eq('id', req.params.id).eq('provider_id', req.user.id).eq('is_deleted', false)
      .select('*').maybeSingle());
    if (!service) return res.status(404).json({ error: 'Service not found or unauthorized' });
    res.status(200).json({ message: 'Service updated and sent back for admin review', service });
  } catch (error) { next(error); }
};

const deleteService = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can delete services' });
    const rows = await unwrap(supabase.from('_services').update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('provider_id', req.user.id).eq('is_deleted', false)
      .select('id'));
    if (!rows.length) return res.status(404).json({ error: 'Service not found or already deleted' });
    res.status(200).json({ message: 'Service deleted successfully' });
  } catch (error) { next(error); }
};

const getServicesByCategory = async (req, res, next) => {
  try {
    const { category_id } = req.params;
    if (!category_id) return res.status(400).json({ error: 'category_id is required' });
    const category = await unwrap(supabase.from('_categories').select('id').eq('id', category_id).maybeSingle());
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const services = await unwrap(supabase.from('_services')
      .select('id,provider_id,category_id,title,description,price,duration_minutes,tags')
      .eq('category_id', category_id).eq('is_deleted', false)
      .order('created_at', { ascending: false }));
    res.status(200).json({ message: 'Services fetched successfully', count: services.length, services });
  } catch (error) { next(error); }
};

module.exports = { createService, getServices, getMyServices, getMyServiceById, getServiceById, updateService, deleteService, getServiceCategories };
