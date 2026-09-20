function money(value) {
  const number = Number(value || 0);
  return number % 1 === 0 ? number.toFixed(0) : number.toFixed(2).replace(/0$/, "");
}

function productView(product) {
  const item = product || {};
  const displayPrice = Math.max(0, Number(item.price || 0));
  const payPrice = orderUnitPrice(item);
  const strikePrice = Math.max(0, Number(item.strikePrice ?? item.oldPrice ?? 0));
  const showStrikePrice = item.showStrikePrice === true && strikePrice > 0;
  const status = ["hidden", "stock", "warehouse", "soldout", "recycle"].includes(item.status)
    ? "hidden"
    : "visible";
  return {
    ...item,
    status,
    priceText: money(displayPrice),
    payPriceText: money(payPrice),
    strikePriceText: showStrikePrice ? money(strikePrice) : "",
    increasePriceText: money(Math.max(0, payPrice - displayPrice))
  };
}

function normalizeCategories(config) {
  const tree = Array.isArray(config?.categoryTree) ? config.categoryTree : [];
  return tree.filter((item) => (
    item
    && item.name
    && item.status !== "hidden"
    && item.visible !== false
    && item.enabled !== false
  )).map((item) => ({
    name: String(item.name),
    initial: String(item.name).slice(0, 1),
    imageUrl: item.imageUrl || "",
    children: Array.isArray(item.children) ? item.children.map(String).filter(Boolean) : []
  }));
}

function isProductCategoryVisible(config, product) {
  const mainCategory = String(product?.mainCategory || product?.gameCategory || "").trim();
  if (!mainCategory) return true;
  const tree = Array.isArray(config?.categoryTree) ? config.categoryTree : [];
  const group = tree.find((item) => item && String(item.name) === mainCategory);
  return !group || (
    group.status !== "hidden"
    && group.visible !== false
    && group.enabled !== false
  );
}

function normalizeServers(source) {
  const list = Array.isArray(source) ? source : [];
  return list.map((item) => typeof item === "string" ? { name: item, enabled: true } : item)
    .filter((item) => item && item.enabled !== false && item.name)
    .map((item) => String(item.name));
}

function serversForProduct(config, product) {
  const tree = Array.isArray(config?.categoryTree) ? config.categoryTree : [];
  const group = tree.find((item) => item && String(item.name) === String(product?.mainCategory || ""));
  const categoryServers = normalizeServers(group?.gameServers);
  if (categoryServers.length) return categoryServers;
  const productServers = normalizeServers(product?.gameServers);
  if (productServers.length) return productServers;
  return normalizeServers(config?.gameServers);
}

function orderUnitPrice(product) {
  const display = Number(product?.price || 0);
  const payable = Number(product?.orderPrice);
  return Number.isFinite(payable) ? Math.max(0, payable) : Math.max(0, display);
}

module.exports = {
  money,
  productView,
  normalizeCategories,
  isProductCategoryVisible,
  normalizeServers,
  serversForProduct,
  orderUnitPrice
};
