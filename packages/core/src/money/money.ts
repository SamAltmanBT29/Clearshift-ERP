import Decimal from "decimal.js";

// ISO-4217 common exponent table
export const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  INR: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2
};

export class Money {
  private readonly amount: Decimal;
  public readonly currency: string;

  constructor(amount: string | number | Decimal, currency = "USD") {
    this.amount = new Decimal(amount);
    this.currency = currency.toUpperCase();
  }

  get scale(): number {
    return CURRENCY_EXPONENTS[this.currency] ?? 2;
  }

  /**
   * Half-Up Rounding per Decision M2 & Section 4.2
   */
  round(): Money {
    const rounded = this.amount.toDecimalPlaces(this.scale, Decimal.ROUND_HALF_UP);
    return new Money(rounded, this.currency);
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  multiply(factor: number | string): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  toFixed(): string {
    return this.round().amount.toFixed(this.scale);
  }

  toStorageString(): string {
    // numeric(19, 4) storage precision
    return this.amount.toFixed(4);
  }
}
