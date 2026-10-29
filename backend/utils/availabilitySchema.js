function isMissingAvailabilitySettings(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

module.exports = { isMissingAvailabilitySettings };
