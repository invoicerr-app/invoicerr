import { buildNativeDocumentTypeDescriptors } from './native-types';

describe('native document type icons', () => {
  it('gives every native type its own icon key', () => {
    const icons = buildNativeDocumentTypeDescriptors().map((descriptor) => descriptor.icon);
    expect(icons.every((icon) => typeof icon === 'string' && icon.length > 0)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
