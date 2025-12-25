const fs = require('fs');
const path = require('path');
const { getByText, getByRole } = require('@testing-library/dom');

describe('presenter mail-room UI', () => {
  let html;

  beforeAll(() => {
    const file = path.join(__dirname, '..', '..', 'presenter', 'mail-room.html');
    html = fs.readFileSync(file, 'utf8');
    document.documentElement.innerHTML = html;
  });

  test('renders main title and approve button', () => {
    expect(getByText(document.body, /NAVI Mail Room/i)).toBeTruthy();
    const approveBtn = getByRole(document.body, 'button', { name: /approve/i });
    expect(approveBtn).toBeTruthy();
  });

  test('ai recommendation panel present', () => {
    expect(getByText(document.body, /AI Recommendation/i)).toBeTruthy();
  });
});