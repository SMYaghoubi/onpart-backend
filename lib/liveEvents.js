const clients = new Set();

function addClient(req, res) {
  clients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clients.delete(res); }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, at: Date.now() })}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch (_) { clients.delete(client); }
  }
}

module.exports = { addClient, broadcast };
