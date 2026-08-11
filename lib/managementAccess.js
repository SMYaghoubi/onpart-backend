const MANAGEMENT_ROLES = Object.freeze(['admin','partner']);

function isManagementRole(role) {
  return MANAGEMENT_ROLES.includes(role);
}

function managementTokenStatus(tokenRole, hasUserId = true) {
  if (tokenRole === 'supplier') return 403;
  return hasUserId ? 200 : 401;
}

function managementStoredRoleStatus(storedRole) {
  return isManagementRole(storedRole) ? 200 : 403;
}

function managementAccessStatus(tokenRole, storedRole, hasUserId = true) {
  const tokenStatus = managementTokenStatus(tokenRole, hasUserId);
  return tokenStatus === 200 ? managementStoredRoleStatus(storedRole) : tokenStatus;
}

module.exports = { MANAGEMENT_ROLES, isManagementRole, managementTokenStatus, managementStoredRoleStatus, managementAccessStatus };