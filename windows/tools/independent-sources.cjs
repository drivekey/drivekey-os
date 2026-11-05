'use strict';

function independent(values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > 8) return false;
  try {
    const hosts = values.map(value => {
      if (typeof value !== 'string') throw Error('Endpoint must be a URL.');
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw Error('Untrusted endpoint.');
      return url.hostname.toLowerCase().replace(/\.+$/, '');
    });
    return new Set(hosts).size >= 2;
  } catch {
    return false;
  }
}

module.exports = {independent};
