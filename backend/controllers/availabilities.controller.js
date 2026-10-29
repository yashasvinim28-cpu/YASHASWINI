const { supabase, unwrap } = require('../config/supabase');
const { fetchAllPages, DEFAULT_PAGE_SIZE } = require('../utils/availabilityPages');
const { isMissingAvailabilitySettings } = require('../utils/availabilitySchema');
const { isValidLocalDate, localDateKeyAt, localDateUtcRange } = require('../utils/localDateRange');
const { buildDefaultAvailabilityRows, keepFutureAvailabilityRows, buildRecurringAvailabilityRows } = require('../utils/defaultAvailability');

const DEFAULT_PROVIDER_TIME_ZONE = 'Asia/Kolkata';

const createAvailability = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can create availabilities' });
    const { start_time, end_time } = req.body;
    if (!start_time || !end_time) return res.status(400).json({ error: 'start_time and end_time are required' });

    let timeZone = DEFAULT_PROVIDER_TIME_ZONE;
    try {
      const settings = await unwrap(supabase.from('_provider_availability_settings').select('time_zone')
        .eq('provider_id', req.user.id).maybeSingle());
      timeZone = settings?.time_zone || timeZone;
    } catch (error) {
      if (!isMissingAvailabilitySettings(error)) throw error;
    }
    let allSlots;
    try {
      allSlots = buildRecurringAvailabilityRows(req.user.id, start_time, end_time, timeZone);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!allSlots.length) return res.status(400).json({ error: 'No slots generated' });

    // One PostgREST insert is transactional; the exclusion constraint rejects all rows if any overlap.
    const inserted = await unwrap(supabase.from('_availabilities').insert(allSlots).select('id'));
    res.status(201).json({ message: 'Availability created through the next 2 months', total_slots_created: inserted.length });
  } catch (error) {
    if (error.code === '23P01') return res.status(409).json({ error: 'Some slots overlap existing ones' });
    next(error);
  }
};

const getProviderAvailabilities = async (req, res, next) => {
  try {
    if (req.query.date && !isValidLocalDate(req.query.date)) {
      return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD value' });
    }
    let timeZone = DEFAULT_PROVIDER_TIME_ZONE;
    let opensAt = '10:00:00';
    let closesAt = '18:00:00';
    let isEnabled = true;
    try {
      const settings = await unwrap(supabase.from('_provider_availability_settings').select('time_zone,opens_at,closes_at,is_enabled')
        .eq('provider_id', req.params.provider_id).maybeSingle());
      timeZone = settings?.time_zone || DEFAULT_PROVIDER_TIME_ZONE;
      opensAt = settings?.opens_at || opensAt;
      closesAt = settings?.closes_at || closesAt;
      isEnabled = settings?.is_enabled ?? true;
    } catch (error) {
      // Existing deployments may not have the additive availability settings migration yet.
      // The RPC result remains authoritative; preserve those real slots with the documented default zone.
      if (!isMissingAvailabilitySettings(error)) throw error;
      console.warn('Provider availability settings table is not installed; using the default timezone until the availability migration is applied.');
    }

    if (req.query.date) {
      const today = localDateKeyAt(new Date(), timeZone);
      if (req.query.date < today) {
        return res.status(400).json({ error: 'Availability cannot be requested for a past date' });
      }
      if (!isEnabled) return res.status(200).json([]);

      const [provider, profile, activeService] = await Promise.all([
        unwrap(supabase.from('_users').select('id').eq('id', req.params.provider_id)
          .eq('role', 'PROVIDER').eq('is_deleted', false).maybeSingle()),
        unwrap(supabase.from('_provider_profiles').select('user_id').eq('user_id', req.params.provider_id)
          .eq('is_deleted', false).maybeSingle()),
        unwrap(supabase.from('_services').select('id').eq('provider_id', req.params.provider_id)
          .eq('is_deleted', false).eq('approval_status', 'APPROVED').limit(1)),
      ]);
      if (!provider || !profile || !activeService.length) return res.status(200).json([]);

      const range = localDateUtcRange(req.query.date, timeZone);
      try {
        const block = await unwrap(supabase.from('_provider_day_blocks').select('id')
          .eq('provider_id', req.params.provider_id).eq('blocked_date', req.query.date).maybeSingle());
        if (block) return res.status(200).json([]);
      } catch (error) {
        if (!isMissingAvailabilitySettings(error)) throw error;
      }

      const existingRows = await unwrap(supabase.from('_availabilities').select('id')
        .eq('provider_id', req.params.provider_id).eq('is_deleted', false)
        .gte('start_time', range.start).lt('start_time', range.end).limit(1));
      if (!existingRows.length) {
        let generatedRows = buildDefaultAvailabilityRows(
          req.params.provider_id, req.query.date, timeZone, opensAt, closesAt,
        );
        // The rolling default window starts tomorrow. Generate only the remaining
        // future rows for today when there is no explicit provider schedule.
        if (req.query.date === today) {
          generatedRows = keepFutureAvailabilityRows(generatedRows);
        }
        try {
          if (generatedRows.length) await unwrap(supabase.from('_availabilities').insert(generatedRows).select('id'));
        } catch (error) {
          // Concurrent date requests can race. The exclusion constraint permits only one set of rows.
          // A collision means another schedule or request won; read and return that schedule below.
          if (error.code !== '23P01') throw error;
        }
      }
    }

    const rows = await fetchAllPages(async (offset, pageSize) => {
      let query = supabase.rpc('get_provider_availabilities', {
        p_provider_id: req.params.provider_id,
      });
      if (req.query.date) {
        const range = localDateUtcRange(req.query.date, timeZone);
        query = query.gte('start_time', range.start).lt('start_time', range.end);
      }
      return unwrap(query.range(offset, offset + Math.min(pageSize, DEFAULT_PAGE_SIZE) - 1));
    });
    res.status(200).json(rows.map((row) => ({ ...row, time_zone: timeZone })));
  } catch (error) { next(error); }
};

const getProviderDayStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can manage day availability' });
    if (!isValidLocalDate(req.query.date)) return res.status(400).json({ error: 'A valid date is required (YYYY-MM-DD)' });
    const [block, settings] = await Promise.all([
      unwrap(supabase.from('_provider_day_blocks').select('id,blocked_date,reason')
        .eq('provider_id', req.user.id).eq('blocked_date', req.query.date).maybeSingle()),
      unwrap(supabase.from('_provider_availability_settings').select('time_zone')
        .eq('provider_id', req.user.id).maybeSingle()),
    ]);
    res.status(200).json({ date: req.query.date, blocked: Boolean(block), reason: block?.reason || null, time_zone: settings?.time_zone || 'Asia/Kolkata' });
  } catch (error) { next(error); }
};

const blockProviderDay = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can block a day' });
    if (!isValidLocalDate(req.body.date)) return res.status(400).json({ error: 'A valid date is required (YYYY-MM-DD)' });
    const result = await unwrap(supabase.rpc('block_provider_day', {
      p_provider_id: req.user.id,
      p_date: req.body.date,
    }));
    res.status(200).json({ message: 'Day blocked and eligible bookings cancelled', ...result });
  } catch (error) {
    if (error.code === '55P03' || error.code === '40P01') {
      return res.status(409).json({ error: 'A booking changed at the same time. Reload the date and try again.' });
    }
    if (/future date|closed|unavailable/i.test(error.message || '')) return res.status(409).json({ error: error.message });
    next(error);
  }
};

const unblockProviderDay = async (req, res, next) => {
  try {
    if (req.user.role !== 'PROVIDER') return res.status(403).json({ error: 'Only providers can reopen a day' });
    if (!isValidLocalDate(req.body.date)) return res.status(400).json({ error: 'A valid date is required (YYYY-MM-DD)' });
    const reopened = await unwrap(supabase.rpc('unblock_provider_day', {
      p_provider_id: req.user.id,
      p_date: req.body.date,
    }));
    res.status(200).json({ message: reopened ? 'Day reopened' : 'Day was not blocked', date: req.body.date, blocked: false });
  } catch (error) {
    if (/future date/i.test(error.message || '')) return res.status(409).json({ error: error.message });
    next(error);
  }
};

module.exports = {
  createAvailability, getProviderAvailabilities, getProviderDayStatus,
  blockProviderDay, unblockProviderDay,
  isMissingAvailabilitySettings,
};
