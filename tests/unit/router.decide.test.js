const { decideRoute } = require('../../runtime/current/lib/router');
const routingConfig = require('../../NAVI/config/routing_config.json');

test('decideRoute chooses LHI entity and Finance function for LORIC invoice', () => {
  const item = {
    filename: 'TEST_LHI_Bill_RETEST.txt',
    extractedText: 'INVOICE\nLORIC HOMES AND INTERIORS LLC\n3870 Mallow Rd\nAmount Due: 1250.00',
    detectedEntities: [ { entity: 'FINANCE', confidence: 0.75 } ]
  };
  const res = decideRoute(item, routingConfig);
  expect(res.entity).toBe('LHI');
  expect(res.function).toBe('Finance');
  expect(res.route).toBe('LHI.Finance');
});
