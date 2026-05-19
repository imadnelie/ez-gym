require('dotenv').config();
const { connectMongo, closeMongo } = require('./mongo/connection');
const { Purchase, Package } = require('./mongo/models');
const { resolveStoredPricing } = require('./lib/purchasePricing');

async function backfillPurchasePricing({ dryRun = false, disconnect = false } = {}) {
  await connectMongo();

  const missing = await Purchase.find({
    $or: [
      { final_price: { $exists: false } },
      { final_price: null },
      { original_price: { $exists: false } },
      { original_price: null }
    ]
  }).lean();

  if (!missing.length) {
    console.log('No purchases need pricing backfill.');
    if (disconnect) await closeMongo();
    return { updated: 0 };
  }

  const packageIds = [...new Set(missing.map((p) => p.package_id))];
  const packages = await Package.find({ legacyId: { $in: packageIds } }).lean();
  const packageById = new Map(packages.map((p) => [p.legacyId, p]));

  let updated = 0;
  for (const purchase of missing) {
    const pack = packageById.get(purchase.package_id);
    const pricing = resolveStoredPricing(purchase, pack);
    if (!dryRun) {
      await Purchase.updateOne({ legacyId: purchase.legacyId }, {
        $set: {
          original_price: pricing.original_price,
          discount_type: pricing.discount_type,
          discount_value: pricing.discount_value,
          discount_amount: pricing.discount_amount,
          final_price: pricing.final_price
        }
      });
    }
    updated += 1;
    console.log(`Backfilled purchase ${purchase.legacyId}: original=${pricing.original_price}, final=${pricing.final_price}`);
  }

  if (disconnect) await closeMongo();
  return { updated };
}

if (require.main === module) {
  backfillPurchasePricing({ disconnect: true })
    .then(({ updated }) => {
      console.log(`Done. Updated ${updated} purchase(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { backfillPurchasePricing };
