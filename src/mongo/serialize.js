function toApi(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  obj.id = obj.legacyId;
  delete obj._id;
  delete obj.legacyId;
  return obj;
}

function toApiMany(docs) {
  return (docs || []).map(toApi);
}

function pickPublicUser(user) {
  const obj = toApi(user);
  if (!obj) return null;
  delete obj.password_hash;
  return obj;
}

function boolFromRequest(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

module.exports = {
  toApi,
  toApiMany,
  pickPublicUser,
  boolFromRequest
};
