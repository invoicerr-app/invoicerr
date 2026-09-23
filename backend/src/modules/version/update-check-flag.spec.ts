import { isUpdateCheckDisabled } from './update-check-flag';

describe('isUpdateCheckDisabled', () => {
  it('is false when unset — the update check is on by default', () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
  });

  it('is true for "true" and "1", case-insensitively and trimmed', () => {
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: 'true' })).toBe(true);
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: 'TRUE' })).toBe(true);
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: '1' })).toBe(true);
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: '  true  ' })).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: 'false' })).toBe(false);
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: '0' })).toBe(false);
    expect(isUpdateCheckDisabled({ DISABLE_UPDATE_CHECK: 'yes' })).toBe(false);
  });
});
