const { supabase, unwrap } = require('../config/supabase');

const getMyNotifications = async (req, res, next) => {
  try {
    await unwrap(supabase.rpc('expire_booking_holds'));
    const rows = await unwrap(supabase.from('_notifications')
      .select('id,type,message,data,is_read,created_at')
      .eq('user_id', req.user.id)
      .eq('is_deleted', false)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(30));
    res.status(200).json(rows);
  } catch (error) { next(error); }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const row = await unwrap(supabase.from('_notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .eq('is_deleted', false)
      .select('id,is_read')
      .maybeSingle());
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    res.status(200).json(row);
  } catch (error) { next(error); }
};

module.exports = { getMyNotifications, markNotificationRead };
