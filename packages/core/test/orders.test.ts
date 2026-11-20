import { describe, expect, it } from 'vitest';
import { OrderCreateInput, OrderListStatus, OrderQuoteInput, OrderReasonInput, orderLineTotal, PROMISED_ORDER_STATUSES } from '../src/index';

describe('orders', () => {
  it('a line total is the unit price times the quantity, rounded once', () => {
    expect(orderLineTotal(1290, 3, 'piece')).toBe(3870);
    // 1.275 kg of feta at 12.90 a kg
    expect(orderLineTotal(1290, 1275, 'kg')).toBe(1645);
    expect(orderLineTotal(999, 333, 'l')).toBe(333);
  });

  it('lists take a status, or open and closed', () => {
    expect(OrderListStatus.parse('open')).toBe('open');
    expect(OrderListStatus.parse('quoted')).toBe('quoted');
    expect(() => OrderListStatus.parse('lost')).toThrow();
  });

  it('inputs refuse what makes no sense', () => {
    expect(OrderCreateInput.safeParse({ shopId: 's', lines: [] }).success).toBe(false);
    expect(OrderCreateInput.safeParse({ shopId: 's', lines: [{ variantId: 'v', qty: 0 }] }).success).toBe(false);
    expect(OrderCreateInput.safeParse({ shopId: 's', lines: [{ variantId: 'v', qty: 2 }], wantedOn: '28/11/2026' }).success).toBe(false);
    const ok = OrderCreateInput.parse({ shopId: 's', lines: [{ variantId: 'v', qty: 2 }], note: '  for saturday  ' });
    expect(ok.lines[0]!.seenUnitPriceMinor).toBeNull();
    expect(ok.note).toBe('for saturday');
    expect(OrderQuoteInput.safeParse({ lines: [{ lineNo: 1, unitPriceMinor: -1 }] }).success).toBe(false);
    expect(OrderReasonInput.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('what a shop has promised is what is confirmed or ready', () => {
    expect([...PROMISED_ORDER_STATUSES]).toEqual(['confirmed', 'ready']);
  });
});
