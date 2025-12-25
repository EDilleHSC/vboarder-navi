const { matchEntity } = require('../../runtime/current/lib/router');
const routingConfig = require('../../NAVI/config/routing_config.json');

test('matchEntity should detect LHI from company name and address', () => {
  const text = 'INVOICE\nLORIC HOMES AND INTERIORS LLC\n3870 Mallow Rd\nAmount Due: 1250.00';
  const ent = matchEntity(text, routingConfig);
  expect(ent).toBe('LHI');
});

test('matchEntity returns null for unknown text', () => {
  const text = 'Some random note with no signals';
  const ent = matchEntity(text, routingConfig);
  expect(ent).toBeNull();
});