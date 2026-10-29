const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { supabase, unwrap } = require('../config/supabase');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function issueAuthResponse(userRow) {
  const token = jwt.sign(
    { id: userRow.id, role: userRow.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  return {
    token,
    user: {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role,
      phone: userRow.phone,
    },
  };
}

async function ensureProviderProfile(userId, role) {
  if (role !== 'PROVIDER') return;
  await unwrap(supabase.from('_provider_profiles').upsert(
    { user_id: userId },
    { onConflict: 'user_id', ignoreDuplicates: true }
  ));
}

async function verifyGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is missing in the backend environment');
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error('Google account email is missing or not verified');
  }
  return payload;
}

const registerUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Please provide name, email, password, and role' });
    }
    const normalizedRole = String(role).toUpperCase();
    if (!['CUSTOMER', 'PROVIDER'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Role must be CUSTOMER or PROVIDER' });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const newUser = await unwrap(supabase.from('_users')
      .insert({ name, email: email.toLowerCase(), password_hash: passwordHash, role: normalizedRole, phone: phone || null })
      .select('id,name,email,role,phone')
      .single());
    await ensureProviderProfile(newUser.id, newUser.role);

    res.status(201).json({
      message: 'User registered successfully',
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Please provide email and password' });

    const userRow = await unwrap(supabase.from('_users')
      .select('id,name,email,phone,password_hash,role')
      .eq('email', email.toLowerCase())
      .eq('is_deleted', false)
      .maybeSingle());
    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.status(200).json({ message: 'Login successful', ...issueAuthResponse(userRow) });
  } catch (error) {
    next(error);
  }
};

const adminLogin = async (req, res, next) => {
  try {
    const { email, password, adminCode } = req.body;
    if (!email || !password || !adminCode) {
      return res.status(400).json({ error: 'Please provide email, password, and admin code' });
    }
    if (!process.env.ADMIN_ACCESS_CODE) {
      return res.status(500).json({ error: 'ADMIN_ACCESS_CODE is not configured on the server' });
    }
    if (adminCode !== process.env.ADMIN_ACCESS_CODE) {
      return res.status(401).json({ error: 'Invalid admin code' });
    }

    const userRow = await unwrap(supabase.from('_users')
      .select('id,name,email,phone,password_hash,role')
      .eq('email', email.toLowerCase())
      .eq('is_deleted', false)
      .maybeSingle());
    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.status(200).json({
      message: 'Admin login successful',
      ...issueAuthResponse({ ...userRow, role: 'ADMIN' }),
    });
  } catch (error) {
    next(error);
  }
};

const googleAuth = async (req, res, next) => {
  try {
    const { credential, role, phone } = req.body;
    if (!credential) return res.status(400).json({ error: 'Google credential is required' });

    const googlePayload = await verifyGoogleCredential(credential);
    const normalizedRole = String(role || 'CUSTOMER').toUpperCase();
    if (!['CUSTOMER', 'PROVIDER'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Role must be CUSTOMER or PROVIDER' });
    }

    const email = googlePayload.email.toLowerCase();
    let userRow = await unwrap(supabase.from('_users')
      .select('id,name,email,phone,role')
      .eq('email', email)
      .eq('is_deleted', false)
      .maybeSingle());

    if (!userRow) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      try {
        userRow = await unwrap(supabase.from('_users').insert({
          name: googlePayload.name || email.split('@')[0],
          email,
          password_hash: passwordHash,
          role: normalizedRole,
          phone: phone || null,
        }).select('id,name,email,phone,role').single());
      } catch (error) {
        if (error.code !== '23505') throw error;
        userRow = await unwrap(supabase.from('_users')
          .select('id,name,email,phone,role').eq('email', email).eq('is_deleted', false).single());
      }
    }

    await ensureProviderProfile(userRow.id, userRow.role);
    res.status(200).json({ message: 'Google authentication successful', ...issueAuthResponse(userRow) });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await unwrap(supabase.from('users')
      .select('id,name,email,role,phone')
      .eq('id', req.user.id)
      .maybeSingle());
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ user: { ...user, role: req.user.role || user.role } });
  } catch (error) {
    next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const updates = {};
    for (const key of ['name', 'phone']) {
      if (req.body[key] === undefined) continue;
      const value = String(req.body[key]).trim();
      if (key === 'name' && value.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
      if (key === 'phone' && value.length > 0 && value.length < 8) return res.status(400).json({ error: 'Phone number looks too short' });
      updates[key] = value || null;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields provided' });
    updates.updated_at = new Date().toISOString();

    const user = await unwrap(supabase.from('_users').update(updates)
      .eq('id', req.user.id).eq('is_deleted', false)
      .select('id,name,email,role,phone').maybeSingle());
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ message: 'Profile updated', user });
  } catch (error) {
    next(error);
  }
};

module.exports = { registerUser, loginUser, adminLogin, googleAuth, getMe, updateMe };
