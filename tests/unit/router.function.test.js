const { detectFunction } = require('../../runtime/current/lib/router');
const routingConfig = require('../../NAVI/config/routing_config.json');

test('detectFunction finds Finance from invoice keywords', () => {
  const text = 'This is an invoice. Amount due: $1,234.00';
  const res = detectFunction(text, routingConfig);
  expect(res.function).toBe('Finance');
});

test('detectFunction returns null for unrelated text', () => {
  const text = 'A random note about gardening.';
  const res = detectFunction(text, routingConfig);
  expect(res.function).toBeNull();
});