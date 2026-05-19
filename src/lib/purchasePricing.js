const DISCOUNT_TYPES = new Set(['none', 'percentage', 'amount']);

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function packageSnapshotPrice(purchase, pack) {
  const snapshotPrice = Number(purchase?.package_snapshot?.price);
  if (Number.isFinite(snapshotPrice)) return snapshotPrice;
  const livePrice = Number(pack?.price);
  return Number.isFinite(livePrice) ? livePrice : 0;
}

function resolveStoredPricing(purchase, pack) {
  const originalPrice = purchase?.original_price != null && Number.isFinite(Number(purchase.original_price))
    ? Number(purchase.original_price)
    : packageSnapshotPrice(purchase, pack);

  if (purchase?.final_price != null && Number.isFinite(Number(purchase.final_price))) {
    return {
      original_price: originalPrice,
      discount_type: purchase.discount_type || 'none',
      discount_value: Number(purchase.discount_value || 0),
      discount_amount: Number(purchase.discount_amount || 0),
      final_price: Number(purchase.final_price)
    };
  }

  return {
    original_price: originalPrice,
    discount_type: 'none',
    discount_value: 0,
    discount_amount: 0,
    final_price: originalPrice
  };
}

function calculatePurchasePricing(originalPrice, discountType, discountValue) {
  const price = roundMoney(originalPrice);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Invalid package price');
  }

  const type = discountType || 'none';
  if (!DISCOUNT_TYPES.has(type)) {
    throw new Error('Invalid discount type');
  }

  if (type === 'none') {
    return {
      original_price: price,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      final_price: price
    };
  }

  const value = Number(discountValue);
  if (!Number.isFinite(value)) {
    throw new Error('Invalid discount value');
  }

  if (type === 'percentage') {
    if (value < 0 || value > 100) {
      throw new Error('Percentage discount must be between 0 and 100');
    }
    const discountAmount = roundMoney((price * value) / 100);
    const finalPrice = roundMoney(price - discountAmount);
    if (finalPrice < 0) throw new Error('Final price cannot be negative');
    return {
      original_price: price,
      discount_type: 'percentage',
      discount_value: value,
      discount_amount: discountAmount,
      final_price: finalPrice
    };
  }

  if (value < 0 || value > price) {
    throw new Error('Amount discount must be between 0 and package price');
  }
  const discountAmount = roundMoney(value);
  const finalPrice = roundMoney(price - discountAmount);
  if (finalPrice < 0) throw new Error('Final price cannot be negative');
  return {
    original_price: price,
    discount_type: 'amount',
    discount_value: value,
    discount_amount: discountAmount,
    final_price: finalPrice
  };
}

function paymentStatus(totalPaid, finalPrice) {
  if (Number(totalPaid) === 0) return 'Unpaid';
  if (Number(totalPaid) < Number(finalPrice)) return 'Partially Paid';
  return 'Fully Paid';
}

module.exports = {
  DISCOUNT_TYPES,
  packageSnapshotPrice,
  resolveStoredPricing,
  calculatePurchasePricing,
  paymentStatus
};
