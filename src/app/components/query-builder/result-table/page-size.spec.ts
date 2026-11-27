import { fitPageSize } from './page-size';

describe('fitPageSize', () => {
  it('counts the whole rows that fit', () => {
    expect(fitPageSize(760, 25)).toBe(30);
  });

  it('is at least 10', () => {
    expect(fitPageSize(100, 25)).toBe(10);
  });

  it('is 25 when a height cannot be measured', () => {
    expect(fitPageSize(0, 25)).toBe(25);
    expect(fitPageSize(600, 0)).toBe(25);
    expect(fitPageSize(undefined, 25)).toBe(25);
  });
});
