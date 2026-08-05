function batchRemovalAction(status) {
  return status === 'approved' ? 'archive' : 'delete';
}

module.exports = { batchRemovalAction };
