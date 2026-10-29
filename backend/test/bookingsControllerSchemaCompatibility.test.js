const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const bookings = [{
  id: 'booking-1',
  status: 'PENDING',
  availability_id: 'availability-1',
  duration_minutes: 30,
  service: { id: 'service-1', title: 'Consultation', price: 50, duration_minutes: 30 },
  availability: { start_time: '2030-01-02T10:00:00.000Z', end_time: '2030-01-02T10:30:00.000Z' },
  target_availability: null,
  customer: { id: 'customer-1', name: 'Customer' },
  provider: { id: 'provider-1', name: 'Provider' },
  payment: null,
}];

class Query {
  constructor(table, options) { this.table = table; this.options = options; this.columns = ''; this.filters = []; }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  in() { return this; }
  maybeSingle() { return Promise.resolve({ data: null, error: null }); }
  then(resolve, reject) {
    if (this.table === '_bookings' && this.columns.includes('cancellation_reason')) {
      return Promise.reject(Object.assign(
        new Error(this.options.cancellationReasonErrorMessage || "Could not find the 'cancellation_reason' column of '_bookings' in the schema cache"),
        { code: this.options.cancellationReasonErrorCode || 'PGRST204' },
      )).then(resolve, reject);
    }
    const data = this.table === '_bookings' ? bookings
      : this.table === '_booking_extensions' || this.table === '_booking_cancellation_requests'
        || this.table === '_booking_reschedule_requests' ? [] : [];
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

async function loadControllerAndRequest(user, options = {}) {
  const controllerPath = require.resolve('../controllers/bookings.controller');
  delete require.cache[controllerPath];
  const bookingQueries = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => warnings.push(values.join(' '));
  Module._load = function loadWithSupabaseStub(request, parent, isMain) {
    if (request === '../config/supabase' && parent?.filename === controllerPath) {
      return {
        supabase: {
          rpc: async () => ({ data: null, error: null }),
          from: (table) => {
            const query = new Query(table, options);
            if (table === '_bookings') bookingQueries.push(query);
            return query;
          },
        },
        unwrap: async (query) => {
          const result = await query;
          if (result.error) throw result.error;
          return result.data;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { getMyBookings } = require('../controllers/bookings.controller');
    let status;
    let body;
    let nextError;
    const res = {
      status(value) { status = value; return this; },
      json(value) { body = value; return this; },
    };
    await getMyBookings({ user }, res, (error) => { nextError = error; });
    return { status, body, nextError, bookingQueries, warnings };
  } finally {
    Module._load = originalLoad;
    console.warn = originalWarn;
    delete require.cache[controllerPath];
  }
}

test('booking listing remains available when optional cancellation_reason is absent', async () => {
  const { status, body, nextError } = await loadControllerAndRequest({ id: 'customer-1', role: 'CUSTOMER' });
  assert.equal(nextError, undefined);
  assert.equal(status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 'booking-1');
  assert.equal(body[0].status, 'PENDING');
  assert.equal(body[0].cancellation_reason, null);
});

test('booking listing tolerates only a missing cancellation_reason column', async () => {
  const result = await loadControllerAndRequest(
    { id: 'customer-1', role: 'CUSTOMER' },
    {
      cancellationReasonErrorCode: '42703',
      cancellationReasonErrorMessage: 'column _bookings.cancellation_reason does not exist',
    },
  );
  assert.equal(result.nextError, undefined);
  assert.equal(result.status, 200);
  assert.equal(result.body[0].id, 'booking-1');
  assert.match(result.warnings[0], /cancellation_reason is unavailable/);

  const unrelatedSchemaError = await loadControllerAndRequest(
    { id: 'customer-1', role: 'CUSTOMER' },
    {
      cancellationReasonErrorCode: '42703',
      cancellationReasonErrorMessage: 'column _bookings.unexpected_field does not exist',
    },
  );
  assert.match(unrelatedSchemaError.nextError?.message || '', /unexpected_field/);
});

test('booking listing scopes the query to the authenticated customer or provider', async () => {
  const customerResult = await loadControllerAndRequest({ id: 'customer-1', role: 'CUSTOMER' });
  const providerResult = await loadControllerAndRequest({ id: 'provider-1', role: 'PROVIDER' });

  assert.ok(customerResult.bookingQueries[0].filters.some(([column, value]) => column === 'customer_id' && value === 'customer-1'));
  assert.ok(!customerResult.bookingQueries[0].filters.some(([column]) => column === 'provider_id'));
  assert.ok(providerResult.bookingQueries[0].filters.some(([column, value]) => column === 'provider_id' && value === 'provider-1'));
  assert.ok(!providerResult.bookingQueries[0].filters.some(([column]) => column === 'customer_id'));
  assert.equal(providerResult.status, 200);
  assert.equal(providerResult.body[0].id, 'booking-1');
  assert.equal(providerResult.body[0].status, 'PENDING');
  assert.equal(providerResult.body[0].customer_name, 'Customer');
});
